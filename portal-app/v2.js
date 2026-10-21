// Portal v2: work log, outcomes (AI-referral traffic / demos / leads), trends + Day 0 baseline, GA4 sync.
import { ga4Configured, ga4ServiceEmail, ga4SyncWeek } from './ga4.js';
import { loadPrompts, progressView, adminPromptsEditor, adminPromptsPost, captureCurrent, PROGRESS_CSS } from './progress.js';
export { progressView, PROGRESS_CSS };

// Flag: show leads and demos in the CLIENT view. Data, admin fields and GA4 pull stay on regardless.
export const SHOW_CLIENT_LEADS = false;

export const WL_CATEGORIES = ['Pitches sent', 'Placements won', 'Pages fixed', 'Prompts audited', 'Content published', 'Outreach', 'Reporting', 'Other'];
export const WL_STATUSES = ['Done', 'In progress', 'Planned', 'Blocked'];

export function weekOf(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (isNaN(d)) return '';
  const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
const optInt = (v) => { v = String(v ?? '').trim(); if (v === '') return null; const n = parseInt(v.replace(/,/g, ''), 10); return Number.isFinite(n) && n >= 0 ? n : null; };
const optNum = (v) => { v = String(v ?? '').trim().replace('%', ''); if (v === '') return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const fmtWeek = (w) => { if (!w) return '—'; const d = new Date(w + 'T00:00:00Z'); const e = new Date(d); e.setUTCDate(e.getUTCDate() + 6);
  const o = { day: 'numeric', month: 'short', timeZone: 'UTC' }; return `${d.toLocaleDateString('en-GB', o)} – ${e.toLocaleDateString('en-GB', { ...o, year: 'numeric' })}`; };
const nz = (v, suf = '') => (v === null || v === undefined) ? '—' : `${Math.round(v * 10) / 10}${suf}`;

export async function loadV2(env, cid) {
  const db = env.PORTAL_DB;
  const [wl, oc, sn, st] = await Promise.all([
    db.prepare('SELECT * FROM worklog WHERE client_id = ? ORDER BY week DESC, id DESC').bind(cid).all(),
    db.prepare('SELECT * FROM outcomes WHERE client_id = ? ORDER BY week ASC').bind(cid).all(),
    db.prepare('SELECT * FROM snapshots WHERE client_id = ? ORDER BY week ASC').bind(cid).all(),
    db.prepare('SELECT * FROM client_settings WHERE client_id = ?').bind(cid).first(),
  ]);
  return { worklog: wl.results || [], outcomes: oc.results || [], snapshots: sn.results || [], settings: st || {}, prompts: await loadPrompts(env, cid) };
}

export const V2_CSS = `
.tabs{display:flex;gap:6px;margin:6px 0 18px;border-bottom:1px solid var(--line);overflow-x:auto}
.tabs a{padding:10px 14px;text-decoration:none;color:var(--mut);font-weight:700;border-bottom:3px solid transparent;white-space:nowrap}
.tabs a.on{color:var(--g);border-bottom-color:var(--g)}
.kpis.k6{grid-template-columns:repeat(3,1fr)}
.delta{display:block;font-size:12px;margin-top:4px}.delta.up{color:#7fe0a0}.delta.down{color:#f08a8a}.delta.flat{color:var(--mut)}
.tl{position:relative;margin-left:8px;padding-left:22px;border-left:2px solid rgba(255,176,1,.35)}
.tlw{position:relative;margin-bottom:26px}.tlw::before{content:'';position:absolute;left:-30px;top:6px;width:14px;height:14px;border-radius:50%;background:var(--g);box-shadow:0 0 0 4px #000}
.tlh{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline}.tlh h3{margin:0}
.tot{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px}.tot span{background:var(--c2);border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:12px}
.tot b{color:var(--g)}
.tle{background:var(--c2);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:grid;grid-template-columns:150px 1fr auto;gap:12px;align-items:start}
.tle .cat{color:var(--g);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.charts{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.chart{background:var(--c2);border:1px solid var(--line);border-radius:12px;padding:14px}
.chart h3{font-size:20px}.chart svg{width:100%;height:auto;display:block}
.callouts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}
.co{background:var(--c2);border:1px solid var(--line);border-left:3px solid var(--g);border-radius:10px;padding:12px}
.co small{color:var(--mut);display:block;font-size:12px}.co b{font-family:'Bebas Neue',sans-serif;font-weight:400;font-size:30px;line-height:1.1}
.note{font-size:13px;color:var(--mut)}
@media(max-width:760px){.kpis.k6{grid-template-columns:1fr 1fr}.charts{grid-template-columns:1fr}.callouts{grid-template-columns:1fr 1fr}
 .tle{grid-template-columns:1fr}.tl{padding-left:16px}.tlw::before{left:-24px}}
`;

export function tabsBar(base, tab) {
  const t = (k, l) => `<a class="${tab === k ? 'on' : ''}" href="${base}${base.includes('?') ? '&' : '?'}tab=${k}">${l}</a>`;
  return `<nav class="tabs">${t('progress', 'Progress')}${t('overview', 'Overview')}${t('worklog', 'Work log')}${t('trends', 'Trends')}</nav>`;
}

function deltaTag(cur, prev, suf = '', lowerIsBetter = false) {
  if (cur == null || prev == null) return '';
  const d = Math.round((cur - prev) * 10) / 10;
  if (d === 0) return `<span class="delta flat">No change</span>`;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return `<span class="delta ${good ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}${suf}</span>`;
}

// Outcomes KPIs (latest week vs previous week), shown next to mention/citation rate
export function outcomesKpis(esc, v) {
  const o = v.outcomes; const last = o[o.length - 1], prev = o[o.length - 2];
  const cell = (k, label) => `<div class="kpi"><b>${last ? nz(last[k]) : '—'}</b><span>${label}${last ? ` · week of ${esc(last.week)}` : ''}</span>${last && prev ? deltaTag(last[k], prev[k]) : ''}</div>`;
  return cell('ai_sessions', 'AI-referral sessions') + (SHOW_CLIENT_LEADS ? cell('demos', 'Demos') + cell('leads', 'Leads') : '');
}

export function outcomesTable(esc, v) {
  if (!v.outcomes.length) return '<p class="muted">No outcome data yet. Weekly AI-referral traffic, demos and leads will appear here.</p>';
  const rows = [...v.outcomes].reverse().map((r) => {
    let br = ''; try { const j = JSON.parse(r.ai_breakdown || '{}'); br = Object.entries(j).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k)} ${n}`).join(' · '); } catch (e) {}
    return `<tr><td data-l="Week">${esc(fmtWeek(r.week))}</td><td data-l="AI sessions">${nz(r.ai_sessions)}</td><td data-l="By source">${br || '—'}</td>${SHOW_CLIENT_LEADS ? `<td data-l="Demos">${nz(r.demos)}</td><td data-l="Leads">${nz(r.leads)}</td>` : ''}<td data-l="Source"><span class="pill">${esc(r.source)}</span></td></tr>`;
  }).join('');
  return `<div class="scroll"><table class="tbl stack"><thead><tr><th>Week</th><th>AI-referral sessions</th><th>By source</th>${SHOW_CLIENT_LEADS ? '<th>Demos</th><th>Leads</th>' : ''}<th>Source</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="note">AI-referral sessions = visits referred by AI assistants (chatgpt.com, perplexity.ai, gemini.google.com, copilot.microsoft.com, claude.ai and similar).</p>`;
}

export function worklogView(esc, v) {
  if (!v.worklog.length) return '<section class="card"><h2>Work log</h2><p class="muted">No work logged yet.</p></section>';
  const weeks = {};
  for (const e of v.worklog) (weeks[e.week] = weeks[e.week] || []).push(e);
  const body = Object.keys(weeks).sort().reverse().map((w) => {
    const es = weeks[w]; const tot = {};
    for (const e of es) tot[e.category] = (tot[e.category] || 0) + (e.qty ?? 1);
    return `<div class="tlw"><div class="tlh"><h3>Week of ${esc(fmtWeek(w))}</h3><span class="muted">${es.length} ${es.length === 1 ? 'entry' : 'entries'}</span></div>
      <div class="tot">${Object.entries(tot).map(([c, n]) => `<span>${esc(c)}: <b>${n}</b></span>`).join('')}</div>
      ${es.map((e) => `<div class="tle"><div class="cat">${esc(e.category)}${e.qty != null ? ` · ${e.qty}` : ''}</div>
        <div>${esc(e.description)}${e.link ? ` <a href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">Link ↗</a>` : ''}</div>
        <div><span class="pill ${e.status === 'Done' ? 'yes' : e.status === 'Blocked' ? 'no' : ''}">${esc(e.status)}</span></div></div>`).join('')}</div>`;
  }).join('');
  return `<section class="card"><div class="eb">What we did</div><h2>Work log</h2><p class="muted">Everything Octaloop did for you, week by week. Weekly totals add up the counts per category.</p><div class="tl">${body}</div></section>`;
}

function svgChart(esc, pts, suf = '') {
  const W = 560, H = 190, L = 40, R = 14, T = 14, B = 30;
  const vals = pts.filter((p) => p.y != null);
  if (vals.length === 0) return '<p class="muted">No data yet.</p>';
  const dataMax = Math.max(...vals.map((p) => p.y), 0);
  const isPct = suf === '%';
  const raw = Math.max(isPct ? 5 : 1, dataMax) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) || 10 * mag;
  if (!isPct) step = Math.max(1, Math.ceil(step));
  else step = Math.max(5, Math.round(step));
  const max = Math.max(isPct ? step : 1, Math.ceil(dataMax / step) * step || step);
  const ticks = []; for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  const n = pts.length, x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1)), y = (v) => T + (H - T - B) * (1 - v / max);
  const line = pts.map((p, i) => p.y == null ? null : `${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).filter(Boolean).join(' ');
  const grid = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="rgba(255,255,255,.08)"/><text x="${L - 6}" y="${y(t) + 4}" fill="rgba(255,255,255,.5)" font-size="11" text-anchor="end">${t}${suf}</text>`).join('');
  const dots = pts.map((p, i) => p.y == null ? '' : `<circle cx="${x(i)}" cy="${y(p.y)}" r="${p.base ? 6 : 4}" fill="${p.base ? '#000' : '#ffb001'}" stroke="#ffb001" stroke-width="2"><title>${esc(p.x)}: ${p.y}${suf}${p.base ? ' (Day 0)' : ''}</title></circle>`).join('');
  const lab = (i) => `<text x="${x(i)}" y="${H - 8}" fill="rgba(255,255,255,.55)" font-size="11" text-anchor="${i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}">${esc(pts[i].x.slice(5))}${pts[i].base ? ' · Day 0' : ''}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="trend chart">${grid}<polyline fill="none" stroke="#ffb001" stroke-width="2.5" points="${line}"/>${dots}${lab(0)}${n > 1 ? lab(n - 1) : ''}</svg>`;
}

