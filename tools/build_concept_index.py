#!/usr/bin/env python3
"""
Build Concept Index for Radex Semantic Search

This script generates a concept-to-scenario mapping index that enables
concept-based search with clinical phase grouping.

Usage:
    python tools/build_concept_index.py

Output:
    data/search/concept_index.json
"""

import json
import re
import os
from pathlib import Path
from collections import defaultdict

# Phase detection patterns
PHASE_PATTERNS = {
    "screening": [
        r"\bscreening\b",
        r"\basymptomatic\b",
        r"\brisk factors?\b",
        r"\bsurveillance.*(no|without).*(symptoms|recurrence)\b",
        r"\baverage risk\b",
        r"\bhigh risk\b(?!.*recurrence)",
        r"\belevated risk\b"
    ],
    "initial": [
        r"\binitial\b",
        r"\bsuspected\b(?!.*treated|.*recurrence)",
        r"\bnew onset\b",
        r"\bfirst presentation\b",
        r"\bdiagnosis\b(?!.*post|.*surveillance)",
        r"\bevaluation\b(?!.*post|.*surveillance|.*follow)",
        r"\bnewly diagnosed\b"
    ],
    "pretreatment": [
        r"\bpretreatment\b",
        r"\bstaging\b(?!.*restaging)",
        r"\bpreoperative\b",
        r"\bpre-op\b",
        r"\bsurgical planning\b",
        r"\bpre-tx\b",
        r"\bneoadjuvant\b",
        r"\bdetermining extent\b"
    ],
    "surveillance": [
        r"\bsurveillance\b",
        r"\bfollow[- ]?up\b",
        r"\btreated\b",
        r"\brecurrence\b",
        r"\bpost[- ]?treatment\b",
        r"\bpost[- ]?tx\b",
        r"\brestaging\b",
        r"\bmonitoring\b",
        r"\bpost[- ]?procedure\b",
        r"\bafter.*(surgery|treatment|therapy|resection)\b"
    ],
    "complication": [
        r"\bcomplication\b",
        r"\benlarg\w+\s+lesion\b",
        r"\bnew lesion\b",
        r"\bprogression\b",
        r"\bworsen\b",
        r"\bfailure\b",
        r"\bno response\b"
    ]
}

# Context patterns for additional metadata
CONTEXT_PATTERNS = {
    "tumor_location": {
        "intra-axial": r"\bintra-?axial\b",
        "extra-axial": r"\bextra-?axial\b",
        "metastatic": r"\bmetasta\w+\b",
        "primary": r"\bprimary\b(?!.*metasta)",
        "local": r"\blocal\b(?!.*metasta)"
    },
    "clinical_status": {
        "suspected": r"\bsuspected\b",
        "known": r"\bknown\b",
        "treated": r"\btreated\b",
        "recurrent": r"\brecurr\w+\b"
    },
    "age_group": {
        "pediatric": r"\bpediatric\b|\bchild\b|\binfant\b|\bneonate\b",
        "adult": r"\badult\b"
    }
}

