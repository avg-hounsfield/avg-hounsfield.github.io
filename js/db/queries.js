/**
 * Database Query Functions
 *
 * Provides optimized queries for searching scenarios, procedures, and protocols.
 * Designed for the unified search experience with ACR appropriateness scoring.
 */

import { query, queryOne } from './database.js';

// Cache for frequently accessed data
const cache = {
    bodyRegions: null,
    modalities: null
};

/**
 * Get all unique body regions
 */
export function getBodyRegions() {
    if (cache.bodyRegions) return cache.bodyRegions;
    cache.bodyRegions = query(`
        SELECT DISTINCT body_region FROM scenarios
        WHERE body_region IS NOT NULL
        ORDER BY body_region
    `).map(r => r.body_region);
    return cache.bodyRegions;
}

/**
 * Get all unique modalities
 */
export function getModalities() {
    if (cache.modalities) return cache.modalities;
    cache.modalities = query(`
        SELECT DISTINCT modality FROM procedures
        WHERE modality IS NOT NULL
        ORDER BY modality
    `).map(r => r.modality);
    return cache.modalities;
}

/**
 * Search scenarios by text query
 * Returns scenarios with their best matching procedures
 * @param {string} searchText - User's search query
 * @param {Object} options - Search options
 * @returns {Array} Matching scenarios with procedures
 */
export function searchScenarios(searchText, options = {}) {
    const {
        bodyRegion = null,
        modality = null,
        limit = 50,
        minRating = 0
    } = options;

    const searchLower = searchText.toLowerCase().trim();
    // Filter out common stop words
    const stopWords = ['a', 'an', 'the', 'for', 'of', 'with', 'to', 'in', 'on', 'is', 'and', 'or', 'concern', 'suspected', 'possible', 'rule', 'out'];
    const searchTerms = searchLower.split(/\s+/).filter(t => t.length > 1 && !stopWords.includes(t));

    if (searchTerms.length === 0) {
        // If all words were stop words, use the full query for phrase matching
        return searchScenariosByPhrase(searchLower, { bodyRegion, modality, limit, minRating });
    }

    // Expand each search term with medical synonyms
    const allTerms = new Set();
    searchTerms.forEach(term => {
        allTerms.add(term);
        // Add synonyms for this term
        for (const [primary, synonyms] of Object.entries(MEDICAL_SYNONYMS)) {
            if (term === primary || synonyms.includes(term)) {
                synonyms.forEach(syn => allTerms.add(syn));
                allTerms.add(primary);
            }
        }
    });

    // Build WHERE clause for text matching - use OR to match ANY term
    const whereConditions = ['1=1'];
    const params = [];

    // Text search across scenario name and keywords - match ANY expanded term
    const textConditions = Array.from(allTerms).map(term => {
        params.push(`%${term}%`, `%${term}%`);
        return `(LOWER(s.name) LIKE ? OR LOWER(s.keywords) LIKE ?)`;
    });
    whereConditions.push(`(${textConditions.join(' OR ')})`);

    // Filter by body region
    if (bodyRegion) {
        whereConditions.push('s.body_region = ?');
        params.push(bodyRegion);
    }

    // Main query to get matching scenarios with their procedures
    const sql = `
        SELECT DISTINCT
            s.id as scenario_id,
            s.acr_topic_id,
            s.name as scenario_name,
            s.description,
            s.body_region,
            s.clinical_summary,
            s.keywords,
            (SELECT COUNT(*) FROM variants WHERE scenario_id = s.id) as variant_count
        FROM scenarios s
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY
            CASE
                WHEN LOWER(s.name) LIKE ? THEN 1
                WHEN LOWER(s.name) LIKE ? THEN 2
                ELSE 3
            END,
            s.name
        LIMIT ?
    `;

    // Add ordering params
    params.push(`${searchLower}%`, `%${searchLower}%`, limit);

    const scenarios = query(sql, params);

    // For each scenario, get the best procedures with ratings
    return scenarios.map(scenario => {
        const procedures = getScenarioProcedures(scenario.scenario_id, { modality, minRating });
        return {
            ...scenario,
            keywords: scenario.keywords ? JSON.parse(scenario.keywords) : [],
            procedures,
            topRating: procedures.length > 0 ? Math.max(...procedures.map(p => p.rating || 0)) : 0
        };
    });
}

