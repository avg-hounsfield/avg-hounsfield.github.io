#!/usr/bin/env python3
"""
Teacher pass for retraining the browser's student model.

Runs CoreGRAi's radiology retriever (BAAI/bge-large-en-v1.5 + the
bge_large_lora_v1 LoRA adapter, CLS pooling) over every scenario text and
every mined clinician phrasing, then its cross-encoder (graise-ce-lora) over
the retriever's near misses, and writes:

  tools/cache/distill/corpus.json              scenario ids and the texts embedded
  tools/cache/distill/teacher_scenarios.npy    retriever embeddings of the scenarios
  tools/cache/distill/teacher_phrasings.npy    retriever embeddings of the phrasings (mined_phrasings.json order)
  tools/cache/distill/train_candidates.jsonl   per TRAIN phrasing: gold scenario, hard negatives
                                               (retriever near misses, same-topic siblings) with
                                               retriever cosine and cross-encoder logit for each
  tools/cache/distill/teacher_eval.json        teacher and reranker accuracy on train and hold-out

Hold-out phrasings are scored for the report only; nothing from them is written
to the training candidates.

Usage (CoreGRAi's Python with torch+CUDA; the LoRA and CE checkpoints are read
from the CoreGRAi repo and never modified):
  set CUDA_VISIBLE_DEVICES=1
  python tools/semantic_fallback_teacher.py [--corpus-format name_search] [--top-k 30] [--siblings 8]
"""
import argparse
import json
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
COREGRAI = Path(r"C:\Users\Patrick\radiology-ai-assistant")
LORA_ADAPTER = COREGRAI / "checkpoints" / "bge_large_lora_v1" / "best_model"
CE_DIR = COREGRAI / "checkpoints" / "graise-ce-lora" / "best_model"
BGE_BASE = "BAAI/bge-large-en-v1.5"
OUT = ROOT / "tools" / "cache" / "distill"


def scenario_text(s, fmt):
    """The text that stands for a scenario. ACR's variant text (s['search'])
    carries the age band and the qualifiers the name abbreviates."""
    name = s["name"].strip()
    search = (s.get("search") or "").strip()
    topic = (s.get("topic") or "").strip()
    if fmt == "name":
        return name
    if fmt == "name_search":
        return f"{name}. {search}" if search and search.lower() != name.lower() else name
    if fmt == "name_topic_search":
        parts = [name]
        if topic and topic.lower() not in name.lower():
            parts.append(topic)
        if search and search.lower() != name.lower():
            parts.append(search)
        return ". ".join(parts)
    raise SystemExit(f"unknown corpus format {fmt}")


def load_teacher(device):
    import torch
    from sentence_transformers import SentenceTransformer, models
    from peft import PeftModel
    print(f"loading teacher {BGE_BASE} + LoRA {LORA_ADAPTER}", flush=True)
    word = models.Transformer(BGE_BASE, max_seq_length=256)
    pool = models.Pooling(word.get_word_embedding_dimension(), pooling_mode_cls_token=True,
                          pooling_mode_mean_tokens=False, pooling_mode_max_tokens=False)
    model = SentenceTransformer(modules=[word, pool], device="cpu")
    peft_model = PeftModel.from_pretrained(model[0].auto_model, str(LORA_ADAPTER))
    model[0].auto_model = peft_model.merge_and_unload()
    model[0].auto_model.eval()
    if device.startswith("cuda"):
        model = model.half()
    model.to(device)
    return model


def load_cross_encoder(device):
    from sentence_transformers import CrossEncoder
    print(f"loading cross-encoder {CE_DIR}", flush=True)
    ce = CrossEncoder(str(CE_DIR), max_length=256, device=device)
    return ce


def topk(sims, k):
    k = min(k, sims.shape[1])
    idx = np.argpartition(-sims, k - 1, axis=1)[:, :k]
    part = np.take_along_axis(sims, idx, axis=1)
    order = np.argsort(-part, axis=1)
    return np.take_along_axis(idx, order, axis=1)