export function trendsView(esc, v) {
  const sn = v.snapshots, oc = v.outcomes;
  const base = sn.find((s) => s.is_baseline) || sn[0];
  const latest = sn[sn.length - 1];
  const baseWeek = base ? base.week : '';
  const latestOc = oc[oc.length - 1];
  const now = {
    mention_rate: latest?.mention_rate, citation_rate: latest?.citation_rate, placements: latest?.placements, avg_position: latest?.avg_position,
    ai_sessions: latestOc?.ai_sessions ?? latest?.ai_sessions, leads: latestOc?.leads ?? latest?.leads,
  };
  const co = (label, k, suf = '', lower = false) => {
    const b = base ? base[k] : null, c = now[k];
    return `<div class="co"><small>${label}</small><b>${nz(b, suf)} → ${nz(c, suf)}</b>${deltaTag(c, b, suf === '%' ? ' pts' : suf, lower)}</div>`;
  };
  const series = (k) => sn.map((s) => ({ x: s.week, y: s[k], base: s.week === baseWeek }));
  const oseries = (k) => {
    const weeks = [...new Set([...oc.map((o) => o.week), ...(base && base[k] != null ? [base.week] : [])])].sort();
    return weeks.map((w) => { const o = oc.find((x) => x.week === w); const val = o && o[k] != null ? o[k] : (w === baseWeek && base ? base[k] : null); return { x: w, y: val, base: w === baseWeek }; });
  };
  if (!sn.length && !oc.length) return '<section class="card"><h2>Trends</h2><p class="muted">No baseline or weekly snapshots yet.</p></section>';
  return `<section class="card"><div class="eb">Progress</div><h2>Day 0 vs now</h2>
    <p class="muted">${base ? `Day 0 baseline: week of ${esc(fmtWeek(base.week))}.` : 'No baseline set yet.'} ${latest ? `Latest snapshot: week of ${esc(fmtWeek(latest.week))}.` : ''}</p>
    <div class="callouts">${co('Mention rate', 'mention_rate', '%')}${co('Citation rate', 'citation_rate', '%')}${co('PR placements live', 'placements')}${co('AI-referral sessions / wk', 'ai_sessions')}${SHOW_CLIENT_LEADS ? co('Leads / wk', 'leads') : ''}</div>
    ${base && base.avg_position != null ? `<p class="note">Average answer position: ${nz(base.avg_position)} at Day 0 → ${nz(now.avg_position)} now (lower is better).</p>` : ''}
    <div class="charts">
      <div class="chart"><h3>Mention rate</h3>${svgChart(esc, series('mention_rate'), '%')}</div>
      <div class="chart"><h3>Citation rate</h3>${svgChart(esc, series('citation_rate'), '%')}</div>
      <div class="chart"><h3>PR placements live</h3>${svgChart(esc, series('placements'))}</div>
      <div class="chart"><h3>AI-referral sessions / week</h3>${svgChart(esc, oseries('ai_sessions'))}</div>
      ${SHOW_CLIENT_LEADS ? `<div class="chart"><h3>Leads / week</h3>${svgChart(esc, oseries('leads'))}</div>
      <div class="chart"><h3>Demos / week</h3>${svgChart(esc, oseries('demos'))}</div>` : ''}
    </div></section>`;
}

