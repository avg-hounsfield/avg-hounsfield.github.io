#!/usr/bin/env python3
"""
Eval 850 synthetic queries (across diverse medical personas) against the
production search pipeline. Mirrors js/app.js exactly:

  1. summary_cards.findMatch() - exact or substring/word match on topic
  2. exact concept synonym short-circuit
  3. concept lookup with substring + Levenshtein fallback
  4. scenario name + keyword search
  5. embedding search (student v3) + lexical hybrid bonus

For each query the eval determines which CONCEPT the top result resolves to
(by name->concept mapping or scenario->concept mapping) and compares to
the agent-supplied expected_concept_id.

Run:
    CUDA_VISIBLE_DEVICES=0 python tools/eval_synthetic_1000.py
"""
import json
import re
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

COREGRAI = Path(r"C:\Users\Patrick\radiology-ai-assistant")
AVGHF = Path(r"C:\Users\Patrick\OneDrive\Rad_Projects\avg-hounsfield\avg-hounsfield.github.io")
QUERIES = AVGHF / "data" / "eval" / "synthetic_queries_850.json"
SUMMARY_CARDS = AVGHF / "data" / "search" / "summary_cards.json"
CONCEPT_INDEX = AVGHF / "data" / "search" / "concept_index.json"
SCENARIO_NAMES = AVGHF / "data" / "search" / "scenario_names.json"
LUNR_INDEX = AVGHF / "data" / "search" / "lunr-scenarios.json"
STUDENT = COREGRAI / "checkpoints" / "embed_student_v3"
EMB_BIN = AVGHF / "data" / "search" / "scenario_embeddings_v3.bin"
EMB_IDS = AVGHF / "data" / "search" / "scenario_embeddings_v3_ids.json"


