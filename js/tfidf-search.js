/**
 * TF-IDF Search Engine for ACR Appropriateness Criteria
 *
 * Lightweight client-side search using pre-computed TF-IDF vectors.
 * Significantly smaller than Lunr.js while providing good search quality.
 *
 * Usage:
 *   const search = new TFIDFSearch();
 *   await search.init();
 *   const results = search.search('chest pain rule out PE');
 */

import { MEDICAL_SYNONYMS, expandQuery } from './medical-synonyms.js';
import { QueryExpander } from './query-expansion.js';

export class TFIDFSearch {
    constructor(options = {}) {
        this.indexPath = options.indexPath || './data/search/tfidf-index.json';
        this.vocabulary = null;      // Array of terms
        this.vocabLookup = null;     // term -> index
        this.idf = null;             // Array of IDF weights
        this.documents = null;       // {docId: {termIndex: tfidf}}
        this.metadata = null;        // {docId: {title, url}}
        this.ready = false;
    }

    /**
     * Initialize the search engine by loading the index
     */
    async init() {
        console.log('TFIDFSearch: Loading index...');
        const startTime = performance.now();

        try {
            const response = await fetch(this.indexPath);
            if (!response.ok) {
                throw new Error(`Failed to load index: ${response.status}`);
            }

            const data = await response.json();

            this.vocabulary = data.vocabulary;
            this.idf = data.idf;
            this.documents = data.documents;
            this.metadata = data.metadata;

            // Build vocabulary lookup for O(1) term -> index
            this.vocabLookup = {};
            this.vocabulary.forEach((term, idx) => {
                this.vocabLookup[term] = idx;
            });

            this.ready = true;

            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
            console.log(`TFIDFSearch: Ready (${elapsed}s). ` +
                `${Object.keys(this.documents).length} docs, ` +
                `${this.vocabulary.length} terms`);

            return true;
        } catch (error) {
            console.error('TFIDFSearch: Init failed:', error);
            this.ready = false;
            return false;
        }
    }

    /**
     * Tokenize and stem a query string
     */
    tokenize(text) {
        // Lowercase and split on non-alphanumeric
        const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];

        // Filter short tokens and common stopwords
        const stopwords = new Set([
            'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
            'with', 'by', 'from', 'as', 'is', 'are', 'be', 'have', 'has', 'do', 'does',
            'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that',
            'it', 'its', 'if', 'so', 'very', 'just', 'only', 'also', 'more', 'most',
            'patient', 'patients', 'imaging', 'study', 'year', 'old'
        ]);

        // Protected 2-char medical abbreviations
        const medicalAbbrevs = new Set([
            'pe', 'mi', 'gi', 'gu', 'ms', 'tb', 'hx',  // conditions
            'ct', 'mr', 'us', 'xr', 'nm',              // modalities
            'lv', 'rv', 'la', 'ra',                    // anatomy
            'iv', 'im', 'sc'                           // routes
        ]);

