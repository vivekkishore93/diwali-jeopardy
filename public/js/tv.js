// TV display: renders the authoritative state and plays animations/sounds on events.
import { connect, esc, money } from './net.js';
import { initAudio, play, stopAll, setMuted, isMuted } from './audio.js';
import { fitStage, zoomFrom, fitText, sleep, shuffle, countTo, createParticles } from './fx.js';
import { loadFontOverrides, DIYA_SVG } from './assets.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
fitStage(stage);
const fx = createParticles($('fx'));
loadFontOverrides();

let S = null;              // latest state
let lastEventId = null;
let boardKey = '';
let fillPending = false;   // tiles stay dark until the fill-in animation runs
let busy = Promise.resolve();
const shownScores = new Map();
let timesUpKey = null;
let fireworksTimer = null;

const net = connect('tv', {
  onState: s => { busy = busy.then(() => onState(s)).catch(e => console.error(e)); },
  onStatus: ok => $('conn').classList.toggle('hidden', ok),
});

// ---------------------------------------------------------------------------
// Start overlay: a click is required before browsers allow sound.
$('startOverlay').addEventListener('click', async () => {
  $('startOverlay').classList.add('hidden');
  await initAudio();
  try { await document.documentElement.requestFullscreen(); } catch { /* ignore */ }
});
addEventListener('keydown', e => {
  if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
  }
  if (e.key === 'm' || e.key === 'M') setMuted(!isMuted());
});
let cursorTimer;
addEventListener('mousemove', () => {
  document.body.classList.add('show-cursor');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.remove('show-cursor'), 2000);
});

