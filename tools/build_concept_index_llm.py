#!/usr/bin/env python3
"""
LLM-Assisted Concept Index Builder for Radex

Uses OpenRouter API (with Claude) to:
1. Classify scenario clinical phases with high accuracy
2. Score concept-scenario relevance semantically
3. Cache results to minimize API costs

Usage:
    python tools/build_concept_index_llm.py

Output:
    data/search/concept_index.json
    tools/cache/llm_classifications.json (cached results)
"""

import json
import os
import sys
import time
import hashlib
import requests
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict

# Configuration
CACHE_DIR = Path(__file__).parent / "cache"
CACHE_FILE = CACHE_DIR / "llm_classifications.json"
OPENROUTER_API_KEY = "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"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "anthropic/claude-3.5-sonnet"  # OpenRouter model name
MAX_RETRIES = 3
BATCH_SIZE = 20  # Scenarios per batch for phase classification

# Concept definitions (simplified - just need display name and region for LLM)
CONCEPTS = {
    "brain_neoplasm": {"display_name": "Brain Tumor", "body_region": "neuro"},
    "stroke": {"display_name": "Stroke/CVA", "body_region": "neuro"},
    "headache": {"display_name": "Headache", "body_region": "neuro"},
    "dementia": {"display_name": "Dementia/Cognitive Decline", "body_region": "neuro"},
    "seizure": {"display_name": "Seizure/Epilepsy", "body_region": "neuro"},
    "multiple_sclerosis": {"display_name": "Multiple Sclerosis", "body_region": "neuro"},
    "hydrocephalus": {"display_name": "Hydrocephalus", "body_region": "neuro"},
    "back_pain": {"display_name": "Back Pain", "body_region": "spine"},
    "radiculopathy": {"display_name": "Radiculopathy/Sciatica", "body_region": "spine"},
    "spinal_stenosis": {"display_name": "Spinal Stenosis", "body_region": "spine"},
    "spinal_tumor": {"display_name": "Spinal Tumor", "body_region": "spine"},
    "myelopathy": {"display_name": "Myelopathy", "body_region": "spine"},
    "lung_nodule": {"display_name": "Lung Nodule", "body_region": "chest"},
    "lung_cancer": {"display_name": "Lung Cancer", "body_region": "chest"},
    "pulmonary_embolism": {"display_name": "Pulmonary Embolism", "body_region": "chest"},
    "pneumonia": {"display_name": "Pneumonia", "body_region": "chest"},
    "chest_pain": {"display_name": "Chest Pain", "body_region": "chest"},
    "aortic_aneurysm": {"display_name": "Aortic Aneurysm", "body_region": "chest"},
    "aortic_dissection": {"display_name": "Aortic Dissection", "body_region": "chest"},
    "liver_lesion": {"display_name": "Liver Lesion", "body_region": "abdomen"},
    "liver_cancer": {"display_name": "Liver Cancer/HCC", "body_region": "abdomen"},
    "appendicitis": {"display_name": "Appendicitis", "body_region": "abdomen"},
    "abdominal_pain": {"display_name": "Abdominal Pain", "body_region": "abdomen"},
    "pancreatic_mass": {"display_name": "Pancreatic Mass", "body_region": "abdomen"},
    "kidney_mass": {"display_name": "Kidney Mass", "body_region": "abdomen"},
    "bowel_obstruction": {"display_name": "Bowel Obstruction", "body_region": "abdomen"},
    "colon_cancer": {"display_name": "Colon/Colorectal Cancer", "body_region": "abdomen"},
    "cholecystitis": {"display_name": "Cholecystitis/Gallbladder", "body_region": "abdomen"},
    "knee_pain": {"display_name": "Knee Pain/Injury", "body_region": "msk"},
    "shoulder_pain": {"display_name": "Shoulder Pain/Injury", "body_region": "msk"},
    "hip_pain": {"display_name": "Hip Pain/Injury", "body_region": "msk"},
    "bone_tumor": {"display_name": "Bone Tumor", "body_region": "msk"},
    "fracture": {"display_name": "Fracture", "body_region": "msk"},
    "soft_tissue_mass": {"display_name": "Soft Tissue Mass", "body_region": "msk"},
    "dvt": {"display_name": "Deep Vein Thrombosis", "body_region": "msk"},
    "peripheral_vascular": {"display_name": "Peripheral Vascular Disease", "body_region": "msk"},
    "carotid_stenosis": {"display_name": "Carotid Stenosis", "body_region": "vascular"},
    "breast_mass": {"display_name": "Breast Mass", "body_region": "breast"},
    "breast_cancer": {"display_name": "Breast Cancer", "body_region": "breast"},
    "breast_screening": {"display_name": "Breast Screening", "body_region": "breast"},
}

