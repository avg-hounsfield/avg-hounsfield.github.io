/**
 * Each case in clinical-gold.json is a search that must not embarrass us.
 * Add a case whenever a bad match is found, before fixing it.
 *
 * Run: node --test tests/*.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveQuery } from '../js/scenario-ranker.js';

const read = url => JSON.parse(readFileSync(new URL(url, import.meta.url), 'utf8'));
const { scenarios } = read('../data/search/scenario_names.json');
const { cases } = read('./clinical-gold.json');

// Everything a result puts in front of the user. The topics a chooser or a
// recovery screen suggests are judged by "not" exactly as answers are.
function shownNames(result) {
  if (result.mode === 'guide') return scenarios.filter(s => s.topic === result.topic).map(s => s.name);
  if (result.mode === 'list') return result.scenarios.map(s => s.name);
  if (result.mode === 'choose') return result.topics.map(t => t.topic);
  if (result.mode === 'recover') return result.groups.flatMap(g => g.topics.map(t => t.topic));
  return [];
}

// A guide shows a whole topic grouped by recommendation, so its "name" check
// passes when any scenario of the topic matches; a list is judged by its first.
// "recover" is a non-answer like "none": a case expecting an answer fails on
// either, and a case expecting "none" accepts either.
for (const c of cases) {
  test(`gold: ${c.q}`, () => {
    const result = resolveQuery(c.q, scenarios);
    const shown = shownNames(result);
    const seen = JSON.stringify({ mode: result.mode, topic: result.topic, first: shown[0] });
    const deadEnd = result.mode === 'none' || result.mode === 'recover';
    if (c.mode !== 'none') assert.ok(!deadEnd, seen);
    if (c.mode && !(c.mode === 'none' && result.mode === 'recover')) assert.equal(result.mode, c.mode, seen);
    if (c.topic) assert.equal(result.topic, c.topic, seen);
    if (c.name) {
      const re = new RegExp(c.name);
      assert.ok(result.mode === 'guide' || result.mode === 'choose' ? shown.some(n => re.test(n)) : re.test(shown[0] || ''), seen);
    }
    if (c.not) for (const name of shown) assert.doesNotMatch(name, new RegExp(c.not), seen);
  });
}
