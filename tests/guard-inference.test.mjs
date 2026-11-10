/**
 * Grader for tests/guard-inference-gold.json (guard equivalences and clinical
 * inference), adapted from the red team's reference grader. See the _note in
 * the gold file for the case format. Not clinician reviewed.
 *
 * Run:    node --test tests/guard-inference.test.mjs
 * Detail: node tests/guard-inference.test.mjs --list [guard_pass|guard_block|inference]
 *
 * Reports pass counts for the three arrays and asserts the hard rules:
 *   1. no guard_block pair survives guardSuggestions
 *   2. no forbidden scenario name or topic title is shown or offered
 *   3. a negated inference never fires (must_not_offer)
 *   4. inferred topics are not asserted more often than at baseline
 * Rules 1, 2 and 3 already fail on the code as it stood when the cases were
 * written (see BASELINE); those failures are findings, not grader bugs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.GRAI_ROOT || join(HERE, '..');
// Counts on the code as it stood when the cases were written.
const BASELINE = { guard_pass: 96, guard_block_leaks: 31, inference_pass: 69, inference_hard: 21, asserted: 14 };

const { resolveQuery, guardSuggestions } = await import(pathToFileURL(join(ROOT, 'js/scenario-ranker.js')).href);
const { scenarios } = JSON.parse(readFileSync(join(ROOT, 'data/search/scenario_names.json'), 'utf8'));
const cases = JSON.parse(readFileSync(join(HERE, 'guard-inference-gold.json'), 'utf8'));
if (cases.baseline) Object.assign(BASELINE, cases.baseline);
const byId = new Map(scenarios.map(s => [String(s.id), s]));
const topicSet = new Set(scenarios.map(s => s.topic));

// ------------------------------------------------------------------ guard
const survives = (q, id) => {
  const s = byId.get(String(id));
  if (!s) throw new Error(`cases.json names scenario ${id}, which the data no longer has`);
  return guardSuggestions(q, [s], scenarios).some(x => String(x.id) === String(id));
};
const guardPass = cases.guard_pass.map(c => ({ c, ok: c.ids.some(id => survives(c.q, id)) }));
const guardBlock = cases.guard_block.map(c => ({ c, ok: !survives(c.q, c.id) }));

// -------------------------------------------------------------- inference
const SKIP_KEYS = new Set(['understood', 'unknown', 'corrected', 'query', 'reason']);
const LABEL_KEYS = ['inferred', 'inference', 'question', 'suggestion', 'suggested', 'offer', 'label', 'notice'];
/** Everything a result puts in front of the user: topic titles and scenarios. */
export function view(result) {
  const offered = new Set(), shown = [];
  const walk = v => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') { if (topicSet.has(v)) offered.add(v); return; }
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v !== 'object') return;
    if (v.id !== undefined && typeof v.name === 'string' && byId.has(String(v.id))) {
      const s = byId.get(String(v.id));
      shown.push(s); offered.add(s.topic); return;
    }
    for (const k of Object.keys(v)) if (!SKIP_KEYS.has(k)) walk(v[k]);
  };
  walk(result);
  return { offered, shown };
}
export const signature = result => {
  const { offered, shown } = view(result);
  return { mode: result.mode, topics: [...offered].sort(), ids: shown.map(s => String(s.id)) };
};
/** True when the result states an inferred topic as the answer instead of asking. */
export function asserted(c, result) {
  if (c.kind !== 'infer' || c.assert_ok) return false;
  if (result.mode === 'guide') return c.offer.includes(result.topic);
  if (result.mode === 'list') {
    const first = result.scenarios && result.scenarios[0] && byId.get(String(result.scenarios[0].id));
    const labelled = LABEL_KEYS.some(k => result[k]) || (result.scenarios || []).slice(0, 1).some(s => LABEL_KEYS.some(k => s[k]));
    return Boolean(first) && c.offer.includes(first.topic) && !labelled;
  }
  return false;
}
/** { soft: reasons the case does not pass, hard: rule violations } */
export function judge(c, result) {
  const { offered, shown } = view(result);
  const soft = [], hard = [];
  if (c.offer.length && !c.offer.some(t => offered.has(t))) soft.push(`none of the expected topics offered (${result.mode})`);
  for (const t of c.must_not_offer) if (offered.has(t)) (c.kind === 'negated' ? hard : soft).push(`negated inference offered "${t}"`);
  if (c.forbidden) {
    const re = new RegExp(c.forbidden);
    for (const s of shown) if (re.test(s.name)) hard.push(`forbidden scenario shown "${s.name.slice(0, 70)}"`);
  }
  const topicPattern = c.forbidden_topics === undefined ? c.forbidden : c.forbidden_topics;
  if (topicPattern) {
    const re = new RegExp(topicPattern);
    for (const t of offered) if (re.test(t)) hard.push(`forbidden topic offered "${t}"`);
  }
  if (asserted(c, result)) soft.push('asserted, not offered');
  if (c.kind === 'unchanged' && JSON.stringify(signature(result)) !== JSON.stringify(c.today)) soft.push('changed from today');
  return { soft, hard };
}
const inference = cases.inference.map(c => {
  const result = resolveQuery(c.q, scenarios);
  const { soft, hard } = judge(c, result);
  return { c, result, soft, hard, ok: !soft.length && !hard.length };
});