// ---------- admin UI ----------
export function adminV2Sections(esc, C, P, v, env, selSnap) {
  const opt = (arr, cur) => arr.map((s) => `<option${s === cur ? ' selected' : ''}>${esc(s)}</option>`).join('');
  const wlRows = v.worklog.map((e) => `<tr><td><form method="post" action="${P}/worklog/${e.id}" class="grid">${C}
    <div><label>Week (any date)</label><input name="week" type="date" value="${esc(e.week)}" required></div>
    <div><label>Category</label><select name="category">${opt(WL_CATEGORIES, e.category)}</select></div>
    <div style="grid-column:span 2"><label>Description</label><input name="description" value="${esc(e.description)}" required maxlength="500"></div>
    <div><label>Count</label><input name="qty" inputmode="numeric" value="${e.qty ?? ''}"></div>
    <div><label>Link</label><input name="link" value="${esc(e.link)}" maxlength="500"></div>
    <div><label>Status</label><select name="status">${opt(WL_STATUSES, e.status)}</select></div>
    <div class="inline"><button class="sm" name="op" value="save">Save</button><button class="sm danger" name="op" value="delete">Delete</button></div></form></td></tr>`).join('');
  const ocRows = [...v.outcomes].reverse().map((o) => `<tr><td><form method="post" action="${P}/outcomes/${o.id}" class="grid">${C}
    <div><label>Week</label><input name="week" type="date" value="${esc(o.week)}" required></div>
    <div><label>AI-referral sessions</label><input name="ai_sessions" inputmode="numeric" value="${o.ai_sessions ?? ''}"></div>
    <div><label>Demos</label><input name="demos" inputmode="numeric" value="${o.demos ?? ''}"></div>
    <div><label>Leads</label><input name="leads" inputmode="numeric" value="${o.leads ?? ''}"></div>
    <div><label>Source</label><input value="${esc(o.source)}" disabled></div>
    <div class="inline"><button class="sm" name="op" value="save">Save</button><button class="sm danger" name="op" value="delete">Delete</button></div></form></td></tr>`).join('');
  const snRows = [...v.snapshots].reverse().map((s) => `<tr><td><form method="post" action="${P}/snapshots/${s.id}" class="grid">${C}
    <div><label>Week</label><input name="week" type="date" value="${esc(s.week)}" required></div>
    <div><label>Mention rate %</label><input name="mention_rate" value="${s.mention_rate ?? ''}"></div>
    <div><label>Citation rate %</label><input name="citation_rate" value="${s.citation_rate ?? ''}"></div>
    <div><label>Avg position</label><input name="avg_position" value="${s.avg_position ?? ''}"></div>
    <div><label>Placements live</label><input name="placements" value="${s.placements ?? ''}"></div>
    <div><label>AI sessions</label><input name="ai_sessions" value="${s.ai_sessions ?? ''}"></div>
    <div><label>Demos</label><input name="demos" value="${s.demos ?? ''}"></div>
    <div><label>Leads</label><input name="leads" value="${s.leads ?? ''}"></div>
    <div><label><input type="checkbox" name="is_baseline" value="1" style="width:auto"${s.is_baseline ? ' checked' : ''}> Day 0 baseline</label></div>
    <div class="inline"><button class="sm" name="op" value="save">Save</button><button class="sm danger" name="op" value="delete">Delete</button></div></form></td></tr>`).join('');
  const st = v.settings || {};
  const ga = ga4Configured(env);
  return `
  <section class="card"><h2>Work log</h2>
   <h3>Add entry</h3><form method="post" action="${P}/worklog" class="grid">${C}
    <div><label>Week (any date in it)</label><input name="week" type="date" required></div>
    <div><label>Category</label><select name="category">${opt(WL_CATEGORIES, 'Pitches sent')}</select></div>
    <div style="grid-column:span 2"><label>Description</label><input name="description" required maxlength="500"></div>
    <div><label>Count (optional)</label><input name="qty" inputmode="numeric"></div><div><label>Link (optional)</label><input name="link" maxlength="500"></div>
    <div><label>Status</label><select name="status">${opt(WL_STATUSES, 'Done')}</select></div><div><button>Add</button></div></form>
   <details style="margin:16px 0"><summary>Import CSV</summary><form method="post" action="${P}/worklog/import" enctype="multipart/form-data" class="grid" style="margin-top:10px">${C}
    <div style="grid-column:span 2"><label>CSV columns: week, category, description, count, link, status</label><input type="file" name="file" accept=".csv,text/csv" required></div><div><button>Import</button></div></form></details>
   <div class="scroll"><table class="tbl"><tbody>${wlRows || '<tr><td class="muted">No entries yet.</td></tr>'}</tbody></table></div></section>

  <section class="card"><h2>Outcomes (weekly)</h2>
   <p class="note">AI-referral sessions, demos and leads per week. Saving a week that already exists updates it.</p>
   <form method="post" action="${P}/outcomes" class="grid">${C}
    <div><label>Week (any date in it)</label><input name="week" type="date" required></div><div><label>AI-referral sessions</label><input name="ai_sessions" inputmode="numeric"></div>
    <div><label>Demos</label><input name="demos" inputmode="numeric"></div><div><label>Leads</label><input name="leads" inputmode="numeric"></div><div><button>Save week</button></div></form>
   <details style="margin:16px 0"><summary>Import CSV</summary><form method="post" action="${P}/outcomes/import" enctype="multipart/form-data" class="grid" style="margin-top:10px">${C}
    <div style="grid-column:span 2"><label>CSV columns: week, ai_sessions, demos, leads</label><input type="file" name="file" accept=".csv,text/csv" required></div><div><button>Import</button></div></form></details>
   <div class="scroll"><table class="tbl"><tbody>${ocRows || '<tr><td class="muted">No outcomes yet.</td></tr>'}</tbody></table></div>
   <h3 style="margin-top:20px">Google Analytics 4</h3>
   <p class="note">${ga ? `Integration is ON. Ask the client to add <b>${esc(ga4ServiceEmail(env))}</b> as a Viewer on their GA4 property.` : 'Integration is OFF: the GA4 service-account key (secret GA4_SA_KEY) is not set yet. You can still save the property ID now.'}
   ${st.ga4_last_sync ? `<br>Last sync: ${esc(st.ga4_last_sync)}` : ''}${st.ga4_last_error ? `<br><span style="color:#f08a8a">Last error: ${esc(st.ga4_last_error)}</span>` : ''}</p>
   <form method="post" action="${P}/ga4" class="grid">${C}
    <div><label>GA4 property ID (numbers only)</label><input name="ga4_property_id" value="${esc(st.ga4_property_id || '')}" inputmode="numeric" maxlength="20"></div>
    <div><label>Key events counted as leads (comma-separated; blank = all key events)</label><input name="ga4_lead_events" value="${esc(st.ga4_lead_events || '')}" maxlength="300"></div>
    <div><label>Key events counted as demos (comma-separated)</label><input name="ga4_demo_events" value="${esc(st.ga4_demo_events || '')}" maxlength="300"></div>
    <div><button>Save GA4 settings</button></div></form>
   <form method="post" action="${P}/ga4/sync" class="grid" style="margin-top:10px">${C}
    <div><label>Pull this week from GA4</label><input name="week" type="date" required></div><div><button class="o"${ga && st.ga4_property_id ? '' : ' disabled title="Needs the GA4 key and a property ID"'}>Sync from GA4</button></div></form></section>

  <section class="card"><h2>Trends: baseline and weekly snapshots</h2>
   <h3>Generate snapshot from current AEO + PR data</h3>
   <form method="post" action="${P}/snapshots/generate" class="grid">${C}
    <div><label>Week (any date in it)</label><input name="week" type="date" required></div>
    <div><label><input type="checkbox" name="is_baseline" value="1" style="width:auto"> Mark as Day 0 baseline</label></div><div><button>Generate</button></div></form>
   <p class="note">Takes mention rate, citation rate and positions from the AEO prompts, live placements from PR, and that week's outcomes.</p>
   <details style="margin:12px 0"><summary>Add or set a snapshot manually</summary><form method="post" action="${P}/snapshots" class="grid" style="margin-top:10px">${C}
    <div><label>Week</label><input name="week" type="date" required></div><div><label>Mention rate %</label><input name="mention_rate"></div><div><label>Citation rate %</label><input name="citation_rate"></div>
    <div><label>Avg position</label><input name="avg_position"></div><div><label>Placements live</label><input name="placements"></div><div><label>AI sessions</label><input name="ai_sessions"></div>
    <div><label>Demos</label><input name="demos"></div><div><label>Leads</label><input name="leads"></div>
    <div><label><input type="checkbox" name="is_baseline" value="1" style="width:auto"> Day 0 baseline</label></div><div><button>Save snapshot</button></div></form></details>
   <div class="scroll"><table class="tbl"><tbody>${snRows || '<tr><td class="muted">No snapshots yet.</td></tr>'}</tbody></table></div></section>
  ${adminPromptsEditor(esc, C, P, v, v.prompts || {}, selSnap)}`;
}

