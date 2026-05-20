/**
 * In-browser cross-encoder reranking for radiology search.
 *
 * Pairs the query with each candidate's text and scores them with the
 * graise-ce cross-encoder (BERT-style sequence classification). Used to
 * refine the embedding-search shortlist - replaces the lexical hybrid
 * for the final ranking when the bigger CE model is loaded.
 *
 * Model: cross-encoder/ms-marco-MiniLM-L-6-v2 base, fine-tuned by coregrai
 * on radiology pairs (graise-ce, Spearman 0.57 standalone). INT8 quantized
 * ONNX, ~23MB.
 *
 * Inference cost: ~30-50ms per pair on a typical laptop CPU via
 * Transformers.js (WASM). Reranking 30 candidates = ~1s; we cap at 15
 * pairs for snappier UX.
 */

const MODEL_NAME = 'student-radiology-ce';
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0/+esm';
const DEFAULT_RERANK_COUNT = 15;  // rerank top-N from student
const CE_BATCH_SIZE = 8;
const MAX_PAIR_TOKENS = 256;

let _ce = null;
let _loadingPromise = null;

async function _loadTransformersJs() {
  const mod = await import(/* webpackIgnore: true */ TRANSFORMERS_CDN);
  mod.env.allowLocalModels = true;
  mod.env.allowRemoteModels = false;
  mod.env.localModelPath = '/models/';
  return mod;
}

/**
 * Lazy-load the CE model + tokenizer. Idempotent.
 */
export async function ensureReady() {
  if (_ce) return;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    const t0 = performance.now();
    const tf = await _loadTransformersJs();
    const { AutoTokenizer, AutoModelForSequenceClassification } = tf;
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_NAME);
    const model = await AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, {
      dtype: 'q8',
    });
    _ce = { tokenizer, model };
    console.log(`[ce-rerank] ready in ${(performance.now() - t0).toFixed(0)}ms`);
  })();
  return _loadingPromise;
}

/**
 * Score each (query, candidate.text) pair with the cross-encoder.
 * Returns an array of {id, ceScore, ...originalCandidateFields} sorted by
 * ceScore descending. Original score in the candidate is preserved as
 * embScore (if it was already there).
 *
 * Candidates: [{id, text, embScore?, ...}, ...]
 * Returns: same shape with added ceScore.
 */
export async function rerank(query, candidates, opts = {}) {
  await ensureReady();
  const maxN = Math.min(opts.maxN || DEFAULT_RERANK_COUNT, candidates.length);
  if (maxN === 0) return [];
  const subset = candidates.slice(0, maxN);
  const { tokenizer, model } = _ce;

  const scores = new Float32Array(maxN);
  for (let i = 0; i < maxN; i += CE_BATCH_SIZE) {
    const batch = subset.slice(i, i + CE_BATCH_SIZE);
    const queries = batch.map(() => query);
    const texts = batch.map(c => c.text || '');
    // Pair tokenization: Transformers.js accepts (textA, textB) arrays for
    // pair classification. type_ids are produced automatically.
    const enc = await tokenizer(queries, {
      text_pair: texts,
      padding: true,
      truncation: true,
      max_length: MAX_PAIR_TOKENS,
    });
    const out = await model(enc);
    // For sequence classification with 1 label the output is logits of
    // shape (B, 1); the raw value IS the relevance score.
    const data = out.logits.data;
    const dims = out.logits.dims;
    const numLabels = dims[1] || 1;
    for (let b = 0; b < batch.length; b++) {
      scores[i + b] = data[b * numLabels];
    }
  }

  // Attach scores; sort by ceScore desc; return as new array (no mutation).
  const scored = subset.map((c, i) => ({ ...c, ceScore: scores[i] }));
  scored.sort((a, b) => b.ceScore - a.ceScore);
  return scored;
}

/**
 * Convenience: blend CE score with student rank-position score the way
 * coregrai does server-side. Lower-impact than pure CE rerank because CE
 * alone can be noisy (per graise-ce manuscript, blend at alpha=0.3 was
 * the production winner).
 *
 * Input candidates: must come from student in DESCENDING student-rank
 * order (i.e. index 0 = student's best). After CE scoring, blends:
 *     final = (1 - alpha) * rank_pos_score + alpha * ce_norm
 * where rank_pos_score = 1.0 - i/N and ce_norm is min-max within batch.
 */
export async function rerankBlend(query, candidates, alpha = 0.3, opts = {}) {
  await ensureReady();
  const maxN = Math.min(opts.maxN || DEFAULT_RERANK_COUNT, candidates.length);
  if (maxN === 0) return [];
  const subset = candidates.slice(0, maxN);
  // Score with CE (preserve original index in subset since we'll use it for rank_pos)
  const ceScored = await rerank(query, subset.map((c, i) => ({ ...c, _origIdx: i })), { maxN });
  // Re-index back to original order to compute rank_pos
  const ceByOrigIdx = new Map(ceScored.map(c => [c._origIdx, c.ceScore]));
  // Min-max normalize CE
  const ceVals = Array.from(ceByOrigIdx.values());
  const ceMin = Math.min(...ceVals), ceMax = Math.max(...ceVals);
  const range = ceMax - ceMin || 1;
  const out = [];
  for (let i = 0; i < subset.length; i++) {
    const rankPos = 1.0 - i / subset.length;
    const ce = ceByOrigIdx.get(i);
    const ceNorm = range > 0 ? (ce - ceMin) / range : 0.5;
    const final = (1 - alpha) * rankPos + alpha * ceNorm;
    out.push({ ...subset[i], ceScore: ce, ceNorm, rankPos, score: final });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Background warmup: download model + tokenizer files, no inference. Call
 * from app on idle so the first CE search feels snappy.
 */
export function warmup() {
  ensureReady().catch(e => console.warn('[ce-rerank] warmup failed:', e));
}
