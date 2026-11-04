#!/usr/bin/env node
/**
 * Stage 2 of the semantic-fallback evaluation: judge what the recovery screen
 * would show, from the model hits tools/semantic_fallback_embed.py recorded.
 *
 * The page runs the model only when the rules end in "recover" or "none", so
 * each search is first put through resolveQuery; those that reach the model
 * then go through the page's own rankSuggestions (threshold, lexical bonus,
 * guardSuggestions). Reported for the hold-out and train phrasings and the
 * persona searches:
 *   model top-1/top-5 scenario and topic accuracy before any rule (the model
 *   itself), and on the searches that reach the fallback: how many show a
 *   suggestion, guarded top-1/top-5 accuracy, and the wrong-suggestion rate
 *   (a top suggestion in the wrong topic, split out by wrong region).
 * Probes (nonsense, chit-chat, contrast and device questions) must show nothing.
 *
 * Usage:
 *   node tools/eval_semantic_fallback.mjs --hits tools/cache/semantic-eval/hits-baseline.json [--min-score 0.5]
 *   node tools/eval_semantic_fallback.mjs --hits A.json --compare B.json     before/after table
 *   node tools/eval_semantic_fallback.mjs --hits A.json --calibrate          threshold sweeps on train + persona + probes
 *       [--calibrate-set holdout] [--phrase-min 0.6] [--phrase-only]
 *   (for the phrasing threshold use the leave-one-out hits, --mask-self in the embed step, so a
 *    train phrasing is not simply found as itself)
 *   node tools/eval_semantic_fallback.mjs --hits A.json --dump 50 [--seed 7] [--set holdout|persona|all]
 *   node tools/eval_semantic_fallback.mjs --hits A.json --show "foot drop" "weak legs after epidural"
 * --no-phrases ignores the phrasing hits in a file (the model's own wording route alone).
 * The summary is also written beside the hits file as <hits>.summary.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolveQuery } from '../js/scenario-ranker.js';
import { conceptNormalize } from '../js/concept-matcher.js';
import { rankSuggestions, mergeHits, EMBEDDING_MIN_SCORE, PHRASE_MIN_SCORE, PHRASE_DISCOUNT } from '../js/embedding-search.js';

const root = new URL('../', import.meta.url);
const read = p => JSON.parse(readFileSync(p.startsWith('/') || /^[A-Za-z]:/.test(p) ? p : new URL(p, root), 'utf8'));
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const options = name => { const out = []; let i = argv.indexOf(name); if (i < 0) return out; for (i++; i < argv.length && !argv[i].startsWith('--'); i++) out.push(argv[i]); return out; };

const { scenarios } = read('data/search/scenario_names.json');
const phrasingData = read('data/eval/mined_phrasings.json');
const personas = read('data/eval/synthetic_queries_850.json');
const concepts = read('data/search/concept_index.json').concepts;

// app.js builds this index from scenario_names.json for the lexical bonus.
const scenarioIndex = scenarios.map(s => ({
  ...s,
  normName: conceptNormalize(s.name),
  normKeywords: Array.isArray(s.keywords) && s.keywords.length ? conceptNormalize(s.keywords.join(' ')) : '',
}));
const byId = new Map(scenarioIndex.map(s => [String(s.id), s]));

// Persona regions are anatomic sites; the data files them under these regions.
const SITE_REGION = { brain: 'neuro', neck: 'neuro', pelvis: 'abdomen' };
const siteRegion = r => SITE_REGION[r] || r;

const minScore = Number(option('--min-score', EMBEDDING_MIN_SCORE));
const phraseMin = Number(option('--phrase-min', PHRASE_MIN_SCORE));
const phraseDiscount = Number(option('--phrase-discount', PHRASE_DISCOUNT));
const MAX_SHOWN = 6;

function loadHits(path) {
  const data = read(path);
  return { ...data, path };
}

/** The model's hit list for a search, scenario hits merged with phrasing hits when the file has them. */
const NO_PHRASES = flag('--no-phrases');
function hitsFor(data, text, { usePhrases = !NO_PHRASES, phraseMin: pm = phraseMin } = {}) {
  const direct = (data.hits[text] || []).map(([id, score]) => ({ id: String(id), score }));
  if (!usePhrases || !data.phits || !data.phits[text]) return mergeHits(direct, []);
  const phrase = data.phits[text].map(([row, id, score]) => ({ row, id: String(id), score }));
  return mergeHits(direct, phrase, { phraseMin: pm, phraseDiscount });
}