# ---------- normalization (mirrors js/app.js _conceptNorm) ----------
def norm(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[-_/]", " ", s)
    # Punctuation -> space so substring word boundaries hold
    # ("rlq pain, us protocol" must boundary-match "rlq pain").
    s = re.sub(r"[,.?!;:()\[\]]", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip().lower()


def levenshtein_bounded(a, b, max_dist):
    if abs(len(a) - len(b)) > max_dist:
        return max_dist + 1
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        best = cur[0]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur[j] = min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
            best = min(best, cur[j])
        if best > max_dist:
            return max_dist + 1
        prev = cur
    return prev[-1]


# Anatomic abbreviation pairs for the lexical hybrid (mirrors app.js)
ABBR_PAIRS = [
    ("llq", "left lower quadrant"), ("rlq", "right lower quadrant"),
    ("luq", "left upper quadrant"), ("ruq", "right upper quadrant"),
    ("mi", "myocardial infarction"), ("pe", "pulmonary embolism"),
    ("dvt", "deep vein thrombosis"), ("sah", "subarachnoid hemorrhage"),
    ("sdh", "subdural hematoma"), ("gca", "giant cell arteritis"),
    ("ich", "intracerebral hemorrhage"), ("ms", "multiple sclerosis"),
    ("ra", "rheumatoid arthritis"), ("oa", "osteoarthritis"),
    ("ibd", "inflammatory bowel disease"), ("hcc", "hepatocellular carcinoma"),
    ("rcc", "renal cell carcinoma"),
    ("copd", "chronic obstructive pulmonary disease"),
    ("als", "amyotrophic lateral sclerosis"),
    ("fuo", "fever of unknown origin"),
]


# ---------- pipeline stage 1: summary card findMatch ----------
def summary_card_match(cards, query):
    nq = query.strip().lower()
    if len(nq) < 2:
        return None
    qwords = set(nq.split())
    # Priority 1: exact
    for c in cards:
        if c["topic"].lower() == nq:
            return ("exact", c)
    # Priority 2/3: substring + word-level
    best = None
    best_score = 0
    best_kind = None
    for c in cards:
        topic = c["topic"].lower()
        display = (c.get("display_name") or c["topic"]).lower()
        sc_count = c.get("scenario_count", 0)
        if topic in nq:
            sc = len(topic) * 2 + sc_count
            if sc > best_score:
                best_score, best, best_kind = sc, c, "substring"
        if display != topic and display in nq:
            sc = len(display) * 2 + sc_count
            if sc > best_score:
                best_score, best, best_kind = sc, c, "substring"
        topic_words = topic.split()
        if topic_words and all(tw in qwords for tw in topic_words):
            sc = len(topic) * 1.5 + sc_count
            if sc > best_score:
                best_score, best, best_kind = sc, c, "word"
    return (best_kind, best) if best else None


# ---------- pipeline stage 2-3: concept lookup ----------
def concept_lookup(norm_map, query, exact_only=False, return_match=False):
    q = norm(query)
    cid = norm_map.get(q)
    if cid:
        if return_match:
            return cid, "exact", q
        return cid, "exact"
    if exact_only:
        if return_match:
            return None, None, None
        return None, None
    if len(q) <= 3:
        if return_match:
            return None, None, None
        return None, None
    # Word-boundary substring (mirrors js/app.js exactly)
    tokens = q.split()
    best_len = -1
    cid = None
    best_syn = None
    for syn, c in norm_map.items():
        if len(syn) <= 3:
            matches = syn in tokens
        elif syn in q:
            i = q.index(syn)
            before = i == 0 or q[i - 1] == " "
            after_idx = i + len(syn)
            after = after_idx == len(q) or q[after_idx] == " "
            matches = before and after
        elif len(tokens) >= 2 and len(syn.split()) <= len(tokens) + 1 and q in syn:
            # Reverse direction: query is a whole-word piece of a longer synonym.
            # Disabled for single-token queries and capped to +1 word so a bare
            # generic word ("pain", "mass") can't latch onto a scenario-sentence
            # synonym (mirrors js/concept-matcher.js matchConcept).
            i = syn.index(q)
            before = i == 0 or syn[i - 1] == " "
            after_idx = i + len(q)
            after = after_idx == len(syn) or syn[after_idx] == " "
            matches = before and after
        else:
            matches = False
        if matches and len(syn) > best_len:
            cid = c
            best_len = len(syn)
            best_syn = syn
    if cid:
        if return_match:
            return cid, "substring", best_syn
        return cid, "substring"
    # Levenshtein
    if len(q) >= 6:
        best = None
        for term, c in norm_map.items():
            if abs(len(term) - len(q)) > 1:
                continue
            d = levenshtein_bounded(q, term, 1)
            if 0 < d <= 1:
                if best is None or len(term) < len(best[0]):
                    best = (term, c)
        if best:
            if return_match:
                return best[1], f"levenshtein({best[0]})", best[0]
            return best[1], f"levenshtein({best[0]})"
    if return_match:
        return None, None, None
    return None, None


# ---------- pipeline stage 4a: Lunr scenario search (NEW PRIMARY) ----------
def lunr_search(lunr_idx, lunr_docs, query, max_hits=8):
    """Search the pre-built Lunr index for query. Returns list of {id, name, region, score}."""
    if lunr_idx is None:
        return []
    q = (query or "").strip()
    if len(q) < 2:
        return []
    try:
        results = lunr_idx.search(q)
    except Exception:
        try:
            cleaned = re.sub(r"[^a-zA-Z0-9\s]", " ", q).strip()
            results = lunr_idx.search(cleaned) if cleaned else []
        except Exception:
            return []
    if not results:
        try:
            # Fuzzy retry
            tokens = [t for t in re.split(r"\s+", q) if len(t) >= 3]
            fuzzy = " ".join(f"{t}~1" for t in tokens)
            if fuzzy:
                results = lunr_idx.search(fuzzy)
        except Exception:
            pass
    out = []
    for r in results[:max_hits]:
        doc = lunr_docs.get(r["ref"])
        if doc:
            out.append({
                "id": str(doc.get("acr_topic_id", "")),
                "name": doc.get("name", ""),
                "region": doc.get("body_region", ""),
                "score": r["score"],
            })
    return out


# ---------- pipeline stage 4b: legacy scenario-name + keyword search (fallback) ----------
def scenario_name_search(scenario_index, query, max_hits=8):
    q = norm(query)
    if len(q) < 3:
        return []
    tokens = [t for t in q.split() if len(t) >= 2]
    if not tokens:
        return []
    hits = []
    for entry in scenario_index:
        name = entry["normName"]
        kw = entry.get("normKeywords", "")
        if not name and not kw:
            continue
        score = 0
        if q in name:
            if name == q:
                score = 100
            elif name.startswith(q + " ") or name.startswith(q + ","):
                score = 80
            else:
                score = 60
        else:
            matched = sum(1 for t in tokens if t in name)
            if matched == len(tokens):
                score = 30 + matched * 5
            elif matched >= max(1, len(tokens) - 1) and len(tokens) >= 2:
                score = 15 + matched * 4
        if score < 30 and kw:
            if q in kw:
                i = kw.index(q)
                before = i == 0 or kw[i - 1] == " "
                after_idx = i + len(q)
                after = after_idx == len(kw) or kw[after_idx] == " "
                if before and after:
                    score = max(score, 45)
            elif len(tokens) >= 2:
                matched = sum(1 for t in tokens if t in kw)
                if matched == len(tokens):
                    score = max(score, 25 + matched * 3)
        if score > 0:
            score -= min(15, len(name) // 20)
            hits.append({**entry, "score": score})
    hits.sort(key=lambda h: (-h["score"], len(h["name"])))
    return hits[:max_hits]


# ---------- pipeline stage 5: embedding search ----------
def fp16_to_fp32_array(buf, n, dim):
    """Read FP16 binary into a Float32 numpy array."""
    fp16 = np.frombuffer(buf, dtype=np.float16, count=n * dim)
    return fp16.astype(np.float32).reshape(n, dim)


def lexical_score(qNorm, qTokens, s):
    name = s.get("normName", "")
    kw = s.get("normKeywords", "")
    w = 0
    for t in qTokens:
        if t in name:
            w += 2
        elif kw and t in kw:
            w += 1
    for abbr, full in ABBR_PAIRS:
        in_hit = (abbr in name) or (full in name) or (kw and (abbr in kw or full in kw))
        in_q = (abbr in qNorm) or (full in qNorm)
        if in_q and in_hit:
            w += 3
    return np.tanh(w / 4.0)


# ---------- main pipeline ----------
def simulate(query, sc_cards, norm_map, scenario_index, student=None,
              corpus_emb=None, corpus_ids=None, scenario_by_id=None,
              ce_concept_for_card=None, lunr_idx=None, lunr_docs=None,
              scn_to_concept=None):
    """Run a single query through the full pipeline. Returns:
        {stage, hit_concept_id, top_scenarios: [(id, name, region)]}
    The top concept (if any) is what the user would land on.
    """
    trimmed = query.strip()
    if not trimmed:
        return {"stage": "empty", "hit_concept_id": None, "top_scenarios": []}

    # 1. Summary card findMatch
    card_match = summary_card_match(sc_cards, trimmed)

    # 2. If card matched only by substring/word, see if there's a better concept match.
    #    Priority order:
    #      a. EXACT concept synonym -> override (always wins)
    #      b. SUBSTRING concept synonym strictly longer than card topic AND multi-word
    #         -> override (catches "ivdu back pain fever" > "back pain")
    if card_match and card_match[0] != "exact":
        exact_cid = concept_lookup(norm_map, trimmed, exact_only=True)[0]
        if exact_cid:
            return {"stage": "exact_concept_override", "hit_concept_id": exact_cid,
                    "top_scenarios": [], "from_card_kind": card_match[0]}
        # Substring concept override - only if the matched synonym is longer
        # and contains more words than the card topic (avoid weak overrides).
        sub_cid, sub_how, sub_syn = concept_lookup(norm_map, trimmed, return_match=True)
        if sub_cid and sub_syn and sub_how == "substring":
            card_topic = card_match[1]["topic"].lower()
            if (len(sub_syn) > len(card_topic) + 2
                    and len(sub_syn.split()) >= max(2, len(card_topic.split()) + 1)):
                return {"stage": "substring_concept_override",
                        "hit_concept_id": sub_cid, "top_scenarios": [],
                        "from_card_kind": card_match[0]}

    if card_match:
        # Map summary card topic to concept
        topic = card_match[1]["topic"]
        cid = ce_concept_for_card.get(topic.lower())
        return {"stage": f"summary_card:{card_match[0]}", "hit_concept_id": cid,
                "summary_card": card_match[1]["topic"], "top_scenarios": []}

    # 3. Concept lookup (full)
    cid, how = concept_lookup(norm_map, trimmed)
    if cid:
        return {"stage": f"concept:{how}", "hit_concept_id": cid, "top_scenarios": []}

    # 4. Legacy scenario name + keyword search (high-precision but narrow recall)
    name_hits = scenario_name_search(scenario_index, trimmed, max_hits=10)
    if name_hits:
        # Map top scenario to a concept if possible (via concept_index reverse map)
        top_concepts = []
        for h in name_hits[:5]:
            cid_for_scn = h.get("concept_id")
            if cid_for_scn:
                top_concepts.append(cid_for_scn)
        hit_cid = top_concepts[0] if top_concepts else None
        return {
            "stage": "scenario_name",
            "hit_concept_id": hit_cid,
            "top_scenarios": [(h["id"], h["name"], h["region"]) for h in name_hits[:5]],
        }

    # 5. Embedding search + lexical hybrid (LAMBDA = 0.05) - fires before Lunr
    #    because student v3 has medical-domain priors that beat raw TF-IDF.
    if student is None or corpus_emb is None:
        # Try Lunr as a last resort if no embedding model
        if lunr_idx is not None:
            lunr_hits = lunr_search(lunr_idx, lunr_docs, trimmed, max_hits=10)
            if lunr_hits:
                top_concepts = []
                for h in lunr_hits[:5]:
                    cs = scn_to_concept.get(str(h["id"]), []) if scn_to_concept else []
                    if cs: top_concepts.append(cs[0])
                return {
                    "stage": "lunr",
                    "hit_concept_id": top_concepts[0] if top_concepts else None,
                    "top_scenarios": [(h["id"], h["name"], h["region"]) for h in lunr_hits[:5]],
                    "top_concepts": top_concepts[:5],
                }
        return {"stage": "no_result", "hit_concept_id": None, "top_scenarios": []}
    q_emb = student.encode([trimmed], batch_size=1, show_progress_bar=False,
                            normalize_embeddings=True, convert_to_numpy=True).astype(np.float32)[0]
    sims = corpus_emb @ q_emb  # (N,)
    top30_idx = np.argpartition(-sims, 30)[:30]
    top30 = sorted([(int(i), float(sims[int(i)])) for i in top30_idx], key=lambda x: -x[1])

    # Hybrid: emb_score + LAMBDA * lex_score (mirrors app.js)
    qN = norm(trimmed)
    qTok = [t for t in qN.split() if len(t) >= 3]
    LAMBDA = 0.05
    reranked = []
    for emb_idx, emb_score in top30:
        sid = corpus_ids[emb_idx]
        s = scenario_by_id.get(sid)
        if not s:
            continue
        lex = lexical_score(qN, qTok, s)
        reranked.append((sid, emb_score + LAMBDA * lex, s))
    reranked.sort(key=lambda x: -x[1])
    top_scenarios = []
    top_concepts_emb = []
    for sid, sc, s in reranked[:10]:
        top_scenarios.append((sid, s["name"], s["region"]))
        cid_for = s.get("concept_id")
        if cid_for:
            top_concepts_emb.append(cid_for)
    hit_cid = top_concepts_emb[0] if top_concepts_emb else None
    # If embedding returned no concept-mapped scenario, try Lunr as last resort
    if not hit_cid and not top_scenarios and lunr_idx is not None:
        lunr_hits = lunr_search(lunr_idx, lunr_docs, trimmed, max_hits=10)
        if lunr_hits:
            lunr_concepts = []
            for h in lunr_hits[:5]:
                cs = scn_to_concept.get(str(h["id"]), []) if scn_to_concept else []
                if cs: lunr_concepts.append(cs[0])
            return {
                "stage": "lunr",
                "hit_concept_id": lunr_concepts[0] if lunr_concepts else None,
                "top_scenarios": [(h["id"], h["name"], h["region"]) for h in lunr_hits[:5]],
                "top_concepts": lunr_concepts[:5],
            }
    return {
        "stage": "embedding",
        "hit_concept_id": hit_cid,
        "top_scenarios": top_scenarios[:5],
        "top_concepts": top_concepts_emb[:5],
    }


def main():
    print("Loading data...")
    queries = json.load(open(QUERIES, encoding="utf-8"))
    print(f"  queries: {len(queries)}")

    cards_data = json.load(open(SUMMARY_CARDS, encoding="utf-8"))
    sc_cards = cards_data["cards"]
    print(f"  summary cards: {len(sc_cards)}")

    ci = json.load(open(CONCEPT_INDEX, encoding="utf-8"))
    concepts = ci.get("concepts", {})
    syn_to_concept = ci.get("synonym_to_concept", {})
    norm_map = {norm(k): v for k, v in syn_to_concept.items() if norm(k)}
    print(f"  concepts: {len(concepts)}, synonyms: {len(norm_map)}")

    # Build reverse: scenario_id -> set of concept_ids
    scn_to_concept = defaultdict(list)
    for cid, c in concepts.items():
        for m in c.get("scenario_mappings", []):
            scn_to_concept[str(m["scenario_id"])].append(cid)

    # Map summary card topics to concepts. Topic strings often match a synonym
    # directly (e.g. "stroke" -> stroke concept).
    card_to_concept = {}
    for c in sc_cards:
        topic = c["topic"].lower()
        cid = norm_map.get(norm(topic))
        if not cid:
            # try display_name
            dn = (c.get("display_name") or "").lower()
            cid = norm_map.get(norm(dn))
        if cid:
            card_to_concept[topic] = cid

    # Scenario index for name+keyword search
    sn_data = json.load(open(SCENARIO_NAMES, encoding="utf-8"))
    scenario_index = []
    scenario_by_id = {}
    for s in sn_data.get("scenarios", []):
        sid = str(s["id"])
        kw_list = s.get("keywords", [])
        entry = {
            "id": sid,
            "name": s["name"],
            "region": s["region"],
            "normName": norm(s["name"]),
            "normKeywords": norm(" ".join(kw_list)) if kw_list else "",
            "keywords": kw_list,
            "concept_id": scn_to_concept.get(sid, [None])[0],
        }
        scenario_index.append(entry)
        if sid not in scenario_by_id:
            scenario_by_id[sid] = entry
    print(f"  scenarios: {len(scenario_index)} (uniq ids: {len(scenario_by_id)})")

    # Load Lunr index
    print(f"  loading Lunr scenario index...")
    try:
        from lunr.index import Index as LunrIndex
        lunr_data = json.load(open(LUNR_INDEX, encoding="utf-8"))
        lunr_idx = LunrIndex.load(lunr_data["index"])
        lunr_docs = lunr_data["documents"]
        print(f"    loaded {len(lunr_docs)} Lunr docs")
    except Exception as e:
        print(f"    Lunr load failed ({e}); skipping Lunr stage")
        lunr_idx = None
        lunr_docs = None

    # Load student v3 + scenario embeddings
    print(f"  loading student v3 + scenario embeddings...")
    from sentence_transformers import SentenceTransformer
    student = SentenceTransformer(str(STUDENT))
    emb_meta = json.load(open(EMB_IDS, encoding="utf-8"))
    dim = emb_meta["dim"]
    corpus_ids = emb_meta["ids"]
    n = len(corpus_ids)
    with open(EMB_BIN, "rb") as f:
        buf = f.read()
    corpus_emb = fp16_to_fp32_array(buf, n, dim)
    print(f"  scenario_embeddings: {corpus_emb.shape}")

    # Run pipeline on every query
    print(f"\nRunning {len(queries)} queries...")
    t0 = time.time()
    results = []
    for i, q in enumerate(queries):
        r = simulate(q["query"], sc_cards, norm_map, scenario_index,
                     student=student, corpus_emb=corpus_emb, corpus_ids=corpus_ids,
                     scenario_by_id=scenario_by_id, ce_concept_for_card=card_to_concept,
                     lunr_idx=lunr_idx, lunr_docs=lunr_docs, scn_to_concept=scn_to_concept)
        r["query"] = q["query"]
        r["persona"] = q["persona"]
        r["expected"] = q["expected_concept_id"]
        # Top-1 hit?
        r["hit_top1"] = (r.get("hit_concept_id") == q["expected_concept_id"])
        # Top-5 hit?
        top5_concepts = []
        if r.get("hit_concept_id"):
            top5_concepts.append(r["hit_concept_id"])
        if r.get("top_concepts"):
            for c in r["top_concepts"]:
                if c and c not in top5_concepts:
                    top5_concepts.append(c)
                if len(top5_concepts) >= 5:
                    break
        # Also extract concept hits from top_scenarios
        if len(top5_concepts) < 5:
            for sid, _, _ in r.get("top_scenarios", []) or []:
                cs = scn_to_concept.get(str(sid), [])
                for c in cs:
                    if c not in top5_concepts:
                        top5_concepts.append(c)
                    if len(top5_concepts) >= 5:
                        break
        r["top5_concepts"] = top5_concepts
        r["hit_top5"] = q["expected_concept_id"] in top5_concepts
        results.append(r)
        if (i + 1) % 100 == 0:
            print(f"  {i+1}/{len(queries)} ({(time.time()-t0)/(i+1)*1000:.0f} ms/q)")
    print(f"  done in {time.time()-t0:.1f}s")

    out = AVGHF / "data" / "eval" / "synthetic_eval_results.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\nResults saved -> {out}")

    # ---- Aggregate metrics ----
    in_tax = [r for r in results if r["expected"] != "OUT_OF_TAXONOMY"]
    oot = [r for r in results if r["expected"] == "OUT_OF_TAXONOMY"]
    print(f"\nIn-taxonomy queries: {len(in_tax)}")
    print(f"  Top-1 accuracy: {sum(r['hit_top1'] for r in in_tax)/len(in_tax):.3f}")
    print(f"  Top-5 accuracy: {sum(r['hit_top5'] for r in in_tax)/len(in_tax):.3f}")
    print(f"OUT_OF_TAXONOMY queries: {len(oot)}")
    found_any = sum(1 for r in oot if r.get("hit_concept_id") is not None or r.get("top_scenarios"))
    print(f"  Got some result: {found_any}/{len(oot)} ({100*found_any/max(1,len(oot)):.0f}%)")

    # By persona
    print("\n--- Top-1 accuracy by persona ---")
    by_persona = defaultdict(list)
    for r in in_tax:
        by_persona[r["persona"]].append(r["hit_top1"])
    rows = sorted(by_persona.items(), key=lambda x: -sum(x[1])/max(1,len(x[1])))
    for p, hits in rows:
        n = len(hits)
        acc = sum(hits) / n
        print(f"  {p:30}  n={n:>4}  top1={acc:.3f}")

    # By expected concept
    print("\n--- Top-1 accuracy by expected concept (sorted by failure rate, min n=5) ---")
    by_concept = defaultdict(list)
    for r in in_tax:
        by_concept[r["expected"]].append(r["hit_top1"])
    rows = [(c, hits) for c, hits in by_concept.items() if len(hits) >= 5]
    rows.sort(key=lambda x: sum(x[1])/max(1,len(x[1])))
    for c, hits in rows[:25]:
        n = len(hits)
        acc = sum(hits) / n
        print(f"  {c:30}  n={n:>3}  top1={acc:.3f}")

    # By stage
    print("\n--- Pipeline stage hit distribution ---")
    stages = Counter(r.get("stage", "unknown") for r in results)
    for s, n in stages.most_common():
        print(f"  {s:30} {n}")

    # Failure modes - top-1 misses where stage hit something
    print("\n--- Top-1 failures by stage (queries where pipeline returned a wrong concept) ---")
    by_stage_failures = defaultdict(int)
    for r in in_tax:
        if not r["hit_top1"] and r.get("hit_concept_id"):
            by_stage_failures[r["stage"]] += 1
    for s, n in sorted(by_stage_failures.items(), key=lambda x: -x[1]):
        print(f"  {s:30} {n}")

    print(f"\nFull results -> {out}")


if __name__ == "__main__":
    main()