# Concept taxonomy - medical concepts with their synonyms and body region
CONCEPT_TAXONOMY = {
    # Neuro concepts
    "brain_neoplasm": {
        "display_name": "Brain Tumor",
        "body_region": "neuro",
        "synonyms": ["brain tumor", "brain mass", "intracranial tumor", "brain cancer",
                     "brain neoplasm", "intracranial mass", "cerebral tumor", "glioma",
                     "astrocytoma", "meningioma", "brain mets", "brain metastasis",
                     "brain metastases", "intra-axial mass", "extra-axial mass"],
        "scenario_keywords": ["brain tumor", "intracranial", "brain mass", "glioma",
                              "meningioma", "brain mets", "brain metasta"]
    },
    "stroke": {
        "display_name": "Stroke",
        "body_region": "neuro",
        "synonyms": ["stroke", "cva", "cerebrovascular accident", "ischemic stroke",
                     "hemorrhagic stroke", "brain infarct", "cerebral infarction",
                     "acute stroke", "transient ischemic attack", "tia"],
        "scenario_keywords": ["stroke", "ischemic", "hemorrhage", "cerebrovascular",
                              "infarct", "transient ischemic"]
    },
    "headache": {
        "display_name": "Headache",
        "body_region": "neuro",
        "synonyms": ["headache", "head pain", "cephalgia", "migraine", "tension headache",
                     "cluster headache", "chronic headache", "new headache"],
        "scenario_keywords": ["headache", "head pain", "migraine", "cephalgia"]
    },
    "dementia": {
        "display_name": "Dementia",
        "body_region": "neuro",
        "synonyms": ["dementia", "alzheimer", "cognitive decline", "memory loss",
                     "neurodegenerative", "cognitive impairment"],
        "scenario_keywords": ["dementia", "alzheimer", "cognitive", "memory"]
    },
    "seizure": {
        "display_name": "Seizure",
        "body_region": "neuro",
        "synonyms": ["seizure", "epilepsy", "convulsion", "fits", "new onset seizure",
                     "epileptic", "seizure disorder"],
        "scenario_keywords": ["seizure", "epilepsy", "convulsion"]
    },
    "multiple_sclerosis": {
        "display_name": "Multiple Sclerosis",
        "body_region": "neuro",
        "synonyms": ["multiple sclerosis", "ms", "demyelinating disease", "demyelination",
                     "white matter disease"],
        "scenario_keywords": ["multiple sclerosis", "demyelinat"]
    },
    "hydrocephalus": {
        "display_name": "Hydrocephalus",
        "body_region": "neuro",
        "synonyms": ["hydrocephalus", "ventriculomegaly", "enlarged ventricles",
                     "csf obstruction", "normal pressure hydrocephalus", "nph"],
        "scenario_keywords": ["hydrocephalus", "ventriculomegaly", "ventricle"]
    },

    # Spine concepts
    "back_pain": {
        "display_name": "Back Pain",
        "body_region": "spine",
        "synonyms": ["back pain", "low back pain", "lbp", "lumbar pain", "spine pain",
                     "backache", "thoracic pain", "cervical pain", "neck pain"],
        "scenario_keywords": ["back pain", "low back", "lumbar pain", "spine pain"]
    },
    "radiculopathy": {
        "display_name": "Radiculopathy",
        "body_region": "spine",
        "synonyms": ["radiculopathy", "sciatica", "nerve root compression", "pinched nerve",
                     "disc herniation", "herniated disc", "bulging disc", "slipped disc"],
        "scenario_keywords": ["radiculopathy", "sciatica", "nerve root", "disc herniat"]
    },
    "spinal_stenosis": {
        "display_name": "Spinal Stenosis",
        "body_region": "spine",
        "synonyms": ["spinal stenosis", "canal stenosis", "narrowing of spine",
                     "neurogenic claudication"],
        "scenario_keywords": ["spinal stenosis", "canal stenosis"]
    },
    "spinal_tumor": {
        "display_name": "Spinal Tumor",
        "body_region": "spine",
        "synonyms": ["spinal tumor", "spine tumor", "spinal cord tumor", "vertebral tumor",
                     "spine mass", "spinal metastasis", "spine mets"],
        "scenario_keywords": ["spinal tumor", "spine tumor", "vertebral", "spinal cord"]
    },
    "myelopathy": {
        "display_name": "Myelopathy",
        "body_region": "spine",
        "synonyms": ["myelopathy", "spinal cord compression", "cervical myelopathy",
                     "cord compression"],
        "scenario_keywords": ["myelopathy", "spinal cord compress", "cord compress"]
    },

    # Chest concepts
    "lung_nodule": {
        "display_name": "Lung Nodule",
        "body_region": "chest",
        "synonyms": ["lung nodule", "pulmonary nodule", "lung lesion", "solitary pulmonary nodule",
                     "spn", "lung mass", "pulmonary mass"],
        "scenario_keywords": ["lung nodule", "pulmonary nodule", "lung mass", "pulmonary mass"]
    },
    "lung_cancer": {
        "display_name": "Lung Cancer",
        "body_region": "chest",
        "synonyms": ["lung cancer", "lung carcinoma", "bronchogenic carcinoma", "nsclc",
                     "sclc", "lung malignancy", "pulmonary carcinoma"],
        "scenario_keywords": ["lung cancer", "lung carcinoma", "bronchogenic", "non-small cell",
                              "small cell lung"]
    },
    "pulmonary_embolism": {
        "display_name": "Pulmonary Embolism",
        "body_region": "chest",
        "synonyms": ["pulmonary embolism", "pe", "blood clot in lung", "lung clot",
                     "pulmonary thromboembolism"],
        "scenario_keywords": ["pulmonary embol", "suspected pe", "venous thromboembol"]
    },
    "pneumonia": {
        "display_name": "Pneumonia",
        "body_region": "chest",
        "synonyms": ["pneumonia", "lung infection", "chest infection", "respiratory infection",
                     "community acquired pneumonia", "hospital acquired pneumonia"],
        "scenario_keywords": ["pneumonia", "lung infection"]
    },
    "chest_pain": {
        "display_name": "Chest Pain",
        "body_region": "chest",
        "synonyms": ["chest pain", "thoracic pain", "angina", "cardiac chest pain",
                     "non-cardiac chest pain", "atypical chest pain"],
        "scenario_keywords": ["chest pain", "thoracic pain", "angina"]
    },

    # Abdomen concepts
    "liver_lesion": {
        "display_name": "Liver Lesion",
        "body_region": "abdomen",
        "synonyms": ["liver lesion", "hepatic lesion", "liver mass", "hepatic mass",
                     "liver tumor", "hepatic tumor", "liver nodule", "focal liver lesion"],
        "scenario_keywords": ["liver lesion", "hepatic lesion", "liver mass", "hepatic mass",
                              "focal liver"]
    },
    "liver_cancer": {
        "display_name": "Liver Cancer",
        "body_region": "abdomen",
        "synonyms": ["liver cancer", "hcc", "hepatocellular carcinoma", "hepatoma",
                     "liver malignancy", "cholangiocarcinoma"],
        "scenario_keywords": ["hepatocellular", "hcc", "liver cancer", "cholangiocarcinoma"]
    },
    "appendicitis": {
        "display_name": "Appendicitis",
        "body_region": "abdomen",
        "synonyms": ["appendicitis", "appendix inflammation", "acute appendicitis",
                     "rlq pain", "right lower quadrant pain"],
        "scenario_keywords": ["appendicitis", "appendix"]
    },
    "abdominal_pain": {
        "display_name": "Abdominal Pain",
        "body_region": "abdomen",
        "synonyms": ["abdominal pain", "belly pain", "stomach pain", "acute abdomen",
                     "abdominal discomfort"],
        "scenario_keywords": ["abdominal pain", "acute abdomen"]
    },
    "pancreatic_mass": {
        "display_name": "Pancreatic Mass",
        "body_region": "abdomen",
        "synonyms": ["pancreatic mass", "pancreas mass", "pancreatic lesion", "pancreatic tumor",
                     "pancreatic cancer", "pancreatic cyst"],
        "scenario_keywords": ["pancrea"]
    },
    "kidney_mass": {
        "display_name": "Kidney Mass",
        "body_region": "abdomen",
        "synonyms": ["kidney mass", "renal mass", "kidney lesion", "renal lesion",
                     "kidney tumor", "renal tumor", "kidney cancer", "renal cell carcinoma",
                     "rcc"],
        "scenario_keywords": ["kidney", "renal mass", "renal cell", "renal lesion"]
    },
    "bowel_obstruction": {
        "display_name": "Bowel Obstruction",
        "body_region": "abdomen",
        "synonyms": ["bowel obstruction", "intestinal obstruction", "sbo", "small bowel obstruction",
                     "large bowel obstruction", "ileus"],
        "scenario_keywords": ["bowel obstruction", "intestinal obstruction", "ileus"]
    },
    "colon_cancer": {
        "display_name": "Colon Cancer",
        "body_region": "abdomen",
        "synonyms": ["colon cancer", "colorectal cancer", "rectal cancer", "colorectal carcinoma",
                     "colonic mass", "colon mass"],
        "scenario_keywords": ["colon", "colorectal", "rectal cancer"]
    },
    "cholecystitis": {
        "display_name": "Cholecystitis",
        "body_region": "abdomen",
        "synonyms": ["cholecystitis", "gallbladder inflammation", "gallstones", "cholelithiasis",
                     "biliary colic", "ruq pain", "right upper quadrant pain"],
        "scenario_keywords": ["cholecystitis", "gallbladder", "gallstone", "biliary"]
    },

    # MSK concepts
    "knee_pain": {
        "display_name": "Knee Pain",
        "body_region": "msk",
        "synonyms": ["knee pain", "knee injury", "knee trauma", "knee problem",
                     "acl tear", "meniscus tear", "ligament injury"],
        "scenario_keywords": ["knee"]
    },
    "shoulder_pain": {
        "display_name": "Shoulder Pain",
        "body_region": "msk",
        "synonyms": ["shoulder pain", "shoulder injury", "rotator cuff", "shoulder trauma",
                     "rotator cuff tear", "shoulder impingement"],
        "scenario_keywords": ["shoulder"]
    },
    "hip_pain": {
        "display_name": "Hip Pain",
        "body_region": "msk",
        "synonyms": ["hip pain", "hip injury", "hip trauma", "hip fracture",
                     "avascular necrosis", "avn", "hip avascular necrosis"],
        "scenario_keywords": ["hip"]
    },
    "bone_tumor": {
        "display_name": "Bone Tumor",
        "body_region": "msk",
        "synonyms": ["bone tumor", "bone mass", "bone lesion", "bone cancer",
                     "primary bone tumor", "osteosarcoma", "bone metastasis", "bone mets"],
        "scenario_keywords": ["bone tumor", "bone mass", "bone lesion", "osteosarcoma",
                              "primary bone"]
    },
    "fracture": {
        "display_name": "Fracture",
        "body_region": "msk",
        "synonyms": ["fracture", "broken bone", "bone fracture", "stress fracture",
                     "pathologic fracture", "insufficiency fracture"],
        "scenario_keywords": ["fracture"]
    },
    "soft_tissue_mass": {
        "display_name": "Soft Tissue Mass",
        "body_region": "msk",
        "synonyms": ["soft tissue mass", "soft tissue tumor", "soft tissue sarcoma",
                     "muscle mass", "subcutaneous mass", "lipoma"],
        "scenario_keywords": ["soft tissue mass", "soft tissue tumor"]
    },

    # Vascular concepts
    "aortic_aneurysm": {
        "display_name": "Aortic Aneurysm",
        "body_region": "vascular",
        "synonyms": ["aortic aneurysm", "aaa", "abdominal aortic aneurysm", "thoracic aneurysm",
                     "aortic dilation", "aneurysm"],
        "scenario_keywords": ["aortic aneurysm", "aaa", "abdominal aortic", "thoracic aortic"]
    },
    "aortic_dissection": {
        "display_name": "Aortic Dissection",
        "body_region": "vascular",
        "synonyms": ["aortic dissection", "dissecting aneurysm", "type a dissection",
                     "type b dissection"],
        "scenario_keywords": ["aortic dissection", "dissecting"]
    },
    "dvt": {
        "display_name": "Deep Vein Thrombosis",
        "body_region": "vascular",
        "synonyms": ["dvt", "deep vein thrombosis", "deep venous thrombosis", "leg clot",
                     "venous thrombosis", "lower extremity dvt"],
        "scenario_keywords": ["deep vein", "dvt", "venous thrombosis"]
    },
    "peripheral_vascular": {
        "display_name": "Peripheral Vascular Disease",
        "body_region": "vascular",
        "synonyms": ["peripheral vascular disease", "pvd", "peripheral arterial disease", "pad",
                     "claudication", "limb ischemia"],
        "scenario_keywords": ["peripheral vascular", "peripheral arterial", "claudication"]
    },
    "carotid_stenosis": {
        "display_name": "Carotid Stenosis",
        "body_region": "vascular",
        "synonyms": ["carotid stenosis", "carotid artery disease", "carotid occlusion",
                     "carotid plaque"],
        "scenario_keywords": ["carotid"]
    },

    # Breast concepts
    "breast_mass": {
        "display_name": "Breast Mass",
        "body_region": "breast",
        "synonyms": ["breast mass", "breast lump", "breast lesion", "breast nodule",
                     "palpable breast mass"],
        "scenario_keywords": ["breast mass", "breast lump", "breast lesion"]
    },
    "breast_cancer": {
        "display_name": "Breast Cancer",
        "body_region": "breast",
        "synonyms": ["breast cancer", "breast carcinoma", "breast malignancy", "dcis",
                     "ductal carcinoma", "lobular carcinoma"],
        "scenario_keywords": ["breast cancer", "breast carcinoma", "ductal", "lobular"]
    },
    "breast_screening": {
        "display_name": "Breast Screening",
        "body_region": "breast",
        "synonyms": ["breast screening", "mammogram", "mammography", "breast cancer screening",
                     "dense breasts", "high risk screening"],
        "scenario_keywords": ["screening", "mammogra", "dense breast"]
    },

    # Peds concepts
    "pediatric_abdominal_pain": {
        "display_name": "Pediatric Abdominal Pain",
        "body_region": "peds",
        "synonyms": ["pediatric abdominal pain", "child belly pain", "child stomach ache",
                     "pediatric appendicitis"],
        "scenario_keywords": ["abdominal pain", "appendicitis"]
    },
    "pediatric_head_injury": {
        "display_name": "Pediatric Head Injury",
        "body_region": "peds",
        "synonyms": ["pediatric head injury", "child head trauma", "pediatric head trauma",
                     "child concussion"],
        "scenario_keywords": ["head injury", "head trauma", "concussion"]
    }
}


