import html
import json
import os
import re
from pathlib import Path
from datetime import date
from urllib.parse import quote

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
    "other":    "General",
}

REGION_INTRO = {
    "neuro":    (
        "Guidance summarized from the ACR Appropriateness Criteria for neurological imaging, covers clinical scenarios "
        "involving the brain, cranial nerves, and intracranial structures, including stroke, "
        "headache, seizure, dementia, and traumatic brain injury."
    ),
    "spine":    (
        "Guidance summarized from the ACR Appropriateness Criteria for spine imaging, addresses clinical presentations "
        "involving the cervical, thoracic, and lumbar spine, including back pain, radiculopathy, "
        "myelopathy, trauma, and suspected infection or malignancy."
    ),
    "msk":      (
        "Guidance summarized from the ACR Appropriateness Criteria for musculoskeletal imaging, guides evaluation of "
        "joints, bones, and soft tissues across the body, covering acute injury, chronic pain, "
        "suspected fracture, infection, and bone or soft tissue tumors."
    ),
    "abdomen":  (
        "Guidance summarized from the ACR Appropriateness Criteria for abdominal and pelvic imaging, covers clinical "
        "presentations including acute abdominal pain, liver and pancreatic masses, renal "
        "pathology, bowel obstruction, and gastrointestinal bleeding."
    ),
    "chest":    (
        "Guidance summarized from the ACR Appropriateness Criteria for chest imaging, addresses suspected pulmonary "
        "embolism, lung nodule evaluation, chest pain, suspected pneumonia, pleural effusion, "
        "and lung cancer screening."
    ),
    "vascular": (
        "Guidance summarized from the ACR Appropriateness Criteria for vascular imaging, covers suspected aortic aneurysm "
        "and dissection, carotid stenosis, deep vein thrombosis, and peripheral arterial disease."
    ),
    "breast":   (
        "Guidance summarized from the ACR Appropriateness Criteria for breast imaging, guides evaluation of breast cancer "
        "screening, palpable breast mass, nipple discharge, and breast pain."
    ),
    "peds":     (
        "Guidance summarized from the ACR Appropriateness Criteria for pediatric imaging, addresses imaging evaluation "
        "in children, including suspected child abuse and pediatric-specific clinical scenarios."
    ),
    "other":    (
        "Guidance summarized from the ACR Appropriateness Criteria for scenarios that span body "
        "regions, including sepsis, major trauma, ICU patients, and systemic malignancy."
    ),
}

REGION_ICONS = {
    "neuro":    '<circle cx="12" cy="8" r="5"/><path d="M12 13v4M8 21h8"/>',
    "spine":    '<path d="M12 2v20M9 5h6M9 9h6M9 13h6M9 17h6"/>',
    "msk":      '<path d="M8 2v8l-3 12M16 2v8l3 12"/><circle cx="12" cy="6" r="2"/>',
    "abdomen":  '<ellipse cx="12" cy="12" rx="7" ry="8"/><path d="M8 10c0 2 4 2 4 0M12 10c0 2 4 2 4 0"/>',
    "chest":    '<path d="M12 4c-4 0-7 3-7 7v6h14v-6c0-4-3-7-7-7z"/><path d="M9 11h6M12 11v4"/>',
    "vascular": '<path d="M12 2c0 4-4 6-4 10a4 4 0 108 0c0-4-4-6-4-10z"/>',
    "breast":   '<circle cx="8" cy="12" r="4"/><circle cx="16" cy="12" r="4"/>',
    "peds":     '<circle cx="12" cy="6" r="4"/><path d="M12 10v6M8 22l4-6 4 6"/>',
    "other":    '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
}

CSS_VERSION = "20261109c"


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


# Medical acronyms that .title() corrupts - map title-cased form to correct all-caps
_ACRONYM_FIXES = {
    "Mri": "MRI",
    "Mr": "MR",
    "Ct": "CT",
    "Mrcp": "MRCP",
    "Mra": "MRA",
    "Pet": "PET",
    "Stir": "STIR",
    "Flair": "FLAIR",
    "Dwi": "DWI",
    "Swi": "SWI",
    "Dce": "DCE",
    "Dti": "DTI",
}


def normalize_procedure_name(text):
    """
    Convert a canonical_procedure string to a human-readable display name.
    Expands W/O -> Without and W/ -> With before title-casing, then
    restores medical acronyms that .title() lowercases incorrectly.
    """
    text = re.sub(r"\bW/WO\b", "With and Without", text, flags=re.IGNORECASE)
    text = re.sub(r"\bW/O\b", "Without", text, flags=re.IGNORECASE)
    text = re.sub(r"\bW/(?!O)", "With", text, flags=re.IGNORECASE)
    text = text.title()
    for wrong, right in _ACRONYM_FIXES.items():
        text = re.sub(r"\b" + wrong + r"\b", right, text)
    return text


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


