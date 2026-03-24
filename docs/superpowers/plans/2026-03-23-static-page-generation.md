# Static Page Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate ~82 static, crawlable HTML pages (protocol pages, regional landing pages, about page) from existing JSON data to improve SEO for radex.app / protocolinfo.com.

**Architecture:** A single Python script (`tools/generate_static_pages.py`) reads existing JSON data files and writes fully-rendered HTML files into the repo. Pure functions are unit-tested with Python's built-in `unittest`. The script is run from the repo root and overwrites output cleanly on each run.

**Tech Stack:** Python 3 stdlib only (json, os, re, pathlib, datetime, unittest). No new dependencies.

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `tools/generate_static_pages.py` | Create | Main generator script |
| `tools/test_generate_static_pages.py` | Create | Unit tests for pure functions |
| `protocols/*/index.html` | Generated | ~63-72 protocol pages |
| `regions/*/index.html` | Generated | 8 regional landing pages |
| `about/index.html` | Generated | About page |
| `sitemap.xml` | Regenerated | Updated with all new URLs |

---

## Task 1: Scaffold script and test `slugify()`

**Files:**
- Create: `tools/generate_static_pages.py`
- Create: `tools/test_generate_static_pages.py`

- [ ] **Step 1: Create the test file with slugify tests**

Create `tools/test_generate_static_pages.py`:

```python
import unittest
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from generate_static_pages import slugify

class TestSlugify(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(slugify("MRI Brain W/O Contrast"), "mri-brain-wo-contrast")

    def test_with_contrast(self):
        self.assertEqual(slugify("MRI Brain W/ Contrast"), "mri-brain-w-contrast")

    def test_ampersand(self):
        self.assertEqual(slugify("CT Abdomen & Pelvis W/ Contrast"), "ct-abdomen-and-pelvis-w-contrast")

    def test_w_and_wo(self):
        self.assertEqual(slugify("MRI Brain W/ & W/O Contrast"), "mri-brain-w-and-wo-contrast")

    def test_already_clean(self):
        self.assertEqual(slugify("MRI Knee"), "mri-knee")

    def test_consecutive_hyphens_collapsed(self):
        result = slugify("MRI  Brain")
        self.assertNotIn("--", result)

    def test_no_leading_trailing_hyphens(self):
        result = slugify("MRI Brain")
        self.assertFalse(result.startswith("-"))
        self.assertFalse(result.endswith("-"))

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Create the script scaffold with `slugify()`**

Create `tools/generate_static_pages.py`:

```python
import json
import os
import re
from pathlib import Path
from datetime import date

BASE_URL = "https://www.protocolinfo.com"
REPO_ROOT = Path(__file__).parent.parent

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

REGION_INTRO = {
    "neuro":    (
        "ACR Appropriateness Criteria for neurological imaging covers clinical scenarios "
        "involving the brain, cranial nerves, and intracranial structures, including stroke, "
        "headache, seizure, dementia, and traumatic brain injury."
    ),
    "spine":    (
        "ACR Appropriateness Criteria for spine imaging addresses clinical presentations "
        "involving the cervical, thoracic, and lumbar spine, including back pain, radiculopathy, "
        "myelopathy, trauma, and suspected infection or malignancy."
    ),
    "msk":      (
        "ACR Appropriateness Criteria for musculoskeletal imaging guides evaluation of "
        "joints, bones, and soft tissues across the body, covering acute injury, chronic pain, "
        "suspected fracture, infection, and bone or soft tissue tumors."
    ),
    "abdomen":  (
        "ACR Appropriateness Criteria for abdominal and pelvic imaging covers clinical "
        "presentations including acute abdominal pain, liver and pancreatic masses, renal "
        "pathology, bowel obstruction, and gastrointestinal bleeding."
    ),
    "chest":    (
        "ACR Appropriateness Criteria for chest imaging addresses suspected pulmonary "
        "embolism, lung nodule evaluation, chest pain, suspected pneumonia, pleural effusion, "
        "and lung cancer screening."
    ),
    "vascular": (
        "ACR Appropriateness Criteria for vascular imaging covers suspected aortic aneurysm "
        "and dissection, carotid stenosis, deep vein thrombosis, and peripheral arterial disease."
    ),
    "breast":   (
        "ACR Appropriateness Criteria for breast imaging guides evaluation of breast cancer "
        "screening, palpable breast mass, nipple discharge, and breast pain."
    ),
    "peds":     (
        "ACR Appropriateness Criteria for pediatric imaging addresses imaging evaluation "
        "in children, including suspected child abuse and pediatric-specific clinical scenarios."
    ),
}

