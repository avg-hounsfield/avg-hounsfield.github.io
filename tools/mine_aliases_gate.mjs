#!/usr/bin/env node
/**
 * Steps 3 to 5 of alias mining: turn screened alias pairs into the mined
 * table (js/aliases-mined.js), accepting each one only when it earns its place.
 *
 * A candidate ["from", "to"] is accepted when, with it added to everything
 * accepted so far:
 *   - no case of any gold set that passed before fails now
 *     (tests/clinical-gold.json, tests/redteam-gold.json,
 *     tests/recovery-redteam-gold.json, tests/search-recovery-gold.json and
 *     the routing checks of tests/scenario-ranker.test.mjs);
 *   - no gold case shows or offers a forbidden answer, anywhere;
 *   - no persona search of data/eval/synthetic_queries_850.json gets a worse
 *     outcome (plausible answer > recovery in the right region > dead end >
 *     recovery in the wrong region > wrong answer);
 *   - more of the TRAIN phrasings that contain the phrase now reach their
 *     target scenario or topic, and none more reaches a wrong one.
 * Hold-out phrasings (20% of scenarios, chosen before generation) are never
 * read while accepting; their accuracy before and after is the measure of
 * whether the gain generalises.
 *
 * Speed: an alias can change only a search that contains its phrase (or a
 * word of it the spelling corrector would otherwise touch), so each
 * candidate is judged on that subset in process; the whole set is then
 * verified again on everything, and node --test runs last.
 *
 * Usage:
 *   node tools/mine_aliases_gate.mjs --baseline            measure with the table as it is
 *   node tools/mine_aliases_gate.mjs --gate [--max N]      accept candidates, write the module and report
 *   node tools/mine_aliases_gate.mjs --verify              measure the module as written and check for regressions
 * Options: --exclude data/eval/mined_aliases_exclusions.json (phrases never to accept; judge and hand review)
 *          --candidates tools/cache/alias-mining/candidates.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import {
  resolveQuery, rankScenarios, chooseTopic, guardSuggestions,
  _setMinedAliases, _aliasTables, _normalizeAliasPhrase, _docTerms, _vocabulary, _stem,
} from '../js/scenario-ranker.js';

const root = new URL('../', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);

const { scenarios } = read('data/search/scenario_names.json');
const concepts = read('data/search/concept_index.json').concepts;
const personas = read('data/eval/synthetic_queries_850.json');
const clinical = read('tests/clinical-gold.json');
const redteam = read('tests/redteam-gold.json');
const recoveryRedteam = read('tests/recovery-redteam-gold.json');
const searchRecovery = read('tests/search-recovery-gold.json');
const phrasingData = existsSync(new URL('data/eval/mined_phrasings.json', root)) ? read('data/eval/mined_phrasings.json') : { items: [] };
const byId = new Map(scenarios.map(s => [String(s.id), s]));
const topicOf = new Map(scenarios.map(s => [String(s.id), s.topic]));
const topicNames = new Set(topicOf.values());
const log = msg => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${msg}`);

// ---- Judges, ported from the test files so the gate judges exactly as they do ----

function shownNames(result) {
  if (result.mode === 'guide') return scenarios.filter(s => s.topic === result.topic).map(s => s.name);
  if (result.mode === 'list') return result.scenarios.map(s => s.name);
  if (result.mode === 'choose') return result.topics.map(t => t.topic);
  if (result.mode === 'recover') return result.groups.flatMap(g => g.topics.map(t => t.topic));
  return [];
}

// tests/clinical-gold.test.mjs: one test per case, every assertion must hold.
function judgeClinical(c, result) {
  const shown = shownNames(result);
  const reasons = [];
  const deadEnd = result.mode === 'none' || result.mode === 'recover';
  if (c.mode !== 'none' && c.mode !== 'recover' && deadEnd) reasons.push(`dead end ${result.mode}`);
  if (c.mode && !(c.mode === 'none' && result.mode === 'recover') && result.mode !== c.mode) reasons.push(`mode ${result.mode}`);
  if (c.topic && result.topic !== c.topic) reasons.push(`topic ${result.topic}`);
  if (c.name) {
    const re = new RegExp(c.name);
    const hit = result.mode === 'guide' || result.mode === 'choose' ? shown.some(n => re.test(n)) : re.test(shown[0] || '');
    if (!hit) reasons.push(`first "${shown[0] || ''}" !~ /${c.name}/`);
  }
  if (c.not) for (const name of shown) if (new RegExp(c.not).test(name)) reasons.push(`shown "${name}" ~ /${c.not}/`);
  return reasons;
}

// tests/redteam-gold.test.mjs
function judgeRedteam(c, result) {
  const shown = shownNames(result);
  const reasons = [];
  const deadEnd = result.mode === 'none' || result.mode === 'recover';
  if (c.mode !== 'none' && deadEnd) reasons.push(`mode ${result.mode}`);
  else if (c.mode && result.mode !== c.mode && !(c.mode === 'none' && result.mode === 'recover')) reasons.push(`mode ${result.mode}`);
  if (c.topic && result.topic !== c.topic) reasons.push(`topic ${result.topic}`);
  if (c.name) {
    const re = new RegExp(c.name);
    const hit = result.mode === 'guide' || result.mode === 'choose' ? shown.some(n => re.test(n)) : re.test(shown[0] || '');
    if (!hit) reasons.push(`first "${shown[0] || ''}" !~ /${c.name}/`);
  }
  if (c.not) for (const name of shown) if (new RegExp(c.not).test(name)) reasons.push(`shown "${name}" ~ /${c.not}/`);
  return reasons;
}

// tests/recovery-redteam.test.mjs
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
function rrShown(result) {
  if (result.mode === 'list') return result.scenarios;
  if (result.mode === 'recover') return suggestedScenarios(result);
  return [];
}
function rrOffered(result) {
  const set = new Set();
  if (result.mode === 'guide') { set.add(result.topic); for (const t of result.related || []) set.add(t); }
  if (result.mode === 'choose') for (const t of result.topics) set.add(t.topic);
  if (result.mode === 'list') for (const s of result.scenarios) set.add(topicOf.get(String(s.id)));
  if (result.mode === 'recover') { for (const t of suggestedTopics(result)) set.add(t); for (const s of suggestedScenarios(result)) set.add(topicOf.get(String(s.id))); }
  return set;
}
function rrSatisfies(alt, result) {
  const shownIds = rrShown(result).map(s => String(s.id));
  const topics = rrOffered(result);
  if (alt.nothing) return (result.mode === 'none' || result.mode === 'recover') && shownIds.length === 0 && topics.size === 0;
  if (alt.modes ? !alt.modes.includes(result.mode) : result.mode === 'none') return false;
  if (alt.ids) {
    const hit = result.mode === 'recover' ? shownIds.some(id => alt.ids.includes(id)) : alt.ids.includes(shownIds[0]);
    if (!hit) return false;
  }
  for (const group of alt.topic_groups || []) if (!group.some(t => topics.has(t))) return false;
  return true;
}
function judgeRecoveryRedteam(c, result) {
  const reasons = [];
  if (!c.expected.some(alt => rrSatisfies(alt, result))) reasons.push(`expected not met (${result.mode})`);
  if (c.forbidden) {
    const re = new RegExp(c.forbidden);
    for (const s of rrShown(result)) if (re.test(s.name)) reasons.push(`shown "${s.name.slice(0, 70)}"`);
  }
  const topicPattern = c.forbidden_topics === undefined ? c.forbidden : c.forbidden_topics;
  if (topicPattern) {
    const re = new RegExp(topicPattern);
    for (const t of rrOffered(result)) if (re.test(t)) reasons.push(`offered "${t}"`);
  }
  return reasons;
}

// tests/search-recovery.test.mjs
function everythingShown(result) {
  if (result.mode === 'guide') return scenarios.filter(s => s.topic === result.topic).map(s => s.name);
  if (result.mode === 'list') return result.scenarios.map(s => s.name);
  if (result.mode === 'choose') return (result.topics || []).map(t => t.topic);
  if (result.mode === 'recover') return (result.groups || []).flatMap(g => g.topics.map(t => t.topic));
  return [];
}
function judgeSearchRecovery(c, result) {
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
    if (!topics.some(t => new RegExp(c.topics).test(t))) reasons.push(`no recovery topic ~ /${c.topics}/`);
  }
  if (c.region && result.region?.key !== c.region) reasons.push(`region ${result.region?.key}`);
  for (const w of c.unknown || []) if (!(result.unknown || []).includes(w)) reasons.push(`"${w}" not reported unknown`);
  if (c.notice && !new RegExp(c.notice, 'i').test(result.notice || '')) reasons.push(`notice !~ /${c.notice}/`);
  if (c.not) for (const name of shown) if (new RegExp(c.not).test(name)) reasons.push(`shown "${name}" ~ /${c.not}/`);
  return reasons;
}

// tests/scenario-ranker.test.mjs, the routing checks that a word table can change.
const top = (query, n) => rankScenarios(query, scenarios, { max: n });
const MUST_FIND = [
  ['back pain with cauda equina', ['5623'], 1], ['low back pain no red flags', ['5618'], 1], ['rlq pain pregnant', ['6316'], 1],
  ['PE in pregnancy', ['6225'], 1], ['appendicitis in a child', ['4665', '4666', '4667'], 3], ['kidney stones', ['7217', '7216'], 3],
  ['kidney stones pregnant', ['7220'], 1], ['thunderclap headache', ['7012', '1145'], 1],
  ['scaphoid fracture', ['7316', '7317', '7318', '1181', '4618', '4621', '4622'], 3], ['elevated lfts', ['7151', '7152', '7153', '7154'], 5],
  ['chest pain low risk', ['652', '654'], 3], ['hemoptysis in a smoker', ['5246', '5245', '5247'], 5], ['aortic dissection', ['5554'], 1],
  ['aortic dissection surveillance', ['8011', '8013', '8006', '6826'], 2],
];
const GUIDES = [
  ['headache', 'Headache'], ['hematuria', 'Hematuria'], ['kidney stones', 'Acute Onset Flank Pain-Suspicion of Stone Disease (Urolithiasis)'],
  ['suspected pulmonary embolism', 'Suspected Pulmonary Embolism'], ['aortic dissection', 'Suspected Acute Aortic Syndrome'],
  ['headache in a child', 'Headache-Child'], ['dementia', 'Dementia'],
];
const allTopics = [...new Set(scenarios.map(s => s.topic))];
const unitCases = [
  ...MUST_FIND.map(([q, ids, n]) => ({ key: `must-find: ${q}`, queries: [q], run: () => top(q, n).some(s => ids.includes(s.id)) })),
  ...GUIDES.map(([q, topic]) => ({ key: `guide: ${q}`, queries: [q], run: () => { const r = resolveQuery(q, scenarios); return r.mode === 'guide' && r.topic === topic; } })),
  { key: 'child searches never return adult-only scenarios', queries: ['appendicitis in a child'], run: () => top('appendicitis in a child', 8).every(s => s.age !== 'adult') },
  { key: 'pregnancy searches return only pregnancy scenarios', queries: ['pe in pregnancy'], run: () => top('pe in pregnancy', 8).every(s => /pregnan/i.test(s.name)) },
  { key: 'pregnancy scenarios do not lead unqualified searches', queries: ['kidney stones'], run: () => !/pregnan/i.test(top('kidney stones', 1)[0].name) },
  { key: 'pregnancy qualifier with no topic returns nothing', queries: ['zzzqqq pregnant'], run: () => top('zzzqqq pregnant', 8).length === 0 },
  { key: 'no repeated scenario lines', queries: ['acute stroke'], run: () => { const lines = top('acute stroke', 8).map(s => `${s.name}|${s.top_procedure?.name}`); return new Set(lines).size === lines.length; } },
  { key: 'minor head injury leads with adult mild head trauma', queries: ['ct head after minor head injury'], run: () => /^Head trauma, acute, mild/.test(top('ct head after minor head injury', 1)[0]?.name || '') },
  { key: 'closer wording outranks extra qualifiers', queries: ['breast cancer screening average risk'], run: () => /^Breast cancer screening, average risk/.test(top('breast cancer screening average risk', 1)[0]?.name || '') },
  { key: 'modality words do not change the match', queries: ['mri for cauda equina'], run: () => top('mri for cauda equina', 1)[0]?.id === '5623' },
  { key: 'qualified searches go to lists', queries: ['back pain with cauda equina', 'rlq pain pregnant', 'low back pain no red flags'], run: () => ['back pain with cauda equina', 'rlq pain pregnant', 'low back pain no red flags'].every(q => resolveQuery(q, scenarios).mode === 'list') },
  { key: 'guardSuggestions respects anatomy, age, pregnancy, negation', queries: ['hip pain in the elderly', 'pelvic pain', 'back ache', 'varicocele imaging', 'sudden cold leg'], run: () => {
    const byName = re => scenarios.filter(s => re.test(s.name)).slice(0, 3);
    return guardSuggestions('hip pain in the elderly', byName(/^Foot trauma/), scenarios).length === 0 &&
      guardSuggestions('pelvic pain', byName(/pregnant/), scenarios).length === 0 &&
      guardSuggestions('back ache', scenarios.filter(s => s.age === 'pediatric').slice(0, 3), scenarios).length === 0 &&
      guardSuggestions('varicocele imaging', byName(/^Varicose veins/), scenarios).length === 0 &&
      guardSuggestions('sudden cold leg', byName(/^Cold painful leg/), scenarios).length > 0;
  } },
  { key: 'a study name lists the scenarios that use it', queries: ['mra head'], run: () => { const r = resolveQuery('mra head', scenarios); return r.mode === 'list' && r.scenarios.length > 0 && r.scenarios.every(s => s.top_tier.studies.some(n => /^MRA head/.test(n))); } },
  { key: 'condition plus study finds the condition', queries: ['ct head after minor head injury'], run: () => { const r = resolveQuery('ct head after minor head injury', scenarios); return r.mode === 'list' && /^Head trauma, acute, mild/.test(r.scenarios[0].name); } },
  { key: 'one-word generic searches are too broad', queries: ['pain', 'mass'], run: () => ['pain', 'mass'].every(q => resolveQuery(q, scenarios).mode === 'too-broad') },
  { key: 'pregnancy qualifier with no scenario is stated', queries: ['scoliosis in pregnancy'], run: () => { const r = resolveQuery('scoliosis in pregnancy', scenarios); return r.mode === 'list' && /pregnancy/.test(r.notice || ''); } },
  { key: 'nearly every topic title opens its own topic', queries: allTopics, run: () => allTopics.filter(t => (chooseTopic(t, scenarios) || {}).topic !== t).length / allTopics.length < 0.05 },
  { key: 'adult-or-child scenarios count for both', queries: ['adult knee pain after fall'], run: () => top('adult knee pain after fall', 8).some(s => s.id === '5319') },
  { key: 'knee tear searches reach internal derangement', queries: ['acl tear', 'meniscus tear'], run: () => ['acl tear', 'meniscus tear'].every(q => /internal derangement/.test(top(q, 1)[0]?.name || '')) },
];

// ---- Persona audit (tools/audit_matching.mjs), as a per-search outcome ----
const SITE_REGION = { brain: 'neuro', neck: 'neuro', pelvis: 'abdomen' };
const siteRegion = r => SITE_REGION[r] || r;
// Lower is better; a candidate may not raise any search's badness.
const BADNESS = { plausible: 0, 'recover-ok': 1, dead: 2, 'recover-bad': 3, implausible: 4 };
function personaOutcome(q) {
  const result = resolveQuery(q.query, scenarios);
  if (result.mode === 'none' || result.mode === 'too-broad') return { state: 'dead', mode: result.mode };
  const concept = concepts[q.expected_concept_id];
  const expected = new Set((concept?.scenario_mappings || []).map(m => String(m.scenario_id)));
  const expectedTopics = new Set([...expected].map(id => byId.get(id)?.topic).filter(Boolean));
  if (result.mode === 'recover') {
    const topics = result.groups.flatMap(g => g.topics.map(t => t.topic));
    const ok = topics.some(t => expectedTopics.has(t) || scenarios.some(s => s.topic === t && s.region === siteRegion(q.anatomic_region)));
    return { state: ok ? 'recover-ok' : 'recover-bad', mode: result.mode };
  }
  const results = result.mode === 'guide' ? scenarios.filter(s => s.topic === result.topic) : result.mode === 'list' ? result.scenarios : [];
  const first = results[0];
  const ok = expected.has(first?.id) || expectedTopics.has(first?.topic) || first?.region === q.anatomic_region ||
    (result.mode === 'choose' && result.topics.some(t => expectedTopics.has(t.topic)));
  return { state: ok ? 'plausible' : 'implausible', mode: result.mode };
}

// ---- Generated phrasings: does a search reach its target? ----
// strict: the guide or the first listed scenario is the target's topic;
// lenient: the target's topic is among what is offered (a chooser, the top three of a list);
// none: a recovery, a dead end or too broad; wrong: an answer that offers something else.
function phrasingOutcome(item) {
  const result = resolveQuery(item.q, scenarios);
  const target = item.topic;
  if (result.mode === 'guide') return result.topic === target ? 'strict' : (result.related || []).includes(target) ? 'lenient' : 'wrong';
  if (result.mode === 'list') {
    const first = result.scenarios[0];
    if (first && (String(first.id) === String(item.id) || first.topic === target)) return 'strict';
    return result.scenarios.slice(0, 3).some(s => s.topic === target) ? 'lenient' : 'wrong';
  }
  if (result.mode === 'choose') return result.topics.some(t => t.topic === target) ? 'lenient' : 'wrong';
  return 'none';
}

// ---- Every judged item, with the text a candidate's phrase is looked for in ----
const items = [];
const addItem = (set, key, queries, evaluate) => items.push({ set, key, queries, evaluate, norm: queries.map(q => ` ${_normalizeAliasPhrase(q)} `) });
clinical.cases.forEach((c, i) => addItem('clinical', `${i}:${c.q}`, [c.q], () => { const r = judgeClinical(c, resolveQuery(c.q, scenarios)); return { pass: r.length === 0, forbidden: r.some(x => x.startsWith('shown')) }; }));
redteam.cases.forEach((c, i) => addItem('redteam', `${i}:${c.q}`, [c.q], () => { const r = judgeRedteam(c, resolveQuery(c.q, scenarios)); return { pass: r.length === 0, forbidden: r.some(x => x.startsWith('shown')) }; }));
for (const g of ['sizes', 'multi', 'recover']) {
  recoveryRedteam[g].forEach((c, i) => addItem(`rr-${g}`, `${i}:${c.q}`, [c.q], () => { const r = judgeRecoveryRedteam(c, resolveQuery(c.q, scenarios)); return { pass: r.length === 0, forbidden: r.some(x => /^(shown|offered)/.test(x)), honestBroken: Boolean(c.honest) && r.length > 0 }; }));
}
searchRecovery.cases.forEach((c, i) => addItem('search-recovery', `${i}:${c.q}`, [c.q], () => { const r = judgeSearchRecovery(c, resolveQuery(c.q, scenarios)); return { pass: r.length === 0, forbidden: r.some(x => x.startsWith('shown')) }; }));
unitCases.forEach(u => addItem('unit', u.key, u.queries, () => ({ pass: Boolean(u.run()), forbidden: false })));
personas.forEach((q, i) => addItem('persona', `${i}:${q.query}`, [q.query], () => personaOutcome(q)));
const phrasings = phrasingData.items.map((it, i) => ({ ...it, index: i, norm: ` ${_normalizeAliasPhrase(it.q)} ` }));
const trainPhrasings = phrasings.filter(p => p.split === 'train');
const holdoutPhrasings = phrasings.filter(p => p.split === 'holdout');

// Word -> items and phrasings whose normalised text holds it, for the subset a phrase can touch.
const wordIndex = new Map();
const indexWords = (text, ref) => { for (const w of new Set(text.trim().split(' ').filter(Boolean))) { if (!wordIndex.has(w)) wordIndex.set(w, []); wordIndex.get(w).push(ref); } };
items.forEach((it, i) => it.norm.forEach(n => indexWords(n, { item: i })));
phrasings.forEach((p, i) => indexWords(p.norm, { phrasing: i }));

function affectedBy(phrase, newWords) {
  const words = phrase.split(' ');
  const hits = { items: new Set(), phrasings: new Set() };
  const add = ref => { if (ref.item !== undefined) hits.items.add(ref.item); else hits.phrasings.add(ref.phrasing); };
  // Everything holding the whole phrase: the shortest posting list, then a containment check.
  const lists = words.map(w => wordIndex.get(w) || []);
  const shortest = lists.reduce((a, b) => (a.length <= b.length ? a : b), lists[0] || []);
  const padded = ` ${phrase} `;
  for (const ref of shortest) {
    const texts = ref.item !== undefined ? items[ref.item].norm : [phrasings[ref.phrasing].norm];
    if (texts.some(t => t.includes(padded))) add(ref);
  }
  // Everything holding a word the spelling corrector could no longer touch.
  for (const w of newWords) for (const ref of wordIndex.get(w) || []) add(ref);
  return hits;
}

// ---- Evaluation ----
function evaluateItems(indices) {
  const out = new Map();
  for (const i of indices) out.set(i, items[i].evaluate());
  return out;
}
function evaluatePhrasings(indices) {
  const out = new Map();
  for (const i of indices) out.set(i, phrasingOutcome(phrasings[i]));
  return out;
}
function worse(before, after, set) {
  if (set === 'persona') return BADNESS[after.state] > BADNESS[before.state];
  if (before.pass && !after.pass) return true;
  if (after.forbidden && !before.forbidden) return true;
  if (after.honestBroken && !before.honestBroken) return true;
  return false;
}

function summarize(itemStates, phrasingStates) {
  const sets = {};
  for (const [i, st] of itemStates) {
    const set = items[i].set;
    const s = sets[set] || (sets[set] = { n: 0, pass: 0, forbidden: 0, honestBroken: 0, modes: {}, states: {} });
    s.n++;
    if (set === 'persona') {
      s.states[st.state] = (s.states[st.state] || 0) + 1;
      s.modes[st.mode] = (s.modes[st.mode] || 0) + 1;
    } else {
      s.pass += st.pass ? 1 : 0;
      s.forbidden += st.forbidden ? 1 : 0;
      s.honestBroken += st.honestBroken ? 1 : 0;
    }
  }
  if (sets.persona) {
    const st = sets.persona.states;
    sets.persona.deadEnds = (sets.persona.modes.none || 0) + (sets.persona.modes['too-broad'] || 0);
    sets.persona.recover = sets.persona.modes.recover || 0;
    sets.persona.plausible = st.plausible || 0;
    sets.persona.answered = (st.plausible || 0) + (st.implausible || 0);
    sets.persona.recoverOk = st['recover-ok'] || 0;
    delete sets.persona.pass; delete sets.persona.forbidden; delete sets.persona.honestBroken;
  }
  const acc = split => {
    const idx = phrasings.map((p, i) => i).filter(i => phrasings[i].split === split && phrasingStates.has(i));
    const counts = { n: idx.length, strict: 0, lenient: 0, none: 0, wrong: 0 };
    for (const i of idx) counts[phrasingStates.get(i)]++;
    counts.strictRate = idx.length ? +(counts.strict / idx.length).toFixed(4) : null;
    counts.lenientRate = idx.length ? +((counts.strict + counts.lenient) / idx.length).toFixed(4) : null;
    counts.wrongRate = idx.length ? +(counts.wrong / idx.length).toFixed(4) : null;
    return counts;
  };
  return { sets, phrasings: { train: acc('train'), holdout: acc('holdout') } };
}

function printSummary(label, sum) {
  console.log(`\n== ${label}`);
  for (const [set, s] of Object.entries(sum.sets)) {
    if (set === 'persona') console.log(`  persona: ${JSON.stringify(s.modes)} dead ends ${s.deadEnds} recover ${s.recover} (right region ${s.recoverOk}) plausible ${s.plausible}/${s.answered}`);
    else console.log(`  ${set}: ${s.pass}/${s.n} pass, forbidden ${s.forbidden}${s.honestBroken ? `, honest broken ${s.honestBroken}` : ''}`);
  }
  for (const split of ['train', 'holdout']) {
    const p = sum.phrasings[split];
    if (p.n) console.log(`  phrasings ${split}: n ${p.n} strict ${p.strict} (${p.strictRate}) lenient-or-better ${p.strict + p.lenient} (${p.lenientRate}) wrong ${p.wrong} (${p.wrongRate}) none ${p.none}`);
  }
}

// ---- Candidate preparation ----
const vocab = _vocabulary(scenarios);
const docFreq = new Map(vocab.docFreq);
const STOP = new Set(vocab.stopwords);
const NEGATION = /\b(no|not|without|denies|denied|denying|excluding|excludes|absent|absence|never|non|negative|neg)\b/;
const POPULATION = /\b(pregnant|pregnancy|gravid|gravida|trimester|gestation|gestational|prenatal|fetal|fetus|child|children|kid|kids|pediatric|peds|infant|infants|toddler|neonate|neonatal|newborn|baby|babies|adolescent|teen|teenager|adult|adults|elderly|geriatric|male|males|female|females|man|men|woman|women|boy|boys|girl|girls|\d+\s*(yo|y o|year old|years old|yr|yrs|month old|months old))\b/;
const SIDE = /\b(left|right)\b/;
const nameWordCount = new Map();
for (const s of scenarios) for (const w of new Set(_normalizeAliasPhrase(s.name.replace(` (${s.topic})`, '')).split(' ').map(_stem))) nameWordCount.set(w, (nameWordCount.get(w) || 0) + 1);

function prepareCandidates(raw, excluded) {
  const hand = new Set(_aliasTables().hand.map(p => p[0]));
  const rejected = [];
  const reject = (c, why) => rejected.push({ from: c.from, to: c.to, why });
  const prepared = [];
  for (const c of raw) {
    if (!c.screened) { reject(c, 'no train phrasing passed the retriever/cross-encoder screen'); continue; }
    const from = _normalizeAliasPhrase(c.from);
    const to = _normalizeAliasPhrase(c.to);
    if (!from || from.length < 3) { reject(c, 'phrase empty or shorter than 3 characters after normalisation'); continue; }
    if (from.split(' ').length > 6) { reject(c, 'phrase longer than 6 words'); continue; }
    if (from === to) { reject(c, 'phrase equals its ACR wording'); continue; }
    if (hand.has(from)) { reject(c, 'hand-written table already names the phrase'); continue; }
    if (excluded.has(from)) { reject(c, 'excluded (judge or hand review)'); continue; }
    if (NEGATION.test(from) || NEGATION.test(to)) { reject(c, 'negation inside an alias; negation is read by the ranker itself'); continue; }
    if (POPULATION.test(c.from) || POPULATION.test(c.to) || POPULATION.test(to)) { reject(c, 'population word (age, sex, pregnancy) inside an alias'); continue; }
    if (SIDE.test(to) && !SIDE.test(from)) { reject(c, 'ACR wording adds a side'); continue; }
    if (from.split(' ').every(w => STOP.has(w))) { reject(c, 'only stopwords'); continue; }
    if (/[^a-z0-9 ]/.test(from) || /[^a-z0-9 ~]/.test(to)) { reject(c, 'unexpected characters'); continue; }
    const single = !from.includes(' ');
    if (single && docFreq.has(_stem(from))) { reject(c, 'ACR itself uses this word; a single ACR word is never remapped'); continue; }
    if (single && from.length <= 4 && c.ids.length < 2 && c.models.length < 2) { reject(c, 'short abbreviation with a single supporting scenario and one model'); continue; }
    if (to === '') {
      if (c.train_phrasings < 2) { reject(c, 'deletion with a single supporting phrasing'); continue; }
      const nameWords = from.split(' ').filter(w => !STOP.has(w)).map(_stem).filter(w => nameWordCount.has(w));
      if (nameWords.length) { reject(c, `deletion of a word ACR scenario names use (${nameWords.join(', ')})`); continue; }
    } else {
      const stems = to.split(' ').map(_stem);
      const unknown = stems.filter(w => !docFreq.has(w) && !STOP.has(w));
      if (unknown.length) { reject(c, `ACR wording uses words no scenario holds (${unknown.join(', ')})`); continue; }
      // Every word of the ACR wording must sit in one supporting scenario's text.
      const supports = c.ids.some(id => { const d = _docTerms(id, scenarios); return d && stems.every(w => STOP.has(w) || d.all.includes(w)); });
      if (!supports) { reject(c, 'ACR wording not found in any supporting scenario'); continue; }
    }
    prepared.push({ ...c, from, to });
  }
  // One phrase, one meaning: competing ACR wordings for a phrase are kept only
  // when one clearly dominates, else the phrase is ambiguous and dropped.
  const byFrom = new Map();
  for (const c of prepared) { if (!byFrom.has(c.from)) byFrom.set(c.from, []); byFrom.get(c.from).push(c); }
  const unique = [];
  for (const [from, list] of byFrom) {
    if (list.length === 1) { unique.push(list[0]); continue; }
    const support = c => c.train_pass + c.ids.length;
    list.sort((a, b) => support(b) - support(a));
    const total = list.reduce((n, c) => n + support(c), 0);
    const topics = new Set(list.flatMap(c => c.topics));
    if (support(list[0]) * 3 >= total * 2 || topics.size === 1) {
      unique.push({ ...list[0], alternatives: list.slice(1).map(c => c.to) });
      for (const c of list.slice(1)) reject(c, `phrase "${from}" also proposed as "${list[0].to}", which has more support`);
    } else {
      for (const c of list) reject(c, `phrase "${from}" is ambiguous: ${list.map(c => `"${c.to}"`).join(' / ')} with comparable support`);
    }
  }
  return { prepared: unique, rejected };
}

// ---- Main ----
function fullEvaluation() {
  return { itemStates: evaluateItems(items.map((_, i) => i)), phrasingStates: evaluatePhrasings(phrasings.map((_, i) => i)) };
}

function writeModule(table, provenance) {
  const sorted = [...table].sort((a, b) => a[0].localeCompare(b[0]));
  const quote = s => (/['\\]/.test(s) ? JSON.stringify(s) : `'${s}'`);
  const lines = sorted.map(([from, to]) => `  [${quote(from)}, ${quote(to)}],`);
  const header = readFileSync(new URL('js/aliases-mined.js', root), 'utf8').split('export const MINED_ALIASES')[0];
  writeFileSync(new URL('js/aliases-mined.js', root), `${header}export const MINED_ALIASES = [\n${lines.join('\n')}\n];\n`);
  writeFileSync(new URL('data/eval/mined_aliases_provenance.json', root), JSON.stringify({
    generated_at: new Date().toISOString(), count: sorted.length,
    aliases: sorted.map(([from, to]) => ({ from, to, ...provenance.get(from) })),
  }, null, 1));
}

const cacheDir = new URL('tools/cache/alias-mining/', root);
mkdirSync(cacheDir, { recursive: true });
const excludeFile = option('--exclude', 'data/eval/mined_aliases_exclusions.json');
const excluded = new Set(existsSync(new URL(excludeFile, root)) ? read(excludeFile).exclude.map(e => (typeof e === 'string' ? e : e.from)) : []);

if (flag('--baseline') || flag('--verify')) {
  const t0 = Date.now();
  const { itemStates, phrasingStates } = fullEvaluation();
  const sum = summarize(itemStates, phrasingStates);
  printSummary(flag('--verify') ? 'with js/aliases-mined.js as written' : 'baseline (hand-written table only)', sum);
  log(`${items.length} cases and ${phrasings.length} phrasings in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const name = flag('--verify') ? 'verify' : 'baseline';
  writeFileSync(new URL(`${name}.json`, cacheDir), JSON.stringify({ summary: sum, mined: _aliasTables().all.length - _aliasTables().hand.length }, null, 1));
  if (flag('--verify') && existsSync(new URL('baseline.json', cacheDir))) {
    // Regressions against the saved baseline, case by case.
    const baseStates = read('tools/cache/alias-mining/baseline_states.json');
    const regressions = [];
    for (const [i, st] of itemStates) {
      const before = baseStates.items[i];
      if (before && worse(before, st, items[i].set)) regressions.push(`${items[i].set} ${items[i].key}: ${JSON.stringify(before)} -> ${JSON.stringify(st)}`);
    }
    console.log(`\nregressions against baseline: ${regressions.length}`);
    for (const r of regressions.slice(0, 40)) console.log('  ' + r);
    process.exitCode = regressions.length ? 1 : 0;
  }
  if (flag('--baseline')) {
    writeFileSync(new URL('baseline_states.json', cacheDir), JSON.stringify({ items: [...itemStates.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]), phrasings: [...phrasingStates.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]) }));
  }
} else if (flag('--gate')) {
  const candidateFile = option('--candidates', 'tools/cache/alias-mining/candidates.json');
  const raw = read(candidateFile).candidates;
  const max = Number(option('--max', 0)) || Infinity;
  _setMinedAliases([]);
  const t0 = Date.now();
  const base = fullEvaluation();
  const baseSummary = summarize(base.itemStates, base.phrasingStates);
  printSummary('before (hand-written table only)', baseSummary);
  log(`baseline in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const { prepared, rejected } = prepareCandidates(raw, excluded);
  log(`${raw.length} alias pairs -> ${prepared.length} candidates after structural checks (${rejected.length} rejected)`);

  const state = { items: new Map(base.itemStates), phrasings: new Map(base.phrasingStates) };
  const accepted = [];
  const provenance = new Map();
  const decisions = [];
  let aliasWordSet = new Set(_aliasTables().all.flatMap(p => p[0].split(' ')));
  // Potential first: the candidates whose phrase sits in the most train
  // phrasings that do not yet reach their target.
  const potential = c => {
    const hits = affectedBy(c.from, []);
    let n = 0;
    for (const i of hits.phrasings) if (phrasings[i].split === 'train' && state.phrasings.get(i) !== 'strict') n++;
    return n;
  };
  const ordered = prepared.map(c => ({ c, potential: potential(c) })).filter(x => x.potential > 0)
    .sort((a, b) => b.potential - a.potential || b.c.train_pass - a.c.train_pass || a.c.from.localeCompare(b.c.from));
  log(`${ordered.length} candidates could still help a train phrasing; ${prepared.length - ordered.length} already covered`);
  let tried = 0;
  for (const { c } of ordered) {
    if (accepted.length >= max) break;
    tried++;
    const newWords = c.from.split(' ').filter(w => !aliasWordSet.has(w) && w.length >= 5);
    const hits = affectedBy(c.from, newWords);
    const trainHits = [...hits.phrasings].filter(i => phrasings[i].split === 'train');
    _setMinedAliases([...accepted, [c.from, c.to]]);
    const afterItems = evaluateItems(hits.items);
    const afterPhrasings = evaluatePhrasings(trainHits);
    let reason = null;
    for (const [i, st] of afterItems) {
      if (worse(state.items.get(i), st, items[i].set)) { reason = `regresses ${items[i].set} "${items[i].key.replace(/^\d+:/, '')}" (${JSON.stringify(state.items.get(i))} -> ${JSON.stringify(st)})`; break; }
    }
    if (!reason) {
      let strictBefore = 0, strictAfter = 0, wrongBefore = 0, wrongAfter = 0, lost = 0;
      for (const i of trainHits) {
        const b = state.phrasings.get(i), a = afterPhrasings.get(i);
        strictBefore += b === 'strict'; strictAfter += a === 'strict';
        wrongBefore += b === 'wrong'; wrongAfter += a === 'wrong';
        lost += b === 'strict' && a !== 'strict';
      }
      if (strictAfter <= strictBefore) reason = `no train phrasing newly reaches its target (${strictBefore} -> ${strictAfter} strict of ${trainHits.length})`;
      else if (wrongAfter > wrongBefore) reason = `more train phrasings reach a wrong answer (${wrongBefore} -> ${wrongAfter})`;
      else if (lost > 0) reason = `breaks ${lost} train phrasing(s) that reached their target`;
      else {
        const gain = strictAfter - strictBefore;
        accepted.push([c.from, c.to]);
        for (const [i, st] of afterItems) state.items.set(i, st);
        for (const [i, st] of afterPhrasings) state.phrasings.set(i, st);
        aliasWordSet = new Set(_aliasTables().all.flatMap(p => p[0].split(' ')));
        provenance.set(c.from, { gain, train_phrasings: trainHits.length, scenario_ids: c.ids, topics: c.topics, kinds: c.kinds, models: c.models, examples: c.examples });
        decisions.push({ from: c.from, to: c.to, accepted: true, gain, affected: hits.items.size + trainHits.length });
        if (accepted.length % 25 === 0) log(`accepted ${accepted.length} after ${tried} tried (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
        continue;
      }
    }
    decisions.push({ from: c.from, to: c.to, accepted: false, reason });
  }
  _setMinedAliases(accepted);
  log(`tried ${tried}, accepted ${accepted.length}; verifying everything again`);
  const after = fullEvaluation();
  const regressions = [];
  for (const [i, st] of after.itemStates) if (worse(base.itemStates.get(i), st, items[i].set)) regressions.push({ i, text: `${items[i].set} ${items[i].key}: ${JSON.stringify(base.itemStates.get(i))} -> ${JSON.stringify(st)}` });
  if (regressions.length) {
    console.log(`\nFULL CHECK found ${regressions.length} regressions the subset check missed; removing every accepted alias whose phrase or words sit in those searches:`);
    for (const r of regressions) console.log('  ' + r.text);
    const texts = regressions.flatMap(r => items[r.i].norm);
    const culprits = new Set(accepted.filter(([from]) => texts.some(t => t.includes(` ${from} `) || from.split(' ').some(w => w.length >= 5 && t.includes(` ${w} `)))).map(p => p[0]));
    for (const from of culprits) { decisions.push({ from, to: accepted.find(p => p[0] === from)[1], accepted: false, reason: 'removed: full check regression' }); provenance.delete(from); }
    const kept = accepted.filter(p => !culprits.has(p[0]));
    accepted.length = 0; accepted.push(...kept);
    _setMinedAliases(accepted);
  }
  const final = fullEvaluation();
  const finalSummary = summarize(final.itemStates, final.phrasingStates);
  const finalRegressions = [];
  for (const [i, st] of final.itemStates) if (worse(base.itemStates.get(i), st, items[i].set)) finalRegressions.push(`${items[i].set} ${items[i].key}`);
  printSummary(`after (${accepted.length} mined aliases)`, finalSummary);
  console.log(`\nregressions after final check: ${finalRegressions.length}`);
  for (const r of finalRegressions.slice(0, 20)) console.log('  ' + r);
  writeModule(accepted, provenance);
  const rejectedReasons = {};
  for (const r of rejected) rejectedReasons[r.why.replace(/\(.*\)|".*"|:.*$/g, '').trim()] = (rejectedReasons[r.why.replace(/\(.*\)|".*"|:.*$/g, '').trim()] || 0) + 1;
  const gateReasons = {};
  for (const d of decisions.filter(d => !d.accepted)) gateReasons[d.reason.replace(/\(.*\)|".*"/g, '').trim()] = (gateReasons[d.reason.replace(/\(.*\)|".*"/g, '').trim()] || 0) + 1;
  writeFileSync(new URL('gate_report.json', cacheDir), JSON.stringify({
    generated_at: new Date().toISOString(),
    counts: { pairs: raw.length, screened: raw.filter(c => c.screened).length, structural_ok: prepared.length, with_potential: ordered.length, tried, accepted: accepted.length },
    structural_rejections: rejectedReasons, gate_rejections: gateReasons,
    before: baseSummary, after: finalSummary, regressions: finalRegressions,
  }, null, 1));
  writeFileSync(new URL('gate_decisions.json', cacheDir), JSON.stringify({ decisions, structural_rejected: rejected }, null, 0));
  // Per phrasing, before and after, for the model comparison and the hold-out report.
  writeFileSync(new URL('gate_states.json', cacheDir), JSON.stringify(phrasings.map((p, i) => ({
    q: p.q, id: p.id, split: p.split, kind: p.kind, models: p.models, before: base.phrasingStates.get(i), after: final.phrasingStates.get(i),
  }))));
  writeFileSync(new URL('accepted_for_judge.json', cacheDir), JSON.stringify(accepted.map(([from, to]) => {
    const p = provenance.get(from);
    return { from, to, ids: p.scenario_ids, models: p.models, examples: p.examples };
  }), null, 0));
  log(`wrote js/aliases-mined.js (${accepted.length}), data/eval/mined_aliases_provenance.json, tools/cache/alias-mining/gate_report.json, gate_decisions.json, accepted_for_judge.json in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (finalRegressions.length) process.exitCode = 1;
} else {
  console.log('usage: node tools/mine_aliases_gate.mjs --baseline | --gate [--max N] | --verify  [--exclude file] [--candidates file]');
}
