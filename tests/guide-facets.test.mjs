/**
 * Narrowing buttons on topic guides (js/guide-facets.js), checked against
 * every ACR topic in the shipped data.
 *
 * Run: node --test tests/*.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  buildFacetModel, facetState, applySelection, toggleOption, clicksToReach, splitName, acrSourceUrl,
} from '../js/guide-facets.js';

const load = path => JSON.parse(readFileSync(new URL(`../data/${path}`, import.meta.url), 'utf8'));
const scenarios = load('search/scenario_names.json').scenarios;
const byTopic = new Map();
for (const s of scenarios) {
  if (!byTopic.has(s.topic)) byTopic.set(s.topic, []);
  byTopic.get(s.topic).push(s);
}
const models = new Map([...byTopic].map(([topic, list]) => [topic, buildFacetModel(list)]));
const model = topic => models.get(topic);
const names = list => list.map(s => s.name);
const optionId = (state, label) => {
  for (const g of state.groups) for (const o of g.options) if (o.label === label) return o.id;
  assert.fail(`no button "${label}"; have: ${state.groups.flatMap(g => g.options.map(o => o.label)).join(' | ')}`);
};
// Presses buttons by label, one after another, as a user would.
const press = (topic, ...labels) => {
  let selection = [];
  for (const label of labels) {
    const state = facetState(model(topic), selection);
    const id = optionId(state, label);
    const option = state.groups.flatMap(g => g.options).find(o => o.id === id);
    assert.ok(!option.disabled, `"${label}" is disabled`);
    selection = toggleOption(selection, id);
  }
  return facetState(model(topic), selection);
};

// Deterministic pseudo-random numbers so a failure reproduces.
function rng(seed) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

test('with nothing pressed every topic shows all of its scenarios', () => {
  for (const [topic, list] of byTopic) {
    const state = facetState(model(topic), []);
    assert.equal(state.remaining.length, list.length, topic);
    assert.deepEqual(state.selection, [], topic);
  }
});

test('every offered button says how many scenarios it leaves, and none leaves zero unless disabled', () => {
  const random = rng(7);
  for (const [topic] of byTopic) {
    const m = model(topic);
    // Every first press, then random walks three presses deep.
    const starts = facetState(m, []).groups.flatMap(g => g.options).map(o => [o.id]);
    const walks = [...starts];
    for (let i = 0; i < 12; i++) walks.push(null);
    for (const start of walks) {
      let selection = [];
      for (let depth = 0; depth < 4; depth++) {
        const state = facetState(m, selection);
        assert.equal(state.remaining.length, applySelection(m, selection).length, topic);
        assert.ok(state.remaining.length > 0, `${topic}: ${selection.join(' + ')} leaves nothing`);
        const options = state.groups.flatMap(g => g.options);
        for (const o of options) {
          const after = applySelection(m, toggleOption(selection, o.id)).length;
          if (o.pressed) continue;
          assert.equal(after, o.count, `${topic}: "${o.label}" after ${selection.join(' + ')}`);
          assert.equal(o.disabled, after === 0, `${topic}: "${o.label}" after ${selection.join(' + ')}`);
        }
        const open = options.filter(o => !o.pressed && !o.disabled);
        if (open.length === 0) break;
        const next = depth === 0 && start ? start[0] : open[Math.floor(random() * open.length)].id;
        selection = toggleOption(selection, next);
      }
    }
  }
});

test('buttons come from the topic itself: no topic offers a button that does not narrow it', () => {
  for (const [topic, list] of byTopic) {
    for (const g of facetState(model(topic), []).groups) {
      for (const o of g.options) {
        assert.ok(o.count > 0 && o.count < list.length, `${topic}: "${o.label}" leaves ${o.count} of ${list.length}`);
      }
    }
  }
});

test('negation is respected: "no trauma" and "not pregnant" scenarios are never under Trauma or Pregnant', () => {
  let traumaTopics = 0;
  for (const [topic] of byTopic) {
    const m = model(topic);
    const state = facetState(m, []);
    const ids = state.groups.flatMap(g => g.options).map(o => o.id);
    if (ids.includes('trauma:yes')) {
      traumaTopics++;
      for (const s of applySelection(m, ['trauma:yes'])) {
        const parts = splitName(s.name).map(p => p.toLowerCase());
        assert.ok(!parts.some(p => /^(no|without) (hx of |history of )?trauma$|^non-?traumatic$|^atraumatic$/.test(p)), `${topic}: ${s.name}`);
      }
    }
    if (ids.includes('pregnancy:yes')) {
      for (const s of applySelection(m, ['pregnancy:yes'])) {
        assert.ok(!/\b(not|non)[ -]?pregnan/i.test(s.name), `${topic}: ${s.name}`);
        assert.ok(/pregnan/i.test(`${s.name} ${s.search}`), `${topic}: ${s.name}`);
      }
    }
  }
  assert.ok(traumaTopics >= 5);
  // A worked case: new seizure with and without trauma.
  assert.deepEqual(names(press('Seizures and Epilepsy', 'Trauma').remaining), ['Seizure, new, hx of trauma, initial imaging']);
  assert.ok(!names(press('Seizures and Epilepsy', 'No trauma').remaining).includes('Seizure, new, hx of trauma, initial imaging'));
  assert.ok(names(press('Seizures and Epilepsy', 'No trauma').remaining).includes('Seizure, new, no trauma, initial imaging'));
});

test('Low Back Pain: acute then no red flags reaches "usually not appropriate"; cauda equina reaches MRI', () => {
  const acute = press('Low Back Pain', 'Acute');
  // Acute keeps the scenarios that name no duration: they apply at any duration.
  assert.ok(names(acute.remaining).includes('Low back pain, cauda equina syndrome suspected, initial imaging'));
  assert.ok(!names(acute.remaining).some(n => /, (chronic|subacute),/.test(n)));

  const routine = press('Low Back Pain', 'Acute', 'No red flags');
  assert.deepEqual(names(routine.remaining), ['Low back pain, acute, no red flags, no prior management, initial imaging']);
  assert.equal(routine.remaining[0].top_tier.level, 'Usually Not Appropriate');

  const allNoFlags = press('Low Back Pain', 'No red flags');
  assert.equal(allNoFlags.remaining.length, 3);
  assert.ok(allNoFlags.remaining.every(s => s.top_tier.level === 'Usually Not Appropriate'));

  const cauda = press('Low Back Pain', 'Cauda equina syndrome suspected');
  assert.equal(cauda.remaining.length, 1);
  assert.equal(cauda.remaining[0].top_tier.level, 'Usually Appropriate');
  assert.ok(cauda.remaining[0].top_tier.studies.every(s => s.startsWith('MRI lumbar spine')));
});

test('"chronic steroid use" is a feature, not a duration', () => {
  const chronic = press('Low Back Pain', 'Chronic');
  const steroid = 'Low back pain, chronic steroid use, initial imaging';
  // Kept under every duration because it states none.
  assert.ok(names(chronic.remaining).includes(steroid));
  assert.ok(names(press('Low Back Pain', 'Acute').remaining).includes(steroid));
  assert.deepEqual(names(press('Low Back Pain', 'Chronic steroid use').remaining), [steroid]);
});

test('Headache: pregnancy and red flags narrow to the right scenarios', () => {
  const pregnant = press('Headache', 'Pregnant');
  assert.ok(pregnant.remaining.length >= 2);
  assert.ok(pregnant.remaining.every(s => /pregnant/.test(s.name)));
  const plain = press('Headache', 'No red flags');
  assert.deepEqual(names(plain.remaining), ['Headache, no red flags, initial imaging']);
  // The no-red-flags description lists pregnancy and trauma only to exclude them.
  assert.ok(!names(pregnant.remaining).includes('Headache, no red flags, initial imaging'));
  const fever = press('Headache', 'Fever');
  assert.deepEqual(names(fever.remaining), ['Headache, fever, initial imaging']);
});

test('child and adult are offered only where a topic has both', () => {
  for (const [topic, list] of byTopic) {
    const ids = facetState(model(topic), []).groups.flatMap(g => g.options).map(o => o.id);
    if (!ids.includes('age:child')) continue;
    assert.ok(list.some(s => s.age === 'pediatric') && list.some(s => s.age !== 'pediatric'), topic);
    for (const s of applySelection(model(topic), ['age:child'])) {
      assert.ok(s.age === 'pediatric' || /adults? or child/i.test(s.search), `${topic}: ${s.name}`);
    }
  }
});

test('pressing works like the buttons: one choice per attribute, features add up, a second press clears', () => {
  assert.deepEqual(toggleOption([], 'timing:acute'), ['timing:acute']);
  assert.deepEqual(toggleOption(['timing:acute'], 'timing:chronic'), ['timing:chronic']);
  assert.deepEqual(toggleOption(['timing:acute'], 'timing:acute'), []);
  assert.deepEqual(toggleOption(['timing:acute', 'f:feature:a'], 'f:feature:b'), ['timing:acute', 'f:feature:a', 'f:feature:b']);
  assert.deepEqual(toggleOption(['f:feature:a', 'timing:acute'], 'redflag:no'), ['f:feature:a', 'timing:acute', 'redflag:no']);
  // Ids a topic does not have are ignored rather than emptying the guide.
  assert.equal(facetState(model('Low Back Pain'), ['pregnancy:yes', 'f:feature:nope']).remaining.length, 15);
});

test('names split on commas outside brackets', () => {
  assert.deepEqual(splitName('A, b (c, d), e.'), ['A', 'b (c, d)', 'e']);
});

test('coverage: nearly every topic gets at least two useful buttons, and two presses usually reach one scenario', () => {
  let multi = 0;
  let twoPlus = 0;
  const clicks = [];
  let unreachable = 0;
  for (const [topic, list] of byTopic) {
    if (list.length < 2) continue;
    multi++;
    const offered = facetState(model(topic), []).groups.flatMap(g => g.options).filter(o => !o.disabled);
    if (offered.length >= 2) twoPlus++;
    for (const s of list) {
      const n = clicksToReach(model(topic), s);
      if (n === null) unreachable++;
      else clicks.push(n);
    }
  }
  clicks.sort((a, b) => a - b);
  assert.ok(twoPlus >= multi - 2, `${twoPlus} of ${multi} topics have two or more buttons`);
  assert.ok(clicks[Math.floor(clicks.length / 2)] <= 2, 'median presses to one scenario');
  assert.ok(unreachable / (unreachable + clicks.length) < 0.06, `${unreachable} scenarios cannot be singled out`);
});

test('the ACR source link built from a scenario id is the one the region data carries', () => {
  const dir = new URL('../data/regions/', import.meta.url);
  let checked = 0;
  for (const file of readdirSync(dir)) {
    for (const s of JSON.parse(readFileSync(new URL(file, dir), 'utf8')).scenarios) {
      assert.equal(acrSourceUrl(s.id), s.sourceUrl, s.id);
      checked++;
    }
  }
  assert.ok(checked >= 3984);
});