# Synonyms for each concept (for the final output)
CONCEPT_SYNONYMS = {
    "brain_neoplasm": ["brain tumor", "brain mass", "intracranial tumor", "brain cancer", "glioma", "meningioma", "brain mets"],
    "stroke": ["stroke", "cva", "cerebrovascular accident", "ischemic stroke", "hemorrhagic stroke", "brain infarct", "tia"],
    "headache": ["headache", "head pain", "migraine", "cephalgia"],
    "dementia": ["dementia", "alzheimer", "cognitive decline", "memory loss"],
    "seizure": ["seizure", "epilepsy", "convulsion"],
    "multiple_sclerosis": ["multiple sclerosis", "ms", "demyelinating disease"],
    "hydrocephalus": ["hydrocephalus", "ventriculomegaly"],
    "back_pain": ["back pain", "low back pain", "lumbar pain", "spine pain"],
    "radiculopathy": ["radiculopathy", "sciatica", "pinched nerve", "disc herniation"],
    "spinal_stenosis": ["spinal stenosis", "canal stenosis"],
    "spinal_tumor": ["spinal tumor", "spine tumor", "vertebral tumor", "spine mets"],
    "myelopathy": ["myelopathy", "spinal cord compression", "cord compression"],
    "lung_nodule": ["lung nodule", "pulmonary nodule", "lung lesion"],
    "lung_cancer": ["lung cancer", "lung carcinoma", "nsclc", "sclc"],
    "pulmonary_embolism": ["pulmonary embolism", "pe", "lung clot"],
    "pneumonia": ["pneumonia", "lung infection"],
    "chest_pain": ["chest pain", "thoracic pain", "angina"],
    "aortic_aneurysm": ["aortic aneurysm", "aaa", "thoracic aneurysm"],
    "aortic_dissection": ["aortic dissection", "dissecting aneurysm"],
    "liver_lesion": ["liver lesion", "hepatic lesion", "liver mass", "focal liver lesion"],
    "liver_cancer": ["liver cancer", "hcc", "hepatocellular carcinoma", "hepatoma"],
    "appendicitis": ["appendicitis", "rlq pain"],
    "abdominal_pain": ["abdominal pain", "belly pain", "acute abdomen"],
    "pancreatic_mass": ["pancreatic mass", "pancreas mass", "pancreatic cancer", "pancreatic lesion"],
    "kidney_mass": ["kidney mass", "renal mass", "kidney cancer", "rcc"],
    "bowel_obstruction": ["bowel obstruction", "intestinal obstruction", "sbo"],
    "colon_cancer": ["colon cancer", "colorectal cancer", "rectal cancer"],
    "cholecystitis": ["cholecystitis", "gallstones", "biliary colic"],
    "knee_pain": ["knee pain", "knee injury", "acl tear", "meniscus tear"],
    "shoulder_pain": ["shoulder pain", "rotator cuff", "shoulder injury"],
    "hip_pain": ["hip pain", "hip fracture", "avascular necrosis"],
    "bone_tumor": ["bone tumor", "bone cancer", "osteosarcoma"],
    "fracture": ["fracture", "broken bone", "stress fracture"],
    "soft_tissue_mass": ["soft tissue mass", "soft tissue tumor", "sarcoma"],
    "dvt": ["dvt", "deep vein thrombosis", "leg clot"],
    "peripheral_vascular": ["peripheral vascular disease", "pvd", "claudication"],
    "carotid_stenosis": ["carotid stenosis", "carotid artery disease"],
    "breast_mass": ["breast mass", "breast lump", "breast lesion"],
    "breast_cancer": ["breast cancer", "breast carcinoma", "dcis"],
    "breast_screening": ["breast screening", "mammogram", "mammography"],
}


class LLMConceptIndexBuilder:
    def __init__(self, api_key):
        self.api_key = api_key
        self.cache = self.load_cache()
        self.stats = defaultdict(int)

    def call_llm(self, prompt, max_tokens=1024):
        """Call OpenRouter API with Claude model."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://avg-hounsfield.github.io",
            "X-Title": "Radex Concept Builder"
        }

        data = {
            "model": MODEL,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}]
        }

        response = requests.post(OPENROUTER_URL, headers=headers, json=data, timeout=60)
        response.raise_for_status()
        result = response.json()
        return result['choices'][0]['message']['content']

    def load_cache(self):
        """Load cached LLM results to avoid re-processing."""
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        if CACHE_FILE.exists():
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {"phases": {}, "relevance": {}}

    def save_cache(self):
        """Save cache to disk."""
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(self.cache, f, indent=2, ensure_ascii=False)

    def get_cache_key(self, text):
        """Generate a cache key for a piece of text."""
        return hashlib.md5(text.encode()).hexdigest()[:16]

    def classify_phases_batch(self, scenarios):
        """Classify clinical phases for a batch of scenarios using LLM."""
        # Filter out already cached scenarios
        uncached = []
        results = {}

        for s in scenarios:
            cache_key = self.get_cache_key(s['name'])
            if cache_key in self.cache['phases']:
                results[s['id']] = self.cache['phases'][cache_key]
                self.stats['phase_cache_hits'] += 1
            else:
                uncached.append(s)

        if not uncached:
            return results

        # Build prompt for uncached scenarios
        scenario_list = "\n".join([
            f"{i+1}. [{s['id']}] {s['name']}"
            for i, s in enumerate(uncached)
        ])

        prompt = f"""Classify each radiology scenario into its clinical phase.

