// Admin: question sets (upload / edit / activate), teams, settings.
import { connect, ensurePin, esc } from './net.js';

const $ = id => document.getElementById(id);
const pin = await ensurePin();
const H = extra => ({ 'x-pin': pin, ...extra });
let S = null;
let teamsDraft = null;
let cfgLoaded = false;

const net = connect('admin', {
  pin,
  onState: s => {
    const first = !S;
    S = s;
    $('phase').textContent = s.phase === 'lobby' ? 'In lobby' : 'Game in progress';
    if (first || !teamsDraft) { teamsDraft = s.teams.map(t => ({ ...t })); renderTeams(); }
    if (!cfgLoaded) { loadCfg(s); cfgLoaded = true; }
    refreshSets();
  },
  onError: m => toast(m),
});

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 3500);
}

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: H(opts.headers) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

// ---------------------------------------------------------------------------
// Sets

let lastSetsKey = '';
async function refreshSets(force) {
  const { sets, active } = await api('/api/sets');
  const key = JSON.stringify([sets, active]);
  if (key === lastSetsKey && !force) return;
  lastSetsKey = key;
  $('sets').innerHTML = sets.map(s => `
    <tr>
      <td><b>${esc(s.name)}</b>${s.name === active ? '<span class="badge">IN USE</span>' : ''}<br>
        <span class="hint">${new Date(s.mtime).toLocaleString()}</span></td>
      <td style="text-align:right;white-space:nowrap">
        ${s.name === active ? '' : `<button class="btn small" data-act="use" data-n="${esc(s.name)}">Use</button>`}
        <button class="btn small ghost" data-act="edit" data-n="${esc(s.name)}">Edit</button>
        <a class="btn small ghost" href="/api/sets/${encodeURIComponent(s.name)}/download?pin=${encodeURIComponent(pin)}">CSV</a>
        <button class="btn small ghost danger" data-act="del" data-n="${esc(s.name)}">✕</button>
      </td>
    </tr>`).join('') || '<tr><td class="hint">No question sets yet — upload a CSV.</td></tr>';
}

async function useSet(name) {
  if (S.phase !== 'lobby' && !confirm('A game is in progress. Switching sets resets the game to the lobby. Continue?')) return;
  try { await api(`/api/sets/${encodeURIComponent(name)}/activate`, { method: 'POST' }); toast(`Now using “${name}”`); refreshSets(true); }
  catch (e) { toast(e.message); }
}

async function uploadFile(file) {
  const text = await file.text();
  let name = prompt('Name for this question set:', file.name.replace(/\.csv$/i, ''));
  if (!name) return;
  try {
    const r = await api(`/api/sets/${encodeURIComponent(name)}`, { method: 'PUT', body: text, headers: { 'Content-Type': 'text/csv' } });
    refreshSets(true);
    if (r.errors.length) { toast(`Saved with ${r.errors.length} error(s) — opening the editor.`); openEditor(r.name); }
    else if (confirm(`Uploaded “${r.name}”${r.warnings.length ? ` (${r.warnings.length} warning(s))` : ''}. Use it for the game now?`)) useSet(r.name);
  } catch (e) { toast(e.message); }
}

$('file').onchange = e => { if (e.target.files[0]) uploadFile(e.target.files[0]); e.target.value = ''; };
const drop = $('drop');
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]); };

$('newSet').onclick = async () => {
  const name = prompt('Name for the new set:');
  if (!name) return;
  const set = { rounds: { 1: { categories: [] }, 2: { categories: [] } }, final: { category: '', clue: '', answer: '' } };
  for (const r of ['1', '2']) for (let c = 0; c < 6; c++) {
    set.rounds[r].categories.push({ name: `Category ${c + 1}`, clues: Array.from({ length: 5 }, () => ({ clue: '', answer: '', value: null, dd: false })) });
  }
  ed = { name, set, tab: '1' };
  $('editor').classList.remove('hidden');
  renderEditor();
  $('editor').scrollIntoView({ behavior: 'smooth' });
};

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const n = b.dataset.n;
  if (b.dataset.act === 'use') useSet(n);
  if (b.dataset.act === 'edit') openEditor(n);
  if (b.dataset.act === 'del' && confirm(`Delete “${n}”? This removes the CSV file.`)) {
    try { await api(`/api/sets/${encodeURIComponent(n)}`, { method: 'DELETE' }); refreshSets(true); } catch (err) { toast(err.message); }
  }
});

// ---------------------------------------------------------------------------
// Editor

