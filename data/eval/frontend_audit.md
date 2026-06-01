Producing the report directly from the verified findings (no further investigation needed — severities below reflect the adversarial `corrected_severity` values).

# Radex Front-End / Routing Audit — Prioritized Findings

## Executive Summary
The dominant theme is **search wrong-routing**: the regional and global concept-matching paths use loose substring/longest-match/fuzzy heuristics that confidently resolve generic single words and typos to unrelated concepts, and the two paths have drifted apart (different normalizers, only the global one hardened). The second theme is **fragile async/offline plumbing**: the service worker's query-string mismatch and never-reset failed-load promises silently break offline and post-error search, while swallowed fetch failures present load errors as empty-but-working pages. The third theme is **keyboard/AT accessibility**: the core scenario cards and accordion are click-only `<div>`s, blocking keyboard users from the primary feature. Biggest risks: silent wrong clinical routing for common queries, offline search that fails despite cached data, and a keyboard-inaccessible core workflow.

---

## Critical
None. (All originally-critical items were adversarially down-rated to High; see below.)

---

## High

**Regional `searchByConcept` substring loop breaks on first match (wrong-routing, non-deterministic)**
`js/search-engine.js:334-342` — Generic words mis-route in-region (e.g. "arthritis"→Back Pain, "mass"→Brain Tumor); winner depends on JSON key order. — Replace break-on-first loop with the global path's word-boundary + longest-match + short-synonym guards; factor into one shared matcher.

**Longest-match heuristic grabs obscure scenario-sentence synonyms for bare common words (both paths)**
`js/app.js:1411-1440` — "pain"→Spinal Tumor, "scan"→Bowel Obstruction, "mass"→Lung Cancer; one confident wrong answer hides the embedding/Lunr fallback. — For single-token queries require an exact/short-synonym match (or synonym word-count within ~1 of query), mirroring the summary-card guard at `app.js:677`.

**Scenario result cards are click-only `<div>`s (no keyboard/role)**
`js/ui.js:288,323,355-369,996` — Keyboard-only and screen-reader users cannot select scenarios, blocking the core imaging-recommendation feature. — Render as `<button>` (or `role="button" tabindex="0"` + Enter/Space keydown).

**Accordion header (expand/collapse variants) is a click-only `<div>`**
`js/ui.js:303-315,342-351` — Keyboard/SR users cannot expand grouped scenario variants; additional clinical scenarios are hidden from them. — Use `<button>` with `aria-expanded` toggling and `aria-controls` on `.accordion-children`.

**Summary cards for "neck"/"pelvis" route to non-existent region files (404 → empty page)**
`js/app.js:837-851,581-612` + `js/data-loader.js:12-37` — "thyroid nodule"/"pelvic pain"/"testicular pain" cards land on a "neck"/"pelvis" page reading "0 scenarios loaded" with no error. — Add the region files or map neck→neuro / pelvis→abdomen|msk; validate region against known set before navigating and add both to `formatRegionName`.

**Service worker caches data/model files without the `?v=` query string → offline reads miss cache**
`sw.js:33-37,142-143` vs `embedding-search.js:42-43`, `lunr-scenario-search.js:16`, `app.js:1356-1357` — Offline, versioned fetches miss the cache and throw; embedding/Lunr/concept search silently degrade to "No quick answer found" despite ~35MB being cached. — Match with `caches.match(req, {ignoreSearch:true})` (or strip/precache the versioned URLs); keep SW version in lockstep with fetch `?v=`.

**Cached failed-load promises never reset → one transient error permanently disables a search stage**
`js/embedding-search.js:84-102`; `js/lunr-scenario-search.js:23-45`; `js/app.js:1350-1399` — A single CDN/model/index hiccup sticks for the whole session; `_ensureGlobalConceptIndex` returning null disables all concept/scenario-name routing until reload. — On rejection/null, reset the memoized promise to null so the next call retries.

---

## Medium

**Regional `_norm` doesn't strip punctuation while global `_conceptNorm` does**
`js/search-engine.js:22-30` (vs `app.js:1317-1328`) — "stroke?"/"back pain." miss the regional exact-synonym fast path and fall into the buggy substring loop, giving inconsistent results vs universal search. — Add the same `[,.?!;:()\[\]]→space` replacement to `_norm`; ideally share one `normalize()`.