// The rules run first; the model only speaks on a recovery screen.
const modeCache = new Map();
function modeOf(text) {
  if (!modeCache.has(text)) modeCache.set(text, resolveQuery(text, scenarios).mode);
  return modeCache.get(text);
}
const reachesModel = text => ['recover', 'none'].includes(modeOf(text));

function suggest(data, text, opts = {}) {
  const hits = hitsFor(data, text, opts);
  return rankSuggestions(text, hits, scenarioIndex, byId, { minScore: opts.minScore ?? minScore, max: MAX_SHOWN });
}

// ---- Gold ----
const phrasingItems = phrasingData.items.map(it => ({
  q: it.q, id: String(it.id), topic: it.topic, region: it.region, split: it.split, kind: it.kind,
  ids: new Set([String(it.id)]), topics: new Set([it.topic]), regions: new Set([it.region]),
}));
const personaItems = personas.map(p => {
  const concept = concepts[p.expected_concept_id];
  const ids = new Set((concept?.scenario_mappings || []).map(m => String(m.scenario_id)));
  const topics = new Set([...ids].map(id => byId.get(id)?.topic).filter(Boolean));
  const region = siteRegion(p.anatomic_region);
  const regions = new Set([region, ...[...ids].map(id => byId.get(id)?.region).filter(Boolean)]);
  return { q: p.query, concept: p.expected_concept_id, outOfTaxonomy: !concept, ids, topics, regions, region, persona: p.persona };
});

// ---- Judging one search ----
function judgeModel(data, item) {
  const hits = hitsFor(data, item.q).slice(0, 5);
  const top = hits[0] ? byId.get(hits[0].id) : null;
  return {
    top1Id: Boolean(top && item.ids.has(String(top.id))),
    top1Topic: Boolean(top && item.topics.has(top.topic)),
    top5Id: hits.some(h => item.ids.has(h.id)),
    top5Topic: hits.some(h => item.topics.has(byId.get(h.id)?.topic)),
    topScore: hits[0]?.score ?? 0,
  };
}

function judgeFallback(data, item, opts = {}) {
  const shown = suggest(data, item.q, opts);
  const top = shown[0] || null;
  const raw = hitsFor(data, item.q, opts)[0];
  const rawTop = raw ? byId.get(raw.id) : null;
  const out = {
    shown: shown.length, none: shown.length === 0,
    // What the model alone would have led with, had the threshold and guard not spoken.
    rawAbove: Boolean(raw && raw.score >= (opts.minScore ?? minScore)),
    rawTop1Topic: Boolean(rawTop && item.topics.has(rawTop.topic)),
  };
  if (top) {
    out.top1Id = item.ids.has(String(top.id));
    out.top1Topic = item.topics.has(top.topic);
    out.top5Id = shown.slice(0, 5).some(s => item.ids.has(String(s.id)));
    out.top5Topic = shown.slice(0, 5).some(s => item.topics.has(s.topic));
    out.wrongRegion = !item.regions.has(top.region);
    out.wrongTopic = !out.top1Topic;
    out.anyWrongRegion = shown.some(s => !item.regions.has(s.region));
  }
  return { ...out, suggestions: shown };
}

const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '-');
const rate = (n, d) => (d ? +(n / d).toFixed(4) : null);

