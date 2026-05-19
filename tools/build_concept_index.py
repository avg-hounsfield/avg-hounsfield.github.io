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

# Phase detection patterns - order matters for priority
PHASE_PATTERNS = {
    "screening": [
        r"\bscreening\b",
        r"\basymptomatic\b",
        r"\brisk factors?\b",
        r"\baverage risk\b",
        r"\bhigh risk\b(?!.*recurrence)",
        r"\belevated risk\b",
        r"\blifetime risk\b",
        r"\bfamily h(x|istory)\b",
        r"\bgenetic\b"
    ],
    "initial": [
        r"\binitial\b",
        r"\bsuspected\b",
        r"\bnew onset\b",
        r"\bfirst presentation\b",
        r"\bdiagnosis\b(?!.*post)",
        r"\bevaluation\b(?!.*post|.*follow)",
        r"\bnewly diagnosed\b",
        r"\bcharacterization\b",
        r"\bworkup\b",
        r"\bacute\b(?!.*on chronic)",
        r"\bpresenting\b",
        r"\bunknown etiology\b"
    ],
    "pretreatment": [
        r"\bpretreatment\b",
        r"\bstaging\b(?!.*restaging)",
        r"\bpreoperative\b",
        r"\bpre-op\b",
        r"\bsurgical planning\b",
        r"\bpre-tx\b",
        r"\bneoadjuvant\b",
        r"\bdetermining extent\b",
        r"\bpreprocedure\b",
        r"\bplanning\b"
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
        r"\bafter.*(surgery|treatment|therapy|resection)\b",
        r"\bresponse to therapy\b",
        r"\bpost[- ]?operative\b",
        r"\bknown\b.*\b(cancer|malignancy|tumor)\b"
    ],
    "complication": [
        r"\bcomplication\b",
        r"\benlarg\w+\s+lesion\b",
        r"\bnew lesion\b",
        r"\bprogression\b",
        r"\bworsen(ing)?\b",
        r"\bfailure\b",
        r"\bno response\b",
        r"\btreatment failure\b",
        r"\badverse\b"
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
        "display_name": "Stroke/CVA",
        "body_region": "neuro",
        "synonyms": ["stroke", "cva", "cerebrovascular accident", "ischemic stroke",
                     "hemorrhagic stroke", "brain infarct", "cerebral infarction",
                     "acute stroke", "transient ischemic attack", "tia", "ischemic infarct"],
        "scenario_keywords": ["stroke", "ischemic", "hemorrhage", "cerebrovascular",
                              "infarct", "transient ischemic", "ischemic infarct"]
    },
    "headache": {
        "display_name": "Headache",
        "body_region": "neuro",
        "synonyms": ["headache", "head pain", "cephalgia", "migraine", "tension headache",
                     "cluster headache", "chronic headache", "new headache",
                     "intracranial hypotension", "csf leak", "iih", "pseudotumor cerebri",
                     "idiopathic intracranial hypertension"],
        "scenario_keywords": ["headache", "head pain", "migraine", "cephalgia"]
    },
    "dementia": {
        "display_name": "Dementia/Cognitive Decline",
        "body_region": "neuro",
        "synonyms": ["dementia", "alzheimer", "cognitive decline", "memory loss",
                     "neurodegenerative", "cognitive impairment"],
        "scenario_keywords": ["dementia", "alzheimer", "cognitive", "memory"]
    },
    "seizure": {
        "display_name": "Seizure/Epilepsy",
        "body_region": "neuro",
        "synonyms": ["seizure", "epilepsy", "convulsion", "fits", "new onset seizure",
                     "epileptic", "seizure disorder"],
        "scenario_keywords": ["seizure", "epilepsy", "convulsion"]
    },
    "multiple_sclerosis": {
        "display_name": "Multiple Sclerosis",
        "body_region": "neuro",
        "synonyms": ["multiple sclerosis", "ms", "demyelinating disease", "demyelination",
                     "white matter disease", "transverse myelitis", "myelitis",
                     "optic neuritis", "neuromyelitis optica", "nmo", "adem",
                     "acute disseminated encephalomyelitis"],
        "scenario_keywords": ["multiple sclerosis", "demyelinat"]
    },
    "hydrocephalus": {
        "display_name": "Hydrocephalus",
        "body_region": "neuro",
        "synonyms": ["hydrocephalus", "ventriculomegaly", "enlarged ventricles",
                     "csf obstruction", "normal pressure hydrocephalus", "nph",
                     "chiari malformation", "chiari"],
        "scenario_keywords": ["hydrocephalus", "ventriculomegaly", "ventricle"]
    },
    "intracranial_hemorrhage": {
        "display_name": "Intracranial Hemorrhage",
        "body_region": "neuro",
        "synonyms": ["intracranial hemorrhage", "intracranial bleed",
                     "subdural hematoma", "subdural hemorrhage", "sdh",
                     "epidural hematoma", "epidural hemorrhage", "edh",
                     "subarachnoid hemorrhage", "sah",
                     "intracerebral hemorrhage", "ich",
                     "hemorrhagic stroke", "brain bleed", "brain hemorrhage",
                     "intraventricular hemorrhage", "ivh"],
        "scenario_keywords": ["subarachnoid hemorrhage", "intracranial hemorrhage",
                              "subdural", "epidural hematoma",
                              "hemorrhagic stroke"]
    },

    # Spine concepts
    "back_pain": {
        "display_name": "Back Pain",
        "body_region": "spine",
        "synonyms": ["back pain", "low back pain", "lbp", "lumbar pain", "spine pain",
                     "backache", "back ache", "back hurts", "back is sore",
                     "thoracic pain", "cervical pain", "neck pain",
                     "enthesitis", "sacroiliitis", "axial spondyloarthritis",
                     "ankylosing spondylitis"],
        "scenario_keywords": ["back pain", "low back", "lumbar pain", "spine pain"]
    },
    "radiculopathy": {
        "display_name": "Radiculopathy/Sciatica",
        "body_region": "spine",
        "synonyms": ["radiculopathy", "sciatica", "nerve root compression", "pinched nerve",
                     "disc herniation", "herniated disc", "bulging disc", "slipped disc",
                     "arachnoiditis", "brachial neuritis", "parsonage turner",
                     "parsonage-turner", "brachial plexopathy", "lumbosacral plexopathy"],
        "scenario_keywords": ["radiculopathy", "sciatica", "disc herniat", "degenerative"],
        "negative_keywords": ["trauma", "injury", "fracture", "blunt"]
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
                     "spine mass", "spinal metastasis", "spine mets", "bone tumor spine"],
        "scenario_keywords": ["bone tumor", "spine tumor", "spinal tumor", "vertebral tumor",
                              "spinal metasta", "spine mass", "cord tumor"],
        "negative_keywords": ["cervical cancer"]  # Exclude uterine cervical cancer
    },
    "myelopathy": {
        "display_name": "Myelopathy",
        "body_region": "spine",
        "synonyms": ["myelopathy", "spinal cord compression", "cervical myelopathy",
                     "cord compression", "syringomyelia", "syrinx", "als",
                     "amyotrophic lateral sclerosis", "motor neuron disease",
                     "conus medullaris syndrome", "tethered cord"],
        "scenario_keywords": ["myelopathy", "spinal cord compress", "cord compress"]
    },

    # Chest concepts
    "lung_nodule": {
        "display_name": "Lung Nodule",
        "body_region": "chest",
        "synonyms": ["lung nodule", "pulmonary nodule", "lung lesion", "solitary pulmonary nodule",
                     "spn", "lung mass", "pulmonary mass", "sarcoidosis"],
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
        "synonyms": ["pulmonary embolism", "pulmonary embolus", "pe",
                     "blood clot in lung", "lung clot", "blood clot lung",
                     "pulmonary thromboembolism", "vte chest"],
        "scenario_keywords": ["pulmonary embol", "venous thromboembol"]
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
                     "non-cardiac chest pain", "atypical chest pain",
                     "mi", "myocardial infarction", "stemi", "nstemi",
                     "acute coronary syndrome", "acs", "heart attack"],
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
        "display_name": "Liver Cancer/HCC",
        "body_region": "abdomen",
        "synonyms": ["liver cancer", "hcc", "hepatocellular carcinoma", "hepatoma",
                     "liver malignancy", "cholangiocarcinoma"],
        "scenario_keywords": ["hepatocellular carcinoma", "hcc", "liver cancer",
                              "cholangiocarcinoma", "hepatoma", "liver malignancy"],
        "negative_keywords": ["liver function test", "lfts", "hepatocellular predominance"]
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
                     "pancreatic cancer", "pancreatic adenocarcinoma", "pancreatic cyst"],
        "scenario_keywords": ["pancreatic", "pancreas"]  # Broad match for pancreas scenarios
    },
    "kidney_mass": {
        "display_name": "Kidney Mass",
        "body_region": "abdomen",
        "synonyms": ["kidney mass", "renal mass", "kidney lesion", "renal lesion",
                     "kidney tumor", "renal tumor", "kidney cancer", "renal cell carcinoma",
                     "rcc"],
        "scenario_keywords": ["kidney", "renal mass", "renal cell", "renal lesion"],
        # "adrenal mass" contains "renal mass" as a substring -> wrong routing.
        "negative_keywords": ["adrenal"]
    },
    "adrenal_mass": {
        "display_name": "Adrenal Mass",
        "body_region": "abdomen",
        "synonyms": ["adrenal mass", "adrenal nodule", "adrenal lesion",
                     "adrenal incidentaloma", "adrenal tumor", "adrenal adenoma",
                     "pheochromocytoma", "adrenal hyperplasia"],
        "scenario_keywords": ["adrenal"]
    },
    "pyelonephritis": {
        "display_name": "Pyelonephritis / Kidney Infection",
        "body_region": "abdomen",
        "synonyms": ["pyelonephritis", "kidney infection", "renal infection",
                     "uti with fever", "complicated uti", "perinephric abscess",
                     "renal abscess"],
        "scenario_keywords": ["pyelonephritis", "renal abscess", "perinephric"]
    },
    "inflammatory_bowel_disease": {
        "display_name": "Inflammatory Bowel Disease / Crohn",
        "body_region": "abdomen",
        "synonyms": ["inflammatory bowel disease", "ibd", "crohn", "crohn disease",
                     "crohns", "crohns disease", "ulcerative colitis", "uc",
                     "colitis"],
        "scenario_keywords": ["crohn", "ulcerative colitis", "inflammatory bowel"]
    },
    "prostate": {
        "display_name": "Prostate Cancer / PSA Workup",
        "body_region": "abdomen",
        "synonyms": ["prostate", "prostate cancer", "prostate mass", "prostate carcinoma",
                     "elevated psa", "high psa", "psa elevation", "prostate biopsy"],
        "scenario_keywords": ["prostate"]
    },
    "heart_failure": {
        "display_name": "Heart Failure",
        "body_region": "chest",
        "synonyms": ["heart failure", "congestive heart failure", "chf", "cardiomyopathy",
                     "reduced ejection fraction", "hfref", "hfpef", "diastolic dysfunction",
                     "pulmonary edema"],
        "scenario_keywords": ["heart failure", "cardiomyopathy"]
    },
    "thyroid_neck_mass": {
        "display_name": "Thyroid / Neck Mass",
        "body_region": "neuro",
        # Neck-mass and thyroid scenarios came from "other" via reorganize rules,
        # plus the existing "thyroid_nodule" summary card covers some of them.
        "additional_regions": ["other"],
        "synonyms": ["thyroid mass", "neck mass", "goiter", "thyroid nodule",
                     "thyroid lesion", "thyroid cancer", "parathyroid",
                     "hyperparathyroidism", "lump in neck", "neck lump"],
        "scenario_keywords": ["thyroid", "neck mass", "goiter", "parathyroid"]
    },
    "bowel_obstruction": {
        "display_name": "Bowel Obstruction",
        "body_region": "abdomen",
        "synonyms": ["bowel obstruction", "intestinal obstruction", "sbo", "small bowel obstruction",
                     "large bowel obstruction", "ileus"],
        "scenario_keywords": ["bowel obstruction", "intestinal obstruction", "ileus"]
    },
    "diverticulitis": {
        "display_name": "Diverticulitis / LLQ Pain",
        "body_region": "abdomen",
        "synonyms": ["diverticulitis", "diverticular disease", "diverticulosis",
                     "llq pain", "left lower quadrant pain",
                     "diverticular abscess", "perforated diverticulitis"],
        "scenario_keywords": ["diverticulitis", "llq pain"]
    },
    "colon_cancer": {
        "display_name": "Colon/Colorectal Cancer",
        "body_region": "abdomen",
        "synonyms": ["colon cancer", "colorectal cancer", "rectal cancer", "colorectal carcinoma",
                     "colonic mass", "colon mass"],
        "scenario_keywords": ["colon", "colorectal", "rectal cancer"]
    },
    "cholecystitis": {
        "display_name": "Cholecystitis/Gallbladder",
        "body_region": "abdomen",
        "synonyms": ["cholecystitis", "gallbladder inflammation", "gallstones", "cholelithiasis",
                     "biliary colic", "ruq pain", "right upper quadrant pain"],
        "scenario_keywords": ["cholecystitis", "gallbladder", "gallstone", "biliary colic",
                              "ruq pain", "cholelithiasis"],
        "negative_keywords": ["jaundice", "biliary obstruction"]  # Different from cholecystitis
    },

    # MSK concepts
    "knee_pain": {
        "display_name": "Knee Pain/Injury",
        "body_region": "msk",
        "synonyms": ["knee pain", "knee injury", "knee trauma", "knee problem",
                     "acl tear", "meniscus tear", "ligament injury", "knee arthritis"],
        "scenario_keywords": ["knee"],  # Broad match - knee scenarios are relevant
        "negative_keywords": ["osteomyelitis", "septic arthritis"]  # Route to bone_infection
    },
    "shoulder_pain": {
        "display_name": "Shoulder Pain/Injury",
        "body_region": "msk",
        "synonyms": ["shoulder pain", "shoulder injury", "rotator cuff", "shoulder trauma",
                     "rotator cuff tear", "shoulder impingement",
                     "polymyalgia rheumatica", "pmr"],
        "scenario_keywords": ["shoulder"],  # Broad match
        "negative_keywords": ["osteomyelitis", "septic arthritis"]
    },
    "hip_pain": {
        "display_name": "Hip Pain/Injury",
        "body_region": "msk",
        "synonyms": ["hip pain", "hip injury", "hip trauma", "hip fracture",
                     "avascular necrosis", "avn", "hip avascular necrosis"],
        "scenario_keywords": ["hip"],  # Broad match
        "negative_keywords": ["osteomyelitis", "septic arthritis"]
    },
    "bone_tumor": {
        "display_name": "Bone Tumor",
        "body_region": "msk",
        "synonyms": ["bone tumor", "bone mass", "bone lesion", "bone cancer",
                     "primary bone tumor", "osteosarcoma", "bone metastasis", "bone mets"],
        "scenario_keywords": ["bone tumor", "bone mass", "bone lesion", "osteosarcoma",
                              "primary bone"]
    },
    "bone_infection": {
        "display_name": "Bone Infection / Osteomyelitis",
        "body_region": "msk",
        # Pelvic osteomyelitis is in abdomen, chest-wall osteomyelitis is in chest.
        "additional_regions": ["abdomen", "chest"],
        "synonyms": ["osteomyelitis", "bone infection", "septic arthritis", "septic joint",
                     "joint infection", "osteo"],
        "scenario_keywords": ["osteomyelitis", "septic arthritis"]
    },
    "spine_infection": {
        "display_name": "Spine Infection / Vertebral Osteomyelitis",
        "body_region": "spine",
        "synonyms": ["spine infection", "vertebral osteomyelitis", "spinal infection",
                     "discitis", "diskitis", "epidural abscess", "spondylodiscitis",
                     "spinal epidural abscess", "vertebral discitis"],
        "scenario_keywords": ["spine infection", "spinal infection", "discitis", "diskitis",
                              "epidural abscess"]
    },
    "soft_tissue_infection": {
        "display_name": "Soft Tissue Infection / Abscess",
        "body_region": "msk",
        "additional_regions": ["abdomen", "chest"],
        # "fasciitis" alone removed - was wrongly catching "plantar fasciitis".
        # "abscess" alone removed - too generic (catches liver abscess etc).
        "synonyms": ["soft tissue infection", "cellulitis", "necrotizing fasciitis",
                     "soft tissue abscess", "skin infection", "wound infection"],
        "scenario_keywords": ["soft tissue infection", "necrotizing fasciitis"]
    },
    "fracture": {
        "display_name": "Fracture",
        "body_region": "msk",
        "synonyms": ["fracture", "broken bone", "bone fracture", "stress fracture",
                     "pathologic fracture", "insufficiency fracture",
                     # Layperson "broken X" phrasings -> route to fracture
                     "broken hip", "broken arm", "broken leg", "broken wrist",
                     "broken ankle", "broken foot", "broken finger", "broken hand",
                     "hip fracture", "wrist fracture", "ankle fracture"],
        "scenario_keywords": ["fracture"]
    },
    "soft_tissue_mass": {
        "display_name": "Soft Tissue Mass",
        "body_region": "msk",
        # "hematoma" alone removed - was substring-matching "subdural/epidural
        # hematoma" (intracranial bleeds). Kept "muscle hematoma" instead.
        "synonyms": ["soft tissue mass", "soft tissue tumor", "soft tissue sarcoma",
                     "muscle mass", "subcutaneous mass", "lipoma",
                     "crps", "complex regional pain syndrome",
                     "muscle hematoma", "soft tissue hematoma",
                     "muscle tear", "muscle strain"],
        "scenario_keywords": ["soft tissue mass", "soft tissue tumor"]
    },
    "lymphadenopathy": {
        "display_name": "Lymphadenopathy / Axillary Adenopathy",
        "body_region": "spine",
        # ACR's lymphadenopathy scenarios are spine-anchored (back-pain workup with
        # lymphadenopathy) and breast-anchored (axillary). Allow both.
        "additional_regions": ["breast"],
        "synonyms": ["lymphadenopathy", "adenopathy", "axillary adenopathy",
                     "swollen lymph nodes", "swollen glands", "enlarged lymph nodes",
                     "lumps in armpit", "lump in armpit", "armpit lump",
                     "neck lump", "groin lump", "supraclavicular lymph node",
                     "lymph node enlargement"],
        "scenario_keywords": ["lymphadenopathy", "axillary adenopathy"]
    },

    # Vascular/Aortic concepts - note: aortic scenarios are in chest region in ACR
    "aortic_aneurysm": {
        "display_name": "Aortic Aneurysm",
        "body_region": "chest",  # ACR puts aortic scenarios in chest
        "synonyms": ["aortic aneurysm", "aaa", "abdominal aortic aneurysm", "thoracic aneurysm",
                     "aortic dilation", "aneurysm"],
        "scenario_keywords": ["aortic aneurysm", "aaa", "abdominal aortic", "thoracic aortic",
                              "aortic disease"]
    },
    "aortic_dissection": {
        "display_name": "Aortic Dissection",
        "body_region": "chest",  # ACR puts aortic scenarios in chest
        "synonyms": ["aortic dissection", "dissecting aneurysm", "type a dissection",
                     "type b dissection", "acute aortic syndrome"],
        "scenario_keywords": ["aortic dissection", "dissecting", "acute aortic syndrome"]
    },
    "dvt": {
        "display_name": "Deep Vein Thrombosis",
        "body_region": "msk",  # DVT scenarios are in MSK region in ACR
        "synonyms": ["dvt", "deep vein thrombosis", "deep venous thrombosis", "leg clot",
                     "venous thrombosis", "lower extremity dvt", "leg swelling"],
        "scenario_keywords": ["deep vein", "dvt", "venous thrombosis", "thrombosis",
                              "extremity swelling", "leg swelling", "edema"]
    },
    "peripheral_vascular": {
        "display_name": "Peripheral Vascular Disease",
        "body_region": "msk",  # PVD scenarios are in MSK region in ACR
        "synonyms": ["peripheral vascular disease", "pvd", "peripheral arterial disease", "pad",
                     "claudication", "limb ischemia"],
        "scenario_keywords": ["peripheral vascular", "peripheral arterial", "claudication",
                              "arterial occlusion", "extremity ischemia"]
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

    # Curated neuromuscular / atypical concepts (hand-curated scenario lists)
    "myositis": {
        "display_name": "Myositis / Inflammatory Myopathy",
        "body_region": "msk",
        "synonyms": ["myositis", "polymyositis", "dermatomyositis", "inflammatory myopathy",
                     "muscle inflammation", "idiopathic inflammatory myopathy",
                     "pyomyositis", "rhabdomyolysis", "denervation atrophy"],
        # Curated mapping: route to nonsuperficial soft tissue mass MR protocols
        "manual_scenario_ids": [
            {"id": "6979", "relevance_score": 0.8},  # Soft tissue mass, hip, nonsuperficial
            {"id": "6974", "relevance_score": 0.8},  # knee
            {"id": "6975", "relevance_score": 0.8},  # lower leg
            {"id": "6970", "relevance_score": 0.7},  # elbow
            {"id": "6972", "relevance_score": 0.7},  # forearm
            {"id": "6968", "relevance_score": 0.7},  # ankle
            {"id": "6971", "relevance_score": 0.7},  # foot
        ]
    },
    "guillain_barre": {
        "display_name": "Guillain-Barre Syndrome / Polyradiculopathy",
        "body_region": "spine",
        "synonyms": ["guillain barre", "guillain-barre", "guillain barre syndrome",
                     "gbs", "aidp", "cidp",
                     "acute inflammatory demyelinating polyneuropathy",
                     "chronic inflammatory demyelinating polyneuropathy",
                     "ascending paralysis", "polyradiculopathy", "polyradiculoneuropathy",
                     "lumbar plexitis",
                     # Common misspellings of Guillain-Barre
                     "guillian", "guillian barre", "guillian-barre", "guillian-barr",
                     "guillain barr"],
        "manual_scenario_ids": [
            {"id": "5623", "relevance_score": 1.0},  # Low back pain, cauda equina
            {"id": "5841", "relevance_score": 0.9},  # Spine infection lumbar cauda equina
            {"id": "5835", "relevance_score": 0.8},  # Spine infection lumbar neuro deficit
            {"id": "8108", "relevance_score": 0.7},  # Lumbar spine pain, neuro deficit
            {"id": "7807", "relevance_score": 0.6},  # Thoracic back pain, radiculopathy
            {"id": "4689", "relevance_score": 0.5},  # Cervical spine pain, acute radic
            {"id": "7971", "relevance_score": 0.6},  # Cervical spine radic infection
        ]
    }
}


