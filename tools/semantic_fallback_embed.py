#!/usr/bin/env python3
"""
Stage 1 of the semantic-fallback evaluation: run the browser's own student
model (the INT8 ONNX file under models/<name>/onnx, through onnxruntime) over
every evaluation search and record its nearest scenarios and, when a phrasing
index is given, its nearest clinician phrasings.

The searches come from the same files the rules are judged on:
  data/eval/mined_phrasings.json      train and hold-out clinician phrasings
  data/eval/synthetic_queries_850.json persona searches
plus a fixed list of nonsense and off-topic probes that must stay below the
suggestion threshold.

Each search is encoded on its own, exactly as the browser does (one query per
inference, CLS pooling, L2 normalisation), so the scores here are the scores
the page would compute.

Usage:
  python tools/semantic_fallback_embed.py --out tools/cache/semantic-eval/hits-baseline.json
  python tools/semantic_fallback_embed.py --model models/student-radiology \
      --scenario-bin data/search/scenario_embeddings_v3.bin \
      --scenario-ids data/search/scenario_embeddings_v3_ids.json \
      --phrase-index data/search/phrasing_index_v1.bin --out ...
Then: node tools/eval_semantic_fallback.mjs --hits tools/cache/semantic-eval/hits-baseline.json
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent

# Searches that must not produce a suggestion: nonsense, chit-chat, and
# questions ACR does not answer (contrast, devices, technique).
PROBES = [
    "zzqqxx", "asdf qwer", "my cat is sad", "contrast allergy",
    "qwertyuiop", "lorem ipsum dolor", "hello there", "what time is it",
    "pizza delivery", "stock market crash", "the", "blah blah blah",
    "123456", "xyzzy plugh", "happy birthday", "gadolinium dose calculation",
    "claustrophobia", "pacemaker mri safety", "how does a ct scanner work",
    "radiology residency salary", "iodinated contrast premedication",
    "weather tomorrow", "football scores", "recipe for pancakes",
    "metformin and contrast", "mri coil types", "ct dose reduction technique",
]


def load_queries(sets, extra=None):
    """Every evaluation search, keyed by text, with the sets it belongs to."""
    out = {}
    def add(text, tag):
        text = (text or "").strip()
        if not text:
            return
        out.setdefault(text, set()).add(tag)
    if "holdout" in sets or "train" in sets:
        data = json.loads((ROOT / "data/eval/mined_phrasings.json").read_text(encoding="utf-8"))
        for item in data["items"]:
            if item["split"] in sets:
                add(item["q"], item["split"])
    if "persona" in sets:
        for q in json.loads((ROOT / "data/eval/synthetic_queries_850.json").read_text(encoding="utf-8")):
            add(q["query"], "persona")
    if "probes" in sets:
        for p in PROBES:
            add(p, "probes")
    if extra:
        for q in json.loads(Path(extra).read_text(encoding="utf-8")):
            add(q, "extra")
    return out


class StudentOnnx:
    """The browser's model: tokenizer.json + onnx/model_quantized.onnx."""

    def __init__(self, model_dir: Path, max_length=128, threads=None):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        self.tok = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self.tok.enable_truncation(max_length=max_length)
        self.tok.no_padding()
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads or max(1, (os.cpu_count() or 4) - 1)
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.sess = ort.InferenceSession(str(model_dir / "onnx" / "model_quantized.onnx"), opts,
                                         providers=["CPUExecutionProvider"])
        self.input_names = [i.name for i in self.sess.get_inputs()]

    def encode_one(self, text):
        enc = self.tok.encode(text)
        ids = np.asarray([enc.ids], dtype=np.int64)
        feeds = {"input_ids": ids, "attention_mask": np.ones_like(ids)}
        if "token_type_ids" in self.input_names:
            feeds["token_type_ids"] = np.zeros_like(ids)
        out = self.sess.run(None, feeds)[0]  # (1, L, H)
        cls = out[0, 0, :].astype(np.float32)
        norm = np.linalg.norm(cls)
        return cls / (norm if norm > 0 else 1e-9)

    def encode(self, texts, log_every=2000):
        vecs = np.zeros((len(texts), 384), dtype=np.float32)
        t0 = time.time()
        for i, t in enumerate(texts):
            vecs[i] = self.encode_one(t)
            if log_every and (i + 1) % log_every == 0:
                print(f"  encoded {i + 1}/{len(texts)} ({time.time() - t0:.0f}s)", flush=True)
        return vecs


def read_fp16_matrix(path: Path, count, dim):
    raw = np.frombuffer(path.read_bytes(), dtype=np.float16)
    if raw.size != count * dim:
        raise SystemExit(f"{path}: {raw.size} fp16 values, expected {count * dim}")
    return raw.astype(np.float32).reshape(count, dim)


