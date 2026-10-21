// Portal v3: Progress tab (Day 0 → Week N) and per-question results per snapshot.
const SHOW = { leads: false }; // leads/demos never shown here (see SHOW_CLIENT_LEADS in v2.js)

export async function loadPrompts(env, cid) {
  const r = await env.PORTAL_DB.prepare('SELECT * FROM snapshot_prompts WHERE client_id = ? ORDER BY prompt, engine').bind(cid).all();
  const by = {}; for (const x of r.results || []) (by[x.snapshot_id] = by[x.snapshot_id] || []).push(x);
  return by;
}

// Periods: baseline (Day 0) and every later snapshot, labelled Week N by days since Day 0.
export function periods(v) {
  const sn = v.snapshots || [];
  const base = sn.find((s) => s.is_baseline) || sn[0];
  if (!base) return [];
  const t0 = Date.parse(base.week + 'T00:00:00Z');
  const list = sn.filter((s) => s.week >= base.week).map((s) => {
    const wk = Math.round((Date.parse(s.week + 'T00:00:00Z') - t0) / (7 * 864e5));
    return { snap: s, label: s.id === base.id ? 'Day 0' : `Week ${wk}`, wk };
  });
  return list;
}

export const PROGRESS_CSS = `
.pills{display:flex;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:2px 2px 10px;margin-bottom:12px;scrollbar-width:thin}
.pills a{flex:0 0 auto;padding:8px 16px;border:1px solid rgba(255,176,1,.45);border-radius:999px;text-decoration:none;color:#fff;font-weight:700;font-size:14px;white-space:nowrap}
.pills a.on{background:var(--g);color:#000;border-color:var(--g)}
.pills a small{display:block;font-weight:400;font-size:11px;opacity:.75}
.summary{font-size:19px;line-height:1.5;background:linear-gradient(135deg,rgba(255,176,1,.14),rgba(255,176,1,.03));border:1px solid rgba(255,176,1,.35);border-radius:14px;padding:18px 20px;margin-bottom:18px}
.summary b{color:var(--g)}
.kpis.k5{grid-template-columns:repeat(5,1fr)}.kpi .vs{display:block;font-size:12px;color:var(--mut);margin-top:6px;line-height:1.5}
.kpi .vs em{font-style:normal;font-weight:700}.kpi .vs .up{color:#7fe0a0}.kpi .vs .down{color:#f08a8a}
.newtag{display:inline-block;background:#7fe0a0;color:#000;font-size:11px;font-weight:700;border-radius:4px;padding:1px 6px;margin-left:6px;white-space:nowrap}
.losttag{display:inline-block;background:#3a1515;color:#ffb3b3;font-size:11px;font-weight:700;border-radius:4px;padding:1px 6px;margin-left:6px}
@media(max-width:760px){.kpis.k5{grid-template-columns:1fr 1fr}.summary{font-size:16px}}
`;

const num = (v) => (v === null || v === undefined || Number.isNaN(v)) ? null : v;
function stats(p, prompts, outcomes) {
  const s = p.snap, rows = prompts[s.id] || [];
  const n = rows.length;
  const cited = n ? rows.filter((r) => r.cited).length : null, ment = n ? rows.filter((r) => r.mentioned).length : null;
  const oc = outcomes.find((o) => o.week === s.week);
  return {
    n, cited, ment,
    mention_rate: num(s.mention_rate ?? (n ? Math.round(ment / n * 1000) / 10 : null)),
    citation_rate: num(s.citation_rate ?? (n ? Math.round(cited / n * 1000) / 10 : null)),
    placements: num(s.placements),
    ai_sessions: num(oc && oc.ai_sessions != null ? oc.ai_sessions : s.ai_sessions),
  };
}
const fmt = (v, suf = '') => v == null ? '—' : `${Math.round(v * 10) / 10}${suf}`;
function vs(cur, ref, label, suf) {
  if (cur == null || ref == null) return `<span>${label}: —</span>`;
  const d = Math.round((cur - ref) * 10) / 10;
  const cls = d > 0 ? 'up' : d < 0 ? 'down' : '';
  return `<span>${label}: <em class="${cls}">${d > 0 ? '+' : ''}${d}${suf}</em></span>`;
}