def make_display_name(canonical_procedure, display_name):
    """
    Returns normalized h1 text for a protocol page.
    Appends display_name in parens if it does not appear in canonical_procedure.
    """
    title = normalize_procedure_name(canonical_procedure)
    if display_name.lower() not in canonical_procedure.lower():
        title = f"{title} ({normalize_procedure_name(display_name)})"
    return title


def load_data():
    """
    Reads all JSON inputs and returns a dict:
      {
        'protocols': [...],
        'region_topics': { 'neuro': [{'name': ..., 'count': ...}, ...], ... },
        'region_counts': { 'neuro': 1234, ... }
      }
    """
    with open(REPO_ROOT / "data" / "protocols.json", encoding="utf-8") as f:
        protocols = json.load(f)

    region_counts = {}
    region_topics = {}
    for region in REGION_DISPLAY:
        with open(REPO_ROOT / "data" / "regions" / f"{region}.json", encoding="utf-8") as f:
            data = json.load(f)
        region_counts[region] = data.get("count", 0)
        counts = {}
        for scenario in data.get("scenarios", []):
            counts[scenario["topic"]] = counts.get(scenario["topic"], 0) + 1
        region_topics[region] = [{"name": n, "count": c} for n, c in sorted(counts.items())]

    return {"protocols": protocols, "region_topics": region_topics, "region_counts": region_counts}


def shared_head(title, description, canonical, jsonld_dict):
    import json as _json
    jsonld_str = _json.dumps(jsonld_dict, indent=2)
    return f"""<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <meta name="robots" content="index, follow">
  <meta name="author" content="Patrick Matulich, DO - CoreGRAI">
  <link rel="canonical" href="{canonical}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{description}">
  <meta property="og:url" content="{canonical}">
  <meta property="og:site_name" content="GRAi Imaging Guide">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="{title}">
  <meta name="twitter:description" content="{description}">
  <meta name="theme-color" content="#9B5DE5">
  <link rel="stylesheet" href="/css/main.css?v={CSS_VERSION}">
  <link rel="manifest" href="/manifest.json">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' stop-color='%23fafafa'/><stop offset='100%25' stop-color='%239B5DE5'/></linearGradient></defs><text y='.9em' font-size='90' font-weight='700' font-family='system-ui' fill='url(%23g)'>G</text></svg>">
  <script type="application/ld+json">
{jsonld_str}
  </script>
</head>"""


def shared_header():
    return """<header class="header" role="banner">
  <div class="header-brand">
    <a href="https://www.protocolinfo.com/" style="text-decoration:none;">
      <span class="brand-text">GRAi Imaging Guide</span>
    </a>
  </div>
  <nav class="header-nav" role="navigation" aria-label="Main navigation">
    <a href="https://www.protocolinfo.com/" class="nav-link">Back to search</a>
  </nav>
</header>"""


def shared_footer():
    return """<footer class="site-footer" role="contentinfo">
  <div class="footer-content">
    <div class="footer-links">
      <a href="/about/" class="footer-link">About</a>
      <span class="footer-divider">|</span>
      <a href="/topics/" class="footer-link">All topics</a>
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


def render_protocol(protocol, slug):
    """Returns complete HTML string for one protocol page."""
    region = protocol.get("body_region", "")
    region_label = REGION_DISPLAY.get(region, region.title())

    display_name = make_display_name(
        protocol.get("canonical_procedure", protocol.get("name", "")),
        protocol.get("display_name", protocol.get("name", ""))
    )

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
        "author": {
            "@type": "Person",
            "name": "Patrick Matulich",
            "honorificSuffix": "DO",
            "jobTitle": "Radiology Resident"
        },
        "isPartOf": {"@type": "WebSite", "name": "GRAi Imaging Guide", "url": BASE_URL}
    }

    title = f"{display_name} Protocol - Sequences & Indications | GRAi Imaging Guide"
    head = shared_head(title, meta_desc, canonical, jsonld)

    # Breadcrumb - region link only when region is in REGION_DISPLAY
    if region in REGION_DISPLAY:
        region_crumb = (
            f'<span class="static-breadcrumb-sep">&rsaquo;</span>'
            f'<a href="/regions/{region}/">{region_label}</a>'
            f'<span class="static-breadcrumb-sep">&rsaquo;</span>'
        )
    else:
        region_crumb = '<span class="static-breadcrumb-sep">&rsaquo;</span>'

    breadcrumb = f"""<nav class="static-breadcrumb" aria-label="Breadcrumb">
  <a href="/">GRAi Imaging Guide</a>
  {region_crumb}
  <span>{display_name}</span>