Phases:
- screening: Asymptomatic patients, risk assessment, routine surveillance without symptoms
- initial: First workup, suspected condition, diagnosis, acute presentation
- pretreatment: Staging, surgical planning, pre-operative evaluation
- surveillance: Post-treatment monitoring, follow-up, recurrence detection
- complication: Treatment failure, progression, adverse events

For each scenario, output ONLY the scenario number and phase, one per line.
Format: [number]. [phase]

Scenarios:
{scenario_list}

Output:"""

        for attempt in range(MAX_RETRIES):
            try:
                response_text = self.call_llm(prompt, max_tokens=1024)

                # Parse response
                lines = response_text.strip().split('\n')
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    # Parse "1. screening" or "1. [7903] screening" format
                    parts = line.split('.')
                    if len(parts) >= 2:
                        try:
                            idx = int(parts[0].strip()) - 1
                            phase = parts[1].strip().lower().split()[0]  # Get first word after number
                            if phase in ['screening', 'initial', 'pretreatment', 'surveillance', 'complication']:
                                if idx < len(uncached):
                                    scenario = uncached[idx]
                                    results[scenario['id']] = phase
                                    # Cache the result
                                    cache_key = self.get_cache_key(scenario['name'])
                                    self.cache['phases'][cache_key] = phase
                                    self.stats['phase_api_calls'] += 1
                        except (ValueError, IndexError):
                            continue

                break  # Success
            except Exception as e:
                print(f"  API error (attempt {attempt + 1}): {e}")
                if attempt < MAX_RETRIES - 1:
                    time.sleep(2 ** attempt)  # Exponential backoff

        # Default unclassified to 'initial'
        for s in uncached:
            if s['id'] not in results:
                results[s['id']] = 'initial'
                self.stats['phase_defaults'] += 1

        return results

    def score_relevance_batch(self, concept_id, concept_name, scenarios):
        """Score relevance between a concept and scenarios using LLM."""
        results = {}

        # Check cache first
        uncached = []
        for s in scenarios:
            cache_key = f"{concept_id}:{self.get_cache_key(s['name'])}"
            if cache_key in self.cache['relevance']:
                results[s['id']] = self.cache['relevance'][cache_key]
                self.stats['relevance_cache_hits'] += 1
            else:
                uncached.append(s)

        if not uncached:
            return results

        # Build prompt
        scenario_list = "\n".join([
            f"{i+1}. {s['name'][:100]}"
            for i, s in enumerate(uncached[:30])  # Limit batch size
        ])

        prompt = f"""Rate how relevant each radiology scenario is to the concept "{concept_name}".

Score from 0-10:
- 10: Directly about this condition
- 7-9: Highly relevant, primary topic
- 4-6: Moderately relevant, secondary topic
- 1-3: Weakly relevant, mentioned but not focus
- 0: Not relevant

Output ONLY number and score, one per line.
Format: [number]. [score]

Concept: {concept_name}

Scenarios:
{scenario_list}