function summarySentence(cur, base, prev, isBase, label) {
  const parts = [];
  if (cur.n) {
    if (isBase) parts.push(`On Day 0, your site was cited on <b>${cur.cited} of ${cur.n}</b> tracked questions and AI answers mentioned you on <b>${cur.ment} of ${cur.n}</b>.`);
    else {
      parts.push(`Cited on <b>${cur.cited} of ${cur.n}</b> tracked questions in ${label}, ${base.cited == null ? '' : cur.cited > base.cited ? `up from ${base.cited} on Day 0` : cur.cited < base.cited ? `down from ${base.cited} on Day 0` : `the same as Day 0`}.`.replace(', .', '.'));
      parts.push(`Mentioned on <b>${cur.ment} of ${cur.n}</b>${base.ment != null ? ` (Day 0: ${base.ment})` : ''}.`);
    }
  } else if (cur.citation_rate != null) {
    parts.push(`Citation rate ${fmt(cur.citation_rate, '%')}${!isBase && base.citation_rate != null ? ` vs ${fmt(base.citation_rate, '%')} on Day 0` : ''}.`);
  }
  if (cur.ai_sessions != null) parts.push(isBase ? `AI-referral visits that week: <b>${cur.ai_sessions}</b>.` : `AI-referral visits: <b>${cur.ai_sessions}</b> this week vs ${base.ai_sessions ?? '—'} on Day 0${prev && prev.ai_sessions != null ? ` and ${prev.ai_sessions} the week before` : ''}.`);
  if (cur.placements != null && !isBase) parts.push(`PR placements live: <b>${cur.placements}</b> (Day 0: ${base.placements ?? '—'}).`);
  return parts.join(' ') || 'No results recorded for this period yet.';
}