</nav>"""

    # Sequences table
    sequences = sorted(protocol.get("sequences", []), key=lambda s: s.get("sort_order", 0))
    seq_rows = ""
    for seq in sequences:
        contrast_label = "Post-contrast" if seq.get("is_post_contrast") == 1 else "Pre-contrast"
        seq_rows += f"    <tr><td>{seq.get('sequence_name', '')}</td><td>{contrast_label}</td></tr>\n"

    if sequences:
        seq_table = f"""<table class="sequence-table">
  <thead>
    <tr><th>Sequence</th><th>Contrast</th></tr>
  </thead>
  <tbody>
{seq_rows}  </tbody>
</table>"""
    else:
        seq_table = '<p style="color:var(--text-muted);font-size:0.875rem;">No sequence data available.</p>'

    # Top 5 related scenarios as pills
    matches = sorted(
        protocol.get("scenario_matches", []),
        key=lambda m: m.get("relevance_score", 0),
        reverse=True
    )[:5]
    scenarios_section = ""
    if matches:
        pills = "".join(
            f'<div class="scenario-pill">{m.get("scenario_name", "")}</div>\n'
            for m in matches
        )
        scenarios_section = f"""<h2 class="static-section-label" style="margin-top:1.75rem;">Related Clinical Scenarios</h2>
<div>
{pills}</div>"""

    body = f"""<div style="max-width:800px;margin:0 auto;padding:2rem 1rem;">
  {breadcrumb}
  <h1 style="margin-bottom:0.5rem;">{display_name}</h1>
  <div style="margin-bottom:1.5rem;">
    <span class="protocol-type-badge">MRI Protocol</span>
    <span class="protocol-region-tag">{region_label}</span>
  </div>

  <h2 class="static-section-label">Indications</h2>
  <p style="color:var(--text-secondary);font-size:0.9375rem;line-height:1.6;margin-bottom:1.75rem;">{indications_text or "See the full protocol in the app."}</p>

  <h2 class="static-section-label">Sequences</h2>
  {seq_table}

  {scenarios_section}

  <a href="{BASE_URL}/#protocols" class="protocol-cta">
    <span class="protocol-cta-label">View the full protocol in the app</span>
    <span class="protocol-cta-action">Open the app &rarr;</span>
  </a>
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