// ---------- admin POST ----------
export async function adminV2Post(env, sess, cid, kind, sub, form, h, parts = []) {
  const db = env.PORTAL_DB; const { P, flashTo, parseCSV, safeUrl, audit } = h;
  if (kind === 'sp' && /^\d+$/.test(sub || '')) return adminPromptsPost(env, sess, cid, sub, parts[4], parts[5], form, h);
  const wlVals = (f) => [weekOf(f.get('week')), WL_CATEGORIES.includes(String(f.get('category'))) ? String(f.get('category')) : 'Other',
    String(f.get('description') || '').trim().slice(0, 500), optInt(f.get('qty') ?? f.get('count')), safeUrl(f.get('link')),
    WL_STATUSES.includes(String(f.get('status'))) ? String(f.get('status')) : 'Done'];
  const ocUpsert = (week, ai, demos, leads, source) => db.prepare(`INSERT INTO outcomes (client_id, week, ai_sessions, demos, leads, source) VALUES (?,?,?,?,?,?)
     ON CONFLICT(client_id, week) DO UPDATE SET ai_sessions=excluded.ai_sessions, demos=excluded.demos, leads=excluded.leads, source=excluded.source, updated_at=datetime('now')`).bind(cid, week, ai, demos, leads, source);
  const snVals = (f) => [optNum(f.get('mention_rate')), optNum(f.get('citation_rate')), optNum(f.get('avg_position')), optInt(f.get('placements')),
    optInt(f.get('ai_sessions')), optInt(f.get('demos')), optInt(f.get('leads')), f.get('is_baseline') ? 1 : 0];
  const clearBase = () => db.prepare('UPDATE snapshots SET is_baseline = 0 WHERE client_id = ?').bind(cid).run();

  if (kind === 'worklog') {
    if (sub === 'import') {
      const rows = await csvRows(form, parseCSV); if (!rows) return flashTo(P, 'Error: choose a CSV under 2 MB.');
      const st = []; for (const r of rows) { const v = wlVals({ get: (k) => r[k] }); if (v[0] && v[2]) st.push(db.prepare('INSERT INTO worklog (client_id, week, category, description, qty, link, status) VALUES (?,?,?,?,?,?,?)').bind(cid, ...v)); }
      for (let i = 0; i < st.length; i += 50) await db.batch(st.slice(i, i + 50));
      await audit(env, sess, 'worklog_import', `${cid}:${st.length}`); return flashTo(P, `Imported ${st.length} work log entries.`);
    }
    if (!sub) { const v = wlVals(form); if (!v[0] || !v[2]) return flashTo(P, 'Error: week and description required.');
      await db.prepare('INSERT INTO worklog (client_id, week, category, description, qty, link, status) VALUES (?,?,?,?,?,?,?)').bind(cid, ...v).run(); return flashTo(P, 'Work log entry added.'); }
    if (/^\d+$/.test(sub)) {
      if (form.get('op') === 'delete') { await db.prepare('DELETE FROM worklog WHERE id = ? AND client_id = ?').bind(+sub, cid).run(); return flashTo(P, 'Entry deleted.'); }
      const v = wlVals(form); if (!v[0] || !v[2]) return flashTo(P, 'Error: week and description required.');
      await db.prepare('UPDATE worklog SET week=?, category=?, description=?, qty=?, link=?, status=? WHERE id = ? AND client_id = ?').bind(...v, +sub, cid).run(); return flashTo(P, 'Entry saved.');
    }
  }
  if (kind === 'outcomes') {
    if (sub === 'import') {
      const rows = await csvRows(form, parseCSV); if (!rows) return flashTo(P, 'Error: choose a CSV under 2 MB.');
      const st = []; for (const r of rows) { const w = weekOf(r.week); if (w) st.push(ocUpsert(w, optInt(r.ai_sessions), optInt(r.demos), optInt(r.leads), 'csv')); }
      for (let i = 0; i < st.length; i += 50) await db.batch(st.slice(i, i + 50));
      await audit(env, sess, 'outcomes_import', `${cid}:${st.length}`); return flashTo(P, `Imported ${st.length} weeks of outcomes.`);
    }
    if (!sub) { const w = weekOf(form.get('week')); if (!w) return flashTo(P, 'Error: week required.');
      await ocUpsert(w, optInt(form.get('ai_sessions')), optInt(form.get('demos')), optInt(form.get('leads')), 'manual').run(); return flashTo(P, `Outcomes saved for week of ${w}.`); }
    if (/^\d+$/.test(sub)) {
      if (form.get('op') === 'delete') { await db.prepare('DELETE FROM outcomes WHERE id = ? AND client_id = ?').bind(+sub, cid).run(); return flashTo(P, 'Outcome week deleted.'); }
      const w = weekOf(form.get('week')); if (!w) return flashTo(P, 'Error: week required.');
      try { await db.prepare("UPDATE outcomes SET week=?, ai_sessions=?, demos=?, leads=?, source='manual', updated_at=datetime('now') WHERE id = ? AND client_id = ?").bind(w, optInt(form.get('ai_sessions')), optInt(form.get('demos')), optInt(form.get('leads')), +sub, cid).run(); }
      catch (e) { return flashTo(P, 'Error: another row already uses that week.'); }
      return flashTo(P, 'Outcome week saved.');
    }
  }
  if (kind === 'ga4') {
    if (!sub) {
      const pid = String(form.get('ga4_property_id') || '').trim();
      if (pid && !/^\d{4,20}$/.test(pid)) return flashTo(P, 'Error: GA4 property ID must be digits only.');
      const clean = (s) => String(s || '').split(',').map((x) => x.trim()).filter((x) => /^[\w-]{1,40}$/.test(x)).slice(0, 10).join(',');
      await db.prepare(`INSERT INTO client_settings (client_id, ga4_property_id, ga4_lead_events, ga4_demo_events) VALUES (?,?,?,?)
        ON CONFLICT(client_id) DO UPDATE SET ga4_property_id=excluded.ga4_property_id, ga4_lead_events=excluded.ga4_lead_events, ga4_demo_events=excluded.ga4_demo_events`)
        .bind(cid, pid, clean(form.get('ga4_lead_events')), clean(form.get('ga4_demo_events'))).run();
      await audit(env, sess, 'ga4_settings', `${cid}`); return flashTo(P, 'GA4 settings saved.');
    }
    if (sub === 'sync') {
      const w = weekOf(form.get('week')); if (!w) return flashTo(P, 'Error: week required.');
      if (!ga4Configured(env)) return flashTo(P, 'Error: GA4 integration is not switched on yet (GA4_SA_KEY secret missing).');
      const r = await ga4SyncWeek(env, cid, w);
      await audit(env, sess, 'ga4_sync', `${cid}:${w}:${r.ok ? 'ok' : r.error}`);
      return flashTo(P, r.ok ? `Synced week of ${w} from GA4: ${r.ai_sessions} AI-referral sessions, ${r.leads ?? '—'} leads.` : `Error: GA4 sync failed: ${r.error}`);
    }
  }
  if (kind === 'snapshots') {
    if (sub === 'generate') {
      const w = weekOf(form.get('week')); if (!w) return flashTo(P, 'Error: week required.');
      const aeo = (await db.prepare('SELECT prompt, engine, mentioned, cited, position FROM aeo_prompts WHERE client_id = ?').bind(cid).all()).results || [];
      const live = await db.prepare("SELECT COUNT(*) AS n FROM pr_placements WHERE client_id = ? AND status = 'Live'").bind(cid).first();
      const oc = await db.prepare('SELECT * FROM outcomes WHERE client_id = ? AND week = ?').bind(cid, w).first();
      const n = aeo.length, pos = aeo.map((a) => parseFloat(String(a.position))).filter((x) => Number.isFinite(x));
      const mr = n ? Math.round(aeo.filter((a) => a.mentioned).length / n * 1000) / 10 : null, cr = n ? Math.round(aeo.filter((a) => a.cited).length / n * 1000) / 10 : null;
      const ap = pos.length ? Math.round(pos.reduce((a, b) => a + b, 0) / pos.length * 10) / 10 : null;
      const isB = form.get('is_baseline') ? 1 : 0; if (isB) await clearBase();
      await db.prepare(`INSERT INTO snapshots (client_id, week, is_baseline, mention_rate, citation_rate, avg_position, placements, ai_sessions, demos, leads, positions_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(client_id, week) DO UPDATE SET is_baseline=excluded.is_baseline, mention_rate=excluded.mention_rate, citation_rate=excluded.citation_rate,
        avg_position=excluded.avg_position, placements=excluded.placements, ai_sessions=excluded.ai_sessions, demos=excluded.demos, leads=excluded.leads, positions_json=excluded.positions_json`)
        .bind(cid, w, isB, mr, cr, ap, live.n, oc?.ai_sessions ?? null, oc?.demos ?? null, oc?.leads ?? null, JSON.stringify(aeo.map((a) => ({ prompt: a.prompt, engine: a.engine, position: a.position, mentioned: a.mentioned, cited: a.cited })))).run();
      const gs = await db.prepare('SELECT id FROM snapshots WHERE client_id = ? AND week = ?').bind(cid, w).first();
      if (gs) await captureCurrent(db, cid, gs.id);
      if (isB) await db.prepare("INSERT INTO client_settings (client_id, onboarded_on) VALUES (?, ?) ON CONFLICT(client_id) DO UPDATE SET onboarded_on = excluded.onboarded_on").bind(cid, w).run();
      await audit(env, sess, 'snapshot_generate', `${cid}:${w}`); return flashTo(P, `Snapshot generated for week of ${w}${isB ? ' (Day 0 baseline)' : ''}.`);
    }
    if (!sub) { const w = weekOf(form.get('week')); if (!w) return flashTo(P, 'Error: week required.');
      const v = snVals(form); if (v[7]) await clearBase();
      await db.prepare(`INSERT INTO snapshots (client_id, week, mention_rate, citation_rate, avg_position, placements, ai_sessions, demos, leads, is_baseline) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(client_id, week) DO UPDATE SET mention_rate=excluded.mention_rate, citation_rate=excluded.citation_rate, avg_position=excluded.avg_position, placements=excluded.placements,
        ai_sessions=excluded.ai_sessions, demos=excluded.demos, leads=excluded.leads, is_baseline=excluded.is_baseline`).bind(cid, w, ...v).run();
      return flashTo(P, `Snapshot saved for week of ${w}.`); }
    if (/^\d+$/.test(sub)) {
      if (form.get('op') === 'delete') { await db.batch([db.prepare('DELETE FROM snapshot_prompts WHERE snapshot_id = ? AND client_id = ?').bind(+sub, cid), db.prepare('DELETE FROM snapshots WHERE id = ? AND client_id = ?').bind(+sub, cid)]); return flashTo(P, 'Snapshot deleted.'); }
      const w = weekOf(form.get('week')); if (!w) return flashTo(P, 'Error: week required.');
      const v = snVals(form); if (v[7]) await clearBase();
      try { await db.prepare('UPDATE snapshots SET week=?, mention_rate=?, citation_rate=?, avg_position=?, placements=?, ai_sessions=?, demos=?, leads=?, is_baseline=? WHERE id = ? AND client_id = ?').bind(w, ...v, +sub, cid).run(); }
      catch (e) { return flashTo(P, 'Error: another snapshot already uses that week.'); }
      return flashTo(P, 'Snapshot saved.');
    }
  }
  return null;
}
async function csvRows(form, parseCSV) {
  const file = form.get('file');
  if (!file || typeof file === 'string' || file.size > 2 * 1024 * 1024) return null;
  return parseCSV(await file.text()).slice(0, 2000);
}
