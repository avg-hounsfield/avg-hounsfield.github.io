#!/usr/bin/env python3
"""
Step 2 of alias mining: screen the generated phrasings with CoreGRAi's
radiology retriever and reranker, then turn the survivors into alias
candidates for tools/mine_aliases_gate.mjs.

Models (read-only, from the CoreGRAi repo):
  checkpoints/bge_large_lora_v1/best_model   BAAI/bge-large-en-v1.5 + LoRA (dense retriever)
  checkpoints/graise-ce-lora/best_model      cross-encoder reranker (MiniLM-L6, fine-tuned)

Every scenario is embedded as "<name>. <patient description>". For each
phrasing the dense retriever ranks all 3,984 scenarios; the cross-encoder then
rescores the dense top-K plus the target scenario. A phrasing passes the
screen when the target scenario's topic sits near the top of either ranking,
so a phrasing the models read as a different question never supports an alias.

An alias pair ["from", "to"] becomes a candidate when at least one TRAIN
phrasing that carries it passes the screen; hold-out phrasings never do, so
hold-out accuracy stays an honest measure of generalisation.

--calibrate reports the retriever's own hit rates on data/eval/synthetic_queries_850.json
(persona searches with known target concepts), the evidence for the K thresholds.

--judge asks the OTHER model family (Gemini for Sonnet-born pairs, Sonnet for
Gemini-born pairs) whether each pair in a given list is clinically faithful in
the context of its scenario; the gate removes rejected pairs. Responses are
cached under tools/cache/alias-mining/judge/.

Output: tools/cache/alias-mining/screen.json (per phrasing scores) and
        tools/cache/alias-mining/candidates.json (per alias pair)

Usage:
    python tools/mine_aliases_screen.py --calibrate
    python tools/mine_aliases_screen.py
    python tools/mine_aliases_screen.py --judge tools/cache/alias-mining/accepted_for_judge.json
"""
import argparse
import json
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
COREGRAI = Path(r'C:\Users\Patrick\radiology-ai-assistant')
ADAPTER = COREGRAI / 'checkpoints' / 'bge_large_lora_v1' / 'best_model'
CE_PATH = COREGRAI / 'checkpoints' / 'graise-ce-lora' / 'best_model'
BASE_MODEL = 'BAAI/bge-large-en-v1.5'
CACHE = REPO / 'tools' / 'cache' / 'alias-mining'
PHRASINGS = REPO / 'data' / 'eval' / 'mined_phrasings.json'

DENSE_TOPIC_K = 10      # target topic within the dense top-10 ...
CE_TOPIC_K = 3          # ... or within the cross-encoder top-3 of (dense top-20 + target)
CE_POOL = 20

sys.path.insert(0, str(REPO / 'tools'))
from mine_aliases_generate import OpenRouter, find_api_key, parse_json_object, log, short_name  # noqa: E402

JUDGE_SYSTEM = """You review alias pairs for the search index of a website that routes a clinician's search to an ACR Appropriateness Criteria scenario. Each pair maps a phrase a clinician might type ("from") onto the wording ACR uses ("to") for one specific scenario, whose name and patient description are given. The matcher will silently replace "from" with "to" wherever "from" appears in any search.

Accept a pair only when a clinician typing "from" would, in ordinary use, mean what ACR's "to" means in that scenario, and the replacement changes nothing about body part or organ, side, population (child, adult, pregnant, sex), polarity (a negation added or lost), acuity, mechanism or stage. Reject a pair when "from" is ambiguous across unrelated conditions or body regions, when it is a common non-clinical word or an abbreviation with several common clinical meanings, when "to" is broader or narrower than "from" in a way that would route the search to the wrong scenario, or when the mapping is simply clinically wrong. An empty "to" means the phrase is deleted from the search: accept that only when the phrase carries no clinical meaning at all.

Return only JSON: {"verdicts": [{"i": <index>, "ok": true|false, "why": "<at most 12 words>"}]} with one verdict per pair, in order."""


# ---- Models ---------------------------------------------------------------

def load_encoder():
    import torch
    from sentence_transformers import SentenceTransformer, models
    from peft import PeftModel
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    word = models.Transformer(BASE_MODEL, max_seq_length=512)
    pool = models.Pooling(word.get_word_embedding_dimension(), pooling_mode_cls_token=True,
                          pooling_mode_mean_tokens=False, pooling_mode_max_tokens=False)
    model = SentenceTransformer(modules=[word, pool, models.Normalize()], device=device)
    model[0].auto_model = PeftModel.from_pretrained(model[0].auto_model, str(ADAPTER))
    model[0].auto_model.eval()
    model.to(device)
    log(f'encoder {BASE_MODEL} + LoRA {ADAPTER.name} on {device}')
    return model


