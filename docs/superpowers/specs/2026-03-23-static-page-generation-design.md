# Static Page Generation Design

**Date:** 2026-03-23
**Project:** Radex (avg-hounsfield.github.io / protocolinfo.com)
**Goal:** Generate static, crawlable HTML pages to improve search engine visibility

---

## Overview

Radex is currently a single-page application (SPA). All content is rendered via JavaScript, making it largely invisible to search engines. This spec defines a static page generation system that produces fully-rendered HTML pages from existing JSON data files, targeting specific high-value search queries without modifying the existing SPA.

**Canonical base URL for all pages:** `https://www.protocolinfo.com`

---

## Constants and Lookups (defined in script)

### Region display names (for breadcrumbs and headings)
```python
REGION_DISPLAY = {
    "neuro":    "Neuro",
    "spine":    "Spine",
    "msk":      "MSK",
    "abdomen":  "Abdomen",
    "chest":    "Chest",
    "vascular": "Vascular",
    "breast":   "Breast",
    "peds":     "Pediatric",
}
```

### Region intro paragraphs (static copy for landing pages)
```python
REGION_INTRO = {
    "neuro":    "ACR Appropriateness Criteria for neurological imaging covers clinical scenarios "
                "involving the brain, cranial nerves, and intracranial structures, including stroke, "
                "headache, seizure, dementia, and traumatic brain injury.",
    "spine":    "ACR Appropriateness Criteria for spine imaging addresses clinical presentations "
                "involving the cervical, thoracic, and lumbar spine, including back pain, radiculopathy, "
                "myelopathy, trauma, and suspected infection or malignancy.",
    "msk":      "ACR Appropriateness Criteria for musculoskeletal imaging guides evaluation of "
                "joints, bones, and soft tissues across the body, covering acute injury, chronic pain, "
                "suspected fracture, infection, and bone or soft tissue tumors.",
    "abdomen":  "ACR Appropriateness Criteria for abdominal and pelvic imaging covers clinical "
                "presentations including acute abdominal pain, liver and pancreatic masses, renal "
                "pathology, bowel obstruction, and gastrointestinal bleeding.",
    "chest":    "ACR Appropriateness Criteria for chest imaging addresses suspected pulmonary "
                "embolism, lung nodule evaluation, chest pain, suspected pneumonia, pleural effusion, "
                "and lung cancer screening.",
    "vascular": "ACR Appropriateness Criteria for vascular imaging covers suspected aortic aneurysm "
                "and dissection, carotid stenosis, deep vein thrombosis, and peripheral arterial disease.",
    "breast":   "ACR Appropriateness Criteria for breast imaging guides evaluation of breast cancer "
                "screening, palpable breast mass, nipple discharge, and breast pain.",
    "peds":     "ACR Appropriateness Criteria for pediatric imaging addresses imaging evaluation "
                "in children, including suspected child abuse and pediatric-specific clinical scenarios.",
}
```

Note: `data/regions/other.json` exists but is excluded from generated pages because no summary cards map to an `other` region. Cards with `region` values of `neck`, `pelvis`, or any value not in `REGION_DISPLAY` are silently excluded from all regional pages - this is intentional.

---

## Pages to Generate

### 1. Protocol Pages
**URL pattern:** `/protocols/{slug}/index.html`
**Count:** One per entry in `data/protocols.json` (72 entries, resolving to 63-72 unique slugs after collision resolution)

**Content:**

- `<h1>`: Display name (see display name rule below)
- Breadcrumb: `Radex > {REGION_DISPLAY[body_region]} > {display name}`
- Indications paragraph (from `indications` field, rendered as plain text)
- Sequences table with columns "Sequence" and "Contrast": iterate `sequences` in `sort_order` ascending; render `is_post_contrast` as `0` = "Pre-contrast", `1` = "Post-contrast"
- Top 5 entries from `scenario_matches` sorted by `relevance_score` descending, showing `scenario_name`
- CTA button: "Open in Radex" -> `https://www.protocolinfo.com/#protocols`

