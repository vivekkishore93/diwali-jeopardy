// CSV <-> question-set conversion, with validation.
//
// CSV columns: round,category,value,clue,answer,daily_double
//   round        1 | 2 | final
//   value        optional; blank = use the default value for that row position
//   daily_double optional; "yes"/"y"/"true"/"1" pins this clue as a Daily Double

export const HEADERS = ['round', 'category', 'value', 'clue', 'answer', 'daily_double'];

/** Parse CSV text into an array of rows (arrays of strings). Handles quotes, escaped quotes, CRLF. */
export function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  text = String(text).replace(/^﻿/, ''); // strip BOM (Excel)
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

const truthy = v => /^(y|yes|true|1|dd|x)$/i.test(String(v || '').trim());

/**
 * Convert CSV text to a question set:
 * { rounds: { 1: {categories:[{name, clues:[{clue,answer,value,dd}]}]}, 2: {...} },
 *   final: {category, clue, answer} | null }
 * Returns { set, errors, warnings }.
 */
export function csvToSet(text) {
  const errors = [];
  const warnings = [];
  const rows = parseCSVRows(text);
  if (!rows.length) return { set: emptySet(), errors: ['The file is empty.'], warnings };

  // Header detection: map columns by name if a header row exists, else assume default order.
  let idx = Object.fromEntries(HEADERS.map((h, i) => [h, i]));
  const first = rows[0].map(c => c.trim().toLowerCase().replace(/\s+/g, '_'));
  if (first.includes('round') && first.includes('clue')) {
    idx = {};
    HEADERS.forEach(h => { idx[h] = first.indexOf(h); });
    if (idx.daily_double < 0) idx.daily_double = first.indexOf('dd');
    if (idx.answer < 0) idx.answer = first.indexOf('response');
    if (idx.clue < 0) idx.clue = first.indexOf('question');
    rows.shift();
  }
  const get = (r, k) => (idx[k] >= 0 && r[idx[k]] != null ? String(r[idx[k]]).trim() : '');

  const set = emptySet();
  rows.forEach((r, i) => {
    const line = i + 2;
    const roundRaw = get(r, 'round').toLowerCase();
    const category = get(r, 'category');
    const clue = get(r, 'clue');
    const answer = get(r, 'answer');
    const valueRaw = get(r, 'value').replace(/[$,₹\s]/g, '');
    const round = /^(f|final|fj)/.test(roundRaw) ? 'final'
      : /^(2|double|dj|ii)/.test(roundRaw) ? '2'
      : /^(1|single|j|i)$/.test(roundRaw) || roundRaw === '' ? '1' : null;

    if (!round) { errors.push(`Line ${line}: unknown round "${get(r, 'round')}" (use 1, 2 or final).`); return; }
    if (!category) errors.push(`Line ${line}: missing category.`);
    if (!clue) errors.push(`Line ${line}: missing clue.`);
    if (!answer) warnings.push(`Line ${line}: missing answer.`);

    if (round === 'final') {
      if (set.final) warnings.push(`Line ${line}: more than one final clue — using the last one.`);
      set.final = { category, clue, answer };
      return;
    }
    let value = null;
    if (valueRaw) {
      value = Number(valueRaw);
      if (!Number.isFinite(value) || value <= 0) { warnings.push(`Line ${line}: value "${get(r, 'value')}" is not a number — using the default.`); value = null; }
    }
    const cats = set.rounds[round].categories;
    let cat = cats.find(c => c.name.toLowerCase() === category.toLowerCase());
    if (!cat) { cat = { name: category, clues: [] }; cats.push(cat); }
    cat.clues.push({ clue, answer, value, dd: truthy(get(r, 'daily_double')) });
  });

  // Sort clues by value when every clue in a category has one.
  for (const r of ['1', '2']) {
    for (const cat of set.rounds[r].categories) {
      if (cat.clues.every(c => c.value != null)) cat.clues.sort((a, b) => a.value - b.value);
    }
  }
  validateSet(set, errors, warnings);
  return { set, errors, warnings };
}

export function emptySet() {
  return { rounds: { 1: { categories: [] }, 2: { categories: [] } }, final: null };
}

export function validateSet(set, errors = [], warnings = []) {
  const r1 = set.rounds['1'].categories;
  const r2 = set.rounds['2'].categories;
  if (!r1.length) errors.push('Round 1 has no categories.');
  if (!r2.length) warnings.push('Round 2 (Double) has no categories — the game will go straight from Round 1 to the Final.');
  if (!set.final) warnings.push('No final clue — the game will end after the last round.');
  for (const [name, cats] of [['Round 1', r1], ['Round 2', r2]]) {
    if (cats.length > 6) warnings.push(`${name} has ${cats.length} categories; 6 fit best on a TV.`);
    const counts = new Set(cats.map(c => c.clues.length));
    if (counts.size > 1) warnings.push(`${name}: categories have different numbers of clues (${[...counts].join(', ')}); missing tiles will show as blank.`);
    for (const c of cats) if (c.clues.length > 5) warnings.push(`${name} / ${c.name}: ${c.clues.length} clues — 5 fit best.`);
    const pinned = cats.flatMap(c => c.clues).filter(c => c.dd).length;
    if (pinned) warnings.push(`${name}: ${pinned} clue(s) pinned as Daily Double in the CSV (random placement is off for this round).`);
  }
  return { errors, warnings };
}

const esc = v => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Serialize a question set back to CSV text. */
export function setToCSV(set) {
  const lines = [HEADERS.join(',')];
  for (const r of ['1', '2']) {
    for (const cat of set.rounds[r].categories) {
      for (const c of cat.clues) {
        lines.push([r, cat.name, c.value ?? '', c.clue, c.answer, c.dd ? 'yes' : ''].map(esc).join(','));
      }
    }
  }
  if (set.final) lines.push(['final', set.final.category, '', set.final.clue, set.final.answer, ''].map(esc).join(','));
  return lines.join('\n') + '\n';
}
