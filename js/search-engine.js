/**
 * Unified Search Engine
 *
 * Provides instant search with ACR appropriateness scoring.
 * Combines database queries with fuzzy text matching for best results.
 */

import { initDatabase, isDatabaseReady, query } from './db/database.js';
import { unifiedSearch, searchScenarios, searchProtocols, MEDICAL_SYNONYMS } from './db/queries.js';

// Lunr index cache
let lunrIndex = null;
let documentsMap = null;

/**
 * Initialize the search engine
 * Loads database and optionally pre-built Lunr indexes
 */
export async function initSearchEngine() {
    console.log('Initializing search engine...');
    const startTime = performance.now();

    try {
        // Initialize database
        await initDatabase();

        // Try to load pre-built Lunr index for faster text search
        try {
            const response = await fetch('./data/search/lunr-scenarios.json');
            if (response.ok) {
                const indexData = await response.json();
                // Reconstruct Lunr index
                if (typeof lunr !== 'undefined') {
                    lunrIndex = lunr.Index.load(indexData.index);
                    documentsMap = indexData.documents;
                    console.log('Loaded pre-built Lunr index');
                }
            }
        } catch (e) {
            console.warn('Could not load pre-built Lunr index, using SQL search only:', e);
        }

        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`Search engine initialized in ${elapsed}s`);

        return true;
    } catch (error) {
        console.error('Search engine initialization failed:', error);
        throw error;
    }
}

/**
 * Main search function
 * Returns results with ACR scores and relevance ranking
 */
export function search(queryText, options = {}) {
    if (!isDatabaseReady()) {
        console.warn('Search called before database ready');
        return { scenarios: [], protocols: [], totalCount: 0 };
    }

    const {
        bodyRegion = null,
        modality = null,
        limit = 50
    } = options;

    const searchText = queryText.trim().toLowerCase();

    if (searchText.length < 2) {
        return { scenarios: [], protocols: [], totalCount: 0 };
    }

    // Expand search terms with medical synonyms
    const expandedTerms = expandSearchWithSynonyms(searchText);

    // Perform unified search
    const results = unifiedSearch(searchText, {
        bodyRegion,
        modality,
        limit,
        includeProtocols: true
    });

    // Score and rank results
    const scoredScenarios = results.scenarios.map(scenario => ({
        ...scenario,
        type: 'scenario',
        relevanceScore: calculateRelevanceScore(scenario, searchText, expandedTerms),
        displayScore: formatACRScore(scenario.topRating)
    }));

    const scoredProtocols = results.protocols.map(protocol => ({
        ...protocol,
        type: 'protocol',
        relevanceScore: calculateRelevanceScore(protocol, searchText, expandedTerms),
        displayScore: null // Protocols don't have ACR scores directly
    }));

    // Sort by relevance score, then by ACR rating for scenarios
    scoredScenarios.sort((a, b) => {
        // First by ACR rating (higher is better)
        if (a.topRating !== b.topRating) {
            return b.topRating - a.topRating;
        }
        // Then by relevance score
        return b.relevanceScore - a.relevanceScore;
    });

    scoredProtocols.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return {
        scenarios: scoredScenarios,
        protocols: scoredProtocols,
        totalCount: scoredScenarios.length + scoredProtocols.length,
        query: searchText,
        expandedTerms
    };
}

/**
 * Calculate relevance score for a result
 */
function calculateRelevanceScore(item, searchText, expandedTerms) {
    let score = 0;
    const name = (item.scenario_name || item.name || '').toLowerCase();
    const keywords = Array.isArray(item.keywords) ? item.keywords.join(' ').toLowerCase() : '';
    const description = (item.description || item.indications || '').toLowerCase();

    // Exact name match
    if (name === searchText) {
        score += 100;
    }
    // Name starts with search text
    else if (name.startsWith(searchText)) {
        score += 80;
    }
    // Name contains search text
    else if (name.includes(searchText)) {
        score += 60;
    }

    // Keyword matches
    const searchWords = searchText.split(/\s+/);
    searchWords.forEach(word => {
        if (keywords.includes(word)) {
            score += 20;
        }
        if (description.includes(word)) {
            score += 10;
        }
    });

    // Synonym matches
    expandedTerms.forEach(term => {
        if (term !== searchText && (name.includes(term) || keywords.includes(term))) {
            score += 15;
        }
    });

    // Boost for high ACR ratings
    if (item.topRating) {
        score += item.topRating * 5;
    }

    return score;
}

/**
 * Expand search text with medical synonyms
 */
function expandSearchWithSynonyms(searchText) {
    const terms = new Set([searchText]);

    for (const [primary, synonyms] of Object.entries(MEDICAL_SYNONYMS)) {
        if (synonyms.some(syn => searchText.includes(syn))) {
            synonyms.forEach(syn => terms.add(syn));
            terms.add(primary);
        }
    }

    return Array.from(terms);
}

/**
 * Format ACR score for display
 */
function formatACRScore(rating) {
    if (!rating || rating === 0) return null;

    let level, className;
    if (rating >= 7) {
        level = 'Usually Appropriate';
        className = 'acr-high';
    } else if (rating >= 4) {
        level = 'May Be Appropriate';
        className = 'acr-medium';
    } else {
        level = 'Usually Not Appropriate';
        className = 'acr-low';
    }

    return { rating, level, className };
}

