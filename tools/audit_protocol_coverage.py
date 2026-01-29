#!/usr/bin/env python3
"""
Audit Protocol Coverage for Radex

Identifies scenarios where MRI procedures may not have appropriate protocol mappings.
Checks for:
1. Scenarios with MRI procedures that have no pre-computed protocol match
2. Clinical contexts that might route to wrong protocols
3. Missing protocol coverage for specific body regions/conditions
"""

import json
from pathlib import Path
from collections import defaultdict
import re

def load_data(project_root):
    """Load all relevant data files."""
    # Load protocols
    with open(project_root / "data" / "protocols.json", 'r', encoding='utf-8') as f:
        protocols = json.load(f)

    # Load all region scenarios
    regions_dir = project_root / "data" / "regions"
    all_scenarios = []
    for region_file in regions_dir.glob("*.json"):
        with open(region_file, 'r', encoding='utf-8') as f:
            region_data = json.load(f)
        region_name = region_file.stem
        for scenario in region_data.get('scenarios', []):
            scenario['_region'] = region_name
            all_scenarios.append(scenario)

    return protocols, all_scenarios

def get_protocol_scenario_ids(protocols):
    """Get all scenario IDs that have pre-computed protocol matches."""
    matched_ids = set()
    for protocol in protocols:
        for match in protocol.get('scenario_matches', []):
            matched_ids.add(str(match.get('scenario_id')))
    return matched_ids

def extract_mri_procedures(scenario):
    """Extract MRI procedures from a scenario."""
    mri_procs = []
    for proc in scenario.get('procedures', []):
        name = proc.get('name', '')
        modality = proc.get('modality', '')
        rating = proc.get('rating', 0)

        # Check if it's an MRI procedure with good rating
        if modality == 'MRI' or 'MRI' in name.upper() or 'MR ' in name.upper():
            if rating >= 7:  # Usually appropriate
                mri_procs.append({
                    'name': name,
                    'rating': rating,
                    'contrast': proc.get('usesContrast', 0)
                })
    return mri_procs

def check_clinical_rule_coverage(scenario_name, procedure_name, region):
    """Check if a scenario would be caught by clinical rules."""
    scenario_lower = scenario_name.lower()
    proc_lower = procedure_name.lower()

    # Determine procedure type
    is_neuro = any(x in proc_lower for x in ['head', 'brain', 'iac', 'orbit', 'sella', 'pituitary'])
    is_spine = any(x in proc_lower for x in ['spine', 'cervical', 'thoracic', 'lumbar', 'sacr'])
    is_msk = any(x in proc_lower for x in ['knee', 'shoulder', 'hip', 'ankle', 'wrist', 'elbow', 'extremity', 'foot', 'hand', 'femur', 'tibia'])

    rules_that_would_match = []

    # Check each clinical rule
    if is_neuro:
        if ('stroke' in scenario_lower or 'ischemic' in scenario_lower) and 'acute' in scenario_lower:
            rules_that_would_match.append('BRAIN (acute stroke)')
        if 'tia' in scenario_lower or 'transient ischemic' in scenario_lower:
            rules_that_would_match.append('TIA')
        if any(x in scenario_lower for x in ['tumor', 'mass', 'lesion', 'metasta']):
            rules_that_would_match.append('BRAIN TUMOR/INF')
        if 'seizure' in scenario_lower or 'epilep' in scenario_lower:
            rules_that_would_match.append('SEIZURE')
        if 'multiple sclerosis' in scenario_lower or ' ms ' in scenario_lower or 'demyelinat' in scenario_lower:
            rules_that_would_match.append('BRAIN MS')
        if 'pituitary' in scenario_lower or 'sellar' in scenario_lower:
            rules_that_would_match.append('PITUITARY')

    if is_msk:
        if any(x in scenario_lower for x in ['osteomyelitis', 'septic arthritis', 'soft tissue infection', 'cellulitis', 'abscess']):
            rules_that_would_match.append('OSTEOMYELITIS')
        if 'infection' in scenario_lower and 'brain' not in scenario_lower and 'discitis' not in scenario_lower:
            rules_that_would_match.append('OSTEOMYELITIS')

    if is_spine:
        if any(x in scenario_lower for x in ['spine infection', 'discitis', 'epidural abscess', 'spondylodiscitis']):
            rules_that_would_match.append('SPINE INFECTION')
        if 'infection' in scenario_lower and 'spine' in scenario_lower:
            rules_that_would_match.append('SPINE INFECTION')

    return rules_that_would_match, {'is_neuro': is_neuro, 'is_spine': is_spine, 'is_msk': is_msk}

