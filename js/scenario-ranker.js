/**
 * Clinical matching across every ACR scenario.
 *
 * The rule that keeps answers safe: a clinical word in the search is never
 * silently dropped. A scenario must contain every required term. When none
 * does, the result says which word it could not match. Earlier versions scored
 * by partial overlap, which is how "seizure first time" reached pyelonephritis.
 *
 * Negation is read on both sides, so "headache with red flags" cannot match
 * ACR's "headache, no red flags". Pregnancy and age act as filters.
 */
import { conceptNormalize } from './concept-matcher.js?v=20260531a';

// Words that carry no clinical meaning here, including modality words: "mri for
// cauda equina" should reach the same scenario as "cauda equina".
const STOPWORDS = new Set([
  'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'get', 'guideline',
  'guidelines', 'has', 'have', 'how', 'i', 'in', 'into', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'patient', 'person',
  'should', 'the', 'their', 'this', 'to', 'was', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'after',
  'best', 'order', 'ordered', 'protocol', 'recommended', 'recommendation', 'workup', 'work', 'up', 'evaluation', 'evaluate',
  'assessment', 'finding', 'feature', 'sign', 'imaging', 'image', 'study', 'exam', 'scan', 'test', 'smoker', 'man', 'woman',
  'year', 'old', 'yo', 'contrast', 'suspected', 'suspect', 'suspicion', 'concern', 'rule', 'out', 'known', 'possible',
  'ct', 'cta', 'mri', 'mra', 'mrv', 'us', 'ultrasound', 'xray', 'radiograph', 'radiography', 'pet',
  'within', 'hour', 'day', 'week', 'month', 'age', 'alternative', 'clearance', 'w', 'wo',
]);

// Body parts and sides are never dropped from a search: hand trauma is no answer
// to a question about the abdomen, and upper GI bleeding none to lower.
const ANATOMY = new Set([
  'upper', 'lower', 'left', 'right',
  'head', 'brain', 'neck', 'chest', 'lung', 'heart', 'abdomen', 'pelvis', 'pelvic', 'spine', 'cervical', 'thoracic',
  'lumbar', 'lowback', 'shoulder', 'elbow', 'forearm', 'wrist', 'hand', 'finger', 'hip', 'thigh', 'knee', 'leg', 'ankle',
  'foot', 'toe', 'breast', 'axilla', 'kidney', 'liver', 'pancreas', 'spleen', 'bladder', 'prostate', 'uterus', 'ovary',
  'adrenal', 'bowel', 'colon', 'rectum', 'stomach', 'esophagus', 'thyroid', 'orbit', 'ear', 'sinus', 'aorta', 'scrotum',
]);

const STUDY_NAME_RE = /\b(ct|cta|mri|mra|mrv|us|ultrasound|xray|pet) (head|brain|neck|chest|abdomen|pelvis|abdomen pelvis|spine|lumbar spine|cervical spine|knee|hip|shoulder|mesenteric|renal)\b/g;

// Useful for ordering results, but a scenario without them is still a fair match.
const SOFT_TERMS = new Set([
  'acute', 'chronic', 'subacute', 'new', 'first', 'time', 'onset', 'initial', 'elderly', 'severe', 'mild', 'moderate',
  'recurrent', 'low', 'high', 'risk', 'worsening', 'persistent', 'sudden', 'history', 'next', 'follow',
  'adult', 'occult', 'solitary', 'fall', 'incidental', 'indeterminate',
]);

// Different words for the same thing, applied to searches and scenarios alike.
const EQUIVALENT = {
  abdominal: 'abdomen', abd: 'abdomen', renal: 'kidney', hepatic: 'liver', cardiac: 'heart', lump: 'mass',
  gastrointestinal: 'gi', hx: 'history', followup: 'follow', metastases: 'mets', metastasis: 'mets',
  metastatic: 'mets', injury: 'trauma', injuries: 'trauma', traumatic: 'trauma', seizures: 'seizure', epilepsy: 'seizure',
  dizzy: 'dizziness', urolithiasis: 'stone', ache: 'pain', backache: 'back',
};

