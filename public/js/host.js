// Host controller: sees answers, drives the game.
import { connect, ensurePin, esc, money } from './net.js';

const $ = id => document.getElementById(id);
let S = null;
let net;

const pin = await ensurePin();
net = connect('host', {
  pin,
  onState: s => { S = s; render(); },
  onError: m => toast(m),
  onStatus: ok => $('conn').classList.toggle('hidden', ok),
});
const send = a => net.send(a);

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 3200);
}

const teamById = id => S.teams.find(t => t.id === id);
const teamTag = id => { const t = teamById(id); return t ? `<span class="team" style="background:${t.color}">${esc(t.name)}</span>` : '—'; };

const PHASE_NAMES = {
  lobby: 'Lobby', board: 'Board', dd_wager: 'Daily Double', clue: 'Clue',
  final_category: 'Final · wagers', final_clue: 'Final · clue', final_reveal: 'Final · reveal', game_over: 'Game over',
};

// ---------------------------------------------------------------------------

function render() {
  const s = S;
  $('title').textContent = s.title;
  document.title = `${s.title} · Host`;
  $('phase').textContent = `${PHASE_NAMES[s.phase] || s.phase}${['board', 'clue', 'dd_wager'].includes(s.phase) ? ` · Round ${s.round}` : ''}`;
  $('undoBtn').disabled = !s.canUndo;
  $('muteBtn').textContent = s.config.muted ? '🔇' : '🔊';

  const nr = $('nextRoundBtn');
  nr.disabled = !['board', 'clue', 'dd_wager'].includes(s.phase);
  nr.textContent = s.round === '1' && s.hasRound2 ? 'Next: Double round →' : 'Next: Final round →';
  nr.classList.toggle('hot', s.phase === 'board' && s.boardComplete);
  $('endBtn').disabled = s.phase === 'lobby' || s.phase === 'game_over';

  preserveInputs(() => { $('main').innerHTML = VIEWS[s.phase]?.(s) ?? ''; });
  renderScores(s);
}

function preserveInputs(fn) {
  const saved = {};
  const active = document.activeElement?.dataset?.key;
  document.querySelectorAll('#main [data-key]').forEach(el => { saved[el.dataset.key] = el.value; });
  fn();
  document.querySelectorAll('#main [data-key]').forEach(el => {
    if (saved[el.dataset.key] != null && saved[el.dataset.key] !== '') el.value = saved[el.dataset.key];
    if (el.dataset.key === active) el.focus();
  });
}

function renderScores(s) {
  $('scores').innerHTML = s.teams.map(t => `
    <div class="sc${s.control === t.id ? ' ctrl' : ''}" style="--c:${t.color}">
      <div class="who" data-act="control" data-team="${t.id}">
        <div class="nm">${esc(t.name)}</div>
        <div class="pt${t.score < 0 ? ' neg' : ''}">${money(t.score)}</div>
        ${s.control === t.id ? '<div class="tag">🪔 has control</div>' : ''}
      </div>
      <button class="btn small ghost" data-act="adjust" data-team="${t.id}" data-sign="-1">−</button>
      <button class="btn small ghost" data-act="adjust" data-team="${t.id}" data-sign="1">+</button>
    </div>`).join('');
}