def load_cross_encoder():
    import torch
    from sentence_transformers import CrossEncoder
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    ce = CrossEncoder(str(CE_PATH), max_length=384, device=device)
    log(f'cross-encoder {CE_PATH.name} on {device}')
    return ce


def encode(model, texts, batch_size=64):
    return model.encode(list(texts), batch_size=batch_size, convert_to_numpy=True, normalize_embeddings=True,
                        show_progress_bar=False).astype(np.float32)


# ---- Data -----------------------------------------------------------------

def load_scenarios():
    return json.loads((REPO / 'data/search/scenario_names.json').read_text(encoding='utf-8'))['scenarios']


def doc_text(s):
    return f"{short_name(s)}. {s.get('search', '')}".strip()


def rank_of(order, predicate):
    """1-based rank of the first position where predicate(index) holds."""
    for r, idx in enumerate(order, 1):
        if predicate(idx):
            return r
    return None


# ---- Screening ------------------------------------------------------------

def screen(args):
    scenarios = load_scenarios()
    data = json.loads(PHRASINGS.read_text(encoding='utf-8'))
    items = data['items']
    log(f'{len(scenarios)} scenarios, {len(items)} phrasings')
    idx_of = {s['id']: i for i, s in enumerate(scenarios)}
    topics = np.array([s['topic'] for s in scenarios])
    regions = np.array([s['region'] for s in scenarios])
    texts = [doc_text(s) for s in scenarios]

    enc = load_encoder()
    t0 = time.time()
    D = encode(enc, texts)
    Q = encode(enc, [it['q'] for it in items])
    log(f'embedded in {time.time() - t0:.0f}s')
    ce = load_cross_encoder()

    results = []
    pairs, owners = [], []
    for i, it in enumerate(items):
        sims = D @ Q[i]
        order = np.argsort(-sims)
        ti = idx_of[it['id']]
        dense_rank_id = int(np.where(order == ti)[0][0]) + 1
        dense_rank_topic = rank_of(order, lambda k: topics[k] == it['topic'])
        pool = list(order[:CE_POOL])
        if ti not in pool:
            pool.append(ti)
        for k in pool:
            pairs.append((it['q'], texts[k]))
            owners.append((i, int(k)))
        results.append({'dense_rank_id': dense_rank_id, 'dense_rank_topic': dense_rank_topic,
                        'dense_sim_target': float(sims[ti]), 'dense_sim_top': float(sims[order[0]]),
                        'dense_top_region': str(regions[order[0]]), 'pool': [int(k) for k in pool]})
    t0 = time.time()
    scores = ce.predict(pairs, batch_size=128, show_progress_bar=False)
    log(f'cross-encoder scored {len(pairs)} pairs in {time.time() - t0:.0f}s')
    by_item = defaultdict(list)
    for (i, k), sc in zip(owners, scores):
        by_item[i].append((float(sc), k))
    for i, it in enumerate(items):
        ti = idx_of[it['id']]
        ranked = sorted(by_item[i], reverse=True)
        r = results[i]
        r['ce_rank_topic'] = rank_of([k for _, k in ranked], lambda k: topics[k] == it['topic'])
        r['ce_target'] = next(sc for sc, k in ranked if k == ti)
        others = [sc for sc, k in ranked if topics[k] != it['topic']]
        r['ce_best_other'] = max(others) if others else None
        r['ce_top_region'] = str(regions[ranked[0][1]])
        r['pass'] = bool((r['dense_rank_topic'] or 10 ** 6) <= args.dense_k or (r['ce_rank_topic'] or 10 ** 6) <= args.ce_k)
        del r['pool']

    # Per-kind summary, the evidence behind the thresholds.
    summary = defaultdict(lambda: {'n': 0, 'pass': 0, 'dense_top1': 0, 'dense_top10': 0, 'ce_top1': 0, 'ce_top3': 0})
    for it, r in zip(items, results):
        for key in ('all', it['kind'], it['split']):
            s = summary[key]
            s['n'] += 1
            s['pass'] += r['pass']
            s['dense_top1'] += (r['dense_rank_topic'] == 1)
            s['dense_top10'] += (r['dense_rank_topic'] or 10 ** 6) <= 10
            s['ce_top1'] += (r['ce_rank_topic'] == 1)
            s['ce_top3'] += (r['ce_rank_topic'] or 10 ** 6) <= 3
    log('screen summary: ' + json.dumps(summary))

    # Alias candidates: one record per normalised (from, to) pair.
    cands = {}
    for it, r in zip(items, results):
        for frm, to in it['aliases']:
            key = f'{frm}\t{to}'
            c = cands.setdefault(key, {'from': frm, 'to': to, 'ids': set(), 'topics': set(), 'kinds': set(), 'models': set(),
                                       'train_phrasings': 0, 'train_pass': 0, 'holdout_phrasings': 0, 'examples': []})
            c['ids'].add(it['id'])
            c['topics'].add(it['topic'])
            c['kinds'].add(it['kind'])
            c['models'].update(it['models'])
            if it['split'] == 'train':
                c['train_phrasings'] += 1
                c['train_pass'] += int(r['pass'])
                if r['pass'] and len(c['examples']) < 3:
                    c['examples'].append(it['q'])
            else:
                c['holdout_phrasings'] += 1
    out = []
    for c in cands.values():
        c['screened'] = c['train_pass'] > 0
        for k in ('ids', 'topics', 'kinds', 'models'):
            c[k] = sorted(c[k])
        out.append(c)
    out.sort(key=lambda c: (-c['train_pass'], -len(c['ids']), c['from']))
    n_screened = sum(1 for c in out if c['screened'])
    log(f'{len(out)} distinct alias pairs; {n_screened} screened in (a train phrasing passed); '
        f'{sum(1 for c in out if c["train_phrasings"] == 0)} supported only by hold-out phrasings')

    (CACHE / 'screen.json').write_text(json.dumps({
        'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'thresholds': {'dense_topic_k': args.dense_k, 'ce_topic_k': args.ce_k, 'ce_pool': CE_POOL},
        'summary': summary, 'phrasings': [{'q': it['q'], 'id': it['id'], 'split': it['split'], 'kind': it['kind'], **r}
                                          for it, r in zip(items, results)],
    }, ensure_ascii=False, indent=0), encoding='utf-8')
    (CACHE / 'candidates.json').write_text(json.dumps({
        'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'counts': {'pairs': len(out), 'screened': n_screened}, 'candidates': out,
    }, ensure_ascii=False, indent=0), encoding='utf-8')
    log('wrote screen.json and candidates.json')


