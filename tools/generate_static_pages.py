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

CSS_VERSION = "20261112a"


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


# One navigation for every page, the app included (index.html carries the
# same five links; its Search, Protocols and Builder switch views in place).
NAV = [
    ("search", "Search", "/"),
    ("topics", "Topics", "/topics/"),
    ("protocols", "Protocols", "/#protocols"),
    ("builder", "Builder", "/#builder"),
    ("about", "About", "/about/"),
]


def shared_header(active=None):
    links = "\n".join(
        f'    <a href="{href}" class="nav-link{" active" if key == active else ""}"'
        f'{" aria-current=\"page\"" if key == active else ""}>{label}</a>'
        for key, label, href in NAV
    )
    return f"""<header class="header" role="banner">
  <a class="header-brand" href="/" aria-label="GRAi Imaging Guide home">
    <span class="brand-text">GRAi Imaging Guide</span>
  </a>
  <nav class="header-nav" id="headerNav" role="navigation" aria-label="Main navigation">
{links}
  </nav>
  <button class="mobile-menu-btn" id="mobileMenuBtn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="headerNav">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>
    </svg>
  </button>
</header>"""


def crumbs(*items):
    """Breadcrumb trail. Each item is (label, href); the last is the current page."""
    parts = []
    for i, (label, href) in enumerate(items):
        if i == len(items) - 1:
            parts.append(f'<li aria-current="page">{label}</li>')
        else:
            parts.append(f'<li><a href="{href}">{label}</a></li>')
    return f'<nav class="crumbs" aria-label="Breadcrumb"><ol>{"".join(parts)}</ol></nav>'


def page_intro(title, lede="", kicker=""):
    kicker_html = f'<p class="page-kicker">{kicker}</p>' if kicker else ""
    lede_html = f'<p class="page-lede">{lede}</p>' if lede else ""
    return f"""<header class="page-intro">
  <h1 class="page-title">{title}</h1>
  {kicker_html}{lede_html}
</header>"""


def page_cta(href, label, note=""):
    note_html = f'<span class="page-cta-note">{note}</span>' if note else ""
    return f'<p class="page-cta-row"><a class="page-cta" href="{href}">{label}</a>{note_html}</p>'


def render_page(head, body, active=None):
    """The one page shell every generated page uses."""
    return f"""<!DOCTYPE html>
<html lang="en">
{head}
<body>
  <a class="skip-link" href="#content">Skip to content</a>
  <div class="app">
    {shared_header(active)}
    <main class="main page-main" id="content">
      <div class="page">
        {body}
      </div>
    </main>
    {shared_footer()}
  </div>
  <script src="/js/site-nav.js?v={CSS_VERSION}" defer></script>
</body>
</html>"""