const VIEWS = {
  lobby(s) {
    return `
      <h2>Ready to play</h2>
      <p>Question set: <b>${esc(s.setName || 'none')}</b> ${s.hasSet ? '' : '— <a href="/admin" style="color:var(--gold)">load one in Admin</a>'}</p>
      <p>Teams: ${s.teams.map(t => `<span class="pill" style="border-left:6px solid ${t.color}">${esc(t.name)}</span>`).join(' ')}
        <a href="/admin#teams" style="color:var(--gold)">edit</a></p>
      <p class="hint">Open <b>/tv</b> on the TV laptop and click it once (enables sound). Players scan the QR code on the TV.</p>
      <div class="row">
        <label class="hint" style="align-self:center">First pick:</label>
        <select id="firstTeam" style="font:inherit;padding:10px;border-radius:10px;background:#050729;color:var(--cream)">
          <option value="">Random</option>
          ${s.teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
        </select>
      </div>
      <div class="row"><button class="btn big" data-act="start" ${s.hasSet ? '' : 'disabled'}>🪔 Start game</button></div>`;
  },

  board(s) {
    const hidden = s.categoriesRevealed < s.board.length;
    const cols = s.board.length;
    const rows = Math.max(...s.board.map(c => c.tiles.length));
    let grid = `<div class="hboard" style="grid-template-columns:repeat(${cols},1fr)">`;
    s.board.forEach((c, i) => { grid += `<div class="hcat${i >= s.categoriesRevealed ? ' hidden-cat' : ''}">${esc(c.name)}</div>`; });
    for (let r = 0; r < rows; r++) {
      s.board.forEach((c, ci) => {
        const t = c.tiles[r];
        if (!t) { grid += '<div></div>'; return; }
        grid += `<button class="htile${t.used ? ' used' : ''}" data-act="select" data-c="${ci}" data-r="${r}">${t.dd && !t.used ? '<span class="ddm">DD</span>' : ''}${t.value}</button>`;
      });
    }
    grid += '</div>';
    return `
      <h2>${esc(s.config.roundLabels?.[s.round] || 'Round ' + s.round)}</h2>
      ${hidden ? `<div class="row">
          <button class="btn big" data-act="revealCat">Reveal category ${s.categoriesRevealed + 1} of ${s.board.length}</button>
          <button class="btn ghost" data-act="revealAll">Reveal all</button></div>` : ''}
      <p class="status">Picking: ${teamTag(s.control)}</p>
      ${grid}
      <p class="hint">Tap a value to open that clue. <span style="color:var(--saffron)">DD</span> = Daily Double (only you can see this).</p>
      ${s.boardComplete ? '<p class="status">✨ Board cleared! Tap “Next round” below.</p>' : ''}`;
  },

  dd_wager(s) {
    const c = s.current;
    const r = c.wagerRange || { min: 5, max: 1000 };
    return `
      <h2>${esc(s.config.ddLabel)}!</h2>
      <div class="card">
        <div class="meta">${esc(c.category)}</div>
        <div class="ctext">${esc(c.clue)}</div>
        <div class="answer"><div class="lbl">Answer</div><div class="a">${esc(c.answer)}</div></div>
      </div>
      <p class="status">Team playing: ${teamTag(s.control)} <span class="hint">(tap a score below to change)</span></p>
      <p class="hint">Wager between ${money(r.min)} and ${money(r.max)}</p>
      <div class="wager-row">
        <input type="number" inputmode="numeric" id="ddWager" data-key="ddWager" min="${r.min}" max="${r.max}" placeholder="Wager">
        <button class="btn" data-act="wager">Lock wager</button>
      </div>
      <div class="row">
        ${[r.min, Math.round(r.max / 4 / 100) * 100 || 100, Math.round(r.max / 2 / 100) * 100 || 200].filter(v => v >= r.min && v <= r.max)
          .map(v => `<button class="btn small ghost" data-act="wagerQuick" data-v="${v}">${money(v)}</button>`).join('')}
        <button class="btn small ghost" data-act="wagerQuick" data-v="${r.max}">Max ${money(r.max)} (true DD)</button>
      </div>
      <div class="row"><button class="btn ghost" data-act="close">Cancel (put tile back)</button></div>`;
  },

  clue(s) {
    const c = s.current;
    let status;
    let actions = '';
    if (c.revealed) {
      status = c.result ? (c.result.correct ? `✓ ${teamTag(c.result.teamId)} got it` : `✗ ${teamTag(c.result.teamId)} missed`) : 'Answer revealed';
      actions = `<button class="btn big" data-act="close">Back to board ⏎</button>`;
    } else if (c.buzzedTeam) {
      status = `${teamTag(c.buzzedTeam)} ${c.isDD ? 'is answering the Daily Double' : 'buzzed in!'}`;
      actions = `<button class="btn big good" data-act="judge" data-ok="1">✓ Correct</button>
                 <button class="btn big bad" data-act="judge" data-ok="0">✗ Wrong</button>`;
    } else if (c.buzzOpen) {
      status = '🔔 Buzzers open — waiting…';
      actions = `<button class="btn big ghost" data-act="nobody">Nobody — show answer</button>`;
    } else {
      status = c.wrong.length ? 'Buzzers closed' : 'Read the clue, then open the buzzers';
      actions = `<button class="btn big hot" data-act="openBuzz">🔔 Open buzzers</button>
                 <button class="btn ghost" data-act="nobody">Skip — show answer</button>`;
    }
    const wrong = c.wrong.length ? `<p class="hint">Wrong: ${c.wrong.map(teamTag).join(' ')}</p>` : '';
    const manual = !c.revealed && !c.isDD ? `
      <details style="margin-top:14px"><summary class="hint">Judge a team manually (if someone answered without buzzing)</summary>
        <div class="row">${s.teams.filter(t => !c.attempted.includes(t.id)).map(t => `
          <span class="pill" style="border-left:6px solid ${t.color}">${esc(t.name)}
            <button class="btn small good" data-act="judgeTeam" data-team="${t.id}" data-ok="1">✓</button>
            <button class="btn small bad" data-act="judgeTeam" data-team="${t.id}" data-ok="0">✗</button></span>`).join('')}
        </div></details>` : '';
    return `
      <div class="card">
        <div class="meta">${esc(c.category)} · ${c.isDD ? `${esc(s.config.ddLabel)} ${money(c.wager)}` : money(c.value)}</div>
        <div class="ctext">${esc(c.clue)}</div>
        <div class="answer"><div class="lbl">Answer</div><div class="a">${esc(c.answer)}</div></div>
      </div>
      <p class="status">${status}</p>${wrong}
      <div class="row">${actions}</div>
      ${!c.revealed && c.buzzedTeam && !c.isDD ? '<div class="row"><button class="btn ghost" data-act="nobody">Stop — show answer</button></div>' : ''}
      ${manual}
      <div class="kbd">Keys: B open buzzers · C correct · W wrong · N show answer · Enter back to board · U undo</div>`;
  },

  final_category(s) {
    const f = s.final;
    return `
      <h2>${esc(s.config.finalLabel)}</h2>
      <div class="card"><div class="meta">Category</div><div class="ctext">${esc(f.category)}</div></div>
      <p class="hint">Teams enter wagers on their phones (0 up to their score). You can also type them here.</p>
      ${finalTable(s, 'wager')}
      <div class="row"><button class="btn big" data-act="finalClue">Show the clue →</button></div>
      <p class="hint">Missing wagers count as $0.</p>`;
  },

  final_clue(s) {
    const f = s.final;
    return `
      <h2>${esc(s.config.finalLabel)}</h2>
      <div class="card">
        <div class="meta">${esc(f.category)}</div>
        <div class="ctext">${esc(f.clue)}</div>
        <div class="answer"><div class="lbl">Answer</div><div class="a">${esc(f.answer)}</div></div>
      </div>
      <div class="row">
        <button class="btn big${f.timerEndsAt ? ' ghost' : ' hot'}" data-act="finalTimer">⏱ ${f.timerEndsAt ? 'Restart' : 'Start'} ${s.config.finalSeconds}s think music</button>
      </div>
      ${finalTable(s, 'answer')}
      <div class="row"><button class="btn big" data-act="finalReveal">Reveal answers →</button></div>`;
  },

  final_reveal(s) {
    const f = s.final;
    const id = f.order[f.idx];
    const t = teamById(id);
    let actions;
    if (f.step === 0) actions = `<button class="btn big" data-act="finalNext">Show ${esc(t.name)}'s answer</button>`;
    else if (f.step === 1) actions = `<button class="btn big good" data-act="finalJudge" data-ok="1">✓ Correct</button><button class="btn big bad" data-act="finalJudge" data-ok="0">✗ Wrong</button>`;
    else actions = `<button class="btn big" data-act="finalNext">${f.idx < f.order.length - 1 ? 'Next team →' : '🏆 Show the winner'}</button>`;
    return `
      <h2>Final reveal · ${f.idx + 1} of ${f.order.length}</h2>
      <div class="card">
        <div class="meta">Correct answer</div><div class="ctext">${esc(f.answer)}</div>
      </div>
      <p class="status">${teamTag(id)} wrote: <b>“${esc(f.answers[id] || '(nothing)')}”</b> · wagered <b>${money(f.wagers[id] ?? 0)}</b></p>
      <div class="row">${actions}</div>
      <p class="hint">Revealed lowest score first. Edit an answer if someone wrote on paper:</p>
      <div class="wager-row"><input type="text" data-key="fa_${id}" id="fixAnswer" placeholder="Answer for ${esc(t.name)}">
        <button class="btn small ghost" data-act="finalAnswerFix" data-team="${id}">Save</button></div>`;
  },

  game_over(s) {
    const w = s.teams.filter(t => (s.winners || []).includes(t.id));
    return `
      <h2>🏆 ${w.map(t => esc(t.name)).join(' & ') || 'Game over'}</h2>
      <p>Happy Diwali! 🪔 Fireworks are on the TV.</p>
      ${w.length > 1 ? '<p class="hint">Tie! Play a quick tiebreaker clue out loud, then use ± to award it — or crown co-winners.</p>' : ''}
      <div class="row"><button class="btn big" data-act="reset">New game (back to lobby)</button></div>`;
  },
};