def render_region(region, topics, region_protocols, slug_map, protocols, scenario_count):
    """Returns complete HTML string for one regional landing page."""
    label = REGION_DISPLAY[region]
    canonical = f"{BASE_URL}/regions/{region}/"

    # Meta description
    meta_desc = (
        f"Quick {label.lower()} imaging guidance for {scenario_count} clinical scenarios, "
        f"summarized from the ACR Appropriateness Criteria."
    )[:160]

    jsonld = {
        "@context": "https://schema.org",
        "@type": "MedicalWebPage",
        "name": f"{label} Imaging Appropriateness",
        "url": canonical,
        "specialty": {"@type": "MedicalSpecialty", "name": "Radiology"},
        "author": {
            "@type": "Person",
            "name": "Patrick Matulich",
            "honorificSuffix": "DO",
            "jobTitle": "Radiology Resident"
        },
        "isPartOf": {"@type": "WebSite", "name": "GRAi Imaging Guide", "url": BASE_URL}
    }

    title = f"{label} Imaging: ACR Appropriateness Criteria Summaries | GRAi Imaging Guide"
    head = shared_head(title, meta_desc, canonical, jsonld)

    # Hero
    icon_paths = REGION_ICONS.get(region, "")
    hero = f"""<div class="static-hero">
  <svg class="static-hero-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    {icon_paths}
  </svg>
  <div>
    <h1 class="static-hero-title">{label} imaging: ACR Appropriateness Criteria summaries</h1>
    <p class="static-hero-desc">{REGION_INTRO[region]}</p>
  </div>
</div>"""

    # Topic links open the generated guide for that ACR topic
    topics_html = ""
    if topics:
        topic_items = ""
        for topic in topics:
            name = html.escape(clean_topic_name(topic["name"]))
            count = topic["count"]
            topic_items += f"""<a class="topic-card" href="/topics/{topic_slug(topic['name'])}/">
  <div class="topic-card-header">
    <span class="topic-card-name">{name}</span>
  </div>
  <p class="topic-card-meta">{count} scenario{'' if count == 1 else 's'}</p>
</a>
"""
        topics_html = f"""<h2 class="static-section-label">Clinical Topics</h2>
<div class="topic-grid">
{topic_items}</div>"""

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
                proto_items += f'<a href="/protocols/{p_slug}/" class="protocol-list-item"><span>{p_name}</span><span class="protocol-list-arrow">&rsaquo;</span></a>\n'
        protocols_html = f"""<h2 class="static-section-label">MRI Protocols</h2>
<div class="protocol-list">
{proto_items}</div>"""

    body = f"""<div style="max-width:800px;margin:0 auto;padding:2rem 1rem;">
  {hero}

  {topics_html}

  {protocols_html}

  <p class="topic-source"><a href="/topics/">Browse all topics</a></p>

  <a href="{BASE_URL}/#search" class="protocol-cta">
    <span class="protocol-cta-label">Search all scenarios</span>
    <span class="protocol-cta-action">Open the app &rarr;</span>
  </a>
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


LEVELS = ["Usually Appropriate", "May Be Appropriate", "Usually Not Appropriate"]
LEVEL_CLASS = {"Usually Appropriate": "high", "May Be Appropriate": "mid", "Usually Not Appropriate": "low"}


def clean_topic_name(name):
    """ACR writes some topic titles with en or em dashes; show one plain form."""
    return re.sub(r"\s*[\u2013\u2014]\s*", "-", name).strip()


def topic_slug(name):
    """URL slug for an ACR topic. Dash and slash variants of one title share a slug."""
    text = re.sub(r"[\u2013\u2014/:(),-]", " ", name)
    return slugify(re.sub(r"\s+", " ", text).strip())


def load_topics():
    """
    Every ACR topic with its scenarios, keyed by slug:
      { slug: {'name', 'slug', 'region', 'scenarios': [...]} }
    Scenarios are read from the region files and de-duplicated by id, because
    pediatric scenarios are listed under their own region and under peds.
    """
    topics = {}
    seen = set()
    for region_file in sorted((REPO_ROOT / "data" / "regions").glob("*.json")):
        with open(region_file, encoding="utf-8") as f:
            for scenario in json.load(f).get("scenarios", []):
                if scenario["id"] in seen:
                    continue
                seen.add(scenario["id"])
                slug = topic_slug(scenario["topic"])
                topic = topics.setdefault(slug, {
                    "name": clean_topic_name(scenario["topic"]),
                    "slug": slug,
                    "region": scenario.get("region", "other"),
                    "scenarios": [],
                })
                topic["scenarios"].append(scenario)
    for topic in topics.values():
        topic["scenarios"].sort(key=lambda s: s["name"])
    return topics


def top_tier(scenario):
    """The highest ACR category a scenario uses, and the studies in it."""
    for level in LEVELS:
        studies = [p["name"] for p in scenario["procedures"] if p["ratingLevel"] == level]
        if studies:
            return level, studies
    return None, []


def group_by_recommendation(scenarios):
    """Scenarios grouped by what ACR rates highest, best category first."""
    groups = {}
    for scenario in scenarios:
        level, studies = top_tier(scenario)
        if not level:
            continue
        key = (level, tuple(sorted(studies)))
        groups.setdefault(key, {"level": level, "studies": studies, "scenarios": []})["scenarios"].append(scenario)
    return sorted(groups.values(), key=lambda g: (LEVELS.index(g["level"]), -len(g["scenarios"])))


def capture_month():
    """Month and year of the newest ACR capture, as shown beside every answer."""
    with open(REPO_ROOT / "data" / "data-info.json", encoding="utf-8") as f:
        captured = json.load(f)["capturedTo"]
    return date.fromisoformat(captured).strftime("%B %Y"), captured


def topic_title(name):
    # People search "acr appropriateness criteria <topic>" (Search Console,
    # Nov 2026), so the title says exactly that.
    title = f"{name}: ACR Appropriateness Criteria Summary | GRAi"
    return title if len(title) <= 70 else f"{name}: ACR Appropriateness Criteria Summary"


def render_topic(topic, related):
    """Returns complete HTML for one ACR topic page."""
    name = topic["name"]
    esc = html.escape
    region = topic["region"]
    region_label = REGION_DISPLAY.get(region, "General")
    canonical = f"{BASE_URL}/topics/{topic['slug']}/"
    scenarios = topic["scenarios"]
    count = len(scenarios)
    month, captured = capture_month()
    groups = group_by_recommendation(scenarios)
    plural = "" if count == 1 else "s"

    meta_desc = (
        f"Which imaging study to order for {name}: {count} clinical scenario{plural} with the studies "
        f"ACR rates usually appropriate. Independent summary of the ACR Appropriateness Criteria."
    )
    if len(meta_desc) > 160:
        meta_desc = f"{name}: which imaging to order across {count} clinical scenario{plural}, summarized from the ACR Appropriateness Criteria."

    jsonld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "MedicalWebPage",
                "name": f"{name}: ACR Appropriateness Criteria summary",
                "url": canonical,
                "description": meta_desc,
                "about": {"@type": "MedicalCondition", "name": name},
                "specialty": {"@type": "MedicalSpecialty", "name": "Radiology"},
                "audience": {"@type": "MedicalAudience", "audienceType": "Clinician"},
                "lastReviewed": captured,
                "author": {"@type": "Person", "name": "Patrick Matulich", "honorificSuffix": "DO", "jobTitle": "Radiology Resident"},
                "isPartOf": {"@type": "WebSite", "name": "GRAi Imaging Guide", "url": BASE_URL},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "GRAi Imaging Guide", "item": f"{BASE_URL}/"},
                    {"@type": "ListItem", "position": 2, "name": f"{region_label} imaging", "item": f"{BASE_URL}/regions/{region}/"},
                    {"@type": "ListItem", "position": 3, "name": name, "item": canonical},
                ],
            },
        ],
    }
    head = shared_head(esc(topic_title(name)), esc(meta_desc), canonical, jsonld)

    sections = ""
    for group in groups:
        level = group["level"]
        if level == "Usually Not Appropriate":
            summary = "Imaging is usually not appropriate"
        else:
            summary = "; ".join(esc(s) for s in group["studies"])
        items = ""
        for scenario in group["scenarios"]:
            lower = [p["name"] for p in scenario["procedures"] if p["ratingLevel"] == "May Be Appropriate"]
            may = f'<p><strong>May be appropriate:</strong> {"; ".join(esc(s) for s in lower)}</p>' if lower and level == "Usually Appropriate" else ""
            flagged = any(p.get("hasDisagreement") for p in scenario["procedures"] if p["ratingLevel"] == level)
            note = '<p><em>ACR notes panel disagreement for this scenario.</em></p>' if flagged else ""
            child = ' <span class="age-tag">Pediatric</span>' if scenario.get("ageGroup") == "pediatric" else ""
            items += f"""<article class="topic-scenario">
  <h3>{esc(scenario['name'])}{child}</h3>
  <p>{esc(scenario.get('variant', ''))}</p>
  {may}{note}
  <p><a href="{esc(scenario['sourceUrl'])}" target="_blank" rel="noopener nofollow">ACR source for this scenario</a></p>