CSS_VERSION = "20260323a"


def slugify(text):
    """Convert a canonical_procedure string to a URL-safe slug."""
    s = text.lower()
    s = s.replace("w/o", "wo")
    s = s.replace("w/", "w")
    s = s.replace("/", "")
    s = s.replace("&", "and")
    s = re.sub(r"[^a-z0-9 ]", "", s)
    s = s.replace(" ", "-")
    s = re.sub(r"-+", "-", s)
    s = s.strip("-")
    return s
```

- [ ] **Step 3: Run the tests - expect PASS**

```bash
python tools/test_generate_static_pages.py -v
```

Expected output: `7 tests ... OK`

- [ ] **Step 4: Commit**

```bash
git add tools/generate_static_pages.py tools/test_generate_static_pages.py
git commit -m "feat: scaffold static page generator with slugify"
```

---

## Task 2: Implement and test `make_unique_slugs()`

**Files:**
- Modify: `tools/generate_static_pages.py`
- Modify: `tools/test_generate_static_pages.py`

- [ ] **Step 1: Add tests for make_unique_slugs**

Append to the test file:

```python
from generate_static_pages import make_unique_slugs

class TestMakeUniqueSlugs(unittest.TestCase):
    def _p(self, canonical, display):
        return {"canonical_procedure": canonical, "display_name": display}

    def test_no_collision(self):
        protocols = [self._p("MRI Brain W/O Contrast", "BRAIN")]
        result = make_unique_slugs(protocols)
        self.assertEqual(result[0], "mri-brain-wo-contrast")

    def test_collision_appends_display_name(self):
        protocols = [
            self._p("MRI Brain W/O Contrast", "BRAIN"),
            self._p("MRI Brain W/O Contrast", "SEIZURE"),
        ]
        result = make_unique_slugs(protocols)
        self.assertEqual(result[0], "mri-brain-wo-contrast")
        self.assertEqual(result[1], "mri-brain-wo-contrast-seizure")

    def test_triple_collision_appends_numeric(self):
        protocols = [
            self._p("MRI Brain W/O Contrast", "BRAIN"),
            self._p("MRI Brain W/O Contrast", "SEIZURE"),
            self._p("MRI Brain W/O Contrast", "SEIZURE"),  # duplicate display_name
        ]
        result = make_unique_slugs(protocols)
        self.assertEqual(result[0], "mri-brain-wo-contrast")
        self.assertEqual(result[1], "mri-brain-wo-contrast-seizure")
        self.assertEqual(result[2], "mri-brain-wo-contrast-seizure-2")

    def test_all_slugs_unique(self):
        protocols = [
            self._p("MRI Brain W/O Contrast", "BRAIN"),
            self._p("MRI Brain W/O Contrast", "SEIZURE"),
            self._p("MRI Knee W/O Contrast", "KNEE"),
        ]
        result = make_unique_slugs(protocols)
        self.assertEqual(len(set(result.values())), 3)
```

- [ ] **Step 2: Run tests - expect FAIL (function not defined)**

```bash
python tools/test_generate_static_pages.py -v
```

Expected: `AttributeError: module has no attribute 'make_unique_slugs'`

- [ ] **Step 3: Implement `make_unique_slugs()`**

Add to `tools/generate_static_pages.py` after `slugify`:

```python
def make_unique_slugs(protocols):
    """
    Returns dict mapping protocol index (int) -> unique slug string.
    Collision resolution: append slugified display_name, then numeric suffix.
    """
    seen = {}      # slug -> first index that claimed it
    result = {}    # index -> slug

    for i, p in enumerate(protocols):
        base = slugify(p["canonical_procedure"])
        candidate = base

        if candidate not in seen:
            seen[candidate] = i
            result[i] = candidate
        else:
            # append discriminator from display_name
            discriminator = slugify(p["display_name"])
            candidate = f"{base}-{discriminator}"
            counter = 2
            while candidate in seen:
                candidate = f"{base}-{discriminator}-{counter}"
                counter += 1
            seen[candidate] = i
            result[i] = candidate

    return result
```

- [ ] **Step 4: Run tests - expect PASS**

```bash
python tools/test_generate_static_pages.py -v
```

Expected: `11 tests ... OK`

- [ ] **Step 5: Commit**

```bash
git add tools/generate_static_pages.py tools/test_generate_static_pages.py
git commit -m "feat: add make_unique_slugs with collision resolution"
```

---

## Task 3: Implement `load_data()` and display name helper

**Files:**
- Modify: `tools/generate_static_pages.py`
- Modify: `tools/test_generate_static_pages.py`

- [ ] **Step 1: Add tests for display name helper**

Append to the test file:

```python
from generate_static_pages import make_display_name