let ed = null; // { name, set, tab }

async function openEditor(name) {
  try {
    const r = await api(`/api/sets/${encodeURIComponent(name)}`);
    ed = { name: r.name, set: r.set, tab: '1' };
    if (!ed.set.final) ed.set.final = { category: '', clue: '', answer: '' };
    $('editor').classList.remove('hidden');
    renderEditor();
    showMsgs(r.errors, r.warnings);
    $('editor').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { toast(e.message); }
}

function renderEditor() {
  $('edName').textContent = ed.name;
  $('tabs').innerHTML = [['1', 'Round 1'], ['2', 'Round 2 (Double)'], ['final', 'Final']]
    .map(([k, l]) => `<button class="${ed.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('');
  const body = $('edBody');
  if (ed.tab === 'final') {
    const f = ed.set.final;
    body.innerHTML = `<div class="cat-ed">
      <label class="f">Category <input type="text" data-f="category" value="${esc(f.category)}"></label><br>
      <label class="f">Clue <textarea data-f="clue" rows="3" style="font-size:16px;padding:8px;border-radius:8px;background:#050729;color:var(--cream)">${esc(f.clue)}</textarea></label><br>
      <label class="f">Answer <input type="text" data-f="answer" value="${esc(f.answer)}"></label></div>`;
    return;
  }
  const cats = ed.set.rounds[ed.tab].categories;
  const defaults = ed.tab === '1' ? [200, 400, 600, 800, 1000] : [400, 800, 1200, 1600, 2000];
  body.innerHTML = cats.map((cat, ci) => `
    <div class="cat-ed">
      <div class="hd">
        <input type="text" data-c="${ci}" data-k="name" value="${esc(cat.name)}" placeholder="Category name" style="flex:1">
        <button class="btn small ghost" data-cmd="addClue" data-c="${ci}">+ clue</button>
        <button class="btn small ghost danger" data-cmd="delCat" data-c="${ci}">Remove</button>
      </div>
      <div class="clue-ed clue-head"><div>Value</div><div>Clue</div><div class="ans">Answer</div><div>DD</div><div></div></div>
      ${cat.clues.map((cl, ri) => `
        <div class="clue-ed">
          <input type="number" data-c="${ci}" data-r="${ri}" data-k="value" value="${cl.value ?? ''}" placeholder="${defaults[ri] ?? ''}">
          <textarea data-c="${ci}" data-r="${ri}" data-k="clue" rows="1" placeholder="Clue">${esc(cl.clue)}</textarea>
          <input class="ans" type="text" data-c="${ci}" data-r="${ri}" data-k="answer" value="${esc(cl.answer)}" placeholder="Answer">
          <label class="dd"><input type="checkbox" data-c="${ci}" data-r="${ri}" data-k="dd" ${cl.dd ? 'checked' : ''}></label>
          <button class="btn small ghost danger" data-cmd="delClue" data-c="${ci}" data-r="${ri}">✕</button>
        </div>`).join('')}
    </div>`).join('') + `<button class="btn small ghost" data-cmd="addCat">+ Add category</button>
    <p class="hint">Leave Value blank to use the standard value for that row. Tick DD only if you want to choose Daily Doubles yourself.</p>`;
}

$('editor').addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.f) { ed.set.final[el.dataset.f] = el.value; return; }
  const ci = el.dataset.c, ri = el.dataset.r, k = el.dataset.k;
  if (ci == null || !k) return;
  const cat = ed.set.rounds[ed.tab].categories[+ci];
  if (k === 'name') { cat.name = el.value; return; }
  const clue = cat.clues[+ri];
  if (k === 'dd') clue.dd = el.checked;
  else if (k === 'value') clue.value = el.value === '' ? null : Number(el.value);
  else clue[k] = el.value;
});

$('editor').addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (t) { ed.tab = t.dataset.tab; renderEditor(); return; }
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  const cats = ed.set.rounds[ed.tab]?.categories;
  const ci = +b.dataset.c;
  if (b.dataset.cmd === 'addCat') cats.push({ name: '', clues: Array.from({ length: 5 }, () => ({ clue: '', answer: '', value: null, dd: false })) });
  if (b.dataset.cmd === 'delCat' && confirm('Remove this category?')) cats.splice(ci, 1);
  if (b.dataset.cmd === 'addClue') cats[ci].clues.push({ clue: '', answer: '', value: null, dd: false });
  if (b.dataset.cmd === 'delClue') cats[ci].clues.splice(+b.dataset.r, 1);
  renderEditor();
});

function cleanSet(set) {
  // Drop completely empty clues/categories so they don't trip validation.
  const out = structuredClone(set);
  for (const r of ['1', '2']) {
    out.rounds[r].categories = out.rounds[r].categories
      .map(c => ({ ...c, clues: c.clues.filter(cl => cl.clue.trim() || cl.answer.trim()) }))
      .filter(c => c.name.trim() || c.clues.length);
  }
  if (out.final && !out.final.clue.trim() && !out.final.category.trim()) out.final = null;
  return out;
}

async function saveEditor(andUse) {
  try {
    const r = await api(`/api/sets/${encodeURIComponent(ed.name)}`, {
      method: 'PUT', body: JSON.stringify({ set: cleanSet(ed.set) }), headers: { 'Content-Type': 'application/json' },
    });
    showMsgs(r.errors, r.warnings);
    refreshSets(true);
    if (r.errors.length) { toast('Saved, but fix the errors before using it.'); return; }
    toast('Saved ✓');
    if (andUse) useSet(r.name);
  } catch (e) { toast(e.message); }
}
$('edSave').onclick = () => saveEditor(false);
$('edSaveLoad').onclick = () => saveEditor(true);
$('edClose').onclick = () => { $('editor').classList.add('hidden'); ed = null; };

function showMsgs(errors = [], warnings = []) {
  $('edMsgs').innerHTML = errors.map(m => `<div class="e">✗ ${esc(m)}</div>`).join('') + warnings.map(m => `<div class="w">⚠ ${esc(m)}</div>`).join('');
}

// ---------------------------------------------------------------------------
// Teams

const COLORS = ['#F5B82E', '#FF7A1A', '#D6246E', '#3FD0C9', '#8BD450', '#B784F5'];
function renderTeams() {
  $('teamRows').innerHTML = teamsDraft.map((t, i) => `
    <div class="team-row">
      <input type="color" data-i="${i}" data-k="color" value="${t.color}">
      <input type="text" data-i="${i}" data-k="name" value="${esc(t.name)}" maxlength="24">
      <button class="btn small ghost danger" data-del="${i}">✕</button>
    </div>`).join('');
}
$('teamRows').addEventListener('input', e => { const i = e.target.dataset.i; if (i != null) teamsDraft[+i][e.target.dataset.k] = e.target.value; });
$('teamRows').addEventListener('click', e => {
  const d = e.target.dataset.del;
  if (d != null) { if (teamsDraft.length <= 1) return toast('Need at least one team.'); teamsDraft.splice(+d, 1); renderTeams(); }
});
$('addTeam').onclick = () => {
  if (teamsDraft.length >= 6) return toast('Max 6 teams.');
  teamsDraft.push({ name: `Team ${teamsDraft.length + 1}`, color: COLORS[teamsDraft.length % COLORS.length] });
  renderTeams();
};
$('saveTeams').onclick = () => {
  net.send({ type: 'setTeams', teams: teamsDraft.map(t => ({ id: t.id, name: t.name.trim() || 'Team', color: t.color })) });
  teamsDraft = null;
  toast('Teams saved ✓');
};

// ---------------------------------------------------------------------------
// Settings

function loadCfg(s) {
  $('cfgTitle').value = s.title;
  $('cfgDD').value = s.config.ddLabel;
  $('cfgFinal').value = s.config.finalLabel;
  $('cfgR1').value = s.config.roundLabels?.[1] ?? 'ROUND ONE';
  $('cfgR2').value = s.config.roundLabels?.[2] ?? 'DOUBLE ROUND';
  $('cfgAns').value = s.config.answerSeconds;
  $('cfgFinalSec').value = s.config.finalSeconds;
  $('cfgDD1').value = s.config.ddCount?.[1] ?? 1;
  $('cfgDD2').value = s.config.ddCount?.[2] ?? 2;
}
$('saveCfg').onclick = () => {
  net.send({
    type: 'setMeta', patch: {
      title: $('cfgTitle').value,
      config: {
        ddLabel: $('cfgDD').value, finalLabel: $('cfgFinal').value,
        roundLabels: { 1: $('cfgR1').value, 2: $('cfgR2').value },
        answerSeconds: $('cfgAns').value, finalSeconds: $('cfgFinalSec').value,
        ddCount: { 1: $('cfgDD1').value, 2: $('cfgDD2').value },
      },
    },
  });
  toast('Settings saved ✓');
};