def detect_phase(scenario_name):
    """Detect clinical phase from scenario name."""
    name_lower = scenario_name.lower()

    # Check each phase pattern
    phase_scores = {}
    for phase, patterns in PHASE_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, name_lower, re.IGNORECASE):
                phase_scores[phase] = phase_scores.get(phase, 0) + 1

    if not phase_scores:
        return "initial"  # Default to initial if no match

    # Return phase with highest score
    return max(phase_scores, key=phase_scores.get)


def detect_context(scenario_name):
    """Extract context metadata from scenario name."""
    name_lower = scenario_name.lower()
    context = {}

    for category, patterns in CONTEXT_PATTERNS.items():
        for value, pattern in patterns.items():
            if re.search(pattern, name_lower, re.IGNORECASE):
                context[category] = value
                break

    return context


def calculate_relevance(scenario_name, concept_keywords):
    """Calculate relevance score between scenario and concept (0.0 to 1.0)."""
    name_lower = scenario_name.lower()

    # Count keyword matches
    matches = 0
    total = len(concept_keywords)

    for keyword in concept_keywords:
        keyword_lower = keyword.lower()
        if keyword_lower in name_lower:
            # Exact match gets higher weight
            matches += 1

    if total == 0:
        return 0.0

    return min(1.0, matches / max(total, 3))  # Normalize against at least 3 keywords