function finalTable(s, kind) {
  const f = s.final;
  return `<table class="ftable">${s.teams.map(t => {
    const elig = f.eligible.includes(t.id);
    if (!elig) return `<tr><td>${teamTag(t.id)}</td><td colspan="3" class="hint">not eligible (score ≤ 0)</td></tr>`;
    const have = kind === 'wager' ? f.wagers[t.id] : f.answers[t.id];
    return `<tr>
      <td>${teamTag(t.id)}<br><span class="hint">${money(t.score)}</span></td>
      <td>${have != null && have !== '' ? `✓ <b>${esc(kind === 'wager' ? money(have) : have)}</b>` : '<span class="hint">waiting…</span>'}</td>
      <td><input type="${kind === 'wager' ? 'number' : 'text'}" data-key="${kind}_${t.id}" id="${kind}_${t.id}" placeholder="${kind === 'wager' ? `0–${t.score}` : 'answer'}"></td>
      <td><button class="btn small ghost" data-act="${kind === 'wager' ? 'finalWagerSet' : 'finalAnswerSet'}" data-team="${t.id}">Set</button></td>
    </tr>`;
  }).join('')}</table>`;
}

// ---------------------------------------------------------------------------
// Actions

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || !S) return;
  const d = b.dataset;
  switch (d.act) {
    case 'start': send({ type: 'startGame', firstTeam: $('firstTeam')?.value || undefined }); break;
    case 'revealCat': send({ type: 'revealCategory' }); break;
    case 'revealAll': send({ type: 'revealAllCategories' }); break;
    case 'select': send({ type: 'selectClue', cat: +d.c, row: +d.r }); break;
    case 'control': send({ type: 'setControl', teamId: d.team }); break;
    case 'adjust': {
      const v = prompt(`${d.sign > 0 ? 'Add to' : 'Subtract from'} ${teamById(d.team).name}:`, S.current?.value || 200);
      if (v != null && v !== '') send({ type: 'adjustScore', teamId: d.team, delta: d.sign * Math.abs(Number(v)) });
      break;
    }
    case 'wager': send({ type: 'setWager', amount: Number($('ddWager').value) }); break;
    case 'wagerQuick': $('ddWager').value = d.v; break;
    case 'openBuzz': send({ type: 'openBuzzers' }); break;
    case 'judge': send({ type: 'judge', correct: d.ok === '1' }); break;
    case 'judgeTeam': send({ type: 'judge', teamId: d.team, correct: d.ok === '1' }); break;
    case 'nobody': send({ type: 'noAnswer' }); break;
    case 'close': send({ type: 'closeClue' }); break;
    case 'finalClue': send({ type: 'finalShowClue' }); break;
    case 'finalTimer': send({ type: 'finalStartTimer' }); break;
    case 'finalReveal': send({ type: 'finalReveal' }); break;
    case 'finalNext': send({ type: 'finalNext' }); break;
    case 'finalJudge': send({ type: 'finalJudge', correct: d.ok === '1' }); break;
    case 'finalWagerSet': send({ type: 'finalWager', teamId: d.team, amount: Number($(`wager_${d.team}`).value), byHost: true }); $(`wager_${d.team}`).value = ''; break;
    case 'finalAnswerSet': send({ type: 'finalAnswer', teamId: d.team, text: $(`answer_${d.team}`).value, byHost: true }); $(`answer_${d.team}`).value = ''; break;
    case 'finalAnswerFix': send({ type: 'finalAnswer', teamId: d.team, text: $('fixAnswer').value, byHost: true }); $('fixAnswer').value = ''; break;
    case 'reset': if (confirm('Start over? Scores go back to 0.')) send({ type: 'resetGame' }); break;
  }
});

