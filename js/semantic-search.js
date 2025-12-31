/**
 * Semantic Search Engine for ACR Appropriateness Criteria
 *
 * Uses a fine-tuned MiniLM model (via ONNX Runtime Web) for semantic similarity.
 * Falls back to TF-IDF for fast initial results, then re-ranks with embeddings.
 *
 * Usage:
 *   const search = new SemanticSearch();
 *   await search.init();
 *   const results = await search.search('chest pain rule out PE');
 *
 * Dependencies:
 *   - ONNX Runtime Web: https://cdn.jsdelivr.net/npm/onnxruntime-web
 *   - Pre-computed scenario embeddings
 *   - Tokenizer vocabulary
 */

export class SemanticSearch {
    constructor(options = {}) {
        // Model paths
        this.modelPath = options.modelPath || './models/acr-minilm/model_fp16.onnx';
        this.embeddingsPath = options.embeddingsPath || './data/search/scenario_embeddings.bin';
        this.vocabPath = options.vocabPath || './models/acr-minilm/tokenizer.json';
        this.metadataPath = options.metadataPath || './data/search/scenario_metadata.json';

        // State
        this.session = null;
        this.tokenizer = null;
        this.scenarioEmbeddings = null;  // Float32Array
        this.scenarioIds = null;         // Array of doc IDs
        this.metadata = null;            // {docId: {title, url}}
        this.embeddingDim = 384;         // MiniLM dimension
        this.maxSeqLength = 64;          // Max query length

        this.ready = false;
        this.loadingPromise = null;
    }

    /**
     * Initialize the semantic search engine
     * Loads model, tokenizer, and pre-computed embeddings
     */
    async init() {
        if (this.loadingPromise) {
            return this.loadingPromise;
        }

        this.loadingPromise = this._doInit();
        return this.loadingPromise;
    }

    async _doInit() {
        console.log('SemanticSearch: Initializing...');
        const startTime = performance.now();

        try {
            // Load ONNX Runtime if not already loaded
            if (typeof ort === 'undefined') {
                console.log('SemanticSearch: Loading ONNX Runtime...');
                await this._loadScript('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort.min.js');
            }

            // Load components in parallel
            const [tokenizer, embeddings, metadata] = await Promise.all([
                this._loadTokenizer(),
                this._loadEmbeddings(),
                this._loadMetadata()
            ]);

            this.tokenizer = tokenizer;
            this.scenarioEmbeddings = embeddings.embeddings;
            this.scenarioIds = embeddings.ids;
            this.metadata = metadata;

            // Load ONNX model
            console.log('SemanticSearch: Loading ONNX model...');
            this.session = await ort.InferenceSession.create(this.modelPath, {
                executionProviders: ['webgl', 'wasm'],  // Try WebGL first, fall back to WASM
                graphOptimizationLevel: 'all'
            });

            this.ready = true;

            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
            console.log(`SemanticSearch: Ready (${elapsed}s). ` +
                `${this.scenarioIds.length} scenarios, ${this.embeddingDim}d embeddings`);

            return true;

        } catch (error) {
            console.error('SemanticSearch: Init failed:', error);
            this.ready = false;
            return false;
        }
    }

