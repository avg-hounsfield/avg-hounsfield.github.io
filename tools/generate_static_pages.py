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

REGION_ICONS = {
    "neuro":    '<circle cx="12" cy="8" r="5"/><path d="M12 13v4M8 21h8"/>',
    "spine":    '<path d="M12 2v20M9 5h6M9 9h6M9 13h6M9 17h6"/>',
    "msk":      '<path d="M8 2v8l-3 12M16 2v8l3 12"/><circle cx="12" cy="6" r="2"/>',
    "abdomen":  '<ellipse cx="12" cy="12" rx="7" ry="8"/><path d="M8 10c0 2 4 2 4 0M12 10c0 2 4 2 4 0"/>',
    "chest":    '<path d="M12 4c-4 0-7 3-7 7v6h14v-6c0-4-3-7-7-7z"/><path d="M9 11h6M12 11v4"/>',
    "vascular": '<path d="M12 2c0 4-4 6-4 10a4 4 0 108 0c0-4-4-6-4-10z"/>',
    "breast":   '<circle cx="8" cy="12" r="4"/><circle cx="16" cy="12" r="4"/>',
    "peds":     '<circle cx="12" cy="6" r="4"/><path d="M12 10v6M8 22l4-6 4 6"/>',
}

CSS_VERSION = "20260324a"


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
        "isPartOf": {"@type": "WebSite", "name": "Radex", "url": BASE_URL}
    }

    title = f"{display_name} Protocol - Sequences & Indications | Radex"
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
  <a href="/">Radex</a>
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
  <p style="color:var(--text-secondary);font-size:0.9375rem;line-height:1.6;margin-bottom:1.75rem;">{indications_text or "See full protocol in Radex."}</p>

  <h2 class="static-section-label">Sequences</h2>
  {seq_table}

  {scenarios_section}

  <a href="{BASE_URL}/#protocols" class="protocol-cta">
    <span class="protocol-cta-label">View full protocol in the Radex app</span>
    <span class="protocol-cta-action">Open in Radex &rarr;</span>
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
        "author": {
            "@type": "Person",
            "name": "Patrick Matulich",
            "honorificSuffix": "DO",
            "jobTitle": "Radiology Resident"
        },
        "isPartOf": {"@type": "WebSite", "name": "Radex", "url": BASE_URL}
    }

    title = f"{label} Imaging - ACR Appropriateness Criteria | Radex"
    head = shared_head(title, meta_desc, canonical, jsonld)

    # Hero
    icon_paths = REGION_ICONS.get(region, "")
    hero = f"""<div class="static-hero">
  <svg class="static-hero-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    {icon_paths}
  </svg>
  <div>
    <h1 class="static-hero-title">{label} Imaging Appropriateness</h1>
    <p class="static-hero-desc">{REGION_INTRO[region]}</p>
  </div>
</div>"""

    # Topic cards section
    cards_html = ""
    if cards:
        badge_classes = {
            "STRONG":         "topic-badge-strong",
            "CONDITIONAL":    "topic-badge-cond",
            "CLINICAL_FIRST": "topic-badge-clinical",
            "HIGH_VARIANCE":  "topic-badge-variance",
        }
        card_items = ""
        for card in cards:
            primary = card.get("primary_recommendation") or {}
            consensus = primary.get("consensus_pct", "")
            rec_name = primary.get("name", "Clinical assessment")
            card_type = card.get("card_type", "")
            badge_cls = badge_classes.get(card_type, "topic-badge-variance")
            badge_html = f'<span class="topic-badge {badge_cls}">{consensus}%</span>' if consensus else ""
            card_items += f"""<div class="topic-card">
  <div class="topic-card-header">
    <span class="topic-card-name">{card.get('display_name', '')}</span>
    {badge_html}
  </div>
  <p class="topic-card-meta">{rec_name} &bull; {card_type}</p>
</div>
"""
        cards_html = f"""<h2 class="static-section-label">Clinical Topics</h2>
<div class="topic-grid">
{card_items}</div>"""

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

  {cards_html}

  {protocols_html}

  <a href="{BASE_URL}/#search" class="protocol-cta">
    <span class="protocol-cta-label">Search {label} scenarios</span>
    <span class="protocol-cta-action">Open Radex &rarr;</span>
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

    stats_pills = "\n".join([
        '<div class="scenario-pill">3,200+ ACR clinical scenarios</div>',
        '<div class="scenario-pill">72+ MRI protocols with sequence-level guidance</div>',
        '<div class="scenario-pill">83% ACR scenario coverage via quick-answer cards</div>',
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
  <h1 style="margin-bottom:1.5rem;">About Radex</h1>

  <p style="color:var(--text-secondary);font-size:0.9375rem;line-height:1.6;margin-bottom:1.75rem;">
    Radex is an educational reference tool designed for radiology residents and medical professionals
    to quickly access imaging appropriateness criteria and MRI protocol information.
  </p>

  <h2 class="static-section-label">Key Statistics</h2>
  <div style="margin-bottom:1.75rem;">
{stats_pills}
  </div>

  <h2 style="margin-bottom:0.75rem;font-size:1rem;">Data Sources</h2>
  <p style="color:var(--text-secondary);font-size:0.875rem;line-height:1.6;margin-bottom:0.75rem;">
    <strong>Appropriateness Criteria:</strong> Based on the ACR Appropriateness Criteria,
    evidence-based guidelines developed by the American College of Radiology to assist referring
    physicians and other providers in making the most appropriate imaging decisions.
  </p>
  <p style="color:var(--text-secondary);font-size:0.875rem;line-height:1.6;margin-bottom:1.75rem;">
    <strong>MRI Protocols:</strong> Sample protocols based on common clinical practice.
    Your institution may have different sequences, parameters, or protocols based on
    scanner hardware, software versions, radiologist preferences, and institutional policies.
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
    is an AI-powered radiology clinical reference and decision support platform.
  </p>

  <h2 style="margin-bottom:0.75rem;font-size:1rem;">Contact</h2>
  <p style="color:var(--text-secondary);font-size:0.875rem;margin-bottom:2rem;">
    Questions or suggestions? <a href="mailto:contact@coregrai.com" style="color:var(--accent);">contact@coregrai.com</a>
  </p>

  <a href="{BASE_URL}/" class="protocol-cta">
    <span class="protocol-cta-label">Try Radex - free, browser-based</span>
    <span class="protocol-cta-action">Open Radex &rarr;</span>
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

    # About page
    write_file(Path("about") / "index.html", render_about())
    count += 1

    # Sitemap
    sitemap_xml = build_sitemap(list(slug_map.values()))
    write_file(Path("sitemap.xml"), sitemap_xml)
    count += 1

    print(f"Written {count} files")


if __name__ == "__main__":
    main()
