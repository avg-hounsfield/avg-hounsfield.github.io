/**
 * Shape checks on the mined alias table (js/aliases-mined.js), which
 * tools/mine_aliases_gate.mjs writes. The behavioural guarantees (no gold
 * regression, no forbidden answer) are enforced by the gate and by the other
 * suites here; these checks make sure the table itself can only ever be read
 * the way the gate meant: phrases already in the form the alias step sees,
 * no hand-written phrase overridden, no negation or population word smuggled
 * in, and ACR wording made only of words ACR scenarios actually use.
 *
 * Run: node --test tests/*.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MINED_ALIASES } from '../js/aliases-mined.js';
import { _aliasTables, _normalizeAliasPhrase, _vocabulary, _stem } from '../js/scenario-ranker.js';

const { scenarios } = JSON.parse(readFileSync(new URL('../data/search/scenario_names.json', import.meta.url), 'utf8'));
const NEGATION = /\b(no|not|without|denies|denied|denying|excluding|excludes|absent|absence|never|non|negative|neg)\b/;
const POPULATION = /\b(pregnant|pregnancy|gravid|trimester|gestation|gestational|prenatal|fetal|fetus|child|children|pediatric|infant|infants|toddler|neonate|neonatal|newborn|baby|babies|adolescent|teen|teenager|adult|adults|elderly|male|males|female|females|man|men|woman|women|boy|boys|girl|girls)\b/;

test('mined aliases are pairs of strings in the form the alias step matches', () => {
  assert.ok(Array.isArray(MINED_ALIASES));
  for (const pair of MINED_ALIASES) {
    assert.ok(Array.isArray(pair) && pair.length === 2 && pair.every(p => typeof p === 'string'), JSON.stringify(pair));
    const [from, to] = pair;
    assert.ok(from.length >= 3, from);
    assert.equal(from, _normalizeAliasPhrase(from), `"${from}" is not in normalised form`);
    assert.ok(!/[^a-z0-9 ]/.test(from), from);
    assert.ok(!/[^a-z0-9 ~]/.test(to), to);
  }
});

test('mined aliases never repeat a phrase or override a hand-written one', () => {
  const froms = MINED_ALIASES.map(p => p[0]);
  assert.equal(new Set(froms).size, froms.length);
  const hand = new Set(_aliasTables().hand.map(p => p[0]));
  assert.deepEqual(froms.filter(f => hand.has(f)), []);
  // The table in force holds every hand-written pair unchanged.
  const inForce = new Map(_aliasTables().all);
  for (const [from, to] of _aliasTables().hand) assert.equal(inForce.get(from), to, from);
});

test('mined aliases carry no negation and no population word', () => {
  for (const [from, to] of MINED_ALIASES) {
    assert.ok(!NEGATION.test(from) && !NEGATION.test(to), `${from} -> ${to}`);
    assert.ok(!POPULATION.test(from) && !POPULATION.test(to), `${from} -> ${to}`);
  }
});

test('mined ACR wording uses only words ACR scenarios hold', () => {
  const { docFreq, stopwords } = _vocabulary(scenarios);
  const known = new Set([...new Map(docFreq).keys(), ...stopwords]);
  for (const [from, to] of MINED_ALIASES) {
    for (const word of to.split(' ').filter(Boolean)) {
      assert.ok(known.has(_stem(word.replace(/^~/, ''))), `${from} -> ${to}: "${word}"`);
    }
  }
});

test('mined aliases are sorted by phrase, so diffs stay readable', () => {
  const froms = MINED_ALIASES.map(p => p[0]);
  assert.deepEqual(froms, [...froms].sort((a, b) => a.localeCompare(b)));
});
