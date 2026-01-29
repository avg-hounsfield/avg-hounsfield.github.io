#!/usr/bin/env python3
"""
LLM-Assisted Protocol Generator for Radex

Uses OpenRouter API to generate clinically appropriate MRI protocols
for procedures that are currently unmapped.

Usage:
    python tools/build_missing_protocols.py

Output:
    Updates data/protocols.json with new protocols
    tools/cache/protocol_generation.json (cached results)
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
CACHE_FILE = CACHE_DIR / "protocol_generation.json"
OPENROUTER_API_KEY = "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"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "anthropic/claude-3.5-sonnet"
MAX_RETRIES = 3

# Protocols we need to generate
PROTOCOLS_TO_GENERATE = [
    {
        "name": "CHEST",
        "display_name": "CHEST",
        "body_region": "chest",
        "body_part": "chest",
        "section": "Chest Imaging",
        "uses_contrast": 1,
        "description": "MRI of the chest wall, mediastinum, and thoracic structures",
        "indications": ["chest wall mass", "mediastinal mass", "brachial plexus", "thoracic outlet"]
    },
    {
        "name": "CHEST W/O",
        "display_name": "CHEST W/O",
        "body_region": "chest",
        "body_part": "chest",
        "section": "Chest Imaging",
        "uses_contrast": 0,
        "description": "Non-contrast MRI of the chest",
        "indications": ["chest wall evaluation", "rib lesion", "sternum"]
    },
    {
        "name": "CARDIAC STRESS",
        "display_name": "CARDIAC STRESS",
        "body_region": "chest",
        "body_part": "heart",
        "section": "Cardiac Imaging",
        "uses_contrast": 1,
        "description": "Cardiac MRI with pharmacologic stress for ischemia evaluation",
        "indications": ["coronary artery disease", "chest pain", "ischemia evaluation", "stress perfusion"]
    },
    {
        "name": "WHOLE BODY",
        "display_name": "WHOLE BODY",
        "body_region": "msk",
        "body_part": "whole_body",
        "section": "MSK Imaging",
        "uses_contrast": 0,
        "description": "Whole body MRI screening for metastatic disease or systemic conditions",
        "indications": ["metastatic workup", "multiple myeloma", "bone metastases screening", "fever of unknown origin"]
    },
    {
        "name": "WHOLE BODY +C",
        "display_name": "WHOLE BODY +C",
        "body_region": "msk",
        "body_part": "whole_body",
        "section": "MSK Imaging",
        "uses_contrast": 1,
        "description": "Whole body MRI with contrast for oncologic staging",
        "indications": ["oncologic staging", "lymphoma", "metastatic disease", "tumor surveillance"]
    },
    {
        "name": "MR ARTHROGRAM",
        "display_name": "MR ARTHROGRAM",
        "body_region": "msk",
        "body_part": "joint",
        "section": "MSK Imaging",
        "uses_contrast": 1,
        "description": "MR arthrography with intra-articular contrast injection",
        "indications": ["labral tear", "cartilage defect", "loose bodies", "ligament injury"]
    },
    {
        "name": "MR ENTEROGRAPHY",
        "display_name": "MR ENTEROGRAPHY",
        "body_region": "abdomen",
        "body_part": "small_bowel",
        "section": "Abdomen Imaging",
        "uses_contrast": 1,
        "description": "MRI of the small bowel with oral and IV contrast",
        "indications": ["Crohn disease", "small bowel inflammation", "IBD evaluation", "small bowel obstruction"]
    },
    {
        "name": "MR DEFECOGRAPHY",
        "display_name": "MR DEFECOGRAPHY",
        "body_region": "abdomen",
        "body_part": "pelvis",
        "section": "Abdomen Imaging",
        "uses_contrast": 0,
        "description": "Dynamic MRI of the pelvic floor during defecation",
        "indications": ["pelvic floor dysfunction", "rectal prolapse", "rectocele", "constipation"]
    },
    {
        "name": "FETAL",
        "display_name": "FETAL MRI",
        "body_region": "abdomen",
        "body_part": "fetus",
        "section": "Abdomen Imaging",
        "uses_contrast": 0,
        "description": "MRI of the fetus for prenatal diagnosis",
        "indications": ["fetal anomaly", "CNS abnormality", "prenatal diagnosis", "placental evaluation"]
    }
]


def load_cache():
    """Load cached LLM responses."""
    CACHE_DIR.mkdir(exist_ok=True)
    if CACHE_FILE.exists():
        with open(CACHE_FILE, 'r') as f:
            return json.load(f)
    return {}


def save_cache(cache):
    """Save LLM responses to cache."""
    CACHE_DIR.mkdir(exist_ok=True)
    with open(CACHE_FILE, 'w') as f:
        json.dump(cache, f, indent=2)


def get_cache_key(protocol_name):
    """Generate cache key for a protocol."""
    return f"protocol_{protocol_name}"


def call_llm(prompt, system_prompt=None):
    """Call OpenRouter API with retry logic."""
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://radex.app",
                    "X-Title": "Radex Protocol Generator"
                },
                json={
                    "model": MODEL,
                    "messages": messages,
                    "temperature": 0.3,
                    "max_tokens": 2000
                },
                timeout=60
            )

            if response.status_code == 200:
                result = response.json()
                return result['choices'][0]['message']['content']
            elif response.status_code == 429:
                wait_time = 2 ** attempt
                print(f"  Rate limited, waiting {wait_time}s...")
                time.sleep(wait_time)
            else:
                print(f"  API error {response.status_code}: {response.text}")
                time.sleep(1)

        except Exception as e:
            print(f"  Request error: {e}")
            time.sleep(1)

    return None


def generate_protocol_sequences(protocol_def, cache):
    """Use LLM to generate sequences for a protocol."""
    cache_key = get_cache_key(protocol_def['name'])

    if cache_key in cache:
        print(f"  Using cached result for {protocol_def['name']}")
        return cache[cache_key]

    system_prompt = """You are an expert radiologist helping design MRI protocols.
