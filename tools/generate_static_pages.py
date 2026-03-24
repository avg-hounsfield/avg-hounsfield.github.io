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