def identify_potential_mismatches(scenarios, matched_scenario_ids, protocols):
    """Identify scenarios that might have protocol mapping issues."""

    issues = {
        'no_precomputed_match': [],
        'no_clinical_rule': [],
        'potential_cross_region': [],
        'contrast_mismatch': []
    }

    # Build protocol lookup
    protocol_by_name = {p['name']: p for p in protocols}

    # Keywords that suggest specific clinical contexts
    context_keywords = {
        'infection': ['infection', 'abscess', 'osteomyelitis', 'discitis', 'septic', 'cellulitis'],
        'tumor': ['tumor', 'mass', 'cancer', 'malignancy', 'metasta', 'neoplasm', 'lesion'],
        'trauma': ['trauma', 'fracture', 'injury', 'tear', 'rupture'],
        'vascular': ['aneurysm', 'dissection', 'stenosis', 'occlusion', 'thrombosis', 'hemorrhage'],
        'inflammatory': ['arthritis', 'inflammation', 'synovitis', 'tendinitis'],
        'degenerative': ['degenerative', 'osteoarthritis', 'disc disease', 'spondylosis']
    }

    for scenario in scenarios:
        scenario_id = str(scenario.get('id', ''))
        scenario_name = scenario.get('name', '')
        region = scenario.get('_region', '')

        mri_procs = extract_mri_procedures(scenario)
        if not mri_procs:
            continue

        has_precomputed = scenario_id in matched_scenario_ids

        for proc in mri_procs:
            proc_name = proc['name']
            rules_matched, proc_types = check_clinical_rule_coverage(scenario_name, proc_name, region)

            # Determine clinical context
            scenario_lower = scenario_name.lower()
            contexts = []
            for ctx, keywords in context_keywords.items():
                if any(kw in scenario_lower for kw in keywords):
                    contexts.append(ctx)

            # Issue: No pre-computed match AND no clinical rule
            if not has_precomputed and not rules_matched:
                issues['no_precomputed_match'].append({
                    'scenario_id': scenario_id,
                    'scenario_name': scenario_name,
                    'procedure': proc_name,
                    'region': region,
                    'contexts': contexts,
                    'proc_types': proc_types
                })

            # Issue: Potential cross-region mismatch
            # e.g., spine procedure but scenario mentions "tumor" which might trigger brain rule
            if proc_types['is_spine'] and 'tumor' in contexts:
                issues['potential_cross_region'].append({
                    'scenario_id': scenario_id,
                    'scenario_name': scenario_name,
                    'procedure': proc_name,
                    'region': region,
                    'concern': 'Spine procedure with tumor context - verify not matching brain tumor protocol'
                })

            # Issue: Infection scenario but procedure doesn't indicate contrast
            if 'infection' in contexts and proc.get('contrast', 0) == 0:
                # Check if the scenario name suggests contrast should be used
                if 'without and with' not in proc_name.lower() and 'w/wo' not in proc_name.lower():
                    issues['contrast_mismatch'].append({
                        'scenario_id': scenario_id,
                        'scenario_name': scenario_name,
                        'procedure': proc_name,
                        'region': region,
                        'concern': 'Infection scenario but non-contrast procedure recommended'
                    })

    return issues

def categorize_unmapped_scenarios(issues):
    """Categorize unmapped scenarios by body region and clinical context."""

    by_region = defaultdict(list)
    by_context = defaultdict(list)
    by_procedure_type = defaultdict(list)

    for item in issues['no_precomputed_match']:
        by_region[item['region']].append(item)

        for ctx in item['contexts']:
            by_context[ctx].append(item)

        # Categorize by procedure body part
        proc_lower = item['procedure'].lower()
        if 'brain' in proc_lower or 'head' in proc_lower:
            by_procedure_type['brain/head'].append(item)
        elif 'spine' in proc_lower or 'cervical' in proc_lower or 'lumbar' in proc_lower:
            by_procedure_type['spine'].append(item)
        elif any(x in proc_lower for x in ['knee', 'shoulder', 'hip', 'ankle', 'wrist', 'elbow']):
            by_procedure_type['joint'].append(item)
        elif 'abdomen' in proc_lower or 'pelvis' in proc_lower:
            by_procedure_type['abdomen/pelvis'].append(item)
        elif 'chest' in proc_lower or 'cardiac' in proc_lower:
            by_procedure_type['chest/cardiac'].append(item)
        else:
            by_procedure_type['other'].append(item)

    return by_region, by_context, by_procedure_type