def accuracy(ranked_rows, items, ids, topic_of):
    """ranked_rows: per item, scenario row indices best first."""
    n = len(items)
    out = {"n": n, "top1_id": 0, "top1_topic": 0, "top5_id": 0, "top5_topic": 0}
    for rows, it in zip(ranked_rows, items):
        top = [ids[int(r)] for r in rows[:5]]
        out["top1_id"] += top[0] == it["id"]
        out["top1_topic"] += topic_of[top[0]] == it["topic"]
        out["top5_id"] += it["id"] in top
        out["top5_topic"] += any(topic_of[t] == it["topic"] for t in top)
    return {k: (round(v / n, 4) if k != "n" else v) for k, v in out.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus-format", default="name_search", choices=["name", "name_search", "name_topic_search"])
    ap.add_argument("--top-k", type=int, default=30, help="retriever near misses kept per phrasing")
    ap.add_argument("--siblings", type=int, default=8, help="same-topic siblings added per train phrasing")
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--device", default=None)
    ap.add_argument("--skip-ce", action="store_true")
    ap.add_argument("--tag", default=None, help="write under tools/cache/distill/<tag>/ instead")
    args = ap.parse_args()

    import torch
    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    if device.startswith("cuda"):
        print(f"device {device}: {torch.cuda.get_device_name(0)}, free {torch.cuda.mem_get_info()[0] / 2**30:.2f} GB", flush=True)
    global OUT
    if args.tag:
        OUT = OUT / args.tag
    OUT.mkdir(parents=True, exist_ok=True)

    scenarios = json.loads((ROOT / "data/search/scenario_names.json").read_text(encoding="utf-8"))["scenarios"]
    ids = [str(s["id"]) for s in scenarios]
    row_of = {sid: i for i, sid in enumerate(ids)}
    topic_of = {str(s["id"]): s["topic"] for s in scenarios}
    region_of = {str(s["id"]): s["region"] for s in scenarios}
    texts = [scenario_text(s, args.corpus_format) for s in scenarios]
    (OUT / "corpus.json").write_text(json.dumps({"format": args.corpus_format, "ids": ids, "texts": texts}, ensure_ascii=False), encoding="utf-8")
    siblings_of = {}
    for s in scenarios:
        siblings_of.setdefault(s["topic"], []).append(str(s["id"]))

    data = json.loads((ROOT / "data/eval/mined_phrasings.json").read_text(encoding="utf-8"))
    items = [{"q": it["q"], "id": str(it["id"]), "topic": it["topic"], "split": it["split"]} for it in data["items"]]
    print(f"{len(scenarios)} scenarios ({args.corpus_format}); {len(items)} phrasings", flush=True)

    teacher = load_teacher(device)
    t0 = time.time()
    S = teacher.encode(texts, batch_size=args.batch, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False).astype(np.float32)
    print(f"scenarios encoded {S.shape} in {time.time() - t0:.0f}s", flush=True)
    t0 = time.time()
    Q = teacher.encode([it["q"] for it in items], batch_size=args.batch, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False).astype(np.float32)
    print(f"phrasings encoded {Q.shape} in {time.time() - t0:.0f}s", flush=True)
    np.save(OUT / "teacher_scenarios.npy", S)
    np.save(OUT / "teacher_phrasings.npy", Q)
    del teacher
    if device.startswith("cuda"):
        torch.cuda.empty_cache()

    sims = Q @ S.T
    ranked = topk(sims, args.top_k)
    report = {"corpus_format": args.corpus_format, "retriever": {}, "reranked": {}}
    for split in ("train", "holdout"):
        sel = [i for i, it in enumerate(items) if it["split"] == split]
        report["retriever"][split] = accuracy(ranked[sel], [items[i] for i in sel], ids, topic_of)
        print(f"retriever {split}: {report['retriever'][split]}", flush=True)

    # Candidate sets: the retriever's top-k, the gold scenario, and the gold's
    # closest same-topic siblings (by retriever score) for every phrasing.
    cand_rows = []
    for qi, it in enumerate(items):
        rows = [int(r) for r in ranked[qi]]
        gold_row = row_of[it["id"]]
        sib = [row_of[s] for s in siblings_of[it["topic"]] if s != it["id"]]
        sib.sort(key=lambda r: -sims[qi, r])
        seen = set()
        out = []
        for r in [gold_row] + rows + sib[:args.siblings]:
            if r not in seen:
                seen.add(r)
                out.append(r)
        cand_rows.append(out)

    ce_scores = [None] * len(items)
    if not args.skip_ce:
        ce = load_cross_encoder(device)
        pairs, owners = [], []
        for qi, it in enumerate(items):
            for r in cand_rows[qi]:
                pairs.append((it["q"], texts[r]))
                owners.append(qi)
        print(f"cross-encoder scoring {len(pairs)} pairs", flush=True)
        t0 = time.time()
        scores = ce.predict(pairs, batch_size=128, show_progress_bar=False, convert_to_numpy=True)
        print(f"scored in {time.time() - t0:.0f}s", flush=True)
        pos = 0
        for qi in range(len(items)):
            n = len(cand_rows[qi])
            ce_scores[qi] = [float(x) for x in scores[pos:pos + n]]
            pos += n
        # Reranker accuracy: the retriever's top-k reordered by the cross-encoder.
        for split in ("train", "holdout"):
            sel = [i for i, it in enumerate(items) if it["split"] == split]
            rer = []
            for qi in sel:
                top = [int(r) for r in ranked[qi]]
                sc = {r: s for r, s in zip(cand_rows[qi], ce_scores[qi])}
                rer.append(sorted(top, key=lambda r: -sc[r]))
            report["reranked"][split] = accuracy(np.array(rer, dtype=object), [items[i] for i in sel], ids, topic_of)
            print(f"cross-encoder rerank of retriever top-{args.top_k} {split}: {report['reranked'][split]}", flush=True)
        del ce

    # Training candidates: train split only.
    n_written = 0
    with open(OUT / "train_candidates.jsonl", "w", encoding="utf-8") as f:
        for qi, it in enumerate(items):
            if it["split"] != "train":
                continue
            cands = []
            for j, r in enumerate(cand_rows[qi]):
                cands.append({
                    "id": ids[r],
                    "cos": round(float(sims[qi, r]), 5),
                    "ce": (round(ce_scores[qi][j], 4) if ce_scores[qi] is not None else None),
                    "same_topic": topic_of[ids[r]] == it["topic"],
                    "same_region": region_of[ids[r]] == region_of[it["id"]],
                })
            f.write(json.dumps({"q": it["q"], "gold": it["id"], "topic": it["topic"], "cands": cands}, ensure_ascii=False) + "\n")
            n_written += 1
    print(f"wrote {n_written} train candidate rows", flush=True)

    # How often the near misses are siblings or other regions: what the
    # negatives teach.
    sib_share, cross_region = [], []
    for qi, it in enumerate(items):
        if it["split"] != "train":
            continue
        top = [ids[int(r)] for r in ranked[qi][:10] if ids[int(r)] != it["id"]]
        sib_share.append(sum(topic_of[t] == it["topic"] for t in top) / max(1, len(top)))
        cross_region.append(sum(region_of[t] != region_of[it["id"]] for t in top) / max(1, len(top)))
    report["near_misses"] = {"same_topic_share_top10": round(float(np.mean(sib_share)), 4), "other_region_share_top10": round(float(np.mean(cross_region)), 4)}
    (OUT / "teacher_eval.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