    /**
     * Load script dynamically
     */
    _loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Load tokenizer vocabulary and config
     */
    async _loadTokenizer() {
        console.log('SemanticSearch: Loading tokenizer...');
        const response = await fetch(this.vocabPath);
        if (!response.ok) {
            throw new Error(`Failed to load tokenizer: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Load pre-computed scenario embeddings
     */
    async _loadEmbeddings() {
        console.log('SemanticSearch: Loading embeddings...');

        // Load embeddings binary (FP16)
        const embResponse = await fetch(this.embeddingsPath);
        if (!embResponse.ok) {
            throw new Error(`Failed to load embeddings: ${embResponse.status}`);
        }
        const embBuffer = await embResponse.arrayBuffer();

        // Load scenario IDs
        const idsResponse = await fetch(this.embeddingsPath.replace('.bin', '_ids.json'));
        if (!idsResponse.ok) {
            throw new Error(`Failed to load embedding IDs: ${idsResponse.status}`);
        }
        const ids = await idsResponse.json();

        // Convert FP16 to FP32
        const fp16 = new Uint16Array(embBuffer);
        const embeddings = new Float32Array(fp16.length);
        for (let i = 0; i < fp16.length; i++) {
            embeddings[i] = this._fp16ToFp32(fp16[i]);
        }

        return { embeddings, ids };
    }

    /**
     * Convert FP16 to FP32
     */
    _fp16ToFp32(h) {
        const s = (h & 0x8000) >> 15;
        const e = (h & 0x7C00) >> 10;
        const f = h & 0x03FF;

        if (e === 0) {
            return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
        } else if (e === 31) {
            return f ? NaN : (s ? -Infinity : Infinity);
        }

        return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
    }

    /**
     * Load scenario metadata
     */
    async _loadMetadata() {
        console.log('SemanticSearch: Loading metadata...');
        const response = await fetch(this.metadataPath);
        if (!response.ok) {
            // Fall back to empty metadata
            return {};
        }
        return response.json();
    }

    /**
     * Tokenize text using the loaded tokenizer
     * Simple WordPiece tokenization for MiniLM
     */
    tokenize(text) {
        const vocab = this.tokenizer.model?.vocab || this.tokenizer.vocab || {};
        const vocabLookup = Object.fromEntries(
            Object.entries(vocab).map(([k, v]) => [k.toLowerCase(), v])
        );

        // Special tokens
        const CLS = vocabLookup['[cls]'] || 101;
        const SEP = vocabLookup['[sep]'] || 102;
        const UNK = vocabLookup['[unk]'] || 100;
        const PAD = vocabLookup['[pad]'] || 0;

        // Simple tokenization
        const words = text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 0);

        const inputIds = [CLS];

        for (const word of words) {
            // Try whole word first
            if (vocabLookup[word] !== undefined) {
                inputIds.push(vocabLookup[word]);
            } else {
                // Try WordPiece subwords
                let remaining = word;
                let isFirst = true;

                while (remaining.length > 0) {
                    let found = false;

                    for (let end = remaining.length; end > 0; end--) {
                        const subword = isFirst ? remaining.slice(0, end) : '##' + remaining.slice(0, end);

                        if (vocabLookup[subword] !== undefined) {
                            inputIds.push(vocabLookup[subword]);
                            remaining = remaining.slice(end);
                            isFirst = false;
                            found = true;
                            break;
                        }
                    }

                    if (!found) {
                        inputIds.push(UNK);
                        remaining = remaining.slice(1);
                        isFirst = false;
                    }
                }
            }

            if (inputIds.length >= this.maxSeqLength - 1) {
                break;
            }
        }

        inputIds.push(SEP);

        // Pad to max length
        const attentionMask = new Array(inputIds.length).fill(1);

        while (inputIds.length < this.maxSeqLength) {
            inputIds.push(PAD);
            attentionMask.push(0);
        }

        return {
            inputIds: inputIds.slice(0, this.maxSeqLength),
            attentionMask: attentionMask.slice(0, this.maxSeqLength)
        };
    }

    /**
     * Compute embedding for a query using the ONNX model
     */
    async computeEmbedding(text) {
        if (!this.ready) {
            throw new Error('SemanticSearch not initialized');
        }

        // Tokenize
        const { inputIds, attentionMask } = this.tokenize(text);

        // Create tensors
        const inputTensor = new ort.Tensor('int64',
            BigInt64Array.from(inputIds.map(BigInt)),
            [1, this.maxSeqLength]
        );
        const attentionTensor = new ort.Tensor('int64',
            BigInt64Array.from(attentionMask.map(BigInt)),
            [1, this.maxSeqLength]
        );

        // Run inference
        const outputs = await this.session.run({
            'input_ids': inputTensor,
            'attention_mask': attentionTensor
        });

        // Get CLS token embedding (first token of last hidden state)
        const hiddenState = outputs['last_hidden_state'].data;
        const embedding = new Float32Array(this.embeddingDim);

        // Mean pooling over non-padded tokens
        let validTokens = 0;
        for (let i = 0; i < this.maxSeqLength; i++) {
            if (attentionMask[i] === 1) {
                for (let j = 0; j < this.embeddingDim; j++) {
                    embedding[j] += hiddenState[i * this.embeddingDim + j];
                }
                validTokens++;
            }
        }

        // Average
        for (let j = 0; j < this.embeddingDim; j++) {
            embedding[j] /= validTokens;
        }

        // L2 normalize
        let norm = 0;
        for (let j = 0; j < this.embeddingDim; j++) {
            norm += embedding[j] * embedding[j];
        }
        norm = Math.sqrt(norm);

        if (norm > 0) {
            for (let j = 0; j < this.embeddingDim; j++) {
                embedding[j] /= norm;
            }
        }

        return embedding;
    }

    /**
     * Compute cosine similarity between query embedding and all scenario embeddings
     */
    computeSimilarities(queryEmbedding) {
        const numScenarios = this.scenarioIds.length;
        const similarities = new Float32Array(numScenarios);

        for (let i = 0; i < numScenarios; i++) {
            let dot = 0;
            const offset = i * this.embeddingDim;

            for (let j = 0; j < this.embeddingDim; j++) {
                dot += queryEmbedding[j] * this.scenarioEmbeddings[offset + j];
            }

            similarities[i] = dot;  // Already normalized, so dot product = cosine sim
        }

        return similarities;
    }

    /**
     * Search for scenarios matching the query
     * @param {string} queryText - Search query
     * @param {Object} options - Search options
     * @returns {Promise<Array>} Ranked search results
     */
    async search(queryText, options = {}) {
        if (!this.ready) {
            console.warn('SemanticSearch: Not ready');
            return [];
        }

        const {
            limit = 20,
            minScore = 0.3
        } = options;

        const startTime = performance.now();

        try {
            // Compute query embedding
            const queryEmbedding = await this.computeEmbedding(queryText);

            // Compute similarities to all scenarios
            const similarities = this.computeSimilarities(queryEmbedding);

            // Build results with scores
            const results = [];
            for (let i = 0; i < similarities.length; i++) {
                if (similarities[i] >= minScore) {
                    const docId = this.scenarioIds[i];
                    results.push({
                        id: docId,
                        score: similarities[i],
                        ...this.metadata[docId]
                    });
                }
            }

            // Sort by score descending
            results.sort((a, b) => b.score - a.score);

            const elapsed = (performance.now() - startTime).toFixed(1);
            console.log(`SemanticSearch: "${queryText}" -> ${results.length} results (${elapsed}ms)`);

            return results.slice(0, limit);

        } catch (error) {
            console.error('SemanticSearch error:', error);
            return [];
        }
    }

    /**
     * Check if the search engine is ready
     */
    isReady() {
        return this.ready;
    }
}

/**
 * Tiered Search: Combines TF-IDF (fast) with Semantic (accurate)
 *
 * Strategy:
 *   1. Run TF-IDF first for instant results
 *   2. If top TF-IDF score < threshold, run semantic search
 *   3. Merge and re-rank results
 */
export class TieredSearch {
    constructor(tfidfSearch, semanticSearch, options = {}) {
        this.tfidf = tfidfSearch;
        this.semantic = semanticSearch;
        this.semanticThreshold = options.semanticThreshold || 0.4;  // Use semantic if TF-IDF score below this
        this.semanticWeight = options.semanticWeight || 0.7;        // Weight for semantic scores in merge
    }

    async init() {
        // Initialize both search engines
        const results = await Promise.allSettled([
            this.tfidf.init?.() || Promise.resolve(true),
            this.semantic.init()
        ]);

        const tfidfOk = results[0].status === 'fulfilled' && results[0].value;
        const semanticOk = results[1].status === 'fulfilled' && results[1].value;

        console.log(`TieredSearch: TF-IDF ${tfidfOk ? 'OK' : 'FAILED'}, ` +
            `Semantic ${semanticOk ? 'OK' : 'FAILED'}`);

        return tfidfOk || semanticOk;
    }

    async search(queryText, options = {}) {
        const limit = options.limit || 20;
        const startTime = performance.now();

        // Always run TF-IDF first (fast)
        let tfidfResults = [];
        if (this.tfidf.ready) {
            tfidfResults = this.tfidf.search(queryText, { limit: limit * 2 });
        }

        // Check if we need semantic search
        const topScore = tfidfResults[0]?.score || 0;
        const needSemantic = topScore < this.semanticThreshold && this.semantic.isReady();

        let semanticResults = [];
        if (needSemantic) {
            semanticResults = await this.semantic.search(queryText, { limit: limit * 2 });
        }

        // Merge results
        let results;
        if (semanticResults.length > 0) {
            results = this._mergeResults(tfidfResults, semanticResults);
        } else {
            results = tfidfResults;
        }

        const elapsed = (performance.now() - startTime).toFixed(1);
        console.log(`TieredSearch: "${queryText}" -> ${results.length} results ` +
            `(${elapsed}ms, semantic: ${needSemantic})`);

        return results.slice(0, limit);
    }

    _mergeResults(tfidfResults, semanticResults) {
        // Normalize scores to 0-1 range
        const tfidfMax = Math.max(...tfidfResults.map(r => r.score), 0.001);
        const semanticMax = Math.max(...semanticResults.map(r => r.score), 0.001);

        // Build score maps
        const tfidfScores = {};
        for (const r of tfidfResults) {
            tfidfScores[r.id] = r.score / tfidfMax;
        }

        const semanticScores = {};
        for (const r of semanticResults) {
            semanticScores[r.id] = r.score / semanticMax;
        }

        // Collect all doc IDs
        const allIds = new Set([
            ...tfidfResults.map(r => r.id),
            ...semanticResults.map(r => r.id)
        ]);

        // Compute combined scores
        const results = [];
        for (const id of allIds) {
            const tScore = tfidfScores[id] || 0;
            const sScore = semanticScores[id] || 0;

            // Weighted combination
            const combinedScore = (1 - this.semanticWeight) * tScore +
                                  this.semanticWeight * sScore;

            // Get metadata from either result set
            const tfidfResult = tfidfResults.find(r => r.id === id);
            const semanticResult = semanticResults.find(r => r.id === id);
            const metadata = tfidfResult || semanticResult;

            results.push({
                id,
                score: combinedScore,
                tfidfScore: tScore,
                semanticScore: sScore,
                title: metadata?.title,
                url: metadata?.url
            });
        }

        // Sort by combined score
        results.sort((a, b) => b.score - a.score);

        return results;
    }
}

// Export for debugging
if (typeof window !== 'undefined') {
    window.SemanticSearch = SemanticSearch;
    window.TieredSearch = TieredSearch;
}