function evaluateSet(data, items, { outOfTaxonomy = false } = {}) {
  const have = items.filter(it => data.hits[it.q]);
  const model = { n: have.length, top1Id: 0, top1Topic: 0, top5Id: 0, top5Topic: 0 };
  const fb = { n: 0, shown: 0, none: 0, top1Id: 0, top1Topic: 0, top5Id: 0, top5Topic: 0, wrongTopic: 0, wrongRegion: 0, anyWrongRegion: 0, guardSilencedCorrect: 0, guardSilencedAll: 0, guardRemovedWrong: 0 };
  const modes = {};
  for (const it of have) {
    if (!outOfTaxonomy) {
      const m = judgeModel(data, it);
      for (const k of ['top1Id', 'top1Topic', 'top5Id', 'top5Topic']) model[k] += m[k] ? 1 : 0;
    }
    const mode = modeOf(it.q);
    modes[mode] = (modes[mode] || 0) + 1;
    if (!reachesModel(it.q)) continue;
    fb.n++;
    const j = judgeFallback(data, it);
    // The guard's cost and worth: a correct model lead it silenced or displaced,
    // a model lead above threshold with nothing left, a wrong lead it removed.
    if (j.rawAbove && j.rawTop1Topic && (j.none || !j.top1Topic)) fb.guardSilencedCorrect++;
    if (j.rawAbove && j.none) fb.guardSilencedAll++;
    if (j.rawAbove && !j.rawTop1Topic && (j.none || j.top1Topic)) fb.guardRemovedWrong++;
    if (j.none) { fb.none++; continue; }
    fb.shown++;
    for (const k of ['top1Id', 'top1Topic', 'top5Id', 'top5Topic', 'wrongTopic', 'wrongRegion', 'anyWrongRegion']) fb[k] += j[k] ? 1 : 0;
  }
  return {
    n: have.length, missing: items.length - have.length, modes,
    model: outOfTaxonomy ? null : {
      top1Id: rate(model.top1Id, model.n), top1Topic: rate(model.top1Topic, model.n),
      top5Id: rate(model.top5Id, model.n), top5Topic: rate(model.top5Topic, model.n),
    },
    fallback: {
      n: fb.n, shown: fb.shown, none: fb.none,
      shownRate: rate(fb.shown, fb.n), noneRate: rate(fb.none, fb.n),
      // Accuracy over every search that reached the fallback (a silence counts as a miss)...
      top1Id: rate(fb.top1Id, fb.n), top1Topic: rate(fb.top1Topic, fb.n), top5Id: rate(fb.top5Id, fb.n), top5Topic: rate(fb.top5Topic, fb.n),
      // ...and the wrong-suggestion rates over the searches that showed something.
      wrongTopicOfShown: rate(fb.wrongTopic, fb.shown), wrongRegionOfShown: rate(fb.wrongRegion, fb.shown), anyWrongRegionOfShown: rate(fb.anyWrongRegion, fb.shown),
      // Wrong top suggestion as a share of everything that reached the fallback: the number to keep down.
      wrongTopicRate: rate(fb.wrongTopic, fb.n), wrongRegionRate: rate(fb.wrongRegion, fb.n),
      guardSilencedCorrect: fb.guardSilencedCorrect, guardSilencedAll: fb.guardSilencedAll, guardRemovedWrong: fb.guardRemovedWrong,
    },
  };
}

function evaluateProbes(data) {
  const probes = Object.entries(data.sets).filter(([, tags]) => tags.includes('probes')).map(([q]) => q);
  const rows = probes.map(q => {
    const hits = hitsFor(data, q);
    const shown = suggest(data, q);
    const top = hits[0] ? byId.get(hits[0].id) : null;
    return { q, mode: modeOf(q), topScore: hits[0]?.score ?? 0, topName: top?.name || '', shown: shown.map(s => s.name) };
  });
  return { n: rows.length, maxScore: Math.max(0, ...rows.map(r => r.topScore)), aboveThreshold: rows.filter(r => r.topScore >= minScore).length, showing: rows.filter(r => r.shown.length).length, rows };
}

function evaluateAll(data) {
  const sets = {
    holdout: evaluateSet(data, phrasingItems.filter(p => p.split === 'holdout')),
    train: evaluateSet(data, phrasingItems.filter(p => p.split === 'train')),
    persona: evaluateSet(data, personaItems.filter(p => !p.outOfTaxonomy)),
    personaOutOfTaxonomy: evaluateSet(data, personaItems.filter(p => p.outOfTaxonomy), { outOfTaxonomy: true }),
    probes: evaluateProbes(data),
  };
  return { hits: data.path, model: data.model, scenarioBin: data.scenario_bin, phraseIndex: NO_PHRASES ? null : data.phrase_index || null, minScore, phraseMin, phraseDiscount, sets };
}

