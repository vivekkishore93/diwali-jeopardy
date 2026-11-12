// Pure game engine: (state, action) -> new state.
// State shape:
//   { meta: { title, setName, set, config }, game: {...}, history: [game snapshots] }
// Only `game` is snapshotted for undo; `meta` (question set, title, config) is not.

export class GameError extends Error {}

export const DEFAULT_CONFIG = {
  values: { 1: [200, 400, 600, 800, 1000], 2: [400, 800, 1200, 1600, 2000] },
  ddCount: { 1: 1, 2: 2 },
  ddMinWager: 5,
  answerSeconds: 5,     // visual diya countdown after a buzz
  finalSeconds: 30,     // final round think timer
  ddLabel: 'DAILY DOUBLE',
  finalLabel: 'FINAL ROUND',
  roundLabels: { 1: 'ROUND ONE', 2: 'DOUBLE ROUND' },
};

export const TEAM_COLORS = ['#F5B82E', '#FF7A1A', '#D6246E', '#3FD0C9', '#8BD450', '#B784F5'];

const HISTORY_LIMIT = 150;

export function newGame(teams = []) {
  return {
    phase: 'lobby',     // lobby | board | dd_wager | clue | final_category | final_clue | final_reveal | game_over
    round: '1',
    teams: teams.map((t, i) => normTeam(t, i)),
    control: null,
    boards: null,
    categoriesRevealed: 0,
    introId: 0,
    current: null,
    final: null,
    winners: null,
    event: { id: 0, type: 'init' },
    seq: 0,
  };
}

export function newState({ title = 'Diwali Quiz Night', setName = null, set = null, config = {}, teams } = {}) {
  return {
    meta: { title, setName, set, config: { ...DEFAULT_CONFIG, ...config } },
    game: newGame(teams ?? [
      { name: 'Team Diya' }, { name: 'Team Rangoli' }, { name: 'Team Phuljhadi' },
    ]),
    history: [],
  };
}

function normTeam(t, i) {
  return {
    id: t.id || `t${i + 1}_${Math.random().toString(36).slice(2, 7)}`,
    name: String(t.name || `Team ${i + 1}`).slice(0, 24),
    color: t.color || TEAM_COLORS[i % TEAM_COLORS.length],
    score: Number.isFinite(t.score) ? t.score : 0,
  };
}

// ---------------------------------------------------------------------------
// Board helpers

export function roundHasClues(set, r) {
  return !!set && set.rounds[r] && set.rounds[r].categories.some(c => c.clues.length);
}

export function buildBoard(set, r, config, rng = Math.random) {
  const cats = set.rounds[r].categories;
  const rows = Math.max(0, ...cats.map(c => c.clues.length));
  const defaults = config.values[r] || config.values['1'];
  const board = cats.map(cat => Array.from({ length: rows }, (_, row) => {
    const clue = cat.clues[row];
    const fallback = defaults[row] ?? (defaults[defaults.length - 1] + (row - defaults.length + 1) * (defaults[0] || 200));
    return { value: clue?.value ?? fallback, used: !clue || !clue.clue, dd: false };
  }));
  placeDailyDoubles(board, cats, config.ddCount[r] ?? 0, rng);
  return board;
}

// Row weights: never the top row; 4th row most likely (as on TV).
const ROW_WEIGHTS = [0, 1, 3, 4, 3];