# ---- Calibration on the persona set ----------------------------------------

def calibrate(args):
    scenarios = load_scenarios()
    concepts = json.loads((REPO / 'data/search/concept_index.json').read_text(encoding='utf-8'))['concepts']
    queries = json.loads((REPO / 'data/eval/synthetic_queries_850.json').read_text(encoding='utf-8'))
    topics = np.array([s['topic'] for s in scenarios])
    by_id = {s['id']: s for s in scenarios}
    texts = [doc_text(s) for s in scenarios]
    enc = load_encoder()
    D = encode(enc, texts)
    ce = load_cross_encoder()
    rows = []
    for q in queries:
        concept = concepts.get(q['expected_concept_id'])
        ids = {str(m['scenario_id']) for m in (concept or {}).get('scenario_mappings', [])}
        want = {by_id[i]['topic'] for i in ids if i in by_id}
        if not want:
            continue
        rows.append((q['query'], want))
    Q = encode(enc, [r[0] for r in rows])
    hits = defaultdict(int)
    pairs, owners = [], []
    orders = []
    for i, (q, want) in enumerate(rows):
        order = np.argsort(-(D @ Q[i]))
        orders.append(order)
        r = rank_of(order, lambda k: topics[k] in want)
        for K in (1, 3, 5, 10, 20):
            hits[f'dense_top{K}'] += (r or 10 ** 6) <= K
        for k in order[:CE_POOL]:
            pairs.append((q, texts[k]))
            owners.append((i, int(k)))
    scores = ce.predict(pairs, batch_size=128, show_progress_bar=False)
    by_item = defaultdict(list)
    for (i, k), sc in zip(owners, scores):
        by_item[i].append((float(sc), k))
    for i, (q, want) in enumerate(rows):
        ranked = [k for _, k in sorted(by_item[i], reverse=True)]
        r = rank_of(ranked, lambda k: topics[k] in want)
        for K in (1, 3, 5):
            hits[f'ce_top{K}_of_dense20'] += (r or 10 ** 6) <= K
    n = len(rows)
    log(f'calibration on {n} persona searches with a known target topic: ' +
        ', '.join(f'{k} {v / n:.3f}' for k, v in sorted(hits.items())))


# ---- Judge (second model family) ---------------------------------------------

