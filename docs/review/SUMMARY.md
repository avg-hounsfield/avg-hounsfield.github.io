# Review packet: summary

Built on commit 162caa9 by `node tools/build_review_packet.mjs`. Every judgment below was written by AI models from the ACR data; none has been reviewed by a clinician.

| File | What it holds | Rows | Est. minutes |
|---|---|---:|---:|
| 00_high_stakes.csv | High stakes, core (start here): inference questions, clarify entries, time-critical phrase readings and clinical-gold searches, every rule that changes body region or population | 213 | 76 |
| 01_high_stakes_searches.csv | High stakes, second pass: the red-team and generated expected answers for the same time-critical presentations | 209 | 127 |
| area_neuro.csv | Searches and phrase readings: Neuro, head and neck | 334 | 156 |
| area_spine.csv | Searches and phrase readings: Spine | 115 | 50 |
| area_chest.csv | Searches and phrase readings: Chest and heart | 234 | 114 |
| area_vascular.csv | Searches and phrase readings: Vascular | 124 | 54 |
| area_abdomen.csv | Searches and phrase readings: Abdomen, pelvis, obstetrics | 559 | 283 |
| area_msk.csv | Searches and phrase readings: Musculoskeletal | 334 | 148 |
| area_breast.csv | Searches and phrase readings: Breast | 75 | 31 |
| area_other.csv | Searches and phrase readings: Trauma, abuse, sepsis, oncology, ICU | 37 | 17 |
| area_general.csv | Searches and phrase readings: General (no single area) | 99 | 47 |
| 30_word_rules.csv | Word rules: same-meaning words, opposites, what a ruled-out word also rules out, quadrants, suggestion-check equivalences, negative tests | 262 | 40 |
| 40_topic_regions.csv | Which body region each ACR topic is filed under | 263 | 26 |
| 90_flagged_by_generator.csv | MACHINE-FLAGGED: what the generator suspects is wrong, with its reasoning | 30 | 20 |
| **Total** | | **2888** | **1188** |

Estimates: 35 s per search row (+6 s per extra search in a grouped row), 30 s per inference question, 12 s per phrase row (+2 s per extra phrasing), 6 to 15 s per word rule, 6 s per topic region, 40 s per machine flag.

## What was collected

- 1773 expected search answers (clinical gold, red-team gold, recovery red team, guard and inference gold), merged into 1459 rows: identical searches are merged, and searches that share one specific expected answer share one row.
- 1224 hand-written aliases, 38 context-dependent aliases, 12 whole-search aliases and 6 clarify entries.
- 465 mined aliases, of which 465 are in force (0 are overridden by a hand-written alias for the same phrase and are not listed). Aliases with the same target share one row.
- 45 inference questions, 179 same-meaning words, 28 opposite pairs, 38 ruled-out implications, 2 negation-kin entries, 9 diagnosis-to-quadrant entries, 74 suggestion-check equivalences.
- 263 ACR topics and the body region each is filed under.
- 0 patterns could not be put into plain words (listed in untranslated_patterns.txt; the affected rows say so).