export function placeDailyDoubles(board, cats, count, rng = Math.random) {
  // CSV-pinned Daily Doubles take precedence over random placement.
  let pinned = 0;
  cats.forEach((cat, c) => cat.clues.forEach((clue, row) => {
    if (clue.dd && board[c][row] && !board[c][row].used) { board[c][row].dd = true; pinned++; }
  }));
  if (pinned) return;

  const rows = board[0]?.length || 0;
  let cands = [];
  board.forEach((col, c) => col.forEach((tile, row) => {
    if (tile.used) return;
    const w = rows <= 1 ? 1 : (ROW_WEIGHTS[row] ?? 2);
    if (w > 0) cands.push({ c, row, w });
  }));
  if (!cands.length) board.forEach((col, c) => col.forEach((tile, row) => { if (!tile.used) cands.push({ c, row, w: 1 }); }));

  const usedCats = new Set();
  for (let k = 0; k < count && cands.length; k++) {
    // Prefer categories that don't already have a DD.
    const pool = cands.some(x => !usedCats.has(x.c)) ? cands.filter(x => !usedCats.has(x.c)) : cands;
    const total = pool.reduce((s, x) => s + x.w, 0);
    let pick = rng() * total;
    let chosen = pool[pool.length - 1];
    for (const x of pool) { pick -= x.w; if (pick <= 0) { chosen = x; break; } }
    board[chosen.c][chosen.row].dd = true;
    usedCats.add(chosen.c);
    cands = cands.filter(x => x !== chosen);
  }
}

export function roundTopValue(game) {
  const b = game.boards?.[game.round];
  if (!b) return 1000;
  return Math.max(0, ...b.flat().map(t => t.value));
}

export function ddWagerRange(game, config, teamId) {
  const team = game.teams.find(t => t.id === teamId);
  const top = roundTopValue(game);
  return { min: config.ddMinWager, max: Math.max(team ? team.score : 0, top) };
}

export function boardComplete(game) {
  const b = game.boards?.[game.round];
  return !!b && b.every(col => col.every(t => t.used));
}

function lowestScoreTeam(teams) {
  let best = null;
  for (const t of teams) if (!best || t.score < best.score) best = t;
  return best?.id ?? null;
}

// ---------------------------------------------------------------------------
// Reducer

function team(game, id) {
  const t = game.teams.find(x => x.id === id);
  if (!t) throw new GameError('Unknown team.');
  return t;
}

function need(cond, msg) { if (!cond) throw new GameError(msg); }

function emit(game, type, extra = {}) {
  game.seq += 1;
  game.event = { id: game.seq, type, ...extra };
}

/**
 * Apply an action. Returns a NEW state (input is not mutated).
 * ctx: { now: ms timestamp, rng: () => number }
 */
export function dispatch(state, action, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const rng = ctx.rng ?? Math.random;

  if (action.type === 'undo') {
    need(state.history.length, 'Nothing to undo.');
    const history = state.history.slice(0, -1);
    const game = structuredClone(state.history[state.history.length - 1]);
    game.seq = state.game.seq; // keep event ids increasing so clients notice
    emit(game, 'undo');
    return { ...state, game, history };
  }

  const meta = state.meta;
  const game = structuredClone(state.game);
  const prev = state.game;
  const silent = applyAction(game, meta, action, now, rng);

  const history = silent ? state.history : [...state.history, prev].slice(-HISTORY_LIMIT);
  return { ...state, game, history };
}

/** Meta-level changes (question set, title, config). Not undoable. */
export function setMeta(state, patch) {
  const meta = { ...state.meta, ...patch, config: { ...state.meta.config, ...(patch.config || {}) } };
  return { ...state, meta };
}