fetch('/api/info').then(r => r.json()).then(info => {
  $('playUrl').textContent = info.playUrl.replace(/^https?:\/\//, '');
  $('qr').src = `/api/qr.svg?url=${encodeURIComponent(info.playUrl)}`;
});

// ---------------------------------------------------------------------------

async function onState(s) {
  const prev = S;
  S = s;
  const ev = s.event;
  if (lastEventId === null || !prev) {
    lastEventId = ev.id;
    renderAll(s);
    return;
  }
  if (ev.id === lastEventId) { renderAll(s); return; }
  lastEventId = ev.id;
  await handleEvent(ev, prev, s);
}

function layerFor(phase) {
  return {
    lobby: 'lobby', board: 'board', clue: 'clue', dd_wager: 'dd',
    final_category: 'final', final_clue: 'final', final_reveal: 'final', game_over: 'gameover',
  }[phase] || 'lobby';
}

function setLayer(name) {
  const onSet = new Set([name]);
  if (name === 'clue' || name === 'dd') onSet.add('board');
  for (const id of ['lobby', 'board', 'clue', 'dd', 'final', 'gameover']) $(id).classList.toggle('on', onSet.has(id));
  $('podiums').classList.toggle('away', !['board', 'clue', 'dd'].includes(name));
  fx.setAmbient(name === 'lobby' || name === 'board' || name === 'gameover');
}

function renderAll(s) {
  if (!!s.config.muted !== isMuted()) setMuted(!!s.config.muted);
  document.title = `${s.title} · TV`;
  renderLobby(s);
  renderBoard(s);
  renderPodiums(s);
  renderClue(s);
  renderDD(s);
  renderFinal(s);
  renderGameOver(s);
  setLayer(layerFor(s.phase));
}

// ---------------------------------------------------------------------------
// Events -> animations

async function handleEvent(ev, prev, s) {
  switch (ev.type) {
    case 'roundIntro': {
      stopAll();
      stopFireworks();
      fillPending = true;
      boardKey = '';
      renderAll(s);
      $('introText').textContent = s.config.roundLabels?.[s.round] || (s.round === '2' ? 'DOUBLE ROUND' : 'ROUND ONE');
      await splash();
      await fillBoard();
      return;
    }
    case 'categoryReveal':
    case 'categoryRevealAll':
      play('reveal');
      renderAll(s);
      return;

    case 'select': {
      const tile = tileEl(ev.cat, ev.row);
      renderAll({ ...s, phase: 'board' }); // keep board up while we prep the clue
      renderClue(s);
      play('reveal');
      if (tile) {
        tile.classList.add('flash');
        await sleep(220);
        $('clue').classList.add('on');
        await zoomFrom($('clue'), tile, stage, { duration: 520 });
      }
      renderAll(S);
      return;
    }

    case 'dailyDouble': {
      const tile = tileEl(ev.cat, ev.row);
      renderAll({ ...s, phase: 'board' });
      renderDD(s);
      $('ddSplash').classList.remove('spin');
      if (tile) {
        $('dd').classList.add('on');
        await zoomFrom($('dd'), tile, stage, { duration: 380 });
      }
      play('daily-double');
      void $('ddSplash').offsetWidth;
      $('ddSplash').classList.add('spin');
      setTimeout(() => fx.sparkle(960, 470, 220), 1000);
      renderAll(S);
      return;
    }

    case 'wager':
      play('reveal');
      renderAll(s);
      return;

    case 'buzzOpen':
      play('tick');
      renderAll(s);
      return;

    case 'buzz':
      play('buzz-in');
      renderAll(s);
      return;

    case 'correct': {
      play('correct');
      renderAll(s);
      const t = s.teams.find(x => x.id === ev.teamId);
      flash(`+${money(ev.amount)}`, true, t);
      fx.sparkle(960, 500, 140);
      return;
    }
    case 'wrong': {
      play('wrong');
      renderAll(s);
      flash(`−${money(ev.amount)}`, false);
      return;
    }
    case 'timesUp':
      play('times-up');
      renderAll(s);
      return;

    case 'close':
    case 'roundComplete': {
      const cur = prev.current;
      const tile = cur && tileEl(cur.cat, cur.row);
      const layer = prev.phase === 'dd_wager' ? $('dd') : $('clue');
      if (tile && layer.classList.contains('on') && (prev.phase === 'clue' || prev.phase === 'dd_wager')) {
        await zoomFrom(layer, tile, stage, { duration: 380, reverse: true }).catch(() => {});
        layer.classList.remove('on');
        layer.getAnimations().forEach(a => a.cancel());
      }
      renderAll(S);
      if (ev.type === 'roundComplete') fx.sparkle(960, 420, 120);
      return;
    }

    case 'finalIntro':
      stopAll();
      renderAll({ ...s, phase: prev.phase });
      $('introText').textContent = s.config.finalLabel || 'FINAL ROUND';
      play('daily-double');
      await splash();
      renderAll(S);
      return;

    case 'finalClue':
      play('reveal');
      renderAll(s);
      return;
    case 'think':
      play('think');
      renderAll(s);
      return;
    case 'finalSpotlight':
      stopAll();
      play('reveal');
      renderAll(s);
      return;
    case 'finalShowAnswer':
      play('tick');
      renderAll(s);
      return;
    case 'finalCorrect':
      play('correct');
      renderAll(s);
      fx.sparkle(960, 560, 160);
      return;
    case 'finalWrong':
      play('wrong');
      renderAll(s);
      return;

    case 'gameOver':
      stopAll();
      renderAll(s);
      play('fanfare');
      startFireworks();
      return;

    case 'undo':
    case 'reset':
      stopAll();
      stopFireworks();
      if (ev.type === 'reset') { boardKey = ''; fillPending = false; }
      renderAll(s);
      return;

    default:
      renderAll(s);
  }
}

async function splash() {
  const el = $('introText');
  $('intro').classList.add('on');
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  play('reveal');
  await sleep(1900);
  $('intro').classList.remove('on');
  await sleep(250);
}

async function fillBoard() {
  const tiles = [...document.querySelectorAll('#grid .tile')];
  play('board-fill');
  for (const t of shuffle(tiles)) {
    t.classList.remove('dark');
    t.classList.add('lit');
    await sleep(Math.max(18, 1500 / tiles.length));
  }
  fillPending = false;
}

function flash(text, good, team) {
  const el = $('resultFlash');
  el.textContent = text;
  el.className = 'result-flash ' + (good ? 'good' : 'bad');
  if (team) el.style.color = '';
  void el.offsetWidth;
  el.classList.add('go');
}

function startFireworks() {
  stopFireworks();
  fx.fireworks(10, 2500);
  fireworksTimer = setInterval(() => fx.fireworks(6, 2500), 3500);
  setTimeout(stopFireworks, 40000);
}
function stopFireworks() { clearInterval(fireworksTimer); fireworksTimer = null; }

// ---------------------------------------------------------------------------
// Renderers

function tileEl(c, r) { return document.querySelector(`#grid .tile[data-c="${c}"][data-r="${r}"]`); }

function renderLobby(s) {
  $('lobbyTitle').textContent = s.title;
  $('lobbyTeams').innerHTML = s.teams.map(t => `<div class="lobby-team" style="--c:${t.color}">${esc(t.name)}</div>`).join('');
}

function renderBoard(s) {
  const grid = $('grid');
  if (!s.board) { grid.innerHTML = ''; boardKey = ''; return; }
  const cols = s.board.length;
  const rows = Math.max(...s.board.map(c => c.tiles.length));
  const key = `${s.round}|${s.introId}|${cols}x${rows}`;
  if (key !== boardKey) {
    boardKey = key;
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.style.gridTemplateRows = `170px repeat(${rows}, 1fr)`;
    let html = '';
    for (let c = 0; c < cols; c++) {
      html += `<div class="cat" data-c="${c}"><div class="face cover">${DIYA_SVG}</div><div class="face name"></div></div>`;
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        html += `<div class="tile${fillPending ? ' dark' : ''}" data-c="${c}" data-r="${r}"><span class="val"></span></div>`;
      }
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.cover svg').forEach(svg => svg.classList.add('cover-diya'));
  }
  s.board.forEach((col, c) => {
    const cat = grid.querySelector(`.cat[data-c="${c}"]`);
    const nameEl = cat.querySelector('.name');
    if (col.name != null && nameEl.dataset.text !== col.name) {
      nameEl.dataset.text = col.name;
      nameEl.textContent = col.name;
      requestAnimationFrame(() => fitText(nameEl, { max: 50, min: 22 }));
    }
    cat.classList.toggle('revealed', col.name != null);
    col.tiles.forEach((t, r) => {
      const el = tileEl(c, r);
      if (!el) return;
      el.classList.toggle('used', t.used);
      el.classList.toggle('long', t.value >= 1000);
      const v = el.querySelector('.val');
      const txt = `<span class="cur">$</span>${t.value.toLocaleString('en-US')}`;
      if (v.innerHTML !== txt) v.innerHTML = txt;
    });
  });
}

function renderPodiums(s) {
  const root = $('podiums');
  if (root.children.length !== s.teams.length || [...root.children].some((el, i) => el.dataset.id !== s.teams[i].id)) {
    root.innerHTML = s.teams.map(t => `
      <div class="podium" data-id="${t.id}" style="--c:${t.color}">
        <div class="ctrl">${DIYA_SVG}</div>
        <div class="score"></div>
        <div class="pname"></div>
      </div>`).join('');
    shownScores.clear();
  }
  const cur = s.current;
  for (const t of s.teams) {
    const el = root.querySelector(`.podium[data-id="${t.id}"]`);
    el.style.setProperty('--c', t.color);
    el.querySelector('.pname').textContent = t.name;
    const sc = el.querySelector('.score');
    const before = shownScores.get(t.id);
    if (before === undefined) sc.textContent = money(t.score);
    else if (before !== t.score) countTo(sc, before, t.score, money, 800);
    shownScores.set(t.id, t.score);
    sc.classList.toggle('neg', t.score < 0);
    el.classList.toggle('control', s.control === t.id && ['board', 'dd_wager'].includes(s.phase));
    el.classList.toggle('buzzed', !!cur && cur.buzzedTeam === t.id && !cur.revealed);
    el.classList.toggle('out', !!cur && !cur.revealed && !cur.isDD && cur.attempted.includes(t.id) && cur.buzzedTeam !== t.id);
  }
}

function renderClue(s) {
  const cur = s.current;
  if (!cur) return;
  $('clueCat').textContent = cur.category;
  $('clueValue').textContent = cur.isDD ? (cur.wager != null ? `${s.config.ddLabel} · ${money(cur.wager)}` : s.config.ddLabel) : money(cur.value);
  const ct = $('clueText');
  if (ct.dataset.text !== (cur.clue || '')) {
    ct.dataset.text = cur.clue || '';
    ct.textContent = cur.clue || '';
    fitText(ct, { max: 96, min: 46 });
  }
  $('clue').classList.toggle('revealed', !!cur.revealed);
  const ans = $('clueAnswer');
  ans.textContent = cur.answer || '';
  ans.classList.toggle('on', !!cur.revealed && !!cur.answer);

  const answering = cur.buzzedTeam && !cur.revealed;
  $('buzzBar').classList.toggle('on', !!answering);
  if (answering) {
    const t = s.teams.find(x => x.id === cur.buzzedTeam);
    $('buzzTeam').textContent = t?.name || '';
    $('buzzBar').style.setProperty('--c', t?.color || 'var(--gold)');
  }
  $('buzzOpen').classList.toggle('on', !!cur.buzzOpen);
}

function renderDD(s) {
  $('ddLabel').textContent = s.config.ddLabel || 'DAILY DOUBLE';
  const cur = s.current;
  if (!cur || !cur.isDD) return;
  const t = s.teams.find(x => x.id === s.control);
  $('ddWager').innerHTML = t ? `${esc(t.name)} is wagering…` : '';
}

function renderFinal(s) {
  const f = s.final;
  if (!f || !s.phase.startsWith('final')) return;
  const root = $('final');
  $('finalLabel').textContent = s.config.finalLabel || 'FINAL ROUND';
  $('finalCat').textContent = f.category;
  root.classList.toggle('small-cat', s.phase !== 'final_category');
  root.classList.toggle('reveal', s.phase === 'final_reveal');

  const fc = $('finalClue');
  const clueText = s.phase === 'final_category' ? '' : (f.clue || '');
  if (fc.dataset.text !== clueText) {
    fc.dataset.text = clueText;
    fc.textContent = clueText;
    if (clueText) fitText(fc, { max: 92, min: 44 });
  }

  // chips
  const chips = s.teams.map(t => {
    const elig = f.eligible.includes(t.id);
    const done = s.phase === 'final_category' ? f.hasWager?.[t.id] : s.phase === 'final_clue' ? f.hasAnswer?.[t.id] : false;
    return `<div class="chip${elig ? '' : ' dim'}" style="--c:${t.color}">${esc(t.name)}${done ? '<span class="tick">✓</span>' : ''}</div>`;
  }).join('');
  $('finalChips').innerHTML = s.phase === 'final_reveal' ? '' : chips;

  // timer diyas
  const fd = $('finalDiyas');
  if (s.phase === 'final_clue' && f.timerEndsAt) {
    if (fd.children.length !== 10) fd.innerHTML = Array.from({ length: 10 }, () => `<div class="diya">${DIYA_SVG}</div>`).join('');
    fd.classList.remove('hidden');
  } else fd.classList.add('hidden');

  // spotlight
  if (s.phase === 'final_reveal') {
    const id = f.order[f.idx];
    const t = s.teams.find(x => x.id === id);
    const ansShown = id in f.answers;
    const judged = id in f.results;
    $('finalSpot').style.setProperty('--c', t.color);
    $('finalSpot').innerHTML = `
      <div class="spot-team">${esc(t.name)}</div>
      ${ansShown
        ? `<div class="spot-answer">${esc(f.answers[id] || '(no answer)')}</div>`
        : `<div class="spot-answer pending">What did they write?</div>`}
      <div class="spot-result ${judged ? (f.results[id] ? 'good' : 'bad') : ''}">${judged ? (f.results[id] ? '✓ CORRECT' : '✗ INCORRECT') : ''}</div>
      <div class="spot-score">${judged ? `Wagered ${money(f.wagers[id])} · Now ${money(t.score)}` : `Score ${money(t.score)}`}</div>`;
  }
}

function renderGameOver(s) {
  if (s.phase !== 'game_over') return;
  const winners = s.teams.filter(t => (s.winners || []).includes(t.id));
  $('goNames').textContent = winners.map(t => t.name).join(' & ') || '—';
  $('goFinal').innerHTML = s.final?.answer ? `Final answer: <b>${esc(s.final.answer)}</b>` : '';
  $('goScores').innerHTML = [...s.teams].sort((a, b) => b.score - a.score)
    .map(t => `<div class="go-score" style="--c:${t.color}"><div class="n">${esc(t.name)}</div><div class="s">${money(t.score)}</div></div>`).join('');
}

// ---------------------------------------------------------------------------
// Timers (answer countdown diyas, final think countdown)

setInterval(() => {
  if (!S) return;
  const now = net.serverNow();
  const cur = S.current;
  const n = S.config.answerSeconds || 0;
  const box = $('answerDiyas');
  if (cur && cur.buzzedTeam && !cur.revealed && !cur.isDD && n > 0 && cur.buzzAt) {
    if (box.children.length !== n) box.innerHTML = Array.from({ length: n }, () => `<div class="diya">${DIYA_SVG}</div>`).join('');
    const left = Math.max(0, n - Math.floor((now - cur.buzzAt) / 1000));
    // Lights go out from the outside in.
    const order = [...Array(n).keys()].sort((a, b) => Math.abs(b - (n - 1) / 2) - Math.abs(a - (n - 1) / 2));
    const outCount = n - left;
    [...box.children].forEach(d => d.classList.remove('off'));
    order.slice(0, outCount).forEach(i => box.children[i].classList.add('off'));
    const key = `${cur.buzzedTeam}:${cur.buzzAt}`;
    if (left === 0 && timesUpKey !== key) { timesUpKey = key; play('times-up'); }
  } else box.innerHTML = '';

  const f = S.final;
  if (S.phase === 'final_clue' && f?.timerEndsAt) {
    const total = (S.config.finalSeconds || 30) * 1000;
    const left = Math.max(0, f.timerEndsAt - now);
    const lit = Math.ceil((left / total) * 10);
    const kids = $('finalDiyas').children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('off', i >= lit);
  }
}, 100);
