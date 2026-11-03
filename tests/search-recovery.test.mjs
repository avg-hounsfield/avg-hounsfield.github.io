/**
 * Gold cases for the three search mechanisms in tests/search-recovery-gold.json:
 * multi-complaint searches (a choose screen grouped by complaint when no one
 * scenario covers every complaint), size-aware matching (a size in the search
 * is checked against the ranges ACR names), and recovery instead of a dead end
 * (understood words, their topics, a body region).
 *
 * Every suggestion a recovery or multi-complaint screen shows is judged by the
 * case's "not" pattern, exactly as an answer would be.
 *
 * Run: node --test tests/*.mjs
 * Detail: node tests/search-recovery.test.mjs --list
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveQuery } from '../js/scenario-ranker.js';

const read = url => JSON.parse(readFileSync(new URL(url, import.meta.url), 'utf8'));
const { scenarios } = read('../data/search/scenario_names.json');
const { cases } = read('./search-recovery-gold.json');

/** Every scenario name or topic title a result would put in front of the user. */
export function everythingShown(result) {
  if (result.mode === 'guide') return scenarios.filter(s => s.topic === result.topic).map(s => s.name);
  if (result.mode === 'list') return result.scenarios.map(s => s.name);
  if (result.mode === 'choose') return (result.topics || []).map(t => t.topic);
  if (result.mode === 'recover') return (result.groups || []).flatMap(g => g.topics.map(t => t.topic));
  return [];
}

export function judge(c, result) {
  const reasons = [];
  const shown = everythingShown(result);
  const first = result.mode === 'list' ? result.scenarios[0]?.name || '' : '';
  if (c.mode && result.mode !== c.mode) reasons.push(`mode ${result.mode}`);
  if (c.topic && result.topic !== c.topic) reasons.push(`topic ${result.topic}`);
  if (c.name && !new RegExp(c.name).test(first)) reasons.push(`first "${first}" !~ /${c.name}/`);
  if (c.groups && (result.groups || []).length < c.groups) reasons.push(`${(result.groups || []).length} groups`);
  for (const re of c.group_topics || []) {
    const topics = result.mode === 'choose'
      ? (result.groups || []).flatMap(g => g.topics.map(t => t.topic)).concat((result.topics || []).map(t => t.topic))
      : [];
    if (!topics.some(t => new RegExp(re).test(t))) reasons.push(`no group topic ~ /${re}/`);
  }
  if (c.topics) {
    const topics = (result.groups || []).flatMap(g => g.topics.map(t => t.topic));
    if (!topics.some(t => new RegExp(c.topics).test(t))) reasons.push(`no recovery topic ~ /${c.topics}/ in [${topics.join(' | ')}]`);
  }
  if (c.region && result.region?.key !== c.region) reasons.push(`region ${result.region?.key}`);
  for (const w of c.unknown || []) {
    if (!(result.unknown || []).includes(w)) reasons.push(`"${w}" not reported unknown (unknown: ${(result.unknown || []).join(', ')})`);
  }
  if (c.notice && !new RegExp(c.notice, 'i').test(result.notice || '')) reasons.push(`notice "${result.notice || ''}" !~ /${c.notice}/`);
  if (c.not) for (const name of shown) if (new RegExp(c.not).test(name)) reasons.push(`shown "${name}" ~ /${c.not}/`);
  return reasons;
}

const outcomes = cases.map(c => {
  const result = resolveQuery(c.q, scenarios);
  return { c, result, reasons: judge(c, result) };
});

if (process.argv.includes('--list')) {
  for (const o of outcomes) {
    const shown = everythingShown(o.result);
    console.log(`${o.reasons.length ? 'FAIL' : 'ok  '} ${o.c.q}  -> ${o.result.mode} ${(o.result.topic || shown[0] || '').slice(0, 70)}${o.reasons.length ? '  | ' + o.reasons.join('; ') : ''}`);
  }
  console.log(`\n${outcomes.filter(o => o.reasons.length === 0).length}/${cases.length} pass`);
}

for (const o of outcomes) {
  test(`${o.c.feature}: ${o.c.q}`, () => {
    assert.deepEqual(o.reasons, [], JSON.stringify({ mode: o.result.mode, topic: o.result.topic, shown: everythingShown(o.result).slice(0, 6) }));
  });
}
