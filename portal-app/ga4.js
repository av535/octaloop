// GA4 Data API integration. Switched on when the GA4_SA_KEY secret (service-account JSON key) is set.
// Each client grants the service-account email Viewer access to their GA4 property; the property ID is stored per client.
const AI_SOURCE_REGEX = '(chatgpt\\.com|chat\\.openai\\.com|openai\\.com|perplexity|gemini\\.google|bard\\.google|copilot\\.microsoft|copilot\\.cloud\\.microsoft|bing\\.com/chat|claude\\.ai|anthropic|you\\.com|phind|deepseek|grok\\.com|x\\.ai|meta\\.ai|mistral|chat\\.qwen|poe\\.com)';

function key(env) { try { const k = JSON.parse(env.GA4_SA_KEY || ''); return k.client_email && k.private_key ? k : null; } catch (e) { return null; } }
export const ga4Configured = (env) => !!key(env);
export const ga4ServiceEmail = (env) => (key(env) || {}).client_email || '';

const b64u = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uBuf = (buf) => b64u(String.fromCharCode(...new Uint8Array(buf)));

let cached = null;
async function accessToken(env) {
  if (cached && cached.exp > Date.now() / 1000 + 60) return cached.tok;
  const k = key(env);
  const pem = k.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const ck = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const iat = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: k.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', ck, new TextEncoder().encode(`${head}.${claim}`));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${head}.${claim}.${b64uBuf(sig)}` });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google token request failed: ' + (j.error_description || j.error || r.status));
  cached = { tok: j.access_token, exp: iat + (j.expires_in || 3600) };
  return cached.tok;
}

async function runReport(env, pid, body) {
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
    method: 'POST', headers: { authorization: `Bearer ${await accessToken(env)}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || `GA4 API ${r.status}`);
  return j.rows || [];
}

export async function ga4SyncWeek(env, cid, week) {
  const db = env.PORTAL_DB;
  const st = await db.prepare('SELECT * FROM client_settings WHERE client_id = ?').bind(cid).first();
  if (!st || !st.ga4_property_id) return { ok: false, error: 'no GA4 property ID set for this client' };
  const end = new Date(week + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 6);
  const dateRanges = [{ startDate: week, endDate: end.toISOString().slice(0, 10) }];
  try {
    const srcRows = await runReport(env, st.ga4_property_id, { dateRanges, dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }],
      dimensionFilter: { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'PARTIAL_REGEXP', value: AI_SOURCE_REGEX, caseSensitive: false } } }, limit: 100 });
    const breakdown = {}; let ai = 0;
    for (const r of srcRows) { const n = parseInt(r.metricValues[0].value, 10) || 0; breakdown[r.dimensionValues[0].value] = n; ai += n; }
    const evRows = await runReport(env, st.ga4_property_id, { dateRanges, dimensions: [{ name: 'eventName' }], metrics: [{ name: 'keyEvents' }], limit: 200 });
    const ev = {}; for (const r of evRows) ev[r.dimensionValues[0].value] = parseFloat(r.metricValues[0].value) || 0;
    const sum = (names) => names.reduce((a, n) => a + (ev[n] || 0), 0);
    const leadNames = (st.ga4_lead_events || '').split(',').filter(Boolean), demoNames = (st.ga4_demo_events || '').split(',').filter(Boolean);
    const leads = Math.round(leadNames.length ? sum(leadNames) : Object.values(ev).reduce((a, b) => a + b, 0));
    const demos = demoNames.length ? Math.round(sum(demoNames)) : null;
    await db.batch([
      db.prepare(`INSERT INTO outcomes (client_id, week, ai_sessions, ai_breakdown, demos, leads, source) VALUES (?,?,?,?,?,?,'ga4')
        ON CONFLICT(client_id, week) DO UPDATE SET ai_sessions=excluded.ai_sessions, ai_breakdown=excluded.ai_breakdown, demos=COALESCE(excluded.demos, outcomes.demos),
        leads=excluded.leads, source='ga4', updated_at=datetime('now')`).bind(cid, week, ai, JSON.stringify(breakdown), demos, leads),
      db.prepare("UPDATE client_settings SET ga4_last_sync = datetime('now'), ga4_last_error = '' WHERE client_id = ?").bind(cid),
    ]);
    return { ok: true, ai_sessions: ai, leads, demos };
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    await db.prepare('UPDATE client_settings SET ga4_last_error = ? WHERE client_id = ?').bind(msg, cid).run();
    return { ok: false, error: msg };
  }
}

// Weekly cron: sync last full week (Mon–Sun) for every active client with a property ID.
export async function ga4SyncAll(env) {
  if (!env.PORTAL_DB || !ga4Configured(env)) return;
  const d = new Date(); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow - 7);
  const week = d.toISOString().slice(0, 10);
  const rows = (await env.PORTAL_DB.prepare("SELECT s.client_id FROM client_settings s JOIN clients c ON c.id = s.client_id WHERE c.active = 1 AND s.ga4_property_id != ''").all()).results || [];
  for (const r of rows) await ga4SyncWeek(env, r.client_id, week);
}