def shared_footer():
    return """<footer class="site-footer" role="contentinfo">
  <div class="footer-content">
    <div class="footer-links">
      <a href="/about/" class="footer-link">About</a>
      <span class="footer-divider">|</span>
      <a href="/topics/" class="footer-link">All topics</a>
      <span class="footer-divider">|</span>
      <a href="/privacy-policy.html" class="footer-link">Privacy and terms</a>
      <span class="footer-divider">|</span>
      <a href="https://www.acr.org/Clinical-Resources/Clinical-Tools-and-Reference/Appropriateness-Criteria" target="_blank" rel="noopener" class="footer-link">ACR Guidelines</a>
      <span class="footer-divider">|</span>
      <a href="https://www.radsreview.net" target="_blank" rel="noopener" class="footer-link">RadsReview</a>
      <span class="footer-divider">|</span>
      <a href="https://coregrai.com" target="_blank" rel="noopener" class="footer-link">CoreGRAI</a>
    </div>
    <div class="footer-directory">
      <span class="directory-label">Browse by region:</span>
      <a href="/regions/neuro/" class="directory-link">Neuro</a>
      <a href="/regions/spine/" class="directory-link">Spine</a>
      <a href="/regions/msk/" class="directory-link">MSK</a>
      <a href="/regions/abdomen/" class="directory-link">Abdomen</a>
      <a href="/regions/chest/" class="directory-link">Chest</a>
      <a href="/regions/vascular/" class="directory-link">Vascular</a>
      <a href="/regions/breast/" class="directory-link">Breast</a>
      <a href="/regions/peds/" class="directory-link">Pediatric</a>
      <a href="/regions/other/" class="directory-link">General</a>
    </div>
    <div class="footer-promo">
      <a href="https://coregrai.com" target="_blank" rel="noopener" class="footer-promo-card" aria-label="Visit CoreGRAi - radiology study platform">
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


def render_protocol(protocol, slug, routed=()):
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

    esc = html.escape
    trail = [("GRAi Imaging Guide", "/")]
    if region in REGION_DISPLAY:
        trail.append((f"{esc(region_label)} imaging", f"/regions/{region}/"))
    trail.append((esc(display_name), None))

    # Sequences table
    sequences = sorted(protocol.get("sequences", []), key=lambda s: s.get("sort_order", 0))
    seq_rows = ""
    for seq in sequences:
        contrast_label = "Post-contrast" if seq.get("is_post_contrast") == 1 else "Pre-contrast"
        seq_rows += f"    <tr><td>{esc(seq.get('sequence_name', ''))}</td><td>{contrast_label}</td></tr>\n"

    if sequences:
        seq_table = f"""<table class="sequence-table">
  <thead>
    <tr><th scope="col">Sequence</th><th scope="col">Contrast</th></tr>
  </thead>
  <tbody>
{seq_rows}  </tbody>
</table>"""
    else:
        seq_table = '<p class="page-note">No sequence list for this protocol yet.</p>'

    # The ACR topics whose usually-appropriate MRI the app routes to this
    # protocol (tools/build_protocol_scenarios.mjs), so the page and the app agree.
    by_topic = {}
    for s in routed:
        by_topic.setdefault(s["topic"], []).append(s)
    scenarios_section = ""
    if by_topic:
        ordered = sorted(by_topic.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        cards = "".join(
            f'<a class="topic-card" href="/topics/{topic_slug(topic)}/">'
            f'<span class="topic-card-name">{esc(clean_topic_name(topic))}</span>'
            f'<span class="topic-card-meta">{len(items)} scenario{"" if len(items) == 1 else "s"} where ACR rates this MRI usually appropriate</span></a>\n'
            for topic, items in ordered[:12]
        )
        more = len(ordered) - 12
        more_html = f'<p class="page-note">And {more} more topic{"" if more == 1 else "s"}.</p>' if more > 0 else ""
        scenarios_section = f"""<section class="page-section">
  <h2 class="page-section-title">Where ACR recommends this study</h2>
  <div class="topic-grid">
{cards}  </div>
  {more_html}
</section>"""

    indications = esc(indications_text) if indications_text else "No indications recorded for this protocol yet."
    body = f"""{crumbs(*trail)}
{page_intro(esc(display_name), kicker=f'MRI protocol, {esc(region_label)}')}

<section class="page-section">
  <h2 class="page-section-title">Indications</h2>
  <p class="page-text">{indications}</p>
</section>

<section class="page-section">
  <h2 class="page-section-title">Sequences</h2>
  {seq_table}
  <p class="page-note">A sample protocol based on common practice. Your institution's sequences and parameters may differ.</p>
</section>

{scenarios_section}

{page_cta("/#protocols", "Open in the protocol library")}"""

    return render_page(head, body)


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

    # Topic links open the generated guide for that ACR topic
    topics_html = ""
    if topics:
        topic_items = "".join(topic_card(topic["name"], topic["count"]) for topic in topics)
        topics_html = f"""<section class="page-section">
  <h2 class="page-section-title">Clinical topics</h2>
  <div class="topic-grid">
{topic_items}  </div>
</section>"""

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
                proto_items += f'<a href="/protocols/{p_slug}/" class="protocol-list-item"><span>{html.escape(p_name)}</span></a>\n'
        protocols_html = f"""<section class="page-section">
  <h2 class="page-section-title">MRI protocols</h2>
  <div class="protocol-list">
{proto_items}  </div>
</section>"""

    body = f"""{crumbs(("GRAi Imaging Guide", "/"), ("Topics", "/topics/"), (f"{label} imaging", None))}
{page_intro(f"{label} imaging: ACR Appropriateness Criteria summaries", REGION_INTRO[region])}

{topics_html}

{protocols_html}