// ---- Reporting ----
const f = v => (v === null || v === undefined ? '-' : `${(100 * v).toFixed(1)}%`);
function printSummary(summary) {
  console.log(`\nhits: ${summary.hits}\nmodel: ${summary.model}  scenarios: ${summary.scenarioBin}  phrasings: ${summary.phraseIndex || 'none'}  threshold: ${summary.minScore}${summary.phraseIndex ? ` / phrase ${summary.phraseMin}` : ''}`);
  for (const name of ['holdout', 'train', 'persona']) {
    const s = summary.sets[name];
    const fb = s.fallback;
    console.log(`\n== ${name}: ${s.n} searches${s.missing ? ` (${s.missing} missing from hits)` : ''}; modes ${JSON.stringify(s.modes)}`);
    console.log(`  model only       top-1 scenario ${f(s.model.top1Id)}  top-1 topic ${f(s.model.top1Topic)}  top-5 scenario ${f(s.model.top5Id)}  top-5 topic ${f(s.model.top5Topic)}`);
    console.log(`  reach fallback   ${fb.n}  show a suggestion ${fb.shown} (${f(fb.shownRate)})  no suggestion ${fb.none} (${f(fb.noneRate)})`);
    console.log(`  guarded (of ${fb.n}) top-1 scenario ${f(fb.top1Id)}  top-1 topic ${f(fb.top1Topic)}  top-5 scenario ${f(fb.top5Id)}  top-5 topic ${f(fb.top5Topic)}`);
    console.log(`  wrong top suggestion: topic ${f(fb.wrongTopicRate)} of fallback (${f(fb.wrongTopicOfShown)} of shown); region ${f(fb.wrongRegionRate)} of fallback (${f(fb.wrongRegionOfShown)} of shown); any shown wrong region ${f(fb.anyWrongRegionOfShown)} of shown`);
    console.log(`  guard: silenced/displaced a correct model lead ${fb.guardSilencedCorrect}; left nothing of a lead above threshold ${fb.guardSilencedAll}; removed a wrong lead ${fb.guardRemovedWrong}`);
  }
  const oot = summary.sets.personaOutOfTaxonomy;
  console.log(`\n== persona, out of ACR's taxonomy: ${oot.n}; reach fallback ${oot.fallback.n}; show a suggestion ${oot.fallback.shown} (${f(oot.fallback.shownRate)})`);
  const pr = summary.sets.probes;
  console.log(`== probes: ${pr.n}; max model score ${pr.maxScore.toFixed(3)}; at or above threshold ${pr.aboveThreshold}; showing a suggestion ${pr.showing}`);
  for (const r of pr.rows) if (r.shown.length || r.topScore >= minScore) console.log(`   ${r.q}  score ${r.topScore.toFixed(3)}  ${r.mode}  -> ${r.shown.join(' | ') || '(guard removed)'}  [${r.topName}]`);
}

