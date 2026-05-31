#!/usr/bin/env python3
"""Audit the concept synonym map for "force-mapped distinct entity" mismaps.

Background: during the synonym-expansion rounds the search top-1 number was lifted
by attaching query-phrases for a *distinct* clinical entity onto a nearby concept
(e.g. "syncope when to image head" -> headache). The matching eval gold label was
set to the same wrong concept, so the metric rewarded the mistake instead of
catching it. This script finds other instances of that pattern.

Heuristic (read-only, no edits):
  - Build a "signature term -> owning concept(s)" map from each concept's short
    (1-2 word) synonyms plus its display_name. These are the entities the taxonomy
    can name.
  - For each `synonym -> concept K`, look for a signature term T that appears as a
    whole word/phrase inside the synonym, where T is owned by some concept other
    than K, AND none of K's own signature terms appear in the synonym. That means
    the synonym reads as being about T's concept, not K -> candidate mismap.
  - Rank by signal strength: foreign entity at the head of the phrase, query-phrasing
    markers ("when to image", "w/u", "workup", "ddx for", "inpatient", ...), and
    whether the foreign term is owned by exactly one (unambiguous) other concept.
  - Cross-check the eval gold: if a gold query equals the synonym and its
    expected_concept_id == K, the gold is propagating the same error -> flag it.

Output: data/eval/synonym_mismap_candidates.json (ranked) + a printed summary.
This is a *candidate* report for human review, not an auto-fixer.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

AVGHF = Path(__file__).resolve().parent.parent
CONCEPT_INDEX = AVGHF / "data" / "search" / "concept_index.json"
QUERIES = AVGHF / "data" / "eval" / "synthetic_queries_850.json"
OUT = AVGHF / "data" / "eval" / "synonym_mismap_candidates.json"

# Query-phrasing markers: synonyms built from how a user *asks*, which is where the
# force-mapping happened (real medical terms rarely contain these).
PHRASING_MARKERS = [
    "when to image", "w/u", "workup", "work up", "ddx for", "ddx", "inpatient",
    "imaging", "which protocol", "what protocol", "vs ", " vs", "r/o", "rule out",
    "best test", "next step", "follow up", "follow-up", "screening for",
]

# Stopwords that are never a meaningful "lead entity".
LEAD_STOP = {
    "mri", "ct", "cta", "ctp", "us", "mr", "mra", "mrv", "xray", "x-ray", "imaging",
    "for", "the", "a", "an", "with", "without", "and", "or", "of", "in", "new",
    "acute", "chronic", "suspected", "initial", "when", "to", "image", "best",
    "next", "which", "what", "protocol", "screening", "follow", "rule", "out",
    "ddx", "workup", "work", "inpatient", "recurrent", "first", "test",
}


def norm(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"[-_/]", " ", s)
    s = re.sub(r"[,.?!;:()]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def whole_phrase_in(term: str, text: str) -> bool:
    """True if `term` appears as a whole word / phrase in `text` (both normalized)."""
    return re.search(r"(?:^|\s)" + re.escape(term) + r"(?:\s|$)", text) is not None


def lead_index(term: str, text: str) -> int:
    m = re.search(r"(?:^|\s)" + re.escape(term) + r"(?:\s|$)", text)
    return m.start() if m else 10**9


def main():
    ci = json.loads(CONCEPT_INDEX.read_text(encoding="utf-8"))
    concepts = ci["concepts"]
    syn2concept = ci["synonym_to_concept"]

    # 1) signature term -> set(concept_ids). Use concept_id, display_name pieces,
    #    and short (1-2 word) synonyms as the entity signature for each concept.
    sig_owners = defaultdict(set)
    concept_sigs = defaultdict(set)
    for cid, c in concepts.items():
        sigs = set()
        sigs.add(norm(cid.replace("_", " ")))
        # display_name often "A / B" or "A/B" -> split on separators
        for part in re.split(r"[/,]", c.get("display_name", "")):
            n = norm(part)
            if n:
                sigs.add(n)
        for syn in c.get("synonyms", []):
            n = norm(syn)
            wc = len(n.split())
            # short synonyms are the disease-name signatures; skip 3+ char abbrevs
            # handled specially at runtime, and skip phrasing-y synonyms.
            if 1 <= wc <= 2 and len(n) > 3 and not any(m in n for m in PHRASING_MARKERS):
                sigs.add(n)
        # drop pure stopword signatures
        sigs = {s for s in sigs if s and s not in LEAD_STOP and len(s) > 3}
        concept_sigs[cid] = sigs
        for s in sigs:
            sig_owners[s].add(cid)

    # 2) gold map: normalized query -> expected_concept_id
    gold = {}
    if QUERIES.exists():
        for q in json.loads(QUERIES.read_text(encoding="utf-8")):
            gold[norm(q.get("query", ""))] = q.get("expected_concept_id")

    # 3) scan every synonym for the foreign-entity pattern
    candidates = []
    for syn, cid in syn2concept.items():
        nsyn = norm(syn)
        own_sigs = concept_sigs.get(cid, set())
        # does the synonym contain any of the mapped concept's own signatures?
        own_present = any(whole_phrase_in(s, nsyn) for s in own_sigs)
        if own_present:
            continue  # synonym is at least partly about its own concept -> fine

        # find foreign signatures present in the synonym
        foreign = []
        for term, owners in sig_owners.items():
            if cid in owners:
                continue
            if whole_phrase_in(term, nsyn):
                foreign.append((term, owners))
        if not foreign:
            continue

        # pick the strongest foreign term: prefer one owned by exactly one concept,
        # then the earliest-occurring (lead) term, then the longest.
        foreign.sort(key=lambda t: (len(t[1]), lead_index(t[0], nsyn), -len(t[0])))
        term, owners = foreign[0]
        owners = sorted(owners)

        # Region comparison. The syncope bug crossed anatomic regions
        # (cardiovascular "other" -> neuro headache). Same-region "mismaps" are
        # almost always *intended* red-flag routing (symptom refined into a
        # specific diagnosis: "back pain with fever" -> spine_infection), so the
        # cross-region cases are the high-value ones to actually fix.
        cur_region = concepts.get(cid, {}).get("body_region")
        suggested_regions = sorted({concepts.get(o, {}).get("body_region") for o in owners})
        cross_region = cur_region not in suggested_regions

        # scoring
        score = 0
        is_lead = lead_index(term, nsyn) == 0
        unambiguous = len(owners) == 1
        has_phrasing = any(m in nsyn for m in PHRASING_MARKERS)
        if is_lead:
            score += 3
        if unambiguous:
            score += 2
        if has_phrasing:
            score += 2
        # multi-word synonym that is dominated by the foreign entity
        if len(nsyn.split()) >= 3:
            score += 1
        # cross-region is the genuine syncope-style signal; same-region is usually
        # legitimate symptom->diagnosis refinement and should rank far lower.
        if cross_region:
            score += 5

        gold_affected = gold.get(nsyn) == cid

        candidates.append({
            "synonym": syn,
            "current_concept": cid,
            "current_region": cur_region,
            "foreign_entity": term,
            "suggested_concept": owners[0] if unambiguous else owners,
            "suggested_region": suggested_regions[0] if len(suggested_regions) == 1 else suggested_regions,
            "foreign_owned_by": owners,
            "cross_region": cross_region,
            "lead_entity_is_foreign": is_lead,
            "has_query_phrasing": has_phrasing,
            "gold_label_also_affected": gold_affected,
            "score": score,
        })

    candidates.sort(key=lambda c: (-c["score"], c["current_concept"], c["synonym"]))

    OUT.write_text(json.dumps({
        "generated_from": str(CONCEPT_INDEX.name),
        "total_synonyms": len(syn2concept),
        "candidate_count": len(candidates),
        "note": "Heuristic candidates for human review; not all are real mismaps.",
        "candidates": candidates,
    }, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Scanned {len(syn2concept)} synonyms across {len(concepts)} concepts.")
    print(f"Flagged {len(candidates)} mismap candidates -> {OUT}")

    xr = [c for c in candidates if c["cross_region"]]
    print(f"\n--- CROSS-REGION mismaps (the genuine syncope-style signal): {len(xr)} ---")
    for c in xr:
        gold = " [GOLD AFFECTED]" if c["gold_label_also_affected"] else ""
        print(f"  [{c['score']}] {c['synonym']!r}  {c['current_concept']}({c['current_region']}) "
              f"-> {c['suggested_concept']}({c['suggested_region']}) "
              f"via '{c['foreign_entity']}'{gold}")

    same = [c for c in candidates if not c["cross_region"]]
    print(f"\n--- Same-region candidates: {len(same)} (usually intended "
          f"symptom->diagnosis refinement; review only if suspicious) ---")


if __name__ == "__main__":
    main()
