import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newState, dispatch, setMeta, viewFor, buildBoard, DEFAULT_CONFIG } from '../src/engine.js';
import { csvToSet } from '../src/csv.js';

const { set } = csvToSet(fs.readFileSync(new URL('../questions/diwali-starter.csv', import.meta.url), 'utf8'));

function seeded(seed = 1) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}
function fresh() {
  let s = newState({ teams: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] });
  s = setMeta(s, { set, setName: 'starter' });
  s = dispatch(s, { type: 'startGame', firstTeam: 'a' }, { rng: seeded(7) });
  return s;
}
const act = (s, a) => dispatch(s, a, { now: 1000 });
const score = (s, id) => s.game.teams.find(t => t.id === id).score;
function findTile(s, dd) {
  const b = s.game.boards[s.game.round];
  for (let c = 0; c < b.length; c++) for (let r = 0; r < b[c].length; r++) if (!b[c][r].used && b[c][r].dd === dd) return { cat: c, row: r, value: b[c][r].value };
}

test('daily doubles: 1 in round 1, 2 in round 2, never top row, different categories', () => {
  for (let seed = 1; seed < 200; seed++) {
    const b1 = buildBoard(set, '1', DEFAULT_CONFIG, seeded(seed));
    const b2 = buildBoard(set, '2', DEFAULT_CONFIG, seeded(seed));
    const dd1 = b1.flatMap((col, c) => col.map((t, r) => t.dd && [c, r]).filter(Boolean));
    const dd2 = b2.flatMap((col, c) => col.map((t, r) => t.dd && [c, r]).filter(Boolean));
    assert.equal(dd1.length, 1);
    assert.equal(dd2.length, 2);
    for (const [, r] of [...dd1, ...dd2]) assert.notEqual(r, 0);
    assert.notEqual(dd2[0][0], dd2[1][0]);
  }
});

test('pinned DD in CSV overrides random placement', () => {
  const { set: s2 } = csvToSet('round,category,value,clue,answer,daily_double\n1,X,200,a,b,\n1,X,400,c,d,yes\n1,Y,200,e,f,\n1,Y,400,g,h,\n');
  const b = buildBoard(s2, '1', DEFAULT_CONFIG, seeded(3));
  assert.equal(b[0][1].dd, true);
  assert.equal(b.flat().filter(t => t.dd).length, 1);
});

test('regular clue: wrong deducts, others may rebuzz, correct adds and takes control', () => {
  let s = fresh();
  const t = findTile(s, false);
  s = act(s, { type: 'selectClue', ...t });
  assert.equal(s.game.phase, 'clue');
  assert.throws(() => act(s, { type: 'buzz', teamId: 'b' }), /early/); // not open yet
  s = act(s, { type: 'openBuzzers' });
  s = act(s, { type: 'buzz', teamId: 'b' });
  assert.throws(() => act(s, { type: 'buzz', teamId: 'c' }), /early/); // b already in
  s = act(s, { type: 'judge', correct: false });
  assert.equal(score(s, 'b'), -t.value);
  assert.equal(s.game.current.buzzOpen, true);
  assert.throws(() => act(s, { type: 'buzz', teamId: 'b' }), /already answered/);
  s = act(s, { type: 'buzz', teamId: 'c' });
  s = act(s, { type: 'judge', correct: true });
  assert.equal(score(s, 'c'), t.value);
  assert.equal(s.game.control, 'c');
  assert.equal(s.game.current.revealed, true);
  s = act(s, { type: 'closeClue' });
  assert.equal(s.game.phase, 'board');
  assert.equal(s.game.boards['1'][t.cat][t.row].used, true);
});

test('everyone wrong reveals the answer; control stays', () => {
  let s = fresh();
  s = act(s, { type: 'selectClue', ...findTile(s, false) });
  s = act(s, { type: 'openBuzzers' });
  for (const id of ['a', 'b', 'c']) { s = act(s, { type: 'buzz', teamId: id }); s = act(s, { type: 'judge', correct: false }); }
  assert.equal(s.game.current.revealed, true);
  assert.equal(s.game.control, 'a');
});

