/**
 * Stress test for scenario matching. Prints failures to read by hand.
 *
 * 1. Persona searches: data/eval/synthetic_queries_850.json, judged by whether
 *    the answer lands in the body region and concept the query was written for.
 * 2. Self retrieval: each scenario's own patient description as the search.
 *
 * Usage: node tools/audit_matching.mjs [--show N]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolveQuery, rankScenarios } from '../js/scenario-ranker.js';

const load = p => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const show = Number(process.argv[process.argv.indexOf('--show') + 1]) || 40;

const { scenarios } = load('search/scenario_names.json');
const concepts = load('search/concept_index.json').concepts;
const queries = load('eval/synthetic_queries_850.json');
const byId = new Map(scenarios.map(s => [s.id, s]));
const full = new Map();
for (const f of readdirSync(new URL('../data/regions/', import.meta.url))) {
  for (const s of load(`regions/${f}`).scenarios) full.set(s.id, s);
}

function shown(result) {
  if (result.mode === 'guide') return scenarios.filter(s => s.topic === result.topic);
  if (result.mode === 'list') return result.scenarios;
  return [];
}

const modes = {};
const failures = [];
let passed = 0;
for (const q of queries) {
  const result = resolveQuery(q.query, scenarios);
  modes[result.mode] = (modes[result.mode] || 0) + 1;
  if (result.mode === 'none' || result.mode === 'too-broad') continue;
  const concept = concepts[q.expected_concept_id];
  const expected = new Set((concept?.scenario_mappings || []).map(m => String(m.scenario_id)));
  const expectedTopics = new Set([...expected].map(id => byId.get(id)?.topic).filter(Boolean));
  const results = shown(result);
  const first = results[0];
  const ok = expected.has(first?.id) || expectedTopics.has(first?.topic) || first?.region === q.anatomic_region;
  if (ok) passed++;
  else failures.push(`${q.query}  [want ${q.expected_concept_id}/${q.anatomic_region}]  -> ${result.mode}: ${result.topic || first?.name}`);
}
const answered = queries.length - (modes.none || 0) - (modes['too-broad'] || 0);
console.log('PERSONA', queries.length, modes, `plausible ${passed}/${answered}`);
console.log(failures.slice(0, show).join('\n'));

const seen = new Set();
let hit1 = 0;
let hit3 = 0;
let topicHit = 0;
const misses = [];
for (const s of full.values()) {
  const v = s.variant;
  if (!v || seen.has(v)) continue;
  seen.add(v);
  const top = rankScenarios(v, scenarios, { max: 3 });
  const names = top.map(t => t.id);
  if (names[0] === s.id) hit1++;
  if (names.includes(s.id)) hit3++;
  if (top.some(t => t.topic === s.topic)) topicHit++;
  else misses.push(`${v.slice(0, 90)}  -> ${top[0]?.name?.slice(0, 60) || 'NOTHING'}`);
}
console.log('\nSELF', seen.size, `top1 ${hit1} top3 ${hit3} right topic in top3 ${topicHit}`);
console.log(misses.slice(0, show).join('\n'));
