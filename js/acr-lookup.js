/**
 * ACR Appropriateness Criteria Lookup Module
 *
 * Integrates the comprehensive ACR database (imaging.db.gz) into v1's interface.
 * Provides lazy-loaded database access and scenario/procedure lookup functions.
 */

// Database state
let db = null;
let dbPromise = null;
let isInitialized = false;

// Configuration
const DB_URL = './data/imaging.db.gz';
const SQLJS_CDN = 'https://sql.js.org/dist/';

/**
 * Decompress gzipped data using browser's DecompressionStream API
 */
async function decompressGzip(compressedData) {
    if (typeof DecompressionStream !== 'undefined') {
        try {
            const stream = new Response(compressedData).body
                .pipeThrough(new DecompressionStream('gzip'));
            const decompressed = await new Response(stream).arrayBuffer();
            return new Uint8Array(decompressed);
        } catch (e) {
            console.warn('Native decompression failed:', e);
        }
    }

    // Fallback: try pako
    if (typeof pako !== 'undefined') {
        return pako.ungzip(new Uint8Array(compressedData));
    }

    throw new Error('No decompression method available');
}

/**
 * Load sql.js library dynamically
 */
async function loadSqlJs() {
    if (typeof initSqlJs !== 'undefined') {
        return initSqlJs;
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${SQLJS_CDN}sql-wasm.js`;
        script.onload = () => {
            if (typeof initSqlJs !== 'undefined') {
                resolve(initSqlJs);
            } else {
                reject(new Error('sql.js failed to load'));
            }
        };
        script.onerror = () => reject(new Error('Failed to load sql.js'));
        document.head.appendChild(script);
    });
}

/**
 * Initialize the ACR database (lazy-loaded, call only when needed)
 */
export async function initACRDatabase() {
    if (dbPromise) return dbPromise;
    if (isInitialized && db) return db;

    dbPromise = (async () => {
        try {
            console.log('ACR Database: Loading...');
            const startTime = performance.now();

            const initSqlJs = await loadSqlJs();
            const SQL = await initSqlJs({
                locateFile: file => `${SQLJS_CDN}${file}`
            });

            const response = await fetch(DB_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch ACR database: ${response.status}`);
            }

            const compressedData = await response.arrayBuffer();
            console.log(`ACR Database: Compressed ${(compressedData.byteLength / 1024 / 1024).toFixed(2)} MB`);

            const dbData = await decompressGzip(compressedData);
            db = new SQL.Database(dbData);
            isInitialized = true;

            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
            console.log(`ACR Database: Ready in ${elapsed}s`);

            return db;
        } catch (error) {
            console.error('ACR Database initialization error:', error);
            dbPromise = null;
            throw error;
        }
    })();

    return dbPromise;
}

/**
 * Check if ACR database is ready
 */
export function isACRDatabaseReady() {
    return isInitialized && db !== null;
}

/**
 * Execute a SQL query and return results as objects
 */
function query(sql, params = []) {
    if (!db) return [];

    try {
        const stmt = db.prepare(sql);
        stmt.bind(params);

        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    } catch (error) {
        console.error('ACR query error:', error, '\nSQL:', sql);
        return [];
    }
}

/**
 * Search for ACR scenarios matching a query
 * Returns scenarios with their appropriateness ratings
 *
 * @param {string} searchQuery - Clinical query (e.g., "headache", "chest pain")
 * @param {number} limit - Maximum results
 * @returns {Array} Matching scenarios with ratings
 */
export async function searchACRScenarios(searchQuery, limit = 10) {
    if (!isACRDatabaseReady()) {
        await initACRDatabase();
    }

    const queryLower = searchQuery.toLowerCase();
    const terms = queryLower.split(/\s+/).filter(t => t.length > 2);

    // Build LIKE clauses for each term
    const likeClauses = terms.map(() =>
        "(LOWER(s.name) LIKE ? OR LOWER(s.description) LIKE ? OR LOWER(s.clinical_summary) LIKE ?)"
    ).join(' AND ');

    const params = [];
    terms.forEach(term => {
        const pattern = `%${term}%`;
        params.push(pattern, pattern, pattern);
    });

    const scenarios = query(`
        SELECT
            s.id,
            s.name,
            s.body_region,
            s.description,
            s.clinical_summary,
            s.source_url,
            (SELECT COUNT(*) FROM variants WHERE scenario_id = s.id) as variant_count
        FROM scenarios s
        WHERE ${likeClauses || '1=1'}
        ORDER BY
            CASE
                WHEN LOWER(s.name) LIKE ? THEN 1
                ELSE 2
            END,
            LENGTH(s.name)
        LIMIT ?
    `, [...params, `%${queryLower}%`, limit]);

    // Enrich with top procedures and ratings
    const enrichedScenarios = scenarios.map(scenario => {
        const procedures = query(`
            SELECT
                p.name as procedure_name,
                p.modality,
                ar.rating,
                ar.rating_level,
                ar.relative_radiation_level as rrl
            FROM variants v
            JOIN appropriateness_ratings ar ON ar.variant_id = v.id
            JOIN procedures p ON p.id = ar.procedure_id
            WHERE v.scenario_id = ?
            ORDER BY ar.rating DESC
            LIMIT 5
        `, [scenario.id]);

        // Find top-rated procedure
        const topProcedure = procedures.length > 0 ? procedures[0] : null;

        return {
            ...scenario,
            topProcedure,
            procedures: procedures.map(p => ({
                name: p.procedure_name,
                modality: p.modality,
                rating: p.rating,
                ratingLevel: p.rating_level || getRatingLevel(p.rating),
                rrl: p.rrl
            }))
        };
    });

    return enrichedScenarios;
}

