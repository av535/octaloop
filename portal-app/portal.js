// Octaloop client portal — Cloudflare Worker module (D1 for data, KV for report files)
// Mounted at /portal/ by worker.js. Requires env.PORTAL_DB (D1) and env.PORTAL_FILES (KV).

import { SHOW_CLIENT_LEADS, loadV2, V2_CSS, tabsBar, outcomesKpis, outcomesTable, worklogView, trendsView, adminV2Sections, adminV2Post } from './v2.js';

const BASE = '/portal';
const SESSION_COOKIE = '__Host-octaloop_portal';
const SESSION_TTL = 12 * 60 * 60; // seconds
const MAX_FILE = 25 * 1024 * 1024; // 25 MB (KV value limit)
const PBKDF2_ITER = 100000;
const RL_WINDOW = 15 * 60; // seconds
const RL_MAX_EMAIL = 5;
const RL_MAX_IP = 20;
const ALLOWED_TYPES = {
  pdf: 'application/pdf', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', zip: 'application/zip', txt: 'text/plain',
};
const PR_STATUSES = ['Pitched', 'Accepted', 'Scheduled', 'Live', 'Declined'];

// ---------- helpers ----------
const enc = new TextEncoder();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const randToken = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const now = () => Math.floor(Date.now() / 1000);
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export async function hashPassword(pw, saltBytes) {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(bits)}`;
}
async function verifyPassword(pw, stored) {
  const [alg, iter, salt, hash] = String(stored).split('$');
  if (alg !== 'pbkdf2' || Number(iter) !== PBKDF2_ITER) return false;
  const again = await hashPassword(pw, unb64(salt));
  return safeEqual(again.split('$')[3], hash);
}
const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function secHeaders(h = {}) {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow, noarchive',
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    ...h,
  };
}
const html = (body, status = 200, h = {}) => new Response(body, { status, headers: secHeaders(h) });
const redirect = (to, h = {}) => new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...h } });
const notFound = () => html(page('Not found', '<section class="card"><h1>Not found</h1><p>This page doesn\'t exist or you don\'t have access to it.</p><p><a class="btn" href="/portal/">Back to the portal</a></p></section>'), 404);
const forbidden = () => html(page('Forbidden', '<section class="card"><h1>Access denied</h1><p>You don\'t have access to this page.</p></section>'), 403);

function getCookie(req, name) {
  const c = req.headers.get('cookie') || '';
  for (const part of c.split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return v.join('='); }
  return null;
}
async function audit(env, user, action, detail = '') {
  try { await env.PORTAL_DB.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?,?,?)').bind(user ? user.id : null, action, String(detail).slice(0, 500)).run(); } catch (e) {}
}

// ---------- session ----------
async function loadSession(req, env) {
  const tok = getCookie(req, SESSION_COOKIE);
  if (!tok || tok.length > 100) return null;
  const th = await sha256hex(tok);
  const row = await env.PORTAL_DB.prepare(
    `SELECT s.token_hash, s.csrf, s.expires_at, u.id, u.email, u.name, u.role, u.client_id, u.active AS u_active,
            c.name AS client_name, c.active AS c_active, c.is_demo
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN clients c ON c.id = u.client_id
      WHERE s.token_hash = ?`).bind(th).first();
  if (!row) return null;
  if (row.expires_at < now() || !row.u_active || (row.role === 'client' && !row.c_active)) {
    await env.PORTAL_DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(th).run();
    return null;
  }
  return row;
}
function sameOrigin(req) {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  if (origin) return origin === url.origin;
  const ref = req.headers.get('referer');
  if (ref) { try { return new URL(ref).origin === url.origin; } catch (e) { return false; } }
  return false;
}
async function checkCsrf(req, sess, form) {
  if (!sameOrigin(req)) return false;
  return safeEqual(String(form.get('csrf') || ''), sess.csrf);
}
const csrfField = (sess) => `<input type="hidden" name="csrf" value="${esc(sess.csrf)}">`;

// ---------- layout ----------
function page(title, body, sess = null, opts = {}) {
  const nav = sess ? `<nav class="pnav">
      ${sess.role === 'admin' ? `<a href="${BASE}/admin/">All clients</a>` : `<a href="${BASE}/dashboard/">Dashboard</a>`}
      <span class="who">${esc(sess.email)}</span>
      <form method="post" action="${BASE}/logout">${csrfField(sess)}<button class="link">Log out</button></form>
    </nav>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} | Octaloop Client Portal</title>
