/**
 * Red-team searches (tests/redteam-gold.json): adversarial clinical searches
 * written against the ACR data, each with the answer it must give. The suite
 * asserts two things: no case grades as embarrassing, and the pass count never
 * drops below the recorded floor. Raise the floor when more cases pass.
 *
 * Run: node --test tests/*.mjs
 * Detail: node tests/redteam-gold.test.mjs --list
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveQuery } from '../js/scenario-ranker.js';

const read = url => JSON.parse(readFileSync(new URL(url, import.meta.url), 'utf8'));
const { scenarios } = read('../data/search/scenario_names.json');
const { cases, pass_floor } = read('./redteam-gold.json');

// Everything a result puts in front of the user. The topics a chooser or a
// recovery screen suggests are judged by "not" exactly as answers are.
function shownNames(result) {
  if (result.mode === 'guide') return scenarios.filter(s => s.topic === result.topic).map(s => s.name);
  if (result.mode === 'list') return result.scenarios.map(s => s.name);
  if (result.mode === 'choose') return result.topics.map(t => t.topic);
  if (result.mode === 'recover') return result.groups.flatMap(g => g.topics.map(t => t.topic));
  return [];
}

/**
 * Returns [] when the case passes, else the reasons it fails. A guide shows a
 * whole topic grouped by recommendation, so its "name" check passes when any
 * scenario of the topic matches; a list is judged by its first result.
 * "recover" is a non-answer like "none": a case expecting an answer fails on
 * either, and a case expecting "none" accepts either.
 */
export function judge(c, result) {
  const shown = shownNames(result);
  const reasons = [];
  const deadEnd = result.mode === 'none' || result.mode === 'recover';
  if (c.mode !== 'none' && deadEnd) reasons.push(`mode ${result.mode}`);
  else if (c.mode && result.mode !== c.mode && !(c.mode === 'none' && result.mode === 'recover')) reasons.push(`mode ${result.mode}`);
  if (c.topic && result.topic !== c.topic) reasons.push(`topic ${result.topic}`);
  if (c.name) {
    const re = new RegExp(c.name);
    // A chooser offers whole topics, so like a guide it is judged by the
    // scenarios those topics hold as well as by their titles.
    const offered = result.mode === 'choose'
      ? [...shown, ...scenarios.filter(s => result.topics.some(t => t.topic === s.topic)).map(s => s.name)]
      : shown;
    const hit = result.mode === 'guide' || result.mode === 'choose' ? offered.some(n => re.test(n)) : re.test(shown[0] || '');
    if (!hit) reasons.push(`first "${shown[0] || ''}" !~ /${c.name}/`);
  }
  if (c.not) for (const name of shown) if (new RegExp(c.not).test(name)) reasons.push(`shown "${name}" ~ /${c.not}/`);
  return reasons;
}

const outcomes = cases.map(c => {
  const result = resolveQuery(c.q, scenarios);
  return { c, result, reasons: judge(c, result) };
});
const passing = outcomes.filter(o => o.reasons.length === 0);

if (process.argv.includes('--list')) {
  for (const o of outcomes) {
    if (o.reasons.length === 0) continue;
    const first = shownNames(o.result)[0] || o.result.topic || '';
    console.log(`${o.c.q}  -> ${o.result.mode} ${first.slice(0, 90)}  | ${o.reasons.join('; ')}`);
  }
  console.log(`\n${passing.length}/${cases.length} pass`);
}

test(`red-team gold: at least ${pass_floor} of ${cases.length} cases pass`, () => {
  const failing = outcomes.filter(o => o.reasons.length > 0).map(o => `${o.c.q} -> ${o.reasons.join('; ')}`);
  assert.ok(passing.length >= pass_floor, `${passing.length} pass; failing: ${failing.slice(0, 15).join(' | ')}`);
});

// A "not" pattern names an answer that would embarrass us; it must never show,
// whatever else happens to the case.
test('red-team gold: no forbidden answer is ever shown', () => {
  const shownForbidden = outcomes
    .filter(o => o.c.not && o.reasons.some(r => r.startsWith('shown')))
    .map(o => `${o.c.q}: ${o.reasons.filter(r => r.startsWith('shown')).join('; ')}`);
  assert.deepEqual(shownForbidden, []);
});