def read_phrase_index(bin_path: Path, meta_path: Path):
    """The shipped phrasing index: int8 rows with one fp16 scale each, and the
    scenario row each phrasing belongs to. Returns (matrix fp32, scenario rows)."""
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    count, dim = meta["count"], meta["dim"]
    buf = bin_path.read_bytes()
    off = 0
    q = np.frombuffer(buf, dtype=np.int8, count=count * dim, offset=off).reshape(count, dim)
    off += count * dim
    scales = np.frombuffer(buf, dtype=np.float16, count=count, offset=off).astype(np.float32)
    off += count * 2
    rows = np.frombuffer(buf, dtype=np.uint16, count=count, offset=off).astype(np.int64)
    off += count * 2
    if off != len(buf):
        raise SystemExit(f"{bin_path}: {len(buf)} bytes, layout expects {off}")
    mat = q.astype(np.float32) * scales[:, None]
    return mat, rows, meta


def top_k(sims, k):
    k = min(k, sims.shape[1])
    idx = np.argpartition(-sims, k - 1, axis=1)[:, :k]
    part = np.take_along_axis(sims, idx, axis=1)
    order = np.argsort(-part, axis=1)
    return np.take_along_axis(idx, order, axis=1), np.take_along_axis(part, order, axis=1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="models/student-radiology")
    ap.add_argument("--scenario-bin", default="data/search/scenario_embeddings_v3.bin")
    ap.add_argument("--scenario-ids", default="data/search/scenario_embeddings_v3_ids.json")
    ap.add_argument("--phrase-index", default=None, help="data/search/phrasing_index_v1.bin (its .json sits beside it)")
    ap.add_argument("--mask-self", action="store_true",
                    help="leave-one-out: a search never matches the phrasing row with its own text "
                         "(needs the builder's tools/cache/distill/phrasing_index_*.rows.json)")
    ap.add_argument("--sets", default="holdout,train,persona,probes")
    ap.add_argument("--extra", default=None, help="JSON list of further searches to record (tagged 'extra')")
    ap.add_argument("--k", type=int, default=30)
    ap.add_argument("--threads", type=int, default=None)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    sets = set(args.sets.split(",")) if args.sets else set()
    queries = load_queries(sets, args.extra)
    texts = list(queries.keys())
    print(f"{len(texts)} distinct searches from {sorted(sets)}")

    meta = json.loads((ROOT / args.scenario_ids).read_text(encoding="utf-8"))
    ids = meta["ids"]
    S = read_fp16_matrix(ROOT / args.scenario_bin, meta["count"], meta["dim"])
    print(f"scenario matrix {S.shape} from {args.scenario_bin}")

    P = rows = pmeta = None
    if args.phrase_index:
        pbin = ROOT / args.phrase_index
        P, rows, pmeta = read_phrase_index(pbin, pbin.with_suffix(".json"))
        print(f"phrasing matrix {P.shape} from {args.phrase_index}")

    model = StudentOnnx(ROOT / args.model, threads=args.threads)
    t0 = time.time()
    Q = model.encode(texts)
    print(f"encoded {len(texts)} searches in {time.time() - t0:.0f}s")

    s_idx, s_val = top_k(Q @ S.T, args.k)
    hits = {}
    for qi, text in enumerate(texts):
        hits[text] = [[ids[int(j)], round(float(v), 5)] for j, v in zip(s_idx[qi], s_val[qi])]
    out = {
        "model": args.model,
        "scenario_bin": args.scenario_bin,
        "scenario_ids": args.scenario_ids,
        "phrase_index": args.phrase_index,
        "k": args.k,
        "sets": {text: sorted(tags) for text, tags in queries.items()},
        "hits": hits,
    }
    if P is not None:
        psims = Q @ P.T
        if args.mask_self:
            side = ROOT / "tools" / "cache" / "distill" / (Path(args.phrase_index).stem + ".rows.json")
            rows_meta = json.loads(side.read_text(encoding="utf-8"))
            by_text = {}
            for r, t in enumerate(rows_meta["texts"]):
                by_text.setdefault(t.strip().lower(), []).append(r)
            masked = 0
            for qi, text in enumerate(texts):
                for r in by_text.get(text.strip().lower(), []):
                    psims[qi, r] = -1.0
                    masked += 1
            print(f"masked {masked} self rows (leave-one-out)")
            out["mask_self"] = True
        p_idx, p_val = top_k(psims, args.k)
        phits = {}
        for qi, text in enumerate(texts):
            # [phrasing row, scenario id of that phrasing, score]
            phits[text] = [[int(j), ids[int(rows[int(j)])], round(float(v), 5)] for j, v in zip(p_idx[qi], p_val[qi])]
        out["phits"] = phits
    out_path = ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {out_path} ({out_path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
