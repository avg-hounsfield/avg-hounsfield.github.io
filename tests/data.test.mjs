/**
 * Checks on the generated scenario data. Rebuild with tools/build_scenarios.py.
 *
 * Run: node --test tests/*.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { topicSlug } from '../js/scenario-ranker.js';

const load = path => JSON.parse(readFileSync(new URL(`../data/${path}`, import.meta.url), 'utf8'));
const regionFiles = readdirSync(new URL('../data/regions/', import.meta.url));
const regions = Object.fromEntries(regionFiles.map(f => [f.replace('.json', ''), load(`regions/${f}`)]));
const scenarios = load('search/scenario_names.json').scenarios;
const full = new Map(Object.values(regions).flatMap(r => r.scenarios).map(s => [s.id, s]));

test('no region lists a scenario twice', () => {
  for (const [name, region] of Object.entries(regions)) {
    const ids = region.scenarios.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length, name);
  }
});

test('every indexed scenario has full data, a topic and a source', () => {
  assert.ok(scenarios.length >= 3984);
  for (const s of scenarios) {
    const f = full.get(s.id);
    assert.ok(f, s.id);
    assert.ok(f.topic && f.variant && f.sourceUrl && f.capturedAt, s.id);
    assert.ok(f.procedures.length > 0, s.id);
  }
});

test('procedure types the old import dropped are present', () => {
  const names = [...full.values()].flatMap(s => s.procedures.map(p => p.name));
  for (const prefix of ['MRA head', 'MRV head', 'Bone scan', 'Image-guided', 'SPECT', 'Arteriography']) {
    assert.ok(names.some(n => n.startsWith(prefix)), prefix);
  }
});

test('ACR disagreement flags survive', () => {
  const flagged = [...full.values()].flatMap(s => s.procedures).filter(p => p.hasDisagreement);
  assert.ok(flagged.length > 1000, String(flagged.length));
});

test('the pediatric page holds the pediatric scenarios', () => {
  assert.ok(regions.peds.count > 500, String(regions.peds.count));
  assert.ok(regions.peds.scenarios.every(s => s.ageGroup === 'pediatric'));
});

test('identical names never hide different recommendations across topics', () => {
  const seen = new Map();
  for (const s of scenarios) {
    const tier = `${s.top_tier.level}:${[...s.top_tier.studies].sort()}`;
    const prior = seen.get(s.name);
    if (prior) assert.ok(prior.topic === s.topic || prior.tier === tier, s.name);
    seen.set(s.name, { topic: s.topic, tier });
  }
});

test('copied portal text is not published', () => {
  for (const s of full.values()) {
    assert.ok(!JSON.stringify(s).includes('ACR AC Portal'), s.id);
    assert.equal(s.description, undefined);
  }
});

test('every topic has a static page at the slug the app links to', () => {
  const topics = [...new Set(scenarios.map(s => s.topic))];
  const missing = topics.filter(t => !existsSync(new URL(`../topics/${topicSlug(t)}/index.html`, import.meta.url)));
  assert.deepEqual(missing, []);
});
