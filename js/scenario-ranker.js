/**
 * Qualifier-aware ranking across every ACR scenario.
 *
 * Concepts and summary cards resolve a search to a broad topic and then ignore
 * the rest of the query, so "rlq pain pregnant" showed general appendicitis
 * scenarios and "back pain with cauda equina" showed the blended back pain
 * card. This module scores all scenarios against all of the query's terms and
 * treats pregnancy and patient age as filters, because they change which
 * imaging is appropriate.
 */
import { conceptNormalize } from './concept-matcher.js?v=20260531a';

// Filler plus modality words: a search for "mri for cauda equina" should reach
// the same scenario as "cauda equina" rather than favor names mentioning MRI.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'at', 'for', 'from', 'in', 'is', 'of', 'on', 'or', 'patient', 'the', 'to',
  'what', 'which', 'with', 'after', 'best', 'suspected', 'suspect', 'smoker',
  'imaging', 'image', 'study', 'exam', 'scan', 'ct', 'cta', 'mri', 'mra', 'us', 'ultrasound',
  'xray', 'radiograph', 'radiography',
]);

// Clinician shorthand -> the wording ACR scenario names use. Longest first.
const ALIASES = [
  ['nonaccidental trauma', 'physical abuse'],
  ['non accidental trauma', 'physical abuse'],
  ['scaphoid fracture', 'wrist trauma fracture'],
  ['minor head injury', 'head trauma mild'],
  ['mild head injury', 'head trauma mild'],
  ['elevated lfts', 'abnormal liver function tests'],
  ['abnormal lfts', 'abnormal liver function tests'],
  ['kidney stones', 'flank pain stone disease'],
  ['kidney stone', 'flank pain stone disease'],
  ['renal stones', 'flank pain stone disease'],
  ['renal stone', 'flank pain stone disease'],
  ['ureteral stone', 'flank pain stone disease'],
  ['renal colic', 'flank pain stone disease'],
  ['nephrolithiasis', 'flank pain stone disease'],
  ['lfts', 'abnormal liver function tests'],
  ['peripheral arterial disease', 'claudication'],
  ['multiple sclerosis', 'demyelinating disease cns'],
  ['orbital emergency', 'orbital'],
  ['spinal stenosis', 'low back pain radiculopathy'],
  ['herniated disc', 'low back pain radiculopathy'],
  ['meniscal tear', 'knee internal derangement'],
  ['meniscus tear', 'knee internal derangement'],
  ['acl tear', 'knee internal derangement'],
  ['liver mass', 'liver lesion'],
  ['cirrhosis', 'liver disease chronic'],
  ['head injury', 'head trauma'],
  ['pe', 'pulmonary embolism'],
  ['nat', 'physical abuse'],
];

// Applied only when these are the whole query, because ACR files the acute
// presentation under a different name from the disease's follow-up scenarios.
const WHOLE_QUERY_ALIASES = {
  'aortic dissection': 'acute aortic syndrome',
  'acute aortic dissection': 'acute aortic syndrome',
};

// Later-stage scenarios a generic search should not lead with.
const LATER_STAGE_TERMS = ['surveillance', 'follow', 'followup', 'preop', 'preprocedure', 'tevar', 'repair', 'post', 'recurrent'];

const PREGNANT_RE = /\b(pregnant|pregnancy|gravid)\b/;
const PEDIATRIC_RE = /\b(child|children|kid|kids|pediatric|peds|ped|infant|toddler|neonate|newborn|baby|adolescent|teen|teenager)\b/;
const ADULT_RE = /\b(adult|elderly|geriatric)\b/;
const AGE_RE = /\b(\d{1,3})\s*(?:yo|y o|year old|years old|yr old)\b/;

// Minimum share of the query's weighted terms a scenario name must cover.
const MIN_COVERAGE = 0.6;
// Applied when the query never mentioned the population the scenario is for.
const POPULATION_PENALTY = 0.2;
const LATER_STAGE_PENALTY = 0.1;

function stem(word) {
  return word.length > 3 && word.endsWith('s') && !/(ss|is|us)$/.test(word) ? word.slice(0, -1) : word;
}

function applyAliases(text) {
  if (WHOLE_QUERY_ALIASES[text]) return WHOLE_QUERY_ALIASES[text];
  let out = ` ${text} `;
  for (const [from, to] of ALIASES) out = out.split(` ${from} `).join(` ${to} `);
  return out.trim();
}

