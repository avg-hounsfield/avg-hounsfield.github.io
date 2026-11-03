/**
 * Red-team cases for the three search mechanisms, in
 * tests/recovery-redteam-gold.json: sizes (size-aware matching), multi
 * (several complaints in one search) and recover (recovery instead of a dead
 * end). Written by a separate red team against the ACR data; grader adapted
 * from theirs. Each case passes when any of its expected alternatives holds;
 * nothing its "forbidden" pattern names may be shown or offered, whatever the
 * mode. Honest cases (ACR has nothing) must stay none or an empty recovery.
 *
 * Run:    node --test tests/*.mjs
 * Detail: node tests/recovery-redteam.test.mjs --list [sizes|multi|recover]
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveQuery } from '../js/scenario-ranker.js';

const read = url => JSON.parse(readFileSync(new URL(url, import.meta.url), 'utf8'));
const { scenarios } = read('../data/search/scenario_names.json');
const cases = read('./recovery-redteam-gold.json');
const topicOf = new Map(scenarios.map(s => [String(s.id), s.topic]));
const topicNames = new Set(topicOf.values());

// Scenario-like objects a recovery screen may carry, wherever the builder puts them.
function suggestedScenarios(result) {
  const out = [];
  const walk = (v, depth) => {
    if (!v || depth > 4) return;
    if (Array.isArray(v)) return v.forEach(x => walk(x, depth + 1));
    if (typeof v !== 'object') return;
    if (v.id !== undefined && typeof v.name === 'string' && topicOf.has(String(v.id))) out.push(v);
    else for (const k of Object.keys(v)) if (k !== 'understood') walk(v[k], depth + 1);
  };
  walk(result, 0);
  return out;
}
function suggestedTopics(result) {
  const out = new Set();
  const walk = (v, depth) => {
    if (!v || depth > 4) return;
    if (Array.isArray(v)) return v.forEach(x => walk(x, depth + 1));
    if (typeof v === 'string') { if (topicNames.has(v)) out.add(v); return; }
    if (typeof v !== 'object') return;
    for (const k of Object.keys(v)) if (k !== 'understood') walk(v[k], depth + 1);
  };
  walk(result, 0);
  return out;
}

/** Scenario names the user sees asserted as matches. */
export function shown(result) {
  if (result.mode === 'list') return result.scenarios;
  if (result.mode === 'recover') return suggestedScenarios(result);
  return [];
}
/** Topic names offered to the user. */
export function offered(result) {
  const set = new Set();
  if (result.mode === 'guide') { set.add(result.topic); for (const t of result.related || []) set.add(t); }
  if (result.mode === 'choose') for (const t of result.topics) set.add(t.topic);
  if (result.mode === 'list') for (const s of result.scenarios) set.add(topicOf.get(String(s.id)));
  if (result.mode === 'recover') { for (const t of suggestedTopics(result)) set.add(t); for (const s of suggestedScenarios(result)) set.add(topicOf.get(String(s.id))); }
  return set;
}

function satisfies(alt, result) {
  const shownIds = shown(result).map(s => String(s.id));
  const topics = offered(result);
  if (alt.nothing) return (result.mode === 'none' || result.mode === 'recover') && shownIds.length === 0 && topics.size === 0;
  if (alt.modes ? !alt.modes.includes(result.mode) : result.mode === 'none') return false;
  if (alt.ids) {
    const hit = result.mode === 'recover' ? shownIds.some(id => alt.ids.includes(id)) : alt.ids.includes(shownIds[0]);
    if (!hit) return false;
  }
  for (const group of alt.topic_groups || []) if (!group.some(t => topics.has(t))) return false;
  return true;
}

/** [] when the case passes, else the reasons. */
export function judge(c, result) {
  const reasons = [];
  if (!c.expected.some(alt => satisfies(alt, result))) reasons.push(`expected not met (${result.mode})`);
  if (c.forbidden) {
    const re = new RegExp(c.forbidden);
    for (const s of shown(result)) if (re.test(s.name)) reasons.push(`shown "${s.name.slice(0, 70)}" ~ /${c.forbidden.slice(0, 40)}/`);
  }
  // Topic titles are checked with forbidden_topics when given (an empty string
  // skips them), otherwise with forbidden.
  const topicPattern = c.forbidden_topics === undefined ? c.forbidden : c.forbidden_topics;
  if (topicPattern) {
    const re = new RegExp(topicPattern);
    for (const t of offered(result)) if (re.test(t)) reasons.push(`offered "${t}" ~ /${topicPattern.slice(0, 40)}/`);
  }
  return reasons;
}

const groups = ['sizes', 'multi', 'recover'];
const outcomes = Object.fromEntries(groups.map(g => [g, cases[g].map(c => {
  const result = resolveQuery(c.q, scenarios);
  return { c, result, reasons: judge(c, result) };
})]));

const describe = r => r.mode === 'guide' ? r.topic
  : r.mode === 'list' ? r.scenarios[0]?.name
  : r.mode === 'choose' ? r.topics.map(t => t.topic).join(' | ')
  : r.mode === 'recover' ? r.groups.flatMap(g => g.topics.map(t => t.topic)).join(' | ')
  : '';

if (process.argv.includes('--list')) {
  const only = process.argv.find(a => groups.includes(a));
  for (const g of groups) {
    if (only && g !== only) continue;
    const pass = outcomes[g].filter(o => o.reasons.length === 0).length;
    console.log(`\n== ${g}: ${pass}/${outcomes[g].length} pass`);
    for (const o of outcomes[g]) {
      if (!o.reasons.length) continue;
      console.log(`  ${o.c.q}  -> ${o.result.mode}: ${(describe(o.result) || '').slice(0, 90)}  | ${o.reasons.join('; ')}  || want ${JSON.stringify(o.c.expected).slice(0, 160)}`);
    }
  }
}

for (const g of groups) {
  test(`${g}: no forbidden scenario or topic is ever shown`, () => {
    const bad = outcomes[g].filter(o => o.reasons.some(r => /^(shown|offered)/.test(r))).map(o => `${o.c.q}: ${o.reasons.filter(r => /^(shown|offered)/.test(r)).join('; ')}`);
    assert.deepEqual(bad, []);
  });
  test(`${g}: pass count floor`, () => {
    const pass = outcomes[g].filter(o => o.reasons.length === 0).length;
    assert.ok(pass >= (cases.pass_floor?.[g] ?? 0), `${pass}/${outcomes[g].length}`);
  });
}
test('recover: honest cases stay honest', () => {
  const bad = outcomes.recover.filter(o => o.c.honest && o.reasons.length).map(o => `${o.c.q} -> ${o.result.mode}`);
  assert.deepEqual(bad, []);
});