// Returns true if the action should NOT be recorded in undo history.
function applyAction(game, meta, a, now, rng) {
  const cfg = meta.config;
  const set = meta.set;
  const cur = game.current;

  switch (a.type) {
    // ----- setup -----
    case 'setTeams': {
      need(Array.isArray(a.teams) && a.teams.length >= 1 && a.teams.length <= 6, 'Need 1–6 teams.');
      const old = new Map(game.teams.map(t => [t.id, t]));
      game.teams = a.teams.map((t, i) => normTeam({ ...t, score: old.get(t.id)?.score ?? 0 }, i));
      if (game.control && !game.teams.some(t => t.id === game.control)) game.control = game.teams[0].id;
      emit(game, 'teams');
      return false;
    }

    case 'startGame': {
      need(set && roundHasClues(set, '1'), 'Load a question set with Round 1 clues first (Admin page).');
      need(game.teams.length, 'Add at least one team.');
      const teams = game.teams.map(t => ({ ...t, score: 0 }));
      Object.assign(game, newGame([]), { teams, seq: game.seq });
      game.boards = { 1: buildBoard(set, '1', cfg, rng) };
      if (roundHasClues(set, '2')) game.boards['2'] = buildBoard(set, '2', cfg, rng);
      game.phase = 'board';
      game.round = '1';
      game.control = a.firstTeam && teams.some(t => t.id === a.firstTeam)
        ? a.firstTeam : teams[Math.floor(rng() * teams.length)].id;
      game.introId += 1;
      emit(game, 'roundIntro', { round: '1' });
      return false;
    }

    case 'resetGame': {
      const teams = game.teams.map(t => ({ ...t, score: 0 }));
      Object.assign(game, newGame([]), { teams, seq: game.seq });
      emit(game, 'reset');
      return false;
    }

    // ----- board -----
    case 'revealCategory': {
      need(game.phase === 'board', 'Not on the board.');
      const n = game.boards[game.round].length;
      need(game.categoriesRevealed < n, 'All categories revealed.');
      game.categoriesRevealed += 1;
      emit(game, 'categoryReveal', { index: game.categoriesRevealed - 1 });
      return true;
    }
    case 'revealAllCategories': {
      need(game.phase === 'board', 'Not on the board.');
      game.categoriesRevealed = game.boards[game.round].length;
      emit(game, 'categoryRevealAll');
      return true;
    }

    case 'selectClue': {
      need(game.phase === 'board', 'Finish the current clue first.');
      const tile = game.boards[game.round]?.[a.cat]?.[a.row];
      need(tile && !tile.used, 'That clue is not available.');
      tile.used = true;
      game.categoriesRevealed = game.boards[game.round].length;
      game.current = {
        cat: a.cat, row: a.row, value: tile.value, isDD: tile.dd, wager: null,
        buzzOpen: false, buzzedTeam: null, buzzAt: null, attempted: [], wrong: [],
        result: null, revealed: false, openedAt: now,
      };
      if (tile.dd) {
        game.phase = 'dd_wager';
        if (!game.control) game.control = game.teams[0].id;
        emit(game, 'dailyDouble', { cat: a.cat, row: a.row });
      } else {
        game.phase = 'clue';
        emit(game, 'select', { cat: a.cat, row: a.row });
      }
      return false;
    }

    case 'setControl': {
      team(game, a.teamId);
      game.control = a.teamId;
      emit(game, 'control', { teamId: a.teamId });
      return false;
    }

    case 'setWager': {
      need(game.phase === 'dd_wager', 'No Daily Double in progress.');
      if (a.teamId) { team(game, a.teamId); game.control = a.teamId; }
      const { min, max } = ddWagerRange(game, cfg, game.control);
      const w = Math.round(Number(a.amount));
      need(Number.isFinite(w) && w >= min && w <= max, `Wager must be between ${min} and ${max}.`);
      cur.wager = w;
      cur.value = w;
      cur.buzzedTeam = game.control;
      cur.buzzAt = now;
      game.phase = 'clue';
      emit(game, 'wager', { teamId: game.control, amount: w });
      return false;
    }

    // ----- clue -----
    case 'openBuzzers': {
      need(game.phase === 'clue' && cur && !cur.isDD && !cur.revealed, 'Buzzers can only open during a regular clue.');
      need(!cur.buzzedTeam, 'A team is already answering.');
      cur.buzzOpen = true;
      emit(game, 'buzzOpen');
      return true;
    }

    case 'buzz': {
      if (game.phase !== 'clue' || !cur || cur.isDD || !cur.buzzOpen || cur.buzzedTeam) throw new GameError('early');
      team(game, a.teamId);
      if (cur.attempted.includes(a.teamId)) throw new GameError('You already answered this clue.');
      cur.buzzOpen = false;
      cur.buzzedTeam = a.teamId;
      cur.buzzAt = now;
      emit(game, 'buzz', { teamId: a.teamId });
      return false;
    }

    case 'judge': {
      need(game.phase === 'clue' && cur && !cur.revealed, 'No open clue to judge.');
      const tid = a.teamId || cur.buzzedTeam;
      need(tid, 'No team is answering.');
      const t = team(game, tid);
      if (a.correct) {
        t.score += cur.value;
        game.control = tid;
        cur.result = { teamId: tid, correct: true };
        cur.revealed = true;
        cur.buzzOpen = false;
        if (!cur.attempted.includes(tid)) cur.attempted.push(tid);
        emit(game, 'correct', { teamId: tid, amount: cur.value });
      } else {
        t.score -= cur.value;
        if (!cur.attempted.includes(tid)) cur.attempted.push(tid);
        cur.wrong.push(tid);
        cur.buzzedTeam = null;
        cur.buzzAt = null;
        const othersLeft = game.teams.some(x => !cur.attempted.includes(x.id));
        if (cur.isDD || !othersLeft) {
          cur.revealed = true;
          cur.buzzOpen = false;
          cur.result = { teamId: tid, correct: false };
        } else {
          cur.buzzOpen = true; // rebound: others may buzz
        }
        emit(game, 'wrong', { teamId: tid, amount: cur.value });
      }
      return false;
    }

    case 'noAnswer': {
      need(game.phase === 'clue' && cur, 'No open clue.');
      cur.revealed = true;
      cur.buzzOpen = false;
      cur.buzzedTeam = null;
      emit(game, cur.isDD ? 'reveal' : 'timesUp');
      return false;
    }

    case 'revealAnswer': {
      need(game.phase === 'clue' && cur, 'No open clue.');
      cur.revealed = true;
      cur.buzzOpen = false;
      emit(game, 'reveal');
      return false;
    }

    case 'closeClue': {
      need(game.phase === 'clue' || game.phase === 'dd_wager', 'No open clue.');
      if (game.phase === 'dd_wager') {
        // Abandoned DD: put the tile back.
        game.boards[game.round][cur.cat][cur.row].used = false;
      }
      game.current = null;
      game.phase = 'board';
      emit(game, boardComplete(game) ? 'roundComplete' : 'close');
      return false;
    }

    case 'adjustScore': {
      const t = team(game, a.teamId);
      const d = Math.round(Number(a.delta));
      need(Number.isFinite(d), 'Bad amount.');
      t.score += d;
      emit(game, 'score', { teamId: t.id, amount: d });
      return false;
    }

    case 'setScore': {
      const t = team(game, a.teamId);
      const s = Math.round(Number(a.score));
      need(Number.isFinite(s), 'Bad score.');
      t.score = s;
      emit(game, 'score', { teamId: t.id });
      return false;
    }

    // ----- round flow -----
    case 'nextRound': {
      need(['board', 'clue', 'dd_wager'].includes(game.phase), 'Not in a board round.');
      game.current = null;
      if (game.round === '1' && game.boards['2']) {
        game.round = '2';
        game.phase = 'board';
        game.categoriesRevealed = 0;
        game.control = lowestScoreTeam(game.teams);
        game.introId += 1;
        emit(game, 'roundIntro', { round: '2' });
        return false;
      }
      return startFinal(game, set);
    }

    // ----- final -----
    case 'finalWager': {
      need(['final_category', 'final_clue'].includes(game.phase), 'Final wagers are not open.');
      const t = team(game, a.teamId);
      need(game.final.eligible.includes(t.id), `${t.name} is not in the final round.`);
      need(game.phase === 'final_category' || game.final.wagers[t.id] == null || a.byHost, 'Wagers are locked.');
      const w = Math.round(Number(a.amount));
      need(Number.isFinite(w) && w >= 0 && w <= Math.max(0, t.score), `Wager must be between 0 and ${Math.max(0, t.score)}.`);
      game.final.wagers[t.id] = w;
      emit(game, 'finalWager', { teamId: t.id });
      return true;
    }

    case 'finalShowClue': {
      need(game.phase === 'final_category', 'Not at the final category.');
      for (const id of game.final.eligible) if (game.final.wagers[id] == null) game.final.wagers[id] = 0;
      game.phase = 'final_clue';
      emit(game, 'finalClue');
      return false;
    }

    case 'finalStartTimer': {
      need(game.phase === 'final_clue', 'Show the final clue first.');
      game.final.timerEndsAt = now + cfg.finalSeconds * 1000;
      emit(game, 'think', { endsAt: game.final.timerEndsAt });
      return true;
    }

    case 'finalAnswer': {
      need(game.phase === 'final_clue' || (a.byHost && game.phase === 'final_reveal'), 'Final answers are not open.');
      const t = team(game, a.teamId);
      need(game.final.eligible.includes(t.id), `${t.name} is not in the final round.`);
      game.final.answers[t.id] = String(a.text ?? '').slice(0, 140);
      emit(game, 'finalAnswer', { teamId: t.id });
      return true;
    }

    case 'finalReveal': {
      need(game.phase === 'final_clue', 'Show the final clue first.');
      const f = game.final;
      // Lowest score going into the final is revealed first.
      f.order = [...f.eligible].sort((x, y) => {
        const a1 = game.teams.find(t => t.id === x).score, b1 = game.teams.find(t => t.id === y).score;
        return a1 - b1 || game.teams.findIndex(t => t.id === x) - game.teams.findIndex(t => t.id === y);
      });
      f.idx = 0;
      f.step = 0;
      game.phase = 'final_reveal';
      emit(game, 'finalSpotlight', { teamId: f.order[0] });
      return false;
    }

    case 'finalNext': {
      need(game.phase === 'final_reveal', 'Not revealing the final.');
      const f = game.final;
      if (f.step === 0) {
        f.step = 1;
        emit(game, 'finalShowAnswer', { teamId: f.order[f.idx] });
      } else if (f.step === 1) {
        throw new GameError('Mark the answer right or wrong first.');
      } else if (f.idx < f.order.length - 1) {
        f.idx += 1;
        f.step = 0;
        emit(game, 'finalSpotlight', { teamId: f.order[f.idx] });
      } else {
        finishGame(game);
      }
      return false;
    }

    case 'finalJudge': {
      need(game.phase === 'final_reveal' && game.final.step === 1, 'Show the answer first.');
      const f = game.final;
      const id = f.order[f.idx];
      const t = team(game, id);
      const w = f.wagers[id] ?? 0;
      t.score += a.correct ? w : -w;
      f.results[id] = !!a.correct;
      f.step = 2;
      emit(game, a.correct ? 'finalCorrect' : 'finalWrong', { teamId: id, amount: w });
      return false;
    }

    case 'endGame': {
      finishGame(game);
      return false;
    }

    default:
      throw new GameError(`Unknown action: ${a.type}`);
  }
}