**Fuzzy (Levenshtein distance-1) last-resort auto-commits a typo to an arbitrary concept (both paths)**
`js/search-engine.js:344-351`; `js/app.js:1442-1444` — A 6+ char typo renders a full concept page for an unrelated disease with no "did you mean" framing. — Surface distance-1 hits as suggestion chips (as already done at `app.js:716-741`) instead of committing them; or require a ≥4-char shared prefix.

**4-char queries pass the `q.length>3` substring gate, bypassing the abbreviation-safety rationale**
`js/app.js:1410` — Short generic words ("scan","cyst","mass") confidently route to one obscure concept instead of falling through to embedding/Lunr. *(Closely related to the longest-match High item.)* — Gate on word-count/specificity, not raw char length; for single tokens under ~6 chars require exact/short-synonym match.

**Mis-routed regional result is non-empty, so the "did you mean" empty-state never shows**
`js/app.js:1256-1267` (empty-state at `1905-1926`) — Mis-routed queries show a confident wrong concept header + count (e.g. 'N scenarios for "Back Pain"') with no recovery affordance. — Fixing the matching items lets these fall to the empty/keyword state; render loose substring/fuzzy hits with a "closest match" affordance + chips.

**Blocking welcome/disclaimer modal dismissible via Escape without acknowledgment**
`js/app.js:531-537,556-578` (`index.html:1023`) — A first-time user can Escape past the legal/medical disclaimer and use the app for the session with nothing recorded (reappears next load). — Exclude `#welcomeModal` from the global Escape handler (or treat Escape there as acknowledge).

**Welcome (and terms/privacy) modals have no focus-on-open, focus trap, or focus restoration**
`js/app.js:540-545,556-578` (`index.html:1023-1052`) — Keyboard/SR users can Tab into background controls behind the "blocking" `aria-modal` dialog; focus isn't restored on close. — Save `activeElement`, move focus to the primary control, trap Tab/Shift+Tab, restore focus in `hideModal`.

**No deep-link / hash-restore on load → refresh or shared URL always lands on Search**
`js/app.js:173-179,2170-2176` — Refreshing or opening a shared `#protocols`/`#builder` URL silently renders Search while the URL still reads the other view. — In `init()` read `location.hash` and switch view; add a `hashchange`/`popstate` listener that syncs `currentView` + nav state.

**Browser Back/Forward doesn't restore the previous in-page view (state/URL desync)**
`js/app.js:2148-2176` — Pressing Back changes the URL but the visible section, `currentView`, and nav highlight stay stale. — Add a `popstate` listener that re-derives the view from the URL and calls `switchView` without re-pushing history. *(Same missing-`popstate` root cause as the deep-link item — fix together.)*

**Switching Protocols/Builder → Search leaves stale region results/state in the DOM**
`js/app.js:2178-2204,2129-2146` — Prior results, phase chips, and concept header render as if current; toggling a phase chip re-runs the stale `baseQuery`. — On entering/leaving Search, reset transient search state or re-run `executeSearch(baseQuery)`; otherwise clear results and require re-search.

**Search suggestions lack combobox/listbox ARIA semantics**
`index.html:115-122`; `js/app.js:1048,1059-1066,1081-1089` — SR users get no announcement that suggestions appeared or which is highlighted while arrowing; the autocomplete is invisible to AT. — Add `role="combobox"`/`aria-expanded`/`aria-controls`/`aria-activedescendant` on the input, `role="listbox"` on the container, `role="option"`+ids on items, and set `aria-activedescendant` in `updateActiveSuggestion()`.

**Muted body text fails WCAG AA contrast on dark backgrounds**
`css/main.css:16,9-11` — `--text-muted #6b6b70` is ~3.1–3.6:1 (below 4.5:1) on the dark bgs for normal-size metadata (counts, notes, badges), unreadable for low-vision users. — Lighten to ≥~`#8a8a90`, or reserve the current token for large/bold text only.

**`loadRegion` swallows fetch failures and returns empty scenarios → silent "blank but working" search**
`js/data-loader.js:30-37` (`app.js:595-611`) — A region-JSON load failure opens the region normally, reports "0 scenarios loaded", and every search returns nothing with no error/retry. — Rethrow (or return an error sentinel) so `selectRegion` shows "Failed to load data" + retry.