/** Pulls out the qualifiers that act as filters: { pregnant, age }. */
export function extractQualifiers(query) {
  const q = conceptNormalize(query);
  let age = null;
  const years = q.match(AGE_RE);
  if (years) age = Number(years[1]) < 18 ? 'pediatric' : 'adult';
  else if (PEDIATRIC_RE.test(q)) age = 'pediatric';
  else if (ADULT_RE.test(q)) age = 'adult';
  return { pregnant: PREGNANT_RE.test(q), age };
}

function withoutQualifiers(query) {
  return conceptNormalize(query)
    .replace(new RegExp(AGE_RE.source, 'g'), ' ')
    .replace(new RegExp(PREGNANT_RE.source, 'g'), ' ')
    .replace(new RegExp(PEDIATRIC_RE.source, 'g'), ' ')
    .replace(new RegExp(ADULT_RE.source, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryTerms(query) {
  const words = applyAliases(withoutQualifiers(query)).split(' ');
  return [...new Set(words.filter(w => w && !STOPWORDS.has(w)).map(stem))];
}

/**
 * True when the query says more than the broad topic it matched, so a blended
 * topic answer would throw away information. `topic` may be null.
 */
export function isSpecificQuery(query, topic) {
  const { pregnant, age } = extractQualifiers(query);
  if (pregnant || age) return true;
  // An alias means ACR files this under different wording than the broad topic.
  const cleaned = withoutQualifiers(query);
  if (applyAliases(cleaned) !== cleaned) return true;
  const terms = queryTerms(query);
  if (!topic) return terms.length >= 2;
  const topicTerms = new Set(queryTerms(topic));
  return terms.some(t => !topicTerms.has(t));
}

const indexCache = new WeakMap();

function buildIndex(scenarios) {
  const cached = indexCache.get(scenarios);
  if (cached) return cached;
  const docFreq = new Map();
  const docs = scenarios.map(s => {
    const name = conceptNormalize(s.name);
    const tokens = new Set(name.split(' ').map(stem));
    for (const t of tokens) docFreq.set(t, (docFreq.get(t) || 0) + 1);
    return { scenario: s, name, tokens };
  });
  const index = { docs, docFreq, total: scenarios.length };
  indexCache.set(scenarios, index);
  return index;
}

/**
 * Ranks scenarios for a query. Scenarios keep their original fields.
 * @param {string} query
 * @param {Array} scenarios - entries with id, name, age, top_procedure or topProcedure
 * @param {Object} options
 * @param {number} options.max - maximum results
 * @param {boolean} options.relaxQualifiers - treat pregnancy and age as soft
 *   preferences; used to show the nearest match when no scenario fits them
 */
export function rankScenarios(query, scenarios, { max = 8, relaxQualifiers = false } = {}) {
  const terms = queryTerms(query);
  if (terms.length === 0 || !scenarios || scenarios.length === 0) return [];

  const { docs, docFreq, total } = buildIndex(scenarios);
  const { pregnant, age } = relaxQualifiers ? { pregnant: false, age: null } : extractQualifiers(query);
  const weight = t => Math.log(1 + total / (1 + (docFreq.get(t) || 0)));
  const totalWeight = terms.reduce((sum, t) => sum + weight(t), 0);

  const scored = [];
  for (const { scenario, name, tokens } of docs) {
    const isPregnant = /pregnan/.test(name);
    if (pregnant && !isPregnant) continue;
    if (age && scenario.age !== age && scenario.age !== 'any') continue;

    const matched = terms.reduce((sum, t) => sum + (tokens.has(t) ? weight(t) : 0), 0);
    const coverage = matched / totalWeight;
    if (coverage < MIN_COVERAGE) continue;

    let score = coverage;
    if (!age && scenario.age === 'pediatric') score -= POPULATION_PENALTY;
    if (!pregnant && isPregnant) score -= POPULATION_PENALTY;
    // Generic searches mean the first imaging decision, stated most plainly.
    if (tokens.has('initial')) score += 0.05;
    if (LATER_STAGE_TERMS.some(t => tokens.has(t) && !terms.includes(t))) score -= LATER_STAGE_PENALTY;
    score -= name.length * 0.0002;
    scored.push({ scenario, score });
  }

  scored.sort((a, b) => b.score - a.score);

  const seen = new Set();
  const results = [];
  for (const { scenario } of scored) {
    const proc = scenario.top_procedure || scenario.topProcedure;
    const key = `${scenario.name}|${proc ? proc.name : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(scenario);
    if (results.length >= max) break;
  }
  return results;
}
