# Static Page Generation Design

**Date:** 2026-03-23
**Project:** Radex (avg-hounsfield.github.io / protocolinfo.com)
**Goal:** Generate static, crawlable HTML pages to improve search engine visibility

---

## Overview

Radex is currently a single-page application (SPA). All content is rendered via JavaScript, making it largely invisible to search engines. This spec defines a static page generation system that produces fully-rendered HTML pages from existing JSON data files, targeting specific high-value search queries without modifying the existing SPA.

---

## Pages to Generate

### 1. Protocol Pages (~72 pages)
**URL pattern:** `/protocols/{slug}/index.html`
**Example:** `/protocols/brain-mri-without-contrast/`

One page per entry in `data/protocols.json`.

**Content:**
- `<h1>`: canonical procedure name (e.g. "MRI Brain Without Contrast")
- Breadcrumb: `Radex > {Region} > {Protocol Name}`
- Indications paragraph (from `indications` field)
- Sequences table: sequence name, pre/post contrast flag (from `sequences` array)
- Top 5 related clinical scenarios (from `scenario_matches`, sorted by `relevance_score` desc)
- Prominent CTA: "Open in Radex" button linking to main app with protocol pre-selected

**SEO elements:**
- `<title>`: `{Canonical Procedure} Protocol - Sequences & Indications | Radex`
- `<meta description>`: First 155 chars of `indications` field
- `<link rel="canonical">`: `https://www.protocolinfo.com/protocols/{slug}/`
- JSON-LD: `MedicalWebPage` with `specialty: Radiology`, `medicalAudience: Clinician`

**Slug generation:**
Derived from `canonical_procedure` field: lowercase, strip punctuation, replace spaces with hyphens.
Example: "MRI Brain W/O Contrast" -> `brain-mri-without-contrast`

---

### 2. Regional Landing Pages (8 pages)
**URL pattern:** `/regions/{region}/index.html`
**Regions:** neuro, spine, msk, abdomen, chest, vascular, breast, peds

One page per body region.

**Content:**
- `<h1>`: `{Region} Imaging Appropriateness`
- Intro paragraph: what ACR appropriateness criteria covers for this region
- Topic cards grid: all summary cards for this region from `data/search/summary_cards.json`
  - Each card shows: topic name, card type badge, primary recommendation, consensus %
  - Each card links into the main app with that topic pre-searched
- Protocols list: all protocols for this region with links to their static pages
- CTA: "Search all {Region} scenarios in Radex"

**SEO elements:**
- `<title>`: `{Region} Imaging - ACR Appropriateness Criteria | Radex`
- `<meta description>`: "ACR Appropriateness Criteria for {region} imaging. Evidence-based recommendations for {N} clinical scenarios including {2-3 topic examples}."
- `<link rel="canonical">`: `https://www.protocolinfo.com/regions/{region}/`
- JSON-LD: `MedicalWebPage` with `specialty: Radiology`
- Internal links to all protocol pages in that region (supports crawl depth)

---

### 3. About Page (1 page)
**URL:** `/about/index.html`

Static version of the existing About modal (currently a JS modal - invisible to Google).

**Content:**
- `<h1>`: "About Radex"
- What Radex is: AI-powered ACR Appropriateness Criteria reference tool
- Key stats: 3,200+ scenarios, 72+ MRI protocols, 83% ACR scenario coverage
- How it works: client-side ML inference, privacy-preserving, offline-capable PWA
- Educational disclaimer
- "Also by CoreGRAI" section: brief description of GRAi with link to coregrai.com
- Contact: contact@coregrai.com
- CTA: "Open Radex"

**SEO elements:**
- `<title>`: `About Radex - ACR Imaging Appropriateness Tool | CoreGRAI`
- `<meta description>`: "Radex is a free, browser-based ACR Appropriateness Criteria reference tool built for radiology residents. 3,200+ clinical scenarios, 72+ MRI protocols."
- JSON-LD: `Organization` (CoreGRAI) + `WebApplication` (Radex)

---

## Generator Script

**Location:** `tools/generate_static_pages.py`
**Run from repo root:** `python tools/generate_static_pages.py`
**No new dependencies** - pure Python stdlib + existing JSON data files

### Inputs
| File | Used for |
|------|----------|
| `data/protocols.json` | Protocol pages content |
| `data/search/summary_cards.json` | Regional landing page topic cards |
| `data/regions/*.json` | Regional scenario counts and topic examples |

### Outputs
| Path | Description |
|------|-------------|
| `protocols/{slug}/index.html` | One file per protocol |
| `regions/{region}/index.html` | One file per body region |
| `about/index.html` | About page |
| `sitemap.xml` | Regenerated with all new URLs appended |

### Script Structure
```
generate_static_pages.py
  load_data()              - reads all JSON inputs
  slugify(text)            - canonical_procedure -> url-safe slug
  render_protocol(p)       - returns HTML string for one protocol
  render_region(region)    - returns HTML string for one region page
  render_about()           - returns HTML string for about page
  write_file(path, html)   - creates directory and writes file
  update_sitemap(urls)     - appends new URLs to sitemap.xml
  main()                   - orchestrates all of the above
```

### Shared Layout
All pages share a common HTML wrapper:
- `<head>`: links to `/css/main.css?v={version}`, page-specific meta tags, JSON-LD
- Header: Radex brand + "Back to Radex" nav link
- `<main>`: page-specific content
- Footer: same footer as main app (About, Terms, ACR Guidelines, RadsReview, CoreGRAI links)

Visual design matches the main app (same dark theme, purple accents, CSS variables).

---

## Sitemap Integration

After generation, `sitemap.xml` is regenerated to include all static pages:
```xml
<url>
  <loc>https://www.protocolinfo.com/protocols/brain-mri-without-contrast/</loc>
  <lastmod>2026-03-23</lastmod>
  <changefreq>monthly</changefreq>
  <priority>0.7</priority>
</url>
```

Priority weights:
- Home (`/`): 1.0
- Regional pages: 0.8
- Protocol pages: 0.7
- About page: 0.5
- Privacy policy: 0.3

---

## Internal Linking Strategy

Strong internal linking is key to SEO. Each page type links to others:

- **Regional pages** link to all protocol pages in that region
- **Protocol pages** breadcrumb links back to their regional page
- **About page** links to all 8 regional pages
- **Main app footer** already links to CoreGRAI (coregrai.com)
- **All static pages** link back to the main app via CTA

This creates a shallow, well-connected site structure that Google crawls efficiently.

---

## Deep Links to Main App

Static pages drive users back to the interactive app via URL parameters:

| Target | URL format |
|--------|-----------|
| Protocol pre-selected | `/#protocols?name={protocol_name}` |
| Topic pre-searched | `/#search?q={topic}` |
| Region pre-selected | `/#regions?r={region}` |

The main app's JS reads these hash params on load to restore state.

**Note:** If the main app does not currently support these hash params, the CTA falls back to linking to `/#protocols` or `/#search` without pre-selection. Deep linking can be added as a follow-on task.

---

## Out of Scope

- Individual scenario pages (3,200+ pages - better handled with a future dedicated effort)
- Server-side rendering or build pipeline changes
- Changes to the existing SPA or its JavaScript
- Any new Python dependencies

---

## Success Criteria

- All ~82 pages render valid HTML with full content visible in page source
- Each page has a unique, keyword-rich `<title>` and `<meta description>`
- `sitemap.xml` lists all generated URLs
- Pages are visually consistent with the main Radex app
- Script runs in under 10 seconds from cold start
- Re-running the script is safe (overwrites existing files cleanly)
