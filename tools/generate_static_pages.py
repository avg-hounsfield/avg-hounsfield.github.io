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