/**
 * Get appropriateness rating level from numeric rating
 */
function getRatingLevel(rating) {
    if (rating >= 7) return 'Usually Appropriate';
    if (rating >= 4) return 'May Be Appropriate';
    return 'Usually Not Appropriate';
}

/**
 * Get detailed scenario info by ID
 */
export async function getScenarioDetails(scenarioId) {
    if (!isACRDatabaseReady()) {
        await initACRDatabase();
    }

    const scenarios = query(`
        SELECT * FROM scenarios WHERE id = ?
    `, [scenarioId]);

    if (scenarios.length === 0) return null;

    const scenario = scenarios[0];

    // Get all variants
    const variants = query(`
        SELECT id, variant_number, name, description
        FROM variants
        WHERE scenario_id = ?
        ORDER BY variant_number
    `, [scenarioId]);

    // Get all procedures with ratings
    const procedures = query(`
        SELECT
            p.id as procedure_id,
            p.name as procedure_name,
            p.modality,
            p.uses_contrast,
            ar.rating,
            ar.rating_level,
            ar.relative_radiation_level as rrl,
            v.variant_number,
            v.name as variant_name
        FROM variants v
        JOIN appropriateness_ratings ar ON ar.variant_id = v.id
        JOIN procedures p ON p.id = ar.procedure_id
        WHERE v.scenario_id = ?
        ORDER BY ar.rating DESC, v.variant_number
    `, [scenarioId]);

    // Group procedures by rating level
    const grouped = {
        usuallyAppropriate: [],
        mayBeAppropriate: [],
        usuallyNotAppropriate: []
    };

    const seen = new Set();
    procedures.forEach(proc => {
        const key = proc.procedure_name;
        if (seen.has(key)) return;
        seen.add(key);

        const item = {
            name: proc.procedure_name,
            modality: proc.modality,
            usesContrast: proc.uses_contrast,
            rating: proc.rating,
            rrl: proc.rrl
        };

        if (proc.rating >= 7) {
            grouped.usuallyAppropriate.push(item);
        } else if (proc.rating >= 4) {
            grouped.mayBeAppropriate.push(item);
        } else {
            grouped.usuallyNotAppropriate.push(item);
        }
    });

    return {
        scenario,
        variants,
        procedures: grouped,
        totalProcedures: seen.size
    };
}

/**
 * Find ACR recommendations for a specific modality + body part
 * Useful for matching v1 protocols to ACR scenarios
 *
 * @param {string} modality - Imaging modality (MRI, CT, US, etc.)
 * @param {string} bodyPart - Body region (brain, spine, chest, etc.)
 * @returns {Array} Related ACR scenarios
 */
export async function findRelatedACRScenarios(modality, bodyPart) {
    if (!isACRDatabaseReady()) {
        await initACRDatabase();
    }

    const bodyPartLower = bodyPart.toLowerCase();

    // Map common body parts to ACR body regions
    const bodyRegionMap = {
        'brain': 'neurologic',
        'head': 'neurologic',
        'spine': 'neurologic',
        'cervical': 'neurologic',
        'lumbar': 'neurologic',
        'thoracic': 'neurologic',
        'chest': 'thoracic',
        'lung': 'thoracic',
        'abdomen': 'gastrointestinal',
        'liver': 'gastrointestinal',
        'kidney': 'urologic',
        'pelvis': 'urologic',
        'shoulder': 'musculoskeletal',
        'knee': 'musculoskeletal',
        'hip': 'musculoskeletal',
        'ankle': 'musculoskeletal',
        'wrist': 'musculoskeletal',
        'heart': 'cardiac'
    };

    const acrRegion = bodyRegionMap[bodyPartLower] || bodyPartLower;

    const scenarios = query(`
        SELECT DISTINCT
            s.id,
            s.name,
            s.body_region,
            (SELECT MAX(ar.rating) FROM variants v
             JOIN appropriateness_ratings ar ON ar.variant_id = v.id
             JOIN procedures p ON p.id = ar.procedure_id
             WHERE v.scenario_id = s.id AND UPPER(p.modality) = ?) as max_rating
        FROM scenarios s
        WHERE LOWER(s.body_region) LIKE ?
           OR LOWER(s.name) LIKE ?
        ORDER BY max_rating DESC NULLS LAST
        LIMIT 10
    `, [modality.toUpperCase(), `%${acrRegion}%`, `%${bodyPartLower}%`]);

    return scenarios;
}

/**
 * Get ACR database statistics
 */
export async function getACRStats() {
    if (!isACRDatabaseReady()) {
        await initACRDatabase();
    }

    const stats = {
        scenarios: query('SELECT COUNT(*) as count FROM scenarios')[0]?.count || 0,
        variants: query('SELECT COUNT(*) as count FROM variants')[0]?.count || 0,
        procedures: query('SELECT COUNT(*) as count FROM procedures')[0]?.count || 0,
        ratings: query('SELECT COUNT(*) as count FROM appropriateness_ratings')[0]?.count || 0
    };

    return stats;
}

// Export for debugging
if (typeof window !== 'undefined') {
    window.acrLookup = {
        initACRDatabase,
        isACRDatabaseReady,
        searchACRScenarios,
        getScenarioDetails,
        findRelatedACRScenarios,
        getACRStats
    };
}