class TestMakeDisplayName(unittest.TestCase):
    def test_display_name_is_substring_no_parens(self):
        # "brain" IS in "mri brain w/o contrast"
        result = make_display_name("MRI Brain W/O Contrast", "BRAIN")
        self.assertNotIn("(", result)
        self.assertIn("Brain", result)

    def test_display_name_not_substring_adds_parens(self):
        # "seizure" is NOT in "mri brain w/o contrast"
        result = make_display_name("MRI Brain W/O Contrast", "SEIZURE")
        self.assertIn("(Seizure)", result)

    def test_title_case_applied(self):
        result = make_display_name("MRI BRAIN W/O CONTRAST", "BRAIN")
        self.assertTrue(result[0].isupper())
        # Not all-caps
        self.assertFalse(result == result.upper())
```

- [ ] **Step 2: Run tests - expect FAIL**

```bash
python tools/test_generate_static_pages.py -v
```

Expected: `AttributeError: module has no attribute 'make_display_name'`

- [ ] **Step 3: Implement `make_display_name()` and `load_data()`**

Add to `tools/generate_static_pages.py`:

```python
def make_display_name(canonical_procedure, display_name):
    """
    Returns title-cased h1 text for a protocol page.
    Appends display_name in parens if it does not appear in canonical_procedure.
    """
    title = canonical_procedure.title()
    if display_name.lower() not in canonical_procedure.lower():
        title = f"{title} ({display_name.title()})"
    return title


def load_data():
    """
    Reads all JSON inputs and returns a dict:
      {
        'protocols': [...],
        'cards': [...],
        'region_counts': { 'neuro': 1234, ... }
      }
    """
    protocols_path = REPO_ROOT / "data" / "protocols.json"
    cards_path = REPO_ROOT / "data" / "search" / "summary_cards.json"

    with open(protocols_path, encoding="utf-8") as f:
        protocols = json.load(f)

    with open(cards_path, encoding="utf-8") as f:
        cards_data = json.load(f)
    cards = cards_data["cards"]

    region_counts = {}
    for region in REGION_DISPLAY:
        region_file = REPO_ROOT / "data" / "regions" / f"{region}.json"
        if region_file.exists():
            with open(region_file, encoding="utf-8") as f:
                region_counts[region] = json.load(f).get("count", 0)
        else:
            region_counts[region] = 0

    return {"protocols": protocols, "cards": cards, "region_counts": region_counts}
```

- [ ] **Step 4: Run tests - expect PASS**

```bash
python tools/test_generate_static_pages.py -v
```

Expected: `14 tests ... OK`

- [ ] **Step 5: Commit**

```bash
git add tools/generate_static_pages.py tools/test_generate_static_pages.py
git commit -m "feat: add load_data and make_display_name helpers"
```

---

## Task 4: Implement shared layout functions

**Files:**
- Modify: `tools/generate_static_pages.py`

No unit tests for HTML rendering functions - verified by running the script and inspecting output.

- [ ] **Step 1: Implement `shared_head()`, `shared_header()`, `shared_footer()`**

Append to `tools/generate_static_pages.py`:

```python
def shared_head(title, description, canonical, jsonld_dict):
    import json as _json
    jsonld_str = _json.dumps(jsonld_dict, indent=2)
    return f"""<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <meta name="robots" content="index, follow">
  <meta name="author" content="CoreGRAI">
  <link rel="canonical" href="{canonical}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{description}">
  <meta property="og:url" content="{canonical}">
  <meta property="og:site_name" content="Radex">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="{title}">
  <meta name="twitter:description" content="{description}">
  <meta name="theme-color" content="#9B5DE5">
  <link rel="stylesheet" href="/css/main.css?v={CSS_VERSION}">
  <link rel="manifest" href="/manifest.json">
  <script type="application/ld+json">
{jsonld_str}
  </script>
</head>"""


def shared_header():
    return """<header class="header" role="banner">
  <div class="header-brand">
    <a href="https://www.protocolinfo.com/" style="text-decoration:none;">
      <span class="brand-text">Radex</span>
    </a>
  </div>
  <nav class="header-nav" role="navigation" aria-label="Main navigation">
    <a href="https://www.protocolinfo.com/" class="nav-link">Back to Radex</a>
  </nav>
</header>"""


