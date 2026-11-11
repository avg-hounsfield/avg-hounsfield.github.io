#!/usr/bin/env node
/**
 * Builds the clinician review packet in docs/review/: CSV files a radiologist
 * can open in Excel and mark up, one row per clinical judgment baked into the
 * search, each with what the site does with it today.
 *
 * Every judgment in the packet was written by AI models from the ACR data and
 * none has been reviewed by a clinician. This script only collects and
 * translates them; it never decides whether one is right. Its own suspicions
 * go to 90_flagged_by_generator.csv, labelled as machine-flagged.
 *
 * Run from the repository root:  node tools/build_review_packet.mjs
 *
 * Sources read (never written):
 *   tests/clinical-gold.json, tests/redteam-gold.json,
 *   tests/recovery-redteam-gold.json, tests/guard-inference-gold.json
 *   js/scenario-ranker.js tables (hand aliases, context aliases, synonyms,
 *     whole-search aliases, clarify, inference questions, implications,
 *     negation kin, opposites, guard equivalences, quadrants, negative tests)
 *   js/aliases-mined.js, tools/build_scenarios.py (REGION_RULES),
 *   data/search/scenario_names.json
 *
 * The ranker's tables are not exported, so a copy of js/scenario-ranker.js is
 * written to the system temp folder with one export appended. The current
 * answers in the packet always come from the real module; the copy is checked
 * against it on every gold search before it is used.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'docs', 'review');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));

// ------------------------------------------------------------ modules
const real = await import(pathToFileURL(path.join(REPO, 'js', 'scenario-ranker.js')).href);
const { resolveQuery, guardSuggestions, _guardReason, extractQualifiers } = real;
const { scenarios } = readJson('data/search/scenario_names.json');

const TABLE_NAMES = ['HAND_ALIASES', 'EQUIVALENT', 'TEXT_SYNONYMS', 'CONTEXT_ALIASES', 'WHOLE_QUERY_ALIASES', 'CLARIFY',
  'IMPLIES', 'ANTONYMS', 'NEGATION_KIN', 'INFERENCES', 'GUARD_COVER_SOURCE', 'QUADRANT_OF', 'ANATOMY_GROUPS',
  'REGION_LABELS', 'NEGATIVE_TESTS', 'MINED_ALIASES'];

async function instrumented(source, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grai-review-'));
  const jsDir = path.join(REPO, 'js');
  let text = source.replace(/from '\.\/([\w-]+\.js)(?:\?[^']*)?'/g, (m, file) => `from '${pathToFileURL(path.join(jsDir, file)).href}'`);
  const present = TABLE_NAMES.filter(n => new RegExp(`\\b(?:const|let) ${n}\\b`).test(text) || n === 'MINED_ALIASES');
  text += `\nexport const __REVIEW_TABLES = { ${present.join(', ')} };\n`;
  const file = path.join(dir, `ranker-${tag}.mjs`);
  fs.writeFileSync(file, text);
  const mod = await import(pathToFileURL(file).href);
  return { mod, dir };
}
const rankerSource = fs.readFileSync(path.join(REPO, 'js', 'scenario-ranker.js'), 'utf8');
const inst = await instrumented(rankerSource, 'current');
const T = inst.mod.__REVIEW_TABLES;
for (const n of TABLE_NAMES) if (!T[n]) throw new Error(`table ${n} not found in js/scenario-ranker.js; update the generator`);

// The hand aliases of the commit this packet was first built against, to mark
// the ones added since. Optional: skipped when git or the commit is missing.
const BASE_COMMIT = '3a1c718';
let baseHand = null;
try {
  const old = execFileSync('git', ['show', `${BASE_COMMIT}:js/scenario-ranker.js`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 });
  const oldInst = await instrumented(old, 'base');
  baseHand = new Set(oldInst.mod.__REVIEW_TABLES.HAND_ALIASES.map(([f]) => f));
  fs.rmSync(oldInst.dir, { recursive: true, force: true });
} catch { baseHand = null; }

// ------------------------------------------------------------ ascii + csv
const ASCII_MAP = {
  '\u2013': '-', '\u2014': '-', '\u2012': '-', '\u2212': '-', '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"',
  '\u2265': '>=', '\u2264': '<=', '\u00d7': 'x', '\u00b1': '+/-', '\u2026': '...', '\u00a0': ' ', '\u2192': '->',
  '\u00b5': 'u', '\u03bc': 'u', '\u00b0': ' deg', '\u2022': '-', '\u00e9': 'e', '\u00e8': 'e', '\u00f6': 'o', '\u00fc': 'u',
};
const ascii = s => String(s ?? '').replace(/[^\x00-\x7f]/g, ch => ASCII_MAP[ch] ?? (ch.normalize('NFKD').replace(/[^\x00-\x7f]/g, '') || '?'));
const q = s => `"${ascii(s)}"`;

const COLUMNS = [
  ['id', 'id'],
  ['why_here', 'why this row is here'],
  ['kind', 'kind of judgment'],
  ['item', 'the item in plain words'],
  ['expected', 'what it says the site should do'],
  ['current', 'what the site does now'],
  ['acr_top', 'top ACR category and studies now (first answer)'],
  ['agrees', 'site matches the expectation?'],
  ['verdict', 'verdict (ok / wrong / unsure)'],
  ['comment', 'correct answer or comment'],
  ['area', 'area'],
  ['population', 'population read from the search'],
  ['minutes', 'est. seconds to review'],
  ['cumulative', 'running total (minutes)'],
  ['source', 'source'],
  ['technical', 'technical (raw value, for the developer)'],
];
function csvCell(v) {
  const s = ascii(v).replace(/\r?\n/g, ' ');
  return /[",]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeCsv(name, rows) {
  const lines = [COLUMNS.map(c => csvCell(c[1])).join(',')];
  for (const r of rows) lines.push(COLUMNS.map(([k]) => csvCell(k === 'verdict' || k === 'comment' ? '' : r[k])).join(','));
  fs.writeFileSync(path.join(OUT, name), lines.join('\r\n') + '\r\n');
}
const shortId = (prefix, key) => `${prefix}-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 6).toUpperCase()}`;

// ------------------------------------------------------------ data helpers
const byId = new Map(scenarios.map(s => [String(s.id), s]));
const topicScenarios = new Map();
for (const s of scenarios) { if (!topicScenarios.has(s.topic)) topicScenarios.set(s.topic, []); topicScenarios.get(s.topic).push(s); }
const topicSet = new Set(topicScenarios.keys());
const topicRegion = new Map([...topicScenarios].map(([t, list]) => {
  const c = new Map(); for (const s of list) c.set(s.region, (c.get(s.region) || 0) + 1);
  return [t, [...c].sort((a, b) => b[1] - a[1])[0][0]];
}));
const AREA_LABEL = {
  neuro: 'Neuro, head and neck', spine: 'Spine', chest: 'Chest and heart', vascular: 'Vascular', abdomen: 'Abdomen, pelvis, obstetrics',
  msk: 'Musculoskeletal', breast: 'Breast', other: 'Trauma, abuse, sepsis, oncology, ICU', general: 'General (no single area)',
};
const AREAS = Object.keys(AREA_LABEL);

// Word vocabulary of scenario names, for completing word fragments in patterns.
const vocab = new Map();
for (const s of scenarios) for (const w of `${s.name} ${s.topic}`.toLowerCase().split(/[^a-z0-9]+/)) if (w) vocab.set(w, (vocab.get(w) || 0) + 1);
function completeFragment(part) {
  const t = part.trim();
  if (!/^[A-Za-z]{3,}$/.test(t) || vocab.has(t.toLowerCase())) return null;
  let best = null;
  for (const [w, n] of vocab) if (w.includes(t.toLowerCase()) && (!best || n > vocab.get(best))) best = w;
  return best && best !== t.toLowerCase() ? best : null;
}

function studyName(x) { return /^\d+$/.test(String(x)) ? `[unnamed study ${x} in the data]` : x; }
function tierText(t) { return t ? `${t.level}${t.disagreement ? ' (panel disagreement)' : ''}: ${t.studies.map(studyName).join('; ')}` : ''; }

// ------------------------------------------------------------ describing results
const MODE_PLAIN = {
  guide: 'opens one whole ACR topic', list: 'lists specific ACR scenarios', choose: 'asks the user to pick between topics',
  recover: 'gives no direct answer but suggests places to look', none: 'gives no answer (says ACR has nothing)',
  'too-broad': 'says the search is too broad',
};
function describe(r) {
  let s;
  switch (r.mode) {
    case 'guide': s = `Opens the whole ACR topic ${q(r.topic)}`; break;
    case 'list': s = `Lists ${r.scenarios.length} scenario(s); first: ${q(r.scenarios[0]?.name)} [${r.scenarios[0]?.topic}]` +
      (r.scenarios.length > 1 ? `; then ${r.scenarios.slice(1, 3).map(x => q(x.name)).join('; ')}` : ''); break;
    case 'choose': s = `${r.inferred ? 'Asks, as an inference to consider, ' : 'Asks '}which topic: ${r.topics.map(t => t.topic).join(' | ')}`; break;
    case 'recover': {
      const topics = (r.groups || []).flatMap(g => g.topics.map(t => t.topic));
      s = topics.length ? `No direct answer; suggests: ${[...new Set(topics)].join(' | ')}` : 'No direct answer and nothing suggested'; break;
    }
    case 'none': s = 'No answer (says ACR does not cover this)'; break;
    case 'too-broad': s = 'Says the search is too broad'; break;
    default: s = r.mode;
  }
  if (r.corrected) s += ` (after correcting the spelling to ${q(r.corrected)})`;
  if (r.notice) s += `. Note shown: ${r.notice}`;
  return s;
}
const shortDescribe = r => r.mode === 'guide' ? `topic ${q(r.topic)}` : r.mode === 'list' ? `first scenario ${q(r.scenarios[0]?.name)}`
  : r.mode === 'choose' ? `${r.inferred ? 'inference question' : 'choice'}: ${r.topics.map(t => t.topic).join(' | ')}`
  : r.mode === 'recover' ? `no answer; suggests ${[...new Set((r.groups || []).flatMap(g => g.topics.map(t => t.topic)))].join(' | ') || 'nothing'}`
  : r.mode === 'none' ? 'no answer' : r.mode;
function acrTop(r) {
  if (r.mode === 'list') {
    const s = byId.get(String(r.scenarios[0]?.id)) || r.scenarios[0];
    return s ? tierText(s.top_tier) : '';
  }
  if (r.mode === 'guide') {
    const list = topicScenarios.get(r.topic) || [];
    const c = new Map();
    for (const s of list) { if (!s.top_tier) continue; const k = tierText(s.top_tier); c.set(k, (c.get(k) || 0) + 1); }
    const [best, n] = [...c].sort((a, b) => b[1] - a[1])[0] || [];
    return best ? `Most common in this topic (${n} of ${list.length} scenarios): ${best}` : '';
  }
  return '(no single answer shown)';
}
function populationOf(query) {
  const x = extractQualifiers(query);
  const out = [];
  if (x.pregnant) out.push('pregnant'); if (x.notPregnant) out.push('not pregnant');
  if (x.infant) out.push('infant'); else if (x.age === 'pediatric') out.push('child'); else if (x.age === 'adult') out.push('adult');
  if (x.teen) out.push('teenager');
  if (x.years !== null && x.years !== undefined) out.push(`${x.years} y`);
  if (x.sex) out.push(x.sex);
  return out.join(', ');
}
const cache = new Map();
const run = query => { if (!cache.has(query)) cache.set(query, resolveQuery(query, scenarios)); return cache.get(query); };
function areaOfResult(r) {
  if (r.mode === 'guide') return topicRegion.get(r.topic) || 'general';
  if (r.mode === 'list') return r.scenarios[0]?.region || topicRegion.get(r.scenarios[0]?.topic) || 'general';
  if (r.mode === 'choose') return topicRegion.get(r.topics[0]?.topic) || 'general';
  if (r.mode === 'recover') { const t = (r.groups || [])[0]?.topics?.[0]?.topic; return topicRegion.get(t) || 'general'; }
  return 'general';
}

// ------------------------------------------------------------ patterns into words
// A small reader for the patterns the tables use. It expands a pattern into
// the wordings it accepts; anything it cannot read (lookarounds, counted
// repeats, character classes) is reported as untranslatable.
const untranslatable = [];
function parsePattern(src) {
  let i = 0;
  const fail = why => { throw new Error(why); };
  function alt() { const alts = [seq()]; while (src[i] === '|') { i++; alts.push(seq()); } return { t: 'alt', alts }; }
  function seq() {
    const items = [];
    while (i < src.length && src[i] !== '|' && src[i] !== ')') {
      let a = atom();
      if (src[i] === '?') { i++; if (src[i] === '?') i++; a = { t: 'opt', a }; }
      else if (src[i] === '*' || src[i] === '+') {
        const k = src[i]; i++; if (src[i] === '?') i++;
        a = a.t === 'any' || a.t === 'word' ? (a.t === 'any' ? { t: 'gap' } : { t: 'word' }) : k === '+' ? a : { t: 'opt', a };
      } else if (src[i] === '{') fail('counted repeat');
      items.push(a);
    }
    return { t: 'seq', items };
  }
  function atom() {
    const c = src[i];
    if (c === '(') {
      i++;
      if (src.startsWith('?:', i)) i += 2; else if (src[i] === '?') fail('lookaround');
      const a = alt(); if (src[i] !== ')') fail('paren'); i++; return a;
    }
    if (c === '\\') {
      const d = src[i + 1]; i += 2;
      if (d === 'b' || d === 'B') return { t: 'lit', v: '' };
      if (d === 'w') return { t: 'word' };
      if (d === 's') return { t: 'lit', v: ' ' };
      if (d === 'd') return { t: 'lit', v: '#' };
      if (/[a-zA-Z]/.test(d)) fail(`escape \\${d}`);
      return { t: 'lit', v: d };
    }
    if (c === '.') { i++; return { t: 'any' }; }
    if (c === '^') { i++; return { t: 'lit', v: '\u0001' }; }
    if (c === '$') { i++; return { t: 'lit', v: '\u0002' }; }
    if (c === '[') {
      const j = src.indexOf(']', i); const body = src.slice(i + 1, j); i = j + 1;
      if (/^[-\u2013\u2014 ]+$/.test(body)) return { t: 'lit', v: '-' };
      // [Aa]: either case of one letter, read as the lower case letter.
      if (/^[A-Za-z]{2}$/.test(body) && body[0].toLowerCase() === body[1].toLowerCase()) return { t: 'lit', v: body[1].toLowerCase() };
      // A few single characters with no ranges: any one of them.
      if (body.length <= 4 && !/[\^\\-]/.test(body)) return { t: 'alt', alts: [...body].map(ch => ({ t: 'seq', items: [{ t: 'lit', v: ch }] })) };
      fail('character class');
    }
    i++; return { t: 'lit', v: c };
  }
  const ast = alt();
  if (i < src.length) fail('unbalanced');
  return ast;
}
const CAP = 80;
function expand(n) {
  switch (n.t) {
    case 'lit': return [n.v];
    case 'any': return ['?'];
    case 'gap': return ['\u0003'];
    case 'word': return ['...'];
    case 'opt': return ['', ...expand(n.a)].slice(0, CAP);
    case 'alt': return [...new Set(n.alts.flatMap(expand))].slice(0, CAP);
    case 'seq': {
      let acc = [''];
      for (const it of n.items) { const e = expand(it); const next = []; for (const a of acc) for (const b of e) { next.push(a + b); if (next.length >= CAP) break; } acc = next; }
      return acc;
    }
  }
  return [''];
}
function wordings(src) {
  try { return expand(parsePattern(src)).map(s => s.replace(/\s+/g, ' ')); } catch (e) { return null; }
}
// "must <verb>" phrase for a name pattern: start with / contain / then later.
const NOT_MENTION_RE = /^\^\(\?!\.\*\((.*)\)\)(?:\.\*)?$/;
function splitTopAlternatives(src) {
  const out = []; let depth = 0, cur = '';
  for (let k = 0; k < src.length; k++) {
    const ch = src[k];
    if (ch === '\\') { cur += ch + (src[k + 1] || ''); k++; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === '|' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur); return out;
}
function patternPhrase(src, context) {
  // A top-level "^(?!.*(A|B)).*" alternative names what an item must mention.
  const alts = splitTopAlternatives(src);
  if (alts.length > 1 && alts.some(a => NOT_MENTION_RE.test(a))) {
    const parts = alts.map(a => patternPhrase(a, context));
    return parts.some(x => x === null) ? null : parts.join(', or ');
  }
  const nm = NOT_MENTION_RE.exec(src);
  if (nm) {
    const words = triggerWords(nm[1], context);
    return words ? `leave out every one of ${words} (that is, everything shown must mention at least one of them)` : null;
  }
  // "(?<!non)traumatic": the word, but not right after the given letters.
  const lb = /\(\?<!([a-z]+)\)([a-z]+)/.exec(src);
  if (lb) {
    const rest = patternPhrase(src.replace(`(?<!${lb[1]})`, ''), context);
    return rest ? `${rest} (not counting ${q(lb[1] + lb[2])})` : null;
  }
  const ws = wordings(src);
  if (!ws) { untranslatable.push({ context, pattern: src }); return null; }
  const phrases = [...new Set(ws.map(w => {
    const start = w.startsWith('\u0001'); const end = w.endsWith('\u0002');
    const parts = w.replace(/[\u0001\u0002]/g, '').split('\u0003').map(p => p.trim()).filter(Boolean);
    if (!parts.length) return 'be anything';
    const quoteP = p => { const c = completeFragment(p); return c ? `${q(p)} (part of the word ${q(c)})` : q(p); };
    let s = (start ? 'start with ' : 'contain ') + quoteP(parts[0]);
    for (const p of parts.slice(1)) s += `, then later ${quoteP(p)}`;
    if (end) s += ' at the very end';
    return s;
  }))];
  if (phrases.length > 10) return `${phrases.slice(0, 10).join(', or ')}, or one of ${phrases.length - 10} similar wordings`;
  return phrases.join(', or ');
}
// A list of wordings for a trigger pattern ("mentions any of").
function triggerWords(src, context) {
  const ws = wordings(src);
  if (!ws) { untranslatable.push({ context, pattern: src }); return null; }
  const list = [...new Set(ws.map(w => w.replace(/[\u0001\u0002]/g, '').replace(/\u0003/g, ' ... ').replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (list.length > 14) return `${list.slice(0, 14).map(q).join(', ')} and ${list.length - 14} similar wordings`;
  return list.map(q).join(', ');
}
const reSource = re => (re instanceof RegExp ? re.source : String(re));

// ------------------------------------------------------------ body regions and populations in a phrase
const EQUIV = T.EQUIVALENT;
const GROUP_NAMES = ['head and neck', 'spine and back', 'chest', 'abdomen', 'pelvis and groin', 'limbs'];
const groupOf = new Map(T.ANATOMY_GROUPS.flatMap((g, i) => g.map(w => [w, i])));
const EXTRA_REGION = {
  ruq: 3, rlq: 3, luq: 3, llq: 3, epigastric: 3, appendicitis: 3, appendix: 3, gi: 3, scrotum: 4, testis: 4, testicular: 4,
  arm: 5, calf: 5, elbow: 5, wrist: 5, thumb: 5, heel: 5, ankle: 5, knee: 5, shoulder: 5, femur: 5, tibia: 5, humerus: 5,
  neck: 0, cervical: 1, head: 0, brain: 0, intracranial: 0, lung: 2, cardiac: 2, heart: 2, axillary: 2, pancreas: 3,
};
// Phrases whose head or neck word is not the head or the neck, and
// "cervical", which is the neck, the cervical spine or the uterine cervix.
const REGION_PRE = [
  [/\b(femoral|humeral|radial|fibular|metatarsal|bladder|pancreatic|pancreas) (head|neck)\b/g, 'limbpart'],
  [/\bneck of (?:the )?(femur|humerus)\b/g, 'limbpart'],
  [/\b(lumbar puncture|dural puncture|spinal headache|\blp\b)/g, ' '],
  [/\bcervical (length|insufficiency|cancer|ca|os|stenosis of pregnancy)\b|\bshort cervix\b/g, 'cervix'],
  [/\bcervical (spine|radiculopathy|myelopathy|vertebra\w*|pain|disc|disk|fusion|collar|trauma)\b/g, 'spine'],
  [/\bcervical (mass|lymph\w*|adenopathy|node\w*|lump|swelling)\b/g, 'neckmass'],
  [/\b(ascending|thoracic|descending) aort\w*\b/g, 'chest'],
  [/\baort\w*\b|\baaa\b/g, ' '],
];
function regionsOf(text) {
  const out = new Set();
  let t = ascii(text).toLowerCase().replace(/[~_]/g, ' ');
  for (const [re, to] of REGION_PRE) t = t.replace(re, ` ${to} `);
  for (const w of t.split(/[^a-z]+/).filter(Boolean)) {
    if (w === 'limbpart') { out.add(5); continue; }
    if (w === 'neckmass' || w === 'neck' || w === 'thyroid') { out.add(0); continue; }
    if (w === 'cervical') continue;
    const e = EQUIV[w] || w;
    const g = EXTRA_REGION[w] ?? (groupOf.has(e) ? groupOf.get(e) : groupOf.has(w) ? groupOf.get(w) : EXTRA_REGION[e]);
    if (g !== undefined) out.add(g);
  }
  return out;
}
// Populations a phrase names or plainly implies. The site reads age, pregnancy
// and sex from the search as typed, before any alias, so a phrase that loses a
// population word does not lose the filter; a phrase that ADDS one is the
// judgment to check (an adult's projectile vomiting read as pyloric stenosis).
const POP_WORDS = {
  child: /\b(child|children|kid|kids|pa?ediatric|peds|ped|infant|infants|toddler|neonate|neonatal|newborn|baby|babies|adolescent|teen|boy|girl|nicu|preterm|osgood|perthes|ddh|scfe|slipped capital|limp|intussusception|pyloric|necrotizing enterocolitis|nec|spitting up|severs?|sever s|developmental dysplasia|hip click|clicky|hip dysplasia|antenatal)\b/,
  pregnancy: /\b(pregnan\w*|gravid|trimester|gestation\w*|prenatal|obstetric\w*|fetal|fetus|iugr|sga|intrauterine growth|peripartum|postpartum|pph|retained products|rpoc|birth|childbirth|delivery|ectopic|miscarriage|abortion|placental|placenta|abruption|conception|conceive|conceiving|twins?|triplets|preterm labor|short cervix|cervical length|cervical insufficiency|anatomy scan|nuchal)\b/,
  male: /\b(male|males|man|men|gentleman|boy|prostate|bph|psa|mcrpc|scrotum|scrotal|testis|testes|testicles?|testicular|penis|penile|erectile|varicocele|hydrocele|spermatocele|epididym\w*|orchitis)\b/,
  female: /\b(female|females|woman|women|lady|girl|womb|ovary|ovarian|adnexal|adnexa|uterus|uterine|endometri\w*|vaginal|vagina|vulvar|pv|svd|menstrual|periods|menorrhagia|aub|menopaus\w*|postmenopausal|premenopausal|perimenopausal|fibroids?|leiomyomas?|pcos|pregnan\w*|abruption|placent\w*|pph|postpartum|peripartum|birth|delivery|gave birth)\b/,
  elderly: /\b(elderly|older|geriatric)\b/,
  immunocompromised: /\b(immuno\w+|hiv|aids|transplant|neutropeni\w*|chemo\w*)\b/,
};
const popsOf = text => new Set(Object.entries(POP_WORDS).filter(([, re]) => re.test(ascii(text).toLowerCase().replace(/[~_]/g, ' '))).map(([k]) => k));
function changeOf(from, to) {
  const rf = regionsOf(from), rt = regionsOf(to);
  const pf = popsOf(from), pt = popsOf(to);
  const notes = []; let kind = null;
  const lost = [...rf].filter(g => !rt.has(g)), gained = [...rt].filter(g => !rf.has(g));
  if (rf.size && gained.length) {
    kind = 'switch';
    notes.push(`changes body region: ${[...rf].map(g => GROUP_NAMES[g]).join('/')} -> ${[...rt].map(g => GROUP_NAMES[g]).join('/')}`);
  } else if (rf.size && lost.length && to.trim()) {
    kind = 'drops';
    notes.push(`no longer requires the body region it named (${lost.map(g => GROUP_NAMES[g]).join('/')})`);
  } else if (!rf.size && rt.size) {
    kind = 'assigns';
    notes.push(`assigns a body region the phrase did not name: ${[...rt].map(g => GROUP_NAMES[g]).join('/')}`);
  }
  const pgain = [...pt].filter(p => !pf.has(p));
  if (pgain.length) {
    kind = 'population';
    notes.push(`adds a population the phrase did not name: ${pgain.join(', ')}`);
  }
  return { kind, note: notes.join('; ') };
}

// ------------------------------------------------------------ high-stakes conditions
const TIME_CRITICAL = [
  ['stroke', /\b(stroke|cva|tia|transient ischemic|hemipare\w*|hemipleg\w*|aphasia|dysarthria|slurred speech|facial droop|face droop|lvo|large vessel occlusion|last seen well|lsw|sided weakness|arm weakness|intraparenchymal|intracranial hemorrhage|intracerebral|brain bleed|ich)\b/i],
  ['subarachnoid hemorrhage', /\b(sah|subarachnoid|thunderclap|worst headache|sudden onset severe headache|headache,? severe,? sudden|sudden severe headache|rcvs|cerebral aneurysm|brain aneurysm)\b/i],
  ['cauda equina', /\b(cauda equina|saddle an(a)?esthesia|urinary retention|bowel or bladder dysfunction)\b/i],
  ['acute aortic syndrome', /\b(aortic dissection|dissection aort\w*|acute aortic|aortic syndrome|tearing|ripping|type [ab] dissection|ruptured aaa|ruptured aneurysm|pulse deficit|chest dissection|thoracic dissection)\b/i],
  ['pulmonary embolism', /\b(pulmonary embol\w*|\bpe\b|ctpa|saddle embol\w*|saddle pe|massive pe|submassive|lung clot|clot in (the )?lung|vq scan)\b/i],
  ['torsion', /\btorsion\b/i],
  ['ectopic pregnancy', /\b(ectopic|first trimester vaginal bleeding|first trimester bleeding|bleeding in early pregnancy)\b/i],
  ['appendicitis (child or pregnancy)', /\b(appendicitis|appy|rlq|right lower quadrant)\b/i, /\b(child|children|kid|pediatric|peds|infant|toddler|boy|girl|teen|adolescent|year old|yo|pregnan\w*|gravid|trimester|weeks|appendicitis-child)\b/i],
  ['major trauma', /\b(major blunt|polytrauma|multitrauma|multi trauma|trauma activation|pan ?scan|atls|mvc|mva|motor vehicle|car (crash|accident)|motorcycle|gunshot|gsw|stab\w*|knife wound|penetrating|blunt (abdominal|torso|chest|trauma)|seat ?belt sign|splenic (laceration|injury)|liver laceration|fall from (height|ladder|roof)|head (trauma|injury|strike)|hit (her |his )?head|tbi|traumatic brain|concussion|spine trauma|spinal trauma|cervical spine trauma|whiplash|pelvic (ring )?fracture|open book|aortic injury|cardiac contusion|flail chest|blast injury|impalement|handlebar|unstable)\b/i],
  ['child abuse', /\b(abuse|abusive|nonaccidental|non accidental|\bnat\b|shaken|skeletal survey)\b/i],
  ['spinal cord compression', /\b(cord compression|myelopathy|epidural abscess|spinal cord|leg weakness|syrinx)\b/i],
  ['sepsis', /\b(sepsis|septic|neutropenic fever|febrile neutropenia|fever neutropenia|rigors|shock)\b/i],
];
function timeCritical(...texts) {
  const t = texts.filter(Boolean).map(ascii).join(' || ');
  for (const [label, re, also] of TIME_CRITICAL) if (re.test(t) && (!also || also.test(t))) return label;
  return null;
}

// ------------------------------------------------------------ rows
const rows = [];
const refIndex = new Map(); // ref key -> row id, for the flagged file
function addRow(r, refs = []) {
  r.id = shortId(r.prefix, r.key);
  rows.push(r);
  for (const ref of refs) if (!refIndex.has(ref)) refIndex.set(ref, r.id);
  return r;
}

// ---------- gold searches: clinical-gold and redteam-gold (same format)
function goldExpect(c) {
  const parts = [];
  if (c.mode) parts.push(`it ${MODE_PLAIN[c.mode] || c.mode}`);
  if (c.topic) parts.push(`the topic is ${q(c.topic)}`);
  if (c.name) {
    const p = patternPhrase(c.name, `gold name for "${c.q}"`);
    parts.push(p ? `the first scenario shown (or, when a whole topic or a choice opens, any of the names shown) must ${p}` : 'the first scenario shown must match a pattern too complex to put in plain words (see technical column)');
  }
  if (c.not) {
    const p = patternPhrase(c.not, `gold not for "${c.q}"`);
    parts.push(p ? `nothing shown may ${p}` : 'nothing shown may match a pattern too complex to put in plain words (see technical column)');
  }
  if (!parts.length) parts.push('any answer');
  return parts.join('; ') + '.';
}
function goldShown(result) {
  if (result.mode === 'guide') return (topicScenarios.get(result.topic) || []).map(s => s.name);
  if (result.mode === 'list') return result.scenarios.map(s => s.name);
  if (result.mode === 'choose') return result.topics.map(t => t.topic);
  if (result.mode === 'recover') return result.groups.flatMap(g => g.topics.map(t => t.topic));
  return [];
}
function goldJudge(c, result) {
  const shown = goldShown(result);
  const reasons = [];
  const deadEnd = result.mode === 'none' || result.mode === 'recover';
  if (c.mode !== 'none' && c.mode !== 'recover' && deadEnd) reasons.push(`mode ${result.mode}`);
  else if (c.mode && result.mode !== c.mode && !(c.mode === 'none' && result.mode === 'recover')) reasons.push(`mode ${result.mode}`);
  if (c.topic && result.topic !== c.topic) reasons.push('topic');
  if (c.name) {
    const re = new RegExp(c.name);
    const hit = result.mode === 'guide' || result.mode === 'choose' ? shown.some(n => re.test(n)) : re.test(shown[0] || '');
    if (!hit) reasons.push('name');
  }
  if (c.not) for (const n of shown) if (new RegExp(c.not).test(n)) { reasons.push('forbidden shown'); break; }
  return reasons;
}
const normQ = s => ascii(s).toLowerCase().replace(/[^a-z0-9<>=.%/ ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Collect "units": one search with one expectation, from any source.
const units = [];
function addUnit(u) {
  const key = `${u.family}|${normQ(u.q)}|${u.sig}`;
  const prior = units.find(x => x.key === key);
  if (prior) { if (!prior.sources.includes(u.source)) prior.sources.push(u.source); return; }
  units.push({ ...u, key, sources: [u.source] });
}
for (const [file, label] of [['tests/clinical-gold.json', 'clinical gold'], ['tests/redteam-gold.json', 'red-team gold']]) {
  for (const c of readJson(file).cases) {
    const core = { mode: c.mode, topic: c.topic, name: c.name, not: c.not };
    const r = run(c.q);
    addUnit({
      family: 'gold', q: c.q, sig: JSON.stringify(core), groupable: Boolean(c.topic || c.name),
      expected: goldExpect(c), ok: goldJudge(c, r).length === 0, source: label,
      technical: Object.entries(core).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(' ; '),
      expectText: [c.topic, c.name].filter(Boolean).join(' '),
      areaHint: c.topic ? topicRegion.get(c.topic) : null,
    });
  }
}

// ---------- recovery red team: sizes, multi, recover
const recov = readJson('tests/recovery-redteam-gold.json');
const topicOfId = id => byId.get(String(id))?.topic;
function recShown(result) {
  if (result.mode === 'list') return result.scenarios;
  if (result.mode !== 'recover') return [];
  const out = [];
  const walk = (v, d) => {
    if (!v || d > 4) return;
    if (Array.isArray(v)) return v.forEach(x => walk(x, d + 1));
    if (typeof v !== 'object') return;
    if (v.id !== undefined && typeof v.name === 'string' && byId.has(String(v.id))) out.push(v);
    else for (const k of Object.keys(v)) if (k !== 'understood') walk(v[k], d + 1);
  };
  walk(result, 0); return out;
}
function recOffered(result) {
  const set = new Set();
  if (result.mode === 'guide') { set.add(result.topic); for (const t of result.related || []) set.add(t); }
  if (result.mode === 'choose') for (const t of result.topics) set.add(t.topic);
  if (result.mode === 'list') for (const s of result.scenarios) set.add(topicOfId(s.id));
  if (result.mode === 'recover') {
    const walk = (v, d) => {
      if (!v || d > 4) return;
      if (Array.isArray(v)) return v.forEach(x => walk(x, d + 1));
      if (typeof v === 'string') { if (topicSet.has(v)) set.add(v); return; }
      if (typeof v !== 'object') return;
      for (const k of Object.keys(v)) if (k !== 'understood') walk(v[k], d + 1);
    };
    walk(result, 0);
    for (const s of recShown(result)) set.add(topicOfId(s.id));
  }
  return set;
}
function recSatisfies(alt, result) {
  const ids = recShown(result).map(s => String(s.id));
  const topics = recOffered(result);
  if (alt.nothing) return (result.mode === 'none' || result.mode === 'recover') && ids.length === 0 && topics.size === 0;
  if (alt.modes ? !alt.modes.includes(result.mode) : result.mode === 'none') return false;
  if (alt.ids) { const hit = result.mode === 'recover' ? ids.some(id => alt.ids.includes(id)) : alt.ids.includes(ids[0]); if (!hit) return false; }
  for (const g of alt.topic_groups || []) if (!g.some(t => topics.has(t))) return false;
  return true;
}
function recJudge(c, result) {
  const reasons = [];
  if (!c.expected.some(a => recSatisfies(a, result))) reasons.push('expected');
  if (c.forbidden) { const re = new RegExp(c.forbidden); if (recShown(result).some(s => re.test(s.name))) reasons.push('forbidden'); }
  const tp = c.forbidden_topics === undefined ? c.forbidden : c.forbidden_topics;
  if (tp) { const re = new RegExp(tp); if ([...recOffered(result)].some(t => t && re.test(t))) reasons.push('forbidden topic'); }
  return reasons;
}
function altPlain(a) {
  if (a.nothing) return 'shows nothing at all (ACR has no guidance for this)';
  const parts = [];
  if (a.modes) parts.push(`it ${a.modes.map(m => MODE_PLAIN[m] || m).join(' or ')}`);
  if (a.ids) {
    const names = a.ids.map(id => byId.get(String(id))?.name || `scenario ${id} (no longer in the data)`);
    parts.push(`the first scenario listed (or one suggested scenario) is ${names.map(q).join(' or ')}`);
  }
  for (const g of a.topic_groups || []) parts.push(`it offers the topic ${g.map(q).join(' or ')}`);
  return parts.join(', and ') || 'any answer';
}
function forbidPlain(pattern, context, what) {
  if (pattern === undefined || pattern === '') return '';
  if (pattern === '.') return `nothing may be ${what}`;
  const p = patternPhrase(pattern, context);
  return p ? `no ${what} may ${p}` : `nothing ${what} may match a pattern too complex for plain words (see technical column)`;
}
for (const group of ['sizes', 'multi', 'recover']) {
  for (const c of recov[group]) {
    const r = run(c.q);
    const parts = [c.expected.map(altPlain).join(' -- OR -- ')];
    const fs1 = forbidPlain(c.forbidden, `recovery ${group} forbidden for "${c.q}"`, c.forbidden_topics === undefined ? 'scenario or topic shown' : 'scenario shown');
    if (fs1) parts.push(fs1);
    if (c.forbidden_topics !== undefined && c.forbidden_topics !== '') parts.push(forbidPlain(c.forbidden_topics, `recovery ${group} forbidden_topics for "${c.q}"`, 'topic offered'));
    if (group === 'sizes') parts.push(c.size_mm === null ? 'the size has no single value' : `the size should be read as ${c.size_mm} mm`);
    if (c.gap) parts.push('no ACR size range covers this size, so no size-range scenario may be claimed');
    if (c.honest) parts.push('ACR has nothing here: only "no answer" is acceptable');
    const first = c.expected[0] || {};
    addUnit({
      family: `recovery-${group}`, q: c.q, sig: JSON.stringify({ e: c.expected, f: c.forbidden, ft: c.forbidden_topics }),
      groupable: c.expected.every(a => a.ids || a.topic_groups),
      expected: `${parts.join('; ')}. Red team's reason: ${c.rationale}`,
      ok: recJudge(c, r).length === 0, source: `recovery red team (${group})`,
      technical: `expected=${JSON.stringify(c.expected)} ; forbidden=${c.forbidden}${c.forbidden_topics !== undefined ? ` ; forbidden_topics=${c.forbidden_topics}` : ''}`,
      expectText: [...(first.ids || []).map(id => byId.get(String(id))?.name || ''), ...(first.topic_groups || []).flat()].join(' '),
      areaHint: first.ids ? byId.get(String(first.ids[0]))?.region : first.topic_groups?.[0]?.[0] ? topicRegion.get(first.topic_groups[0][0]) : null,
    });
  }
}

// ---------- guard and inference gold
const gi = readJson('tests/guard-inference-gold.json');
const GUARD_REASON_PLAIN = {
  population: 'the scenario is for a different population (age, pregnancy, side or sex)',
  pregnant: 'the scenario is written for pregnancy and the search does not say pregnant',
  pediatric: 'the scenario is for children and the search names no age', teen: 'a child scenario fits this teenager better',
  sex: 'the scenario is for men and the search names no sex', abuse: 'the scenario is about abuse and the search does not ask about abuse',
  negated: 'the search rules out something the scenario is about', opposite: 'the scenario says the opposite of the search (for example chronic for acute)',
  homonym: 'same word, different body part (lumbar hernia is not the lumbar spine)', quadrant: 'the scenario is for a different abdominal quadrant',
  shared: 'the scenario shares no clinical word with the search', organ: 'the scenario names a different organ of the same region', unknown: 'unknown scenario',
};
const guardPlain = reason => reason === null ? 'lets it through' : `blocks it (${reason.startsWith('anatomy:') ? `the scenario does not name the body part "${reason.slice(8)}"` : GUARD_REASON_PLAIN[reason] || reason})`;
for (const c of gi.guard_pass) {
  const verdicts = c.ids.map(id => { const s = byId.get(String(id)); return s ? _guardReason(c.q, s, scenarios).reason : 'unknown'; });
  const ok = verdicts.some(v => v === null);
  addUnit({
    family: 'guard-pass', q: c.q, sig: JSON.stringify(c.ids), groupable: false,
    item: `Suggestion check. For the search ${q(c.q)}, may the site suggest ${c.names.map(q).join(' or ')}? The AI wrote: yes (${c.kind}: ${c.why}).`,
    expected: `The suggestion check lets ${c.names.length > 1 ? 'at least one of these' : 'it'} through.`,
    currentOverride: `The check ${c.ids.map((id, k) => `${guardPlain(verdicts[k])} for ${q(c.names[k] || id)}`).join('; ')}`,
    ok, source: 'guard gold (must pass)', technical: `ids=${c.ids.join(',')} ; kind=${c.kind}`,
    expectText: c.names.join(' '), areaHint: byId.get(String(c.ids[0]))?.region, noTier: true,
  });
}
for (const c of gi.guard_block) {
  const s = byId.get(String(c.id));
  const reason = s ? _guardReason(c.q, s, scenarios).reason : 'unknown';
  addUnit({
    family: 'guard-block', q: c.q, sig: String(c.id), groupable: false,
    item: `Suggestion check. For the search ${q(c.q)}, the site must never suggest ${q(c.name)} [${c.topic}]. The AI wrote: never (${c.kind}: ${c.why}).`,
    expected: 'The suggestion check blocks it.',
    currentOverride: `The check ${guardPlain(reason)}`,
    ok: reason !== null, source: 'guard gold (must block)', technical: `id=${c.id} ; kind=${c.kind}`,
    expectText: `${c.name} ${c.topic}`, areaHint: s?.region, noTier: true,
  });
}
function giView(result) {
  const offered = new Set(), shown = [];
  const skip = new Set(['understood', 'unknown', 'corrected', 'query', 'reason']);
  const walk = v => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') { if (topicSet.has(v)) offered.add(v); return; }
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v !== 'object') return;
    if (v.id !== undefined && typeof v.name === 'string' && byId.has(String(v.id))) { const s = byId.get(String(v.id)); shown.push(s); offered.add(s.topic); return; }
    for (const k of Object.keys(v)) if (!skip.has(k)) walk(v[k]);
  };
  walk(result); return { offered, shown };
}
for (const c of gi.inference) {
  const r = run(c.q);
  const { offered, shown } = giView(r);
  let ok = true;
  if (c.offer.length && !c.offer.some(t => offered.has(t))) ok = false;
  if (c.must_not_offer.some(t => offered.has(t))) ok = false;
  if (c.forbidden && shown.some(s => new RegExp(c.forbidden).test(s.name))) ok = false;
  const tp = c.forbidden_topics === undefined ? c.forbidden : c.forbidden_topics;
  if (tp && [...offered].some(t => new RegExp(tp).test(t))) ok = false;
  if (c.kind === 'infer' && !c.assert_ok && ((r.mode === 'guide' && c.offer.includes(r.topic)) || (r.mode === 'list' && !r.inferred && !r.notice && c.offer.includes(byId.get(String(r.scenarios[0]?.id))?.topic)))) ok = false;
  if (c.kind === 'unchanged') {
    const sig = { mode: r.mode, topics: [...offered].sort(), ids: shown.map(s => String(s.id)) };
    if (JSON.stringify(sig) !== JSON.stringify(c.today)) ok = false;
  }
  const parts = [];
  if (c.kind === 'infer') parts.push(`the site offers, as a question and not as the answer, ${c.offer.map(q).join(' or ')}`);
  if (c.kind === 'negated') parts.push('the search rules the diagnosis out, so the inference must not fire');
  if (c.kind === 'unchanged') parts.push(`no inference is justified; the answer stays as it was (${c.today.mode}: ${c.today.topics.join(' | ') || 'no topics'})`);
  if (c.must_not_offer.length) parts.push(`it must never offer ${c.must_not_offer.map(q).join(' or ')}`);
  const fp = forbidPlain(c.forbidden, `inference forbidden for "${c.q}"`, 'scenario or topic shown');
  if (fp) parts.push(fp);
  addUnit({
    family: `inference-${c.kind}`, q: c.q, sig: JSON.stringify([c.offer, c.must_not_offer, c.forbidden]), groupable: false,
    expected: `${parts.join('; ')}. AI's reason: ${c.why}`, ok, source: `inference gold (${c.kind})`,
    technical: `offer=${c.offer.join(' | ')} ; must_not_offer=${c.must_not_offer.join(' | ')} ; forbidden=${c.forbidden}`,
    expectText: [...c.offer, ...c.must_not_offer].join(' '), areaHint: topicRegion.get(c.offer[0] || c.must_not_offer[0]),
  });
}

// Group units that share one specific expectation: one verdict covers them.
const SEARCH_SEC = { base: 35, extra: 6 };
const groupsOut = new Map();
for (const u of units) {
  const gkey = u.groupable ? `${u.family.startsWith('recovery') ? 'recovery' : u.family}|${u.sig}` : `${u.key}`;
  if (!groupsOut.has(gkey)) groupsOut.set(gkey, []);
  groupsOut.get(gkey).push(u);
}
for (const [gkey, list] of groupsOut) {
  const first = list[0];
  const results = list.map(u => run(u.q));
  const qs = list.map(u => u.q);
  const item = first.item || (list.length === 1 ? `Search: ${q(first.q)}` : `${list.length} searches with the same expected answer: ${qs.map(q).join('; ')}`);
  let current;
  if (first.currentOverride) current = list.map(u => u.currentOverride).join(' || ');
  else {
    const distinct = [...new Set(results.map(shortDescribe))];
    current = list.length === 1 ? describe(results[0]) : distinct.length === 1 ? `All ${list.length}: ${describe(results[0])}` : list.map((u, k) => `${q(u.q)} -> ${shortDescribe(results[k])}`).join(' || ');
  }
  const bad = list.filter(u => !u.ok);
  const agrees = bad.length === 0 ? (list.length > 1 ? `yes (all ${list.length})` : 'yes') : bad.length === list.length ? (list.length > 1 ? `no (all ${list.length})` : 'no') : `partly: not for ${bad.map(u => q(u.q)).join(', ')}`;
  const tc = timeCritical(...qs, first.expectText);
  const area = first.areaHint || areaOfResult(results[0]);
  addRow({
    prefix: 'S', key: `search|${gkey}`, kind: `expected search answer (${[...new Set(list.flatMap(u => u.sources))].join(', ')})`,
    item, expected: first.expected, current, acr_top: first.noTier ? '' : acrTop(results[0]), agrees,
    area: AREA_LABEL[area] ? area : 'general', population: [...new Set(qs.map(populationOf).filter(Boolean))].join(' / '),
    seconds: SEARCH_SEC.base + SEARCH_SEC.extra * (list.length - 1), source: [...new Set(list.flatMap(u => u.sources))].join('; '),
    technical: first.technical, highStakes: tc ? `time-critical: ${tc}` : null, family: first.family, section: 'search',
  }, qs.map(x => `search:${normQ(x)}`));
}

// ---------- phrase rules: hand aliases, mined aliases, context, whole-search, clarify
const PHRASE_SEC = { base: 12, extra: 2 };
function targetPlain(to) {
  if (!to.trim()) return 'ignored (the words are dropped from the search)';
  const soft = to.split(' ').filter(w => w.startsWith('~')).map(w => w.slice(1));
  const hard = to.split(' ').filter(w => !w.startsWith('~')).join(' ')
    .replace(/\bradiographynegative\b/g, 'negative radiograph').replace(/\blowback\b/g, 'low back');
  return `read as ${q(hard)}${soft.length ? `, preferring scenarios that mention ${soft.join(', ')}` : ''}`;
}
const handSet = new Set(T.HAND_ALIASES.map(([f]) => f));
const minedActive = T.MINED_ALIASES.filter(([f]) => !handSet.has(f));
const minedShadowed = T.MINED_ALIASES.length - minedActive.length;
const phraseGroups = new Map();
for (const [from, to] of T.HAND_ALIASES) {
  const k = `hand|${to}`; if (!phraseGroups.has(k)) phraseGroups.set(k, { src: 'hand-written alias', to, froms: [] }); phraseGroups.get(k).froms.push(from);
}
for (const [from, to] of minedActive) {
  const k = `mined|${to}`; if (!phraseGroups.has(k)) phraseGroups.set(k, { src: 'mined alias', to, froms: [] }); phraseGroups.get(k).froms.push(from);
}
function phraseRow({ key, kind, item, froms, to, src, technical, highExtra, refs, exampleQueries, expected }) {
  const qsx = exampleQueries || froms;
  const results = qsx.map(run);
  const distinct = [...new Set(results.map(shortDescribe))];
  const current = qsx.length === 1 ? `Search ${q(qsx[0])}: ${describe(results[0])}` : distinct.length === 1 ? `All ${qsx.length} phrasings searched alone: ${describe(results[0])}` : qsx.map((x, k) => `${q(x)} -> ${shortDescribe(results[k])}`).join(' || ');
  const changes = froms.map(f => ({ f, ...changeOf(f, to) })).filter(c => c.kind);
  const switched = changes.filter(c => c.kind === 'switch' || c.kind === 'population');
  const tc = timeCritical(...froms, to);
  const why = [];
  if (tc) why.push(`time-critical: ${tc}`);
  if (switched.length) why.push(switched.map(c => `${q(c.f)} ${c.note}`).join('; '));
  if (highExtra) why.push(highExtra);
  const assigns = changes.filter(c => c.kind === 'assigns' || c.kind === 'drops');
  const isNew = baseHand && src === 'hand-written alias' ? froms.filter(f => !baseHand.has(f)) : [];
  return addRow({
    prefix: 'P', key, kind, item, expected: expected || `Every search containing the phrase is ${targetPlain(to)}.`, current,
    acr_top: acrTop(results[0]), agrees: '(not a test: judge whether the reading is right)', area: areaOfResult(results[0]),
    population: '', seconds: PHRASE_SEC.base + PHRASE_SEC.extra * (froms.length - 1), source: src + (isNew.length ? ` (new since ${BASE_COMMIT}: ${isNew.join(', ')})` : ''),
    technical, highStakes: why.length ? why.join(' | ') : null,
    regionNote: assigns.length ? assigns.map(c => `${q(c.f)} ${c.note}`).join('; ') : '', section: 'phrase',
  }, refs || froms.map(f => `phrase:${f}`));
}
for (const [k, g] of phraseGroups) {
  phraseRow({
    key: `phrase|${k}`, kind: g.src, froms: g.froms, to: g.to, src: g.src,
    item: `${g.froms.length > 1 ? 'Phrases' : 'Phrase'} ${g.froms.map(q).join(', ')} ${targetPlain(g.to)}`,
    technical: g.froms.map(f => `['${f}', '${g.to}']`).join(' '),
  });
}
for (const c of T.CONTEXT_ALIASES) {
  const src = reSource(c.when);
  let cond;
  if (src === '.') cond = 'in any search not caught by a more specific rule for the same phrase';
  else {
    const whole = src.startsWith('^\\s*$|');
    const rest = whole ? src.slice(6) : src;
    const words = triggerWords(rest, `context alias "${c.phrase}"`);
    cond = `${whole ? 'when it is the whole search, or ' : ''}when the search also mentions any of ${words || '(a pattern too complex for plain words; see technical column)'}`;
  }
  // An example search that meets the condition.
  let example = c.phrase;
  if (src !== '.' && !/^\^/.test(src)) { const w = (wordings(src) || [])[0]; if (w) example = `${c.phrase} ${w.replace(/[\u0001\u0002\u0003]/g, ' ').replace(/\.\.\./g, '').trim()}`; }
  phraseRow({
    key: `context|${c.phrase}|${src}|${c.to}`, kind: 'context-dependent alias', froms: [c.phrase], to: c.to, src: 'hand-written context alias', expected: `Only when the condition holds, the phrase is ${targetPlain(c.to)}.`,
    item: `The phrase ${q(c.phrase)} is ${targetPlain(c.to)} ${cond}`, exampleQueries: [example],
    technical: `phrase=${c.phrase} ; when=/${src}/ ; to=${c.to}${c.before ? ' ; before plain aliases' : ''}`,
    refs: [`context:${c.phrase}`],
  });
}
for (const [whole, to] of Object.entries(T.WHOLE_QUERY_ALIASES)) {
  phraseRow({
    key: `whole|${whole}`, kind: 'whole-search alias', froms: [whole], to, src: 'whole-search alias',
    item: `When the whole clinical content of the search is ${q(whole)}, it is ${targetPlain(to)}`,
    technical: `'${whole}': '${to}'`, highExtra: 'whole-search reading', refs: [`whole:${whole}`],
  });
}
for (const c of T.CLARIFY) {
  const r = run(c.phrase);
  addRow({
    prefix: 'P', key: `clarify|${c.phrase}`, kind: 'clarify question', section: 'phrase',
    item: `When a search names ${q(c.phrase)} and nothing else answers it, the site asks which of these is meant: ${c.topics.map(q).join(', ')}`,
    expected: 'Asks the user to pick one of the listed topics; the list should hold every ACR topic that fits.', current: `Search ${q(c.phrase)}: ${describe(r)}`,
    acr_top: acrTop(r), agrees: '(not a test: judge whether the list is complete and right)', area: areaOfResult(r), population: '',
    seconds: 25, source: 'CLARIFY table', technical: JSON.stringify(c), highStakes: 'clarify entry (always reviewed first)',
  }, [`clarify:${c.phrase}`]);
}

// ---------- inference questions
for (const e of T.INFERENCES) {
  const triggers = e.all.map((re, k) => triggerWords(reSource(re), `inference ${e.id} pattern ${k + 1}`));
  const raws = (e.raw || []).map((re, k) => triggerWords(reSource(re), `inference ${e.id} raw ${k + 1}`));
  const dx = triggerWords(reSource(e.dx), `inference ${e.id} diagnosis words`);
  const trig = triggers.map((t, k) => `(${k + 1}) ${t || 'a pattern too complex for plain words; see technical column'}`).join(' AND ');
  const conds = [];
  if (e.child) conds.push(e.infant ? 'only for an infant' : 'only for a child');
  else conds.push('never for a child');
  if (e.sex) conds.push(`not when the search names a sex other than ${e.sex}`);
  if (e.alone) conds.push('only when nothing else in the search already gives an answer');
  conds.push(`never when the search names or rules out the diagnosis itself (${dx || 'see technical column'})`);
  // An example search: the first wording of each pattern.
  const firstWords = [...e.all, ...(e.raw || [])].map(re => (wordings(reSource(re)) || [''])[0].replace(/[\u0001\u0002\u0003]/g, ' ').replace(/\.\.\./g, '').replace(/\s+/g, ' ').trim());
  const example = `${e.child ? (e.infant ? 'infant ' : 'child ') : ''}${firstWords.join(' and ')}`;
  const r = run(example);
  const fired = r.inference?.id === e.id;
  addRow({
    prefix: 'I', key: `infer|${e.id}`, kind: 'inference question (offered, never asserted)', section: 'rule',
    item: `${e.reason} When a search mentions ${trig}${raws.length ? ` and also says ${raws.join(' and ')}` : ''}, the site asks whether ${e.offer.map(q).join(' or ')} is meant (${conds.join('; ')}).`,
    expected: `Offers ${e.offer.map(q).join(', ')} as a question beside whatever the search found on its own. Is the inference sound, are the trigger words right, and is the topic list right and in the right order?`,
    current: `Example search ${q(example)}: ${describe(r)}${fired ? '' : ' (this example did not fire the inference)'}`,
    acr_top: acrTop(r), agrees: fired ? 'fires on the example' : 'did NOT fire on the example', area: topicRegion.get(e.offer[0]) || 'general',
    population: e.child ? (e.infant ? 'infant' : 'child') : 'adult', seconds: 30, source: 'INFERENCES table',
    technical: `id=${e.id} ; all=${e.all.map(x => `/${reSource(x)}/`).join(' ')}${e.raw ? ` ; raw=${e.raw.map(x => `/${reSource(x)}/`).join(' ')}` : ''} ; dx=/${reSource(e.dx)}/`,
    highStakes: `inference question (always reviewed)${timeCritical(e.reason, e.offer.join(' ')) ? `; time-critical: ${timeCritical(e.reason, e.offer.join(' '))}` : ''}`,
  }, [`infer:${e.id}`]);
}

// ---------- word rules
const WORD_SEC = 10;
const equivGroups = new Map();
for (const [w, to] of Object.entries(T.EQUIVALENT)) { if (!equivGroups.has(to)) equivGroups.set(to, []); equivGroups.get(to).push(w); }
for (const [to, ws] of equivGroups) {
  const ch = ws.map(w => ({ w, ...changeOf(w, to) })).filter(c => c.kind === 'switch' || c.kind === 'population');
  addRow({
    prefix: 'W', key: `equiv|${to}`, kind: 'same-meaning word', section: 'word',
    item: `${ws.map(q).join(', ')} ${ws.length > 1 ? 'are' : 'is'} treated as the same word as ${q(to)}, in searches and in ACR names alike`,
    expected: 'Every use of the word, in any search, means this.', current: 'Applied to every search and every scenario name.',
    acr_top: '', agrees: '(rule)', area: 'general', population: '', seconds: WORD_SEC + 2 * (ws.length - 1), source: 'EQUIVALENT table',
    technical: ws.map(w => `${w}: '${to}'`).join(', '), highStakes: ch.length ? ch.map(c => `${q(c.w)} ${c.note}`).join('; ') : null,
  }, ws.map(w => `equiv:${w}`));
}
for (const [a, b] of T.TEXT_SYNONYMS) {
  const plain = s => s.replace(/\bradiographynegative\b/g, '(negative or normal radiograph)').replace(/\blowback\b/g, 'low back');
  addRow({
    prefix: 'W', key: `textsyn|${a}|${b}`, kind: 'two ways of writing one phrase', section: 'word',
    item: `${q(a)} and ${q(plain(b))} are read as the same thing`, expected: 'Every use means this.', current: 'Applied to every search and every scenario name.',
    acr_top: '', agrees: '(rule)', area: 'general', population: '', seconds: 6, source: 'TEXT_SYNONYMS table', technical: `['${a}', '${b}']`,
    highStakes: null,
  }, [`textsyn:${a}`]);
}
for (const [a, b, strict] of T.ANTONYMS) {
  const item = strict
    ? `${q(a)} and ${q(b)} are treated as opposites even when a scenario name says both: a search about ${a} that does not say ${b} is never answered with a scenario named ${b}, and the reverse`
    : `${q(a)} and ${q(b)} are treated as opposites: a search for one is never answered or offered a scenario named for the other (unless the name says both)`;
  addRow({
    prefix: 'W', key: `antonym|${a}|${b}`, kind: 'opposite pair (answers and suggestion check)', section: 'word', item,
    expected: 'Applied in every answer and in the suggestion check.', current: 'Applied to every search.', acr_top: '', agrees: '(rule)',
    area: 'general', population: '', seconds: WORD_SEC, source: 'ANTONYMS table', technical: JSON.stringify([a, b, strict].filter(Boolean)),
    highStakes: /pregnan|menopausal|reproductive|first|second|third|immuno/.test(`${a} ${b}`) ? 'opposite pair about population' : null,
  }, [`antonym:${a}|${b}`]);
}
const IMPLIES_EXAMPLE = { fever: 'abdominal pain no fever', flag: 'headache no red flags', trauma: 'back pain no trauma', cancer: 'back pain no cancer',
  infection: 'knee pain no infection', projectile: 'infant vomiting not projectile', dissection: 'chest pain no dissection' };
for (const [base, implied] of Object.entries(T.IMPLIES)) {
  const word = base === 'flag' ? 'red flags' : base;
  const ex = IMPLIES_EXAMPLE[base] || `no ${word}`;
  const r = run(ex);
  for (const w of implied) {
    const pop = /pregnant|peripartum|older|hiv|immunocompromised/.test(w);
    addRow({
      prefix: 'W', key: `implies|${base}|${w}`, kind: 'what a ruled-out word also rules out', section: 'word',
      item: `A search that rules out ${q(word)} (for example "no ${word}") also excludes scenarios that mention ${q(w)}`,
      expected: 'Those scenarios are never shown for such a search.', current: `Example search ${q(ex)}: ${describe(r)}`, acr_top: acrTop(r), agrees: '(rule)',
      area: 'general', population: '', seconds: 8, source: 'IMPLIES table', technical: `${base}: ${w}`,
      highStakes: pop ? `changes population: ruling out ${word} also drops ${w} scenarios` : (/dissection|fever|trauma/.test(base) ? `time-critical: ${base}` : null),
    }, [`implies:${base}:${w}`]);
  }
}
for (const [base, kin] of Object.entries(T.NEGATION_KIN)) {
  const ex = `chest pain, ${base} ruled out`;
  const r = run(ex);
  addRow({
    prefix: 'W', key: `kin|${base}`, kind: 'words that go with a ruled-out diagnosis', section: 'word',
    item: `When a search rules out ${q(base)}, the words ${kin.map(q).join(', ')} that an alias may have written for it are ruled out too`,
    expected: 'A search like "no dissection" or "stroke ruled out" is never answered with those scenarios.', current: `Example search ${q(ex)}: ${describe(r)}`,
    acr_top: acrTop(r), agrees: '(rule)', area: 'general', population: '', seconds: 15, source: 'NEGATION_KIN table', technical: `${base}: ${kin.join(', ')}`,
    highStakes: `time-critical: ${timeCritical(base) || base}`,
  }, [`kin:${base}`]);
}
for (const [dxw, quad] of Object.entries(T.QUADRANT_OF)) {
  addRow({
    prefix: 'W', key: `quadrant|${dxw}`, kind: 'diagnosis -> abdominal quadrant', section: 'word',
    item: `${q(dxw)} belongs to the ${quad.toUpperCase()}: a search for it is never answered with a scenario named for another quadrant`,
    expected: 'Applied in answers and in the suggestion check.', current: `Search ${q(dxw)}: ${describe(run(dxw))}`, acr_top: '', agrees: '(rule)',
    area: 'abdomen', population: '', seconds: 8, source: 'QUADRANT_OF table', technical: `${dxw}: '${quad}'`,
    highStakes: 'changes which body region is answered',
  }, [`quadrant:${dxw}`]);
}
for (const [term, alts] of Object.entries(T.GUARD_COVER_SOURCE)) {
  const plain = alts.map(a => (Array.isArray(a) ? q(a.join(' ')) : q(a))).join(', ');
  addRow({
    prefix: 'W', key: `cover|${term}`, kind: 'suggestion check: same place or thing', section: 'word',
    item: `In the suggestion check, a search naming ${q(term === 'lowback' ? 'low back' : term === 'pancrea' ? 'pancreas' : term)} accepts a scenario that names ${plain} instead`,
    expected: 'Used only to let a correct suggestion through (never to pick an answer).', current: 'Applied in the suggestion check.', acr_top: '', agrees: '(rule)',
    area: 'general', population: '', seconds: 8, source: 'GUARD_COVER_SOURCE table', technical: `${term}: ${JSON.stringify(alts)}`, highStakes: null,
  }, [`cover:${term}`]);
}
const NEG_TEST_LABEL = ['a venous duplex or Doppler ultrasound of the leg', 'a CT pulmonary angiogram or VQ scan', 'thyroid function tests'];
T.NEGATIVE_TESTS.forEach(([re, to], k) => {
  addRow({
    prefix: 'W', key: `negtest|${k}|${to}`, kind: 'negative test read as ruling out', section: 'word',
    item: `A search saying ${NEG_TEST_LABEL[k] && T.NEGATIVE_TESTS.length === 3 ? NEG_TEST_LABEL[k] : 'a test (see technical column)'} was negative or normal is read as ${q(to.replace(/xbreakx/g, '').trim())}`,
    expected: 'The ruled-out diagnosis is not answered or offered.', current: `Applied to every search.`, acr_top: '', agrees: '(rule)',
    area: 'general', population: '', seconds: 10, source: 'NEGATIVE_TESTS table', technical: `/${reSource(re)}/ -> '${to}'`,
    highStakes: /pe|dvt/.test(to) ? 'time-critical: pulmonary embolism' : null,
  }, [`negtest:${k}`]);
});

// ---------- topic -> body region
const pySrc = fs.readFileSync(path.join(REPO, 'tools', 'build_scenarios.py'), 'utf8');
const block = pySrc.slice(pySrc.indexOf('REGION_RULES = ['), pySrc.indexOf('\n]', pySrc.indexOf('REGION_RULES = [')));
const regionRules = [...block.matchAll(/\('(\w+)',\s*((?:r'[^']*'\s*)+)\)/g)].map(m => [m[1], new RegExp([...m[2].matchAll(/r'([^']*)'/g)].map(x => x[1]).join(''))]);
if (!regionRules.length) throw new Error('REGION_RULES not found in tools/build_scenarios.py');
for (const [topic, list] of [...topicScenarios].sort((a, b) => topicRegion.get(a[0]).localeCompare(topicRegion.get(b[0])) || a[0].localeCompare(b[0]))) {
  const lower = topic.toLowerCase();
  let rule = null, match = null;
  for (const [region, re] of regionRules) { const m = lower.match(re); if (m) { rule = region; match = m[0]; break; } }
  const actual = topicRegion.get(topic);
  const ages = [...new Set(list.map(s => s.age))].join('/');
  addRow({
    prefix: 'R', key: `region|${topic}`, kind: 'topic -> body region', section: 'region',
    item: `ACR topic ${q(topic)} (${list.length} scenarios, ages: ${ages}) is filed under ${q(AREA_LABEL[actual] || actual)}`,
    expected: `Searches are kept to this region when a body part is named; the region also picks the suggestions shown.`,
    current: rule ? `Because the title contains ${q(match)}` : 'No rule matched, so it falls to "other"', acr_top: '',
    agrees: rule && rule !== actual ? `data says ${actual}, rule says ${rule}: rebuild needed` : '(rule)', area: actual, population: '',
    seconds: 6, source: 'REGION_RULES (tools/build_scenarios.py)', technical: rule ? `rule=${rule} matched "${match}"` : 'no rule', highStakes: null,
  }, [`region:${topic}`]);
}

// ------------------------------------------------------------ machine flags
// The generator's own suspicions. Not clinical verdicts: each says why the
// generator thinks a reviewer should look first. Ranked most likely wrong first.
const FLAGS = [
  { ref: 'phrase:neck dissection', probe: ['neck dissection', 'post neck dissection'], reason: '"Neck dissection" is usually the surgical operation (lymph node dissection for head and neck cancer), not an arterial dissection. The alias sends it to cervical artery dissection.' },
  { ref: 'equiv:cva', probe: ['cva tenderness', 'fever and cva tenderness'], reason: '"CVA" is treated as stroke everywhere. "CVA tenderness" (costovertebral angle, a pyelonephritis or stone sign) is then read as stroke.' },
  { ref: 'phrase:urinary retention', probe: ['urinary retention in a woman', 'urinary retention'], reason: 'Without back or leg words, urinary retention is read as benign prostatic hyperplasia, a male-only topic, even when the search says the patient is a woman. "luts" and "lower urinary tract symptoms" do the same.' },
  { ref: 'phrase:toddler fracture', probe: ['toddler fracture'], reason: 'A toddler fracture is a tibial shaft fracture. The search currently answers first with a basilar skull fracture (head trauma) scenario, then abuse.' },
  { ref: 'implies:dissection:aortic', probe: ['known aortic aneurysm, no dissection', 'chest pain no dissection'], reason: 'Ruling out dissection excludes every scenario that names "aortic". "Known aortic aneurysm, no dissection" then gets no answer and is pointed at the intracranial aneurysm topic.' },
  { ref: 'phrase:type b dissection', probe: ['type b dissection', 'acute type b dissection'], reason: 'An acute type B dissection is an acute aortic syndrome too. The alias sends it to the treatment-planning and follow-up topic, while type A goes to the acute topic.' },
  { ref: 'phrase:intracranial hemorrhage', probe: ['brain bleed', 'intracranial hemorrhage', 'ich'], reason: 'Intracranial hemorrhage, ICH and "brain bleed" are read as intraparenchymal hemorrhage only (not subarachnoid or subdural), and the first scenario shown is the follow-up imaging one, not initial imaging.' },
  { ref: 'phrase:cant move arm', probe: ['cant move arm', 'suddenly cant move left arm'], reason: '"Cannot move arm" is read as acute shoulder pain, while "arm weakness" is read as stroke. Sudden inability to move an arm is a stroke presentation.' },
  { ref: 'phrase:sarcoma', probe: ['sarcoma', 'sarcoma femur'], reason: '"Sarcoma" is read as a soft tissue mass; bone sarcomas (osteosarcoma, Ewing) belong to suspected primary bone tumors. "Sarcoma" opens a soft tissue mass of the abdomen, and "sarcoma femur" opens osteomyelitis of the femur.' },
  { ref: 'phrase:ectopic', probe: ['ectopic', 'ectopic pregnancy pelvic pain', 'pelvic pain positive pregnancy test'], reason: '"Ectopic" goes to first trimester vaginal bleeding. An ectopic with pain but no bleeding sits under acute pelvic pain with a positive pregnancy test; "ectopic pregnancy pelvic pain" gets no direct answer.' },
  { ref: 'context:leg weakness', probe: ['leg weakness', 'sudden left leg weakness'], reason: 'With no back, fever or bladder words, leg weakness is read as myelopathy, even a sudden one-sided leg weakness, which is usually stroke (or radiculopathy).' },
  { ref: 'phrase:ptosis', probe: ['ptosis', 'anisocoria', 'ptosis and headache'], reason: 'Ptosis and anisocoria alone are read as Horner syndrome. A painful third nerve palsy (possible aneurysm) also presents with ptosis and a big pupil and belongs under cranial neuropathy or aneurysm.' },
  { ref: 'phrase:lower abdominal pain', probe: ['lower abdominal pain man'], reason: 'Lower abdominal pain is read as pelvic pain, and a man is then offered postmenopausal and reproductive-age pelvic pain topics.' },
  { ref: 'phrase:elevated psa', probe: ['rising psa', 'rising psa after radiation'], reason: 'Elevated, high and rising PSA all go to suspected cancer before any biopsy. After treatment a rising PSA means suspected recurrence: "rising psa after radiation" still opens the no-prior-biopsy scenario.' },
  { ref: 'context:torsion', probe: ['torsion', 'torsion child'], reason: '"Torsion" alone gives no answer: the context rules need a scrotal or ovarian word and there is no clarify entry. Torsion is time-critical; a question (testicular or ovarian?) may be better than nothing.' },
  { ref: 'phrase:weight loss', probe: ['back pain weight loss', 'back pain with weight loss and night sweats'], reason: '"Weight loss" and "night sweats" are dropped from every search. In back pain they are red flags for cancer or infection, and dropping them returns generic back pain topics.' },
  { ref: 'phrase:groin injury', probe: ['groin injury', 'groin injury man'], reason: 'Groin trauma is read as acute traumatic hip pain only. In a man, a groin injury may be scrotal or testicular trauma.' },
  { ref: 'phrase:herniated disc', probe: ['cervical disc herniation', 'cervical spinal stenosis'], reason: 'Herniated disc and spinal stenosis are read as low back pain with radiculopathy. Cervical forms then get no direct answer.' },
  { ref: 'phrase:volvulus', probe: ['volvulus infant', 'bilious vomiting infant'], reason: 'Volvulus is read as bowel obstruction. In an infant, midgut volvulus is the bilious vomiting emergency; the first answer is a child abdominal pain obstruction scenario.' },
  { ref: 'infer:appendicitis', probe: ['child periumbilical pain moved to the right'], reason: 'The appendicitis inference never fires for a child (it is an adult entry), so a child with the classic migrating pain gets no question about Suspected Appendicitis-Child.' },
  { ref: 'phrase:hand numbness', probe: ['hand numbness', 'tingling fingers at night'], reason: 'Hand numbness and tingling fingers are read as cervical radiculopathy. Carpal tunnel syndrome is the commoner cause and sits under chronic hand and wrist pain.' },
  { ref: 'phrase:pseudotumor', probe: ['orbital pseudotumor'], reason: '"Pseudotumor" is read as idiopathic intracranial hypertension; orbital pseudotumor (orbital inflammation) is then misread.' },
  { ref: 'clarify:foot drop', probe: ['foot drop', 'wrist drop'], reason: 'Foot drop offers low back pain, plexopathy and myelopathy, but not stroke or a peroneal neuropathy. Wrist drop leaves out radial nerve palsy (for example after a humeral fracture).' },
  { ref: 'phrase:trouble walking', probe: ['trouble walking'], reason: '"Trouble walking" is read as ataxia; it is as often weakness, pain or cauda equina.' },
  { ref: 'phrase:tremor', probe: ['essential tremor'], reason: 'Tremor, essential tremor and dystonia are read as parkinsonian syndromes.' },
  { ref: 'equiv:replacement', probe: ['hormone replacement therapy'], reason: '"Replacement" always means arthroplasty, so "hormone replacement therapy" and similar are read as joint replacement.' },
  { ref: 'implies:flag:migraine', probe: ['headache no red flags'], reason: '"No red flags" also excludes migraine, tension, cluster, trigeminal and sinusitis headache scenarios, which are not red flags.' },
  { ref: 'region:Cerebrovascular Diseases-Aneurysm, Vascular Malformation, and Subarachnoid Hemorrhage', probe: ['sah', 'thunderclap headache'], reason: 'The aneurysm and subarachnoid hemorrhage topic is filed under Vascular (its title says "vascular malformation"), while the stroke topic is under Neuro. Region filters for head searches may then treat SAH as another region.' },
  { ref: 'region:Suspected Physical Abuse-Child', probe: ['child abuse'], reason: 'The data has two abuse topics, "Suspected Physical Abuse-Child" (113 scenarios) and "Suspected Physical Abuse \u2014 Child" (7). A search opens one of them; the other may never be shown. Data issue, not a clinical one.' },
];
const flagRows = [];
FLAGS.forEach((f, k) => {
  const results = f.probe.map(run);
  flagRows.push({
    id: `F-${String(k + 1).padStart(2, '0')}`, why_here: 'MACHINE-FLAGGED by the generator, not a clinical verdict', kind: 'generator suspicion',
    item: f.reason, expected: `Review row: ${refIndex.get(f.ref) || '(no matching row found)'}`,
    current: f.probe.map((p, i) => `${q(p)} -> ${shortDescribe(results[i])}`).join(' || '), acr_top: acrTop(results[0]), agrees: '',
    area: AREA_LABEL[areaOfResult(results[0])] ? areaOfResult(results[0]) : 'general', population: populationOf(f.probe[0]), seconds: 40,
    source: 'generator', technical: `ref=${f.ref} ; rank=${k + 1}`,
  });
});
// Data issue: studies named only by a number.
const numericStudies = scenarios.filter(s => (s.top_tier?.studies || []).some(x => /^\d+$/.test(String(x))));
if (numericStudies.length) flagRows.push({
  id: `F-${String(flagRows.length + 1).padStart(2, '0')}`, why_here: 'MACHINE-FLAGGED by the generator, not a clinical verdict', kind: 'data issue',
  item: `${numericStudies.length} scenario(s) list a top study that is only a number in the data: ${numericStudies.map(s => `${q(s.name)} (${s.top_tier.studies.join('; ')})`).join(', ')}`,
  expected: 'Every recommended study has a name.', current: 'Shown to users as a number.', acr_top: '', agrees: '', area: 'general', population: '', seconds: 20,
  source: 'generator', technical: numericStudies.map(s => s.id).join(','),
});

// ------------------------------------------------------------ write files
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.csv$/.test(f)) fs.rmSync(path.join(OUT, f));
const finalize = r => ({ ...r, why_here: r.whyOverride || r.highStakes || r.regionNote || '', minutes: r.seconds });

// High stakes: every inference question and clarify entry, time-critical searches
// and phrase rules, and every rule that changes the body region or population.
const high = rows.filter(r => r.highStakes && r.section !== 'region');
const SECTION_ORDER = { rule: 0, phrase: 1, search: 2, word: 3 };
const tcOrder = label => { const i = TIME_CRITICAL.findIndex(([l]) => label && label.includes(l)); return i < 0 ? 99 : i; };
// Most dangerous first, so the first half hour covers the time-critical
// presentations: by presentation, then inference questions, clarify entries,
// phrase readings, searches and word rules; then everything else in that order.
const kindOrder = r => r.kind.startsWith('inference question') ? 0 : r.kind === 'clarify question' ? 1 : r.kind === 'whole-search alias' ? 2
  : r.section === 'phrase' ? 3 : r.section === 'search' ? 4 : 5;
const tcOf = r => { const m = /time-critical: ([^;|]+)/.exec(r.highStakes || ''); return m ? m[1].trim() : null; };
high.sort((a, b) => tcOrder(tcOf(a)) - tcOrder(tcOf(b)) || kindOrder(a) - kindOrder(b) || a.id.localeCompare(b.id));
const highIds = new Set(high.map(r => r.id));
const files = [];
function emit(name, title, list) {
  let run = 0;
  writeCsv(name, list.map(r => { run += r.seconds || 0; return { ...finalize(r), cumulative: (run / 60).toFixed(1) }; }));
  files.push({ name, title, rows: list.length, seconds: list.reduce((s, r) => s + (r.seconds || 0), 0) });
}
// The 30-minute core holds every rule; of the expected search answers it holds
// the curated clinical gold. The red-team and other generated searches about the
// same time-critical presentations follow in a second file.
const isCore = r => r.section !== 'search' || /clinical gold/.test(r.source);
emit('00_high_stakes.csv', 'High stakes, core (start here): inference questions, clarify entries, time-critical phrase readings and clinical-gold searches, every rule that changes body region or population', high.filter(isCore));
let tcEnd = 0;
{ let t = 0; for (const r of high.filter(isCore)) { t += r.seconds || 0; if (tcOrder(tcOf(r)) < 99) tcEnd = Math.round(t / 60); } }
emit('01_high_stakes_searches.csv', 'High stakes, second pass: the red-team and generated expected answers for the same time-critical presentations', high.filter(r => !isCore(r)));
for (const area of AREAS) {
  const list = rows.filter(r => !highIds.has(r.id) && (r.section === 'search' || r.section === 'phrase' || r.section === 'rule') && (AREA_LABEL[r.area] ? r.area : 'general') === area);
  list.sort((a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section] || (b.regionNote ? 1 : 0) - (a.regionNote ? 1 : 0) || a.kind.localeCompare(b.kind) || a.item.localeCompare(b.item));
  if (list.length) emit(`area_${area}.csv`, `Searches and phrase readings: ${AREA_LABEL[area]}`, list);
}
emit('30_word_rules.csv', 'Word rules: same-meaning words, opposites, what a ruled-out word also rules out, quadrants, suggestion-check equivalences, negative tests',
  rows.filter(r => !highIds.has(r.id) && r.section === 'word'));
emit('40_topic_regions.csv', 'Which body region each ACR topic is filed under', rows.filter(r => r.section === 'region'));
writeCsv('90_flagged_by_generator.csv', flagRows);
files.push({ name: '90_flagged_by_generator.csv', title: 'MACHINE-FLAGGED: what the generator suspects is wrong, with its reasoning', rows: flagRows.length, seconds: flagRows.reduce((s, r) => s + r.seconds, 0) });

// Untranslatable patterns, for the developer.
const untr = [...new Map(untranslatable.map(u => [u.pattern, u])).values()];
fs.writeFileSync(path.join(OUT, 'untranslated_patterns.txt'), ascii([
  'Patterns the generator could not put into plain words. The review rows that use them say so and keep the raw pattern in their technical column.',
  '', ...untr.map(u => `${u.context}: /${u.pattern}/`), '',
].join('\r\n')));

// ------------------------------------------------------------ summary and readme
const mins = s => Math.max(1, Math.round(s / 60));
const total = files.reduce((s, f) => s + f.seconds, 0);
const counts = {
  units: units.length, searchRows: rows.filter(r => r.section === 'search').length,
  hand: T.HAND_ALIASES.length, mined: T.MINED_ALIASES.length, minedActive: minedActive.length, minedShadowed,
  context: T.CONTEXT_ALIASES.length, whole: Object.keys(T.WHOLE_QUERY_ALIASES).length, clarify: T.CLARIFY.length, infer: T.INFERENCES.length,
  equiv: Object.keys(T.EQUIVALENT).length, antonyms: T.ANTONYMS.length, implies: Object.values(T.IMPLIES).flat().length, kin: Object.keys(T.NEGATION_KIN).length,
  cover: Object.keys(T.GUARD_COVER_SOURCE).length, quad: Object.keys(T.QUADRANT_OF).length, topics: topicScenarios.size,
};
let commit = '';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(); } catch { commit = 'unknown'; }
const summary = [
  '# Review packet: summary',
  '',
  `Built on commit ${commit} by \`node tools/build_review_packet.mjs\`. Every judgment below was written by AI models from the ACR data; none has been reviewed by a clinician.`,
  '',
  '| File | What it holds | Rows | Est. minutes |',
  '|---|---|---:|---:|',
  ...files.map(f => `| ${f.name} | ${f.title} | ${f.rows} | ${mins(f.seconds)} |`),
  `| **Total** | | **${files.reduce((s, f) => s + f.rows, 0)}** | **${mins(total)}** |`,
  '',
  'Estimates: 35 s per search row (+6 s per extra search in a grouped row), 30 s per inference question, 12 s per phrase row (+2 s per extra phrasing), 6 to 15 s per word rule, 6 s per topic region, 40 s per machine flag.',
  '',
  '## What was collected',
  '',
  `- ${counts.units} expected search answers (clinical gold, red-team gold, recovery red team, guard and inference gold), merged into ${counts.searchRows} rows: identical searches are merged, and searches that share one specific expected answer share one row.`,
  `- ${counts.hand} hand-written aliases, ${counts.context} context-dependent aliases, ${counts.whole} whole-search aliases and ${counts.clarify} clarify entries.`,
  `- ${counts.mined} mined aliases, of which ${counts.minedActive} are in force (${counts.minedShadowed} are overridden by a hand-written alias for the same phrase and are not listed). Aliases with the same target share one row.`,
  `- ${counts.infer} inference questions, ${counts.equiv} same-meaning words, ${counts.antonyms} opposite pairs, ${counts.implies} ruled-out implications, ${counts.kin} negation-kin entries, ${counts.quad} diagnosis-to-quadrant entries, ${counts.cover} suggestion-check equivalences.`,
  `- ${counts.topics} ACR topics and the body region each is filed under.`,
  `- ${untr.length} patterns could not be put into plain words (listed in untranslated_patterns.txt; the affected rows say so).`,
  '',
];
fs.writeFileSync(path.join(OUT, 'SUMMARY.md'), ascii(summary.join('\n')));

const highFile = files[0];
const readme = `# GRAi Imaging Guide: clinician review packet

GRAi Imaging Guide (https://www.protocolinfo.com, formerly Radex) is a free site that summarizes the ACR Appropriateness Criteria for clinicians. Its search turns what a clinician types ("worst headache of my life", "FOOSH", "PE in pregnancy") into ACR wording and picks the ACR topic or scenario to show.

That translation is full of clinical judgments: which phrase means which ACR scenario, which words mean the same thing, which presentation should raise which question, which body region a topic belongs to, and what answer each test search must give. **All of them were written by AI models from the ACR data. None has been checked by a clinician.** This packet lists them so a radiologist can check them quickly.

## What is in it

| File | What it holds | Rows | Est. minutes |
|---|---|---:|---:|
${files.map(f => `| ${f.name} | ${f.title} | ${f.rows} | ${mins(f.seconds)} |`).join('\n')}

See SUMMARY.md for the counts behind these files.

**Start with ${highFile.name}** (about ${mins(highFile.seconds)} minutes). It holds every inference question the site may ask, the clarify questions, the expected answers and phrase readings for time-critical presentations (stroke, subarachnoid hemorrhage, cauda equina, acute aortic syndrome, pulmonary embolism, torsion, ectopic pregnancy, appendicitis in children and in pregnancy, major trauma, child abuse, cord compression, sepsis), and every alias or rule that changes which body region or which population (child, pregnancy, sex, immune status) is answered. It is sorted most dangerous first, by presentation in the order just listed, and the **running total (minutes)** column shows how far you are: if you only have half an hour, start at the top and stop at 30; the rows about ${tcEnd ? `the time-critical presentations end at about minute ${tcEnd}` : 'the time-critical presentations come first'}, and the region and population rules follow. (The whole file is longer than half an hour because every inference question and every region or population change is in it; nothing was left out to make it shorter.) Of the test searches it holds only the curated clinical-gold set; ${files[1].name} (about ${mins(files[1].seconds)} minutes) holds the red-team and generated test searches for the same time-critical presentations and is the next thing to review.

The area files (area_*.csv) then hold the rest of the searches and phrase readings, one file per body area. 30_word_rules.csv holds the general word rules, and 40_topic_regions.csv the body region of every ACR topic (about 6 seconds a row). 90_flagged_by_generator.csv lists what the script that built this packet suspects is wrong, with its reasons: these are machine-flagged guesses, not clinical verdicts, and are there to point your attention, not to replace it.

## How to read a row

- **the item, in plain words**: the judgment itself, for example "Phrase "foosh" read as "wrist trauma fall"".
- **what it says the site should do**: for a test search, the answer the AI decided it must give; for a rule, what the rule does.
- **what the site does now**: the site's actual answer today, from running the search. "Opens the whole ACR topic" means the full topic page is shown; "Lists scenarios" names the first ones; "Asks which topic" is a choice screen; "No direct answer" is a recovery screen.
- **top ACR category and studies now**: the top-rated ACR category and studies of the first answer, so you can see what a clinician would be told to order.
- **site matches the expectation?**: for test searches, whether today's answer meets the expectation. A "no" is either a site bug or a wrong expectation; your verdict on the expectation decides which.
- **population read from the search**: the age, pregnancy or sex the site read from the words.
- **technical**: the raw value, for the developer. You can ignore it.

Rows that say "N searches with the same expected answer" share one verdict: mark "wrong" and say which search is the exception if only one is.

## How to record a verdict

1. Save a copy of the file with your initials in the name (for example 00_high_stakes_JS.csv). The files are rebuilt by a script, so edits to the originals can be overwritten.
2. In **verdict (ok / wrong / unsure)** type one of: ok, wrong, unsure.
3. In **correct answer or comment** say what it should be when it is wrong (the right ACR topic or scenario, the missing topic, the population it should be limited to), or what makes you unsure. A few words is enough.
4. Leave a row blank if you did not look at it; blank is read as "not reviewed", never as ok.
5. Keep the id column unchanged: it ties your verdict to the judgment. Ids stay the same when the packet is rebuilt, as long as the judgment itself has not changed.

## What happens to your verdicts

- **ok**: the judgment is marked clinician reviewed (with your initials and the date) and kept. Reviewed gold searches become hard tests that may never regress.
- **wrong**: the developer changes the alias, rule or expected answer to what you wrote, adds a test search for it, and re-runs every test; the changed row comes back to you in the next packet marked as changed.
- **unsure**: the row is kept as not reviewed and goes to a second reviewer.
- Nothing you mark is applied automatically: a developer applies each one, and the site's notes ("not yet clinician reviewed") are removed only for rows marked ok.

## Rebuilding

\`node tools/build_review_packet.mjs\` from the repository root rebuilds every file from the current code and data. It reads the tests and the search code and changes neither.
`;
fs.writeFileSync(path.join(OUT, 'README.md'), ascii(readme));

// ------------------------------------------------------------ consistency check
// The instrumented copy must answer exactly as the real module does.
let mismatch = 0;
for (const u of units.slice(0, 400)) if (JSON.stringify(inst.mod.resolveQuery(u.q, scenarios)) !== JSON.stringify(run(u.q))) mismatch++;
fs.rmSync(inst.dir, { recursive: true, force: true });
if (mismatch) { console.error(`instrumented copy disagrees with js/scenario-ranker.js on ${mismatch} searches`); process.exit(1); }

for (const f of files) console.log(`${f.name.padEnd(32)} ${String(f.rows).padStart(5)} rows  ${String(mins(f.seconds)).padStart(4)} min`);
console.log(`untranslated patterns: ${untr.length}`);