**No request-sequence guard: a slow earlier query can overwrite a newer query's results**
`js/app.js:1160-1267` (`executeSearch`), `644-757` (`handleGlobalSearch`) — After model warmup, a stale earlier query can resolve last and overwrite the DOM with results for older text (flicker). — Capture a monotonically increasing request id and bail before render if it isn't the latest.

**SW version-change handler races cache deletion against `location.reload`**
`index.html:1083-1098` — `caches.delete`/`unregister` aren't awaited before the (legacy `true`) reload, so a deploy update can reload into a partially-cleared cache and serve mixed old/new assets. — `await Promise.all([...])` before reloading; drop the legacy `true` arg.

---

## Low

**Lunr depends on a `window.lunr` global from an unguarded CDN `<script>`**
`js/lunr-scenario-search.js:27-29`; `index.html:1103-1104` — If unpkg is unreachable and uncached, the primary TF-IDF scenario-name ranking is lost and quality silently drops to substring matching (same missing integrity/onerror on jspdf/onnxruntime tags). — Self-host `lunr.min.js` same-origin (or add `onerror` fallback) and ensure reliable SW caching.

**Region "other" reachable by data but has no anatomy button / home-grid entry**
`js/app.js:2991-3004`; `index.html:178-225` — An "other"-region search result lands on a "General" view with no active anatomy-button cue and no way to browse it from the home grid. — Add an "Other/General" `data-region="other"` button (or document it as search-only) and degrade the active-state UI gracefully.

**Mobile nav menu doesn't close on link/outside click; no `aria-controls`**
`index.html:99-103`; `js/app.js:358-369` — The overlay menu stays open over content after navigation and the toggle/menu relationship isn't exposed to AT. — Give `.header-nav` an id + `aria-controls` on the button; close the menu on `.nav-link` click and outside click.

**Dead duplicate `initSearchSuggestions()` would create a second `#searchSuggestions` element**
`js/app.js:2867-2904` — No live bug (never called), but a latent duplicate-id / double-binding hazard if a refactor wires it up. — Remove `initSearchSuggestions`/`showSuggestions`/`hideSuggestions`, or consolidate to one implementation.

---

## Recommended Fix Order
1. **Unify and harden concept matching** — extract one shared matcher (word-boundary + longest-match + short-synonym + punctuation-stripping normalize) used by both global and regional paths; fixes the regional break-on-first loop, the normalizer divergence, the 4-char gate, and the longest-match-grabs-obscure-synonym bug (`search-engine.js:334-342`, `app.js:1410-1440`, `search-engine.js:22-30`).
2. **Stop auto-committing fuzzy/loose matches** — surface distance-1 and loose substring hits as "did you mean" chips with a "closest match" affordance instead of rendering them as definitive results (`search-engine.js:344-351`, `app.js:1442-1444`, `app.js:1256-1267`).
3. **Make keyboard users first-class** — convert `.scenario-card` and `.accordion-header` to buttons with proper roles/`aria-expanded`, and add focus-trap/restore to the blocking modals (`ui.js:288-369`, `ui.js:303-351`, `app.js:540-578`).
4. **Fix offline search** — use `ignoreSearch:true` (or precache versioned URLs) in the SW data handler and keep the version string in lockstep (`sw.js:142-143`).
5. **Reset failed-load promises on rejection/null** so transient model/index/concept failures self-heal without a page reload (`embedding-search.js:84-102`, `lunr-scenario-search.js:23-45`, `app.js:1350-1399`).
6. **Surface load failures honestly** — rethrow from `loadRegion` and validate region keys (incl. neck/pelvis) before navigating, replacing silent empty pages with a real error + retry (`data-loader.js:30-37`, `app.js:581-612,837-851`).
7. **Wire up navigation state** — read `location.hash` on `init()` and add a single `popstate`/`hashchange` listener; reset stale search state when re-entering Search (`app.js:173-179,2148-2204`).
8. **Add a request-sequence id** to `executeSearch`/`handleGlobalSearch` to prevent stale-query DOM overwrites, and fix the Escape-bypass on the welcome disclaimer (`app.js:1160-1267,644-757,531-537`).