/**
 * Fallback phrase search when all words are stop words
 */
function searchScenariosByPhrase(searchLower, options = {}) {
    const { bodyRegion = null, modality = null, limit = 50, minRating = 0 } = options;

    const whereConditions = ['(LOWER(s.name) LIKE ? OR LOWER(s.keywords) LIKE ?)'];
    const params = [`%${searchLower}%`, `%${searchLower}%`];

    if (bodyRegion) {
        whereConditions.push('s.body_region = ?');
        params.push(bodyRegion);
    }

    const sql = `
        SELECT DISTINCT
            s.id as scenario_id,
            s.acr_topic_id,
            s.name as scenario_name,
            s.description,
            s.body_region,
            s.clinical_summary,
            s.keywords,
            (SELECT COUNT(*) FROM variants WHERE scenario_id = s.id) as variant_count
        FROM scenarios s
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY s.name
        LIMIT ?
    `;

    params.push(limit);
    const scenarios = query(sql, params);

    return scenarios.map(scenario => {
        const procedures = getScenarioProcedures(scenario.scenario_id, { modality, minRating });
        return {
            ...scenario,
            keywords: scenario.keywords ? JSON.parse(scenario.keywords) : [],
            procedures,
            topRating: procedures.length > 0 ? Math.max(...procedures.map(p => p.rating || 0)) : 0
        };
    });
}

/**
 * Get procedures for a scenario with their appropriateness ratings
 */
export function getScenarioProcedures(scenarioId, options = {}) {
    const { modality = null, minRating = 0 } = options;

    let sql = `
        SELECT
            p.id as procedure_id,
            p.name as procedure_name,
            p.canonical_name,
            p.modality,
            p.uses_contrast,
            p.body_part,
            v.id as variant_id,
            v.variant_number,
            v.name as variant_name,
            ar.rating,
            ar.rating_level,
            ar.priority,
            ar.relative_radiation_level as rrl
        FROM variants v
        JOIN appropriateness_ratings ar ON ar.variant_id = v.id
        JOIN procedures p ON p.id = ar.procedure_id
        WHERE v.scenario_id = ?
    `;

    const params = [scenarioId];

    if (modality) {
        sql += ' AND p.modality = ?';
        params.push(modality);
    }

    if (minRating > 0) {
        sql += ' AND ar.rating >= ?';
        params.push(minRating);
    }

    sql += ' ORDER BY ar.rating DESC, ar.sort_order ASC';

    const results = query(sql, params);

    // Group by procedure, taking highest rating
    const procedureMap = new Map();
    results.forEach(row => {
        const key = row.procedure_id;
        if (!procedureMap.has(key) || row.rating > procedureMap.get(key).rating) {
            procedureMap.set(key, row);
        }
    });

    return Array.from(procedureMap.values());
}

/**
 * Search MRI protocols by text query
 */
