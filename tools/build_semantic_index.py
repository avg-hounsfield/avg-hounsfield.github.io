#!/usr/bin/env python3
"""
Build the files the in-browser semantic fallback searches against, with the
student model the browser runs:

  data/search/scenario_embeddings_v3.bin       FP16 [N, 384], L2-normalised, every scenario
  data/search/scenario_embeddings_v3_ids.json  {"ids": [...], "dim": 384, "count": N, ...}
  data/search/phrasing_index_v1.bin            TRAIN-split clinician phrasings:
                                               int8 [P, 384] (one fp16 scale per row, so a
                                               row dequantises to its unit vector), then
                                               fp16 scales [P], then uint16 scenario rows [P]
                                               (indexes into the ids above)
  data/search/phrasing_index_v1.json           {"count": P, "dim": 384, "layout": [...], ...}

The scenario text embedded is the one the student was trained on (name plus
ACR's variant text; see semantic_fallback_teacher.scenario_text). By default
the texts are encoded with the INT8 ONNX model itself (the browser encodes the
search with it, so both sides carry the same quantisation); --encoder torch
uses the PyTorch student instead.

Usage:
  python tools/build_semantic_index.py --model models/student-radiology [--encoder onnx|torch]
      [--student tools/cache/distill/student_v4] [--corpus-format name_search]
      [--phrasings data/eval/mined_phrasings.json] [--no-phrasings] [--out-dir data/search]
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from semantic_fallback_teacher import scenario_text  # noqa: E402
from semantic_fallback_embed import StudentOnnx  # noqa: E402


def encode_texts(args, texts, log_label):
    t0 = time.time()
    if args.encoder == "torch":
        from sentence_transformers import SentenceTransformer
        st = SentenceTransformer(args.student, device="cuda" if _cuda() else "cpu")
        vecs = st.encode(texts, batch_size=64, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False).astype(np.float32)
    else:
        model = StudentOnnx(ROOT / args.model)
        vecs = model.encode(texts, log_every=4000)
    print(f"  {log_label}: {vecs.shape} in {time.time() - t0:.0f}s", flush=True)
    return vecs


def _cuda():
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


def quantize_rows(mat):
    """Symmetric per-row int8 so each row dequantises with one scale."""
    amax = np.abs(mat).max(axis=1)
    scales = (amax / 127.0).astype(np.float32)
    scales[scales == 0] = 1.0
    q = np.clip(np.round(mat / scales[:, None]), -127, 127).astype(np.int8)
    return q, scales.astype(np.float16)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="models/student-radiology", help="ONNX bundle (for --encoder onnx)")
    ap.add_argument("--student", default="tools/cache/distill/student_v4", help="PyTorch student (for --encoder torch)")
    ap.add_argument("--encoder", default="onnx", choices=["onnx", "torch"])
    ap.add_argument("--corpus-format", default="name_search", choices=["name", "name_search", "name_topic_search"])
    ap.add_argument("--phrasings", default="data/eval/mined_phrasings.json")
    ap.add_argument("--no-phrasings", action="store_true")
    ap.add_argument("--out-dir", default="data/search")
    ap.add_argument("--version", default="v3", help="suffix of the scenario embedding files")
    ap.add_argument("--phrase-version", default="v1")
    args = ap.parse_args()

    out_dir = ROOT / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    scenarios = json.loads((ROOT / "data/search/scenario_names.json").read_text(encoding="utf-8"))["scenarios"]
    ids = [str(s["id"]) for s in scenarios]
    row_of = {sid: i for i, sid in enumerate(ids)}
    texts = [scenario_text(s, args.corpus_format) for s in scenarios]
    print(f"{len(ids)} scenarios ({args.corpus_format}); encoder {args.encoder}", flush=True)

    S = encode_texts(args, texts, "scenarios")
    S /= np.linalg.norm(S, axis=1, keepdims=True)
    emb_path = out_dir / f"scenario_embeddings_{args.version}.bin"
    ids_path = out_dir / f"scenario_embeddings_{args.version}_ids.json"
    emb_path.write_bytes(S.astype(np.float16).tobytes())
    ids_path.write_text(json.dumps({
        "model": args.model if args.encoder == "onnx" else args.student,
        "encoder": args.encoder,
        "corpus_format": args.corpus_format,
        "dim": int(S.shape[1]), "dtype": "float16", "normalized": True,
        "count": len(ids), "ids": ids,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {emb_path} ({emb_path.stat().st_size:,} bytes) and {ids_path.name}", flush=True)

    if args.no_phrasings:
        return
    data = json.loads((ROOT / args.phrasings).read_text(encoding="utf-8"))
    seen = set()
    phr_texts, phr_rows = [], []
    for it in data["items"]:
        if it["split"] != "train":
            continue
        sid = str(it["id"])
        if sid not in row_of:
            continue
        key = (it["q"].strip().lower(), sid)
        if key in seen:
            continue
        seen.add(key)
        phr_texts.append(it["q"].strip())
        phr_rows.append(row_of[sid])
    print(f"{len(phr_texts)} train phrasings for {len(set(phr_rows))} scenarios", flush=True)
    P = encode_texts(args, phr_texts, "phrasings")
    P /= np.linalg.norm(P, axis=1, keepdims=True)
    q, scales = quantize_rows(P)
    rows = np.asarray(phr_rows, dtype=np.uint16)
    if len(ids) > 65535:
        raise SystemExit("uint16 scenario rows overflow")
    # How much the int8 rows lose: cosine between each row and its dequantised self.
    deq = q.astype(np.float32) * scales.astype(np.float32)[:, None]
    deq /= np.linalg.norm(deq, axis=1, keepdims=True)
    fidelity = float(np.mean(np.sum(deq * P, axis=1)))
    pbin = out_dir / f"phrasing_index_{args.phrase_version}.bin"
    pjson = out_dir / f"phrasing_index_{args.phrase_version}.json"
    pbin.write_bytes(q.tobytes() + scales.tobytes() + rows.tobytes())
    pjson.write_text(json.dumps({
        "model": args.model if args.encoder == "onnx" else args.student,
        "encoder": args.encoder,
        "source": args.phrasings, "split": "train",
        "scenario_ids": ids_path.name,
        "count": len(phr_texts), "dim": int(P.shape[1]),
        "layout": ["int8 vectors [count*dim]", "float16 scales [count]", "uint16 scenario rows [count]"],
        "int8_cosine_fidelity": round(fidelity, 5),
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {pbin} ({pbin.stat().st_size:,} bytes) and {pjson.name}; int8 fidelity {fidelity:.5f}", flush=True)
    # The texts behind the rows, for the evaluation only (not shipped): lets
    # semantic_fallback_embed.py --mask-self score a train phrasing against
    # every phrasing but itself.
    side = ROOT / "tools" / "cache" / "distill" / f"phrasing_index_{args.phrase_version}.rows.json"
    side.parent.mkdir(parents=True, exist_ok=True)
    side.write_text(json.dumps({"texts": phr_texts, "rows": phr_rows}, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {side} (evaluation side file)", flush=True)


if __name__ == "__main__":
    main()