test('daily double wager limits and scoring', () => {
  let s = fresh();
  s = act(s, { type: 'adjustScore', teamId: 'a', delta: 3000 });
  s = act(s, { type: 'selectClue', ...findTile(s, true) });
  assert.equal(s.game.phase, 'dd_wager');
  assert.throws(() => act(s, { type: 'setWager', amount: 4 }), /between 5 and 3000/);
  assert.throws(() => act(s, { type: 'setWager', amount: 3001 }), /between/);
  s = act(s, { type: 'setWager', amount: 3000 }); // true daily double
  assert.equal(s.game.current.buzzedTeam, 'a');
  s = act(s, { type: 'judge', correct: false });
  assert.equal(score(s, 'a'), 0);
  assert.equal(s.game.current.revealed, true);
  assert.equal(s.game.control, 'a');
});

test('DD with negative score can still wager up to round max', () => {
  let s = fresh();
  s = act(s, { type: 'adjustScore', teamId: 'a', delta: -500 });
  s = act(s, { type: 'selectClue', ...findTile(s, true) });
  assert.equal(viewFor(s, 'host').current.wagerRange.max, 1000);
  s = act(s, { type: 'setWager', amount: 1000 });
  s = act(s, { type: 'judge', correct: true });
  assert.equal(score(s, 'a'), 500);
});

test('round 2 starts with the lowest score picking; final eligibility, wagers & reveal order', () => {
  let s = fresh();
  s = act(s, { type: 'adjustScore', teamId: 'a', delta: 5000 });
  s = act(s, { type: 'adjustScore', teamId: 'b', delta: 2000 });
  s = act(s, { type: 'adjustScore', teamId: 'c', delta: -100 });
  s = act(s, { type: 'nextRound' });
  assert.equal(s.game.round, '2');
  assert.equal(s.game.control, 'c');
  s = act(s, { type: 'nextRound' });
  assert.equal(s.game.phase, 'final_category');
  assert.deepEqual(s.game.final.eligible, ['a', 'b']);
  assert.throws(() => act(s, { type: 'finalWager', teamId: 'c', amount: 0 }), /not in the final/);
  assert.throws(() => act(s, { type: 'finalWager', teamId: 'b', amount: 2001 }), /between 0 and 2000/);
  s = act(s, { type: 'finalWager', teamId: 'b', amount: 2000 });
  // public view hides wager amounts
  assert.equal(viewFor(s, 'tv').final.wagers.b, undefined);
  assert.equal(viewFor(s, 'tv').final.hasWager.b, true);
  assert.equal(viewFor(s, 'tv').final.clue, null);
  s = act(s, { type: 'finalShowClue' });
  assert.equal(s.game.final.wagers.a, 0); // missing wager -> 0
  s = act(s, { type: 'finalAnswer', teamId: 'b', text: 'Ram Setu' });
  s = act(s, { type: 'finalAnswer', teamId: 'a', text: 'Bridge' });
  s = act(s, { type: 'finalReveal' });
  assert.deepEqual(s.game.final.order, ['b', 'a']); // lowest first
  assert.equal(viewFor(s, 'tv').final.answers.b, undefined);
  s = act(s, { type: 'finalNext' });
  assert.equal(viewFor(s, 'tv').final.answers.b, 'Ram Setu');
  assert.throws(() => act(s, { type: 'finalNext' }), /right or wrong/);
  s = act(s, { type: 'finalJudge', correct: true });
  assert.equal(score(s, 'b'), 4000);
  s = act(s, { type: 'finalNext' });
  s = act(s, { type: 'finalNext' });
  s = act(s, { type: 'finalJudge', correct: false });
  s = act(s, { type: 'finalNext' });
  assert.equal(s.game.phase, 'game_over');
  assert.deepEqual(s.game.winners, ['a']); // a wagered 0 -> 5000; b 4000
});

test('undo restores the previous game state', () => {
  let s = fresh();
  const before = s.game;
  s = act(s, { type: 'selectClue', ...findTile(s, false) });
  s = act(s, { type: 'undo' });
  assert.equal(s.game.phase, 'board');
  assert.deepEqual(s.game.boards, before.boards);
  assert.ok(s.game.event.id > before.event.id);
});

test('public view never leaks answers or DD positions', () => {
  let s = fresh();
  const v = viewFor(s, 'play');
  const json = JSON.stringify(v);
  assert.ok(!json.includes('Ayodhya'));
  assert.ok(!json.includes('"dd"'));
  assert.equal(v.board[0].name, null); // categories hidden until revealed
  s = act(s, { type: 'selectClue', ...findTile(s, false) });
  assert.equal(viewFor(s, 'tv').current.answer, null);
  s = act(s, { type: 'noAnswer' });
  assert.ok(viewFor(s, 'tv').current.answer);
});