export function progressView(esc, v, prompts, base, sel) {
  const ps = periods(v);
  if (!ps.length) return '<section class="card"><h2>Progress</h2><p class="muted">Your Day 0 baseline hasn\'t been recorded yet. Progress will show here week by week once it is.</p></section>';
  let i = ps.findIndex((p) => p.label.replace(' ', '').toLowerCase() === String(sel || '').toLowerCase());
  if (i < 0) i = ps.length - 1;
  const p = ps[i], isBase = i === 0;
  const cur = stats(p, prompts, v.outcomes), b0 = stats(ps[0], prompts, v.outcomes), pr = i > 0 ? stats(ps[i - 1], prompts, v.outcomes) : null;
  const link = (q) => `${base}${base.includes('?') ? '&' : '?'}tab=progress&p=${q.label.replace(' ', '').toLowerCase()}`;
  const pills = `<nav class="pills" aria-label="Choose period">${ps.map((q, j) => `<a class="${j === i ? 'on' : ''}" href="${link(q)}">${q.label}<small>${esc(q.snap.week.slice(5).replace('-', '/'))}</small></a>`).join('')}</nav>`;
  const card = (label, k, suf = '') => `<div class="kpi"><b>${fmt(cur[k], suf)}</b><span>${label}</span>${isBase ? '<span class="vs">Day 0 baseline</span>' : `<span class="vs">${vs(cur[k], b0[k], 'vs Day 0', suf === '%' ? ' pts' : '')}<br>${vs(cur[k], pr ? pr[k] : null, 'vs last week', suf === '%' ? ' pts' : '')}</span>`}</div>`;
  const rows = prompts[p.snap.id] || [];
  const prevRows = i > 0 ? (prompts[ps[i - 1].snap.id] || []) : [];
  const prevMap = Object.fromEntries(prevRows.map((r) => [r.prompt + '|' + r.engine, r]));
  const tr = rows.map((r) => {
    const pv = prevMap[r.prompt + '|' + r.engine];
    const newC = !isBase && r.cited && !(pv && pv.cited), newM = !isBase && r.mentioned && !(pv && pv.mentioned);
    const lost = !isBase && pv && pv.cited && !r.cited;
    return `<tr><td data-l="Question">${esc(r.prompt)}</td><td data-l="Engine">${esc(r.engine) || '—'}</td>
      <td data-l="Mentioned"><span class="pill ${r.mentioned ? 'yes' : 'no'}">${r.mentioned ? 'Yes' : 'No'}</span>${newM && !newC ? '<span class="newtag">New this week</span>' : ''}</td>
      <td data-l="Cited"><span class="pill ${r.cited ? 'yes' : 'no'}">${r.cited ? 'Yes' : 'No'}</span>${newC ? '<span class="newtag">New this week</span>' : ''}${lost ? '<span class="losttag">Lost</span>' : ''}</td>
      <td data-l="Position">${esc(r.position) || '—'}</td>
      <td data-l="Cited page">${r.cited_url ? `<a href="${esc(r.cited_url)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : '—'}</td></tr>`;
  }).join('');
  const wl = (v.worklog || []).filter((e) => e.week === p.snap.week);
  return `${pills}
  <div class="summary">${summarySentence(cur, b0, pr, isBase, p.label)}</div>
  <div class="kpis k5">${card('Mention rate', 'mention_rate', '%')}${card('Citation rate', 'citation_rate', '%')}${card('Questions cited', 'cited')}${card('PR placements live', 'placements')}${card('AI-referral sessions', 'ai_sessions')}</div>
  <section class="card"><h2>${p.label}: question by question</h2><p class="muted">Each question we track, as AI engines answered it ${isBase ? 'on Day 0' : `in ${p.label}`}. “New this week” = first time cited or mentioned compared with the week before.</p>
   ${rows.length ? `<div class="scroll"><table class="tbl stack"><thead><tr><th>Question</th><th>Engine</th><th>Mentioned</th><th>Cited</th><th>Position</th><th>Cited page</th></tr></thead><tbody>${tr}</tbody></table></div>` : '<p class="muted">No per-question results recorded for this period.</p>'}</section>
  <section class="card"><h2>What we did ${isBase ? 'in the Day 0 week' : `in ${p.label}`}</h2>
   ${wl.length ? wl.map((e) => `<div class="tle"><div class="cat">${esc(e.category)}${e.qty != null ? ` · ${e.qty}` : ''}</div><div>${esc(e.description)}${e.link ? ` <a href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">Link ↗</a>` : ''}</div><div><span class="pill ${e.status === 'Done' ? 'yes' : e.status === 'Blocked' ? 'no' : ''}">${esc(e.status)}</span></div></div>`).join('') : '<p class="muted">No work logged for this week.</p>'}</section>`;
}

