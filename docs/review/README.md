# GRAi Imaging Guide: clinician review packet

GRAi Imaging Guide (https://www.protocolinfo.com, formerly Radex) is a free site that summarizes the ACR Appropriateness Criteria for clinicians. Its search turns what a clinician types ("worst headache of my life", "FOOSH", "PE in pregnancy") into ACR wording and picks the ACR topic or scenario to show.

That translation is full of clinical judgments: which phrase means which ACR scenario, which words mean the same thing, which presentation should raise which question, which body region a topic belongs to, and what answer each test search must give. **All of them were written by AI models from the ACR data. None has been checked by a clinician.** This packet lists them so a radiologist can check them quickly.

## What is in it

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

See SUMMARY.md for the counts behind these files.

**Start with 00_high_stakes.csv** (about 294 minutes). It holds every inference question the site may ask, the clarify questions, the expected answers and phrase readings for time-critical presentations (stroke, subarachnoid hemorrhage, cauda equina, acute aortic syndrome, pulmonary embolism, torsion, ectopic pregnancy, appendicitis in children and in pregnancy, major trauma, child abuse, cord compression, sepsis), and every alias or rule that changes which body region or which population (child, pregnancy, sex, immune status) is answered. If you only have half an hour, this is the file.

The area files (area_*.csv) then hold the rest of the searches and phrase readings, one file per body area. 30_word_rules.csv holds the general word rules, and 40_topic_regions.csv the body region of every ACR topic (about 6 seconds a row). 90_flagged_by_generator.csv lists what the script that built this packet suspects is wrong, with its reasons: these are machine-flagged guesses, not clinical verdicts, and are there to point your attention, not to replace it.

## How to read a row

- **the item, in plain words**: the judgment itself, for example "Phrase "foosh" read as "wrist trauma fall"".
- **what it says the site should do**: for a test search, the answer the AI decided it must give; for a rule, what the rule does.
- **what the site does now**: the site's actual answer today, from running the search. "Opens the whole ACR topic" means the full topic page is shown; "Lists scenarios" names the first ones; "Asks which topic" is a choice screen; "No direct answer" is a recovery screen.
- **top ACR category and studies now**: the top-rated ACR category and studies of the first answer, so you can see what a clinician would be told to order.
- **site matches the expectation?**: for test searches, whether today's answer meets the expectation. A "no" is either a site bug or a wrong expectation; your verdict on the expectation decides which.
- **population read from the search**: the age, pregnancy or sex the site read from the words.
- **technical**: the raw value, for the developer. You can ignore it.

Rows that say "N searches with the same expected answer" share one verdict: mark "wrong" and say which search is the exception if only one is.

## How to record a verdict

1. Save a copy of the file with your initials in the name (for example 00_high_stakes_JS.csv). The files are rebuilt by a script, so edits to the originals can be overwritten.
2. In **verdict (ok / wrong / unsure)** type one of: ok, wrong, unsure.
3. In **correct answer or comment** say what it should be when it is wrong (the right ACR topic or scenario, the missing topic, the population it should be limited to), or what makes you unsure. A few words is enough.
4. Leave a row blank if you did not look at it; blank is read as "not reviewed", never as ok.
5. Keep the id column unchanged: it ties your verdict to the judgment. Ids stay the same when the packet is rebuilt, as long as the judgment itself has not changed.

## What happens to your verdicts

- **ok**: the judgment is marked clinician reviewed (with your initials and the date) and kept. Reviewed gold searches become hard tests that may never regress.
- **wrong**: the developer changes the alias, rule or expected answer to what you wrote, adds a test search for it, and re-runs every test; the changed row comes back to you in the next packet marked as changed.
- **unsure**: the row is kept as not reviewed and goes to a second reviewer.
- Nothing you mark is applied automatically: a developer applies each one, and the site's notes ("not yet clinician reviewed") are removed only for rows marked ok.

## Rebuilding

`node tools/build_review_packet.mjs` from the repository root rebuilds every file from the current code and data. It reads the tests and the search code and changes neither.