function printCompare(a, b) {
  const row = (label, fa, fb) => console.log(`  ${label.padEnd(34)} ${String(fa).padStart(8)} -> ${String(fb).padStart(8)}`);
  console.log(`\nBEFORE: ${a.hits}\nAFTER:  ${b.hits}`);
  for (const name of ['holdout', 'train', 'persona']) {
    console.log(`\n== ${name}`);
    const A = a.sets[name], B = b.sets[name];
    row('model top-1 scenario', f(A.model.top1Id), f(B.model.top1Id));
    row('model top-1 topic', f(A.model.top1Topic), f(B.model.top1Topic));
    row('model top-5 scenario', f(A.model.top5Id), f(B.model.top5Id));
    row('model top-5 topic', f(A.model.top5Topic), f(B.model.top5Topic));
    row('reach fallback', A.fallback.n, B.fallback.n);
    row('guarded top-1 scenario', f(A.fallback.top1Id), f(B.fallback.top1Id));
    row('guarded top-1 topic', f(A.fallback.top1Topic), f(B.fallback.top1Topic));
    row('guarded top-5 scenario', f(A.fallback.top5Id), f(B.fallback.top5Id));
    row('guarded top-5 topic', f(A.fallback.top5Topic), f(B.fallback.top5Topic));
    row('wrong-topic top suggestion', f(A.fallback.wrongTopicRate), f(B.fallback.wrongTopicRate));
    row('wrong-region top suggestion', f(A.fallback.wrongRegionRate), f(B.fallback.wrongRegionRate));
    row('no suggestion', f(A.fallback.noneRate), f(B.fallback.noneRate));
  }
  console.log(`\n== persona out of taxonomy: showing ${a.sets.personaOutOfTaxonomy.fallback.shown} -> ${b.sets.personaOutOfTaxonomy.fallback.shown} of ${b.sets.personaOutOfTaxonomy.fallback.n}`);
  console.log(`== probes above threshold: ${a.sets.probes.aboveThreshold} -> ${b.sets.probes.aboveThreshold}; showing: ${a.sets.probes.showing} -> ${b.sets.probes.showing}; max score ${a.sets.probes.maxScore.toFixed(3)} -> ${b.sets.probes.maxScore.toFixed(3)}`);
}

// Threshold sweeps on the phrasings that reach the fallback, plus the probes.
// The scenario threshold is swept with the phrasing route off, then (when the
// hits carry phrasings) the phrasing threshold is swept with the scenario
// threshold fixed. --calibrate-set holdout reports the sweep on the hold-out
// instead (for reading, not for choosing).
function calibrate(data, split = 'train') {
  const items = phrasingItems.filter(p => p.split === split && data.hits[p.q] && reachesModel(p.q));
  const probes = Object.entries(data.sets).filter(([, tags]) => tags.includes('probes')).map(([q]) => q);
  const personaFb = personaItems.filter(p => !p.outOfTaxonomy && data.hits[p.q] && reachesModel(p.q));
  const sweep = (label, values, optsFor) => {
    console.log(`\n${label}: ${items.length} ${split} phrasings and ${personaFb.length} persona searches that reach the fallback, ${probes.length} probes`);
    console.log('  value   shown   top1-topic(shown)  wrong-topic(shown)  wrong-region(shown)  top1-topic(all) | persona shown  top1(all)  wrong(shown) | probes>=thr  shown');
    for (const v of values) {
      const opts = optsFor(v);
      const tally = list => {
        let shown = 0, top1 = 0, wrong = 0, wrongRegion = 0;
        for (const it of list) {
          const j = judgeFallback(data, it, opts);
          if (j.none) continue;
          shown++;
          top1 += j.top1Topic ? 1 : 0;
          wrong += j.wrongTopic ? 1 : 0;
          wrongRegion += j.wrongRegion ? 1 : 0;
        }
        return { shown, top1, wrong, wrongRegion, n: list.length };
      };
      const a = tally(items), b = tally(personaFb);
      const probeAbove = probes.filter(q => (hitsFor(data, q, opts)[0]?.score ?? 0) >= (opts.minScore ?? minScore)).length;
      const probeShown = probes.filter(q => suggest(data, q, opts).length).length;
      console.log(`  ${v.toFixed(2)}   ${pct(a.shown, a.n).padStart(6)}  ${pct(a.top1, a.shown).padStart(12)}  ${pct(a.wrong, a.shown).padStart(14)}  ${pct(a.wrongRegion, a.shown).padStart(15)}  ${pct(a.top1, a.n).padStart(12)} | ${pct(b.shown, b.n).padStart(8)}  ${pct(b.top1, b.n).padStart(8)}  ${pct(b.wrong, b.shown).padStart(8)} | ${String(probeAbove).padStart(6)}  ${String(probeShown).padStart(5)}`);
    }
  };
  const range = (from, to, step) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => +(from + i * step).toFixed(2));
  if (!flag('--phrase-only')) sweep('scenario threshold (phrasing route off)', range(0.3, 0.72, 0.02), t => ({ minScore: t, usePhrases: false }));
  if (data.phits) {
    sweep(`phrasing threshold (scenario threshold ${minScore})`, range(0.4, 0.9, 0.02), t => ({ minScore, phraseMin: t }));
  }
}

