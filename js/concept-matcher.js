/**
 * Shared concept matcher used by BOTH the universal/global search (app.js) and
 * the regional tab search (search-engine.js) so the two paths cannot drift.
 *
 * History: the regional path used to accept the first loose substring match
 * (break-on-first, no word boundaries), which wrong-routed common words
 * ("arthritis" -> Back Pain, "mass" -> Brain Tumor) and was non-deterministic
 * across index rebuilds. The global path preferred the LONGEST containing
 * synonym, which for a bare generic word grabbed an obscure whole-sentence
 * synonym ("pain" -> "...new urinary retention and back pain" -> Spinal Tumor).
 * This module fixes both: word-boundary matching, longest-match, and a
 * single-token guard so bare generic words only match an EXACT synonym and
 * otherwise fall through to the embedding / Lunr fallbacks.
 */

// Normalize for matching: lowercase, NFD-strip diacritics, hyphens/underscores/
// slashes -> space, punctuation -> space (so substring word boundaries hold,
// e.g. "rlq pain, us protocol?" boundary-matches the "rlq pain" synonym),
// collapse whitespace.
export function conceptNormalize(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[-_/]/g, ' ')
    .replace(/[,.?!;:()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Does `term` occur as a whole word/phrase inside `text`? (both pre-normalized)
function wholeWordIn(term, text) {
  const i = text.indexOf(term);
  if (i === -1) return false;
  const before = i === 0 || text[i - 1] === ' ';
  const afterIdx = i + term.length;
  const after = afterIdx === text.length || text[afterIdx] === ' ';
  return before && after;
}

/**
 * Resolve a normalized query to a concept id using `normSynMap`
 * ({ normalizedSynonym -> conceptId }).
 *
 * Returns null, or { conceptId, matchedSyn }.
 *
 * Rules:
 *  - Exact synonym match always wins.
 *  - Queries <= 3 chars only match exactly (avoids "pe"/"ms"/"ct" noise).
 *  - Substring matching prefers the LONGEST matching synonym and requires word
 *    boundaries. A synonym <= 3 chars must appear as a whole query token.
 *  - SINGLE-TOKEN queries only match exactly: a bare generic word ("pain",
 *    "mass", "scan") must not match into a longer multi-word synonym, so it
 *    falls through to the semantic/lexical fallback instead of confidently
 *    resolving to one obscure concept.
 *  - For multi-word queries, a synonym that *contains* the query (reverse
 *    direction) only matches when its word count is within +1 of the query's,
 *    so a short query can't latch onto a long scenario-sentence synonym.
 */
export function matchConcept(queryNorm, normSynMap) {
  if (!queryNorm || !normSynMap) return null;

  const exact = normSynMap[queryNorm];
  if (exact) return { conceptId: exact, matchedSyn: queryNorm };

  if (queryNorm.length <= 3) return null;

  const qTokens = queryNorm.split(' ');
  const qWordCount = qTokens.length;
  const singleToken = qWordCount === 1;

  let bestCid = null;
  let bestSyn = null;
  let bestLen = -1;

  for (const syn in normSynMap) {
    let matches = false;
    if (syn.length <= 3) {
      matches = qTokens.includes(syn);
    } else if (queryNorm.includes(syn)) {
      // synonym appears as a whole phrase inside the query (forward direction)
      matches = wholeWordIn(syn, queryNorm);
    } else if (!singleToken && syn.includes(queryNorm)) {
      // query appears as a whole phrase inside a longer synonym (reverse
      // direction) - disabled for single-token queries, and capped so a short
      // query can't match a long scenario-sentence synonym.
      const synWordCount = syn.split(' ').length;
      if (synWordCount <= qWordCount + 1) {
        matches = wholeWordIn(queryNorm, syn);
      }
    }
    if (matches && syn.length > bestLen) {
      bestCid = normSynMap[syn];
      bestSyn = syn;
      bestLen = syn.length;
    }
  }

  return bestCid ? { conceptId: bestCid, matchedSyn: bestSyn } : null;
}
