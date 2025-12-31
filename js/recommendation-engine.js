/**
 * Recommendation Engine v2
 *
 * Uses TF-IDF search with RadLex synonym expansion for scenario retrieval.
 * No AI dependency for core retrieval - fast, accurate, domain-specific.
 *
 * Architecture:
 * 1. Query → TF-IDF Search (RadLex synonyms) → Top scenarios
 * 2. Scenario ID → Database → Procedures with ratings
 * 3. (Optional) AI for clinical context explanation
 */

import { query, isDatabaseReady } from './db/database.js';
import { TFIDFSearch } from './tfidf-search.js';
import { SemanticSearch } from './semantic-search.js';

// Search instances
let tfidfSearch = null;
let semanticSearch = null;
const SEMANTIC_FALLBACK_THRESHOLD = 0.15; // Use semantic if TF-IDF score below this

/**
 * Initialize the recommendation engine
 */
export async function initRecommendationEngine() {
    console.log('Initializing recommendation engine...');

    // Initialize TF-IDF search
    tfidfSearch = new TFIDFSearch();
    const tfidfSuccess = await tfidfSearch.init();

    if (!tfidfSuccess) {
        console.error('Failed to initialize TF-IDF search');
        return false;
    }

    // Initialize semantic search (non-blocking - loads ONNX model)
    semanticSearch = new SemanticSearch();
    semanticSearch.init().then(success => {
        if (success) {
            console.log('Semantic search ready (layperson-trained model)');
        } else {
            console.warn('Semantic search unavailable - using TF-IDF only');
        }
    }).catch(err => {
        console.warn('Semantic search init error:', err.message);
    });

    console.log('Recommendation engine ready (TF-IDF + QueryExpander)');
    return true;
}

/**
 * Check if recommendation engine is ready
 */
export function isRecommendationEngineReady() {
    return tfidfSearch?.ready && isDatabaseReady();
}

/**
 * Get imaging recommendations for a clinical query
 * @param {string} clinicalQuery - Natural language clinical question
 * @returns {Promise<Object>} Recommendation result
 */
export async function getRecommendations(clinicalQuery) {
    if (!isRecommendationEngineReady()) {
        return { error: 'Recommendation engine not ready' };
    }

    const startTime = performance.now();

    try {
        // Step 1: Use TF-IDF search with QueryExpander + RadLex synonyms
        let searchResults = tfidfSearch.search(clinicalQuery, {
            limit: 10,
            minScore: 0.05
        });

        // Step 1b: Fallback to semantic search if TF-IDF score is low
        const topTfidfScore = searchResults[0]?.score || 0;
        if (topTfidfScore < SEMANTIC_FALLBACK_THRESHOLD && semanticSearch?.isReady()) {
            console.log(`Low TF-IDF score (${topTfidfScore.toFixed(3)}), trying semantic search...`);
            const semanticResults = await semanticSearch.search(clinicalQuery, { limit: 10 });

            if (semanticResults.length > 0 && semanticResults[0].score > topTfidfScore) {
                console.log(`Semantic search found better match: ${semanticResults[0].title}`);
                searchResults = semanticResults;
            }
        }

        if (searchResults.length === 0) {
            return {
                error: 'No matching scenarios found',
                suggestion: 'Try different keywords or check spelling'
            };
        }

        // Step 2: Get the best matching scenario
        const topResult = searchResults[0];
        const scenarioId = extractScenarioId(topResult.url);

        if (!scenarioId) {
            // Fallback: search database by title
            return await searchByTitle(topResult.title, clinicalQuery, searchResults, startTime);
        }

        // Step 3: Fetch full scenario details and procedures from database
        const recommendations = await fetchRecommendations(scenarioId, topResult.title);

        if (!recommendations) {
            return { error: 'Failed to load scenario details' };
        }

        const elapsed = (performance.now() - startTime).toFixed(0);
        console.log(`Recommendations generated in ${elapsed}ms`);

        return {
            success: true,
            query: clinicalQuery,
            interpretation: `Matched: ${topResult.title}`,
            matchedCondition: topResult.title,
            confidence: scoreToConfidence(topResult.score),
            recommendations,
            relatedScenarios: searchResults.slice(1, 5).map(r => ({
                name: r.title,
                score: r.score
            })),
            elapsed
        };

    } catch (error) {
        console.error('Recommendation error:', error);
        return { error: 'Failed to generate recommendations' };
    }
}