**Display name rule:**
Use `display_name` field (not `name`). Apply `.title()` for rendering (converts "BRAIN" -> "Brain", "SEIZURE" -> "Seizure"). Append `display_name.title()` in parentheses if `display_name.lower()` is not a substring of `canonical_procedure.lower()`.
- Example: `canonical_procedure="MRI Brain W/O Contrast"`, `display_name="BRAIN"` -> "Brain" IS a substring -> h1 = "Mri Brain W/O Contrast" (title-cased canonical_procedure only)
- Example: `canonical_procedure="MRI Brain W/O Contrast"`, `display_name="SEIZURE"` -> "Seizure" is NOT a substring -> h1 = "Mri Brain W/O Contrast (Seizure)"

Note: `canonical_procedure` should also be title-cased for display. Abbreviations like "W/O" and "MRI" will become "W/O" and "Mri" respectively - this is acceptable.

**SEO elements:**
- `<title>`: `{h1 text} Protocol - Sequences & Indications | Radex`
- `<meta description>`: First 155 chars of `indications` value (plain text, no HTML tags)
- `<link rel="canonical">`: `https://www.protocolinfo.com/protocols/{slug}/`
- JSON-LD:
```json
{
  "@context": "https://schema.org",
  "@type": "MedicalWebPage",
  "name": "{h1 text} Protocol",
  "url": "https://www.protocolinfo.com/protocols/{slug}/",
  "specialty": {"@type": "MedicalSpecialty", "name": "Radiology"},
  "medicalAudience": {"@type": "MedicalAudience", "audienceType": "Clinician"},
  "isPartOf": {"@type": "WebSite", "name": "Radex", "url": "https://www.protocolinfo.com"}
}
```

**Slug generation algorithm** (applied to `canonical_procedure`):
1. Lowercase the string
2. Replace `w/o` with `wo`, `w/` with `w`
3. Replace `/` with nothing, `&` with `and`
4. Replace all remaining non-alphanumeric characters (except spaces) with empty string
5. Replace spaces with hyphens
6. Collapse consecutive hyphens to one
7. Strip leading/trailing hyphens

Examples:
- "MRI Brain W/O Contrast" -> `mri-brain-wo-contrast`
- "MRI Brain W/ & W/O Contrast" -> `mri-brain-w-and-wo-contrast`
- "CT Abdomen & Pelvis W/ Contrast" -> `ct-abdomen-and-pelvis-w-contrast`

**Collision resolution** (handled in `make_unique_slugs(protocols)`):
Process protocols in order. If a generated slug already exists in the output map:
1. Append `-{slugified(display_name)}` as discriminator (e.g. `mri-brain-wo-contrast-seizure`)
2. If the discriminated slug still collides, append `-2`, `-3`, etc.

`slugified(display_name)` uses the same algorithm above applied to `display_name`.

---

### 2. Regional Landing Pages (8 pages)
**URL pattern:** `/regions/{region}/index.html`
**Regions:** the 8 keys of `REGION_DISPLAY` (excludes `other`)

**Content:**
- `<h1>`: `{REGION_DISPLAY[region]} Imaging Appropriateness`
- Intro paragraph: `REGION_INTRO[region]`
- **Topic cards section:** all cards from `summary_cards['cards']` where `card['region'] == region`
  - If zero cards match, omit this section entirely
  - Each card shows: `display_name` (title), card type badge, primary recommendation name, consensus %
  - Each card links to `https://www.protocolinfo.com/#search` (no deep params)
- **Protocols section:** all protocols from `data/protocols.json` where `body_region == region`
  - If zero protocols match (e.g. spine, vascular, peds), omit this section entirely
  - Each protocol links to `/protocols/{slug}/`
- CTA button: "Search {REGION_DISPLAY[region]} Scenarios in Radex" -> `https://www.protocolinfo.com/#search`