</article>
"""
        n = len(group["scenarios"])
        sections += f"""<section class="topic-group">
  <h2 class="recommendation"><span class="level-pill {LEVEL_CLASS[level]}">{level}</span> <span class="recommendation-studies">{summary}</span></h2>
  <p class="topic-group-count">{n} scenario{'' if n == 1 else 's'}</p>
  {items}</section>
"""

    related_html = ""
    if related:
        links = "".join(
            f'<a class="topic-card" href="/topics/{r["slug"]}/"><div class="topic-card-header">'
            f'<span class="topic-card-name">{esc(r["name"])}</span></div>'
            f'<p class="topic-card-meta">{len(r["scenarios"])} scenario{"" if len(r["scenarios"]) == 1 else "s"}</p></a>\n'
            for r in related
        )
        related_html = f"""<h2 class="static-section-label">Related {esc(region_label)} topics</h2>
<div class="topic-grid">
{links}</div>"""

    body = f"""<div style="max-width:800px;margin:0 auto;padding:2rem 1rem;">
  <nav class="breadcrumbs" aria-label="Breadcrumb">
    <a href="/">GRAi Imaging Guide</a> &rsaquo; <a href="/regions/{region}/">{esc(region_label)} imaging</a> &rsaquo; <a href="/topics/">Topics</a>
  </nav>
  <h1 class="static-hero-title">{esc(name)}: ACR Appropriateness Criteria summary</h1>
  <p class="topic-kicker">Which imaging to order</p>
  <p class="static-hero-desc">
    {count} clinical scenario{plural} from the ACR Appropriateness Criteria topic "{esc(name)}", grouped by the
    imaging study ACR rates highest for each. Studies listed together share the same ACR category;
    ACR does not rank studies within a category.
  </p>
  <p class="topic-source">
    Independent summary of the ACR Appropriateness Criteria as of {month}. Not affiliated with or endorsed by
    the American College of Radiology. For education; confirm against the linked source and your institution's protocols.
  </p>

  <a href="{BASE_URL}/?q={quote(name)}" class="protocol-cta">
    <span class="protocol-cta-label">Search within {esc(name)}</span>
    <span class="protocol-cta-action">Open the app &rarr;</span>
  </a>

  {sections}

  {related_html}
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