{page_cta("/", "Search all scenarios", f'or <a href="/topics/">browse every topic</a>')}"""

    return render_page(head, body, "topics")


LEVELS = ["Usually Appropriate", "May Be Appropriate", "Usually Not Appropriate"]
LEVEL_CLASS = {"Usually Appropriate": "high", "May Be Appropriate": "mid", "Usually Not Appropriate": "low"}


def clean_topic_name(name):
    """ACR writes some topic titles with en or em dashes; show one plain form."""
    return re.sub(r"\s*[\u2013\u2014]\s*", "-", name).strip()


def topic_card(name, count):
    """A link card to one topic page, used on every page that lists topics."""
    return (
        f'<a class="topic-card" href="/topics/{topic_slug(name)}/">'
        f'<span class="topic-card-name">{html.escape(clean_topic_name(name))}</span>'
        f'<span class="topic-card-meta">{count} scenario{"" if count == 1 else "s"}</span></a>\n'
    )


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
        links = "".join(topic_card(r["name"], len(r["scenarios"])) for r in related)
        related_html = f"""<section class="page-section">
  <h2 class="page-section-title">Related {esc(region_label.lower())} topics</h2>
  <div class="topic-grid">
{links}  </div>
</section>"""

    lede = (
        f'{count} clinical scenario{plural} from the ACR Appropriateness Criteria topic "{esc(name)}", grouped by the '
        f"imaging study ACR rates highest for each. Studies listed together share the same ACR category; "
        f"ACR does not rank studies within a category."
    )
    body = f"""{crumbs(("GRAi Imaging Guide", "/"), (f"{esc(region_label)} imaging", f"/regions/{region}/"), (esc(name), None))}
{page_intro(f"{esc(name)}: ACR Appropriateness Criteria summary", lede, kicker="Which imaging to order")}
<p class="page-note">
  Independent summary of the ACR Appropriateness Criteria as of {month}. Not affiliated with or endorsed by
  the American College of Radiology. For education; confirm against the linked source and your institution's protocols.
</p>

{page_cta(f"/?q={quote(name)}", "Narrow to your patient", "Opens this topic in the search, with buttons that narrow it by presentation.")}

{sections}

{related_html}"""

    return render_page(head, body, "topics")


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
    jump = []
    for region, label in REGION_DISPLAY.items():
        in_region = sorted((t for t in topics.values() if t["region"] == region), key=lambda t: t["name"])
        if not in_region:
            continue
        links = "".join(topic_card(t["name"], len(t["scenarios"])) for t in in_region)
        jump.append(f'<li><a href="#{region}">{label}</a></li>')
        sections += f"""<section class="page-section" id="{region}">
  <h2 class="page-section-title"><a href="/regions/{region}/">{label} imaging</a> <span class="page-section-count">{len(in_region)} topics</span></h2>
  <div class="topic-grid">
{links}  </div>
</section>
"""
    lede = (
        f"{len(topics)} clinical topics covering {total:,} scenarios. Each page lists which imaging studies the "
        f"ACR Appropriateness Criteria rate usually appropriate, grouped by presentation."
    )
    body = f"""{crumbs(("GRAi Imaging Guide", "/"), ("Topics", None))}
{page_intro("Imaging appropriateness by topic", lede)}
<nav class="jump-links" aria-label="Body regions"><ul>{"".join(jump)}</ul></nav>
{sections}
{page_cta("/", "Search all scenarios")}"""
    return render_page(head, body, "topics")


def render_not_found():
    """Returns complete HTML for 404.html, which GitHub Pages serves for unknown URLs."""
    head = shared_head("Page not found | GRAi Imaging Guide", "This page does not exist.", f"{BASE_URL}/", {
        "@context": "https://schema.org", "@type": "WebPage", "name": "Page not found",
    }).replace('content="index, follow"', 'content="noindex, follow"')
    body = f"""{page_intro("Page not found", "That address does not exist on GRAi Imaging Guide. Search for a clinical scenario or browse by topic.")}
{page_cta("/", "Search all scenarios", 'or <a href="/topics/">browse every topic</a>')}"""
    return render_page(head, body)


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

    stats = "\n".join(f"    <li>{s}</li>" for s in [
        "3,900+ clinical scenarios across 260+ topics",
        "72+ MRI protocols with sequence-level guidance",
        "Every recommendation links to its ACR source scenario",
        "Client-side AI inference - fully private, no data sent to servers",
        "Offline-capable via Progressive Web App (PWA)",
    ])

    region_links = "\n".join(
        f'    <a href="/regions/{r}/" class="protocol-list-item"><span>{label} imaging</span></a>'
        for r, label in REGION_DISPLAY.items()
    )

    body = f"""{crumbs(("GRAi Imaging Guide", "/"), ("About", None))}
{page_intro("About GRAi Imaging Guide", kicker="Formerly called Radex.")}
<p class="page-text page-text-lead">
  GRAi Imaging Guide is an educational reference that helps clinicians find generic imaging guidance quickly,
  without working through the full ACR Appropriateness Criteria scenario by scenario. It is an
  independent project and is not affiliated with or endorsed by the American College of Radiology.
