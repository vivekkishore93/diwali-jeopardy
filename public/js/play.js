// Player phone: pick a team, buzz in, submit final wager/answer.
import { connect, esc, money } from './net.js';

const $ = id => document.getElementById(id);
let S = null;
let teamId = load('dq-team');
let lockedUntil = 0;
let lastErr = '';
let myFinal = JSON.parse(load('dq-final') || '{}'); // what this phone submitted
let screenKey = '';

function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

const net = connect('play', {
  onState: s => { S = s; render(); },
  onError: m => { lastErr = m; render(); setTimeout(() => { lastErr = ''; render(); }, 3000); },
  onLockout: ms => { lockedUntil = Date.now() + ms; render(); setTimeout(render, ms + 20); },
  onStatus: ok => $('conn').classList.toggle('hidden', ok),
});

const me = () => S?.teams.find(t => t.id === teamId);

function render() {
  if (!S) return;
  const t = me();
  if (!t) return renderPicker();
  document.title = `${t.name} · Buzzer`;
  $('hdr').classList.remove('hidden');
  $('hdr').style.setProperty('--c', t.color);
  $('tname').textContent = t.name;
  $('tscore').textContent = money(t.score);
  $('tscore').classList.toggle('neg', t.score < 0);

  const ph = S.phase;
  if (ph === 'lobby' && Object.keys(myFinal).length) { myFinal = {}; save('dq-final', '{}'); }
  if (ph === 'final_category' || ph === 'final_clue') return renderFinalForm(t);
  renderBuzz(t);
}

function setMain(key, html) {
  if (key === screenKey) return false;
  screenKey = key;
  $('main').innerHTML = html;
  return true;
}

function renderPicker() {
  $('hdr').classList.add('hidden');
  setMain('pick:' + S.teams.map(t => t.id + t.name).join(), `
    <div class="title">${esc(S.title)}</div>
    <div class="msg">Which team are you on?</div>
    <div class="teams">${S.teams.map(t => `<button data-team="${t.id}" style="--c:${t.color}">${esc(t.name)}</button>`).join('')}</div>`);
}

function renderBuzz(t) {
  if (setMain('buzz', `<div class="msg" id="msg"></div><button id="buzz">BUZZ</button><div class="err" id="err"></div>`)) {
    const b = $('buzz');
    b.addEventListener('pointerdown', e => { e.preventDefault(); doBuzz(); });
  }
  const c = S.current;
  const b = $('buzz');
  let cls = '', label = 'BUZZ', msg = '';
  const name = id => esc(S.teams.find(x => x.id === id)?.name || '');
  const locked = Date.now() < lockedUntil;

  switch (S.phase) {
    case 'lobby': msg = `You're on <b>${esc(t.name)}</b>.<br>Waiting for the game to start…`; break;
    case 'board': msg = S.control === t.id ? '<b>Your team picks next!</b>' : `<b>${name(S.control)}</b> is picking a clue`; break;
    case 'dd_wager': msg = S.control === t.id ? '<b>Daily Double!</b> Tell the host your wager.' : `<b>${name(S.control)}</b> found the Daily Double!`; break;
    case 'clue':
      if (c.isDD) { msg = S.control === t.id ? '<b>Your Daily Double!</b> Answer out loud.' : `<b>${name(S.control)}</b> is answering the Daily Double`; break; }
      if (c.revealed) {
        msg = c.result?.correct ? (c.result.teamId === t.id ? '<b>Correct!</b> 🎉 You pick next.' : `<b>${name(c.result.teamId)}</b> got it`) : 'Answer revealed';
      } else if (c.buzzedTeam === t.id) {
        cls = 'won'; label = 'GO!'; msg = '<b>You buzzed first!</b> Answer now!';
      } else if (c.attempted.includes(t.id)) {
        cls = 'locked'; msg = 'You already had a go at this one';
      } else if (c.buzzedTeam) {
        cls = 'locked'; msg = `<b>${name(c.buzzedTeam)}</b> buzzed first`;
      } else if (c.buzzOpen) {
        cls = 'ready'; msg = 'Buzzers are <b>OPEN</b>!';
      } else {
        cls = 'wait'; label = 'WAIT'; msg = 'Listen to the clue… (buzzing early locks you out briefly)';
      }
      break;
    case 'final_reveal': msg = 'Final answers are being revealed on the TV 👀'; break;
    case 'game_over': {
      const won = (S.winners || []).includes(t.id);
      msg = won ? '🏆 <b>You won!</b> Happy Diwali! 🪔' : 'Game over — Happy Diwali! 🪔';
      break;
    }
  }
  if (locked) cls += ' locked';
  b.className = cls;
  b.textContent = label;
  $('msg').innerHTML = msg;
  $('err').textContent = lastErr;

  if (c && c.buzzedTeam === t.id && !c.revealed && navigator.vibrate && !b.dataset.vib) { navigator.vibrate([80, 40, 160]); b.dataset.vib = '1'; }
  if (!c || c.buzzedTeam !== t.id) delete b.dataset.vib;
}