def related_topics(topic, topics, limit=8):
    """Topics in the same region, those sharing title words first."""
    words = set(re.findall(r"[a-z]{4,}", topic["name"].lower())) - {"suspected", "imaging", "child", "acute", "chronic", "with", "after"}
    others = [t for t in topics.values() if t["region"] == topic["region"] and t["slug"] != topic["slug"]]
    shared = lambda t: len(words & set(re.findall(r"[a-z]{4,}", t["name"].lower())))
    return sorted(others, key=lambda t: (-shared(t), t["name"]))[:limit]


def render_topic_index(topics):
    """Returns complete HTML for /topics/, every topic grouped by body region."""
    canonical = f"{BASE_URL}/topics/"
    total = sum(len(t["scenarios"]) for t in topics.values())
    title = "ACR Appropriateness Criteria Summaries by Topic | GRAi Imaging Guide"
    meta_desc = (
        f"Browse {len(topics)} clinical topics and {total:,} scenarios: which imaging study to order, "
        f"summarized from the ACR Appropriateness Criteria."
    )
    jsonld = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": "Imaging appropriateness topics",
        "url": canonical,
        "isPartOf": {"@type": "WebSite", "name": "GRAi Imaging Guide", "url": BASE_URL},
    }
    head = shared_head(title, meta_desc, canonical, jsonld)
    sections = ""
    for region, label in REGION_DISPLAY.items():
        in_region = sorted((t for t in topics.values() if t["region"] == region), key=lambda t: t["name"])
        if not in_region:
            continue
        links = "".join(
            f'<a class="topic-card" href="/topics/{t["slug"]}/"><div class="topic-card-header">'
            f'<span class="topic-card-name">{html.escape(t["name"])}</span></div>'
            f'<p class="topic-card-meta">{len(t["scenarios"])} scenario{"" if len(t["scenarios"]) == 1 else "s"}</p></a>\n'
            for t in in_region
        )
        sections += f"""<h2 class="static-section-label"><a href="/regions/{region}/">{label}</a></h2>
<div class="topic-grid">
{links}</div>
"""
    body = f"""<div style="max-width:800px;margin:0 auto;padding:2rem 1rem;">
  <h1 class="static-hero-title">Imaging appropriateness by topic</h1>
  <p class="static-hero-desc">
    {len(topics)} clinical topics covering {total:,} scenarios. Each page lists which imaging studies the
    ACR Appropriateness Criteria rate usually appropriate, grouped by presentation.
  </p>
  {sections}
  <a href="{BASE_URL}/" class="protocol-cta">
    <span class="protocol-cta-label">Search all scenarios</span>
    <span class="protocol-cta-action">Open the app &rarr;</span>
  </a>
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


def render_not_found():
    """Returns complete HTML for 404.html, which GitHub Pages serves for unknown URLs."""
    head = shared_head("Page not found | GRAi Imaging Guide", "This page does not exist.", f"{BASE_URL}/", {
        "@context": "https://schema.org", "@type": "WebPage", "name": "Page not found",
    }).replace('content="index, follow"', 'content="noindex, follow"')
    body = f"""<div style="max-width:800px;margin:0 auto;padding:2rem 1rem;">
  <h1 class="static-hero-title">Page not found</h1>
  <p class="static-hero-desc">That address does not exist on GRAi Imaging Guide. Search for a clinical scenario or browse by topic.</p>
  <a href="{BASE_URL}/" class="protocol-cta">
    <span class="protocol-cta-label">Search all scenarios</span>
    <span class="protocol-cta-action">Open the app &rarr;</span>
  </a>
  <p class="topic-source"><a href="/topics/">Browse all topics</a></p>
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


