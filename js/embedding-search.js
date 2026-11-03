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

import { conceptNormalize } from './concept-matcher.js?v=20260531a';
import { guardSuggestions } from './scenario-ranker.js?v=20261104a';

// Model name relative to env.localModelPath (set below).
const MODEL_NAME = 'student-radiology';
const EMBEDDINGS_BIN = 'data/search/scenario_embeddings_v3.bin';
const EMBEDDINGS_IDS = 'data/search/scenario_embeddings_v3_ids.json';
// jsdelivr forces an ESM build with /+esm; pinned to a major version.
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0/+esm';

// Below this, the distilled model is matching noise or guessing: nonsense input
// scores 0.3-0.4, and about 40% of answers between 0.45 and 0.5 missed.
// Calibrated by tools/eval_semantic_fallback.mjs on the train phrasings.
export const EMBEDDING_MIN_SCORE = 0.5;
// Weight of the lexical bonus in the fused score. 0.05 was the only hybrid
// weight that did not regress against pure embedding on the teacher
// pseudo-gold sweep, while still lifting anatomically precise matches ("LLQ"
// <-> "left lower quadrant") above near rivals.
export const LEXICAL_LAMBDA = 0.05;
// A clinician phrasing in the index must match this closely before its
// scenario is suggested through it. Phrasing-to-phrasing scores run higher
// than phrasing-to-ACR-wording scores, so this sits above EMBEDDING_MIN_SCORE.
export const PHRASE_MIN_SCORE = 0.5;

// Clinician phrasings filed under scenarios (train split of
// data/eval/mined_phrasings.json), built by tools/build_semantic_index.py.
const PHRASES_BIN = 'data/search/phrasing_index_v1.bin';
const PHRASES_META = 'data/search/phrasing_index_v1.json';
const DATA_VERSION = '20261105a';

let _model = null;        // Transformers.js pipeline
let _scenarioEmb = null;  // Float32Array of shape (N, 384) flattened
let _scenarioIds = null;  // string[] of length N (acr_topic_ids)
let _dim = null;
let _phrases = null;      // { count, vectors: Int8Array, scales: Float32Array, rows: Uint16Array } or null
let _loadingPromise = null;

async function _loadTransformersJs() {
  // Dynamic import via CDN; happens once per page load.
  const mod = await import(/* webpackIgnore: true */ TRANSFORMERS_CDN);
  // Resolve model files from /models/<name>/ on this origin only - no Hub.
  mod.env.allowLocalModels = true;
  mod.env.allowRemoteModels = false;
  mod.env.localModelPath = '/models/';
  // Use the same origin for the WASM backend (ort wasm files are served by
  // Transformers.js's own CDN by default; that's fine for online use).
  return mod;
}