**Meta description:**
Scenario count from `data['count']` in `data/regions/{region}.json`. Topic examples from first 2-3 `topic` values in that region's filtered card list (or omit "including..." clause if zero cards).
Template: `"ACR Appropriateness Criteria for {REGION_DISPLAY[region].lower()} imaging. Evidence-based recommendations for {count} clinical scenarios including {t1}, {t2}, and {t3}."`

**SEO elements:**
- `<title>`: `{REGION_DISPLAY[region]} Imaging - ACR Appropriateness Criteria | Radex`
- `<meta description>`: as above
- `<link rel="canonical">`: `https://www.protocolinfo.com/regions/{region}/`
- JSON-LD:
```json
{
  "@context": "https://schema.org",
  "@type": "MedicalWebPage",
  "name": "{REGION_DISPLAY[region]} Imaging Appropriateness",
  "url": "https://www.protocolinfo.com/regions/{region}/",
  "specialty": {"@type": "MedicalSpecialty", "name": "Radiology"},
  "isPartOf": {"@type": "WebSite", "name": "Radex", "url": "https://www.protocolinfo.com"}
}
```

---

### 3. About Page (1 page)
**URL:** `/about/index.html`

Static version of the About modal. Source content: extract from the `id="aboutModal"` div in `index.html`, adapting modal-specific markup to standard page markup.

**Content:**
- `<h1>`: "About Radex"
- What Radex is: AI-powered ACR Appropriateness Criteria reference tool built by CoreGRAI
- Key stats: 3,200+ clinical scenarios, 72+ MRI protocols, 83% ACR scenario coverage
- How it works: client-side ML inference, privacy-preserving, offline-capable via PWA
- Educational disclaimer (from existing modal text)
- "Also by CoreGRAI" section: "GRAi is an AI-powered radiology clinical reference and decision support platform." Link to `https://coregrai.com`
- Contact: `contact@coregrai.com`
- CTA button: "Open Radex" -> `https://www.protocolinfo.com/`

**SEO elements:**
- `<title>`: `About Radex - ACR Imaging Appropriateness Tool | CoreGRAI`
- `<meta description>`: "Radex is a free, browser-based ACR Appropriateness Criteria reference tool built for radiology residents. 3,200+ clinical scenarios, 72+ MRI protocols."
- `<link rel="canonical">`: `https://www.protocolinfo.com/about/`
- JSON-LD:
```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "name": "Radex",
      "url": "https://www.protocolinfo.com",
      "applicationCategory": "MedicalApplication",
      "isAccessibleForFree": true,
      "author": {"@type": "Organization", "name": "CoreGRAI", "url": "https://coregrai.com"}
    },
    {
      "@type": "Organization",
      "name": "CoreGRAI",
      "url": "https://coregrai.com",
      "email": "contact@coregrai.com"
    }
  ]
}
```

---

## Generator Script

**Location:** `tools/generate_static_pages.py`
**Run from repo root:** `python tools/generate_static_pages.py`
**No new Python dependencies** - pure stdlib (json, os, re, pathlib, datetime)

### Inputs

| File | Access pattern |
|------|---------------|
| `data/protocols.json` | Top-level JSON array |
| `data/search/summary_cards.json` | Cards at `data['cards']` (list of dicts) |
| `data/regions/neuro.json` ... `peds.json` | Scenario count at `data['count']` |

### Outputs

| Path | Count |
|------|-------|
| `protocols/{slug}/index.html` | 63-72 |
| `regions/{region}/index.html` | 8 |
| `about/index.html` | 1 |
| `sitemap.xml` | 1 (full regeneration) |

### Script Structure

