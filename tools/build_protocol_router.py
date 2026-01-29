#!/usr/bin/env python3
"""
Protocol Router Builder for Radex

Creates smart routing from ACR procedures to scanner protocols based on clinical context.

The routing handles:
1. ACR terminology -> Institutional terminology normalization
2. Context-aware protocol selection (same procedure -> different protocols based on indication)
3. Fallback matching for procedures not explicitly mapped

Usage:
    python tools/build_protocol_router.py

Output:
    data/search/protocol_router.json
"""

import json
import re
from pathlib import Path
from collections import defaultdict


def normalize_procedure_name(name):
    """Normalize an ACR procedure name to a canonical form."""
    name = name.lower().strip()

    # Standardize contrast terminology
    name = re.sub(r'without iv contrast', 'wo_contrast', name)
    name = re.sub(r'with iv contrast', 'w_contrast', name)
    name = re.sub(r'without and with iv contrast', 'wwo_contrast', name)

    # Standardize body parts
    replacements = {
        r'\bhead\b': 'brain',
        r'\bcervical spine\b': 'c_spine',
        r'\bthoracic spine\b': 't_spine',
        r'\blumbar spine\b': 'l_spine',
        r'\blumbosacral\b': 'ls_spine',
        r'\bcomplete spine\b': 'total_spine',
        r'\btemporomandibular\b': 'tmj',
        r'\bsacroiliac\b': 'si_joint',
        r'\binternal auditory canal\b': 'iac',
    }
    for pattern, replacement in replacements.items():
        name = re.sub(pattern, replacement, name)

    # Remove extra spaces
    name = re.sub(r'\s+', ' ', name)

    return name


def extract_procedure_components(name):
    """Extract modality, body part, and contrast from a procedure name."""
    name_lower = name.lower()

    # Determine modality
    if 'mra ' in name_lower or name_lower.startswith('mra'):
        modality = 'MRA'
    elif 'mrv ' in name_lower:
        modality = 'MRV'
    elif 'mrcp' in name_lower:
        modality = 'MRCP'
    elif 'pet/mri' in name_lower:
        modality = 'PET/MRI'
    elif 'mr ' in name_lower or 'mri ' in name_lower:
        modality = 'MRI'
    else:
        modality = 'MRI'

    # Determine contrast - order matters! Check "without and with" first
    if 'without and with' in name_lower or 'with and without' in name_lower:
        contrast = 'both'
    elif 'without' in name_lower:
        contrast = 'none'
    elif 'with iv contrast' in name_lower or 'with contrast' in name_lower:
        contrast = 'with'
    else:
        contrast = 'unknown'

    # Extract body part (simplified)
    body_part = None
    body_part_patterns = [
        (r'\bhead and orbits\b', 'brain_orbits'),
        (r'\borbits face neck\b', 'orbits_face_neck'),
        (r'\borbits face\b', 'orbits_face'),
        (r'\b(head|brain)\b', 'brain'),
        (r'\bcervical spine\b', 'cervical_spine'),
        (r'\bthoracic spine\b', 'thoracic_spine'),
        (r'\blumbar spine\b', 'lumbar_spine'),
        (r'\blumbosacral\b', 'lumbosacral_spine'),
        (r'\bcomplete spine\b', 'complete_spine'),
        (r'\bspine area\b', 'spine'),
        (r'\binternal auditory canal\b', 'iac'),
        (r'\borbit', 'orbits'),
        (r'\bsella\b', 'sella'),
        (r'\bpituitary\b', 'pituitary'),
        (r'\bknee\b', 'knee'),
        (r'\bshoulder\b', 'shoulder'),
        (r'\bhip\b', 'hip'),
        (r'\bankle\b', 'ankle'),
        (r'\bwrist\b', 'wrist'),
        (r'\belbow\b', 'elbow'),
        (r'\bhand\b', 'hand'),
        (r'\bfoot\b', 'foot'),
        (r'\blower leg\b', 'lower_leg'),
        (r'\bthigh\b', 'thigh'),
        (r'\bforearm\b', 'forearm'),
        (r'\bupper arm\b', 'upper_arm'),
        (r'\blower extremity\b', 'lower_extremity'),
        (r'\bupper extremity\b', 'upper_extremity'),
        (r'\babdomen and pelvis\b', 'abdomen_pelvis'),
        (r'\babdomen\b', 'abdomen'),
        (r'\bpelvis\b', 'pelvis'),
        (r'\bliver\b', 'liver'),
        (r'\bkidney\b', 'kidney'),
        (r'\bpancreas\b', 'pancreas'),
        (r'\bprostate\b', 'prostate'),
        (r'\bbreast\b', 'breast'),
        (r'\bheart\b', 'heart'),
        (r'\bchest\b', 'chest'),
        (r'\bneck\b', 'neck'),
        (r'\btemporomandibular|tmj\b', 'tmj'),
        (r'\bsacroiliac\b', 'si_joint'),
        (r'\bsacrum\b', 'sacrum'),
        (r'\bparanasal|sinus\b', 'sinuses'),
        (r'\bmaxillofacial\b', 'maxillofacial'),
        (r'\bfetal\b', 'fetal'),
        (r'\bwhole body\b', 'whole_body'),
    ]

    for pattern, part in body_part_patterns:
        if re.search(pattern, name_lower):
            body_part = part
            break

    return {
        'modality': modality,
        'contrast': contrast,
        'body_part': body_part
    }