/**
 * Extract scenario ID from ACR URL
 */
function extractScenarioId(url) {
    if (!url) return null;
    const match = url.match(/senarioId=(\d+)/i) || url.match(/scenarioId=(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
}

/**
 * Convert TF-IDF score to confidence level
 */
function scoreToConfidence(score) {
    if (score >= 0.4) return 'high';
    if (score >= 0.2) return 'medium';
    return 'low';
}

/**
 * Fallback: Search database by scenario title
 */
async function searchByTitle(title, originalQuery, allResults, startTime) {
    const scenarios = query(`
        SELECT s.*,
               (SELECT COUNT(*) FROM variants WHERE scenario_id = s.id) as variant_count,
               (SELECT MAX(ar.rating) FROM variants v
                JOIN appropriateness_ratings ar ON ar.variant_id = v.id
                WHERE v.scenario_id = s.id) as max_rating
        FROM scenarios s
        WHERE LOWER(s.name) LIKE ?
        ORDER BY max_rating DESC
        LIMIT 1
    `, [`%${title.toLowerCase().substring(0, 50)}%`]);

    if (scenarios.length === 0) {
        return { error: 'No matching scenarios found in database' };
    }

    const recommendations = await fetchRecommendations(scenarios[0].id, scenarios[0].name);
    const elapsed = (performance.now() - startTime).toFixed(0);

    return {
        success: true,
        query: originalQuery,
        interpretation: `Matched: ${scenarios[0].name}`,
        matchedCondition: scenarios[0].name,
        confidence: 'medium',
        recommendations,
        relatedScenarios: allResults.slice(1, 5).map(r => ({
            name: r.title,
            score: r.score
        })),
        elapsed
    };
}

/**
 * Fetch detailed recommendations from database
 */
async function fetchRecommendations(scenarioId, scenarioTitle) {
    // Try to find scenario by ACR topic ID first, then by name
    let scenarios = query(`
        SELECT s.*,
               (SELECT COUNT(*) FROM variants WHERE scenario_id = s.id) as variant_count
        FROM scenarios s
        WHERE s.acr_topic_id = ? OR s.id = ?
        LIMIT 1
    `, [scenarioId, scenarioId]);

    // Fallback: search by name
    if (scenarios.length === 0 && scenarioTitle) {
        scenarios = query(`
            SELECT s.*,
                   (SELECT COUNT(*) FROM variants WHERE scenario_id = s.id) as variant_count
            FROM scenarios s
            WHERE LOWER(s.name) LIKE ?
            ORDER BY LENGTH(s.name)
            LIMIT 1
        `, [`%${scenarioTitle.toLowerCase().substring(0, 40)}%`]);
    }

    if (scenarios.length === 0) {
        return null;
    }

    const primaryScenario = scenarios[0];

    // Get all procedures with ratings for this scenario
    const procedures = query(`
        SELECT
            p.id as procedure_id,
            p.name as procedure_name,
            p.canonical_name,
            p.modality,
            p.uses_contrast,
            ar.rating,
            ar.rating_level,
            ar.relative_radiation_level as rrl,
            v.id as variant_id,
            v.name as variant_name,
            v.variant_number
        FROM variants v
        JOIN appropriateness_ratings ar ON ar.variant_id = v.id
        JOIN procedures p ON p.id = ar.procedure_id
        WHERE v.scenario_id = ?
          AND p.modality IN ('CT', 'MRI', 'US', 'XR', 'PET', 'NM', 'Fluoro', 'Angio', 'Other')
          AND LENGTH(p.name) < 100
          AND p.name NOT LIKE '%initial imaging%'
          AND p.name NOT LIKE '%suspected%'
        ORDER BY ar.rating DESC, ar.sort_order ASC
    `, [primaryScenario.id]);

    // Group procedures by rating level and deduplicate
    const grouped = {
        usuallyAppropriate: [],
        mayBeAppropriate: [],
        usuallyNotAppropriate: []
    };

    const seenProcedures = new Set();

    procedures.forEach(proc => {
        const key = proc.procedure_name;
        if (seenProcedures.has(key)) return;
        seenProcedures.add(key);

        // Fix corrupted rating_level - derive from rating if empty/numeric
        let ratingLevel = proc.rating_level;
        if (!ratingLevel || /^\d+$/.test(ratingLevel)) {
            if (proc.rating >= 7) {
                ratingLevel = 'Usually Appropriate';
            } else if (proc.rating >= 4) {
                ratingLevel = 'May Be Appropriate';
            } else {
                ratingLevel = 'Usually Not Appropriate';
            }
        }

        // Fix modality display for "Other" - infer from procedure name
        let modality = proc.modality;
        if (modality === 'Other') {
            const nameLower = proc.procedure_name.toLowerCase();
            if (nameLower.includes('cta ') || nameLower.startsWith('cta')) modality = 'CTA';
            else if (nameLower.includes('mra ') || nameLower.startsWith('mra')) modality = 'MRA';
            else if (nameLower.includes('mrv ') || nameLower.startsWith('mrv')) modality = 'MRV';
            else if (nameLower.includes('pet') || nameLower.includes('fdg')) modality = 'PET';
            else if (nameLower.includes('spect')) modality = 'SPECT';
            else if (nameLower.includes('arteriography') || nameLower.includes('angiography')) modality = 'Angio';
            else if (nameLower.includes('duplex') || nameLower.includes('doppler')) modality = 'US';
        }

        const item = {
            name: proc.procedure_name,
            modality: modality,
            usesContrast: proc.uses_contrast,
            rating: proc.rating,
            ratingLevel: ratingLevel,
            rrl: proc.rrl,
            variantName: proc.variant_name
        };

        if (proc.rating >= 7) {
            grouped.usuallyAppropriate.push(item);
        } else if (proc.rating >= 4) {
            grouped.mayBeAppropriate.push(item);
        } else {
            grouped.usuallyNotAppropriate.push(item);
        }
    });

    // Get clinical summary
    const clinicalSummary = primaryScenario.clinical_summary || primaryScenario.description;

    // Get variants for expandable section
    const variants = query(`
        SELECT id, variant_number, name, description
        FROM variants
        WHERE scenario_id = ?
        ORDER BY variant_number
    `, [primaryScenario.id]);

    return {
        scenario: {
            id: primaryScenario.id,
            name: primaryScenario.name,
            bodyRegion: primaryScenario.body_region,
            variantCount: primaryScenario.variant_count,
            sourceUrl: primaryScenario.source_url
        },
        procedures: grouped,
        clinicalSummary: truncateSummary(clinicalSummary, 500),
        fullSummary: clinicalSummary,
        variants: variants.map(v => ({
            id: v.id,
            number: v.variant_number,
            name: cleanVariantName(v.name),
            description: v.description
        })),
        totalProcedures: seenProcedures.size
    };
}

/**
 * Clean up variant name for display
 */
function cleanVariantName(name) {
    if (!name) return 'General';

    // Remove "Variant: X" prefix
    let cleaned = name.replace(/^Variant:\s*\d+\s*/i, '');

    // Remove "Adult." or "Pediatric." prefix if redundant
    cleaned = cleaned.replace(/^(Adult|Pediatric)\.\s*/i, '');

    // Capitalize first letter
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

    return cleaned || 'General';
}

/**
 * Truncate summary to a reasonable length
 */
function truncateSummary(text, maxLength) {
    if (!text || text.length <= maxLength) return text;

    // Find a good break point
    const truncated = text.substring(0, maxLength);
    const lastPeriod = truncated.lastIndexOf('.');

    if (lastPeriod > maxLength * 0.6) {
        return truncated.substring(0, lastPeriod + 1);
    }

    return truncated.trim() + '...';
}

/**
 * Get recommendation with clarification answer
 */
export async function getRecommendationsWithContext(clinicalQuery, clarificationAnswer) {
    // Combine original query with clarification
    const enrichedQuery = `${clinicalQuery} ${clarificationAnswer}`;
    return getRecommendations(enrichedQuery);
}

// Export for debugging
window.recommendationEngine = {
    getRecommendations,
    getRecommendationsWithContext,
    initRecommendationEngine,
    isRecommendationEngineReady
};