def pick_top_procedure(procedures):
    """Pick the inline-display procedure: highest rating, then modality
    preference (US > MRI no contrast > CT no contrast > MRI w/c > CT w/c
    > Radiography > other), then shortest name."""
    if not procedures:
        return None

    def modality_pref(p):
        m = (p.get("modality") or "").upper()
        c = p.get("usesContrast") or 0
        if m == "US": return (0,)
        if m == "MRI" and c == 0: return (1,)
        if m == "CT" and c == 0: return (2,)
        if m == "MRI": return (3,)
        if m == "CT": return (4,)
        if m == "RADIOGRAPHY": return (5,)
        return (9,)

    top = sorted(
        procedures,
        key=lambda p: (
            -(p.get("rating") or 0),
            modality_pref(p),
            len(p.get("shortName") or p.get("name") or ""),
        ),
    )[0]
    out = {
        "name": top.get("shortName") or top.get("name") or "",
        "modality": top.get("modality") or "",
        "rating": top.get("rating") or 0,
        "ratingLevel": top.get("ratingLevel") or "",
        "usesContrast": top.get("usesContrast") or 0,
        "radiationDose": top.get("radiationDose") or "",
    }
    if (top.get("rating") or 0) < 7:
        out["noStrong"] = True
    return out


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


def calculate_relevance(scenario_name, concept_keywords, negative_keywords=None):
    """Calculate relevance score between scenario and concept (0.0 to 1.0).

    Args:
        scenario_name: The scenario name to check
        concept_keywords: List of keywords that should match
        negative_keywords: List of keywords that should NOT match (reduces score)
    """
    name_lower = scenario_name.lower()

    # Check negative keywords first - if present, significantly reduce relevance
    if negative_keywords:
        for neg_kw in negative_keywords:
            if neg_kw.lower() in name_lower:
                return 0.05  # Very low score, effectively excludes

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

    # Index scenarios by ID for fast lookup (for manual_scenario_ids)
    scenarios_by_id = {}
    for sc in all_scenarios:
        sid = sc.get("id")
        if sid is not None and sid not in scenarios_by_id:
            scenarios_by_id[sid] = sc

    # Process each concept
    for concept_id, concept_def in CONCEPT_TAXONOMY.items():
        print(f"Processing concept: {concept_def['display_name']}")

        # Find matching scenarios
        scenario_mappings = []

        # MANUAL MAPPINGS: if a concept lists specific scenario IDs, use those directly
        # (useful for concepts where keyword matching doesn't apply, e.g. myositis -> soft tissue mass)
        manual_ids = concept_def.get("manual_scenario_ids", [])
        if manual_ids:
            for entry in manual_ids:
                # Accept either a bare id or {"id": ..., "relevance_score": ...}
                if isinstance(entry, dict):
                    sid = str(entry.get("id"))
                    relevance = float(entry.get("relevance_score", 0.8))
                else:
                    sid = str(entry)
                    relevance = 0.8
                sc = scenarios_by_id.get(sid)
                if not sc:
                    continue
                scenario_name = sc.get("name", "")
                scenario_region = sc.get("_region", "")
                procedures = sc.get("procedures", [])
                high_rated = [p for p in procedures if p.get("rating", 0) >= 7]
                top_proc = pick_top_procedure(procedures)
                mapping = {
                    "scenario_id": sid,
                    "scenario_name": scenario_name,
                    "relevance_score": round(relevance, 2),
                    "region": scenario_region,
                    "metadata": {
                        "phase": detect_phase(scenario_name),
                        "phase_display": get_phase_display(detect_phase(scenario_name)),
                        "context": detect_context(scenario_name),
                        "procedure_count": len(procedures),
                        "high_rated_count": len(high_rated)
                    }
                }
                if top_proc:
                    mapping["top_procedure"] = top_proc
                scenario_mappings.append(mapping)

        # KEYWORD-BASED MATCHING: scan scenarios in body_region (and additional_regions if set)
        concept_region = concept_def.get("body_region")
        additional_regions = concept_def.get("additional_regions", [])
        allowed_regions = set()
        if concept_region:
            allowed_regions.add(concept_region)
        allowed_regions.update(additional_regions)

        # Track ids already mapped manually so we don't duplicate
        already_mapped = {m["scenario_id"] for m in scenario_mappings}

        for scenario in all_scenarios:
            scenario_name = scenario.get("name", "")
            scenario_region = scenario.get("_region", "")
            scenario_id = scenario.get("id")

            if scenario_id in already_mapped:
                continue

            # STRICT REGION FILTERING: Only include scenarios from concept's allowed regions
            # This prevents cross-anatomy contamination (e.g., stroke matching vascular scenarios)
            if allowed_regions and scenario_region not in allowed_regions:
                continue

            # Check if scenario matches this concept
            keywords = concept_def.get("scenario_keywords", [])
            negative_keywords = concept_def.get("negative_keywords", [])
            relevance = calculate_relevance(scenario_name, keywords, negative_keywords)

            if relevance > 0.1:
                # All scenarios here are from the correct region
                relevance = min(1.0, relevance + 0.2)  # Boost since region matches

                # Detect phase and context
                phase = detect_phase(scenario_name)
                context = detect_context(scenario_name)

                # Get procedure summary
                procedures = scenario.get("procedures", [])
                high_rated = [p for p in procedures if p.get("rating", 0) >= 7]

                top_proc = pick_top_procedure(procedures)
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
                if top_proc:
                    mapping["top_procedure"] = top_proc

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