<link rel="icon" href="/assets/images/wp-content/uploads/2023/09/cropped-Favicon-150x150.png">
<style>
@font-face{font-family:'Bebas Neue';src:url(/assets/fonts/BebasNeue-Regular.woff2) format('woff2');font-display:swap}
@font-face{font-family:'Open Sans';src:url(/assets/fonts/OpenSans-Regular.woff2) format('woff2');font-display:swap}
@font-face{font-family:'Open Sans';font-weight:700;src:url(/assets/fonts/OpenSans-Bold.woff2) format('woff2');font-display:swap}
:root{--g:#ffb001;--bg:#000;--c1:#0e0e0e;--c2:#161616;--line:rgba(255,255,255,.1);--mut:rgba(255,255,255,.6)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#fff;font-family:'Open Sans',sans-serif;font-size:15px;line-height:1.5}
a{color:var(--g)}h1,h2,h3{font-family:'Bebas Neue',sans-serif;font-weight:400;letter-spacing:.02em;margin:0 0 10px}
h1{font-size:44px;line-height:1}h2{font-size:30px}h3{font-size:22px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 24px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.top img{height:30px;display:block}.brand{display:flex;align-items:center;gap:12px;text-decoration:none}.brand span{color:var(--mut);font-size:12px;letter-spacing:.18em;text-transform:uppercase}
.pnav{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.pnav a{text-decoration:none;font-weight:700}.who{color:var(--mut);font-size:13px}
.wrap{max-width:1160px;margin:0 auto;padding:28px 20px 60px}
.card{background:var(--c1);border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:20px}
.eb{color:var(--g);font-size:12px;letter-spacing:.2em;text-transform:uppercase;font-weight:700}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0 22px}
.kpi{background:var(--c2);border:1px solid var(--line);border-top:3px solid var(--g);border-radius:12px;padding:16px}
.kpi b{display:block;font-family:'Bebas Neue',sans-serif;font-size:44px;line-height:1;font-weight:400}.kpi span{color:var(--mut);font-size:13px}
.tbl{width:100%;border-collapse:collapse;font-size:14px}.tbl th{text-align:left;color:var(--mut);font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.06em;padding:8px 10px;border-bottom:1px solid var(--line)}
.tbl td{padding:10px;border-bottom:1px solid var(--line);vertical-align:top}.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;background:#222;color:#ddd;white-space:nowrap}
.pill.yes,.pill.Live{background:rgba(255,176,1,.18);color:var(--g)}.pill.no,.pill.Declined{background:#2a1212;color:#f08a8a}.pill.Accepted,.pill.Scheduled{background:#12222a;color:#8fd0f0}
.btn,button{display:inline-block;background:var(--g);color:#000;border:0;border-radius:8px;padding:10px 16px;font-weight:700;font-size:14px;cursor:pointer;text-decoration:none;font-family:inherit}
.btn.o,button.o{background:transparent;color:var(--g);border:1px solid var(--g)}button.link{background:none;color:var(--g);padding:0;font-weight:700}
button.danger{background:#3a1515;color:#ffb3b3}button.sm,.btn.sm{padding:6px 10px;font-size:12px}
input,select,textarea{width:100%;background:#0a0a0a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:10px 12px;font:inherit}
label{display:block;font-size:13px;color:var(--mut);margin:0 0 4px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;align-items:end}
.row-form{display:contents}.muted{color:var(--mut)}.ok{background:rgba(255,176,1,.12);border:1px solid rgba(255,176,1,.4);padding:10px 14px;border-radius:10px;margin-bottom:16px}
.err{background:#2a1212;border:1px solid #6a2a2a;padding:10px 14px;border-radius:10px;margin-bottom:16px;color:#ffc4c4}
.demo{background:var(--g);color:#000;text-align:center;font-weight:700;font-size:13px;padding:6px}
.admin-bar{background:#1d1600;border-bottom:1px solid rgba(255,176,1,.4);padding:8px 24px;font-size:13px}
.login{max-width:420px;margin:60px auto}.inline{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
details summary{cursor:pointer;color:var(--g);font-weight:700}
@media(max-width:760px){h1{font-size:34px}.kpis{grid-template-columns:1fr 1fr}.wrap{padding:20px 14px 50px}.top{padding:12px 14px}
 .tbl.stack thead{display:none}.tbl.stack tr{display:block;border-bottom:1px solid var(--line);padding:8px 0}.tbl.stack td{display:flex;justify-content:space-between;gap:12px;border:0;padding:4px 2px}
 .tbl.stack td::before{content:attr(data-l);color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.05em;flex:0 0 40%}}
${V2_CSS}</style></head><body>
${opts.demo ? '<div class="demo">DEMO DATA — this is a sample client for testing, not a real customer</div>' : ''}
<header class="top"><a class="brand" href="${BASE}/"><img src="/assets/images/wp-content/themes/octaloop/assets/images/Logo-white.png" alt="Octaloop"><span>Client portal</span></a>${nav}</header>
${opts.adminBar || ''}
<main class="wrap">${opts.flash ? `<div class="${opts.flash.startsWith('Error') ? 'err' : 'ok'}">${esc(opts.flash)}</div>` : ''}${body}</main></body></html>`;
}

// ---------- CSV ----------
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const clean = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!clean.length) return [];
  const head = clean[0].map((h) => h.trim().toLowerCase());
  return clean.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
const yes = (v) => /^(1|y|yes|true)$/i.test(String(v || '').trim()) ? 1 : 0;
const safeUrl = (u) => { u = String(u || '').trim(); if (!u) return ''; try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch (e) { return ''; } };

// ---------- data ----------
async function clientData(env, cid) {
  const [aeo, pr, reps] = await Promise.all([
    env.PORTAL_DB.prepare('SELECT * FROM aeo_prompts WHERE client_id = ? ORDER BY checked_on DESC, id DESC').bind(cid).all(),
    env.PORTAL_DB.prepare('SELECT * FROM pr_placements WHERE client_id = ? ORDER BY pub_date DESC, id DESC').bind(cid).all(),
    env.PORTAL_DB.prepare('SELECT id, filename, size, uploaded_at FROM reports WHERE client_id = ? ORDER BY uploaded_at DESC, id DESC').bind(cid).all(),
  ]);
  return { aeo: aeo.results || [], pr: pr.results || [], reports: reps.results || [] };
}
const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

function dashboardBody(client, d, v, tab, base) {
  const total = d.aeo.length, men = d.aeo.filter((r) => r.mentioned).length, cit = d.aeo.filter((r) => r.cited).length;
  const live = d.pr.filter((r) => r.status === 'Live').length;
  const pct = (a) => total ? Math.round((a / total) * 100) + '%' : '—';
  const aeoRows = d.aeo.map((r) => `<tr><td data-l="Prompt">${esc(r.prompt)}</td><td data-l="Engine">${esc(r.engine)}</td>
    <td data-l="Mentioned"><span class="pill ${r.mentioned ? 'yes' : 'no'}">${r.mentioned ? 'Yes' : 'No'}</span></td>
    <td data-l="Cited"><span class="pill ${r.cited ? 'yes' : 'no'}">${r.cited ? 'Yes' : 'No'}</span></td>
    <td data-l="Position">${esc(r.position) || '—'}</td>
    <td data-l="Cited page">${r.cited_url ? `<a href="${esc(r.cited_url)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : '—'}</td>
    <td data-l="Checked">${esc(r.checked_on) || '—'}</td></tr>`).join('');
  const prRows = d.pr.map((r) => `<tr><td data-l="Publication"><b>${esc(r.publication)}</b></td><td data-l="Title">${esc(r.title) || '—'}</td>
    <td data-l="Date">${esc(r.pub_date) || '—'}</td><td data-l="Status"><span class="pill ${esc(r.status)}">${esc(r.status)}</span></td>
    <td data-l="Article">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Read ↗</a>` : '—'}</td></tr>`).join('');
  const repRows = d.reports.map((r) => `<tr><td data-l="Report">${esc(r.filename)}</td><td data-l="Size">${fmtSize(r.size)}</td><td data-l="Uploaded">${esc(String(r.uploaded_at).slice(0, 10))}</td>
    <td data-l=""><a class="btn sm" href="${BASE}/reports/${r.id}/download">Download</a></td></tr>`).join('');
  const head = `<div class="eb">Client dashboard</div><h1>${esc(client.name)}</h1>${tabsBar(base, tab)}`;
  if (tab === 'worklog') return head + worklogView(esc, v);
  if (tab === 'trends') return head + trendsView(esc, v);
  return head + `<div class="kpis k6"><div class="kpi"><b>${pct(men)}</b><span>Mention rate in AI answers</span></div><div class="kpi"><b>${pct(cit)}</b><span>Citation rate (your site linked)</span></div>
  ${outcomesKpis(esc, v)}</div>
  <p class="note" style="margin-top:-8px">${total} tracked prompts · ${live} PR placements live</p>
  <section class="card"><h2>AEO: AI answer visibility</h2><p class="muted">Whether AI engines name you (mentioned) and link your site (cited) for the buyer prompts we track.</p>
  ${total ? `<div class="scroll"><table class="tbl stack"><thead><tr><th>Prompt</th><th>Engine</th><th>Mentioned</th><th>Cited</th><th>Position</th><th>Cited page</th><th>Checked</th></tr></thead><tbody>${aeoRows}</tbody></table></div>` : '<p class="muted">No prompts tracked yet.</p>'}</section>
  <section class="card"><h2>PR: placements</h2>
  ${d.pr.length ? `<div class="scroll"><table class="tbl stack"><thead><tr><th>Publication</th><th>Title</th><th>Date</th><th>Status</th><th>Article</th></tr></thead><tbody>${prRows}</tbody></table></div>` : '<p class="muted">No placements yet.</p>'}</section>
  <section class="card"><h2>${SHOW_CLIENT_LEADS ? 'Outcomes: AI-referral traffic, demos and leads' : 'Outcomes: AI-referral traffic'}</h2>${outcomesTable(esc, v)}</section>
  <section class="card"><h2>Reports</h2>
  ${d.reports.length ? `<div class="scroll"><table class="tbl stack"><thead><tr><th>Report</th><th>Size</th><th>Uploaded</th><th></th></tr></thead><tbody>${repRows}</tbody></table></div>` : '<p class="muted">No reports uploaded yet.</p>'}</section>`;
}

// ---------- handlers ----------
async function loginPage(req, env, msg = '', status = 200) {
  return html(page('Log in', `<div class="login"><section class="card"><div class="eb">Octaloop</div><h1>Client login</h1>
    <p class="muted">Log in to see your AEO and PR results and download reports.</p>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <form method="post" action="${BASE}/login" autocomplete="on">
      <label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username" maxlength="200">
      <div style="height:12px"></div><label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password" maxlength="200">
      <div style="height:18px"></div><button type="submit" style="width:100%">Log in</button></form>
    <p class="muted" style="font-size:13px;margin-top:16px">No account or forgot your password? Email <a href="mailto:contact@octaloop.com">contact@octaloop.com</a>.</p></section></div>`), status);
}

async function doLogin(req, env) {
  if (!sameOrigin(req)) return loginPage(req, env, 'Please try again.', 403);
  const form = await req.formData();
  const email = String(form.get('email') || '').trim().toLowerCase().slice(0, 200);
  const pw = String(form.get('password') || '').slice(0, 200);
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const t = now(), since = t - RL_WINDOW;
  const db = env.PORTAL_DB;
  const [ec, ic] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE k = ? AND ts > ?').bind('e:' + email, since).first(),
    db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE k = ? AND ts > ?').bind('i:' + ip, since).first(),
  ]);
  if (ec.n >= RL_MAX_EMAIL || ic.n >= RL_MAX_IP) {
    return loginPage(req, env, 'Too many attempts. Please wait 15 minutes and try again.', 429);
  }
  const u = await db.prepare(`SELECT u.*, c.active AS c_active FROM users u LEFT JOIN clients c ON c.id = u.client_id WHERE u.email = ?`).bind(email).first();
  const okPw = await verifyPassword(pw, u ? u.pw_hash : DUMMY_HASH);
  if (!u || !okPw || !u.active || (u.role === 'client' && !u.c_active)) {
    await db.batch([
      db.prepare('INSERT INTO login_attempts (k, ts) VALUES (?, ?)').bind('e:' + email, t),
      db.prepare('INSERT INTO login_attempts (k, ts) VALUES (?, ?)').bind('i:' + ip, t),
      db.prepare('DELETE FROM login_attempts WHERE ts < ?').bind(t - 86400),
    ]);
    await audit(env, null, 'login_failed', email);
    return loginPage(req, env, 'Email or password is incorrect.', 401);
  }
  const tok = randToken(32), th = await sha256hex(tok), csrf = randToken(24);
  await db.batch([
    db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, expires_at, created_at) VALUES (?,?,?,?,?)').bind(th, u.id, csrf, t + SESSION_TTL, t),
    db.prepare('DELETE FROM login_attempts WHERE k = ?').bind('e:' + email),
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(u.id),
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
  ]);
  await audit(env, u, 'login', '');
  return redirect(u.role === 'admin' ? `${BASE}/admin/` : `${BASE}/dashboard/`, {
    'set-cookie': `${SESSION_COOKIE}=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`,
  });
}

async function doLogout(req, env, sess) {
  const form = await req.formData();
  if (sess && await checkCsrf(req, sess, form)) {
    await env.PORTAL_DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(sess.token_hash).run();
  }
  return redirect(`${BASE}/login`, { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
}

async function getClient(env, id) {
  if (!/^\d+$/.test(String(id))) return null;
  return env.PORTAL_DB.prepare('SELECT * FROM clients WHERE id = ?').bind(Number(id)).first();
}

async function viewDashboard(req, env, sess, url) {
  let cid = sess.client_id;
  let adminBar = '';
  if (sess.role === 'admin') {
    cid = url.searchParams.get('client');
    if (!cid) return redirect(`${BASE}/admin/`);
  }
  const client = await getClient(env, cid);
  if (!client) return notFound();
  if (sess.role !== 'admin' && client.id !== sess.client_id) return forbidden();
  if (sess.role === 'admin') adminBar = `<div class="admin-bar">Admin view of <b>${esc(client.name)}</b>'s dashboard (what the client sees). <a href="${BASE}/admin/clients/${client.id}">Manage this client →</a></div>`;
  const d = await clientData(env, client.id);
  const v = await loadV2(env, client.id);
  const tab = ['overview', 'worklog', 'trends'].includes(url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'overview';
  const base = sess.role === 'admin' ? `${BASE}/dashboard/?client=${client.id}` : `${BASE}/dashboard/`;
  return html(page(client.name, dashboardBody(client, d, v, tab, base), sess, { demo: client.is_demo, adminBar }));
}

async function downloadReport(req, env, sess, id) {
  if (!/^\d+$/.test(id)) return notFound();
  const r = await env.PORTAL_DB.prepare('SELECT r.*, c.active AS c_active FROM reports r JOIN clients c ON c.id = r.client_id WHERE r.id = ?').bind(Number(id)).first();
  if (!r) return notFound();
  if (sess.role !== 'admin' && (r.client_id !== sess.client_id || !r.c_active)) return notFound();
  const data = await env.PORTAL_FILES.get(r.kv_key, 'arrayBuffer');
  if (!data) return notFound();
  await audit(env, sess, 'report_download', `${r.id}`);
  const ext = (r.filename.split('.').pop() || '').toLowerCase();
  const fname = r.filename.replace(/[^\w.\- ]+/g, '_');
  return new Response(data, { headers: {
    'content-type': ALLOWED_TYPES[ext] || 'application/octet-stream',
    'content-disposition': `attachment; filename="${fname}"`,
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex',
    'content-security-policy': "default-src 'none'; sandbox",
  } });
}

// ---------- admin ----------
async function adminHome(req, env, sess, flash) {
  const rows = (await env.PORTAL_DB.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM users u WHERE u.client_id = c.id) AS users,
      (SELECT COUNT(*) FROM aeo_prompts a WHERE a.client_id = c.id) AS prompts,
      (SELECT COUNT(*) FROM pr_placements p WHERE p.client_id = c.id) AS placements,
      (SELECT COUNT(*) FROM reports r WHERE r.client_id = c.id) AS reports
    FROM clients c ORDER BY c.active DESC, c.name`).all()).results || [];
  const list = rows.map((c) => `<tr><td data-l="Client"><b>${esc(c.name)}</b> ${c.is_demo ? '<span class="pill">DEMO</span>' : ''}</td>
    <td data-l="Status"><span class="pill ${c.active ? 'yes' : 'no'}">${c.active ? 'Active' : 'Disabled'}</span></td>
    <td data-l="Users">${c.users}</td><td data-l="Prompts">${c.prompts}</td><td data-l="Placements">${c.placements}</td><td data-l="Reports">${c.reports}</td>
    <td data-l=""><span class="inline"><a class="btn sm" href="${BASE}/dashboard/?client=${c.id}">View dashboard</a><a class="btn sm o" href="${BASE}/admin/clients/${c.id}">Manage</a></span></td></tr>`).join('');
  return html(page('Admin', `<div class="eb">Admin</div><h1>All clients</h1>
    <section class="card"><div class="scroll"><table class="tbl stack"><thead><tr><th>Client</th><th>Status</th><th>Users</th><th>Prompts</th><th>Placements</th><th>Reports</th><th></th></tr></thead><tbody>${list || '<tr><td colspan="7" class="muted">No clients yet.</td></tr>'}</tbody></table></div></section>
    <section class="card"><h2>Add a client</h2><form method="post" action="${BASE}/admin/clients">${csrfField(sess)}
      <div class="grid"><div><label>Client name</label><input name="name" required maxlength="120"></div><div><button>Create client</button></div></div></form></section>`, sess, { flash }));
}

async function adminClient(req, env, sess, cid, flash) {
  const client = await getClient(env, cid);
  if (!client) return notFound();
  const d = await clientData(env, client.id);
  const v2 = await loadV2(env, client.id);
  const users = (await env.PORTAL_DB.prepare('SELECT id, email, name, active, last_login FROM users WHERE client_id = ? ORDER BY email').bind(client.id).all()).results || [];
  const C = csrfField(sess), P = `${BASE}/admin/clients/${client.id}`;
  const userRows = users.map((u) => `<tr><td data-l="Email">${esc(u.email)}</td><td data-l="Name">${esc(u.name)}</td>
    <td data-l="Status"><span class="pill ${u.active ? 'yes' : 'no'}">${u.active ? 'Active' : 'Disabled'}</span></td><td data-l="Last login">${esc(u.last_login || '—')}</td>
    <td data-l=""><span class="inline"><form method="post" action="${P}/users/${u.id}/toggle">${C}<button class="sm o">${u.active ? 'Disable' : 'Enable'}</button></form>
    <form method="post" action="${P}/users/${u.id}/password" class="inline">${C}<input name="password" type="password" minlength="12" maxlength="200" placeholder="New password (12+ chars)" style="width:190px" required autocomplete="new-password"><button class="sm o">Set</button></form></span></td></tr>`).join('');
  const sel = (v) => PR_STATUSES.map((s) => `<option${s === v ? ' selected' : ''}>${s}</option>`).join('');
  const aeoRows = d.aeo.map((r) => `<tr><td colspan="8"><form method="post" action="${P}/aeo/${r.id}" class="grid">${C}
    <div style="grid-column:span 2"><label>Prompt</label><input name="prompt" value="${esc(r.prompt)}" required maxlength="500"></div>
    <div><label>Engine</label><input name="engine" value="${esc(r.engine)}" maxlength="60"></div>
    <div><label>Mentioned</label><select name="mentioned"><option value="1"${r.mentioned ? ' selected' : ''}>Yes</option><option value="0"${!r.mentioned ? ' selected' : ''}>No</option></select></div>
    <div><label>Cited</label><select name="cited"><option value="1"${r.cited ? ' selected' : ''}>Yes</option><option value="0"${!r.cited ? ' selected' : ''}>No</option></select></div>
    <div><label>Position</label><input name="position" value="${esc(r.position)}" maxlength="40"></div>
    <div><label>Cited URL</label><input name="cited_url" value="${esc(r.cited_url)}" maxlength="500"></div>
    <div><label>Checked on</label><input name="checked_on" type="date" value="${esc(r.checked_on)}"></div>
    <div class="inline"><button class="sm" name="op" value="save">Save</button><button class="sm danger" name="op" value="delete">Delete</button></div></form></td></tr>`).join('');
  const prRows = d.pr.map((r) => `<tr><td><form method="post" action="${P}/pr/${r.id}" class="grid">${C}
    <div><label>Publication</label><input name="publication" value="${esc(r.publication)}" required maxlength="120"></div>
    <div style="grid-column:span 2"><label>Title</label><input name="title" value="${esc(r.title)}" maxlength="300"></div>
    <div><label>Date</label><input name="pub_date" type="date" value="${esc(r.pub_date)}"></div>
    <div><label>Status</label><select name="status">${sel(r.status)}</select></div>
    <div style="grid-column:span 2"><label>Live article URL</label><input name="url" value="${esc(r.url)}" maxlength="500"></div>
    <div class="inline"><button class="sm" name="op" value="save">Save</button><button class="sm danger" name="op" value="delete">Delete</button></div></form></td></tr>`).join('');
  const repRows = d.reports.map((r) => `<tr><td data-l="File">${esc(r.filename)}</td><td data-l="Size">${fmtSize(r.size)}</td><td data-l="Uploaded">${esc(String(r.uploaded_at).slice(0, 10))}</td>
    <td data-l=""><span class="inline"><a class="btn sm o" href="${BASE}/reports/${r.id}/download">Download</a><form method="post" action="${P}/reports/${r.id}/delete">${C}<button class="sm danger">Delete</button></form></span></td></tr>`).join('');
  const body = `<p><a href="${BASE}/admin/">← All clients</a></p><div class="eb">Manage client</div><h1>${esc(client.name)} ${client.is_demo ? '<span class="pill">DEMO</span>' : ''}</h1>
  <div class="inline" style="margin-bottom:18px"><a class="btn" href="${BASE}/dashboard/?client=${client.id}">View client dashboard</a>
   <form method="post" action="${P}/toggle">${C}<button class="o">${client.active ? 'Disable client' : 'Enable client'}</button></form>
   <span class="pill ${client.active ? 'yes' : 'no'}">${client.active ? 'Active' : 'Disabled — users cannot log in'}</span></div>

  <section class="card"><h2>Users</h2><div class="scroll"><table class="tbl stack"><thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>${userRows || '<tr><td colspan="5" class="muted">No users yet.</td></tr>'}</tbody></table></div>
   <h3 style="margin-top:18px">Add user</h3><form method="post" action="${P}/users" class="grid">${C}
    <div><label>Email</label><input name="email" type="email" required maxlength="200"></div><div><label>Name</label><input name="name" maxlength="120"></div>
    <div><label>Password (12+ chars)</label><input name="password" type="password" minlength="12" maxlength="200" required autocomplete="new-password"></div><div><button>Add user</button></div></form>
   <p class="muted" style="font-size:13px">Share the password with the client privately. They can't reset it themselves yet.</p></section>

  <section class="card"><h2>AEO prompts</h2>
   <h3>Add prompt</h3><form method="post" action="${P}/aeo" class="grid">${C}
    <div style="grid-column:span 2"><label>Prompt</label><input name="prompt" required maxlength="500"></div><div><label>Engine</label><input name="engine" placeholder="ChatGPT" maxlength="60"></div>
    <div><label>Mentioned</label><select name="mentioned"><option value="1">Yes</option><option value="0" selected>No</option></select></div>
    <div><label>Cited</label><select name="cited"><option value="1">Yes</option><option value="0" selected>No</option></select></div>
    <div><label>Position</label><input name="position" maxlength="40" placeholder="e.g. 2 of 5"></div><div><label>Cited URL</label><input name="cited_url" maxlength="500"></div>
    <div><label>Checked on</label><input name="checked_on" type="date"></div><div><button>Add</button></div></form>
   <details style="margin:16px 0"><summary>Import CSV</summary><form method="post" action="${P}/aeo/import" enctype="multipart/form-data" class="grid" style="margin-top:10px">${C}
    <div style="grid-column:span 2"><label>CSV columns: prompt, engine, mentioned, cited, position, cited_url, checked_on, notes</label><input type="file" name="file" accept=".csv,text/csv" required></div><div><button>Import</button></div></form></details>
   <div class="scroll"><table class="tbl"><tbody>${aeoRows || '<tr><td class="muted">No prompts yet.</td></tr>'}</tbody></table></div></section>

  <section class="card"><h2>PR placements</h2>
   <h3>Add placement</h3><form method="post" action="${P}/pr" class="grid">${C}
    <div><label>Publication</label><input name="publication" required maxlength="120"></div><div style="grid-column:span 2"><label>Title</label><input name="title" maxlength="300"></div>
    <div><label>Date</label><input name="pub_date" type="date"></div><div><label>Status</label><select name="status">${sel('Pitched')}</select></div>
    <div style="grid-column:span 2"><label>Live article URL</label><input name="url" maxlength="500"></div><div><button>Add</button></div></form>
   <details style="margin:16px 0"><summary>Import CSV</summary><form method="post" action="${P}/pr/import" enctype="multipart/form-data" class="grid" style="margin-top:10px">${C}
    <div style="grid-column:span 2"><label>CSV columns: publication, title, date, url, status</label><input type="file" name="file" accept=".csv,text/csv" required></div><div><button>Import</button></div></form></details>
   <div class="scroll"><table class="tbl"><tbody>${prRows || '<tr><td class="muted">No placements yet.</td></tr>'}</tbody></table></div></section>

  ${adminV2Sections(esc, C, P, v2, env)}
  <section class="card"><h2>Reports</h2><form method="post" action="${P}/reports" enctype="multipart/form-data" class="grid">${C}
    <div style="grid-column:span 2"><label>File (PDF, XLSX, DOCX, PPTX, CSV, PNG, JPG, ZIP; max 25 MB)</label><input type="file" name="file" required></div><div><button>Upload</button></div></form>
   <div class="scroll" style="margin-top:14px"><table class="tbl stack"><thead><tr><th>File</th><th>Size</th><th>Uploaded</th><th></th></tr></thead><tbody>${repRows || '<tr><td colspan="4" class="muted">No reports yet.</td></tr>'}</tbody></table></div></section>`;
  return html(page(`Manage ${client.name}`, body, sess, { demo: client.is_demo, flash }));
}

const flashTo = (path, msg) => redirect(`${path}?m=${encodeURIComponent(msg)}`);
const aeoVals = (f) => [String(f.get('prompt') || '').trim().slice(0, 500), String(f.get('engine') || '').trim().slice(0, 60), yes(f.get('mentioned')), yes(f.get('cited')),
  String(f.get('position') || '').trim().slice(0, 40), safeUrl(f.get('cited_url')), String(f.get('checked_on') || '').trim().slice(0, 10), String(f.get('notes') || '').trim().slice(0, 500)];
const prVals = (f) => [String(f.get('publication') || '').trim().slice(0, 120), String(f.get('title') || '').trim().slice(0, 300), String(f.get('pub_date') || f.get('date') || '').trim().slice(0, 10),
  safeUrl(f.get('url')), PR_STATUSES.includes(String(f.get('status'))) ? String(f.get('status')) : 'Pitched'];

async function adminPost(req, env, sess, parts) {
  // parts after /admin/ e.g. ['clients'] or ['clients', id, 'users', uid, 'toggle']
  const ct = req.headers.get('content-type') || '';
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_FILE + 1024 * 1024) return flashTo(`${BASE}/admin/`, 'Error: file too large (max 25 MB).');
  const form = await req.formData();
  if (!(await checkCsrf(req, sess, form))) return html(page('Error', '<section class="card"><h1>Session check failed</h1><p>Please go back, reload the page and try again.</p></section>', sess), 403);
  const db = env.PORTAL_DB;
  if (parts.length === 1 && parts[0] === 'clients') {
    const name = String(form.get('name') || '').trim().slice(0, 120);
    if (!name) return flashTo(`${BASE}/admin/`, 'Error: name required.');
    const r = await db.prepare('INSERT INTO clients (name) VALUES (?)').bind(name).run();
    await audit(env, sess, 'client_create', name);
    return flashTo(`${BASE}/admin/clients/${r.meta.last_row_id}`, 'Client created. Add a user so they can log in.');
  }
  if (parts[0] !== 'clients' || !/^\d+$/.test(parts[1] || '')) return notFound();
  const cid = Number(parts[1]);
  const client = await getClient(env, cid);
  if (!client) return notFound();
  const P = `${BASE}/admin/clients/${cid}`;
  const [, , kind, sub, op] = parts;
  if (kind === 'toggle' && !sub) {
    await db.prepare('UPDATE clients SET active = 1 - active WHERE id = ?').bind(cid).run();
    if (client.active) await db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE client_id = ?)').bind(cid).run();
    await audit(env, sess, client.active ? 'client_disable' : 'client_enable', cid);
    return flashTo(P, client.active ? 'Client disabled. Their users are logged out.' : 'Client enabled.');
  }
  if (kind === 'users' && !sub) {
    const email = String(form.get('email') || '').trim().toLowerCase().slice(0, 200), pw = String(form.get('password') || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return flashTo(P, 'Error: valid email required.');
    if (pw.length < 12) return flashTo(P, 'Error: password must be at least 12 characters.');
    const exists = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (exists) return flashTo(P, 'Error: a user with that email already exists.');
    await db.prepare("INSERT INTO users (email, name, pw_hash, role, client_id) VALUES (?,?,?,'client',?)").bind(email, String(form.get('name') || '').trim().slice(0, 120), await hashPassword(pw), cid).run();
    await audit(env, sess, 'user_create', email);
    return flashTo(P, `User ${email} added.`);
  }
  if (kind === 'users' && /^\d+$/.test(sub || '')) {
    const u = await db.prepare("SELECT * FROM users WHERE id = ? AND client_id = ? AND role = 'client'").bind(Number(sub), cid).first();
    if (!u) return notFound();
    if (op === 'toggle') {
      await db.prepare('UPDATE users SET active = 1 - active WHERE id = ?').bind(u.id).run();
      if (u.active) await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run();
      await audit(env, sess, u.active ? 'user_disable' : 'user_enable', u.email);
      return flashTo(P, `User ${u.email} ${u.active ? 'disabled' : 'enabled'}.`);
    }
    if (op === 'password') {
      const pw = String(form.get('password') || '');
      if (pw.length < 12) return flashTo(P, 'Error: password must be at least 12 characters.');
      await db.batch([db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').bind(await hashPassword(pw), u.id), db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id)]);
      await audit(env, sess, 'user_password', u.email);
      return flashTo(P, `Password updated for ${u.email}.`);
    }
    return notFound();
  }
  if (kind === 'aeo' && !sub) {
    const v = aeoVals(form); if (!v[0]) return flashTo(P, 'Error: prompt required.');
    await db.prepare('INSERT INTO aeo_prompts (client_id, prompt, engine, mentioned, cited, position, cited_url, checked_on, notes) VALUES (?,?,?,?,?,?,?,?,?)').bind(cid, ...v).run();
    return flashTo(P, 'Prompt added.');
  }
  if ((kind === 'aeo' || kind === 'pr') && sub === 'import') {
    const file = form.get('file');
    if (!file || typeof file === 'string' || file.size > 2 * 1024 * 1024) return flashTo(P, 'Error: choose a CSV under 2 MB.');
    const rows = parseCSV(await file.text()).slice(0, 2000);
    const stmts = [];
    for (const r of rows) {
      const f = { get: (k) => r[k] };
      if (kind === 'aeo') { const v = aeoVals(f); if (v[0]) stmts.push(db.prepare('INSERT INTO aeo_prompts (client_id, prompt, engine, mentioned, cited, position, cited_url, checked_on, notes) VALUES (?,?,?,?,?,?,?,?,?)').bind(cid, ...v)); }
      else { const v = prVals(f); if (v[0]) stmts.push(db.prepare('INSERT INTO pr_placements (client_id, publication, title, pub_date, url, status) VALUES (?,?,?,?,?,?)').bind(cid, ...v)); }
    }
    for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
    await audit(env, sess, `${kind}_import`, `${cid}:${stmts.length}`);
    return flashTo(P, `Imported ${stmts.length} ${kind === 'aeo' ? 'prompts' : 'placements'}.`);
  }
  if (kind === 'aeo' && /^\d+$/.test(sub || '')) {
    if (form.get('op') === 'delete') { await db.prepare('DELETE FROM aeo_prompts WHERE id = ? AND client_id = ?').bind(Number(sub), cid).run(); return flashTo(P, 'Prompt deleted.'); }
    const v = aeoVals(form); if (!v[0]) return flashTo(P, 'Error: prompt required.');
    await db.prepare('UPDATE aeo_prompts SET prompt=?, engine=?, mentioned=?, cited=?, position=?, cited_url=?, checked_on=?, notes=? WHERE id = ? AND client_id = ?').bind(...v, Number(sub), cid).run();
    return flashTo(P, 'Prompt saved.');
  }
  if (kind === 'pr' && !sub) {
    const v = prVals(form); if (!v[0]) return flashTo(P, 'Error: publication required.');
    await db.prepare('INSERT INTO pr_placements (client_id, publication, title, pub_date, url, status) VALUES (?,?,?,?,?,?)').bind(cid, ...v).run();
    return flashTo(P, 'Placement added.');
  }
  if (kind === 'pr' && /^\d+$/.test(sub || '')) {
    if (form.get('op') === 'delete') { await db.prepare('DELETE FROM pr_placements WHERE id = ? AND client_id = ?').bind(Number(sub), cid).run(); return flashTo(P, 'Placement deleted.'); }
    const v = prVals(form); if (!v[0]) return flashTo(P, 'Error: publication required.');
    await db.prepare('UPDATE pr_placements SET publication=?, title=?, pub_date=?, url=?, status=? WHERE id = ? AND client_id = ?').bind(...v, Number(sub), cid).run();
    return flashTo(P, 'Placement saved.');
  }
  if (['worklog', 'outcomes', 'ga4', 'snapshots'].includes(kind)) {
    const r = await adminV2Post(env, sess, cid, kind, sub, form, { P, flashTo, parseCSV, safeUrl, audit });
    return r || notFound();
  }
  if (kind === 'reports' && !sub) {
    const file = form.get('file');
    if (!file || typeof file === 'string' || !file.size) return flashTo(P, 'Error: choose a file.');
    if (file.size > MAX_FILE) return flashTo(P, 'Error: file too large (max 25 MB).');
    const name = String(file.name || 'report').replace(/[\/\\]/g, '_').slice(0, 150);
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_TYPES[ext]) return flashTo(P, 'Error: file type not allowed.');
    const key = `client/${cid}/${randToken(18)}`;
    await env.PORTAL_FILES.put(key, await file.arrayBuffer(), { metadata: { client_id: cid, filename: name } });
    await db.prepare('INSERT INTO reports (client_id, filename, content_type, size, kv_key, uploaded_by) VALUES (?,?,?,?,?,?)').bind(cid, name, ALLOWED_TYPES[ext], file.size, key, sess.id).run();
    await audit(env, sess, 'report_upload', `${cid}:${name}`);
    return flashTo(P, `Uploaded ${name}.`);
  }
  if (kind === 'reports' && /^\d+$/.test(sub || '') && op === 'delete') {
    const r = await db.prepare('SELECT * FROM reports WHERE id = ? AND client_id = ?').bind(Number(sub), cid).first();
    if (!r) return notFound();
    await env.PORTAL_FILES.delete(r.kv_key);
    await db.prepare('DELETE FROM reports WHERE id = ?').bind(r.id).run();
    await audit(env, sess, 'report_delete', `${cid}:${r.filename}`);
    return flashTo(P, 'Report deleted.');
  }
  return notFound();
}

// ---------- router ----------
export async function handlePortal(request, env) {
  if (!env.PORTAL_DB || !env.PORTAL_FILES) return null; // portal not configured on this host
  const url = new URL(request.url);
  let path = url.pathname.replace(/\/+$/, '') || '/';
  if (!path.startsWith(BASE)) return null;
  path = path.slice(BASE.length) || '/';
  const m = request.method;
  if (m !== 'GET' && m !== 'POST' && m !== 'HEAD') return html('Method not allowed', 405);
  try {
    if (path === '/login') return m === 'POST' ? await doLogin(request, env) : await loginPage(request, env);
    const sess = await loadSession(request, env);
    if (path === '/logout' && m === 'POST') return await doLogout(request, env, sess);
    if (!sess) return redirect(`${BASE}/login`);
    const flash = url.searchParams.get('m') ? url.searchParams.get('m').slice(0, 200) : '';
    if (path === '/') return redirect(sess.role === 'admin' ? `${BASE}/admin/` : `${BASE}/dashboard/`);
    if (path === '/dashboard' && m !== 'POST') return await viewDashboard(request, env, sess, url);
    let mm = path.match(/^\/reports\/(\d+)\/download$/);
    if (mm && m !== 'POST') return await downloadReport(request, env, sess, mm[1]);
    if (path === '/admin' || path.startsWith('/admin/')) {
      if (sess.role !== 'admin') return notFound();
      const parts = path.split('/').filter(Boolean).slice(1);
      if (m === 'POST') return await adminPost(request, env, sess, parts);
      if (!parts.length) return await adminHome(request, env, sess, flash);
      if (parts[0] === 'clients' && /^\d+$/.test(parts[1] || '') && parts.length === 2) return await adminClient(request, env, sess, parts[1], flash);
      return notFound();
    }
    return notFound();
  } catch (e) {
    console.error('portal error', e && e.stack || e);
    return html(page('Error', '<section class="card"><h1>Something went wrong</h1><p>Please try again.</p></section>'), 500);
  }
}
