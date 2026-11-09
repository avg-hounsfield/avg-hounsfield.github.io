# Rebuilding the site data

Everything the site shows about scenarios comes from raw captures of the ACR
portal. To refresh after a new capture:

```
python tools/build_scenarios.py          # set ACR_RAW if the captures moved
python tools/generate_static_pages.py
python tools/rebrand_coregrai.py --apply  # the generator still emits old brand strings
node --test tests/*.mjs
python tools/test_generate_static_pages.py
```

`python tools/build_scenarios.py --check` reports counts without writing files.

`generate_static_pages.py` also writes one page per ACR topic under `topics/`, the
`topics/` index, and the sitemap. These are the pages search engines index; the
app's own results at `/?q=` are not indexable.

Then bump `CACHE_NAME` in `sw.js`, `CURRENT_SW_VERSION` in `index.html`, and the
`?v=` values on the data fetches, or returning visitors keep the old data.

Topics are assigned to body regions by `REGION_RULES` in `tools/build_scenarios.py`.
New ACR topics that match no rule land in `other` (shown as General).

The semantic fallback (`data/search/scenario_embeddings_v3.bin`) is built from the
model in the separate radiology-ai-assistant repo with
`tools/build_scenario_embeddings.py`. Scenarios added since that build are found by
the ranker, but not by the semantic fallback, until it is rebuilt.

`node tools/audit_matching.mjs` stress-tests matching. Add every bad match to
`tests/clinical-gold.json` before fixing it.
