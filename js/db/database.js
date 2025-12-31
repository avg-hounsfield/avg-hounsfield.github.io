/**
 * Frontend Database Layer
 *
 * Loads and manages the SQLite database using sql.js (WebAssembly).
 * Provides a singleton instance for the entire application.
 */

// Database singleton
let db = null;
let dbPromise = null;
let isInitialized = false;

// Configuration
const DB_URL = './data/imaging.db.gz';
const SQLJS_CDN = 'https://sql.js.org/dist/';

/**
 * Decompress gzipped data using the browser's DecompressionStream API
 * Falls back to pako if not available
 */
async function decompressGzip(compressedData) {
    // Try native DecompressionStream first (Chrome 80+, Firefox 113+, Safari 16.4+)
    if (typeof DecompressionStream !== 'undefined') {
        try {
            const stream = new Response(compressedData).body
                .pipeThrough(new DecompressionStream('gzip'));
            const decompressed = await new Response(stream).arrayBuffer();
            return new Uint8Array(decompressed);
        } catch (e) {
            console.warn('Native decompression failed, falling back to pako:', e);
        }
    }

    // Fallback: use pako library
    if (typeof pako !== 'undefined') {
        return pako.ungzip(new Uint8Array(compressedData));
    }

    // Last resort: try loading uncompressed version
    console.warn('No decompression method available, trying uncompressed database');
    const response = await fetch('./data/imaging.db');
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
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
 * Initialize the database
 * @returns {Promise<Database>} The sql.js database instance
 */
export async function initDatabase() {
    // Return existing promise if already initializing
    if (dbPromise) {
        return dbPromise;
    }

    // Return existing instance if already initialized
    if (isInitialized && db) {
        return db;
    }

    dbPromise = (async () => {
        try {
            console.log('Initializing database...');
            const startTime = performance.now();

            // Load sql.js
            const initSqlJs = await loadSqlJs();
            const SQL = await initSqlJs({
                locateFile: file => `${SQLJS_CDN}${file}`
            });

            // Fetch and decompress database
            console.log('Fetching database...');
            const response = await fetch(DB_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch database: ${response.status}`);
            }

            const compressedData = await response.arrayBuffer();
            console.log(`Compressed size: ${(compressedData.byteLength / 1024 / 1024).toFixed(2)} MB`);

            const dbData = await decompressGzip(compressedData);
            console.log(`Decompressed size: ${(dbData.byteLength / 1024 / 1024).toFixed(2)} MB`);

            // Create database instance
            db = new SQL.Database(dbData);
            isInitialized = true;

            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
            console.log(`Database initialized in ${elapsed}s`);

            // Verify database
            const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
            console.log('Available tables:', tables[0]?.values.map(v => v[0]).join(', '));

            return db;

        } catch (error) {
            console.error('Database initialization error:', error);
            dbPromise = null;
            throw error;
        }
    })();

    return dbPromise;
}

/**
 * Get the database instance (must call initDatabase first)
 * @returns {Database|null}
 */
export function getDatabase() {
    return db;
}

/**
 * Check if database is ready
 * @returns {boolean}
 */
export function isDatabaseReady() {
    return isInitialized && db !== null;
}

/**
 * Execute a SQL query and return results as an array of objects
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Array<Object>} Array of result objects
 */
export function query(sql, params = []) {
    if (!db) {
        throw new Error('Database not initialized');
    }

    try {
        const stmt = db.prepare(sql);
        stmt.bind(params);

        const results = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push(row);
        }
        stmt.free();

        return results;
    } catch (error) {
        console.error('Query error:', error, '\nSQL:', sql);
        throw error;
    }
}

/**
 * Execute a SQL query and return the first result
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Object|null} First result object or null
 */
export function queryOne(sql, params = []) {
    const results = query(sql, params);
    return results.length > 0 ? results[0] : null;
}

/**
 * Execute a raw SQL query (for complex queries)
 * @param {string} sql - SQL query
 * @returns {Array} Raw result from db.exec()
 */
export function exec(sql) {
    if (!db) {
        throw new Error('Database not initialized');
    }
    return db.exec(sql);
}

/**
 * Get database metadata
 * @returns {Object} Metadata key-value pairs
 */
export function getMetadata() {
    const results = query('SELECT key, value FROM metadata');
    const metadata = {};
    results.forEach(row => {
        metadata[row.key] = row.value;
    });
    return metadata;
}

/**
 * Get database statistics
 * @returns {Object} Count statistics
 */
export function getStats() {
    return {
        scenarios: queryOne('SELECT COUNT(*) as count FROM scenarios')?.count || 0,
        variants: queryOne('SELECT COUNT(*) as count FROM variants')?.count || 0,
        procedures: queryOne('SELECT COUNT(*) as count FROM procedures')?.count || 0,
        ratings: queryOne('SELECT COUNT(*) as count FROM appropriateness_ratings')?.count || 0,
        protocols: queryOne('SELECT COUNT(*) as count FROM mri_protocols')?.count || 0
    };
}

// Export for debugging
window.imagingDb = {
    query,
    queryOne,
    exec,
    getStats,
    getMetadata,
    getDatabase,
    isDatabaseReady
};
