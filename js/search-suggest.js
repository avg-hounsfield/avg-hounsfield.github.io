/**
 * Suggestions while typing in the quick search.
 *
 * Three kinds are offered, in this order:
 *   topic     an ACR topic title ("Low Back Pain")
 *   phrase    a phrasing clinicians type that the search understands
 *             ("blood in semen"), shown as the clinician would type it
 *   scenario  one ACR scenario by name
 *
 * Matching is by word prefix: every word typed so far must begin a word of
 * the suggestion. Text that begins with what was typed ranks first, then text
 * that contains it at a word boundary, then the rest. A phrase is offered
 * only if the search itself gives a result for it (checkPhrase), so no
 * suggestion leads to a dead end. Everything runs on data already in the
 * page; nothing typed is sent anywhere.
 *
 * Pure functions, no DOM: unit tested in tests/search-suggest.test.mjs.
 */

export const SUGGEST_MAX = 8;
const MIN_QUERY = 2;
// Shares of the list when every kind has plenty of matches.
const TOPIC_SHARE = 4;
const PHRASE_SHARE = 2;
// How many unchecked phrases one keystroke may put through checkPhrase.
const PHRASE_CHECKS_PER_CALL = 8;

function normalize(text) {
  return String(text || '').toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function entry(kind, label, extra) {
  const text = normalize(label);
  return { kind, label, text, padded: ` ${text} `, ...extra };
}

/**
 * Builds the index once.
 *   topics     [{ name, count }]
 *   scenarios  [{ id, name, topic }]
 *   phrases    [phrase, ...] clinician phrasings (lowercase)
 */
export function buildSuggestIndex({ topics = [], scenarios = [], phrases = [] }) {
  const topicEntries = topics.map(t => entry('topic', t.name, { count: t.count }));
  const topicTexts = new Set(topicEntries.map(t => t.text));

  // Scenarios that share a name within a topic are one suggestion.
  const byName = new Map();
  for (const s of scenarios) {
    const key = `${s.topic}|${s.name}`;
    if (!byName.has(key)) byName.set(key, entry('scenario', s.name, { topic: s.topic, ids: [] }));
    byName.get(key).ids.push(s.id);
  }

  const seen = new Set();
  const phraseEntries = [];
  for (const phrase of phrases) {
    const e = entry('phrase', phrase, {});
    if (e.text.length < 3 || seen.has(e.text) || topicTexts.has(e.text)) continue;
    seen.add(e.text);
    phraseEntries.push(e);
  }
  return { topics: topicEntries, scenarios: [...byName.values()], phrases: phraseEntries, checked: new Map() };
}

// 3: begins with the query. 2: contains it at a word boundary. 1: every word
// typed begins some word. 0: no match.
function tier(e, q, words) {
  if (e.text.startsWith(q)) return 3;
  if (e.padded.includes(` ${q}`)) return 2;
  for (const w of words) if (!e.padded.includes(` ${w}`)) return 0;
  return 1;
}

function ranked(entries, q, words, minTier, tiebreak) {
  const hits = [];
  for (const e of entries) {
    const t = tier(e, q, words);
    if (t >= minTier) hits.push({ e, t });
  }
  hits.sort((a, b) => b.t - a.t || tiebreak(a.e, b.e));
  return hits;
}

/**
 * Suggestions for what has been typed, at most `max`, grouped by kind in the
 * order topic, phrase, scenario; within a kind, prefix matches first.
 *
 * checkPhrase(phrase) returns a short description of what the search shows
 * for the phrase, null if it shows nothing useful, or undefined if it cannot
 * say yet. Answers are remembered.
 * Returns [{ kind, label, detail, value, ids?, topic? }]: value is the search
 * to run for a topic or phrase; a scenario carries its ids.
 */
export function suggest(index, query, { max = SUGGEST_MAX, checkPhrase = () => '' } = {}) {
  const q = normalize(query);
  if (q.length < MIN_QUERY) return [];
  const words = q.split(' ');

  const topics = ranked(index.topics, q, words, 1, (a, b) => b.count - a.count || a.text.length - b.text.length);
  const scenarios = ranked(index.scenarios, q, words, 1, (a, b) => a.text.length - b.text.length || (a.text < b.text ? -1 : 1));

  // Phrases must contain what was typed as typed; loose word matches against
  // 1,600 short phrases are noise.
  const phraseHits = ranked(index.phrases, q, words, 2, (a, b) => a.text.length - b.text.length || (a.text < b.text ? -1 : 1));
  const phrases = [];
  let checks = 0;
  for (const hit of phraseHits) {
    if (phrases.length >= max) break;
    let detail = index.checked.get(hit.e.text);
    if (detail === undefined) {
      if (checks >= PHRASE_CHECKS_PER_CALL) continue;
      checks++;
      detail = checkPhrase(hit.e.label);
      // undefined: the search is not ready to say; ask again next time.
      if (detail === undefined) continue;
      index.checked.set(hit.e.text, detail);
    }
    if (detail !== null) phrases.push({ ...hit, detail });
  }

  // Each kind gets its share; a kind with fewer matches gives its room away.
  let nTopics = Math.min(topics.length, TOPIC_SHARE);
  let nPhrases = Math.min(phrases.length, PHRASE_SHARE);
  let nScenarios = Math.min(scenarios.length, max - nTopics - nPhrases);
  let spare = max - nTopics - nPhrases - nScenarios;
  if (spare > 0) {
    const more = Math.min(spare, topics.length - nTopics);
    nTopics += more;
    spare -= more;
  }
  if (spare > 0) nPhrases += Math.min(spare, phrases.length - nPhrases);

  return [
    ...topics.slice(0, nTopics).map(({ e }) => ({
      kind: 'topic', label: e.label, value: e.label,
      detail: `${e.count} scenario${e.count === 1 ? '' : 's'}`,
    })),
    ...phrases.slice(0, nPhrases).map(({ e, detail }) => ({ kind: 'phrase', label: e.label, value: e.label, detail })),
    ...scenarios.slice(0, nScenarios).map(({ e }) => ({
      kind: 'scenario', label: e.label, value: e.label, detail: e.topic, ids: e.ids, topic: e.topic,
    })),
  ];
}

/** Headings for the groups, in display order. */
export const SUGGEST_GROUPS = [
  { kind: 'topic', label: 'Topics' },
  { kind: 'phrase', label: 'Common phrasings' },
  { kind: 'scenario', label: 'Scenarios' },
];