// ---------- admin per-week editor ----------
export function adminPromptsEditor(esc, C, P, v, prompts, selId) {
  const ps = periods(v);
  const all = v.snapshots || [];
  if (!all.length) return `<section class="card" id="perq"><h2>Per-question results by week</h2><p class="muted">Create a Day 0 baseline snapshot first (use “Generate snapshot” above).</p></section>`;
  const sel = all.find((s) => String(s.id) === String(selId)) || all[all.length - 1];
  const label = (s) => (ps.find((p) => p.snap.id === s.id) || {}).label || 'Before Day 0';
  const rows = prompts[sel.id] || [];
  const yn = (n, v) => `<select name="${n}"><option value="1"${v ? ' selected' : ''}>Yes</option><option value="0"${!v ? ' selected' : ''}>No</option></select>`;
  const R = `${P}/sp/${sel.id}`;
  return `<section class="card" id="perq"><h2>Per-question results by week</h2>
   <nav class="pills">${all.map((s) => `<a class="${s.id === sel.id ? 'on' : ''}" href="${P}?snap=${s.id}#perq">${label(s)}<small>${esc(s.week)}</small></a>`).join('')}</nav>
   <p class="note">Editing <b>${label(sel)}</b> (week of ${esc(sel.week)}): ${rows.length} questions, ${rows.filter((r) => r.cited).length} cited, ${rows.filter((r) => r.mentioned).length} mentioned.
   After editing, press “Recalculate rates” so the week's mention and citation rates match these rows.</p>
   <div class="scroll"><table class="tbl"><tbody>${rows.map((r) => `<tr><td><form method="post" action="${R}/row/${r.id}" class="grid">${C}
     <div style="grid-column:span 2"><label>Question</label><input name="prompt" value="${esc(r.prompt)}" required maxlength="500"></div>
     <div><label>Engine</label><input name="engine" value="${esc(r.engine)}" maxlength="60"></div>
     <div><label>Mentioned</label>${yn('mentioned', r.mentioned)}</div><div><label>Cited</label>${yn('cited', r.cited)}</div>
     <div><label>Position</label><input name="position" value="${esc(r.position)}" maxlength="40"></div>
     <div><label>Cited page</label><input name="cited_url" value="${esc(r.cited_url)}" maxlength="500"></div>
     <div class="inline"><button class="sm" name="op" value="save">Save</button><button class="sm danger" name="op" value="delete">Delete</button></div></form></td></tr>`).join('') || '<tr><td class="muted">No rows for this week.</td></tr>'}</tbody></table></div>
   <h3 style="margin-top:16px">Add a question result</h3><form method="post" action="${R}/add" class="grid">${C}
     <div style="grid-column:span 2"><label>Question</label><input name="prompt" required maxlength="500"></div><div><label>Engine</label><input name="engine" maxlength="60"></div>
     <div><label>Mentioned</label>${yn('mentioned', 0)}</div><div><label>Cited</label>${yn('cited', 0)}</div><div><label>Position</label><input name="position" maxlength="40"></div>
     <div><label>Cited page</label><input name="cited_url" maxlength="500"></div><div><button>Add</button></div></form>
   <div class="inline" style="margin-top:14px">
    <form method="post" action="${R}/import" enctype="multipart/form-data" class="inline">${C}<label style="margin:0">CSV (prompt, engine, mentioned, cited, position, cited_url) — replaces this week's rows</label><input type="file" name="file" accept=".csv,text/csv" required style="width:auto"><button class="sm">Import CSV</button></form>
    <form method="post" action="${R}/recalc">${C}<button class="sm o">Recalculate rates from these rows</button></form>
    <form method="post" action="${R}/copyprev">${C}<button class="sm o">Copy rows from previous week</button></form></div></section>`;
}