</p>

<section class="page-section">
  <h2 class="page-section-title">Built by</h2>
  <p class="page-text"><strong>Patrick Matulich, DO</strong><br><span class="page-muted">Radiology Resident | CoreGRAI</span></p>
  <p class="page-text">
    GRAi Imaging Guide was developed as a capstone project in radiology AI, motivated by a recurring challenge
    in clinical training: imaging appropriateness guidelines exist, but accessing them quickly at
    the point of care remains cumbersome. GRAi Imaging Guide is designed to reduce time-to-answer from minutes
    to seconds while keeping every answer traceable to its source.
  </p>
</section>

<section class="page-section">
  <h2 class="page-section-title">Key statistics</h2>
  <ul class="page-list">
{stats}
  </ul>
</section>

<section class="page-section">
  <h2 class="page-section-title">Data sources and methodology</h2>
  <p class="page-text">
    <strong>Source:</strong> Guidance is summarized from the ACR Appropriateness Criteria,
    evidence-based guidelines developed by the American College of Radiology. GRAi Imaging Guide shows when its
    data was captured, and that date may lag ACR updates, so confirm against the linked source.
  </p>
  <p class="page-text">
    <strong>How answers are built:</strong> A broad search opens a topic guide that groups scenarios
    by what they recommend. A specific search goes to matching scenarios, with pregnancy and patient
    age applied as filters. ACR categories are shown as published, including panel disagreement
    flags, and studies in the same category are listed together because ACR does not rank them.
  </p>
  <p class="page-text">
    <strong>MRI Protocols:</strong> Sample protocols based on common clinical practice.
    Your institution may have different sequences, parameters, or protocols based on
    scanner hardware, software versions, radiologist preferences, and institutional policies.
  </p>
  <p class="page-text">
    <strong>AI:</strong> When no scenario matches a search directly, a small model running in your
    browser suggests the closest scenarios by meaning. These results are labelled as closest
    matches. Nothing you type is sent to a server for search.
  </p>
</section>

<section class="page-section">
  <h2 class="page-section-title">Browse by region</h2>
  <div class="protocol-list">
{region_links}
  </div>
</section>

<section class="page-section">
  <h2 class="page-section-title">Important notice</h2>
  <p class="page-text">
    This tool is provided for <strong>educational purposes only</strong>. It is not a substitute
    for clinical judgment, institutional protocols, or direct consultation with radiologists.
    Imaging decisions should always be made in the context of individual patient circumstances.
  </p>
</section>

<section class="page-section">
  <h2 class="page-section-title">Also by CoreGRAI</h2>
  <p class="page-text">
    <a href="https://coregrai.com" target="_blank" rel="noopener">GRAi</a>
    is an AI-powered radiology study and clinical reference platform built for residents
    preparing for the ABR Core Exam. It provides AI-assisted Q&amp;A across radiology topics,
    radiology corpus search powered by a proprietary knowledge base and custom retrieval model,
    differential diagnosis support, and structured lesson content - all through a conversational
    interface. Also built by Patrick Matulich, DO.
  </p>
</section>

<section class="page-section">
  <h2 class="page-section-title">Contact</h2>
  <p class="page-text">Questions or suggestions? <a href="mailto:support@coregrai.com">support@coregrai.com</a></p>
</section>

{page_cta("/", "Search all scenarios")}"""

    return render_page(head, body, "about")


def render_privacy():
    """The privacy policy and terms, on the shared page shell. The policy text
    is the owner's; change its wording only on the owner's word."""
    canonical = f"{BASE_URL}/privacy-policy.html"
    head = shared_head(
        "Privacy Policy and Terms | GRAi Imaging Guide",
        "Privacy policy, terms of use and medical disclaimer for GRAi Imaging Guide, an educational imaging reference for clinicians.",
        canonical,
        {"@context": "https://schema.org", "@type": "WebPage", "name": "Privacy Policy", "url": canonical},
    )

    def section(title, inner):
        return f'<section class="page-section">\n  <h2 class="page-section-title">{title}</h2>\n{inner}\n</section>\n'

    def ul(*items):
        return '  <ul class="page-list">\n' + "".join(f"    <li>{i}</li>\n" for i in items) + "  </ul>"

    def p(text):
        return f'  <p class="page-text">{text}</p>'

    body = f"""{crumbs(("GRAi Imaging Guide", "/"), ("Privacy policy", None))}
{page_intro("Privacy policy", kicker="Effective January 1, 2025. Last updated November 11, 2026.")}