async function _loadScenarioEmbeddings() {
  const [binRes, idsRes] = await Promise.all([
    fetch(`${EMBEDDINGS_BIN}?v=${DATA_VERSION}`),
    fetch(`${EMBEDDINGS_IDS}?v=${DATA_VERSION}`),
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

// The phrasing index is a second route to the same scenarios; the fallback
// still works without it, so a failure here only logs.
async function _loadPhraseIndex() {
  try {
    const [binRes, metaRes] = await Promise.all([
      fetch(`${PHRASES_BIN}?v=${DATA_VERSION}`),
      fetch(`${PHRASES_META}?v=${DATA_VERSION}`),
    ]);
    if (!binRes.ok || !metaRes.ok) throw new Error(`fetch ${binRes.status}/${metaRes.status}`);
    const meta = await metaRes.json();
    const buf = await binRes.arrayBuffer();
    const { count, dim } = meta;
    if (dim !== _dim) throw new Error(`dim ${dim} != ${_dim}`);
    if (buf.byteLength !== count * dim + count * 2 + count * 2) throw new Error(`size ${buf.byteLength} for ${count} x ${dim}`);
    const vectors = new Int8Array(buf, 0, count * dim);
    const fp16 = new Uint16Array(buf, count * dim, count);
    const scales = new Float32Array(count);
    for (let i = 0; i < count; i++) scales[i] = _fp16ToFp32(fp16[i]);
    const rows = new Uint16Array(buf, count * dim + count * 2, count);
    for (let i = 0; i < count; i++) if (rows[i] >= _scenarioIds.length) throw new Error(`row ${rows[i]} out of range`);
    _phrases = { count, vectors, scales, rows };
    return count;
  } catch (e) {
    console.warn('[embedding-search] phrasing index unavailable:', e?.message || e);
    _phrases = null;
    return 0;
  }
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
  const p = (async () => {
    const t0 = performance.now();
    const tf = await _loadTransformersJs();
    // pipeline('feature-extraction') uses BERT mean pooling by default; we
    // need CLS pooling for BGE family. Use AutoModel directly to control.
    const { AutoTokenizer, AutoModel } = tf;
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_NAME);
    const model = await AutoModel.from_pretrained(MODEL_NAME, {
      dtype: 'q8',  // load onnx/model_quantized.onnx (Transformers.js v3 API)
    });
    _model = { tokenizer, model };
    const meta = await _loadScenarioEmbeddings();
    const phrases = await _loadPhraseIndex();
    console.log(`[embedding-search] ready in ${(performance.now() - t0).toFixed(0)}ms; corpus=${meta.count} x ${meta.dim}; phrasings=${phrases}`);
  })();
  // Clear the memoized promise on failure so a transient model/index load error
  // self-heals on the next call instead of disabling semantic search all session.
  p.catch(() => { if (_loadingPromise === p) _loadingPromise = null; });
  _loadingPromise = p;
  return p;
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

// Indices of the k largest values of sims, best first (n is a few thousand;
// a full sort is ~1ms).
function _topIndices(sims, k) {
  const idx = Array.from({ length: sims.length }, (_, i) => i);
  idx.sort((a, b) => sims[b] - sims[a]);
  return idx.slice(0, k);
}

/**
 * The k scenarios closest to the search by cosine similarity, through their
 * own wording and (when the index is loaded) through the clinician phrasings
 * filed under them. Returns [{ id, score, direct, phrase, via }, ...] best
 * first; see mergeHits.
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
  const direct = _topIndices(sims, k).map(i => ({ id: _scenarioIds[i], score: sims[i] }));
  if (!_phrases) return mergeHits(direct, []);
  const { count, vectors, scales, rows } = _phrases;
  const psims = new Float32Array(count);
  for (let p = 0; p < count; p++) {
    let s = 0;
    const off = p * dim;
    for (let j = 0; j < dim; j++) s += q[j] * vectors[off + j];
    psims[p] = s * scales[p];
  }
  const phrase = _topIndices(psims, k).map(p => ({ row: p, id: _scenarioIds[rows[p]], score: psims[p] }));
  return mergeHits(direct, phrase).slice(0, k);
}

/**
 * Optional: kick off model + embedding load in the background (e.g. on
 * idle) so the first search feels instant. Caller should swallow errors.
 */
export function warmup() {
  ensureReady().catch(e => console.warn('[embedding-search] warmup failed:', e));
}

// Abbreviations ACR writes out (or the reverse): a search using one form and a
// scenario the other still count as naming the same thing.
const ABBREVIATION_PAIRS = [
  ['llq', 'left lower quadrant'],
  ['rlq', 'right lower quadrant'],
  ['luq', 'left upper quadrant'],
  ['ruq', 'right upper quadrant'],
  ['mi',  'myocardial infarction'],
  ['pe',  'pulmonary embolism'],
  ['dvt', 'deep vein thrombosis'],
  ['sah', 'subarachnoid hemorrhage'],
  ['sdh', 'subdural hematoma'],
  ['gca', 'giant cell arteritis'],
  ['ich', 'intracerebral hemorrhage'],
  ['ms',  'multiple sclerosis'],
  ['ra',  'rheumatoid arthritis'],
  ['oa',  'osteoarthritis'],
  ['ibd', 'inflammatory bowel disease'],
  ['hcc', 'hepatocellular carcinoma'],
  ['rcc', 'renal cell carcinoma'],
  ['copd', 'chronic obstructive pulmonary disease'],
  ['als', 'amyotrophic lateral sclerosis'],
  ['fuo', 'fever of unknown origin'],
];

/**
 * Lexical overlap between a normalized search and a scenario's normName +
 * normKeywords, in [0, 1]. A name match weighs more than a keyword match, and
 * an abbreviation on either side counts as a strong signal.
 */
export function lexicalBonus(qNorm, qTokens, scenario) {
  const name = scenario.normName || '';
  const kw = scenario.normKeywords || '';
  let weight = 0;
  for (const t of qTokens) {
    if (name.includes(t)) weight += 2;
    else if (kw && kw.includes(t)) weight += 1;
  }
  for (const [abbr, full] of ABBREVIATION_PAIRS) {
    const inName = name.includes(abbr) || name.includes(full);
    const inKw = kw && (kw.includes(abbr) || kw.includes(full));
    const inQuery = qNorm.includes(abbr) || qNorm.includes(full);
    if (inQuery && (inName || inKw)) weight += 3;
  }
  return Math.tanh(weight / 4);
}

/**
 * One hit list from the two routes to a scenario: its own ACR wording
 * (direct) and the clinician phrasings filed under it (phrase). A scenario
 * takes the better of the two; a phrasing counts only when it matches at
 * least phraseMin. Each hit keeps both scores and the route that won (via).
 *
 * direct: [{ id, score }]; phrase: [{ row, id, score }] where id is the
 * scenario the phrasing belongs to.
 */
export function mergeHits(direct, phrase, { phraseMin = PHRASE_MIN_SCORE } = {}) {
  const merged = new Map();
  for (const h of direct) merged.set(String(h.id), { id: String(h.id), score: h.score, direct: h.score, phrase: 0, via: 'scenario' });
  for (const p of phrase) {
    if (p.score < phraseMin) continue;
    const id = String(p.id);
    const cur = merged.get(id) || { id, score: 0, direct: 0, phrase: 0, via: 'scenario' };
    if (p.score > cur.phrase) { cur.phrase = p.score; cur.phraseRow = p.row; }
    if (p.score > cur.score) { cur.score = p.score; cur.via = 'phrase'; }
    merged.set(id, cur);
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

/**
 * Turns the model's hits into the suggestions a recovery screen may show:
 * hits below the threshold are dropped, the rest are re-ranked with a small
 * lexical bonus, then held to the rules by guardSuggestions (anatomy, age,
 * pregnancy, side, negation, a shared clinical word). Pure, so the evaluation
 * in tools/eval_semantic_fallback.mjs runs exactly what the page runs.
 *
 * hits: [{ id, score }] from search(); scenarioIndex: the scenario_names.json
 * rows with normName/normKeywords (app.js builds them); byId: Map of id -> row.
 */
export function rankSuggestions(query, hits, scenarioIndex, byId, { minScore = EMBEDDING_MIN_SCORE, max = 6, lambda = LEXICAL_LAMBDA } = {}) {
  const qNorm = conceptNormalize(query);
  const qTokens = qNorm.split(/\s+/).filter(t => t.length >= 3);
  const reranked = [];
  for (const h of hits) {
    if (h.score < minScore) continue;
    const s = byId.get(String(h.id));
    if (!s) continue;
    const lex = lexicalBonus(qNorm, qTokens, s);
    reranked.push({ ...s, score: h.score + lambda * lex, embScore: h.score, lexScore: lex, via: h.via, directScore: h.direct, phraseScore: h.phrase });
  }
  reranked.sort((a, b) => b.score - a.score);
  return guardSuggestions(query, reranked, scenarioIndex).slice(0, max);
}