def get_phase_display(phase):
    """Get display-friendly phase name."""
    display_names = {
        "screening": "Screening",
        "initial": "Initial Workup",
        "pretreatment": "Pretreatment Staging",
        "surveillance": "Surveillance",
        "complication": "Complication Assessment"
    }
    return display_names.get(phase, phase.title())


def build_concept_index(data_dir, output_path):
    """Build the concept index from region JSON files."""
    regions_dir = data_dir / "regions"

    # Load all scenarios from all regions
    all_scenarios = []

    region_files = list(regions_dir.glob("*.json"))
    print(f"Found {len(region_files)} region files")

    for region_file in region_files:
        region_name = region_file.stem
        print(f"Loading {region_name}...")

        with open(region_file, 'r', encoding='utf-8') as f:
            region_data = json.load(f)

        scenarios = region_data.get("scenarios", [])
        for scenario in scenarios:
            scenario["_region"] = region_name
            all_scenarios.append(scenario)

    print(f"Loaded {len(all_scenarios)} total scenarios")

    # Build concept index
    concept_index = {
        "version": "1.0",
        "generated_at": None,  # Will be set at runtime
        "concepts": {},
        "synonym_to_concept": {}
    }

    # Process each concept
    for concept_id, concept_def in CONCEPT_TAXONOMY.items():
        print(f"Processing concept: {concept_def['display_name']}")

        # Find matching scenarios
        scenario_mappings = []

        for scenario in all_scenarios:
            scenario_name = scenario.get("name", "")
            scenario_region = scenario.get("_region", "")

            # Check if scenario matches this concept
            keywords = concept_def.get("scenario_keywords", [])
            relevance = calculate_relevance(scenario_name, keywords)

            # Also check body region match
            region_match = (concept_def.get("body_region") == scenario_region)

            if relevance > 0.2 or (region_match and relevance > 0.1):
                # Boost relevance for region match
                if region_match:
                    relevance = min(1.0, relevance + 0.2)

                # Detect phase and context
                phase = detect_phase(scenario_name)
                context = detect_context(scenario_name)

                # Get procedure summary
                procedures = scenario.get("procedures", [])
                high_rated = [p for p in procedures if p.get("rating", 0) >= 7]

                mapping = {
                    "scenario_id": scenario.get("id"),
                    "scenario_name": scenario_name,
                    "relevance_score": round(relevance, 2),
                    "region": scenario_region,
                    "metadata": {
                        "phase": phase,
                        "phase_display": get_phase_display(phase),
                        "context": context,
                        "procedure_count": len(procedures),
                        "high_rated_count": len(high_rated)
                    }
                }

                scenario_mappings.append(mapping)

        # Sort by relevance and limit
        scenario_mappings.sort(key=lambda x: x["relevance_score"], reverse=True)

        if scenario_mappings:
            concept_index["concepts"][concept_id] = {
                "display_name": concept_def["display_name"],
                "body_region": concept_def["body_region"],
                "synonyms": concept_def["synonyms"],
                "scenario_mappings": scenario_mappings[:50]  # Limit to top 50
            }

            print(f"  Found {len(scenario_mappings)} matching scenarios")

    # Build synonym lookup
    for concept_id, concept_def in CONCEPT_TAXONOMY.items():
        for synonym in concept_def.get("synonyms", []):
            syn_lower = synonym.lower()
            concept_index["synonym_to_concept"][syn_lower] = concept_id

    # Add timestamp
    from datetime import datetime, timezone
    concept_index["generated_at"] = datetime.now(timezone.utc).isoformat()

    # Write output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(concept_index, f, indent=2, ensure_ascii=False)

    print(f"\nConcept index written to {output_path}")
    print(f"Total concepts: {len(concept_index['concepts'])}")
    print(f"Total synonym mappings: {len(concept_index['synonym_to_concept'])}")

    return concept_index


def main():
    # Get paths relative to script location
    script_dir = Path(__file__).parent
    project_root = script_dir.parent

    data_dir = project_root / "data"
    output_path = data_dir / "search" / "concept_index.json"

    print("Building Radex Concept Index")
    print("=" * 40)

    build_concept_index(data_dir, output_path)

    print("\nDone!")


if __name__ == "__main__":
    main()