// Clinician shorthand -> the wording ACR uses. Sorted longest first below.
const ALIASES = [
  ['with red flags', ''],
  ['wake up stroke', 'stroke'],
  ['pain after fall', 'trauma fall'],
  ['ovarian torsion', 'pelvic pain gynecological'],
  ['adnexal torsion', 'pelvic pain gynecological'],
  ['ectopic', 'first trimester vaginal bleeding'],
  ['ankle sprain', 'ankle trauma'],
  ['adrenal incidentaloma', 'adrenal mass'],
  ['gunshot wound', 'penetrating'],
  ['gunshot', 'penetrating'],
  ['stab wound', 'penetrating'],
  ['mammogram', 'breast cancer screening'],
  ['mammography screening', 'breast cancer screening'],
  ['colonoscopy', 'colorectal cancer screening'],
  ['nonaccidental trauma', 'physical abuse'],
  ['non accidental trauma', 'physical abuse'],
  ['non accidental injury', 'physical abuse'],
  ['child abuse', 'physical abuse'],
  ['worst headache of my life', 'headache severe sudden'],
  ['worst headache', 'headache severe sudden'],
  ['transient ischemic attack', 'tia'],
  ['facial droop', 'stroke'],
  ['cerebrovascular accident', 'stroke'],
  ['saddle anesthesia', 'cauda equina'],
  ['spinal cord compression', 'myelopathy'],
  ['cord compression', 'myelopathy'],
  ['epidural abscess', 'spine infection'],
  ['discitis', 'spine infection'],
  ['spinal stenosis', 'low back pain radiculopathy'],
  ['herniated disc', 'low back pain radiculopathy'],
  ['disc herniation', 'low back pain radiculopathy'],
  ['sciatica', 'low back pain radiculopathy'],
  ['neck pain', 'cervical spine pain'],
  ['whiplash', 'cervical spine trauma'],
  ['c spine', 'cervical spine'],
  ['cspine', 'cervical spine'],
  ['l spine', 'lumbar spine'],
  ['scaphoid fracture', 'wrist trauma fracture'],
  ['minor head injury', 'head trauma mild'],
  ['mild head injury', 'head trauma mild'],
  ['concussion', 'head trauma mild'],
  ['elevated lfts', 'abnormal liver function tests'],
  ['abnormal lfts', 'abnormal liver function tests'],
  ['lfts', 'abnormal liver function tests'],
  ['kidney stones', 'flank pain stone disease'],
  ['kidney stone', 'flank pain stone disease'],
  ['renal stones', 'flank pain stone disease'],
  ['renal stone', 'flank pain stone disease'],
  ['ureteral stone', 'flank pain stone disease'],
  ['renal colic', 'flank pain stone disease'],
  ['nephrolithiasis', 'flank pain stone disease'],
  ['peripheral arterial disease', 'claudication'],
  ['peripheral artery disease', 'claudication'],
  ['pad', 'claudication'],
  ['multiple sclerosis', 'demyelinating disease cns'],
  ['ms', 'demyelinating disease cns'],
  ['orbital emergency', 'orbital'],
  ['meniscal tear', 'knee internal derangement'],
  ['meniscus tear', 'knee internal derangement'],
  ['acl tear', 'knee internal derangement'],
  ['liver mass', 'liver lesion'],
  ['cirrhosis', 'liver disease chronic'],
  ['hepatocellular carcinoma', 'hcc'],
  ['liver cancer', 'hcc'],
  ['testicular torsion', 'scrotal pain'],
  ['testicular pain', 'scrotal pain'],
  ['ectopic pregnancy', 'first trimester vaginal bleeding'],
  ['gi bleed', 'gi bleeding'],
  ['ruptured aaa', 'pulsatile abdomen mass aaa'],
  ['abdominal aortic aneurysm', 'aaa'],
  ['mi', 'acute coronary syndrome'],
  ['myocardial infarction', 'acute coronary syndrome'],
  ['heart attack', 'acute coronary syndrome'],
  ['acs', 'acute coronary syndrome'],
  ['chf', 'heart failure'],
  ['colon cancer screening', 'colorectal cancer screening'],
  ['bells palsy', 'bell palsy'],
  ['sob', 'dyspnea'],
  ['shortness of breath', 'dyspnea'],
  ['head injury', 'head trauma'],
  ['pe', 'pulmonary embolism'],
  ['nat', 'physical abuse'],
].sort((a, b) => b[0].length - a[0].length);

