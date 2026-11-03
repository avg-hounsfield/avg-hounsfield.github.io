/**
 * Stress test for scenario matching. Prints failures to read by hand.
 *
 * 1. Persona searches: data/eval/synthetic_queries_850.json, judged by whether
 *    the answer lands in the body region and concept the query was written for.
 *    A "recover" result is not an answer; it is counted apart and judged by
 *    whether the topics and region it points at sit in the query's region.
 *    "Dead ends" are the searches that end in none or too-broad.
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

// The eval's regions against the site's: the eval splits neuro into brain and
// neck, and abdomen into abdomen and pelvis.
const SITE_REGION = { brain: 'neuro', neck: 'neuro', pelvis: 'abdomen' };
const siteRegion = r => SITE_REGION[r] || r;

const modes = {};
const failures = [];
const recoverFailures = [];
let passed = 0;
let recovered = 0;
let recoverRegionOk = 0;
let recoverRegionNamed = 0;
for (const q of queries) {
  const result = resolveQuery(q.query, scenarios);
  modes[result.mode] = (modes[result.mode] || 0) + 1;
  if (result.mode === 'none' || result.mode === 'too-broad') continue;
  const concept = concepts[q.expected_concept_id];
  const expected = new Set((concept?.scenario_mappings || []).map(m => String(m.scenario_id)));
  const expectedTopics = new Set([...expected].map(id => byId.get(id)?.topic).filter(Boolean));
  if (result.mode === 'recover') {
    // A recovery is judged by where it points: the region it names, and the
    // topics it suggests, should sit in the region the query was written for.
    recovered++;
    const topics = result.groups.flatMap(g => g.topics.map(t => t.topic));
    const topicOk = topics.some(t => expectedTopics.has(t) || scenarios.some(s => s.topic === t && s.region === siteRegion(q.anatomic_region)));
    if (result.region) {
      recoverRegionNamed++;
      if (result.region.key === siteRegion(q.anatomic_region) || result.region.key === 'peds') recoverRegionOk++;
    }
    if (!topicOk) recoverFailures.push(`${q.query}  [want ${q.expected_concept_id}/${q.anatomic_region}]  -> recover: ${topics.slice(0, 3).join(' | ')}`);
    continue;
  }
  const results = shown(result);
  const first = results[0];
  const ok = expected.has(first?.id) || expectedTopics.has(first?.topic) || first?.region === q.anatomic_region ||
    (result.mode === 'choose' && result.topics.some(t => expectedTopics.has(t.topic)));
  if (ok) passed++;
  else failures.push(`${q.query}  [want ${q.expected_concept_id}/${q.anatomic_region}]  -> ${result.mode}: ${result.topic || first?.name || result.topics?.[0]?.topic}`);
}
const deadEnds = (modes.none || 0) + (modes['too-broad'] || 0);
const answered = queries.length - deadEnds - recovered;
console.log('PERSONA', queries.length, modes, `dead ends ${deadEnds}`, `recover ${recovered}`, `plausible ${passed}/${answered}`);
console.log(`RECOVER topics in the expected region ${recovered - recoverFailures.length}/${recovered}, region named ${recoverRegionNamed}, of which right ${recoverRegionOk}`);
console.log(failures.slice(0, show).join('\n'));
console.log(recoverFailures.slice(0, show).map(f => 'RECOVER ' + f).join('\n'));

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