def shared_footer():
    return """<footer class="site-footer" role="contentinfo">
  <div class="footer-content">
    <div class="footer-links">
      <a href="/about/" class="footer-link">About</a>
      <span class="footer-divider">|</span>
      <a href="/privacy-policy.html" class="footer-link">Terms</a>
      <span class="footer-divider">|</span>
      <a href="https://www.acr.org/Clinical-Resources/Clinical-Tools-and-Reference/Appropriateness-Criteria" target="_blank" rel="noopener" class="footer-link">ACR Guidelines</a>
      <span class="footer-divider">|</span>
      <a href="https://www.radsreview.net" target="_blank" rel="noopener" class="footer-link">RadsReview</a>
      <span class="footer-divider">|</span>
      <a href="https://coregrai.com" target="_blank" rel="noopener" class="footer-link">CoreGRAI</a>
    </div>
    <div class="footer-promo">
      <a href="https://coregrai.com" target="_blank" rel="noopener" class="footer-promo-card">
        <span class="footer-promo-badge">Also by CoreGRAI</span>
        <div class="footer-promo-text">
          <p class="footer-promo-title">GRAi - Radiology Clinical Reference</p>
          <p class="footer-promo-desc">AI-powered clinical decision support platform for diagnostic radiology</p>
        </div>
        <svg class="footer-promo-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>
    </div>
    <p class="footer-copyright">&copy; 2025 CoreGRAI. Educational use only.</p>
  </div>
</footer>"""


def write_file(rel_path, html):
    """Write html to REPO_ROOT/rel_path, creating parent dirs as needed."""
    full_path = REPO_ROOT / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_text(html, encoding="utf-8")