$('undoBtn').onclick = () => send({ type: 'undo' });
$('muteBtn').onclick = () => send({ type: 'setMeta', patch: { config: { muted: !S.config.muted } } });
$('nextRoundBtn').onclick = () => {
  if (S.phase === 'board' && !S.boardComplete && !confirm('There are clues left on the board. Move on anyway?')) return;
  send({ type: 'nextRound' });
};
$('endBtn').onclick = () => { if (confirm('End the game now and show the winner?')) send({ type: 'endGame' }); };
$('resetBtn').onclick = () => { if (confirm('Reset to the lobby? Scores go back to 0.')) send({ type: 'resetGame' }); };

addEventListener('keydown', e => {
  if (!S || e.target.matches('input, select, textarea')) {
    if (e.key === 'Enter' && e.target.id === 'ddWager') send({ type: 'setWager', amount: Number(e.target.value) });
    return;
  }
  const c = S.current;
  const k = e.key.toLowerCase();
  if (k === 'u') send({ type: 'undo' });
  if (S.phase !== 'clue' || !c) return;
  if (k === 'b' && !c.buzzOpen && !c.buzzedTeam && !c.revealed) send({ type: 'openBuzzers' });
  if (k === 'c' && c.buzzedTeam && !c.revealed) send({ type: 'judge', correct: true });
  if (k === 'w' && c.buzzedTeam && !c.revealed) send({ type: 'judge', correct: false });
  if (k === 'n' && !c.revealed) send({ type: 'noAnswer' });
  if ((k === 'enter' || k === 'escape') && c.revealed) send({ type: 'closeClue' });
});