<aside class="page-callout" aria-labelledby="disclaimer-title">
  <h2 class="page-callout-title" id="disclaimer-title">Important medical disclaimer</h2>
  <p><strong>For educational use only:</strong> This website and its content are provided solely for educational purposes and professional reference for qualified healthcare professionals.</p>
  <p><strong>Not for medical diagnosis:</strong> The information contained herein is NOT intended for use in medical diagnosis, treatment planning, or patient care decisions. This content should never be used as a substitute for professional medical judgment, clinical assessment, or direct patient consultation.</p>
  <p><strong>Healthcare professionals only:</strong> This resource is intended exclusively for use by licensed healthcare professionals, including but not limited to physicians, radiologists, technologists, and other qualified medical personnel. It should not be accessed or relied upon by patients or the general public for medical decisions.</p>
</aside>

{section("1. About GRAi Imaging Guide", p("GRAi Imaging Guide is an educational platform designed to provide imaging protocol information and guidelines for healthcare professionals. Our mission is to serve as a reference tool for qualified medical personnel in their professional practice."))}
{section("2. Information we collect", "\n".join([
    p("<strong>We do not collect your information.</strong> The site has no accounts, no analytics and no tracking. Searches run entirely in your browser; nothing you type is sent to us or to anyone else."),
    p("<strong>No patient information:</strong> We do not collect, store, or process any personal health information (PHI) or patient data. Please do not enter patient identifiers into the search."),
    p("<strong>Saved on your device:</strong> Your browser keeps a few preferences, such as your recent searches and display settings, and a copy of the site so it works offline. These stay on your device and are never transmitted to us. Clearing your browser's site data removes them."),
    p("<strong>Hosting:</strong> The site is served by GitHub Pages. Like any web host, GitHub may record technical details of each page request, such as your IP address, under its own privacy statement. We do not receive or use that data."),
]))}
{section("3. Professional responsibility", p("<strong>Healthcare Provider Responsibility:</strong> Healthcare professionals using this platform are responsible for:") + "\n" + ul(
    "Verifying all information against current medical standards", "Exercising independent professional judgment",
    "Ensuring compliance with local regulations and institutional policies",
    "Maintaining patient confidentiality in accordance with applicable laws"))}
{section("4. Limitation of liability", p("GRAi Imaging Guide and its operators disclaim all liability for any direct, indirect, incidental, or consequential damages arising from the use of this educational platform. Users assume all responsibility for the appropriate use of this information in their professional practice."))}
{section("5. Changes to this policy", p("We may update this privacy policy periodically. Changes will be posted on this page with an updated effective date. Continued use of the platform constitutes acceptance of any changes."))}
{section("6. Age restrictions", p("This platform is intended for use by licensed healthcare professionals only. It is not intended for use by individuals under 18 years of age or by unlicensed individuals seeking medical information."))}
{section("Contact information", p("If you have questions about this privacy policy or concerns about our practices, please contact us through the appropriate professional channels.") + "\n" + p("<strong>Remember:</strong> This platform is for educational purposes only and should never replace professional medical consultation, institutional protocols, or evidence-based clinical decision-making."))}"""
    return render_page(head, body)


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
    with open(REPO_ROOT / "data" / "search" / "protocol_scenarios.json", encoding="utf-8") as f:
        routed = json.load(f)["protocols"]
    for i, protocol in enumerate(protocols):
        slug = slug_map[i]
        page = render_protocol(protocol, slug, routed.get(f'{protocol.get("name")}|{protocol.get("body_region")}', []))
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

    write_file(Path("privacy-policy.html"), render_privacy())
    count += 1

    # Sitemap
    sitemap_xml = build_sitemap(list(slug_map.values()), sorted(topics))
    write_file(Path("sitemap.xml"), sitemap_xml)
    count += 1

    print(f"Written {count} files")


if __name__ == "__main__":
    main()