Output:"""

        for attempt in range(MAX_RETRIES):
            try:
                response_text = self.call_llm(prompt, max_tokens=512)

                # Parse response
                lines = response_text.strip().split('\n')
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    parts = line.split('.')
                    if len(parts) >= 2:
                        try:
                            idx = int(parts[0].strip()) - 1
                            score_text = parts[1].strip().split()[0]
                            score = int(score_text) / 10.0  # Normalize to 0-1
                            if 0 <= score <= 1 and idx < len(uncached):
                                scenario = uncached[idx]
                                results[scenario['id']] = score
                                # Cache
                                cache_key = f"{concept_id}:{self.get_cache_key(scenario['name'])}"
                                self.cache['relevance'][cache_key] = score
                                self.stats['relevance_api_calls'] += 1
                        except (ValueError, IndexError):
                            continue

                break
            except Exception as e:
                print(f"  API error (attempt {attempt + 1}): {e}")
                if attempt < MAX_RETRIES - 1:
                    time.sleep(2 ** attempt)

        # Default unscored to 0.5
        for s in uncached[:30]:
            if s['id'] not in results:
                results[s['id']] = 0.5
                self.stats['relevance_defaults'] += 1

        return results

    def build_index(self, project_root):
        """Build the concept index using LLM assistance."""
        regions_dir = project_root / "data" / "regions"

        # Load all scenarios
        all_scenarios = []
        for region_file in regions_dir.glob("*.json"):
            region_name = region_file.stem
            with open(region_file, 'r', encoding='utf-8') as f:
                region_data = json.load(f)
            for scenario in region_data.get("scenarios", []):
                scenario["_region"] = region_name
                all_scenarios.append(scenario)

        print(f"Loaded {len(all_scenarios)} scenarios")

        # Step 1: Classify phases for all scenarios
        print("\n[Phase Classification]")
        phase_results = {}
        for i in range(0, len(all_scenarios), BATCH_SIZE):
            batch = all_scenarios[i:i + BATCH_SIZE]
            print(f"  Processing scenarios {i+1}-{i+len(batch)}...")
            batch_results = self.classify_phases_batch(batch)
            phase_results.update(batch_results)
            self.save_cache()  # Save after each batch

        print(f"  Classified {len(phase_results)} scenarios")
        print(f"  Cache hits: {self.stats['phase_cache_hits']}, API calls: {self.stats['phase_api_calls']}")

        # Step 2: Score relevance for each concept
        print("\n[Relevance Scoring]")
        concept_index = {
            "version": "2.0-llm",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "concepts": {},
            "synonym_to_concept": {}
        }

        for concept_id, concept_def in CONCEPTS.items():
            concept_name = concept_def['display_name']
            concept_region = concept_def['body_region']

            print(f"  Processing {concept_name}...")

            # Get scenarios from this region
            region_scenarios = [s for s in all_scenarios if s.get('_region') == concept_region]

            if not region_scenarios:
                continue

            # Score relevance in batches
            relevance_scores = {}
            for i in range(0, len(region_scenarios), 30):
                batch = region_scenarios[i:i + 30]
                batch_scores = self.score_relevance_batch(concept_id, concept_name, batch)
                relevance_scores.update(batch_scores)

            self.save_cache()

            # Build scenario mappings (only include relevant scenarios)
            scenario_mappings = []
            for scenario in region_scenarios:
                relevance = relevance_scores.get(scenario['id'], 0.5)
                if relevance >= 0.3:  # Threshold for inclusion
                    phase = phase_results.get(scenario['id'], 'initial')
                    phase_display = {
                        'screening': 'Screening',
                        'initial': 'Initial Workup',
                        'pretreatment': 'Pretreatment Staging',
                        'surveillance': 'Surveillance',
                        'complication': 'Complication Assessment'
                    }.get(phase, phase.title())

                    scenario_mappings.append({
                        "scenario_id": scenario['id'],
                        "scenario_name": scenario['name'],
                        "relevance_score": round(relevance, 2),
                        "region": scenario['_region'],
                        "metadata": {
                            "phase": phase,
                            "phase_display": phase_display,
                            "procedure_count": len(scenario.get('procedures', [])),
                            "high_rated_count": len([p for p in scenario.get('procedures', []) if p.get('rating', 0) >= 7])
                        }
                    })

            # Sort by relevance and limit
            scenario_mappings.sort(key=lambda x: -x['relevance_score'])
            scenario_mappings = scenario_mappings[:50]

            if scenario_mappings:
                concept_index['concepts'][concept_id] = {
                    "display_name": concept_name,
                    "body_region": concept_region,
                    "synonyms": CONCEPT_SYNONYMS.get(concept_id, [concept_name.lower()]),
                    "scenario_mappings": scenario_mappings
                }
                print(f"    Found {len(scenario_mappings)} relevant scenarios")

        # Build synonym lookup
        for concept_id, synonyms in CONCEPT_SYNONYMS.items():
            for syn in synonyms:
                concept_index['synonym_to_concept'][syn.lower()] = concept_id

        return concept_index


def main():
    # Use OpenRouter API key
    api_key = OPENROUTER_API_KEY
    if not api_key:
        print("Error: OpenRouter API key not configured")
        sys.exit(1)

    script_dir = Path(__file__).parent
    project_root = script_dir.parent

    print("=" * 60)
    print("LLM-Assisted Concept Index Builder (OpenRouter)")
    print("=" * 60)

    builder = LLMConceptIndexBuilder(api_key)
    concept_index = builder.build_index(project_root)

    # Save output
    output_path = project_root / "data" / "search" / "concept_index.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(concept_index, f, indent=2, ensure_ascii=False)

    print(f"\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"Concepts: {len(concept_index['concepts'])}")
    print(f"Synonyms: {len(concept_index['synonym_to_concept'])}")
    print(f"Output: {output_path}")
    print(f"\nStats:")
    for key, value in builder.stats.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