def match_context(scenario_name, context_keywords):
    """Check if any context keywords match the scenario name."""
    scenario_lower = scenario_name.lower()
    for keyword in context_keywords:
        if keyword.lower() in scenario_lower:
            return True
    return False


def build_router(project_root):
    """Build the protocol router from registry and protocols."""

    # Load procedure registry
    registry_path = project_root / "data" / "search" / "procedure_registry.json"
    with open(registry_path, 'r', encoding='utf-8') as f:
        registry = json.load(f)

    # Load protocols
    protocols_path = project_root / "data" / "protocols.json"
    with open(protocols_path, 'r', encoding='utf-8') as f:
        protocols = json.load(f)

    # Build protocol lookup
    protocol_lookup = {p['name']: p for p in protocols}

    # Load all ACR MRI procedures
    regions_dir = project_root / "data" / "regions"
    all_acr_procedures = set()
    procedure_scenarios = defaultdict(list)  # procedure -> list of scenario names

    for region_file in regions_dir.glob("*.json"):
        with open(region_file, 'r', encoding='utf-8') as f:
            region_data = json.load(f)

        for scenario in region_data.get('scenarios', []):
            for proc in scenario.get('procedures', []):
                proc_name = proc.get('name', '')
                if 'MRI' in proc_name.upper() or 'MR ' in proc_name.upper() or 'MRCP' in proc_name.upper():
                    all_acr_procedures.add(proc_name)
                    if proc.get('rating', 0) >= 7:  # Only track high-rated
                        procedure_scenarios[proc_name].append(scenario['name'])

    print(f"Found {len(all_acr_procedures)} unique ACR MRI procedures")

    # Build the router
    router = {
        "version": "1.0",
        "description": "Smart routing from ACR procedures to scanner protocols",
        "procedure_count": len(all_acr_procedures),
        "mapped_count": 0,
        "unmapped_count": 0,
        "routes": {},
        "unmapped_procedures": []
    }

    # Map each ACR procedure
    for acr_proc in sorted(all_acr_procedures):
        # Try exact match in registry
        matched = False
        for proc_id, proc_def in registry.get('procedures', {}).items():
            if proc_def.get('acr_name', '').lower() == acr_proc.lower():
                # Found exact match
                route_entry = {
                    "canonical_display": proc_def['canonical_display'],
                    "body_region": proc_def['body_region'],
                    "body_part": proc_def['body_part'],
                    "contrast": proc_def['contrast'],
                    "protocol_routes": proc_def['protocol_routes'],
                    "match_type": "exact"
                }
                # Include supplemental sequences if defined
                if 'supplemental_sequences' in proc_def:
                    route_entry['supplemental_sequences'] = proc_def['supplemental_sequences']
                router['routes'][acr_proc] = route_entry
                router['mapped_count'] += 1
                matched = True
                break

        if not matched:
            # Try component-based matching
            components = extract_procedure_components(acr_proc)

            # Look for a protocol that matches body part
            matching_protocols = []
            for protocol in protocols:
                proto_body = protocol.get('body_part', '').lower()
                if components['body_part'] and components['body_part'].replace('_', ' ') in proto_body:
                    matching_protocols.append(protocol['name'])
                elif components['body_part'] and proto_body in components['body_part'].replace('_', ' '):
                    matching_protocols.append(protocol['name'])

            if matching_protocols:
                router['routes'][acr_proc] = {
                    "canonical_display": acr_proc,  # Use ACR name as display
                    "body_region": "unknown",
                    "body_part": components['body_part'],
                    "contrast": components['contrast'],
                    "protocol_routes": [
                        {"protocol_name": p, "match_context": [], "priority": 1}
                        for p in matching_protocols[:3]
                    ],
                    "match_type": "component"
                }
                router['mapped_count'] += 1
            else:
                router['unmapped_procedures'].append({
                    "acr_name": acr_proc,
                    "components": components
                })
                router['unmapped_count'] += 1

    print(f"Mapped: {router['mapped_count']}, Unmapped: {router['unmapped_count']}")

    return router


