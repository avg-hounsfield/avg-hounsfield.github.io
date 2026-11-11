# Review packet: summary

Built from commit 0a533eb by `node tools/build_review_packet.mjs`. Every judgment below was written by AI models from the ACR data; none has been reviewed by a clinician.

| File | What it holds | Rows | Est. minutes |
|---|---|---:|---:|
| 00_high_stakes.csv | High stakes: inference questions, clarify entries, time-critical presentations, region or population changes | 509 | 294 |
| area_neuro.csv | Searches and phrase readings: Neuro, head and neck | 311 | 192 |
| area_spine.csv | Searches and phrase readings: Spine | 110 | 62 |
| area_chest.csv | Searches and phrase readings: Chest and heart | 225 | 143 |
| area_vascular.csv | Searches and phrase readings: Vascular | 118 | 67 |
| area_abdomen.csv | Searches and phrase readings: Abdomen, pelvis, obstetrics | 533 | 356 |
| area_msk.csv | Searches and phrase readings: Musculoskeletal | 319 | 184 |
| area_breast.csv | Searches and phrase readings: Breast | 75 | 40 |
| area_other.csv | Searches and phrase readings: Trauma, abuse, sepsis, oncology, ICU | 37 | 21 |
| area_general.csv | Searches and phrase readings: General (no single area) | 95 | 60 |
| 30_word_rules.csv | Word rules: same-meaning words, opposites, what a ruled-out word also rules out, quadrants, suggestion-check equivalences, negative tests | 253 | 38 |
| 40_topic_regions.csv | Which body region each ACR topic is filed under | 263 | 26 |
| 90_flagged_by_generator.csv | MACHINE-FLAGGED: what the generator suspects is wrong, with its reasoning | 31 | 20 |
| **Total** | | **2879** | **1503** |

Estimates: 45 s per search row (+8 s per extra search in a grouped row), 45 s per inference question, 15 s per phrase row (+3 s per extra phrasing), 6 to 15 s per word rule, 6 s per topic region, 40 s per machine flag.

## What was collected

- 1766 expected search answers (clinical gold, red-team gold, recovery red team, guard and inference gold), merged into 1453 rows: identical searches are merged, and searches that share one specific expected answer share one row.
- 1224 hand-written aliases, 38 context-dependent aliases, 12 whole-search aliases and 2 clarify entries.
- 465 mined aliases, of which 465 are in force (0 are overridden by a hand-written alias for the same phrase and are not listed). Aliases with the same target share one row.
- 45 inference questions, 179 same-meaning words, 28 opposite pairs, 38 ruled-out implications, 2 negation-kin entries, 9 diagnosis-to-quadrant entries, 74 suggestion-check equivalences.
- 263 ACR topics and the body region each is filed under.
- 45 patterns could not be put into plain words (listed in untranslated_patterns.txt; the affected rows say so).
