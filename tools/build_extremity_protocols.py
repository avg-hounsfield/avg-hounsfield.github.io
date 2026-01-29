#!/usr/bin/env python3
"""
Generate specialized extremity bone protocols using OpenRouter API.

Creates:
- BONE TUMOR: For bone tumors, masses, metastases
- OSTEONECROSIS: For AVN/osteonecrosis evaluation

These are distinct from joint protocols (knee, hip, shoulder) which focus on
ligaments/cartilage, while bone protocols focus on marrow and cortex.
"""

import json
import requests
from pathlib import Path
from datetime import datetime, timezone

OPENROUTER_API_KEY = "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"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "anthropic/claude-sonnet-4"

PROTOCOLS_TO_GENERATE = [
    {
        "name": "BONE TUMOR",
        "display_name": "BONE TUMOR",
        "body_region": "msk",
        "body_part": "extremity",
        "section": "MSK Imaging",
        "uses_contrast": 1,
        "description": "MRI for evaluation of primary bone tumors, soft tissue masses, and metastatic disease in the extremities",
        "indications": ["bone tumor", "soft tissue mass", "bone metastasis", "sarcoma", "pathologic fracture", "marrow replacement"],
        "clinical_context": "Used when the clinical question is tumor characterization, staging, or metastatic workup - NOT for joint pathology"
    },
    {
        "name": "OSTEONECROSIS",
        "display_name": "OSTEONECROSIS",
        "body_region": "msk",
        "body_part": "extremity",
        "section": "MSK Imaging",
        "uses_contrast": 0,
        "description": "MRI for evaluation of avascular necrosis (AVN) / osteonecrosis in the extremities",
        "indications": ["osteonecrosis", "avascular necrosis", "AVN", "bone infarct", "steroid use", "sickle cell"],
        "clinical_context": "Used for AVN evaluation - contrast typically not needed unless looking for complications"
    }
]

def generate_protocol_sequences(protocol_info):
    """Use LLM to generate appropriate sequences for a protocol."""

    prompt = f"""You are a radiology MRI protocol expert. Generate the MRI sequences for this protocol:

Protocol: {protocol_info['name']}
Description: {protocol_info['description']}
Uses Contrast: {'Yes' if protocol_info['uses_contrast'] else 'No'}
Clinical Indications: {', '.join(protocol_info['indications'])}
Clinical Context: {protocol_info.get('clinical_context', '')}

Generate a JSON object with these fields:
1. "sequences": Array of sequence objects, each with:
   - "sequence_name": Standard MRI sequence name (e.g., "SAG T1", "AX T2 FS", "COR STIR")
   - "is_post_contrast": 0 or 1
   - "sort_order": integer starting at 0

2. "indications": A 1-2 sentence clinical indication statement

3. "contrast_rationale": If contrast is used, explain why (or null if no contrast)

4. "keywords": Array of 8-12 relevant search keywords

5. "scanner_notes": Array of scanner-specific notes (can be empty)

Important considerations for BONE TUMOR protocol:
- Must include T1 for marrow signal (fat-containing normal marrow is bright)
- Must include fluid-sensitive sequence (STIR or T2 FS) for edema
- Contrast sequences are critical for tumor characterization
- Large FOV to see extent of disease and skip lesions
- Consider both axial and coronal/sagittal planes

Important considerations for OSTEONECROSIS protocol:
- T1 is essential - AVN shows as low signal replacing normal marrow fat
- STIR/T2 FS for bone marrow edema pattern
- Coronal plane often best for femoral head AVN
- Look for "double line sign" on T2
- Usually no contrast needed unless evaluating for collapse/complications

Return ONLY valid JSON, no explanation."""

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://radex.app",
        "X-Title": "Radex Protocol Generator"
    }

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": 2000
    }

    print(f"  Generating sequences for {protocol_info['name']}...")

    response = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=60)
    response.raise_for_status()

    result = response.json()
    content = result['choices'][0]['message']['content']

    # Extract JSON from response
    if '```json' in content:
        content = content.split('```json')[1].split('```')[0]
    elif '```' in content:
        content = content.split('```')[1].split('```')[0]

    return json.loads(content.strip())


def main():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent

    print("=" * 60)
    print("Generating Extremity Bone Protocols")
    print("=" * 60)

    # Load existing protocols
    protocols_path = project_root / "data" / "protocols.json"
    with open(protocols_path, 'r', encoding='utf-8') as f:
        protocols = json.load(f)

    existing_names = {p['name'] for p in protocols}
    new_protocols = []

    for proto_info in PROTOCOLS_TO_GENERATE:
        if proto_info['name'] in existing_names:
            print(f"\n{proto_info['name']}: Already exists, skipping")
            continue

        print(f"\n{proto_info['name']}:")

        try:
            generated = generate_protocol_sequences(proto_info)

            # Build the full protocol object
            protocol = {
                "name": proto_info['name'],
                "display_name": proto_info['display_name'],
                "uses_contrast": proto_info['uses_contrast'],
                "section": proto_info['section'],
                "sections": [proto_info['section']],
                "body_region": proto_info['body_region'],
                "body_part": proto_info['body_part'],
                "is_pediatric": False,
                "keywords": generated.get('keywords', []),
                "indications": generated.get('indications', proto_info['description']),
                "contrast_rationale": generated.get('contrast_rationale'),
                "canonical_procedure": f"MRI Extremity {'W/WO' if proto_info['uses_contrast'] else 'W/O'} Contrast",
                "sequences": generated.get('sequences', []),
                "scanner_notes": generated.get('scanner_notes', []),
                "scenario_matches": [],
                "_generated": {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "model": MODEL,
                    "source": "build_extremity_protocols.py"
                }
            }

            new_protocols.append(protocol)

            print(f"  Generated {len(protocol['sequences'])} sequences")
            for seq in protocol['sequences']:
                contrast_marker = " [POST]" if seq.get('is_post_contrast') else ""
                print(f"    - {seq['sequence_name']}{contrast_marker}")

        except Exception as e:
            print(f"  ERROR: {e}")
            continue

    if new_protocols:
        # Add new protocols to the list
        protocols.extend(new_protocols)

        # Save updated protocols
        with open(protocols_path, 'w', encoding='utf-8') as f:
            json.dump(protocols, f, indent=2, ensure_ascii=False)

        print(f"\n{'=' * 60}")
        print(f"Added {len(new_protocols)} new protocols to {protocols_path}")
        print(f"Total protocols: {len(protocols)}")
    else:
        print("\nNo new protocols to add.")


if __name__ == "__main__":
    main()
