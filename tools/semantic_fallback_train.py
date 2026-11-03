#!/usr/bin/env python3
"""
Retrain the browser's student (BAAI/bge-small-en-v1.5, 384-dim, CLS pooling)
on the TRAIN-split clinician phrasings, distilling from CoreGRAi's teachers.

Reads what tools/semantic_fallback_teacher.py wrote: for every train
phrasing its gold scenario and the teacher's near misses (retriever top-k,
same-topic siblings), each with the retriever cosine and the cross-encoder
logit. Each step takes a batch of phrasings with their gold scenario text and
k hard negatives drawn from those near misses (always one same-topic sibling
and one other-region near miss when the teacher offers them), and minimises
  contrastive cross-entropy over the gold against every other scenario text
  in the batch (in-batch negatives plus the hard negatives; another phrasing's
  gold that is the same scenario is masked out), plus
  KL divergence from the teacher's distribution over the phrasing's own
  candidate list, so the student learns which near misses are nearly right
  (a sibling) and which are not (another region).

A dev split of whole train scenarios (never trained on) picks the best epoch;
the hold-out split is never read here.

Usage:
  set CUDA_VISIBLE_DEVICES=1
  python tools/semantic_fallback_train.py --out tools/cache/distill/student_v4 [--epochs 5] [--batch 32]
      [--negatives 4] [--kd-weight 0.5] [--teacher blend|ce|cos] [--dev-scenarios 120] [--seed 20261103]
"""
import argparse
import json
import math
import random
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / "cache" / "distill"
BASE_MODEL = "BAAI/bge-small-en-v1.5"


def load_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def teacher_scores(cands, mode):
    """One teacher score per candidate, on a logit-like scale: the cross-encoder
    logit, the retriever cosine times 20 (the student's own scale), or their
    mean after each is centred on the list."""
    cos = np.array([c["cos"] for c in cands], dtype=np.float32) * 20.0
    ce = np.array([c["ce"] if c["ce"] is not None else 0.0 for c in cands], dtype=np.float32)
    if mode == "cos" or cands[0]["ce"] is None:
        return cos
    if mode == "ce":
        return ce
    return 0.5 * (cos - cos.mean()) + 0.5 * (ce - ce.mean())