export function searchProtocols(searchText, options = {}) {
    const { section = null, limit = 50 } = options;

    const searchLower = searchText.toLowerCase().trim();
    const searchTerms = searchLower.split(/\s+/).filter(t => t.length > 1);

    if (searchTerms.length === 0) {
        return [];
    }

    const whereConditions = ['1=1'];
    const params = [];

    // Text search
    const textConditions = searchTerms.map((term, i) => {
        params.push(`%${term}%`, `%${term}%`, `%${term}%`);
        return `(LOWER(p.name) LIKE ? OR LOWER(p.keywords) LIKE ? OR LOWER(p.indications) LIKE ?)`;
    });
    whereConditions.push(`(${textConditions.join(' AND ')})`);

    // Section filter
    if (section) {
        whereConditions.push('p.section = ?');
        params.push(section);
    }

    const sql = `
        SELECT
            p.id,
            p.name,
            p.display_name,
            p.uses_contrast,
            p.section,
            p.indications,
            p.contrast_rationale,
            p.keywords,
            pr.name as procedure_name,
            pr.modality
        FROM mri_protocols p
        LEFT JOIN procedures pr ON pr.id = p.procedure_id
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY
            CASE
                WHEN LOWER(p.name) LIKE ? THEN 1
                WHEN LOWER(p.name) LIKE ? THEN 2
                ELSE 3
            END
        LIMIT ?
    `;

    params.push(`${searchLower}%`, `%${searchLower}%`, limit);

    const protocols = query(sql, params);

    // Get sequences for each protocol
    return protocols.map(protocol => ({
        ...protocol,
        keywords: protocol.keywords ? JSON.parse(protocol.keywords) : [],
        sequences: getProtocolSequences(protocol.id),
        scannerNotes: getProtocolScannerNotes(protocol.id)
    }));
}

/**
 * Get sequences for a protocol
 */
export function getProtocolSequences(protocolId) {
    return query(`
        SELECT sequence_name, is_post_contrast, sort_order
        FROM mri_sequences
        WHERE protocol_id = ?
        ORDER BY sort_order
    `, [protocolId]);
}

/**
 * Get scanner-specific notes for a protocol
 */
export function getProtocolScannerNotes(protocolId) {
    const notes = query(`
        SELECT scanner_type, sequence_name, is_post_contrast, sort_order
        FROM scanner_notes
        WHERE protocol_id = ?
        ORDER BY scanner_type, sort_order
    `, [protocolId]);

    // Group by scanner type
    const grouped = {};
    notes.forEach(note => {
        if (!grouped[note.scanner_type]) {
            grouped[note.scanner_type] = [];
        }
        grouped[note.scanner_type].push(note);
    });
    return grouped;
}

/**
 * Unified search - searches both scenarios and protocols
 * Returns combined results sorted by relevance
 */
export function unifiedSearch(searchText, options = {}) {
    const {
        bodyRegion = null,
        modality = null,
        limit = 50,
        includeProtocols = true
    } = options;

    const results = {
        scenarios: [],
        protocols: [],
        totalCount: 0
    };

    // Search scenarios
    results.scenarios = searchScenarios(searchText, {
        bodyRegion,
        modality,
        limit: Math.floor(limit * 0.7) // 70% of limit for scenarios
    });

    // Search protocols if enabled
    if (includeProtocols) {
        results.protocols = searchProtocols(searchText, {
            limit: Math.floor(limit * 0.3) // 30% of limit for protocols
        });
    }

    results.totalCount = results.scenarios.length + results.protocols.length;

    return results;
}

/**
 * Get best imaging recommendations for a clinical condition
 * Returns procedures sorted by ACR rating
 */
export function getBestImaging(condition, options = {}) {
    const { modality = null, limit = 10 } = options;

    const searchLower = condition.toLowerCase().trim();

    let sql = `
        SELECT
            s.name as scenario_name,
            s.body_region,
            p.name as procedure_name,
            p.modality,
            p.uses_contrast,
            ar.rating,
            ar.rating_level,
            ar.priority
        FROM scenarios s
        JOIN variants v ON v.scenario_id = s.id
        JOIN appropriateness_ratings ar ON ar.variant_id = v.id
        JOIN procedures p ON p.id = ar.procedure_id
        WHERE (LOWER(s.name) LIKE ? OR LOWER(s.keywords) LIKE ?)
        AND ar.rating >= 7
    `;

    const params = [`%${searchLower}%`, `%${searchLower}%`];

    if (modality) {
        sql += ' AND p.modality = ?';
        params.push(modality);
    }

    sql += ' ORDER BY ar.rating DESC LIMIT ?';
    params.push(limit);

    return query(sql, params);
}