/**
 * Get appropriateness rating details for a specific scenario/procedure combination
 */
export function getACRRating(scenarioId, procedureId) {
    if (!isDatabaseReady()) return null;

    const result = query(`
        SELECT ar.*, v.name as variant_name
        FROM appropriateness_ratings ar
        JOIN variants v ON v.id = ar.variant_id
        WHERE v.scenario_id = ? AND ar.procedure_id = ?
        ORDER BY ar.rating DESC
        LIMIT 1
    `, [scenarioId, procedureId]);

    return result.length > 0 ? result[0] : null;
}

/**
 * Quick suggestions for search autocomplete
 */
export function getSuggestions(partialQuery, limit = 8) {
    if (!isDatabaseReady() || partialQuery.length < 2) {
        return [];
    }

    const searchLower = partialQuery.toLowerCase();

    // Get scenario name suggestions
    const scenarios = query(`
        SELECT DISTINCT name
        FROM scenarios
        WHERE LOWER(name) LIKE ?
        ORDER BY
            CASE WHEN LOWER(name) LIKE ? THEN 1 ELSE 2 END,
            LENGTH(name)
        LIMIT ?
    `, [`%${searchLower}%`, `${searchLower}%`, limit]);

    return scenarios.map(s => ({
        text: s.name,
        type: 'scenario'
    }));
}

/**
 * Get popular/trending searches (based on high-rated scenarios)
 */
export function getPopularSearches(limit = 10) {
    if (!isDatabaseReady()) return [];

    return query(`
        SELECT
            s.name,
            s.body_region,
            MAX(ar.rating) as top_rating
        FROM scenarios s
        JOIN variants v ON v.scenario_id = s.id
        JOIN appropriateness_ratings ar ON ar.variant_id = v.id
        WHERE ar.rating >= 8
        GROUP BY s.id
        ORDER BY COUNT(*) DESC
        LIMIT ?
    `, [limit]);
}

/**
 * LLM-enhanced search for complex clinical queries
 * Uses AI to expand terms and re-rank results
 */
export async function aiEnhancedSearch(queryText, options = {}) {
    const AI_ENDPOINT = 'https://protocol-help-ai.58hwdggkb7.workers.dev';

    // First, get regular search results
    const regularResults = search(queryText, options);

    // For very short or simple queries, just return regular results
    if (queryText.length < 10 || regularResults.totalCount < 5) {
        return { ...regularResults, aiEnhanced: false };
    }

    try {
        // Ask AI to expand and interpret the clinical query
        const response = await fetch(AI_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [{
                    role: 'user',
                    content: `Given this clinical imaging search query: "${queryText}"

Return a JSON object with:
1. "expandedTerms": array of related medical terms to search (max 5)
2. "bodyRegion": most relevant body region (neuro, spine, chest, abdomen, msk, vascular, breast, peds, or null)
3. "priority": which imaging modality should be prioritized (CT, MRI, US, XR, or null)
4. "interpretation": brief interpretation of what the user is looking for (1 sentence)

Only return valid JSON, no other text.`
                }],
                context: { query: queryText }
            })
        });

        if (!response.ok) {
            return { ...regularResults, aiEnhanced: false };
        }

        const data = await response.json();

        // Try to parse the AI response as JSON
        let aiData;
        try {
            // Extract JSON from response (might be wrapped in markdown code blocks)
            const jsonMatch = data.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                aiData = JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.warn('Could not parse AI response as JSON');
            return { ...regularResults, aiEnhanced: false };
        }

        if (!aiData) {
            return { ...regularResults, aiEnhanced: false };
        }

        // Re-search with expanded terms
        const expandedQuery = [queryText, ...(aiData.expandedTerms || [])].join(' ');
        const expandedResults = search(expandedQuery, {
            ...options,
            bodyRegion: aiData.bodyRegion || options.bodyRegion,
            limit: options.limit || 50
        });

        // Boost results that match AI's priority modality
        if (aiData.priority) {
            expandedResults.scenarios = expandedResults.scenarios.map(s => {
                const hasModality = s.procedures?.some(p =>
                    p.modality?.toUpperCase().includes(aiData.priority)
                );
                return {
                    ...s,
                    relevanceScore: hasModality ? s.relevanceScore + 30 : s.relevanceScore
                };
            });
            expandedResults.scenarios.sort((a, b) => b.relevanceScore - a.relevanceScore);
        }

        return {
            ...expandedResults,
            aiEnhanced: true,
            aiInterpretation: aiData.interpretation,
            aiExpandedTerms: aiData.expandedTerms,
            aiBodyRegion: aiData.bodyRegion,
            aiPriority: aiData.priority
        };

    } catch (error) {
        console.warn('AI-enhanced search failed, using regular results:', error);
        return { ...regularResults, aiEnhanced: false };
    }
}

// Export for debugging
window.searchEngine = {
    search,
    aiEnhancedSearch,
    getSuggestions,
    getPopularSearches,
    initSearchEngine
};
