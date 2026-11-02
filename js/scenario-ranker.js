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

const MODALITY_WORDS = new Set(['ct', 'cta', 'mri', 'mra', 'mrv', 'us', 'ultrasound', 'xray', 'radiography', 'pet']);

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
const EXTRA_WORD_PENALTY = 0.004;
// One-word searches too general to point at any one topic.
const TOO_BROAD = new Set(['pain', 'mass', 'lesion', 'tumor', 'cancer', 'trauma', 'injury', 'fracture', 'infection']);

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
    const population = scenario.age || scenario.ageGroup;
    if (age && population !== age && population !== 'any') continue;

    const matched = terms.reduce((sum, t) => sum + (tokens.has(t) ? weight(t) : 0), 0);
    const coverage = matched / totalWeight;
    if (coverage < MIN_COVERAGE) continue;

    let score = coverage;
    if (!age && population === 'pediatric') score -= POPULATION_PENALTY;
    if (!pregnant && isPregnant) score -= POPULATION_PENALTY;
    // Generic searches mean the first imaging decision, stated most plainly.
    if (tokens.has('initial')) score += 0.05;
    if (LATER_STAGE_TERMS.some(t => tokens.has(t) && !terms.includes(t))) score -= LATER_STAGE_PENALTY;
    // Words the query never used make a scenario a looser fit ("higher than
    // average risk" for a search on average risk).
    score -= [...tokens].filter(t => !terms.includes(t)).length * EXTRA_WORD_PENALTY;
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

function titleTokens(topic) {
  return new Set(conceptNormalize(topic).split(' ').map(stem));
}

/** The ACR topic a query most likely means, with close alternatives. */
export function chooseTopic(query, scenarios) {
  const terms = queryTerms(query);
  const hits = rankScenarios(query, scenarios, { max: 40 });
  const scores = new Map();
  hits.forEach((s, rank) => {
    if (s.topic) scores.set(s.topic, (scores.get(s.topic) || 0) + 1 / (rank + 1));
  });
  // A topic whose title contains the whole query is a candidate even when its
  // scenario names use other wording.
  const { pregnant, age } = extractQualifiers(query);
  for (const { scenario } of buildIndex(scenarios).docs) {
    const topic = scenario.topic;
    if (!topic || scores.has(topic)) continue;
    const population = scenario.age || scenario.ageGroup;
    if (age && population !== age && population !== 'any') continue;
    const title = titleTokens(topic);
    if (!pregnant && terms.every(t => title.has(t))) scores.set(topic, 0);
  }
  const ranked = [...scores.entries()]
    .map(([topic, score]) => {
      const title = titleTokens(topic);
      const covered = terms.filter(t => title.has(t)).length / (terms.length || 1);
      const exact = covered === 1 && [...title].filter(t => !STOPWORDS.has(t)).length === terms.length;
      return { topic, score: score + covered * 2 + (exact ? 3 : 0), covered };
    })
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  return { topic: ranked[0].topic, covered: ranked[0].covered, related: ranked.slice(1, 4).map(r => r.topic) };
}

/**
 * Turns one ACR topic into generic guidance: its scenarios grouped by what they
 * recommend, so each group reads as one branch of "it depends".
 */
export function buildTopicGuide(topic, scenarios) {
  const groups = new Map();
  for (const s of scenarios) {
    if (s.topic !== topic || !s.top_tier) continue;
    const key = `${s.top_tier.level}|${[...s.top_tier.studies].sort().join('|')}`;
    if (!groups.has(key)) {
      groups.set(key, { level: s.top_tier.level, studies: s.top_tier.studies, disagreement: false, scenarios: [] });
    }
    const group = groups.get(key);
    group.scenarios.push(s);
    group.disagreement = group.disagreement || s.top_tier.disagreement;
  }
  const order = { 'Usually Appropriate': 0, 'May Be Appropriate': 1, 'Usually Not Appropriate': 2 };
  return [...groups.values()].sort((a, b) =>
    order[a.level] - order[b.level] || b.scenarios.length - a.scenarios.length);
}

// A search that is only a study name ("mra head") asks when to order that study.
function scenariosUsingStudy(query, scenarios) {
  const words = conceptNormalize(query).split(' ');
  if (words.length < 2 || !words.some(w => MODALITY_WORDS.has(w))) return [];
  return scenarios.filter(s => s.top_tier && s.top_tier.level === 'Usually Appropriate' &&
    s.top_tier.studies.some(study => {
      const tokens = new Set(conceptNormalize(study).split(' '));
      return words.every(w => tokens.has(w));
    }));
}

/**
 * Decides what a search should show. Returns one of:
 *   { mode: 'guide', topic, related }      broad search that names an ACR topic
 *   { mode: 'list', scenarios, notice? }   specific search
 *   { mode: 'too-broad' }                  a single word matching most of ACR
 *   { mode: 'none' }                       nothing matched; use fallback search
 */
export function resolveQuery(query, scenarios) {
  const byStudy = scenariosUsingStudy(query, scenarios);
  if (byStudy.length > 0) {
    return { mode: 'list', scenarios: byStudy.slice(0, 8), summary: `Scenarios where "${query}" is usually appropriate:` };
  }

  const terms = queryTerms(query);
  if (terms.length === 0) return { mode: 'none' };

  if (terms.length === 1 && TOO_BROAD.has(terms[0])) return { mode: 'too-broad' };

  const { pregnant, age } = extractQualifiers(query);
  const hits = rankScenarios(query, scenarios);
  if (hits.length === 0) {
    if (!pregnant && !age) return { mode: 'none' };
    // Never drop pregnancy or age silently: say that the nearest match lacks it.
    const nearest = rankScenarios(query, scenarios, { relaxQualifiers: true });
    if (nearest.length === 0) return { mode: 'none' };
    const missing = pregnant ? 'pregnancy' : `${age} patients`;
    return {
      mode: 'list',
      scenarios: nearest,
      notice: `No ACR scenario here is specific to ${missing}. These are the nearest general matches.`,
    };
  }

  if (!pregnant) {
    const choice = chooseTopic(query, scenarios);
    if (choice && choice.covered === 1) return { mode: 'guide', topic: choice.topic, related: choice.related };
  }
  return { mode: 'list', scenarios: hits };
}
