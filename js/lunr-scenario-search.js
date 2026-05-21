/**
 * Lunr-backed scenario name + keyword search.
 *
 * Uses the pre-built Lunr index at data/search/lunr-scenarios.json (8.7MB,
 * BM25-style TF-IDF over all 3,929 scenario names). Lunr handles
 * tokenization, stemming, and scoring better than the ad-hoc substring
 * matching in app.js _globalScenarioNameSearch.
 *
 * The Lunr index covers scenarios that may have no concept routing - this
 * is the safety-net path that lets the long tail (76% of ACR topics) still
 * surface useful results without the embedding fallback getting involved.
 *
 * Lunr global is loaded via the <script> tag in index.html.
 */

const INDEX_URL = 'data/search/lunr-scenarios.json?v=20260521a';

let _index = null;
let _docs = null;      // documents keyed by lunr internal id (string of int)
let _docsByAcrId = null;  // acr_topic_id (str) -> doc
let _loadingPromise = null;

async function _load() {
  if (_index) return;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    if (typeof window === 'undefined' || !window.lunr) {
      throw new Error('Lunr global not available - check index.html script tag');
    }
    const t0 = performance.now();
    const res = await fetch(INDEX_URL);
    if (!res.ok) throw new Error(`Lunr index fetch failed: ${res.status}`);
    const data = await res.json();
    _index = window.lunr.Index.load(data.index);
    _docs = data.documents;
    _docsByAcrId = {};
    for (const [lunrId, doc] of Object.entries(_docs)) {
      if (doc && doc.acr_topic_id) {
        _docsByAcrId[String(doc.acr_topic_id)] = doc;
      }
    }
    console.log(`[lunr-scenario-search] loaded ${Object.keys(_docs).length} docs in ${(performance.now() - t0).toFixed(0)}ms`);
  })();
  return _loadingPromise;
}

/**
 * Search Lunr for query and return up to max scenario hits.
 *
 * @param {string} query - free-text search query
 * @param {number} max   - max hits to return (default 10)
 * @returns {Promise<Array<{id, name, region, score}>>}
 *   id = acr_topic_id (string), score = Lunr BM25 relevance
 */
export async function search(query, max = 10) {
  await _load();
  if (!_index) return [];
  const q = (query || '').trim();
  if (q.length < 2) return [];

  // Lunr's default query parser. Wrap with edge-fuzziness for typos:
  // append ~1 to each term so single-character edits also match.
  // But keep it permissive: also try the plain query first and merge.
  let results = [];
  try {
    results = _index.search(q);
  } catch (e) {
    // Lunr can throw on special chars (e.g., "/", ":"); strip and retry
    try {
      results = _index.search(q.replace(/[^a-zA-Z0-9\s]/g, ' ').trim());
    } catch {
      return [];
    }
  }

  if (results.length === 0) {
    // Fuzzy retry with edit distance 1
    try {
      const fuzzyQ = q
        .split(/\s+/)
        .filter(t => t.length >= 3)
        .map(t => `${t}~1`)
        .join(' ');
      if (fuzzyQ) results = _index.search(fuzzyQ);
    } catch {
      // ignore
    }
  }

  const hits = [];
  for (const r of results.slice(0, max)) {
    const doc = _docs[r.ref];
    if (!doc) continue;
    hits.push({
      id: String(doc.acr_topic_id),
      name: doc.name,
      region: doc.body_region,
      score: r.score,
    });
  }
  return hits;
}

/** Get a doc by acr_topic_id (useful when joining with scenario_names.json metadata). */
export async function getDoc(acrTopicId) {
  await _load();
  return _docsByAcrId ? _docsByAcrId[String(acrTopicId)] || null : null;
}

/** Background warmup so the first search feels instant. */
export function warmup() {
  _load().catch(e => console.warn('[lunr-scenario-search] warmup failed:', e));
}
