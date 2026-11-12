import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSVRows, csvToSet, setToCSV } from '../src/csv.js';

test('parses quotes, escaped quotes, commas and CRLF', () => {
  const rows = parseCSVRows('a,"b, c","say ""hi"""\r\n1,2,3\r\n');
  assert.deepEqual(rows, [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
});

test('multiline quoted fields and BOM', () => {
  const rows = parseCSVRows('﻿x,"line1\nline2"\n');
  assert.deepEqual(rows, [['x', 'line1\nline2']]);
});

test('csvToSet groups by round/category, sorts by value, reads final and DD', () => {
  const { set, errors } = csvToSet(
    'round,category,value,clue,answer,daily_double\n' +
    '1,Cat,400,second,B,\n1,Cat,200,first,A,\n2,Two,,c,C,yes\nfinal,F,,fc,fa,\n');
  assert.deepEqual(errors, []);
  assert.deepEqual(set.rounds['1'].categories[0].clues.map(c => c.clue), ['first', 'second']);
  assert.equal(set.rounds['2'].categories[0].clues[0].dd, true);
  assert.equal(set.rounds['2'].categories[0].clues[0].value, null);
  assert.deepEqual(set.final, { category: 'F', clue: 'fc', answer: 'fa' });
});

test('reports helpful errors', () => {
  const { errors } = csvToSet('round,category,value,clue,answer\nzzz,Cat,200,x,y\n1,,200,,y\n');
  assert.ok(errors.some(e => /unknown round/.test(e)));
  assert.ok(errors.some(e => /missing category/.test(e)));
  assert.ok(errors.some(e => /missing clue/.test(e)));
});

test('round trips through setToCSV', () => {
  const src = 'round,category,value,clue,answer,daily_double\n1,"A, B",200,"He said ""hi""",x,yes\nfinal,F,,c,a,\n';
  const { set } = csvToSet(src);
  const again = csvToSet(setToCSV(set)).set;
  assert.deepEqual(again, set);
});