class Trainer:
    def __init__(self, args):
        import torch
        from transformers import AutoModel, AutoTokenizer
        self.args = args
        self.torch = torch
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"device {self.device}" + (f": {torch.cuda.get_device_name(0)}, free {torch.cuda.mem_get_info()[0] / 2**30:.2f} GB" if self.device.type == "cuda" else ""), flush=True)
        self.tok = AutoTokenizer.from_pretrained(BASE_MODEL)
        self.model = AutoModel.from_pretrained(BASE_MODEL).to(self.device)
        if args.grad_checkpoint:
            self.model.gradient_checkpointing_enable()
        self.scale = args.scale

    def encode_batch(self, texts, max_length, train=True):
        torch = self.torch
        enc = self.tok(texts, padding=True, truncation=True, max_length=max_length, return_tensors="pt").to(self.device)
        out = self.model(**enc).last_hidden_state[:, 0, :]
        return torch.nn.functional.normalize(out, dim=-1)

    @staticmethod
    def _topk_metrics(sims, gold_rows, ids, topic_of):
        top = np.argsort(-sims, axis=1)[:, :5]
        n = len(gold_rows)
        m = {"top1_id": 0, "top1_topic": 0, "top5_id": 0, "top5_topic": 0}
        for i, g in enumerate(gold_rows):
            gt = topic_of[ids[g]]
            m["top1_id"] += int(top[i, 0] == g)
            m["top1_topic"] += int(topic_of[ids[top[i, 0]]] == gt)
            m["top5_id"] += int(g in top[i])
            m["top5_topic"] += int(any(topic_of[ids[r]] == gt for r in top[i]))
        return {k: round(v / n, 4) for k, v in m.items()} | {"n": n}

    def evaluate(self, queries, gold_rows, corpus_texts, ids, topic_of):
        torch = self.torch
        self.model.eval()
        with torch.no_grad(), torch.autocast(device_type=self.device.type, dtype=torch.float16, enabled=self.device.type == "cuda"):
            C = torch.cat([self.encode_batch(corpus_texts[i:i + 128], 128) for i in range(0, len(corpus_texts), 128)]).float().cpu().numpy()
            Q = torch.cat([self.encode_batch(queries[i:i + 128], 64) for i in range(0, len(queries), 128)]).float().cpu().numpy()
        self.model.train()
        return self._topk_metrics(Q @ C.T, gold_rows, ids, topic_of)

    def save(self, out_dir: Path):
        """sentence-transformers layout (CLS pooling, normalised), so the ONNX
        export and the index builder load it like the previous student."""
        from sentence_transformers import SentenceTransformer, models
        out_dir.mkdir(parents=True, exist_ok=True)
        word = models.Transformer(BASE_MODEL, max_seq_length=256)
        word.auto_model.load_state_dict({k: v.detach().cpu() for k, v in self.model.state_dict().items()})
        pool = models.Pooling(word.get_word_embedding_dimension(), pooling_mode_cls_token=True,
                              pooling_mode_mean_tokens=False, pooling_mode_max_tokens=False)
        st = SentenceTransformer(modules=[word, pool, models.Normalize()], device="cpu")
        st.save(str(out_dir))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default=str(CACHE / "train_candidates.jsonl"))
    ap.add_argument("--corpus", default=str(CACHE / "corpus.json"))
    ap.add_argument("--out", default=str(CACHE / "student_v4"))
    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--negatives", type=int, default=4)
    ap.add_argument("--pool", type=int, default=12, help="near misses (by retriever cosine) the negatives are drawn from")
    ap.add_argument("--lr", type=float, default=3e-5)
    ap.add_argument("--warmup", type=float, default=0.1)
    ap.add_argument("--scale", type=float, default=20.0)
    ap.add_argument("--kd-weight", type=float, default=0.5)
    ap.add_argument("--kd-temp", type=float, default=1.0, help="divides the teacher scores before softmax")
    ap.add_argument("--teacher", default="blend", choices=["blend", "ce", "cos"])
    ap.add_argument("--dev-scenarios", type=int, default=120)
    ap.add_argument("--seed", type=int, default=20261103)
    ap.add_argument("--grad-checkpoint", action="store_true", default=True)
    ap.add_argument("--no-grad-checkpoint", dest="grad_checkpoint", action="store_false")
    ap.add_argument("--eval-every", type=int, default=0, help="also evaluate every N steps (0: per epoch)")
    args = ap.parse_args()

    import torch
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    corpus = json.loads(Path(args.corpus).read_text(encoding="utf-8"))
    ids, texts = corpus["ids"], corpus["texts"]
    row_of = {sid: i for i, sid in enumerate(ids)}
    scenarios = json.loads((ROOT / "data/search/scenario_names.json").read_text(encoding="utf-8"))["scenarios"]
    topic_of = {str(s["id"]): s["topic"] for s in scenarios}
    region_of = {str(s["id"]): s["region"] for s in scenarios}

    rows = load_jsonl(args.candidates)
    train_ids = sorted({r["gold"] for r in rows})
    rng = random.Random(args.seed)
    dev_ids = set(rng.sample(train_ids, min(args.dev_scenarios, len(train_ids))))
    dev = [r for r in rows if r["gold"] in dev_ids]
    train = [r for r in rows if r["gold"] not in dev_ids]
    print(f"{len(rows)} train phrasings for {len(train_ids)} scenarios; dev {len(dev)} phrasings of {len(dev_ids)} scenarios; training on {len(train)}", flush=True)

    trainer = Trainer(args)
    model, tok, device = trainer.model, trainer.tok, trainer.device

    # Per phrasing: candidate rows (gold first), teacher scores, the pool of
    # near misses negatives are drawn from, and the forced sibling / other-region picks.
    prepared = []
    for r in train:
        cands = [c for c in r["cands"] if c["id"] in row_of]
        gold = next(c for c in cands if c["id"] == r["gold"])
        negs = [c for c in cands if c["id"] != r["gold"]]
        negs.sort(key=lambda c: -c["cos"])
        pool = negs[:args.pool]
        sib = next((c for c in negs if c["same_topic"]), None)
        other = next((c for c in pool if not c["same_region"]), None)
        tscore = {c["id"]: s for c, s in zip(cands, teacher_scores(cands, args.teacher))}
        prepared.append({"q": r["q"], "gold": gold, "pool": pool, "sib": sib, "other": other, "tscore": tscore})

    def draw_negatives(p, k):
        picks = []
        if p["sib"] is not None:
            picks.append(p["sib"])
        if p["other"] is not None and p["other"] is not p["sib"]:
            picks.append(p["other"])
        rest = [c for c in p["pool"] if all(c is not x for x in picks)]
        while len(picks) < k and rest:
            # Favour the closest near misses without always taking the same ones.
            weights = np.array([math.exp(c["cos"] / 0.05) for c in rest])
            j = int(np.random.choice(len(rest), p=weights / weights.sum()))
            picks.append(rest.pop(j))
        return picks[:k]

    steps_per_epoch = math.ceil(len(prepared) / args.batch)
    total_steps = steps_per_epoch * args.epochs
    warmup_steps = int(total_steps * args.warmup)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    def lr_lambda(s):
        if s < warmup_steps:
            return (s + 1) / max(1, warmup_steps)
        return max(0.0, (total_steps - s) / max(1, total_steps - warmup_steps))
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lr_lambda)
    use_amp = device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)

    dev_queries = [r["q"] for r in dev]
    dev_gold = [row_of[r["gold"]] for r in dev]
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    log = {"args": vars(args), "epochs": []}
    best = None

    def run_eval(tag):
        nonlocal best
        m = trainer.evaluate(dev_queries, dev_gold, texts, ids, topic_of)
        print(f"  dev {tag}: {m}", flush=True)
        key = (m["top1_topic"], m["top1_id"])
        if best is None or key > best["key"]:
            best = {"key": key, "tag": tag, "metrics": m}
            trainer.save(out_dir)
            model.to(device)
            print(f"  saved best ({tag}) -> {out_dir}", flush=True)
        return m

    print(f"{steps_per_epoch} steps/epoch, {total_steps} total, warmup {warmup_steps}", flush=True)
    run_eval("init")
    step = 0
    model.train()
    for epoch in range(1, args.epochs + 1):
        order = list(range(len(prepared)))
        random.shuffle(order)
        t0 = time.time()
        sums = {"ce": 0.0, "kd": 0.0, "n": 0}
        for b in range(0, len(order), args.batch):
            batch = [prepared[i] for i in order[b:b + args.batch]]
            B = len(batch)
            k = args.negatives
            # Each anchor's candidate list (gold first, then its negatives) is a
            # contiguous slice of the batch's documents.
            doc_texts, doc_ids, cand_teacher, slices = [], [], [], []
            for p in batch:
                cands = [p["gold"]] + draw_negatives(p, k)
                slices.append((len(doc_ids), len(doc_ids) + len(cands)))
                for c in cands:
                    doc_texts.append(texts[row_of[c["id"]]])
                    doc_ids.append(c["id"])
                cand_teacher.append([p["tscore"][c["id"]] for c in cands])
            with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=use_amp):
                q_emb = trainer.encode_batch([p["q"] for p in batch], 64)
                d_emb = torch.cat([trainer.encode_batch(doc_texts[i:i + 160], 128) for i in range(0, len(doc_texts), 160)])
                logits = (q_emb @ d_emb.T).float() * args.scale  # (B, D)
                # Mask every copy of an anchor's gold scenario except its own positive.
                D = logits.shape[1]
                gold_ids = [p["gold"]["id"] for p in batch]
                mask = torch.zeros((B, D), dtype=torch.bool, device=device)
                targets = torch.zeros(B, dtype=torch.long, device=device)
                for i, (start, end) in enumerate(slices):
                    targets[i] = start
                    for j, did in enumerate(doc_ids):
                        if did == gold_ids[i] and j != start:
                            mask[i, j] = True
                logits = logits.masked_fill(mask, float("-inf"))
                ce_loss = torch.nn.functional.cross_entropy(logits, targets)
                kd_loss = torch.zeros((), device=device)
                if args.kd_weight > 0:
                    kd_terms = []
                    for i, (start, end) in enumerate(slices):
                        s = logits[i, start:end]
                        t = torch.tensor(cand_teacher[i], device=device) / args.kd_temp
                        p_t = torch.softmax(t, dim=0)
                        kd_terms.append(torch.sum(p_t * (torch.log(p_t + 1e-9) - torch.log_softmax(s, dim=0))))
                    kd_loss = torch.stack(kd_terms).mean()
                loss = ce_loss + args.kd_weight * kd_loss
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            step += 1
            sums["ce"] += ce_loss.item() * B
            sums["kd"] += kd_loss.item() * B
            sums["n"] += B
            if step % 50 == 0:
                print(f"  epoch {epoch} step {step}/{total_steps} ce {sums['ce'] / sums['n']:.4f} kd {sums['kd'] / sums['n']:.4f} lr {sched.get_last_lr()[0]:.2e} ({time.time() - t0:.0f}s)", flush=True)
            if args.eval_every and step % args.eval_every == 0:
                run_eval(f"step{step}")
        epoch_log = {"epoch": epoch, "ce": sums["ce"] / sums["n"], "kd": sums["kd"] / sums["n"], "seconds": round(time.time() - t0)}
        print(f"epoch {epoch} done: ce {epoch_log['ce']:.4f} kd {epoch_log['kd']:.4f} in {epoch_log['seconds']}s", flush=True)
        epoch_log["dev"] = run_eval(f"epoch{epoch}")
        log["epochs"].append(epoch_log)
        log["best"] = best
        (out_dir / "train_log.json").write_text(json.dumps(log, indent=1, default=str), encoding="utf-8")
    print(f"best: {best}", flush=True)


if __name__ == "__main__":
    main()