const yes = (v) => /^(1|y|yes|true)$/i.test(String(v || '').trim()) ? 1 : 0;
export async function adminPromptsPost(env, sess, cid, sid, op, rowId, form, h) {
  const db = env.PORTAL_DB, { P, parseCSV, safeUrl, audit } = h;
  const back = (msg) => new Response(null, { status: 303, headers: { location: `${P}?snap=${sid}&m=${encodeURIComponent(msg)}#perq`, 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  const snap = await db.prepare('SELECT * FROM snapshots WHERE id = ? AND client_id = ?').bind(+sid, cid).first();
  if (!snap) return null;
  const vals = (f) => [String(f.get('prompt') || '').trim().slice(0, 500), String(f.get('engine') || '').trim().slice(0, 60), yes(f.get('mentioned')), yes(f.get('cited')),
    String(f.get('position') || '').trim().slice(0, 40), safeUrl(f.get('cited_url'))];
  const ins = (v) => db.prepare(`INSERT INTO snapshot_prompts (snapshot_id, client_id, prompt, engine, mentioned, cited, position, cited_url) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(snapshot_id, prompt, engine) DO UPDATE SET mentioned=excluded.mentioned, cited=excluded.cited, position=excluded.position, cited_url=excluded.cited_url`).bind(snap.id, cid, ...v);
  if (op === 'add') { const v = vals(form); if (!v[0]) return back('Error: question required.'); await ins(v).run(); return back('Question result added.'); }
  if (op === 'row' && /^\d+$/.test(rowId || '')) {
    if (form.get('op') === 'delete') { await db.prepare('DELETE FROM snapshot_prompts WHERE id = ? AND snapshot_id = ? AND client_id = ?').bind(+rowId, snap.id, cid).run(); return back('Row deleted.'); }
    const v = vals(form); if (!v[0]) return back('Error: question required.');
    try { await db.prepare('UPDATE snapshot_prompts SET prompt=?, engine=?, mentioned=?, cited=?, position=?, cited_url=? WHERE id = ? AND snapshot_id = ? AND client_id = ?').bind(...v, +rowId, snap.id, cid).run(); }
    catch (e) { return back('Error: that question + engine already exists this week.'); }
    return back('Row saved.');
  }
  if (op === 'import') {
    const file = form.get('file');
    if (!file || typeof file === 'string' || file.size > 2 * 1024 * 1024) return back('Error: choose a CSV under 2 MB.');
    const rows = parseCSV(await file.text()).slice(0, 1000);
    const st = [db.prepare('DELETE FROM snapshot_prompts WHERE snapshot_id = ? AND client_id = ?').bind(snap.id, cid)];
    for (const r of rows) { const v = vals({ get: (k) => r[k] ?? (k === 'prompt' ? r.question : undefined) }); if (v[0]) st.push(ins(v)); }
    for (let i = 0; i < st.length; i += 50) await db.batch(st.slice(i, i + 50));
    await audit(env, sess, 'sp_import', `${cid}:${snap.id}:${st.length - 1}`); return back(`Imported ${st.length - 1} question results.`);
  }
  if (op === 'copyprev') {
    const prev = await db.prepare('SELECT id FROM snapshots WHERE client_id = ? AND week < ? ORDER BY week DESC LIMIT 1').bind(cid, snap.week).first();
    if (!prev) return back('Error: no earlier week to copy from.');
    await db.prepare(`INSERT OR IGNORE INTO snapshot_prompts (snapshot_id, client_id, prompt, engine, mentioned, cited, position, cited_url)
      SELECT ?, client_id, prompt, engine, mentioned, cited, position, cited_url FROM snapshot_prompts WHERE snapshot_id = ? AND client_id = ?`).bind(snap.id, prev.id, cid).run();
    return back('Copied rows from the previous week (existing rows kept).');
  }
  if (op === 'recalc') { await recalc(db, snap.id); return back('Rates recalculated from the question rows.'); }
  return null;
}
export async function recalc(db, sid) {
  const rows = (await db.prepare('SELECT mentioned, cited, position FROM snapshot_prompts WHERE snapshot_id = ?').bind(sid).all()).results || [];
  const n = rows.length; if (!n) return;
  const pos = rows.map((r) => parseFloat(r.position)).filter(Number.isFinite);
  await db.prepare('UPDATE snapshots SET mention_rate = ?, citation_rate = ?, avg_position = ? WHERE id = ?').bind(
    Math.round(rows.filter((r) => r.mentioned).length / n * 1000) / 10, Math.round(rows.filter((r) => r.cited).length / n * 1000) / 10,
    pos.length ? Math.round(pos.reduce((a, b) => a + b, 0) / pos.length * 10) / 10 : null, sid).run();
}
// Called by "Generate snapshot": copy current AEO prompts into the snapshot's per-question rows.
export async function captureCurrent(db, cid, sid) {
  await db.batch([
    db.prepare('DELETE FROM snapshot_prompts WHERE snapshot_id = ? AND client_id = ?').bind(sid, cid),
    db.prepare(`INSERT OR IGNORE INTO snapshot_prompts (snapshot_id, client_id, prompt, engine, mentioned, cited, position, cited_url)
      SELECT ?, client_id, prompt, engine, mentioned, cited, position, cited_url FROM aeo_prompts WHERE client_id = ?`).bind(sid, cid),
  ]);
}