/**
 * Get scenario details by ID
 */
export function getScenarioById(scenarioId) {
    const scenario = queryOne(`
        SELECT * FROM scenarios WHERE id = ?
    `, [scenarioId]);

    if (!scenario) return null;

    return {
        ...scenario,
        keywords: scenario.keywords ? JSON.parse(scenario.keywords) : [],
        variants: getScenarioVariants(scenarioId),
        procedures: getScenarioProcedures(scenarioId)
    };
}

/**
 * Get variants for a scenario
 */
export function getScenarioVariants(scenarioId) {
    return query(`
        SELECT * FROM variants
        WHERE scenario_id = ?
        ORDER BY variant_number
    `, [scenarioId]);
}

/**
 * Get protocol by ID with all related data
 */
export function getProtocolById(protocolId) {
    const protocol = queryOne(`
        SELECT p.*, pr.name as procedure_name, pr.modality
        FROM mri_protocols p
        LEFT JOIN procedures pr ON pr.id = p.procedure_id
        WHERE p.id = ?
    `, [protocolId]);

    if (!protocol) return null;

    return {
        ...protocol,
        keywords: protocol.keywords ? JSON.parse(protocol.keywords) : [],
        sequences: getProtocolSequences(protocolId),
        scannerNotes: getProtocolScannerNotes(protocolId),
        relatedScenarios: getProtocolScenarios(protocolId)
    };
}

/**
 * Get scenarios linked to a protocol
 */
export function getProtocolScenarios(protocolId) {
    return query(`
        SELECT s.*, psm.relevance_score
        FROM protocol_scenario_mapping psm
        JOIN scenarios s ON s.id = psm.scenario_id
        WHERE psm.protocol_id = ?
        ORDER BY psm.relevance_score DESC
        LIMIT 10
    `, [protocolId]);
}

/**
 * Get rating statistics for display
 */
export function getRatingStats() {
    return queryOne(`
        SELECT
            COUNT(*) as total_ratings,
            AVG(rating) as avg_rating,
            SUM(CASE WHEN rating >= 7 THEN 1 ELSE 0 END) as appropriate_count,
            SUM(CASE WHEN rating >= 4 AND rating < 7 THEN 1 ELSE 0 END) as may_be_appropriate_count,
            SUM(CASE WHEN rating < 4 THEN 1 ELSE 0 END) as not_appropriate_count
        FROM appropriateness_ratings
    `);
}

/**
 * Get medical condition synonyms for better search matching
 */
export const MEDICAL_SYNONYMS = {
    'stroke': ['stroke', 'cva', 'cerebrovascular accident', 'brain attack', 'ischemic stroke', 'hemorrhagic stroke'],
    'headache': ['headache', 'head ache', 'cephalgia', 'migraine', 'head pain'],
    'seizure': ['seizure', 'epilepsy', 'convulsion', 'fits', 'epileptic'],
    'tumor': ['tumor', 'tumour', 'mass', 'lesion', 'neoplasm', 'cancer', 'malignancy'],
    'back pain': ['back pain', 'lumbar pain', 'dorsalgia', 'lumbago', 'low back pain'],
    'neck pain': ['neck pain', 'cervical pain', 'cervicalgia'],
    'knee pain': ['knee pain', 'knee injury', 'knee problem'],
    'shoulder pain': ['shoulder pain', 'shoulder injury', 'rotator cuff']
};

/**
 * Expand search query with medical synonyms
 */
export function expandSearchTerms(searchText) {
    const searchLower = searchText.toLowerCase();
    const expandedTerms = new Set([searchLower]);

    for (const [primary, synonyms] of Object.entries(MEDICAL_SYNONYMS)) {
        if (synonyms.some(syn => searchLower.includes(syn))) {
            synonyms.forEach(syn => expandedTerms.add(syn));
        }
    }

    return Array.from(expandedTerms);
}
