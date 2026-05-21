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
                     "brain metastases", "intra-axial mass", "extra-axial mass",
                     # Headache + papilledema = mass workup
                     "new headache and papilledema", "headache and papilledema",
                     "papilledema", "headache papilledema",
                     # GBM / glioma follow-up
                     "rano criteria", "gbm", "gbm follow up", "gbm follow-up",
                     "glioblastoma follow up", "glioblastoma follow-up",
                     "pseudoprogression vs true progression",
                     "pseudoprogression gbm",
                     "mrs choline naa", "mr spectroscopy tumor",
                     "tumor recurrence brain",
                     # Surgical planning
                     "dti for pre-op tractography", "pre-op tractography",
                     "dti tractography eloquent",
                     # Leptomeningeal disease (often mets)
                     "leptomeningeal enhancement", "leptomeningeal disease",
                     "leptomeningeal carcinomatosis",
                     # Skull base / cerebellopontine
                     "mri iac", "internal auditory canal", "iac mri",
                     "mri iac for sensorineural hearing loss",
                     "sensorineural hearing loss mri", "acoustic neuroma",
                     "vestibular schwannoma",
                     # Pituitary
                     "pituitary adenoma", "pituitary microadenoma",
                     "mri sella", "mri sella for pituitary", "sellar mass",
                     "hypopituitarism", "hypopituitarism mri pituitary",
                     # Phakomatoses / tuberous sclerosis
                     "tuberous sclerosis", "mri brain tuberous sclerosis",
                     "sega", "subependymal giant cell astrocytoma",
                     # Generic protocol queries
                     "mri brain with contrast which protocol",
                     "mri brain w/ contrast which protocol",
                     "brain tumor protocol mri"],
        "scenario_keywords": ["brain tumor", "intracranial", "brain mass", "glioma",
                              "meningioma", "brain mets", "brain metasta"]
    },
    "stroke": {
        "display_name": "Stroke/CVA",
        "body_region": "neuro",
        "synonyms": ["stroke", "cva", "cerebrovascular accident", "ischemic stroke",
                     "hemorrhagic stroke", "brain infarct", "cerebral infarction",
                     "acute stroke", "transient ischemic attack", "tia", "ischemic infarct",
                     # Classic stroke vignettes
                     "lsw 90min ago", "last seen well", "facial droop",
                     "right facial droop", "left facial droop",
                     "afib new onset weakness", "atrial fibrillation new weakness",
                     "weakness on one side", "one sided weakness",
                     "new onset weakness", "patient with new confusion",
                     "patient with new confusion what imaging",
                     # Imaging-specific
                     "mra neck for vertebral dissection", "vertebral artery dissection",
                     "carotid dissection", "vertebral dissection",
                     "hyperdense mca", "ddx hyperdense mca",
                     "perfusion imaging stroke", "ct perfusion stroke",
                     "dsc perfusion threshold stroke",
                     # Advanced stroke imaging vocabulary
                     "ctp rapid", "ctp tmax", "ctp tmax >6s", "tmax mismatch",
                     "ctp rapid tmax mismatch ratio", "mismatch ratio",
                     "cta head and neck", "cta head neck for lvo", "lvo",
                     "large vessel occlusion",
                     "mrv for cerebral venous sinus thrombosis",
                     "cerebral venous sinus thrombosis", "cvst",
                     "cerebral venous thrombosis",
                     "blunt cerebrovascular injury", "bcvi",
                     "cta neck for blunt cerebrovascular",
                     "post arrest brain imaging", "post-arrest brain imaging",
                     "post-arrest brain imaging prognosis",
                     # TGA / amnesia
                     "transient global amnesia", "tga", "transient global amnesia workup",
                     "transient global amnesia imaging",
                     # Vignette patterns
                     "weak l arm l face droop", "weak r arm r face droop",
                     "weak arm face droop", "arm face droop"],
        "scenario_keywords": ["stroke", "ischemic", "hemorrhage", "cerebrovascular",
                              "infarct", "transient ischemic", "ischemic infarct"]
    },
    "headache": {
        "display_name": "Headache",
        "body_region": "neuro",
        "synonyms": ["headache", "head pain", "cephalgia", "migraine", "tension headache",
                     "cluster headache", "chronic headache", "new headache",
                     "intracranial hypotension", "csf leak", "iih", "pseudotumor cerebri",
                     "idiopathic intracranial hypertension",
                     # Red flags / migraine variants
                     "new ha red flags", "ha red flags", "headache red flags",
                     "mri brain ha red flags",
                     "mri brain with and without contrast for new ha red flags",
                     "mri brain new ha", "mri brain for new headache",
                     "unilateral ha visual aura", "headache with visual aura",
                     "headache with aura", "visual aura headache",
                     # Syncope (headache pathway in some cases)
                     "syncope when to image head", "syncope w/u when to image",
                     "syncope inpatient when to image", "syncope inpatient imaging",
                     # Immunocompromised HA
                     "ddx for new ha in hiv", "headache in hiv",
                     "headache in immunocompromised", "headache hiv patient",
                     "new headache in hiv"],
        "scenario_keywords": ["headache", "head pain", "migraine", "cephalgia"]
    },
    "dementia": {
        "display_name": "Dementia/Cognitive Decline",
        "body_region": "neuro",
        "synonyms": ["dementia", "alzheimer", "cognitive decline", "memory loss",
                     "neurodegenerative", "cognitive impairment",
                     # DAT scan / Parkinsonism imaging
                     "dat scan", "dat scan for parkinsonism", "datscan",
                     "parkinsonism imaging", "parkinsonism workup",
                     # CJD imaging
                     "dwi cjd", "dwi for cjd cortical ribboning",
                     "cjd cortical ribboning", "cjd imaging",
                     "creutzfeldt jakob", "creutzfeldt-jakob disease",
                     # Layperson confusion
                     "dad has confusion what imaging is needed",
                     "patient with confusion imaging",
                     "new confusion in elderly"],
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
                     "intraventricular hemorrhage", "ivh",
                     # Head trauma / TBI workup
                     "head trauma", "head injury", "mild tbi", "moderate tbi",
                     "severe tbi", "tbi", "traumatic brain injury",
                     "noncontrast head ct trauma", "ct head no contrast trauma",
                     "head ct trauma", "head ct for trauma",
                     "head ct after fall", "ct head after fall",
                     "fall hit head", "fall and hit head",
                     "fall struck head", "trauma head imaging",
                     "head ct for trauma adult", "noncontrast head ct for trauma adult",
                     "appropriateness mild tbi",
                     # Aneurysm / AVM
                     "ruptured aneurysm", "ruptured cerebral aneurysm",
                     "avm", "brain avm", "intracranial avm",
                     "arteriovenous malformation brain",
                     "dsa vs cta for ruptured aneurysm",
                     # Microbleeds
                     "microbleeds", "cerebral microbleeds",
                     "cerebral amyloid angiopathy", "caa",
                     "gre swi microbleeds",
                     # Classic SAH presentations
                     "sudden severe headache", "worst headache of life",
                     "thunderclap headache",
                     # Anticoagulation + head
                     "head ct after fall on coumadin",
                     "head ct on warfarin", "head ct anticoagulation",
                     # Additional vignette patterns
                     "sudden severe ha worst of life",
                     "65yo f sudden severe ha worst of life",
                     "motorcycle crash gcs", "33yo m motorcycle crash gcs",
                     "intubated trauma pt re-image",
                     "intubated trauma pt re-image bleed expanding",
                     "expanding bleed", "expanding intracranial bleed",
                     "elderly patient with confusion and fall",
                     "elderly confusion and fall imaging",
                     "elderly fall altered mental status",
                     "my mother fell and hit her head",
                     "mother fell hit head", "fall and hit her head",
                     "should she get a scan after hitting head"],
        "scenario_keywords": ["subarachnoid hemorrhage", "intracranial hemorrhage",
                              "subdural", "epidural hematoma",
                              "hemorrhagic stroke", "head trauma"]
    },

    # Spine concepts
    "back_pain": {
        "display_name": "Back Pain",
        "body_region": "spine",
        "synonyms": ["back pain", "low back pain", "lbp", "lumbar pain", "spine pain",
                     "backache", "back ache", "back hurts", "back is sore",
                     "thoracic pain", "cervical pain", "neck pain",
                     "enthesitis", "sacroiliitis", "axial spondyloarthritis",
                     "ankylosing spondylitis",
                     # MRI SI joints / spondyloarthropathy imaging
                     "mri sacroiliac joints", "mri si joints",
                     "mri sacroiliac joints for spondyloarthropathy",
                     "mri si joints for spondyloarthropathy",
                     "spondyloarthropathy",
                     "dixon technique mr sacroiliac",
                     "dixon technique for mr sacroiliac joints",
                     # MRI sequences
                     "mri lumbar spine sequences",
                     "mri lumbar spine sequences w/o contrast",
                     "mri lumbar spine sequences without contrast"],
        "scenario_keywords": ["back pain", "low back", "lumbar pain", "spine pain"]
    },
    "radiculopathy": {
        "display_name": "Radiculopathy/Sciatica",
        "body_region": "spine",
        "synonyms": ["radiculopathy", "sciatica", "nerve root compression", "pinched nerve",
                     "disc herniation", "herniated disc", "bulging disc", "slipped disc",
                     "arachnoiditis", "brachial neuritis", "parsonage turner",
                     "parsonage-turner", "brachial plexopathy", "lumbosacral plexopathy",
                     # Common radic presentations
                     "leg pain radiating", "leg pain radiating down",
                     "shooting leg pain", "shooting pain down leg",
                     "chronic low back pain radiating to leg",
                     "back pain radiating to leg",
                     "foot drop after lumbar surgery", "foot drop",
                     # MR neurography for nerve evaluation
                     "mr neurography", "mr neurography sciatic",
                     "mr neurography for sciatic"],
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
                     "conus medullaris syndrome", "tethered cord",
                     # Cauda equina presentations
                     "cauda equina", "cauda equina syndrome",
                     "first line imaging for cauda equina syndrome",
                     "mri for cauda equina", "mri lumbar spine cauda equina",
                     "saddle anesthesia", "low back pain with saddle anesthesia",
                     "back pain saddle anesthesia", "saddle anaesthesia",
                     # Spinal cord deficit presentations
                     "back pain with leg weakness", "back pain leg weakness",
                     "back pain with urinary retention", "leg weakness urinary retention",
                     "bilateral leg weakness", "bilateral leg weakness urinary retention",
                     "acute onset back pain with leg weakness",
                     "back pain with leg weakness urinary retention",
                     "back pain with neurologic deficit"],
        "scenario_keywords": ["myelopathy", "spinal cord compress", "cord compress",
                              "cauda equina"]
    },

    # Chest concepts
    "lung_nodule": {
        "display_name": "Lung Nodule",
        "body_region": "chest",
        "synonyms": ["lung nodule", "pulmonary nodule", "lung lesion", "solitary pulmonary nodule",
                     "spn", "lung mass", "pulmonary mass", "sarcoidosis",
                     # Lung-RADS / Fleischner
                     "lung rads", "lung-rads", "lungrads",
                     "lung-rads 4b", "lung rads 4b", "lung-rads 4b nodule",
                     "lung-rads 4b nodule workup",
                     "fleischner criteria", "fleischner society",
                     "subsolid nodule", "subsolid nodule follow up",
                     "subsolid nodule follow-up", "subsolid nodule fleischner",
                     # Procedure planning
                     "ct guided lung biopsy", "ct-guided lung biopsy",
                     "ct-guided lung biopsy approach",
                     "ct-guided lung biopsy approach pneumothorax risk",
                     "lung biopsy approach",
                     # Chronic cough as nodule presentation
                     "chronic cough 8 weeks", "chronic cough nonsmoker cxr neg",
                     "chronic cough nonsmoker",
                     # Layperson
                     "lung spot on xray", "dad has lung spot on xray"],
        "scenario_keywords": ["lung nodule", "pulmonary nodule", "lung mass", "pulmonary mass"]
    },
    "lung_cancer": {
        "display_name": "Lung Cancer",
        "body_region": "chest",
        "synonyms": ["lung cancer", "lung carcinoma", "bronchogenic carcinoma", "nsclc",
                     "sclc", "lung malignancy", "pulmonary carcinoma",
                     # Classic presentations
                     "hemoptysis", "smoker with hemoptysis", "smoker hemoptysis",
                     "imaging for hemoptysis", "hemoptysis cta chest",
                     "hemoptysis cta chest indications", "imaging for hemoptysis massive",
                     "massive hemoptysis",
                     # Mediastinal masses (often lung cancer or related)
                     "mediastinal mass", "anterior mediastinal mass",
                     "ct for mediastinal mass anterior compartment",
                     "thymoma", "thymic hyperplasia",
                     "ct for thymoma vs thymic hyperplasia",
                     # Paraneoplastic
                     "paraneoplastic syndrome occult", "paraneoplastic occult malignancy",
                     "hypercalcemia not pth related",
                     # Pleural / lung work-up
                     "pleural effusion unilateral",
                     "pleural effusion new unilateral"],
        "scenario_keywords": ["lung cancer", "lung carcinoma", "bronchogenic", "non-small cell",
                              "small cell lung"]
    },
    "pulmonary_embolism": {
        "display_name": "Pulmonary Embolism",
        "body_region": "chest",
        "synonyms": ["pulmonary embolism", "pulmonary embolus", "pe",
                     "blood clot in lung", "lung clot", "blood clot lung",
                     "pulmonary thromboembolism", "vte chest",
                     # Imaging shorthand
                     "ctpa", "cta chest pe", "cta chest for pe",
                     "ctpa protocol", "ctpa contraindication",
                     "pe protocol",
                     # Clinical scoring rules
                     "wells score pe", "wells score low pe", "wells criteria pe",
                     "perc rule", "perc rule pe", "perc rule when skip imaging",
                     # Classic presentations
                     "pleuritic chest pain", "pleuritic cp",
                     "pleuritic chest pain post op",
                     "sob tachypnea ocp", "sob tachypnea oral contraceptive",
                     "right heart strain ctpa", "rv lv ratio ctpa",
                     # Pregnant PE
                     "pe pregnancy", "pe in pregnant", "pregnant pe",
                     "pe workup pregnant", "pulmonary embolism pregnant",
                     "postpartum chest pain"],
        "scenario_keywords": ["pulmonary embol", "venous thromboembol"]
    },
    "pneumonia": {
        "display_name": "Pneumonia",
        "body_region": "chest",
        "synonyms": ["pneumonia", "lung infection", "chest infection", "respiratory infection",
                     "community acquired pneumonia", "hospital acquired pneumonia",
                     # Classic presentations
                     "cough fever and infiltrate", "cough fever and infiltrate on cxr",
                     "cough fever and infiltrate on chest xray",
                     "fever and infiltrate on cxr",
                     "productive cough fever rigors",
                     "67yo m productive cough fever rigors",
                     "67yo productive cough fever",
                     # Common misspellings
                     "neumonia", "what does neumonia look like", "neumonia on xray",
                     "what does pneumonia look like on xray"],
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
    "pericardial_effusion": {
        "display_name": "Pericardial Effusion / Pericarditis",
        "body_region": "chest",
        "synonyms": ["pericardial effusion", "pericardial disease",
                     "pericarditis", "cardiac tamponade", "tamponade",
                     "pericardial tamponade", "constrictive pericarditis",
                     "pericardial effusion vs tamponade",
                     "imaging for pericardial disease"],
        "manual_scenario_ids": [
            {"id": "5978", "relevance_score": 1.0},  # Dyspnea, pericardial disease suspected
        ],
    },

    # Abdomen concepts
    "liver_lesion": {
        "display_name": "Liver Lesion",
        "body_region": "abdomen",
        "synonyms": ["liver lesion", "hepatic lesion", "liver mass", "hepatic mass",
                     "liver tumor", "hepatic tumor", "liver nodule", "focal liver lesion",
                     # FNH / adenoma / hemangioma
                     "fnh", "focal nodular hyperplasia", "mri for fnh",
                     "hepatic adenoma", "liver adenoma", "mri for fnh vs adenoma",
                     "fnh vs adenoma",
                     "liver hemangioma", "hepatic hemangioma",
                     # Hepatobiliary contrast agents
                     "eovist", "gd-eob", "primovist",
                     "hepatocyte-specific agent eovist",
                     "hepatobiliary phase", "hepatocyte specific contrast",
                     # Hypervascular lesion workup
                     "hypervascular liver lesion", "hypervascular liver mets",
                     "neuroendocrine liver mets",
                     # Lesion follow-up
                     "recist 1.1 liver", "mrecist liver",
                     # Abnormal LFTs workup
                     "abnormal lfts", "abnormal lft", "transaminitis",
                     "57yo abnormal lfts cholestatic", "abnormal lft incidental",
                     "transaminitis hep panel neg",
                     "isolated alk phos elevation", "alkaline phosphatase elevated",
                     "cholestatic pattern lfts"],
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
                     "rlq pain", "right lower quadrant pain",
                     # RLQ pain workup patterns
                     "31yo rlq pain", "rlq pain us protocol",
                     "rlq pain fever leukocytosis", "fever leukocytosis rlq",
                     "appendicitis suspected", "r/o appendicitis",
                     "rule out appendicitis", "r/o appendicitis pregnant",
                     # Pregnancy variants
                     "r/o appy in pregnancy", "rule out appy in pregnancy",
                     "r/o appy pregnant", "appy in pregnancy",
                     "image suspected appy pregnant", "how to image suspected appy pregnant",
                     "appendicitis in pregnant", "appendicitis in pregnancy",
                     "best for r/o appy in pregnancy"],
        "scenario_keywords": ["appendicitis", "appendix"]
    },
    "abdominal_pain": {
        "display_name": "Abdominal Pain",
        "body_region": "abdomen",
        "synonyms": ["abdominal pain", "belly pain", "stomach pain", "acute abdomen",
                     "abdominal discomfort",
                     # GI bleed / occult bleed (overlaps with colon_cancer but
                     # presentation-focused queries land here)
                     "ct enterography for gi bleed", "rbc scan for slow gi bleed",
                     "obscure gi bleed", "lower gi bleed", "upper gi bleed",
                     "tarry stools", "black tarry stools", "melena",
                     # Perforation / acute abdomen
                     "perforated viscus", "pneumoperitoneum",
                     "ct for perforated viscus pneumoperitoneum",
                     "ct for perforated viscus",
                     # Trauma / blunt abdominal
                     "blunt abdominal trauma", "blunt abdominal trauma stable",
                     "ct abd for nonspecific abd pain elderly",
                     "luq pain post mvc", "luq pain seatbelt sign", "seatbelt sign",
                     "atls protocol blunt trauma", "atls blunt trauma which scans",
                     "trauma pan scan", "pan scan trauma"],
        "scenario_keywords": ["abdominal pain", "acute abdomen"]
    },
    "pancreatic_mass": {
        "display_name": "Pancreatic Mass",
        "body_region": "abdomen",
        "synonyms": ["pancreatic mass", "pancreas mass", "pancreatic lesion", "pancreatic tumor",
                     "pancreatic cancer", "pancreatic adenocarcinoma", "pancreatic cyst",
                     # Pancreatitis (no dedicated concept; stopgap mapping here -
                     # ACR has scenarios for acute pancreatitis under pancreas)
                     "acute pancreatitis", "pancreatitis", "necrotizing pancreatitis",
                     "ct for acute necrotizing pancreatitis", "ctsi",
                     "ct pancreatitis", "pancreatitis ct findings",
                     "igg4 pancreatitis", "igg4 autoimmune pancreatitis",
                     "autoimmune pancreatitis", "mri for igg4",
                     # IPMN follow-up
                     "ipmn", "ipmn follow up", "fukuoka criteria",
                     "fukuoka criteria ipmn",
                     # Pancreatic cancer biomarkers / presentations
                     "ca 19 9 elevated", "ca19-9 elevated", "ca 19-9 elevated",
                     "painless jaundice", "evaluate for pancreatic cancer painless jaundice",
                     "weight loss back pain", "weight loss and back pain"],
        "scenario_keywords": ["pancreatic", "pancreas"]  # Broad match for pancreas scenarios
    },
    "kidney_mass": {
        "display_name": "Kidney Mass",
        "body_region": "abdomen",
        "synonyms": ["kidney mass", "renal mass", "kidney lesion", "renal lesion",
                     "kidney tumor", "renal tumor", "kidney cancer", "renal cell carcinoma",
                     "rcc",
                     # Hematuria is the dominant workup pathway for kidney mass
                     "hematuria", "hematuria workup", "first time hematuria",
                     "appropriate imaging for first time hematuria",
                     "evaluate hematuria", "how to evaluate hematuria",
                     "microscopic hematuria", "gross hematuria",
                     "painless hematuria", "painless hematuria 60yo",
                     "postmenopausal hematuria", "postmenopausal woman with hematuria",
                     "ct urogram", "ct urogram for hematuria",
                     "ct urogram for hematuria workup",
                     "ct urogram three phase", "ct urogram three phase protocol",
                     # Secondary polycythemia (renal mass / EPO)
                     "polycythemia secondary causes",
                     "polycythemia secondary causes imaging",
                     "secondary polycythemia imaging",
                     # AIN
                     "acute interstitial nephritis",
                     "acute interstitial nephritis imaging role",
                     # Chronic flank pain (could be cyst/mass)
                     "chronic flank pain"],
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
                     "renal abscess",
                     # Flank pain + fever / pregnancy / recurrent UTI
                     "flank pain pregnant", "flank pain in pregnancy",
                     "lady with flank pain pregnant",
                     "ultrasound vs mri for pyelo",
                     "ultrasound vs mri for pyelo in pregnancy",
                     "pyelo in pregnancy", "pyelonephritis in pregnancy",
                     "flank pain fever pyuria", "flank pain fever urinary",
                     "recurrent uti with flank pain", "recurrent uti flank pain",
                     "acute confusion fever ua", "acute confusion fever ua positive",
                     "fever and dysuria elderly"],
        "scenario_keywords": ["pyelonephritis", "renal abscess", "perinephric"]
    },
    "inflammatory_bowel_disease": {
        "display_name": "Inflammatory Bowel Disease / Crohn",
        "body_region": "abdomen",
        "synonyms": ["inflammatory bowel disease", "ibd", "crohn", "crohn disease",
                     "crohns", "crohns disease", "ulcerative colitis", "uc",
                     "colitis",
                     # Imaging
                     "ct enterography", "mr enterography",
                     "ct enterography vs mr enterography",
                     "ct vs mr enterography",
                     # Toxic megacolon (UC emergency)
                     "toxic megacolon", "toxic megacolon imaging",
                     "toxic megacolon decompression",
                     "c diff toxic megacolon", "cdiff toxic megacolon",
                     # Small bowel wall thickening
                     "incidental small bowel wall thickening",
                     "small bowel wall thickening",
                     # Chronic diarrhea
                     "chronic diarrhea and weight loss",
                     "chronic diarrhea with weight loss"],
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
                     "pulmonary edema",
                     # Cardiac MR / CMR for HF workup
                     "cardiac mri myocarditis", "cmr myocarditis", "cmr for myocarditis",
                     "myocarditis", "myocarditis lake louise", "lake louise myocarditis",
                     "cmr for cardiomyopathy", "cmr nonischemic", "cmr nicm",
                     "lge cardiomyopathy", "cardiac amyloid", "cardiac amyloidosis",
                     "amyloid cardiomyopathy", "cmr for cardiac amyloid",
                     "hypertrophic cardiomyopathy", "hcm imaging",
                     "dilated cardiomyopathy", "ischemic cardiomyopathy",
                     "non-ischemic cardiomyopathy", "stress cmr",
                     "cardiac sarcoidosis", "cmr for sarcoid",
                     # New onset afib (often gets cmr/cardiac workup)
                     "new onset afib", "first time afib",
                     "afib new onset weakness", "atrial fibrillation rvr",
                     # Heart failure presentations
                     "dyspnea on exertion bnp", "elevated bnp", "elevated brain natriuretic",
                     "crackles bilateral lower lobes", "bilateral crackles",
                     "patient with crackles", "sob and leg swelling",
                     "shortness of breath and leg swelling",
                     "doe and edema", "doe edema",
                     # Chronic dyspnea / pulmonary HTN workup
                     "chronic dyspnea", "ddx for chronic dyspnea",
                     "ddx for chronic dyspnea normal cxr",
                     "pulmonary htn workup", "pulmonary hypertension imaging",
                     "pulmonary hypertension workup",
                     "worsening dyspnea", "worsening dyspnea on exertion",
                     "worsening dyspnea on exertion lower extremity edema",
                     "worsening dyspnea elderly", "worsening dyspnea elderly female",
                     "shortness of breath getting worse",
                     "shortness of breath getting worse over weeks",
                     "shortness of breath progressive",
                     "what scan does pt need for sob and doe"],
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
                     "hyperparathyroidism", "lump in neck", "neck lump",
                     # Head & neck cancer / oncology
                     "hnscc", "head and neck scc", "head and neck cancer",
                     "rad onc planning ct hnscc", "rad onc planning ct vs pet for hnscc",
                     "mri neck for tongue base scc", "tongue base scc",
                     "tongue base cancer", "base of tongue cancer",
                     "pet ct hpv oropharyngeal",
                     "pet-ct for hpv+ oropharyngeal cancer",
                     "hpv oropharyngeal cancer", "oropharyngeal cancer",
                     "oropharyngeal scc",
                     # Retropharyngeal space
                     "retropharyngeal abscess", "retropharyngeal abscess vs phlegmon",
                     "mri for retropharyngeal abscess",
                     # Thyroid eye / orbit
                     "mri orbits", "mri orbits thyroid eye disease",
                     "thyroid eye disease", "graves ophthalmopathy",
                     "graves disease orbits"],
        "scenario_keywords": ["thyroid", "neck mass", "goiter", "parathyroid"]
    },
    "bowel_obstruction": {
        "display_name": "Bowel Obstruction",
        "body_region": "abdomen",
        "synonyms": ["bowel obstruction", "intestinal obstruction", "sbo", "small bowel obstruction",
                     "large bowel obstruction", "ileus",
                     # Classic SBO presentations
                     "abdominal pain and distension no bm", "abdominal pain distension no bm",
                     "abdominal distension no bm", "abdominal distension no bowel movements",
                     "abdominal distension and vomiting", "abdominal distension vomiting no flatus",
                     "distended abdomen vomiting", "obstipation vomiting distended",
                     "obstipation vomiting", "no flatus distension",
                     "abdominal pain vomiting no bm",
                     # Incarcerated hernia
                     "incarcerated hernia", "strangulated hernia",
                     "ct for hernia incarcerated",
                     # Layperson + intussusception (pediatric overlap)
                     "abdominal distension with vomiting and no flatus",
                     "scan needed for abdominal distension and no bowel movements",
                     "scan for abdominal distension and no bowel movements",
                     "intussusception", "us for intussusception",
                     "us for intussusception ileocolic", "ileocolic intussusception"],
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
                     "colonic mass", "colon mass",
                     # Common workup pathways
                     "rectal bleeding", "rectal bleeding workup",
                     "concerning rectal bleeding workup", "hematochezia",
                     "blood in stool over 50", "lower gi bleed workup",
                     "ct colonography", "ct colonography for incomplete colonoscopy",
                     "incomplete colonoscopy",
                     "lynch syndrome", "lynch syndrome surveillance",
                     "hereditary colorectal cancer", "fap surveillance",
                     "imaging for staging colon ca",
                     "rectal cancer staging", "mri rectal cancer staging",
                     # Iron deficiency anemia / occult bleed workup (most common
                     # path to colon ca discovery)
                     "iron deficiency anemia", "iron deficiency anemia workup",
                     "ida workup", "ida 60 yo", "ida in male",
                     "microcytic anemia", "microcytic anemia occult bleed",
                     "microcytic anemia occult bleed workup",
                     "microcytic anemia in 55 yo male", "workup of microcytic anemia",
                     "occult bleed", "occult bleed next step",
                     "anemia workup occult bleed", "anemia workup occult bleed next step",
                     "anemia and weight loss", "weight loss and iron deficiency",
                     "weight loss and iron deficiency anemia",
                     "anemia + abdominal mass", "anemia and abdominal mass",
                     "positive fobt", "fobt positive", "patient with positive fobt"],
        "scenario_keywords": ["colon", "colorectal", "rectal cancer"]
    },
    "cholecystitis": {
        "display_name": "Cholecystitis/Gallbladder",
        "body_region": "abdomen",
        "synonyms": ["cholecystitis", "gallbladder inflammation", "gallstones", "cholelithiasis",
                     "biliary colic", "ruq pain", "right upper quadrant pain",
                     # MRCP / biliary imaging queries
                     "mrcp", "mrcp for biliary obstruction",
                     "mrcp for biliary obstruction protocol",
                     "mrcp for choledocholithiasis",
                     "eus vs mrcp for choledocholithiasis",
                     "choledocholithiasis", "common bile duct stones",
                     "choledochal cyst", "mrcp for choledochal cyst",
                     "psc", "primary sclerosing cholangitis",
                     "mrcp for psc", "mrcp for psc followup",
                     # Layperson
                     "pain in upper belly after eating",
                     "upper belly pain after eating"],
        "scenario_keywords": ["cholecystitis", "gallbladder", "gallstone", "biliary colic",
                              "ruq pain", "cholelithiasis"],
        "negative_keywords": ["jaundice", "biliary obstruction"]  # Different from cholecystitis
    },
    "cholangitis": {
        "display_name": "Cholangitis / Biliary Infection",
        "body_region": "abdomen",
        "synonyms": ["cholangitis", "ascending cholangitis", "acute cholangitis",
                     "charcot triad", "charcot triad imaging",
                     "biliary infection", "biliary sepsis",
                     "ruq pain fever wbc", "ruq pain fever high wbc",
                     "ruq pain with fever and high wbc"],
        # ACR scenarios: RUQ pain + fever + high WBC + biliary disease suspected
        "manual_scenario_ids": [
            {"id": "6705", "relevance_score": 1.0},  # RUQ pain fever high WBC, US equivocal
            {"id": "6704", "relevance_score": 1.0},  # RUQ pain fever high WBC, US negative
            {"id": "4686", "relevance_score": 0.7},  # Jaundice biliary obstruction
        ],
    },
    "pyloric_stenosis": {
        "display_name": "Pyloric Stenosis (Pediatric)",
        "body_region": "abdomen",
        # ACR source filed the one topic under "vascular" (a misclassification)
        "additional_regions": ["vascular"],
        "synonyms": ["pyloric stenosis", "hypertrophic pyloric stenosis",
                     "infant nonbilious vomiting", "projectile vomiting infant",
                     "us for pyloric stenosis", "pyloric stenosis suspected",
                     "newborn projectile vomiting"],
        "manual_scenario_ids": [
            {"id": "815", "relevance_score": 1.0},
        ],
    },
    "vesicoureteral_reflux": {
        "display_name": "Vesicoureteral Reflux (VUR)",
        "body_region": "abdomen",
        "additional_regions": ["other", "peds"],
        "synonyms": ["vesicoureteral reflux", "vur", "vcug",
                     "vcug vs rnc", "voiding cystourethrogram",
                     "vur follow up", "vur followup", "vur surveillance",
                     "antenatal hydronephrosis followup",
                     "antenatal hydronephrosis surveillance",
                     "neonatal hydronephrosis"],
        "manual_scenario_ids": [
            {"id": "7280", "relevance_score": 1.0},  # VUR follow-up imaging
            {"id": "6248", "relevance_score": 0.9},  # Pyelonephritis w/ VUR
            {"id": "5357", "relevance_score": 0.7},  # Antenatal hydronephrosis
        ],
    },
    "ectopic_pregnancy": {
        "display_name": "Ectopic Pregnancy / Pelvic Pain in Pregnancy",
        "body_region": "abdomen",
        "synonyms": ["ectopic pregnancy", "ectopic", "rule out ectopic",
                     "r/o ectopic", "ectopic suspected",
                     "positive beta-hcg pelvic pain", "positive bhcg pelvic pain",
                     "pelvic pain positive hcg", "pelvic pain pregnant",
                     "early pregnancy bleeding", "first trimester bleeding",
                     "pregnancy of unknown location"],
        # ACR: acute pelvic pain + beta-hCG status scenarios
        "manual_scenario_ids": [
            {"id": "1041", "relevance_score": 1.0},  # +bhCG, gyn etiology suspected
            {"id": "1043", "relevance_score": 0.9},  # +bhCG, non-gyn etiology
            {"id": "1042", "relevance_score": 0.7},  # -bhCG, gyn etiology
        ],
    },
    "ovarian_torsion": {
        "display_name": "Ovarian Torsion / Adnexal Pathology",
        "body_region": "abdomen",
        "synonyms": ["ovarian torsion", "adnexal torsion", "twisted ovary",
                     "acute pelvic pain ovarian", "ovarian cyst rupture",
                     "hemorrhagic ovarian cyst", "adnexal mass acute",
                     "ruptured ovarian cyst", "adnexal mass symptomatic"],
        "scenario_keywords": ["adnexal mass"],
        # Acute pelvic pain scenarios (negative beta-hCG gyn etiology in particular)
        "manual_scenario_ids": [
            {"id": "1042", "relevance_score": 1.0},  # -bhCG, gyn etiology
            {"id": "1041", "relevance_score": 0.8},  # +bhCG, gyn etiology
        ],
    },
    "scrotal_pain": {
        "display_name": "Scrotal Pain / Testicular Torsion",
        "body_region": "abdomen",
        "additional_regions": ["other"],
        "synonyms": ["scrotal pain", "scrotal pain acute",
                     "scrotal pain acute nontraumatic",
                     "acute scrotum", "testicular torsion",
                     "testicular pain", "twisted testicle",
                     "scrotal swelling", "acute scrotal pain"],
        "manual_scenario_ids": [
            {"id": "7833", "relevance_score": 1.0},  # Scrotal pain acute nontraumatic
        ],
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
                     "primary bone tumor", "osteosarcoma", "bone metastasis", "bone mets",
                     # Chondrosarcoma / enchondroma DDx
                     "chondrosarcoma", "enchondroma",
                     "chondrosarcoma vs enchondroma",
                     "mr for chondrosarcoma vs enchondroma",
                     "mri for chondrosarcoma vs enchondroma",
                     # Multiple myeloma whole-body imaging
                     "multiple myeloma", "myeloma imaging",
                     "whole body mri for myeloma", "whole body mri myeloma",
                     "wbmri myeloma", "whole-body mri myeloma",
                     "monoclonal gammopathy", "monoclonal gammopathy bone survey",
                     "monoclonal gammopathy bone survey vs mri",
                     "mgus", "smoldering myeloma",
                     # CKD-MBD
                     "ckd mbd", "ckd-mbd", "ckd mbd bone imaging",
                     "chronic kidney disease bone disease"],
        "scenario_keywords": ["bone tumor", "bone mass", "bone lesion", "osteosarcoma",
                              "primary bone"]
    },
    "bone_infection": {
        "display_name": "Bone Infection / Osteomyelitis",
        "body_region": "msk",
        # Pelvic osteomyelitis is in abdomen, chest-wall osteomyelitis is in chest.
        "additional_regions": ["abdomen", "chest"],
        "synonyms": ["osteomyelitis", "bone infection", "septic arthritis", "septic joint",
                     "joint infection", "osteo",
                     # Diabetic foot - very common bone infection workup
                     "diabetic foot ulcer concern for infection",
                     "diabetic foot ulcer with concern for infection",
                     "mr for diabetic foot when can't differentiate",
                     "mr for diabetic foot",
                     "diabetic foot can't differentiate",
                     "non healing leg ulcer in diabetic",
                     "non-healing leg ulcer in diabetic",
                     "non healing diabetic foot ulcer",
                     "non-healing diabetic foot ulcer",
                     "diabetic foot infection imaging"],
        "scenario_keywords": ["osteomyelitis", "septic arthritis"]
    },
    "spine_infection": {
        "display_name": "Spine Infection / Vertebral Osteomyelitis",
        "body_region": "spine",
        "synonyms": ["spine infection", "vertebral osteomyelitis", "spinal infection",
                     "discitis", "diskitis", "epidural abscess", "spondylodiscitis",
                     "spinal epidural abscess", "vertebral discitis",
                     # Clinical presentation patterns (fever + back pain = spine infection)
                     "fever and back pain", "back pain with fever",
                     "back pain and fever", "back pain fever",
                     "low back pain and fever", "low back pain with fever",
                     "scan for patient with low back pain and fever",
                     "ivdu back pain", "iv drug use back pain", "ivdu back pain fever",
                     "back pain in ivdu", "back pain history of ivdu",
                     "back pain immunocompromised",
                     "epidural abscess back pain fever",
                     "approach to back pain with fever",
                     "vertebral osteo", "suspected vertebral osteo"],
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
                     "soft tissue abscess", "skin infection", "wound infection",
                     # DDx queries
                     "abscess vs hematoma", "abscess vs hematoma on mr",
                     "abscess vs hematoma mri",
                     # Specific anatomic abscesses
                     "psoas abscess", "mri for psoas abscess",
                     # Diabetic foot
                     "diabetic foot ulcer fever",
                     "29yo f diabetic foot ulcer fever",
                     "painful red swollen calf"],
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
                     "hip fracture", "wrist fracture", "ankle fracture",
                     "scaphoid fracture", "vertebral compression fracture",
                     "compression fracture", "vertebral fracture",
                     # Fall + body part patterns (route over hip_pain etc.)
                     "elderly fall hip pain", "fall and hip pain", "fall with hip pain",
                     "fall with leg pain", "fall on outstretched hand", "foosh",
                     "fall outstretched hand", "wrist deformity",
                     "wrist deformity after fall",
                     "fall on outstretched hand wrist deformity",
                     "xray order for elderly fall",
                     # Trauma protocols
                     "ottawa ankle rules", "ankle xray ottawa rules",
                     "ottawa knee rules", "canadian c-spine rule",
                     "nexus criteria", "c-spine nexus", "c-spine clearance",
                     "cervical spine trauma", "ct cervical spine trauma",
                     "ct c-spine for trauma", "spine trauma imaging",
                     "mvc neck pain midline", "mvc neck pain",
                     # Skeletal survey
                     "skeletal survey", "non-accidental trauma skeletal survey",
                     "nat skeletal survey", "child abuse skeletal survey",
                     "non-accidental trauma"],
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
    "hip_dysplasia": {
        "display_name": "Hip Dysplasia / DDH",
        "body_region": "msk",
        "synonyms": ["hip dysplasia", "developmental dysplasia of the hip",
                     "ddh", "ddh infant", "infant hip ultrasound",
                     "us for ddh", "us for ddh infant", "us for ddh infant 4 mo",
                     "hip dysplasia infant", "infant hip",
                     "hip dysplasia suspected", "dysplasia infant"],
        "scenario_keywords": ["hip dysplasia", "dysplasia suspected"],
    },
    "pediatric_limp": {
        "display_name": "Pediatric Limp / Acute Limp <=5yo",
        "body_region": "msk",
        "synonyms": ["pediatric limp", "acute limp", "kid with limping",
                     "kid limp no trauma", "kid limping no trauma",
                     "child limping", "child won't walk", "child won't bear weight",
                     "antalgic gait child", "ped acute limp",
                     "limping toddler", "toddler limping", "limp in young child"],
        "scenario_keywords": ["acute limp", "ped <=5yo"],
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
                     "lymph node enlargement",
                     # B symptoms (often lymphoma workup)
                     "weight loss night sweats lymph nodes",
                     "weight loss night sweats", "b symptoms",
                     "night sweats lymph nodes",
                     # Imaging specific
                     "fdg pet for lymphoma", "fdg pet for lymphoma staging",
                     "lymphoma staging", "lymphoma post rituximab",
                     "ct for sarcoidosis staging", "hilar lymphadenopathy",
                     "mediastinal lymphadenopathy",
                     # Palpable nodes
                     "palpable axillary lymph node", "evaluation of palpable axillary",
                     "painful palpable lump under jaw", "lump under jaw",
                     "lump under arm not painful", "lump under arm",
                     "axillary swelling", "axillary swelling after covid",
                     # FUO often lymph-node mediated
                     "fever of unknown origin", "fuo workup"],
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
                     "venous thrombosis", "lower extremity dvt", "leg swelling",
                     # Common presentations
                     "calf pain and swelling", "calf pain swelling",
                     "calf swelling unilateral", "unilateral calf swelling",
                     "calf pain and redness", "calf pain redness",
                     "painful red swollen calf",
                     "post flight calf pain", "post-flight calf pain",
                     "calf pain post long flight", "calf pain after long flight",
                     "calf pain swelling post flight", "calf pain swelling post-flight",
                     "long flight leg swelling",
                     "blood clot in the leg", "blood clot in leg",
                     "what is a blood clot in the leg",
                     "what is a blood clot"],
        "scenario_keywords": ["deep vein", "dvt", "venous thrombosis", "thrombosis",
                              "extremity swelling", "leg swelling", "edema"]
    },
    "peripheral_vascular": {
        "display_name": "Peripheral Vascular Disease",
        "body_region": "msk",  # PVD scenarios are in MSK region in ACR
        "synonyms": ["peripheral vascular disease", "pvd", "peripheral arterial disease", "pad",
                     "claudication", "limb ischemia",
                     # Presentations
                     "leg pain when walking", "bilateral leg pain when walking",
                     "leg pain when walking elderly",
                     "leg pain when walking elderly diabetic",
                     "leg pain at rest", "rest pain leg",
                     "cold pulseless leg", "sudden cold pulseless leg",
                     "acute limb ischemia", "ali",
                     "non healing leg ulcer", "non-healing leg ulcer",
                     "non healing ulcer foot diabetic"],
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
                     "palpable breast mass",
                     # BI-RADS 3 = probably benign 6-month follow-up
                     "bi-rads 3", "birads 3", "bi rads 3",
                     "bi-rads 3 follow-up", "bi-rads 3 follow-up interval",
                     "birads 3 follow-up", "birads 3 follow-up interval",
                     # Nipple discharge workup
                     "pathologic nipple discharge",
                     "imaging for new pathologic nipple discharge",
                     "imaging for nipple discharge",
                     "new nipple discharge", "nipple discharge",
                     # Microcalcifications / stereotactic
                     "stereotactic biopsy", "stereotactic biopsy for grouped microcalcs",
                     "grouped microcalcifications", "grouped microcalcs",
                     "microcalcifications", "microcalcs"],
        "scenario_keywords": ["breast mass", "breast lump", "breast lesion"]
    },
    "breast_cancer": {
        "display_name": "Breast Cancer",
        "body_region": "breast",
        "synonyms": ["breast cancer", "breast carcinoma", "breast malignancy", "dcis",
                     "ductal carcinoma", "lobular carcinoma",
                     # BI-RADS 4/5 = suspicious / malignant
                     "bi-rads 5", "birads 5", "bi rads 5",
                     "highly suggestive lesion", "bi-rads 5 highly suggestive lesion",
                     "newly diagnosed breast cancer",
                     # Treatment-related imaging
                     "post-lumpectomy mammo", "post-lumpectomy mammogram",
                     "post lumpectomy mammo timing", "post-lumpectomy mammo timing",
                     "mri breast for response to nac", "mri breast for nac",
                     "neoadjuvant chemotherapy breast",
                     "mri breast bilateral with contrast",
                     # Special presentations
                     "mri for paget disease", "paget disease nipple",
                     # Contrast-enhanced mammography
                     "contrast enhanced mammography", "cem",
                     "contrast enhanced mammography cem"],
        "scenario_keywords": ["breast cancer", "breast carcinoma", "ductal", "lobular"]
    },
    "breast_screening": {
        "display_name": "Breast Screening",
        "body_region": "breast",
        "synonyms": ["breast screening", "mammogram", "mammography", "breast cancer screening",
                     "dense breasts", "high risk screening",
                     # Background parenchymal enhancement
                     "bpe", "background parenchymal enhancement",
                     "bpe on screening breast mr",
                     "breast mri background parenchymal enhancement",
                     "breast mri bpe",
                     # Tomosynthesis / DBT
                     "tomosynthesis", "dbt", "digital breast tomosynthesis",
                     "tomosynthesis recall rates",
                     "tomosynthesis recall rates compared to 2d",
                     "tomosynthesis vs 2d", "dbt vs 2d mammography",
                     "tomosynthesis vs mammography",
                     # ABUS
                     "abus", "automated breast ultrasound",
                     "abus vs handheld us", "abus vs handheld us for screening",
                     "automated breast us for screening",
                     # Risk assessment
                     "tyrer cuzick", "tyrer-cuzick", "tyrer-cuzick lifetime risk",
                     "tyrer-cuzick lifetime risk for mri screen",
                     "lifetime risk for mri screen", "lifetime breast cancer risk",
                     # Screening schedule queries
                     "screening mammo schedule", "screening mammogram schedule",
                     "65yo f screening mammo schedule"],
        "scenario_keywords": ["screening", "mammogra", "dense breast"]
    },

    # Curated neuromuscular / atypical concepts (hand-curated scenario lists)
    "myositis": {
        "display_name": "Myositis / Inflammatory Myopathy",
        "body_region": "msk",
        "synonyms": ["myositis", "polymyositis", "dermatomyositis", "inflammatory myopathy",
                     "muscle inflammation", "idiopathic inflammatory myopathy",
                     "pyomyositis", "rhabdomyolysis", "denervation atrophy",
                     # Common myositis presentation patterns
                     "muscle weakness elevated ck", "elevated ck muscle weakness",
                     "proximal muscle weakness", "proximal muscle weakness elevated ck",
                     "proximal muscle weakness with elevated ck",
                     "evaluate proximal muscle weakness with elevated ck",
                     # Whole-body MRI for inflammatory myopathy
                     "iim", "idiopathic inflammatory myopathy",
                     "whole body mri for iim", "mri whole body for iim",
                     "wbmri for myositis", "wbmri myositis"],
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