        return tokens.filter(t =>
            !stopwords.has(t) && (t.length > 2 || medicalAbbrevs.has(t))
        );
    }

    /**
     * Apply simple medical stemming
     */
    stem(word) {
        const rules = [
            [/itis$/, ''],
            [/osis$/, ''],
            [/ectomy$/, ''],
            [/ography$/, ''],
            [/oscopy$/, ''],
            [/ation$/, ''],
            [/ing$/, ''],
            [/ment$/, ''],
            [/ive$/, ''],
            [/ous$/, ''],
            [/al$/, ''],
            [/ic$/, ''],
            [/ed$/, ''],
            [/ly$/, ''],
            [/s$/, ''],
        ];

        for (const [pattern, replacement] of rules) {
            if (pattern.test(word)) {
                return word.replace(pattern, replacement);
            }
        }
        return word;
    }

    /**
     * Build a query vector from search text
     */
    buildQueryVector(queryText) {
        // Tokenize
        let tokens = this.tokenize(queryText);

        // Protected 2-char medical abbreviations (duplicated for synonym expansion)
        const medicalAbbrevs = new Set([
            'pe', 'mi', 'gi', 'gu', 'ms', 'tb', 'hx',
            'ct', 'mr', 'us', 'xr', 'nm',
            'lv', 'rv', 'la', 'ra',
            'iv', 'im', 'sc'
        ]);

        // Expand with synonyms
        const expanded = new Set();
        tokens.forEach(token => {
            expanded.add(token);
            // Check synonyms
            const synonyms = MEDICAL_SYNONYMS[token];
            if (synonyms) {
                synonyms.forEach(syn => {
                    // Tokenize multi-word synonyms
                    if (syn.includes(' ')) {
                        syn.split(' ').forEach(word => {
                            word = word.toLowerCase().trim();
                            if (word.length > 2 || medicalAbbrevs.has(word)) {
                                expanded.add(word);
                            }
                        });
                    } else {
                        expanded.add(syn);
                    }
                });
            }
        });

        // Stem all terms
        const stemmed = Array.from(expanded).map(t => this.stem(t));

        // Build vector (only for terms in vocabulary)
        const termFreq = {};
        stemmed.forEach(term => {
            const idx = this.vocabLookup[term];
            if (idx !== undefined) {
                termFreq[idx] = (termFreq[idx] || 0) + 1;
            }
        });

        // Convert to TF-IDF
        const queryVec = {};
        for (const [idx, count] of Object.entries(termFreq)) {
            const tf = 1 + Math.log(count);
            queryVec[idx] = tf * this.idf[idx];
        }

        return queryVec;
    }

    /**
     * Compute cosine similarity between query and document vectors
     */
    cosineSimilarity(queryVec, docVec) {
        let dotProduct = 0;
        let queryNorm = 0;
        let docNorm = 0;

        // Compute dot product (only over shared terms)
        for (const [idx, qWeight] of Object.entries(queryVec)) {
            queryNorm += qWeight * qWeight;
            if (docVec[idx]) {
                dotProduct += qWeight * docVec[idx];
            }
        }

        // Document norm
        for (const dWeight of Object.values(docVec)) {
            docNorm += dWeight * dWeight;
        }

        if (queryNorm === 0 || docNorm === 0) {
            return 0;
        }

        return dotProduct / (Math.sqrt(queryNorm) * Math.sqrt(docNorm));
    }

    /**
     * Search for scenarios matching the query
     * @param {string} queryText - Search query
     * @param {Object} options - Search options
     * @returns {Array} Ranked search results
     */
    search(queryText, options = {}) {
        if (!this.ready) {
            console.warn('TFIDFSearch: Not ready');
            return [];
        }

        const {
            limit = 20,
            minScore = 0.05,
            boost = {}  // {docId: multiplier} for boosting specific docs
        } = options;

        const startTime = performance.now();

        // Apply layperson query expansion first
        const expandedQuery = QueryExpander.expand(queryText);
        if (expandedQuery !== queryText) {
            console.log(`TFIDFSearch: Expanded "${queryText}" -> "${expandedQuery}"`);
        }

        // Build query vector from expanded query
        const queryVec = this.buildQueryVector(expandedQuery);

        if (Object.keys(queryVec).length === 0) {
            return [];
        }

        // Score all documents
        const scores = [];
        for (const [docId, docVec] of Object.entries(this.documents)) {
            let score = this.cosineSimilarity(queryVec, docVec);

            // Apply boost if specified
            if (boost[docId]) {
                score *= boost[docId];
            }

            if (score >= minScore) {
                scores.push({
                    id: docId,
                    score,
                    ...this.metadata[docId]
                });
            }
        }

        // Sort by score descending
        scores.sort((a, b) => b.score - a.score);

        // Limit results
        const results = scores.slice(0, limit);

        const elapsed = (performance.now() - startTime).toFixed(1);
        console.log(`TFIDFSearch: "${queryText}" -> ${results.length} results (${elapsed}ms)`);

        return results;
    }

    /**
     * Get search suggestions based on partial query
     */
    suggest(partialQuery, limit = 5) {
        if (!this.ready || partialQuery.length < 2) {
            return [];
        }

        const partial = partialQuery.toLowerCase();
        const suggestions = [];

        // Find terms that start with the partial query
        for (const term of this.vocabulary) {
            if (term.startsWith(partial)) {
                suggestions.push(term);
                if (suggestions.length >= limit * 2) break;
            }
        }

        // Also check metadata titles
        const titleMatches = [];
        for (const [docId, meta] of Object.entries(this.metadata)) {
            if (meta.title && meta.title.toLowerCase().includes(partial)) {
                titleMatches.push({
                    text: meta.title.substring(0, 60),
                    type: 'scenario',
                    docId
                });
                if (titleMatches.length >= limit) break;
            }
        }

        // Combine and dedupe
        const seen = new Set();
        const combined = [];

        // Prioritize title matches
        for (const match of titleMatches) {
            if (!seen.has(match.text.toLowerCase())) {
                seen.add(match.text.toLowerCase());
                combined.push(match);
            }
        }

        // Then vocabulary terms
        for (const term of suggestions) {
            if (!seen.has(term) && combined.length < limit) {
                seen.add(term);
                combined.push({ text: term, type: 'term' });
            }
        }

        return combined.slice(0, limit);
    }

    /**
     * Get matching terms for debugging/explanation
     */
    explainMatch(queryText, docId) {
        if (!this.ready || !this.documents[docId]) {
            return null;
        }

        const queryVec = this.buildQueryVector(queryText);
        const docVec = this.documents[docId];

        const matches = [];
        for (const [idx, qWeight] of Object.entries(queryVec)) {
            if (docVec[idx]) {
                matches.push({
                    term: this.vocabulary[idx],
                    queryWeight: qWeight.toFixed(3),
                    docWeight: docVec[idx].toFixed(3),
                    contribution: (qWeight * docVec[idx]).toFixed(3)
                });
            }
        }

        matches.sort((a, b) => b.contribution - a.contribution);

        return {
            docId,
            title: this.metadata[docId]?.title,
            matchedTerms: matches,
            totalScore: this.cosineSimilarity(queryVec, docVec).toFixed(4)
        };
    }
}

// Export singleton instance for convenience
export const tfidfSearch = new TFIDFSearch();

// Also expose on window for debugging
if (typeof window !== 'undefined') {
    window.TFIDFSearch = TFIDFSearch;
    window.tfidfSearch = tfidfSearch;
}