// Applied only when these are the whole query, because ACR files the acute
// presentation under a different name from the disease's follow-up scenarios.
const WHOLE_QUERY_ALIASES = {
  'aortic dissection': 'acute aortic syndrome',
  'acute aortic dissection': 'acute aortic syndrome',
  pneumonia: 'acute respiratory illness',
};

// Later-stage scenarios a generic search should not lead with.
const LATER_STAGE_TERMS = ['surveillance', 'follow', 'preop', 'preprocedure', 'tevar', 'repair', 'post', 'posttreatment',
  'replaced', 'arthroplasty', 'treated', 'recurrence'];

const PREGNANT_RE = /\b(pregnant|pregnancy|gravid)\b/;
const NOT_PREGNANT_RE = /\b(not pregnant|non pregnant|nonpregnant)\b/;
const PEDIATRIC_RE = /\b(child|children|kid|kids|pediatric|peds|ped|infant|toddler|neonate|newborn|baby|adolescent|teen|teenager)\b/;
const ADULT_RE = /\b(adult|geriatric)\b/;
const AGE_RE = /\b(\d{1,3})\s*(?:yo|y o|year old|years old|yr old)\b/;

const NEGATION_WORDS = ['no', 'not', 'non', 'without', 'denies', 'negative', 'excluding'];
// Negated terms in a search reach one word, or two for these pairs.
const TWO_WORD_NEGATIONS = ['red flag', 'neuro deficit', 'neurologic deficit', 'prior surgery', 'prior management'];

// One-word searches too general to point at any one topic.
const TOO_BROAD = new Set(['pain', 'mass', 'lesion', 'tumor', 'cancer', 'trauma', 'fracture', 'infection', 'normal']);

const SOFT_MATCH_BONUS = 0.08;
const NAME_MATCH_BONUS = 0.12;
const POPULATION_PENALTY = 0.3;
const LATER_STAGE_PENALTY = 0.15;
const EXTRA_WORD_PENALTY = 0.004;
const MIN_DROPPABLE_FREQUENCY = 10;
const MIN_CORRECTABLE_LENGTH = 6;

function stem(word) {
  const base = word.length > 3 && word.endsWith('s') && !/(ss|is|us)$/.test(word) ? word.slice(0, -1) : word;
  return EQUIVALENT[word] || EQUIVALENT[base] || base;
}

// "ectopic pregnancy" names a diagnosis, not a pregnant patient to filter on.
function normalizeSearch(query) {
  return conceptNormalize(query).replace(/\b(ectopic|molar) pregnancy\b/g, '$1');
}

// "low back" is one idea; "low" alone is only a soft word like "low risk". ACR
// text keeps "back" too, so a search for "back pain" still reaches it.
function joinLowBack(text, { keepBack = false } = {}) {
  return text.replace(/\blow back\b/g, keepBack ? 'lowback back' : 'lowback');
}

function applyAliases(text) {
  if (WHOLE_QUERY_ALIASES[text]) return WHOLE_QUERY_ALIASES[text];
  let out = ` ${text} `;
  for (const [from, to] of ALIASES) out = out.split(` ${from} `).join(` ${to} `);
  return out.trim();
}

/** Pulls out the qualifiers that act as filters. */
export function extractQualifiers(query) {
  const q = normalizeSearch(query);
  const notPregnant = NOT_PREGNANT_RE.test(q);
  let age = null;
  const years = q.match(AGE_RE);
  if (years) age = Number(years[1]) < 18 ? 'pediatric' : 'adult';
  else if (PEDIATRIC_RE.test(q)) age = 'pediatric';
  else if (ADULT_RE.test(q)) age = 'adult';
  return { pregnant: !notPregnant && PREGNANT_RE.test(q), notPregnant, age };
}

