/**
 * Suggestions while typing (js/search-suggest.js), against the shipped data
 * and the search itself: a suggestion must never lead to a dead end.
 *
 * Run: node --test tests/*.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSuggestIndex, suggest, SUGGEST_MAX, SUGGEST_GROUPS } from '../js/search-suggest.js';
import { resolveQuery, _aliasTables } from '../js/scenario-ranker.js';
import { conceptNormalize } from '../js/concept-matcher.js';
import { MINED_ALIASES } from '../js/aliases-mined.js';

const load = path => JSON.parse(readFileSync(new URL(`../data/${path}`, import.meta.url), 'utf8'));
// The scenario index as js/app.js builds it.
const scenarios = load('search/scenario_names.json').scenarios.map(s => ({
  ...s,
  normName: conceptNormalize(s.name),
  normKeywords: Array.isArray(s.keywords) && s.keywords.length ? conceptNormalize(s.keywords.join(' ')) : '',
}));
const topics = load('search/topics.json').topics.map(t => ({ name: t.name, count: t.ids.length }));
const phrases = _aliasTables().all.map(pair => pair[0]);

// The same check js/app.js gives the suggester.
const checkPhrase = phrase => {
  const r = resolveQuery(phrase, scenarios);
  if (r.corrected) return null;
  if (r.mode === 'guide') return r.topic;
  if (r.mode === 'list') return `${r.scenarios.length} scenarios`;
  if (r.mode === 'choose') return 'Several topics';
  return null;
};
const index = buildSuggestIndex({ topics, scenarios, phrases });
const ask = q => suggest(index, q, { checkPhrase });
const labels = (items, kind) => items.filter(i => i.kind === kind).map(i => i.label);

test('nothing is offered for one letter or an empty box', () => {
  assert.deepEqual(ask(''), []);
  assert.deepEqual(ask(' h '), []);
});

test('at most eight, grouped topics then phrasings then scenarios', () => {
  for (const q of ['he', 'head', 'back pain', 'chest', 'pe', 'knee', 'fall', 'low back', 'breast ca', 'preg', 'stroke', 'sob']) {
    const items = ask(q);
    assert.ok(items.length > 0 && items.length <= SUGGEST_MAX, `${q}: ${items.length}`);
    const order = items.map(i => SUGGEST_GROUPS.findIndex(g => g.kind === i.kind));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), q);
  }
});

test('a topic that begins with what was typed comes first', () => {
  assert.equal(ask('heada')[0].label, 'Headache');
  assert.equal(ask('low back')[0].label, 'Low Back Pain');
  assert.equal(ask('head tr')[0].label, 'Head Trauma');
  const items = labels(ask('chronic'), 'topic');
  assert.ok(items.length >= 3 && items.every(t => /^chronic/i.test(t)), items.join(' | '));
});

test('scenario names are offered, with their topic, and carry the scenario ids', () => {
  const items = ask('cauda equina');
  const hit = items.find(i => i.kind === 'scenario' && /cauda equina/i.test(i.label));
  assert.ok(hit, JSON.stringify(items.map(i => i.label)));
  assert.equal(hit.detail, 'Low Back Pain');
  assert.deepEqual(hit.ids, ['5623']);
  // Words in any order still find the scenario.
  assert.ok(labels(ask('equina cauda'), 'scenario').some(l => /cauda equina/i.test(l)));
});

test('clinician phrasings are offered as typed and say where they lead', () => {
  const semen = ask('blood in se').find(i => i.kind === 'phrase');
  assert.ok(semen, 'a phrasing for "blood in se"');
  assert.equal(semen.label, 'blood in semen');
  assert.equal(semen.detail, 'Hematospermia');
  assert.ok(labels(ask('foosh'), 'phrase').includes('foosh'));
  // The mined phrasings are part of the pool.
  assert.ok(MINED_ALIASES.length > 400);
  assert.ok(labels(ask('bloody ejac'), 'phrase').includes('bloody ejaculate'));
});

test('no suggestion leads to a dead end', () => {
  const probes = ['he', 'ch', 'pa', 'fa', 'af', 'wi', 'no', 'bl', 're', 'tu', 'st', 'ach', 'with', 'after', 'looks', 'red fl',
    'susp', 'conc', 'norm', 'rule', 'first', 'neg', 'pos', 'sta', 'ten', 'bru', 'query', 'fhx', 'chi', 'rig', 'hard', 'mvc', 'sob', 'pe', 'dvt'];
  let offered = 0;
  for (const q of probes) {
    for (const item of ask(q)) {
      if (item.kind !== 'phrase') continue;
      offered++;
      const r = resolveQuery(item.value, scenarios);
      assert.ok(['guide', 'list', 'choose'].includes(r.mode), `"${q}" offers "${item.value}" which gives ${r.mode}`);
    }
  }
  assert.ok(offered > 25, `${offered} checked`);
});

test('every topic title, typed in part, offers that topic and opens its guide', () => {
  for (const t of topics) {
    const typed = t.name.slice(0, -2);
    assert.ok(labels(ask(typed), 'topic').includes(t.name), `"${typed}" does not offer ${t.name}`);
    // js/app.js opens the chosen topic's guide itself, so the title only has
    // to be a topic that has scenarios.
    assert.ok(t.count > 0 && scenarios.some(s => s.topic === t.name), t.name);
  }
});

test('phrasings that the search cannot answer alone are never offered', () => {
  // "achy" and "with fever" are modifiers the search folds into other words.
  assert.ok(!labels(ask('achy'), 'phrase').includes('achy'));
  assert.ok(!labels(ask('with fev'), 'phrase').includes('with fever'));
});

test('fast enough to run on every keystroke over all scenarios', () => {
  const typed = 'low back pain with cauda equina syndrome';
  for (let i = 2; i <= typed.length; i++) ask(typed.slice(0, i)); // warm the phrase checks
  const start = performance.now();
  let calls = 0;
  for (let round = 0; round < 5; round++) {
    for (let i = 2; i <= typed.length; i++) {
      ask(typed.slice(0, i));
      calls++;
    }
  }
  const each = (performance.now() - start) / calls;
  assert.ok(each < 8, `${each.toFixed(2)} ms per keystroke`);

  // A cold keystroke checks a bounded number of phrasings against the search.
  const cold = buildSuggestIndex({ topics, scenarios, phrases });
  let checks = 0;
  suggest(cold, 'pa', { checkPhrase: p => { checks++; return checkPhrase(p); } });
  assert.ok(checks <= 8, `${checks} phrase checks on one keystroke`);
});

test('adult topics lead a search that names no child', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildSuggestIndex, suggest } = await import('../js/search-suggest.js');
  const { topics } = JSON.parse(readFileSync(new URL('../data/search/topics.json', import.meta.url), 'utf8'));
  const index = buildSuggestIndex({ topics: topics.map(t => ({ name: t.name, count: t.ids.length })) });
  const first = q => suggest(index, q).filter(s => s.kind === 'topic')[0].label;
  assert.equal(first('back pain'), 'Low Back Pain');
  assert.equal(first('headache'), 'Headache');
  assert.match(first('headache child'), /Child/);
});