function startFinal(game, set) {
  const eligible = game.teams.filter(t => t.score > 0).map(t => t.id);
  if (!set?.final || !eligible.length) {
    finishGame(game, !set?.final ? 'noFinal' : 'noEligible');
    return false;
  }
  game.phase = 'final_category';
  game.final = { eligible, wagers: {}, answers: {}, results: {}, order: [], idx: -1, step: 0, timerEndsAt: null };
  emit(game, 'finalIntro');
  return false;
}

function finishGame(game, reason) {
  game.phase = 'game_over';
  game.current = null;
  const top = Math.max(...game.teams.map(t => t.score));
  game.winners = game.teams.filter(t => t.score === top).map(t => t.id);
  emit(game, 'gameOver', { reason });
}

// ---------------------------------------------------------------------------
// Views: what each kind of client is allowed to see.

export function viewFor(state, role) {
  const { meta, game } = state;
  const set = meta.set;
  const base = {
    title: meta.title,
    config: {
      ddLabel: meta.config.ddLabel, finalLabel: meta.config.finalLabel, roundLabels: meta.config.roundLabels,
      answerSeconds: meta.config.answerSeconds, finalSeconds: meta.config.finalSeconds, ddMinWager: meta.config.ddMinWager,
      muted: !!meta.config.muted, ddCount: meta.config.ddCount,
    },
    hasSet: !!set,
    setName: meta.setName,
    phase: game.phase,
    round: game.round,
    teams: game.teams,
    control: game.control,
    introId: game.introId,
    event: game.event,
    winners: game.winners,
    canUndo: state.history.length > 0,
    boardComplete: boardComplete(game),
    hasRound2: !!game.boards?.['2'],
  };

  // Board: categories (only revealed ones for public), tile values/used.
  const r = game.round;
  if (game.boards?.[r] && set) {
    const cats = set.rounds[r].categories;
    base.categoriesRevealed = game.categoriesRevealed;
    base.board = game.boards[r].map((col, c) => ({
      name: role === 'host' || c < game.categoriesRevealed ? cats[c].name : null,
      tiles: col.map((t, row) => {
        const tile = { value: t.value, used: t.used };
        if (role === 'host') { tile.dd = t.dd; tile.clue = cats[c].clues[row]?.clue ?? ''; tile.answer = cats[c].clues[row]?.answer ?? ''; }
        return tile;
      }),
    }));
  }

  const cur = game.current;
  if (cur && set) {
    const clue = set.rounds[r].categories[cur.cat].clues[cur.row];
    const showClue = role === 'host' || game.phase === 'clue';
    base.current = {
      cat: cur.cat, row: cur.row, value: cur.value, isDD: cur.isDD, wager: cur.wager,
      category: set.rounds[r].categories[cur.cat].name,
      clue: showClue ? clue.clue : null,
      answer: role === 'host' || cur.revealed ? clue.answer : null,
      buzzOpen: cur.buzzOpen, buzzedTeam: cur.buzzedTeam, buzzAt: cur.buzzAt,
      attempted: cur.attempted, wrong: cur.wrong, result: cur.result, revealed: cur.revealed,
    };
    if (cur.isDD && game.phase === 'dd_wager') base.current.wagerRange = ddWagerRange(game, meta.config, game.control);
  }

  const f = game.final;
  if (f && set?.final) {
    const pub = {
      category: set.final.category,
      clue: role === 'host' || game.phase !== 'final_category' ? set.final.clue : null,
      answer: role === 'host' || game.phase === 'game_over' ? set.final.answer : null,
      eligible: f.eligible, order: f.order, idx: f.idx, step: f.step, timerEndsAt: f.timerEndsAt,
      hasWager: Object.fromEntries(f.eligible.map(id => [id, f.wagers[id] != null])),
      hasAnswer: Object.fromEntries(f.eligible.map(id => [id, f.answers[id] != null && f.answers[id] !== ''])),
      wagers: {}, answers: {}, results: {},
    };
    for (const id of f.eligible) {
      const pos = f.order.indexOf(id);
      const answerShown = role === 'host' || game.phase === 'game_over' || (pos >= 0 && (pos < f.idx || (pos === f.idx && f.step >= 1)));
      const judged = role === 'host' || game.phase === 'game_over' || (pos >= 0 && (pos < f.idx || (pos === f.idx && f.step >= 2)));
      if (answerShown) pub.answers[id] = f.answers[id] ?? '';
      if (judged) { pub.wagers[id] = f.wagers[id] ?? 0; if (id in f.results) pub.results[id] = f.results[id]; }
    }
    base.final = pub;
  } else if (game.phase === 'game_over' && set?.final) {
    base.final = { category: set.final.category, answer: set.final.answer, clue: set.final.clue };
  }
  return base;
}
