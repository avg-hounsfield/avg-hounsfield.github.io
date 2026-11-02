/**
 * Clinical routing regression tests for js/scenario-ranker.js.
 *
 * These check that a search reaches the correct ACR scenario, not just the
 * right topic. Expected ids come from data/search/scenario_names.json.
 *
 * Run: node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rankScenarios, resolveQuery, chooseTopic, buildTopicGuide } from '../js/scenario-ranker.js';

const { scenarios } = JSON.parse(
  readFileSync(new URL('../data/search/scenario_names.json', import.meta.url), 'utf8')
);

const top = (query, n) => rankScenarios(query, scenarios, { max: n });

// [query, ids of which at least one must appear, within the top n results]
const MUST_FIND = [
  ['back pain with cauda equina', ['5623'], 1],
  ['low back pain no red flags', ['5618'], 1],
  ['rlq pain pregnant', ['6316'], 1],
  ['PE in pregnancy', ['6225'], 1],
  ['appendicitis in a child', ['4665', '4666', '4667'], 3],
  ['kidney stones', ['7217', '7216'], 3],
  ['kidney stones pregnant', ['7220'], 1],
  ['thunderclap headache', ['1145'], 1],
  ['scaphoid fracture', ['7316', '7317', '7318', '1181', '4618', '4621', '4622'], 3],
  ['elevated lfts', ['7151', '7152', '7153', '7154'], 5],
  ['chest pain low risk', ['652', '654'], 3],
  ['hemoptysis in a smoker', ['5246', '5245', '5247'], 5],
  ['aortic dissection', ['5554'], 1],
  ['aortic dissection surveillance', ['8011', '8013'], 2],
];

for (const [query, ids, n] of MUST_FIND) {
  test(`"${query}" finds ${ids.join('/')} in top ${n}`, () => {
    const got = top(query, n).map(s => s.id);
    assert.ok(ids.some(id => got.includes(id)), `got ${got.join(', ')}`);
  });
}

test('child searches never return adult-only scenarios', () => {
  for (const s of top('appendicitis in a child', 8)) assert.notEqual(s.age, 'adult', s.name);
});

test('pregnancy searches return only pregnancy scenarios', () => {
  for (const s of top('pe in pregnancy', 8)) assert.match(s.name, /pregnan/i);
});

test('pregnancy scenarios do not lead searches that never mention pregnancy', () => {
  const [first] = top('kidney stones', 1);
  assert.doesNotMatch(first.name, /pregnan/i);
});

test('a pregnancy qualifier with no matching topic returns nothing', () => {
  assert.deepEqual(top('zzzqqq pregnant', 8), []);
});

test('results do not repeat identical scenario lines', () => {
  const lines = top('acute stroke', 8).map(s => `${s.name}|${s.top_procedure?.name}`);
  assert.equal(new Set(lines).size, lines.length);
});

test('minor head injury leads with adult mild head trauma', () => {
  assert.match(top('ct head after minor head injury', 1)[0].name, /^Head trauma, acute, mild/);
});

test('a closer wording outranks one with extra qualifiers', () => {
  const first = top('breast cancer screening average risk', 1)[0];
  assert.match(first.name, /^Breast cancer screening, average risk/);
});

test('modality words do not change the matched scenario', () => {
  assert.equal(top('mri for cauda equina', 1)[0].id, '5623');
});

const GUIDES = [
  ['headache', 'Headache'],
  ['back pain', 'Low Back Pain'],
  ['hematuria', 'Hematuria'],
  ['kidney stones', 'Acute Onset Flank Pain-Suspicion of Stone Disease (Urolithiasis)'],
  ['suspected pulmonary embolism', 'Suspected Pulmonary Embolism'],
  ['aortic dissection', 'Suspected Acute Aortic Syndrome'],
  ['headache in a child', 'Headache-Child'],
  ['dementia', 'Dementia'],
];

for (const [query, topic] of GUIDES) {
  test(`"${query}" opens the ${topic} guide`, () => {
    const result = resolveQuery(query, scenarios);
    assert.equal(result.mode, 'guide', JSON.stringify(result).slice(0, 200));
    assert.equal(result.topic, topic);
  });
}

test('qualified searches go to specific scenarios, not a guide', () => {
  for (const q of ['back pain with cauda equina', 'rlq pain pregnant', 'low back pain no red flags']) {
    assert.equal(resolveQuery(q, scenarios).mode, 'list', q);
  }
});

test('a study name lists the scenarios that use it', () => {
  const result = resolveQuery('mra head', scenarios);
  assert.equal(result.mode, 'list');
  assert.ok(result.scenarios.length > 0);
  for (const s of result.scenarios) assert.ok(s.top_tier.studies.some(n => /^MRA head/.test(n)), s.name);
});

test('a condition plus a study still finds the condition', () => {
  assert.equal(top('mri for cauda equina', 1)[0].id, '5623');
  assert.equal(resolveQuery('ct head after minor head injury', scenarios).mode, 'list');
});

test('ACR name typos are corrected', () => {
  assert.ok(!scenarios.some(s => /Low pack pain/.test(s.name)));
});

test('one-word searches matching most of ACR ask for more detail', () => {
  for (const q of ['pain', 'mass']) assert.equal(resolveQuery(q, scenarios).mode, 'too-broad', q);
});

test('a pregnancy qualifier with no scenario is stated, not dropped', () => {
  const result = resolveQuery('scoliosis in pregnancy', scenarios);
  assert.equal(result.mode, 'list');
  assert.match(result.notice, /pregnancy/);
});

test('topic guides group scenarios by recommendation', () => {
  const groups = buildTopicGuide('Low Back Pain', scenarios);
  assert.ok(groups.length > 1);
  const noRedFlags = groups.find(g => g.scenarios.some(s => /acute, no red flags/.test(s.name)));
  assert.notEqual(noRedFlags.level, 'Usually Appropriate');
  const count = groups.reduce((n, g) => n + g.scenarios.length, 0);
  assert.equal(count, scenarios.filter(s => s.topic === 'Low Back Pain').length);
});

test('nearly every ACR topic title opens its own topic', () => {
  const topics = [...new Set(scenarios.map(s => s.topic))];
  const misses = topics.filter(t => (chooseTopic(t, scenarios) || {}).topic !== t);
  assert.ok(misses.length / topics.length < 0.05, `${misses.length}: ${misses.slice(0, 12).join(' | ')}`);
});

test('scenarios for adults or children count for both', () => {
  assert.equal(scenarios.find(s => s.id === '5319').age, 'any');
  const ids = top('adult knee pain after fall', 8).map(s => s.id);
  assert.ok(ids.includes('5319'), ids.join(', '));
});

test('infant scenarios are never labelled adult', () => {
  assert.equal(scenarios.find(s => s.id === '5402').age, 'pediatric');
});

test('equally rated studies are all kept, in one tier', () => {
  const tier = scenarios.find(s => s.id === '6225').top_tier;
  assert.equal(tier.level, 'Usually Appropriate');
  assert.ok(tier.studies.some(n => /CTA pulmonary/.test(n)), tier.studies.join(', '));
});

test('knee tear searches reach internal derangement scenarios', () => {
  for (const q of ['acl tear', 'meniscus tear']) assert.match(top(q, 1)[0].name, /internal derangement/);
});