function withoutQualifiers(query) {
  const q = normalizeSearch(query);
  // A study named beside a condition is not what to match: "cta abdomen for
  // mesenteric ischemia" asks about mesenteric ischemia.
  const withoutStudy = q.replace(STUDY_NAME_RE, ' ').replace(/\s+/g, ' ').trim();
  return (withoutStudy || q)
    .replace(new RegExp(NOT_PREGNANT_RE.source, 'g'), ' ')
    .replace(new RegExp(AGE_RE.source, 'g'), ' ')
    .replace(new RegExp(PREGNANT_RE.source, 'g'), ' ')
    .replace(new RegExp(PEDIATRIC_RE.source, 'g'), ' ')
    .replace(new RegExp(ADULT_RE.source, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits a search into { required, soft, negated } stemmed terms. */
function parseQuery(query) {
  const words = joinLowBack(applyAliases(withoutQualifiers(query)))
    .replace(/\bnon(?=[a-z]{5,})/g, 'non ')
    .split(' ')
    .filter(Boolean);
  const required = [];
  const soft = [];
  const negated = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (NEGATION_WORDS.includes(word)) {
      const pair = `${words[i + 1] || ''} ${words[i + 2] ? stem(words[i + 2]) : ''}`.trim();
      const reach = TWO_WORD_NEGATIONS.includes(pair) ? 2 : 1;
      for (let j = 1; j <= reach; j++) if (words[i + j]) negated.push(stem(words[i + j]));
      i += reach;
      continue;
    }
    if (STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
    const term = stem(word);
    if (STOPWORDS.has(term)) continue;
    (SOFT_TERMS.has(term) ? soft : required).push(term);
  }
  return { required: [...new Set(required)], soft: [...new Set(soft)], negated: [...new Set(negated)] };
}

/**
 * Tokens of ACR text, split by polarity: "headache, no red flags" gives
 * positive {headache} and negative {red, flag}.
 */
function parseText(text) {
  const positive = new Set();
  const negative = new Set();
  const clean = String(text).toLowerCase().replace(/\bwith or without\b/g, ' any ');
  for (const clause of clean.split(/[,.;:()]/)) {
    let negating = false;
    const normalized = joinLowBack(conceptNormalize(clause), { keepBack: true }).replace(/\bnon(?=[a-z]{5,})/g, 'non ');
    for (const word of normalized.split(' ')) {
      if (!word) continue;
      if (NEGATION_WORDS.includes(word)) {
        negating = true;
        continue;
      }
      (negating ? negative : positive).add(stem(word));
    }
  }
  return { positive, negative };
}

const indexCache = new WeakMap();

function buildIndex(scenarios) {
  const cached = indexCache.get(scenarios);
  if (cached) return cached;
  const docFreq = new Map();
  const docs = scenarios.map(s => {
    const nameText = parseText(s.name.replace(` (${s.topic})`, ''));
    const detail = parseText(`${s.search || ''}. ${s.variant || ''}. ${s.topic || ''}`);
    const keywords = new Set((s.keywords || []).flatMap(k => conceptNormalize(k).split(' ').map(stem)));
    const all = new Set([...nameText.positive, ...detail.positive, ...keywords]);
    for (const t of all) docFreq.set(t, (docFreq.get(t) || 0) + 1);
    return { scenario: s, nameText, detail, keywords, all, lowerName: s.name.toLowerCase() };
  });
  const titles = new Map();
  for (const s of scenarios) {
    if (s.topic && !titles.has(s.topic)) {
      titles.set(s.topic, new Set(joinLowBack(conceptNormalize(s.topic), { keepBack: true }).split(' ').filter(w => w && w !== 'child').map(stem)));
    }
  }
  const index = { docs, docFreq, total: scenarios.length, titles };
  indexCache.set(scenarios, index);
  return index;
}

function populationOf(scenario) {
  return scenario.age || scenario.ageGroup;
}

function scoreDocs(parsed, docs, { pregnant, notPregnant, age }) {
  const scored = [];
  for (const { scenario, nameText, detail, all, lowerName } of docs) {
    const population = populationOf(scenario);
    const isPregnant = /pregnan/.test(lowerName);
    if (pregnant && !isPregnant) continue;
    if (notPregnant && isPregnant) continue;
    if (age && population !== age && population !== 'any') continue;
    if (!parsed.required.every(t => all.has(t))) continue;
    if (parsed.negated.some(t => nameText.positive.has(t))) continue;

    let score = 0;
    for (const t of parsed.required) {
      score += nameText.positive.has(t) ? 1 + NAME_MATCH_BONUS : detail.positive.has(t) ? 0.8 : 0.4;
      // "with red flags" must not lead with ACR's "no red flags".
      if (nameText.negative.has(t) && !nameText.positive.has(t)) score -= 1.5;
    }
    score /= parsed.required.length || 1;
    for (const t of parsed.soft) if (all.has(t)) score += SOFT_MATCH_BONUS;
    for (const t of parsed.negated) if (nameText.negative.has(t)) score += NAME_MATCH_BONUS;

    if (!age && population === 'pediatric') score -= POPULATION_PENALTY;
    if (!pregnant && isPregnant) score -= POPULATION_PENALTY;
    if (nameText.positive.has('initial')) score += 0.05;
    const asked = new Set([...parsed.required, ...parsed.soft]);
    if (LATER_STAGE_TERMS.some(t => nameText.positive.has(t) && !asked.has(t))) score -= LATER_STAGE_PENALTY;
    score -= [...nameText.positive].filter(t => !asked.has(t)).length * EXTRA_WORD_PENALTY;
    scored.push({ scenario, score });
  }
  return scored.sort((a, b) => b.score - a.score);
}

function dedupe(scored, max) {
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

/**
 * Ranks scenarios for a query. Every required term must match.
 * @param {string} query
 * @param {Array} scenarios
 * @param {Object} options
 * @param {number} options.max - maximum results
 * @param {boolean} options.relaxQualifiers - ignore pregnancy and age, to show
 *   the nearest match when no scenario fits them
 */
export function rankScenarios(query, scenarios, { max = 8, relaxQualifiers = false } = {}) {
  const parsed = parseQuery(query);
  if (parsed.required.length === 0 && parsed.soft.length === 0) return [];
  if (!scenarios || scenarios.length === 0) return [];
  const qualifiers = relaxQualifiers ? {} : extractQualifiers(query);
  return dedupe(scoreDocs(parsed, buildIndex(scenarios).docs, qualifiers), max);
}

/** ACR topics whose titles contain the whole search, closest title first. */
function topicsNaming(parsed, age, scenarios) {
  if (parsed.required.length === 0) return [];
  const { titles, docs } = buildIndex(scenarios);
  const counts = new Map();
  const pediatric = new Map();
  for (const { scenario } of docs) {
    counts.set(scenario.topic, (counts.get(scenario.topic) || 0) + 1);
    if (populationOf(scenario) === 'pediatric') pediatric.set(scenario.topic, (pediatric.get(scenario.topic) || 0) + 1);
  }
  const matches = [];
  for (const [topic, title] of titles) {
    if (!parsed.required.every(t => title.has(t))) continue;
    const isChildTopic = (pediatric.get(topic) || 0) > counts.get(topic) / 2;
    if ((age === 'pediatric') !== isChildTopic) continue;
    const asked = new Set([...parsed.required, ...parsed.soft]);
    const extra = [...title].filter(t => !STOPWORDS.has(t) && !asked.has(t)).length;
    const softHits = parsed.soft.filter(t => title.has(t)).length;
    matches.push({ topic, extra, softHits, count: counts.get(topic) });
  }
  const best = Math.max(0, ...matches.map(m => m.softHits));
  return matches
    .filter(m => m.softHits === best)
    .sort((a, b) => a.extra - b.extra || b.count - a.count);
}

/** The ACR topic a query most likely means. */
export function chooseTopic(query, scenarios) {
  const parsed = parseQuery(query);
  const { age } = extractQualifiers(query);
  const named = topicsNaming(parsed, age, scenarios);
  if (named.length > 0) return { topic: named[0].topic, related: named.slice(1, 4).map(n => n.topic) };
  const hits = rankScenarios(query, scenarios, { max: 40 });
  const scores = new Map();
  hits.forEach((s, rank) => {
    if (s.topic) scores.set(s.topic, (scores.get(s.topic) || 0) + 1 / (rank + 1));
  });
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  return ranked.length ? { topic: ranked[0], related: ranked.slice(1, 4) } : null;
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
  const modalities = new Set(['ct', 'cta', 'mri', 'mra', 'mrv', 'us', 'ultrasound', 'radiography', 'pet']);
  if (words.length < 2 || !words.some(w => modalities.has(w))) return [];
  return scenarios.filter(s => s.top_tier && s.top_tier.level === 'Usually Appropriate' &&
    s.top_tier.studies.some(study => {
      const tokens = new Set(conceptNormalize(study).split(' '));
      return words.every(w => tokens.has(w));
    }));
}

/**
 * Rule check for suggestions from the semantic model, which reads wording well
 * but cannot be trusted with the details: a suggestion must respect pregnancy,
 * age and negation, and must contain every body part the search named.
 */
export function guardSuggestions(query, suggestions, scenarios) {
  const parsed = parseQuery(query);
  const { pregnant, notPregnant, age } = extractQualifiers(query);
  const anatomy = parsed.required.filter(t => ANATOMY.has(t));
  const docs = new Map(buildIndex(scenarios).docs.map(d => [String(d.scenario.id), d]));
  return suggestions.filter(s => {
    const doc = docs.get(String(s.id));
    if (!doc) return false;
    const population = populationOf(doc.scenario);
    const isPregnant = /pregnan/.test(doc.lowerName);
    if (pregnant && !isPregnant) return false;
    if (notPregnant && isPregnant) return false;
    if (!pregnant && isPregnant) return false;
    if (age ? population !== age && population !== 'any' : population === 'pediatric') return false;
    if (parsed.negated.some(t => doc.nameText.positive.has(t))) return false;
    // Sharing no clinical word is a guess (varicocele -> varicose veins).
    if (parsed.required.length > 0 && !parsed.required.some(t => doc.all.has(t))) return false;
    return anatomy.every(t => doc.all.has(t));
  });
}

// False when a scenario only matched through narrative keywords.
function namesEveryTerm(scenario, parsed, scenarios) {
  const doc = buildIndex(scenarios).docs.find(d => d.scenario === scenario);
  return parsed.required.every(t => doc.nameText.positive.has(t) || doc.detail.positive.has(t));
}

function editDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// Corrects misspelled words against ACR's own vocabulary. Short words are left
// alone: one letter separates many unrelated clinical terms.
function correctSpelling(query, scenarios) {
  const { docFreq } = buildIndex(scenarios);
  let changed = false;
  const words = conceptNormalize(query).split(' ').map(word => {
    if (word.length < MIN_CORRECTABLE_LENGTH || STOPWORDS.has(word) || docFreq.has(stem(word))) return word;
    if (ALIASES.some(([from]) => from.split(' ').includes(word))) return word;
    const cap = word.length >= 9 ? 2 : 1;
    let best = null;
    let bestDistance = cap + 1;
    for (const [term, freq] of docFreq) {
      if (freq < 2 || term.length < MIN_CORRECTABLE_LENGTH) continue;
      const distance = editDistance(word, term, cap);
      if (distance < bestDistance || (distance === bestDistance && best && freq > docFreq.get(best))) {
        best = term;
        bestDistance = distance;
      }
    }
    if (!best || bestDistance > cap) return word;
    changed = true;
    return best;
  });
  return changed ? words.join(' ') : null;
}

/**
 * Decides what a search should show. Returns one of:
 *   { mode: 'guide', topic, related }      a search that names one ACR topic
 *   { mode: 'choose', topics }             several topics fit; the user picks
 *   { mode: 'list', scenarios, notice? }   specific search
 *   { mode: 'too-broad' }                  a word that points at no one topic
 *   { mode: 'none' }                       nothing matched; use fallback search
 */
export function resolveQuery(query, scenarios) {
  const corrected = correctSpelling(query, scenarios);
  if (corrected) {
    const result = resolveExact(corrected, scenarios);
    if (result.mode !== 'none') return { ...result, corrected };
  }
  return resolveExact(query, scenarios);
}

function resolveExact(query, scenarios) {
  const byStudy = scenariosUsingStudy(query, scenarios);
  if (byStudy.length > 0) {
    return { mode: 'list', scenarios: byStudy.slice(0, 8), summary: `Scenarios where "${query}" is usually appropriate:` };
  }

  const parsed = parseQuery(query);
  const { pregnant, notPregnant, age } = extractQualifiers(query);
  if (parsed.required.length + parsed.soft.length === 0) return { mode: 'none' };
  if (parsed.required.length === 1 && parsed.soft.length === 0 && !pregnant && !age &&
      TOO_BROAD.has(parsed.required[0])) {
    return { mode: 'too-broad' };
  }

  if (!pregnant && !notPregnant && parsed.negated.length === 0) {
    const named = topicsNaming(parsed, age, scenarios);
    const exact = named.filter(n => n.extra === 0);
    if (exact.length === 1 || named.length === 1) {
      const pick = exact.length === 1 ? exact[0] : named[0];
      let related = named.filter(n => n !== pick).map(n => n.topic);
      // "knee pain" opens the chronic topic; ACR files the injury under "trauma".
      if (parsed.required.includes('pain') && parsed.required.length > 1) {
        const anatomyOnly = { ...parsed, required: parsed.required.filter(t => t !== 'pain') };
        related = related.concat(topicsNaming(anatomyOnly, age, scenarios).map(n => n.topic).filter(t => t !== pick.topic));
      }
      return { mode: 'guide', topic: pick.topic, related: [...new Set(related)].slice(0, 3) };
    }
    if (named.length > 1) {
      return { mode: 'choose', topics: named.slice(0, 8).map(n => ({ topic: n.topic, count: n.count })) };
    }
  }

  const hits = rankScenarios(query, scenarios);
  if (hits.length > 0) {
    const notice = namesEveryTerm(hits[0], parsed, scenarios) ? undefined
      : 'No scenario names this directly. These are related through their source narrative, so check that they fit.';
    return { mode: 'list', scenarios: hits, notice };
  }

  if (pregnant || age) {
    // Never drop pregnancy or age silently: say that the nearest match lacks it.
    const nearest = rankScenarios(query, scenarios, { relaxQualifiers: true });
    if (nearest.length > 0) {
      const missing = pregnant ? 'pregnancy' : `${age} patients`;
      return {
        mode: 'list',
        scenarios: nearest,
        notice: `No ACR scenario here is specific to ${missing}. These are the nearest general matches.`,
      };
    }
  }

  // Drop only the most common required term, and say which, so a rare clinical
  // word like "cauda" or a body part can never be the one thrown away.
  const droppable = parsed.required.filter(t => !ANATOMY.has(t));
  if (parsed.required.length >= 2 && droppable.length > 0) {
    const { docFreq, docs } = buildIndex(scenarios);
    const [dropped] = droppable.sort((a, b) => (docFreq.get(b) || 0) - (docFreq.get(a) || 0));
    const kept = parsed.required.filter(t => t !== dropped);
    // A word ACR never uses may be the whole point of the search ("foot drop").
    const partial = (docFreq.get(dropped) || 0) < MIN_DROPPABLE_FREQUENCY ? [] : partialMatches(parsed, kept, docs, { pregnant, notPregnant, age });
    if (partial.length > 0) {
      return { mode: 'list', scenarios: partial, notice: `No scenario mentions "${dropped}", so these match the rest of your search.` };
    }
  }
  return { mode: 'none' };
}

function partialMatches(parsed, kept, docs, qualifiers) {
  return dedupe(scoreDocs({ ...parsed, required: kept }, docs, qualifiers), 8);
}