def judge(args):
    scenarios = load_scenarios()
    by_id = {s['id']: s for s in scenarios}
    pairs = json.loads(Path(args.judge).read_text(encoding='utf-8'))
    log(f'{len(pairs)} alias pairs to judge')
    client = OpenRouter(find_api_key(), CACHE / 'cost_log.jsonl')
    jdir = CACHE / 'judge'
    jdir.mkdir(parents=True, exist_ok=True)
    verdicts = {}
    # The judge is the family that did NOT propose the pair; both when both did.
    groups = defaultdict(list)
    for p in pairs:
        models = set(p.get('models', []))
        judges = []
        if any(m.startswith('anthropic/') for m in models):
            judges.append('google/gemini-3.1-pro-preview')
        if any(m.startswith('google/') for m in models) or not judges:
            judges.append('anthropic/claude-sonnet-4.6')
        for jm in judges:
            groups[jm].append(p)
    for jm, plist in groups.items():
        for b in range(0, len(plist), args.batch):
            batch = plist[b:b + args.batch]
            key = jm.replace('/', '__') + '-' + str(abs(hash(tuple(p['from'] + '\t' + p['to'] + '\t' + ','.join(p['ids'][:3]) for p in batch))))
            path = jdir / f'{key}.json'
            if path.exists():
                parsed = json.loads(path.read_text(encoding='utf-8'))['parsed']
            else:
                lines = []
                for i, p in enumerate(batch):
                    s = by_id[p['ids'][0]]
                    lines.append(f'{i}. from="{p["from"]}" to="{p["to"]}" | scenario: {short_name(s)} || {s.get("search", "")} | topic: {s["topic"]} | population: {s.get("age")}')
                user = 'Pairs:\n' + '\n'.join(lines)
                content, usage = client.chat(jm, JUDGE_SYSTEM, user, max_tokens=6000, temperature=0.0, json_mode=True, tag=f'judge-{b}')
                try:
                    parsed = parse_json_object(content)
                except ValueError as e:
                    log(f'judge batch unparseable ({e}); marking as unjudged')
                    parsed = {'verdicts': []}
                path.write_text(json.dumps({'model': jm, 'pairs': batch, 'raw': content, 'usage': usage, 'parsed': parsed}, ensure_ascii=False, indent=1), encoding='utf-8')
            for v in parsed.get('verdicts', []):
                try:
                    p = batch[int(v['i'])]
                except (KeyError, ValueError, IndexError, TypeError):
                    continue
                k = p['from'] + '\t' + p['to']
                verdicts.setdefault(k, []).append({'model': jm, 'ok': bool(v.get('ok')), 'why': str(v.get('why', ''))[:120]})
            log(f'{jm.split("/")[-1]} judged {min(b + args.batch, len(plist))}/{len(plist)}')
    out = []
    for p in pairs:
        k = p['from'] + '\t' + p['to']
        vs = verdicts.get(k, [])
        out.append({'from': p['from'], 'to': p['to'], 'verdicts': vs, 'ok': bool(vs) and all(v['ok'] for v in vs)})
    (CACHE / 'judge_verdicts.json').write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding='utf-8')
    log(f'judged {len(out)}: ok {sum(1 for o in out if o["ok"])}, rejected {sum(1 for o in out if o["verdicts"] and not o["ok"])}, unjudged {sum(1 for o in out if not o["verdicts"])}')
    # Rejections go into the tracked exclusions file, so a rerun of the gate never accepts them again.
    excl_path = REPO / 'data' / 'eval' / 'mined_aliases_exclusions.json'
    excl = json.loads(excl_path.read_text(encoding='utf-8'))
    have = {e['from'] if isinstance(e, dict) else e for e in excl['exclude']}
    added = 0
    for o in out:
        if o['verdicts'] and not o['ok'] and o['from'] not in have:
            bad = next(v for v in o['verdicts'] if not v['ok'])
            excl['exclude'].append({'from': o['from'], 'to': o['to'], 'why': bad['why'], 'source': bad['model']})
            have.add(o['from'])
            added += 1
    excl_path.write_text(json.dumps(excl, ensure_ascii=False, indent=1), encoding='utf-8')
    log(f'added {added} judge rejections to {excl_path.relative_to(REPO)}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--calibrate', action='store_true')
    ap.add_argument('--judge', help='JSON list of {from, to, ids, models} pairs to judge with the other model family')
    ap.add_argument('--dense-k', type=int, default=DENSE_TOPIC_K)
    ap.add_argument('--ce-k', type=int, default=CE_TOPIC_K)
    ap.add_argument('--batch', type=int, default=40)
    args = ap.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    if args.calibrate:
        calibrate(args)
    elif args.judge:
        judge(args)
    else:
        screen(args)


if __name__ == '__main__':
    main()