function doBuzz() {
  if (!S || Date.now() < lockedUntil) return;
  const b = $('buzz');
  b.classList.add('pressed');
  setTimeout(() => b.classList.remove('pressed'), 120);
  if (navigator.vibrate) navigator.vibrate(30);
  net.send({ type: 'buzz', teamId });
}

function renderFinalForm(t) {
  const f = S.final;
  const elig = f?.eligible.includes(t.id);
  if (!elig) {
    setMain('final-out', `<div class="title">Final round</div><div class="msg">Your team isn't in the final (score must be above $0).<br>Cheer the others on! 🎆</div>`);
    return;
  }
  if (S.phase === 'final_category') {
    const done = f.hasWager?.[t.id];
    setMain(`fw:${done ? 1 : 0}:${t.score}`, `
      <div class="title">Final round</div>
      <div class="msg">Category: <b>${esc(f.category)}</b><br>Wager anything from $0 to ${money(t.score)}</div>
      <form id="fform">
        <input type="number" inputmode="numeric" id="fval" min="0" max="${t.score}" placeholder="Your wager" required>
        <button class="go">${done ? 'Change wager' : 'Lock in wager'}</button>
        ${done ? `<div class="locked-note">✓ Wager locked${myFinal.wager != null ? `: ${money(myFinal.wager)}` : ''}</div>` : ''}
      </form><div class="err" id="err"></div>`);
    $('fform').onsubmit = e => {
      e.preventDefault();
      const v = Number($('fval').value);
      myFinal.wager = v; save('dq-final', JSON.stringify(myFinal));
      net.send({ type: 'finalWager', teamId, amount: v });
    };
  } else {
    const done = f.hasAnswer?.[t.id];
    setMain(`fa:${done ? 1 : 0}`, `
      <div class="title">Final round</div>
      <div class="msg"><b>${esc(f.category)}</b></div>
      <form id="fform">
        <input type="text" id="fval" placeholder="Your answer" autocomplete="off" required>
        <button class="go">${done ? 'Change answer' : 'Submit answer'}</button>
        ${done ? `<div class="locked-note">✓ Answer submitted${myFinal.answer ? `: “${esc(myFinal.answer)}”` : ''}</div>` : ''}
      </form><div class="err" id="err"></div>`);
    $('fform').onsubmit = e => {
      e.preventDefault();
      myFinal.answer = $('fval').value; save('dq-final', JSON.stringify(myFinal));
      net.send({ type: 'finalAnswer', teamId, text: $('fval').value });
    };
  }
  if ($('err')) $('err').textContent = lastErr;
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-team]');
  if (b) { teamId = b.dataset.team; save('dq-team', teamId); myFinal = {}; save('dq-final', '{}'); screenKey = ''; render(); }
});
$('switch').onclick = () => { teamId = null; screenKey = ''; render(); };
addEventListener('keydown', e => { if (e.code === 'Space' && S?.phase === 'clue') { e.preventDefault(); doBuzz(); } });