def main():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent

    print("=" * 70)
    print("Protocol Coverage Audit")
    print("=" * 70)

    protocols, scenarios = load_data(project_root)
    matched_ids = get_protocol_scenario_ids(protocols)

    print(f"\nLoaded {len(protocols)} protocols")
    print(f"Loaded {len(scenarios)} scenarios across all regions")
    print(f"Scenarios with pre-computed protocol matches: {len(matched_ids)}")

    # Count MRI scenarios
    mri_scenarios = [s for s in scenarios if extract_mri_procedures(s)]
    print(f"Scenarios with highly-rated MRI procedures: {len(mri_scenarios)}")

    # Identify issues
    issues = identify_potential_mismatches(scenarios, matched_ids, protocols)

    print("\n" + "=" * 70)
    print("ANALYSIS RESULTS")
    print("=" * 70)

    # Summary
    print(f"\n1. Scenarios without pre-computed match or clinical rule: {len(issues['no_precomputed_match'])}")
    print(f"2. Potential cross-region mismatches: {len(issues['potential_cross_region'])}")
    print(f"3. Infection scenarios with non-contrast procedures: {len(issues['contrast_mismatch'])}")

    # Categorize unmapped
    by_region, by_context, by_procedure_type = categorize_unmapped_scenarios(issues)

    print("\n" + "-" * 70)
    print("UNMAPPED SCENARIOS BY REGION:")
    print("-" * 70)
    for region, items in sorted(by_region.items(), key=lambda x: -len(x[1])):
        print(f"  {region}: {len(items)}")

    print("\n" + "-" * 70)
    print("UNMAPPED SCENARIOS BY CLINICAL CONTEXT:")
    print("-" * 70)
    for ctx, items in sorted(by_context.items(), key=lambda x: -len(x[1])):
        print(f"  {ctx}: {len(items)}")

    print("\n" + "-" * 70)
    print("UNMAPPED SCENARIOS BY PROCEDURE TYPE:")
    print("-" * 70)
    for ptype, items in sorted(by_procedure_type.items(), key=lambda x: -len(x[1])):
        print(f"  {ptype}: {len(items)}")

    # Show examples of each issue type
    print("\n" + "=" * 70)
    print("SAMPLE ISSUES (first 5 of each type)")
    print("=" * 70)

    print("\n--- No Pre-computed Match or Clinical Rule ---")
    for item in issues['no_precomputed_match'][:10]:
        print(f"\n  Region: {item['region']}")
        print(f"  Scenario: {item['scenario_name'][:80]}...")
        print(f"  Procedure: {item['procedure']}")
        print(f"  Contexts: {', '.join(item['contexts']) if item['contexts'] else 'none detected'}")

    print("\n--- Potential Cross-Region Mismatches ---")
    for item in issues['potential_cross_region'][:5]:
        print(f"\n  Scenario: {item['scenario_name'][:80]}...")
        print(f"  Procedure: {item['procedure']}")
        print(f"  Concern: {item['concern']}")

    print("\n--- Infection with Non-Contrast ---")
    for item in issues['contrast_mismatch'][:5]:
        print(f"\n  Scenario: {item['scenario_name'][:80]}...")
        print(f"  Procedure: {item['procedure']}")

    # Save detailed report
    report = {
        'summary': {
            'total_protocols': len(protocols),
            'total_scenarios': len(scenarios),
            'mri_scenarios': len(mri_scenarios),
            'precomputed_matches': len(matched_ids),
            'unmapped_count': len(issues['no_precomputed_match']),
            'cross_region_concerns': len(issues['potential_cross_region']),
            'contrast_mismatches': len(issues['contrast_mismatch'])
        },
        'by_region': {k: len(v) for k, v in by_region.items()},
        'by_context': {k: len(v) for k, v in by_context.items()},
        'by_procedure_type': {k: len(v) for k, v in by_procedure_type.items()},
        'issues': issues
    }

    output_path = project_root / "tools" / "results" / "protocol_coverage_audit.json"
    output_path.parent.mkdir(exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"\n\nDetailed report saved to: {output_path}")

if __name__ == "__main__":
    main()