// ----------------------------------------------------------------- report
const n = (list, f = o => o.ok) => list.filter(f).length;
const kinds = ['infer', 'negated', 'unchanged'];
const summary = [
  `guard_pass:  ${n(guardPass)}/${guardPass.length} pass`,
  `guard_block: ${n(guardBlock)}/${guardBlock.length} blocked (${n(guardBlock, o => !o.ok)} wrong suggestions get through)`,
  `inference:   ${n(inference)}/${inference.length} pass  [` + kinds.map(k => `${k} ${n(inference, o => o.ok && o.c.kind === k)}/${n(inference, o => o.c.kind === k)}`).join(', ') + ']',
  `inference hard violations: ${n(inference, o => o.hard.length > 0)}; asserted instead of offered: ${n(inference, o => o.soft.includes('asserted, not offered'))}`,
];
console.log(summary.join('\n'));

if (process.argv.includes('--list')) {
  const only = process.argv.find(a => ['guard_pass', 'guard_block', 'inference'].includes(a));
  const describe = r => { const s = signature(r); return `${s.mode}: ${s.topics.slice(0, 4).join(' | ').slice(0, 110)}`; };
  if (!only || only === 'guard_pass') for (const o of guardPass) if (!o.ok) console.log(`BLOCKED  ${o.c.q}  -> ${o.c.names[0]}`);
  if (!only || only === 'guard_block') for (const o of guardBlock) if (!o.ok) console.log(`LEAK [${o.c.kind}]  ${o.c.q}  -> ${o.c.name}`);
  if (!only || only === 'inference') for (const o of inference) if (!o.ok) console.log(`${o.hard.length ? 'HARD' : 'miss'} [${o.c.kind}]  ${o.c.q}  -> ${describe(o.result)}  | ${[...o.hard, ...o.soft].join('; ')}`);
}

test('guard: no must-block pair passes the guard', () => {
  assert.deepEqual(guardBlock.filter(o => !o.ok).map(o => `${o.c.q} -> ${o.c.name} [${o.c.kind}]`), []);
});
test('guard: must-pass count does not fall below baseline', () => {
  assert.ok(n(guardPass) >= BASELINE.guard_pass, `${n(guardPass)}/${guardPass.length}`);
});
test('inference: no forbidden scenario or topic is shown', () => {
  assert.deepEqual(inference.flatMap(o => o.hard.filter(r => r.startsWith('forbidden')).map(r => `${o.c.q}: ${r}`)), []);
});
test('inference: a negated inference never fires', () => {
  assert.deepEqual(inference.flatMap(o => o.hard.filter(r => r.startsWith('negated')).map(r => `${o.c.q}: ${r}`)), []);
});
test('inference: inferred topics are offered, not asserted', () => {
  const bad = inference.filter(o => o.soft.includes('asserted, not offered')).map(o => `${o.c.q} -> ${o.result.mode} ${o.result.topic || ''}`);
  assert.ok(bad.length <= BASELINE.asserted, `${bad.length} asserted (baseline ${BASELINE.asserted}): ${bad.join(' | ')}`);
});
test('inference: searches with no justified inference stay as today', () => {
  assert.deepEqual(inference.filter(o => o.c.kind === 'unchanged' && !o.ok).map(o => `${o.c.q}: ${[...o.hard, ...o.soft].join('; ')}`), []);
});
