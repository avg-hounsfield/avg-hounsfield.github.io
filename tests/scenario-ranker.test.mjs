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
import { rankScenarios, isSpecificQuery } from '../js/scenario-ranker.js';

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

test('modality words do not change the matched scenario', () => {
  assert.equal(top('mri for cauda equina', 1)[0].id, '5623');
});

test('specificity separates bare topics from qualified searches', () => {
  assert.equal(isSpecificQuery('headache', 'headache'), false);
  assert.equal(isSpecificQuery('suspected pulmonary embolism', 'pulmonary embolism'), false);
  assert.equal(isSpecificQuery('back pain with cauda equina', 'back pain'), true);
  assert.equal(isSpecificQuery('appendicitis in a child', 'appendicitis'), true);
  assert.equal(isSpecificQuery('rlq pain pregnant', null), true);
  assert.equal(isSpecificQuery('kidney stones', 'kidney stone'), true);
});

test('scenarios for adults or children count for both', () => {
  assert.equal(scenarios.find(s => s.id === '5319').age, 'any');
  const ids = top('adult knee pain after fall', 8).map(s => s.id);
  assert.ok(ids.includes('5319'), ids.join(', '));
});

test('infant scenarios are never labelled adult', () => {
  assert.equal(scenarios.find(s => s.id === '5402').age, 'pediatric');
});

test('equally rated studies are kept alongside the first listed one', () => {
  const pePregnant = scenarios.find(s => s.id === '6225');
  assert.ok(pePregnant.also_rated.some(n => /CTA pulmonary/.test(n)), pePregnant.also_rated.join(', '));
});

test('every summary card topic but one reaches a real scenario', () => {
  const { cards } = JSON.parse(
    readFileSync(new URL('../data/search/summary_cards.json', import.meta.url), 'utf8')
  );
  const empty = cards.map(c => c.topic).filter(t => top(t, 1).length === 0);
  // ACR has no scenario worded for spondylosis; it uses the fallback search.
  assert.deepEqual(empty, ['spondylosis']);
});

test('knee tear searches reach internal derangement scenarios', () => {
  for (const q of ['acl tear', 'meniscus tear']) assert.match(top(q, 1)[0].name, /internal derangement/);
});
