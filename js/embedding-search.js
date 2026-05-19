/**
 * Embedding-based semantic search using a distilled radiology student model.
 *
 * Loads on demand (not on page load) since the model is ~34MB. First query
 * after page load takes ~1-2 seconds to warm up; subsequent queries are ~50ms.
 *
 * Model: BAAI/bge-small-en-v1.5 fine-tuned via knowledge distillation from
 * BGE-large-LoRA (coregrai radiology backend). 384-dim, CLS pooling,
 * L2-normalized. INT8 quantized ONNX.
 *
 * Scenario corpus is precomputed by tools/build_scenario_embeddings.py and
 * stored at data/search/scenario_embeddings_v3.bin (FP16, shape [N, 384]).
 */

const MODEL_PATH = 'models/student-radiology';
const EMBEDDINGS_BIN = 'data/search/scenario_embeddings_v3.bin';
const EMBEDDINGS_IDS = 'data/search/scenario_embeddings_v3_ids.json';
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0';

let _model = null;        // Transformers.js pipeline
let _scenarioEmb = null;  // Float32Array of shape (N, 384) flattened
let _scenarioIds = null;  // string[] of length N (acr_topic_ids)
let _dim = null;
let _loadingPromise = null;

async function _loadTransformersJs() {
  // Dynamic import via CDN; happens once per page load.
  const mod = await import(/* webpackIgnore: true */ TRANSFORMERS_CDN);
  // Use only local model files (no Hub fallback)
  mod.env.allowRemoteModels = false;
  mod.env.localModelPath = '';
  // ONNX runtime should also stay local
  mod.env.allowLocalModels = true;
  return mod;
}

async function _loadScenarioEmbeddings() {
  const [binRes, idsRes] = await Promise.all([
    fetch(EMBEDDINGS_BIN + '?v=20260519a'),
    fetch(EMBEDDINGS_IDS + '?v=20260519a'),
  ]);
  if (!binRes.ok || !idsRes.ok) {
    throw new Error(`Failed to fetch scenario embeddings (${binRes.status}/${idsRes.status})`);
  }
  const meta = await idsRes.json();
  const buf = await binRes.arrayBuffer();
  // FP16 -> Float32 upcast
  const dim = meta.dim;
  const count = meta.count;
  const fp16 = new Uint16Array(buf);
  if (fp16.length !== dim * count) {
    throw new Error(`Embedding shape mismatch: bin has ${fp16.length} fp16 entries, expected ${dim * count}`);
  }
  const fp32 = new Float32Array(fp16.length);
  for (let i = 0; i < fp16.length; i++) {
    fp32[i] = _fp16ToFp32(fp16[i]);
  }
  _scenarioEmb = fp32;
  _scenarioIds = meta.ids;
  _dim = dim;
  return { count, dim };
}

// IEEE 754 half-precision -> single. Hot path; keep allocation-free.
function _fp16ToFp32(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7C00) >> 10;
  const f = h & 0x03FF;
  if (e === 0) {
    return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  } else if (e === 0x1F) {
    return f ? NaN : ((s ? -1 : 1) * Infinity);
  }
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

/**
 * Ensure model + embeddings are loaded. Idempotent; concurrent callers wait
 * on the same promise.
 */
export async function ensureReady() {
  if (_model && _scenarioEmb) return;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    const t0 = performance.now();
    const tf = await _loadTransformersJs();
    // pipeline('feature-extraction') uses BERT mean pooling by default; we
    // need CLS pooling for BGE family. Use AutoModel directly to control.
    const { AutoTokenizer, AutoModel } = tf;
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_PATH);
    const model = await AutoModel.from_pretrained(MODEL_PATH, {
      quantized: true,  // load onnx/model_quantized.onnx
    });
    _model = { tokenizer, model };
    const meta = await _loadScenarioEmbeddings();
    console.log(`[embedding-search] ready in ${(performance.now() - t0).toFixed(0)}ms; corpus=${meta.count} x ${meta.dim}`);
  })();
  return _loadingPromise;
}

/**
 * Encode a single query string -> Float32Array of length 384 (L2-normalized).
 */
async function encodeQuery(text) {
  const { tokenizer, model } = _model;
  const inputs = await tokenizer(text, { padding: true, truncation: true, max_length: 128 });
  const output = await model(inputs);
  // output.last_hidden_state shape (1, L, H)
  const last = output.last_hidden_state;
  const dims = last.dims; // [1, L, H]
  const hidden = dims[2];
  // CLS pool: take first token of first batch
  const data = last.data;
  const cls = new Float32Array(hidden);
  for (let i = 0; i < hidden; i++) cls[i] = data[i];
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < hidden; i++) norm += cls[i] * cls[i];
  norm = Math.sqrt(norm) || 1e-9;
  for (let i = 0; i < hidden; i++) cls[i] /= norm;
  return cls;
}

/**
 * Compute top-K most similar scenarios by cosine similarity.
 * Returns [{ id, score }, ...] sorted by descending score.
 */
export async function search(query, k = 10) {
  await ensureReady();
  const q = await encodeQuery(query);
  const n = _scenarioIds.length;
  const dim = _dim;
  const sims = new Float32Array(n);
  // Dot product since both vectors are L2-normalized
  for (let i = 0; i < n; i++) {
    let s = 0;
    const off = i * dim;
    for (let j = 0; j < dim; j++) s += q[j] * _scenarioEmb[off + j];
    sims[i] = s;
  }
  // Top-K via partial sort (n is small enough that argsort is fine)
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  // Sort indices desc by sim. For n=4000 this is fast (~1ms).
  const sortedIdx = Array.from(idx).sort((a, b) => sims[b] - sims[a]);
  const out = [];
  for (let i = 0; i < k && i < sortedIdx.length; i++) {
    out.push({ id: _scenarioIds[sortedIdx[i]], score: sims[sortedIdx[i]] });
  }
  return out;
}

/**
 * Optional: kick off model + embedding load in the background (e.g. on
 * idle) so the first search feels instant. Caller should swallow errors.
 */
export function warmup() {
  ensureReady().catch(e => console.warn('[embedding-search] warmup failed:', e));
}