function dump(data, n, seed, which) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  let items = which === 'persona' ? personaItems : which === 'all' ? [...phrasingItems.filter(p => p.split === 'holdout'), ...personaItems] : phrasingItems.filter(p => p.split === 'holdout');
  items = items.filter(it => data.hits[it.q] && reachesModel(it.q));
  const withSuggestions = items.map(it => ({ it, j: judgeFallback(data, it) })).filter(x => !x.j.none);
  for (let i = withSuggestions.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [withSuggestions[i], withSuggestions[k]] = [withSuggestions[k], withSuggestions[i]]; }
  console.log(`\n${withSuggestions.length} fallback searches show a suggestion; ${Math.min(n, withSuggestions.length)} drawn with seed ${seed}\n`);
  for (const { it, j } of withSuggestions.slice(0, n)) {
    const gold = it.topic ? `${it.topic} [${it.region}] (#${it.id})` : `${it.concept} [${it.region}]`;
    console.log(`Q: ${it.q}\n   gold: ${gold}\n   ${j.top1Topic ? 'OK  ' : j.wrongRegion ? 'REGION' : 'TOPIC'}`);
    j.suggestions.forEach((sug, i) => console.log(`   ${i + 1}. ${sug.name}  [${sug.region}${sug.age === 'pediatric' ? ', peds' : ''}] (${sug.topic}) emb ${sug.embScore.toFixed(3)}${sug.via ? ` via ${sug.via}` : ''}`));
    console.log('');
  }
}

function show(data, queries) {
  for (const q of queries) {
    const hits = hitsFor(data, q);
    if (!hits.length) { console.log(`\n${q}: not in hits file`); continue; }
    console.log(`\nQ: ${q}   mode ${modeOf(q)}${reachesModel(q) ? '' : ' (rules answer; model not shown)'}`);
    console.log('  raw:');
    hits.slice(0, 6).forEach(h => console.log(`    ${h.score.toFixed(3)} ${byId.get(h.id)?.name}  [${byId.get(h.id)?.region}]${h.via ? ` via ${h.via}` : ''}`));
    const shown = suggest(data, q);
    console.log(`  shown: ${shown.length ? '' : '(nothing)'}`);
    shown.forEach((s, i) => console.log(`    ${i + 1}. ${s.name}  [${s.region}] (${s.topic}) ${s.embScore.toFixed(3)}`));
  }
}

// ---- Main ----
const hitsPath = option('--hits');
if (!hitsPath) { console.error('usage: node tools/eval_semantic_fallback.mjs --hits <hits.json> [--compare <other.json>] [--calibrate] [--dump N] [--show q ...]'); process.exit(2); }
const data = loadHits(hitsPath);
if (flag('--calibrate')) {
  calibrate(data, option('--calibrate-set', 'train'));
} else if (flag('--dump')) {
  dump(data, Number(option('--dump', 50)), Number(option('--seed', 20261103)), option('--set', 'holdout'));
} else if (flag('--show')) {
  show(data, options('--show'));
} else {
  const summary = evaluateAll(data);
  const outPath = (hitsPath.startsWith('/') || /^[A-Za-z]:/.test(hitsPath) ? hitsPath : new URL(hitsPath, root).pathname.replace(/^\/([A-Za-z]:)/, '$1')).replace(/\.json$/, '') + (NO_PHRASES ? '.nophrases' : '') + (option('--tag') ? `.${option('--tag')}` : '') + '.summary.json';
  writeFileSync(outPath, JSON.stringify(summary, null, 1));
  if (flag('--compare')) {
    const other = evaluateAll(loadHits(option('--compare')));
    printCompare(summary, other);
  } else {
    printSummary(summary);
  }
  console.log(`\nsummary written to ${outPath}`);
}