```

- [ ] **Step 2: Commit**

```bash
git add tools/generate_static_pages.py
git commit -m "feat: add shared layout functions (head, header, footer, write_file)"
```

---

## Task 5: Implement `render_protocol()` and generate protocol pages

**Files:**
- Modify: `tools/generate_static_pages.py`

- [ ] **Step 1: Implement `render_protocol()`**

Append to `tools/generate_static_pages.py`:

```python
def render_protocol(protocol, slug):
    """Returns complete HTML string for one protocol page."""
    region = protocol.get("body_region", "")
    region_label = REGION_DISPLAY.get(region, region.title())
    region_url = f"/regions/{region}/" if region in REGION_DISPLAY else "/"

    display_name = make_display_name(
        protocol.get("canonical_procedure", protocol.get("name", "")),
        protocol.get("display_name", protocol.get("name", ""))
    )

    # Indications - strip any accidental HTML tags, truncate for meta
    indications_raw = protocol.get("indications") or ""
    indications_text = re.sub(r"<[^>]+>", "", indications_raw).strip()
    meta_desc = indications_text[:155] if indications_text else f"{display_name} MRI protocol sequences and clinical indications."

    canonical = f"{BASE_URL}/protocols/{slug}/"

    jsonld = {
        "@context": "https://schema.org",
        "@type": "MedicalWebPage",
        "name": f"{display_name} Protocol",
        "url": canonical,
        "specialty": {"@type": "MedicalSpecialty", "name": "Radiology"},
        "medicalAudience": {"@type": "MedicalAudience", "audienceType": "Clinician"},
        "isPartOf": {"@type": "WebSite", "name": "Radex", "url": BASE_URL}
    }

    title = f"{display_name} Protocol - Sequences & Indications | Radex"
    head = shared_head(title, meta_desc, canonical, jsonld)

    # Breadcrumb
    breadcrumb = f"""<nav class="breadcrumb" aria-label="Breadcrumb" style="font-size:13px;color:var(--text-muted);margin-bottom:1rem;">
  <a href="/" style="color:var(--text-muted)">Radex</a>
  <span style="margin:0 6px">></span>
  <a href="{region_url}" style="color:var(--text-muted)">{region_label}</a>
  <span style="margin:0 6px">></span>
  <span>{display_name}</span>
</nav>"""

    # Sequences table
    sequences = sorted(protocol.get("sequences", []), key=lambda s: s.get("sort_order", 0))
    seq_rows = ""
    for seq in sequences:
        contrast_label = "Post-contrast" if seq.get("is_post_contrast") == 1 else "Pre-contrast"
        seq_rows += f"<tr><td>{seq.get('sequence_name','')}</td><td>{contrast_label}</td></tr>\n"

    seq_table = f"""<table style="width:100%;border-collapse:collapse;margin:1rem 0;">
  <thead>
    <tr style="border-bottom:1px solid var(--border);">
      <th style="text-align:left;padding:8px 4px;color:var(--text-muted);font-size:13px;">Sequence</th>
      <th style="text-align:left;padding:8px 4px;color:var(--text-muted);font-size:13px;">Contrast</th>
    </tr>
  </thead>
  <tbody>
{seq_rows}  </tbody>
</table>""" if sequences else "<p style='color:var(--text-muted);font-size:13px;'>No sequence data available.</p>"

    # Top 5 related scenarios
    matches = sorted(
        protocol.get("scenario_matches", []),
        key=lambda m: m.get("relevance_score", 0),
        reverse=True
    )[:5]
    scenario_items = "".join(
        f"<li style='margin-bottom:6px;font-size:14px;'>{m.get('scenario_name','')}</li>"
        for m in matches
    )
    scenarios_section = f"""<h2 style="margin-top:2rem;">Related Clinical Scenarios</h2>
<ul style="padding-left:1.5rem;">
{scenario_items}
</ul>""" if matches else ""

    body = f"""<div style="max-width:800px;margin:0 auto;padding:2rem 1rem;">
  {breadcrumb}
  <h1>{display_name}</h1>
  <p style="color:var(--text-muted);font-size:14px;">Protocol &bull; {region_label}</p>

  <h2>Indications</h2>
  <p>{indications_text or "See full protocol in Radex."}</p>

  <h2>Sequences</h2>
  {seq_table}

  {scenarios_section}

  <div style="margin-top:2.5rem;">
    <a href="{BASE_URL}/#protocols" class="nav-link active" style="display:inline-block;padding:10px 20px;border-radius:8px;">
      Open in Radex
    </a>
  </div>
</div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
{head}
<body>
  <div class="app">
    {shared_header()}
    <main class="main">
      <section class="anatomy-section">
        {body}
      </section>
    </main>
    {shared_footer()}
  </div>
</body>
</html>"""
```

- [ ] **Step 2: Add `main()` stub and run script to generate protocol pages only**

Append to `tools/generate_static_pages.py`:

```python
def main():
    data = load_data()
    protocols = data["protocols"]
    cards = data["cards"]
    region_counts = data["region_counts"]
    slug_map = make_unique_slugs(protocols)

    count = 0

    # Protocol pages
    for i, protocol in enumerate(protocols):
        slug = slug_map[i]
        html = render_protocol(protocol, slug)
        write_file(Path("protocols") / slug / "index.html", html)
        count += 1

    print(f"Written {count} files so far (protocols only)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the script from repo root**

```bash
python tools/generate_static_pages.py
```

Expected output: `Written 63-72 files so far (protocols only)`

- [ ] **Step 4: Spot-check one generated file**

```bash
python -c "
from pathlib import Path
files = list(Path('protocols').glob('*/index.html'))
print(f'Files: {len(files)}')
print('First:', files[0])
content = files[0].read_text()
print('Has h1:', '<h1>' in content)
print('Has canonical:', 'rel=\"canonical\"' in content)
print('Has ld+json:', 'application/ld+json' in content)
print('Has sequences table:', '<table' in content)
"
```

Expected: all checks print `True`, file count 63-72.

- [ ] **Step 5: Commit**

```bash
git add tools/generate_static_pages.py protocols/
git commit -m "feat: generate protocol static pages"
```

---

## Task 6: Implement `render_region()` and generate regional pages

**Files:**
- Modify: `tools/generate_static_pages.py`

- [ ] **Step 1: Implement `render_region()`**

Add before `main()` in `tools/generate_static_pages.py`:

```python
def render_region(region, cards, region_protocols, slug_map, protocols, scenario_count):
    """Returns complete HTML string for one regional landing page."""
    label = REGION_DISPLAY[region]
    canonical = f"{BASE_URL}/regions/{region}/"

    # Meta description
    topic_examples = [c["topic"] for c in cards[:3]]
    if topic_examples:
        topics_str = ", ".join(topic_examples[:-1]) + f", and {topic_examples[-1]}" if len(topic_examples) > 1 else topic_examples[0]
        meta_desc = (
            f"ACR Appropriateness Criteria for {label.lower()} imaging. "
            f"Evidence-based recommendations for {scenario_count} clinical scenarios "
            f"including {topics_str}."
        )
    else:
        meta_desc = (
            f"ACR Appropriateness Criteria for {label.lower()} imaging. "
            f"Evidence-based recommendations for {scenario_count} clinical scenarios."
        )
    meta_desc = meta_desc[:160]

    jsonld = {
        "@context": "https://schema.org",
        "@type": "MedicalWebPage",
        "name": f"{label} Imaging Appropriateness",
        "url": canonical,
        "specialty": {"@type": "MedicalSpecialty", "name": "Radiology"},
        "isPartOf": {"@type": "WebSite", "name": "Radex", "url": BASE_URL}
    }

    title = f"{label} Imaging - ACR Appropriateness Criteria | Radex"
    head = shared_head(title, meta_desc, canonical, jsonld)

    # Topic cards section
    cards_html = ""
    if cards:
        card_items = ""
        for card in cards:
            primary = card.get("primary_recommendation") or {}
            consensus = primary.get("consensus_pct", 0)
            rec_name = primary.get("name", "Clinical assessment")
            card_type = card.get("card_type", "")
            badge_colors = {
                "STRONG": "#22c55e",
                "CONDITIONAL": "#f59e0b",
                "CLINICAL_FIRST": "#9B5DE5",
                "HIGH_VARIANCE": "#6b7280",
            }
            badge_color = badge_colors.get(card_type, "#6b7280")
            card_items += f"""<div style="border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:0.75rem;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
    <span style="font-weight:600;font-size:14px;">{card.get('display_name','')}</span>
    <span style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:20px;color:{badge_color};border:1px solid {badge_color};">{card_type}</span>
  </div>
  <p style="font-size:13px;color:var(--text-muted);margin:0;">{rec_name} &mdash; {consensus}% consensus</p>
  <a href="{BASE_URL}/#search" style="font-size:12px;color:var(--accent);text-decoration:none;display:inline-block;margin-top:6px;">Search in Radex &rarr;</a>
</div>"""
        cards_html = f"""<h2>Clinical Topics</h2>
<div style="margin:1rem 0;">
{card_items}
</div>"""

    # Protocols section
    protocols_html = ""
    if region_protocols:
        proto_items = ""
        for i, p in enumerate(protocols):
            if p.get("body_region") == region:
                p_slug = slug_map[i]
                p_name = make_display_name(
                    p.get("canonical_procedure", p.get("name", "")),
                    p.get("display_name", p.get("name", ""))
                )
                proto_items += f'<li style="margin-bottom:6px;"><a href="/protocols/{p_slug}/" style="color:var(--accent);text-decoration:none;">{p_name}</a></li>\n'
        protocols_html = f"""<h2>MRI Protocols</h2>
<ul style="padding-left:1.5rem;">
{proto_items}</ul>"""

    # About links on about page
    body = f"""<div style="max-width:800px;margin:0 auto;padding:2rem 1rem;">
  <h1>{label} Imaging Appropriateness</h1>
  <p>{REGION_INTRO[region]}</p>

  {cards_html}

  {protocols_html}

  <div style="margin-top:2rem;">
    <a href="{BASE_URL}/#search" class="nav-link active" style="display:inline-block;padding:10px 20px;border-radius:8px;">
      Search {label} Scenarios in Radex
    </a>
  </div>
</div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
{head}
<body>
  <div class="app">
    {shared_header()}
    <main class="main">
      <section class="anatomy-section">
        {body}
      </section>
    </main>
    {shared_footer()}
  </div>
</body>
</html>"""
```

- [ ] **Step 2: Update `main()` to generate regional pages**

Replace the `main()` function:

```python
def main():
    data = load_data()
    protocols = data["protocols"]
    cards = data["cards"]
    region_counts = data["region_counts"]
    slug_map = make_unique_slugs(protocols)

    count = 0

    # Protocol pages
    for i, protocol in enumerate(protocols):
        slug = slug_map[i]
        html = render_protocol(protocol, slug)
        write_file(Path("protocols") / slug / "index.html", html)
        count += 1

    # Regional pages
    for region in REGION_DISPLAY:
        region_cards = [c for c in cards if c.get("region") == region]
        region_protocols = [p for p in protocols if p.get("body_region") == region]
        scenario_count = region_counts.get(region, 0)
        html = render_region(region, region_cards, region_protocols, slug_map, protocols, scenario_count)
        write_file(Path("regions") / region / "index.html", html)
        count += 1

    print(f"Written {count} files")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run and verify**

```bash
python tools/generate_static_pages.py
```

Expected: `Written 71-80 files` (protocols + 8 regions)

```bash
python -c "
from pathlib import Path
files = list(Path('regions').glob('*/index.html'))
print('Region files:', len(files))
for f in files:
    content = f.read_text()
    print(f.parent.name, '- has h1:', '<h1>' in content, '- has canonical:', 'rel=\"canonical\"' in content)
"
```

Expected: 8 files, all checks True.

- [ ] **Step 4: Commit**

```bash
git add tools/generate_static_pages.py regions/
git commit -m "feat: generate regional landing pages"
```

---

## Task 7: Implement `render_about()` and generate about page

**Files:**
- Modify: `tools/generate_static_pages.py`

- [ ] **Step 1: Implement `render_about()`**

Add before `main()` in `tools/generate_static_pages.py`:

```python
def render_about():
    """Returns complete HTML string for the about page."""
    canonical = f"{BASE_URL}/about/"
    title = "About Radex - ACR Imaging Appropriateness Tool | CoreGRAI"
    meta_desc = (
        "Radex is a free, browser-based ACR Appropriateness Criteria reference tool "
        "built for radiology residents. 3,200+ clinical scenarios, 72+ MRI protocols."
    )

    jsonld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebApplication",
                "name": "Radex",
                "url": BASE_URL,
                "applicationCategory": "MedicalApplication",
                "isAccessibleForFree": True,
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

    head = shared_head(title, meta_desc, canonical, jsonld)

    region_links = "\n".join(
        f'<li><a href="/regions/{r}/" style="color:var(--accent);text-decoration:none;">{label} Imaging</a></li>'
        for r, label in REGION_DISPLAY.items()
    )

    body = f"""<div style="max-width:800px;margin:0 auto;padding:2rem 1rem;">
  <h1>About Radex</h1>

  <p>
    Radex is an educational reference tool designed for radiology residents and medical professionals
    to quickly access imaging appropriateness criteria and MRI protocol information.
  </p>

  <h2>Key Statistics</h2>
  <ul style="padding-left:1.5rem;">
    <li>3,200+ ACR clinical scenarios</li>
    <li>72+ MRI protocols with sequence-level guidance</li>
    <li>83% ACR scenario coverage via quick-answer cards</li>
    <li>Client-side AI inference - fully private, no data sent to servers</li>
    <li>Offline-capable via Progressive Web App (PWA)</li>
  </ul>

  <h2>Data Sources</h2>
  <p>
    <strong>Appropriateness Criteria:</strong> Based on the ACR Appropriateness Criteria,
    evidence-based guidelines developed by the American College of Radiology to assist referring
    physicians and other providers in making the most appropriate imaging decisions.
  </p>
  <p>
    <strong>MRI Protocols:</strong> Sample protocols based on common clinical practice.
    Your institution may have different sequences, parameters, or protocols based on
    scanner hardware, software versions, radiologist preferences, and institutional policies.
  </p>

  <h2>Browse by Region</h2>
  <ul style="padding-left:1.5rem;">
{region_links}
  </ul>

  <h2>Important Notice</h2>
  <p>
    This tool is provided for <strong>educational purposes only</strong>. It is not a substitute
    for clinical judgment, institutional protocols, or direct consultation with radiologists.
    Imaging decisions should always be made in the context of individual patient circumstances.
  </p>

  <h2>Also by CoreGRAI</h2>
  <p>
    <a href="https://coregrai.com" target="_blank" rel="noopener" style="color:var(--accent);">GRAi</a>
    is an AI-powered radiology clinical reference and decision support platform.
  </p>

  <h2>Contact</h2>
  <p>Questions or suggestions? <a href="mailto:contact@coregrai.com" style="color:var(--accent);">contact@coregrai.com</a></p>

  <div style="margin-top:2rem;">
    <a href="{BASE_URL}/" class="nav-link active" style="display:inline-block;padding:10px 20px;border-radius:8px;">
      Open Radex
    </a>
  </div>
</div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
{head}
<body>
  <div class="app">
    {shared_header()}
    <main class="main">
      <section class="anatomy-section">
        {body}
      </section>
    </main>
    {shared_footer()}
  </div>
</body>
</html>"""
```

- [ ] **Step 2: Update `main()` to include the about page**

In `main()`, add after the regional pages loop and before the print statement:

```python
    # About page
    write_file(Path("about") / "index.html", render_about())
    count += 1
```

- [ ] **Step 3: Run and verify**

```bash
python tools/generate_static_pages.py
```

```bash
python -c "
from pathlib import Path
content = Path('about/index.html').read_text()
print('Has h1:', '<h1>About Radex</h1>' in content)
print('Has canonical:', 'about/' in content)
print('Has region links:', '/regions/neuro/' in content)
print('Has CoreGRAI:', 'coregrai.com' in content)
"
```

Expected: all True.

- [ ] **Step 4: Commit**

```bash
git add tools/generate_static_pages.py about/
git commit -m "feat: generate about page"
```

---

## Task 8: Implement `build_sitemap()` and finalize `main()`

**Files:**
- Modify: `tools/generate_static_pages.py`

- [ ] **Step 1: Implement `build_sitemap()`**

Add before `main()` in `tools/generate_static_pages.py`:

```python
def build_sitemap(protocol_slugs):
    """Returns a complete sitemap XML string for all generated pages."""
    today = date.today().isoformat()

    entries = []

    def entry(loc, priority, changefreq):
        entries.append(
            f"  <url>\n"
            f"    <loc>{BASE_URL}{loc}</loc>\n"
            f"    <lastmod>{today}</lastmod>\n"
            f"    <changefreq>{changefreq}</changefreq>\n"
            f"    <priority>{priority}</priority>\n"
            f"  </url>"
        )

    entry("/", "1.0", "weekly")
    entry("/about/", "0.5", "monthly")
    entry("/privacy-policy.html", "0.3", "yearly")

    for region in REGION_DISPLAY:
        entry(f"/regions/{region}/", "0.8", "monthly")

    for slug in protocol_slugs:
        entry(f"/protocols/{slug}/", "0.7", "monthly")

    urls_block = "\n".join(entries)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{urls_block}
</urlset>
"""
```

- [ ] **Step 2: Update `main()` to regenerate sitemap**

Add to `main()` after the about page, before the print statement:

```python
    # Sitemap
    sitemap_xml = build_sitemap(list(slug_map.values()))
    write_file(Path("sitemap.xml"), sitemap_xml)
    count += 1
```

- [ ] **Step 3: Run full script and verify sitemap**

```bash
python tools/generate_static_pages.py
```

```bash
python -c "
from pathlib import Path
content = Path('sitemap.xml').read_text()
protocol_count = content.count('/protocols/')
region_count = content.count('/regions/')
print('Protocol URLs:', protocol_count)
print('Region URLs:', region_count)
print('Has about:', '/about/' in content)
print('Has root:', '<loc>https://www.protocolinfo.com/</loc>' in content)
"
```

Expected: protocol_count 63-72, region_count 8, both about and root True.

- [ ] **Step 4: Run all tests to confirm nothing broke**

```bash
python tools/test_generate_static_pages.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/generate_static_pages.py sitemap.xml
git commit -m "feat: add sitemap generation, complete main() orchestration"
```

---

## Task 9: Commit generated output and push

**Files:**
- Modify: `.gitignore`

The generated pages (`protocols/`, `regions/`, `about/`) can either be committed to the repo (simplest, served by GitHub Pages) or generated in CI. Since there is no CI pipeline, commit them directly.

- [ ] **Step 1: Stage and commit all generated output**

```bash
git add protocols/ regions/ about/ sitemap.xml
git commit -m "chore: add generated static pages and updated sitemap"
```

- [ ] **Step 2: Push to GitHub**

```bash
git push
```

- [ ] **Step 3: Verify live after ~2 minutes**

Check these URLs in a browser or with curl:
- `https://www.protocolinfo.com/about/`
- `https://www.protocolinfo.com/regions/neuro/`
- `https://www.protocolinfo.com/protocols/mri-brain-wo-contrast/`
- `https://www.protocolinfo.com/sitemap.xml`

Each should return a full HTML page (not a 404) with visible content.

- [ ] **Step 4: Submit sitemap to Google Search Console**

If Google Search Console is configured for protocolinfo.com:
- Go to Search Console > Sitemaps
- Submit: `https://www.protocolinfo.com/sitemap.xml`

---

## Final Verification Checklist

Run this after all tasks complete:

```bash
python -c "
from pathlib import Path

protocol_pages = list(Path('protocols').glob('*/index.html'))
region_pages = list(Path('regions').glob('*/index.html'))
about = Path('about/index.html')
sitemap = Path('sitemap.xml')

print(f'Protocol pages: {len(protocol_pages)} (expect 63-72)')
print(f'Region pages: {len(region_pages)} (expect 8)')
print(f'About page exists: {about.exists()}')
print(f'Sitemap exists: {sitemap.exists()}')

# Check uniqueness of titles
titles = set()
dupes = 0
for f in protocol_pages:
    import re
    content = f.read_text()
    m = re.search(r'<title>(.*?)</title>', content)
    if m:
        t = m.group(1)
        if t in titles:
            print(f'DUPLICATE TITLE: {t}')
            dupes += 1
        titles.add(t)
print(f'Duplicate titles: {dupes} (expect 0)')

# Check meta descriptions are all under 160 chars
long_descs = 0
for f in protocol_pages:
    content = f.read_text()
    m = re.search(r'<meta name=\"description\" content=\"(.*?)\"', content)
    if m and len(m.group(1)) > 160:
        long_descs += 1
print(f'Overlong meta descriptions: {long_descs} (expect 0)')
"
```
