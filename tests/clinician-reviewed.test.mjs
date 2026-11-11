/**
 * Searches whose answers a clinician has reviewed (tests/clinician-reviewed.json).
 * Each case carries the id of the review row it came from; the marked-up rows
 * are kept in docs/review/verdicts. Unlike the other gold sets, these are not
 * Claude's reading of the ACR data: change one only on a clinician's word.
 *
 * Case keys:
 *   topic  the guide that must open
 *   mode   the kind of result
 *   first  regex the first thing shown must match
 *   shows  regexes that must each match something shown
 *   not    regex nothing shown may match
 *
 * Run: node --test tests/*.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveQuery } from '../js/scenario-ranker.js';

const read = url => JSON.parse(readFileSync(new URL(url, import.meta.url), 'utf8'));
const { scenarios } = read('../data/search/scenario_names.json');
const { cases } = read('./clinician-reviewed.json');

// What a result puts in front of the user: a guide's scenarios, a list's
// scenarios, or the topics a chooser offers.
function shownNames(result) {
  if (result.mode === 'guide') return scenarios.filter(s => s.topic === result.topic).map(s => s.name);
  if (result.mode === 'list') return result.scenarios.map(s => s.name);
  if (result.mode === 'choose') return result.topics.map(t => t.topic);
  if (result.mode === 'recover') return result.groups.flatMap(g => g.topics.map(t => t.topic));
  return [];
}

for (const c of cases) {
  test(`reviewed ${c.review}: ${c.q}`, () => {
    const result = resolveQuery(c.q, scenarios);
    const shown = shownNames(result);
    const seen = JSON.stringify({ mode: result.mode, topic: result.topic, shown: shown.slice(0, 6) });
    assert.ok(result.mode !== 'none' && result.mode !== 'recover', seen);
    if (c.mode) assert.equal(result.mode, c.mode, seen);
    if (c.topic) assert.equal(result.topic, c.topic, seen);
    if (c.first) assert.match(shown[0] || '', new RegExp(c.first), seen);
    for (const want of c.shows || []) assert.ok(shown.some(n => new RegExp(want).test(n)), `${want} missing: ${seen}`);
    if (c.not) for (const name of shown) assert.doesNotMatch(name, new RegExp(c.not), seen);
  });
}

// Review rows about the data itself.
const regionFiles = ['abdomen', 'breast', 'chest', 'msk', 'neuro', 'other', 'spine', 'vascular'];
const full = regionFiles.flatMap(r => read(`../data/regions/${r}.json`).scenarios);

test('reviewed F-28: the brain aneurysm and subarachnoid topic is filed under Neuro', () => {
  const topic = 'Cerebrovascular Diseases-Aneurysm, Vascular Malformation, and Subarachnoid Hemorrhage';
  const regions = new Set(scenarios.filter(s => s.topic === topic).map(s => s.region));
  assert.deepEqual([...regions], ['neuro']);
});

test('reviewed F-29: no two topics differ only by a dash', () => {
  const key = t => t.replace(/\s*[-–—]\s*/g, '-').toLowerCase();
  const byKey = new Map();
  for (const s of scenarios) byKey.set(key(s.topic), (byKey.get(key(s.topic)) || new Set()).add(s.topic));
  assert.deepEqual([...byKey.values()].filter(set => set.size > 1).map(set => [...set]), []);
});

test('reviewed F-30: every recommended study has a name, not a number', () => {
  const numeric = full.flatMap(s => s.procedures.filter(p => /^\d+$/.test(p.name)).map(p => `${s.id} ${s.name}: ${p.name}`));
  assert.deepEqual(numeric, []);
  const di = full.find(s => String(s.id) === '396');
  assert.equal(di.procedures[0].name, 'MRI sella without and with IV contrast');
});