def determine_match_type(protocol, scenario_name, matched_via_context):
    """
    Determine if a protocol match is 'curated' or 'suggested'.

    - curated: Protocol explicitly lists this scenario in scenario_matches
    - suggested: Matched via smart routing context keywords
    """
    if not protocol:
        return 'suggested'

    scenario_matches = protocol.get('scenario_matches', [])
    scenario_lower = scenario_name.lower()

    # Check if scenario is explicitly in protocol's scenario_matches
    for match in scenario_matches:
        match_name = match.get('scenario_name', match) if isinstance(match, dict) else match
        if match_name.lower()[:50] in scenario_lower or scenario_lower[:50] in match_name.lower():
            return 'curated'

    return 'suggested'


def test_routing(router, protocols):
    """Test the routing with sample scenarios."""
    print("\n=== Routing Tests ===")

    test_cases = [
        ("MRI head without and with IV contrast", "Brain tumor, pretreatment staging"),
        ("MRI head without and with IV contrast", "Multiple sclerosis suspected"),
        ("MRI head without and with IV contrast", "Brain tumor, treated, surveillance"),
        ("MRI head without IV contrast", "Seizure, new onset"),
        ("MRI cervical spine without IV contrast", "Radiculopathy, cervical"),
        ("MRI knee without IV contrast", "ACL tear suspected"),
    ]

    protocol_lookup = {p['name']: p for p in protocols}

    for acr_proc, scenario in test_cases:
        route = router['routes'].get(acr_proc)
        if not route:
            print(f"  NO ROUTE: {acr_proc}")
            continue

        # Find best matching protocol based on context
        best_protocol = None
        best_priority = 999
        matched_via_context = False

        for proto_route in route.get('protocol_routes', []):
            if match_context(scenario, proto_route.get('match_context', [])):
                if proto_route.get('priority', 999) < best_priority:
                    best_protocol = proto_route['protocol_name']
                    best_priority = proto_route['priority']
                    matched_via_context = True

        # Fallback to first protocol if no context match
        if not best_protocol and route.get('protocol_routes'):
            best_protocol = route['protocol_routes'][0]['protocol_name']

        # Get protocol data and determine match type
        protocol_data = protocol_lookup.get(best_protocol)
        match_type = determine_match_type(protocol_data, scenario, matched_via_context)

        # Get sequences
        sequences = []
        if protocol_data:
            sequences = [s['sequence_name'] for s in protocol_data.get('sequences', [])[:4]]

        print(f"\n  Procedure: {acr_proc}")
        print(f"  Scenario: {scenario}")
        print(f"  -> Protocol: {best_protocol} [{match_type.upper()}]")
        print(f"     Sequences: {', '.join(sequences) if sequences else 'N/A'}")


def main():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent

    print("=" * 60)
    print("Protocol Router Builder")
    print("=" * 60)

    router = build_router(project_root)

    # Load protocols for testing
    protocols_path = project_root / "data" / "protocols.json"
    with open(protocols_path, 'r', encoding='utf-8') as f:
        protocols = json.load(f)

    # Test routing
    test_routing(router, protocols)

    # Save router
    output_path = project_root / "data" / "search" / "protocol_router.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(router, f, indent=2, ensure_ascii=False)

    print(f"\n" + "=" * 60)
    print(f"Output: {output_path}")
    print(f"Mapped: {router['mapped_count']} procedures")
    print(f"Unmapped: {router['unmapped_count']} procedures")

    if router['unmapped_procedures']:
        print(f"\nUnmapped procedures (need manual mapping):")
        for p in router['unmapped_procedures'][:10]:
            print(f"  - {p['acr_name']}")
        if len(router['unmapped_procedures']) > 10:
            print(f"  ... and {len(router['unmapped_procedures']) - 10} more")


if __name__ == "__main__":
    main()