def render_about():
    """Returns complete HTML string for the about page."""
    canonical = f"{BASE_URL}/about/"
    title = "About GRAi Imaging Guide (formerly Radex)"
    meta_desc = (
        "GRAi Imaging Guide is a free, browser-based imaging guidance reference for clinicians, summarized "
        "from the ACR Appropriateness Criteria. 3,900+ scenarios, 72+ MRI protocols."
    )

    jsonld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebApplication",
                "name": "GRAi Imaging Guide",
                "alternateName": "Radex",
                "url": BASE_URL,
                "applicationCategory": "MedicalApplication",
                "isAccessibleForFree": True,
                "author": {
                    "@type": "Person",
                    "name": "Patrick Matulich",
                    "honorificSuffix": "DO",
                    "jobTitle": "Radiology Resident",
                    "worksFor": {"@type": "Organization", "name": "CoreGRAI", "url": "https://coregrai.com"}
                }
            },
            {
                "@type": "Organization",
                "name": "CoreGRAI",
                "url": "https://coregrai.com",
                "email": "support@coregrai.com"
            },
            {
                "@type": "Person",
                "name": "Patrick Matulich",
                "honorificSuffix": "DO",
                "jobTitle": "Radiology Resident",
                "worksFor": {"@type": "Organization", "name": "CoreGRAI", "url": "https://coregrai.com"}
            }
        ]
    }

    head = shared_head(title, meta_desc, canonical, jsonld)

    stats_pills = "\n".join([
        '<div class="scenario-pill">3,900+ clinical scenarios across 260+ topics</div>',
        '<div class="scenario-pill">72+ MRI protocols with sequence-level guidance</div>',
        '<div class="scenario-pill">Every recommendation links to its ACR source scenario</div>',
        '<div class="scenario-pill">Client-side AI inference - fully private, no data sent to servers</div>',
        '<div class="scenario-pill">Offline-capable via Progressive Web App (PWA)</div>',
    ])

    region_links = "\n".join(
        f'<a href="/regions/{r}/" class="protocol-list-item">'
        f'<span>{label} Imaging</span>'
        f'<span class="protocol-list-arrow">&rsaquo;</span>'
        f'</a>'
        for r, label in REGION_DISPLAY.items()
    )

    body = f"""<div style="max-width:800px;margin:0 auto;padding:2rem 1rem;">
  <h1 style="margin-bottom:1.5rem;">About GRAi Imaging Guide</h1>
  <p style="color:var(--text-muted);font-size:0.8125rem;margin:-1rem 0 1.25rem;">Formerly called Radex.</p>

  <p style="color:var(--text-secondary);font-size:0.9375rem;line-height:1.6;margin-bottom:1.75rem;">
    GRAi Imaging Guide is an educational reference that helps clinicians find generic imaging guidance quickly,
    without working through the full ACR Appropriateness Criteria scenario by scenario. It is an
    independent project and is not affiliated with or endorsed by the American College of Radiology.
  </p>

  <h2 class="static-section-label">Built By</h2>
  <div style="margin-bottom:1.75rem;">
    <p style="font-weight:600;font-size:0.9375rem;margin-bottom:0.25rem;">Patrick Matulich, DO</p>
    <p style="color:var(--text-muted);font-size:0.875rem;margin-bottom:0.75rem;">Radiology Resident | CoreGRAI</p>
    <p style="color:var(--text-secondary);font-size:0.875rem;line-height:1.6;">
      GRAi Imaging Guide was developed as a capstone project in radiology AI, motivated by a recurring challenge
      in clinical training: imaging appropriateness guidelines exist, but accessing them quickly at
      the point of care remains cumbersome. GRAi Imaging Guide is designed to reduce time-to-answer from minutes
      to seconds while keeping every answer traceable to its source.
    </p>
  </div>

  <h2 class="static-section-label">Key Statistics</h2>
  <div style="margin-bottom:1.75rem;">
{stats_pills}
  </div>

  <h2 style="margin-bottom:0.75rem;font-size:1rem;">Data Sources &amp; Methodology</h2>
  <p style="color:var(--text-secondary);font-size:0.875rem;line-height:1.6;margin-bottom:0.75rem;">
    <strong>Source:</strong> Guidance is summarized from the ACR Appropriateness Criteria,
    evidence-based guidelines developed by the American College of Radiology. GRAi Imaging Guide shows when its
    data was captured, and that date may lag ACR updates, so confirm against the linked source.
  </p>
  <p style="color:var(--text-secondary);font-size:0.875rem;line-height:1.6;margin-bottom:0.75rem;">
    <strong>How answers are built:</strong> A broad search opens a topic guide that groups scenarios
    by what they recommend. A specific search goes to matching scenarios, with pregnancy and patient
    age applied as filters. ACR categories are shown as published, including panel disagreement
    flags, and studies in the same category are listed together because ACR does not rank them.
  </p>
  <p style="color:var(--text-secondary);font-size:0.875rem;line-height:1.6;margin-bottom:0.75rem;">
    <strong>MRI Protocols:</strong> Sample protocols based on common clinical practice.
    Your institution may have different sequences, parameters, or protocols based on
    scanner hardware, software versions, radiologist preferences, and institutional policies.
  </p>
  <p style="color:var(--text-secondary);font-size:0.875rem;line-height:1.6;margin-bottom:1.75rem;">
    <strong>AI:</strong> When no scenario matches a search directly, a small model running in your
    browser suggests the closest scenarios by meaning. These results are labelled as closest
    matches. Nothing you type is sent to a server for search.
  </p>

  <h2 class="static-section-label">Browse by Region</h2>
  <div class="protocol-list" style="margin-bottom:1.75rem;">
{region_links}
  </div>

  <h2 style="margin-bottom:0.75rem;font-size:1rem;">Important Notice</h2>
  <p style="color:var(--text-secondary);font-size:0.875rem;line-height:1.6;margin-bottom:1.75rem;">
    This tool is provided for <strong>educational purposes only</strong>. It is not a substitute
    for clinical judgment, institutional protocols, or direct consultation with radiologists.
    Imaging decisions should always be made in the context of individual patient circumstances.
  </p>

  <h2 class="static-section-label">Also by CoreGRAI</h2>
  <p style="color:var(--text-secondary);font-size:0.875rem;line-height:1.6;margin-bottom:1.75rem;">
    <a href="https://coregrai.com" target="_blank" rel="noopener" style="color:var(--accent);">GRAi</a>
    is an AI-powered radiology study and clinical reference platform built for residents
    preparing for the ABR Core Exam. It provides AI-assisted Q&amp;A across radiology topics,
    radiology corpus search powered by a proprietary knowledge base and custom retrieval model,
    differential diagnosis support, and structured lesson content - all through a conversational
    interface. Also built by Patrick Matulich, DO.
  </p>

  <h2 style="margin-bottom:0.75rem;font-size:1rem;">Contact</h2>
  <p style="color:var(--text-secondary);font-size:0.875rem;margin-bottom:2rem;">
    Questions or suggestions? <a href="mailto:support@coregrai.com" style="color:var(--accent);">support@coregrai.com</a>
  </p>

  <a href="{BASE_URL}/" class="protocol-cta">
    <span class="protocol-cta-label">Try GRAi Imaging Guide - free, browser-based</span>
    <span class="protocol-cta-action">Open the app &rarr;</span>
  </a>
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


def build_sitemap(protocol_slugs, topic_slugs=()):
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

    entry("/topics/", "0.8", "monthly")
    for slug in topic_slugs:
        entry(f"/topics/{slug}/", "0.8", "monthly")

    for slug in protocol_slugs:
        entry(f"/protocols/{slug}/", "0.7", "monthly")

    urls_block = "\n".join(entries)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{urls_block}
</urlset>
"""