Generate clinically appropriate MRI sequences for the given protocol.
Return ONLY valid JSON with no markdown formatting or explanation.
Use standard sequence naming conventions (e.g., "AX T1", "SAG T2 FS", "COR T1 FS POST")."""

    prompt = f"""Generate MRI sequences for this protocol:

Protocol: {protocol_def['name']}
Description: {protocol_def['description']}
Uses Contrast: {"Yes" if protocol_def['uses_contrast'] else "No"}
Clinical Indications: {', '.join(protocol_def['indications'])}

Return a JSON object with this exact structure:
{{
    "sequences": [
        {{"sequence_name": "AX T1", "is_post_contrast": 0, "sort_order": 0}},
        ...
    ],
    "indications": "Brief clinical indication text",
    "contrast_rationale": "Why contrast is/isn't needed (or null if no contrast)",
    "keywords": ["keyword1", "keyword2", ...],
    "scanner_notes": ["note1", "note2"]
}}

Requirements:
- Include 4-8 sequences appropriate for the clinical indication
- Use standard abbreviations: AX (axial), SAG (sagittal), COR (coronal)
- Use standard weightings: T1, T2, PD, STIR, DWI, FLAIR
- Add FS (fat sat) where appropriate
- Mark post-contrast sequences with is_post_contrast: 1
- Order sequences logically (pre-contrast before post-contrast)
- Include relevant keywords for search
- Add practical scanner notes

Return ONLY the JSON object, no markdown or explanation."""

    print(f"  Generating sequences for {protocol_def['name']}...")
    response = call_llm(prompt, system_prompt)

    if response:
        try:
            # Clean up response - remove markdown if present
            cleaned = response.strip()
            if cleaned.startswith('```'):
                cleaned = cleaned.split('\n', 1)[1]
            if cleaned.endswith('```'):
                cleaned = cleaned.rsplit('```', 1)[0]
            cleaned = cleaned.strip()

            result = json.loads(cleaned)
            cache[cache_key] = result
            save_cache(cache)
            return result
        except json.JSONDecodeError as e:
            print(f"  Failed to parse JSON: {e}")
            print(f"  Response was: {response[:500]}...")

    return None


def load_existing_protocols():
    """Load existing protocols from protocols.json."""
    protocols_path = Path(__file__).parent.parent / "data" / "protocols.json"
    with open(protocols_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_protocols(protocols):
    """Save protocols to protocols.json."""
    protocols_path = Path(__file__).parent.parent / "data" / "protocols.json"
    with open(protocols_path, 'w', encoding='utf-8') as f:
        json.dump(protocols, f, indent=2, ensure_ascii=False)


def protocol_exists(protocols, name):
    """Check if a protocol already exists."""
    return any(p.get('name') == name for p in protocols)


def main():
    print("=" * 70)
    print("MRI Protocol Generator")
    print("=" * 70)

    # Load existing protocols and cache
    protocols = load_existing_protocols()
    cache = load_cache()

    print(f"Loaded {len(protocols)} existing protocols")
    print(f"Cache has {len(cache)} entries")
    print()

    # Generate missing protocols
    generated_count = 0
    skipped_count = 0

    for protocol_def in PROTOCOLS_TO_GENERATE:
        name = protocol_def['name']

        if protocol_exists(protocols, name):
            print(f"SKIP: {name} already exists")
            skipped_count += 1
            continue

        print(f"\nGenerating: {name}")
        result = generate_protocol_sequences(protocol_def, cache)

        if result:
            # Build the full protocol object
            new_protocol = {
                "name": protocol_def['name'],
                "display_name": protocol_def['display_name'],
                "uses_contrast": protocol_def['uses_contrast'],
                "section": protocol_def['section'],
                "sections": [protocol_def['section']],
                "body_region": protocol_def['body_region'],
                "body_part": protocol_def['body_part'],
                "is_pediatric": False,
                "keywords": result.get('keywords', []),
                "indications": result.get('indications', protocol_def['description']),
                "contrast_rationale": result.get('contrast_rationale'),
                "canonical_procedure": f"MRI {protocol_def['body_part'].replace('_', ' ').title()} {'W/ & W/O' if protocol_def['uses_contrast'] else 'W/O'} Contrast",
                "sequences": result.get('sequences', []),
                "scanner_notes": result.get('scanner_notes', []),
                "scenario_matches": [],
                "_generated": {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "model": MODEL,
                    "source": "build_missing_protocols.py"
                }
            }

            protocols.append(new_protocol)
            generated_count += 1
            print(f"  SUCCESS: Added {len(result.get('sequences', []))} sequences")
        else:
            print(f"  FAILED: Could not generate sequences")

    # Save updated protocols
    if generated_count > 0:
        save_protocols(protocols)
        print()
        print("=" * 70)
        print(f"Generated {generated_count} new protocols")
        print(f"Skipped {skipped_count} existing protocols")
        print(f"Total protocols: {len(protocols)}")
        print("=" * 70)
    else:
        print()
        print("No new protocols generated")


if __name__ == "__main__":
    main()