```
generate_static_pages.py

  REGION_DISPLAY = { ... }   # module-level constant
  REGION_INTRO = { ... }     # module-level constant

  slugify(text)
    - Applies slug algorithm to any string
    - Returns lowercase hyphenated string

  make_unique_slugs(protocols)
    - Input: list of protocol dicts
    - Returns: dict mapping protocol index -> unique slug
    - Applies collision resolution

  load_data()
    - Reads protocols.json, summary_cards.json, regions/*.json
    - Returns dict: { protocols, cards, region_counts }

  shared_head(title, description, canonical, jsonld_dict)
    - Returns <head>...</head> HTML string
    - Includes /css/main.css?v=20260323a, viewport, charset

  shared_header()
    - Returns <header> with Radex brand and "Back to Radex" link -> "/"

  shared_footer()
    - Returns <footer> identical to index.html footer markup

  render_protocol(protocol, slug)
    - Returns complete HTML page string for one protocol

  render_region(region, cards, protocols, scenario_count)
    - Returns complete HTML page string for one region

  render_about()
    - Returns complete HTML page string for about page

  write_file(rel_path, html)
    - Creates parent directories if needed
    - Always overwrites existing file

  build_sitemap(protocol_slugs)
    - Returns complete sitemap XML string
    - Includes all static pages plus root and privacy-policy

  main()
    - Calls load_data()
    - Calls make_unique_slugs()
    - Iterates protocols -> render_protocol -> write_file
    - Iterates regions -> render_region -> write_file
    - Calls render_about -> write_file
    - Calls build_sitemap -> write_file for sitemap.xml
    - Prints count of files written
```

### Shared Layout

All pages use identical structural HTML:
- `<!DOCTYPE html><html lang="en">` with dark-mode CSS variables via existing `main.css`
- `<head>`: charset, viewport, title, meta description, canonical, theme-color `#9B5DE5`, manifest, main.css link, JSON-LD script block
- `<header class="header">`: `.header-brand` with "Radex" text + `.header-nav` with single "Back to Radex" link to `https://www.protocolinfo.com/`
- `<main class="main">`: page content wrapped in `<section class="anatomy-section">`
- `<footer class="site-footer">`: identical markup to `index.html` footer (About, Terms, ACR Guidelines, RadsReview, CoreGRAI links + copyright)

Note: About and Terms in the static footer are plain `<a href="...">` links rather than JS modal buttons since there is no JS loaded on static pages.

---

## Sitemap

Full regeneration each run overwrites `sitemap.xml`. Includes:

| URL | Priority | Changefreq |
|-----|----------|------------|
| `/` | 1.0 | weekly |
| `/regions/*/` | 0.8 | monthly |
| `/protocols/*/` | 0.7 | monthly |
| `/about/` | 0.5 | monthly |
| `/privacy-policy.html` | 0.3 | yearly |

`lastmod` set to script run date (ISO format `YYYY-MM-DD`).

---

## Internal Linking

| Page | Links to |
|------|---------|
| Regional pages | All protocol pages in that region (via protocols list) |
| Protocol pages | Parent regional page (via breadcrumb) |
| About page | All 8 regional pages |
| All static pages | Main app via CTA ("Open in Radex" / "Back to Radex") |

---

## Deep Links to Main App

The existing `app.js` does not implement hash routing or URLSearchParams. All CTAs use static entry points only:

| CTA | URL |
|-----|-----|
| "Open in Radex" (protocol pages) | `https://www.protocolinfo.com/#protocols` |
| "Search scenarios" (region pages) | `https://www.protocolinfo.com/#search` |
| "Open Radex" (about page) | `https://www.protocolinfo.com/` |

Parameterized deep links are explicitly out of scope.

---

## Out of Scope

- Individual scenario pages (3,200+)
- Server-side rendering or build pipeline changes
- Changes to the existing SPA JavaScript
- New Python dependencies
- Parameterized deep links
- `data/regions/other.json` - no page generated for `other` region

---

## Success Criteria

- All generated pages contain full content in HTML source (no JS rendering required)
- Each protocol page has a unique slug and unique `<title>`
- Each page has a non-empty `<meta description>` under 160 chars
- `sitemap.xml` includes all generated URLs (8 region + ~63-72 protocol + about + root + privacy)
- Pages use the same `main.css` and match Radex visual design (dark theme, purple accent)
- Regional pages with zero protocols render without an empty protocols section
- Regional pages with zero matching cards render without an empty cards section
- Script runs under 10 seconds from cold start
- Re-running the script is always safe: output files are overwritten cleanly