def main():
    data = load_data()
    protocols = data["protocols"]
    region_counts = data["region_counts"]
    slug_map = make_unique_slugs(protocols)

    count = 0

    # Protocol pages
    for i, protocol in enumerate(protocols):
        slug = slug_map[i]
        page = render_protocol(protocol, slug)
        write_file(Path("protocols") / slug / "index.html", page)
        count += 1

    # Regional pages
    for region in REGION_DISPLAY:
        region_protocols = [p for p in protocols if p.get("body_region") == region]
        scenario_count = region_counts.get(region, 0)
        page = render_region(region, data["region_topics"][region], region_protocols, slug_map, protocols, scenario_count)
        write_file(Path("regions") / region / "index.html", page)
        count += 1

    # Topic pages and their index
    topics = load_topics()
    for topic in topics.values():
        write_file(Path("topics") / topic["slug"] / "index.html", render_topic(topic, related_topics(topic, topics)))
        count += 1
    write_file(Path("topics") / "index.html", render_topic_index(topics))
    count += 1

    # About page
    write_file(Path("about") / "index.html", render_about())
    count += 1

    write_file(Path("404.html"), render_not_found())
    count += 1

    # Sitemap
    sitemap_xml = build_sitemap(list(slug_map.values()), sorted(topics))
    write_file(Path("sitemap.xml"), sitemap_xml)
    count += 1

    print(f"Written {count} files")


if __name__ == "__main__":
    main()
