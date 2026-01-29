#!/usr/bin/env python3
"""
Audit Procedure-to-Protocol Routing for Radex

Simulates the JavaScript clinical rules to identify:
1. Procedures that route to unexpected protocols
2. Procedures with no routing (will fall through to scoring)
3. Potential mismatches between procedure name and routed protocol

This mirrors the logic in js/data-loader.js applyClinicalRules()
"""

import json
import re
from pathlib import Path
from collections import defaultdict


def load_data(project_root):
    """Load protocols and scenarios."""
    with open(project_root / "data" / "protocols.json", 'r', encoding='utf-8') as f:
        protocols = json.load(f)

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


def get_protocol_by_name(protocols, name):
    """Find protocol by name."""
    for p in protocols:
        if p['name'] == name:
            return p
    return None


def simulate_procedure_routing(proc_name, scenario_name, region, protocols):
    """
    Simulate the JavaScript procedure-based routing logic.
    Returns (protocol_name, match_type) or (None, None) if no match.
    """
    proc_lower = proc_name.lower()
    scenario_lower = scenario_name.lower()

    def is_procedure_for(body_part):
        return body_part in proc_lower

    # ========================================
    # PROCEDURE-BASED ROUTING (Primary)
    # ========================================

    # Abdomen/Pelvis procedures
    if is_procedure_for('prostate'):
        return ('PROSTATE', 'procedure')

    if is_procedure_for('liver'):
        return ('LIVER', 'procedure')

    if is_procedure_for('kidney') or is_procedure_for('renal'):
        return ('KIDNEYS', 'procedure')

    if is_procedure_for('mrcp') or is_procedure_for('cholangiopancreatography'):
        return ('MRCP', 'procedure')

    if is_procedure_for('enterography'):
        return ('MR ENTEROGRAPHY', 'procedure')

    if is_procedure_for('pelvis') and not is_procedure_for('spine'):
        return ('PELVIS', 'procedure')

    if is_procedure_for('abdomen') and not is_procedure_for('pelvis'):
        return ('LIVER', 'procedure')

    # Neuro-specific procedures
    if is_procedure_for('sella') or is_procedure_for('pituitary'):
        return ('PITUITARY', 'procedure')

    if is_procedure_for('internal auditory') or ' iac' in proc_lower:
        return ('IAC', 'procedure')

    if is_procedure_for('orbit'):
        return ('ORBITS', 'procedure')

    if is_procedure_for('temporomandibular') or is_procedure_for('tmj'):
        return ('TMJ', 'procedure')

    # Neck -> NECK SOFT TISSUE
    if is_procedure_for('neck') and not is_procedure_for('orbit'):
        return ('NECK SOFT TISSUE', 'procedure')

    # Brachial plexus
    if is_procedure_for('brachial plexus'):
        return ('BRACHIAL PLEXUS', 'procedure')

    # MRI head/brain -> BRAIN (must check before other neuro)
    if (is_procedure_for('head') or is_procedure_for('brain')) and \
       not is_procedure_for('orbit') and not is_procedure_for('iac') and \
       not is_procedure_for('sella') and not is_procedure_for('tmj') and \
       not is_procedure_for('neck'):
        return ('BRAIN', 'procedure')

    # Cardiac procedures -> CARDIAC STRESS
    if is_procedure_for('heart') or is_procedure_for('cardiac'):
        return ('CARDIAC STRESS', 'procedure')

    # Breast -> BREAST
    if is_procedure_for('breast'):
        return ('BREAST', 'procedure')

    # Chest procedures (non-cardiac)
    if is_procedure_for('chest') and not is_procedure_for('heart'):
        return ('CHEST', 'procedure')

    # MSK joint-specific procedures
    if is_procedure_for('knee'):
        return ('KNEE', 'procedure')

    if is_procedure_for('shoulder'):
        return ('SHOULDER', 'procedure')

    if is_procedure_for('hip') and not is_procedure_for('spine'):
        return ('HIP', 'procedure')

    if is_procedure_for('ankle') or is_procedure_for('foot'):
        return ('ANKLE', 'procedure')

    if is_procedure_for('wrist') or is_procedure_for('hand'):
        return ('WRIST', 'procedure')

    if is_procedure_for('elbow'):
        return ('ELBOW', 'procedure')

    # Extremity bone procedures - context-aware routing
    is_extremity_bone = is_procedure_for('thigh') or is_procedure_for('femur') or \
                        is_procedure_for('forearm') or is_procedure_for('humerus') or \
                        is_procedure_for('upper arm') or is_procedure_for('lower leg') or \
                        is_procedure_for('tibia') or is_procedure_for('fibula') or \
                        is_procedure_for('lower extremity') or is_procedure_for('upper extremity')

    if is_extremity_bone:
        # Tumor/mass/metastasis -> BONE TUMOR
        if any(x in scenario_lower for x in ['tumor', 'mass', 'metasta', 'sarcoma', 'cancer', 'malignant', 'neoplasm', 'lesion']):
            return ('BONE TUMOR', 'procedure+context')

        # Osteonecrosis/AVN -> OSTEONECROSIS
        if any(x in scenario_lower for x in ['osteonecrosis', 'avascular', 'avn', 'bone infarct']):
            return ('OSTEONECROSIS', 'procedure+context')

        # Infection -> OSTEOMYELITIS
        if any(x in scenario_lower for x in ['infection', 'osteomyelitis', 'septic', 'abscess']):
            return ('OSTEOMYELITIS', 'procedure+context')

        # Fallback to nearest joint
        if is_procedure_for('thigh') or is_procedure_for('femur') or is_procedure_for('lower extremity'):
            return ('HIP', 'procedure')
        if is_procedure_for('lower leg') or is_procedure_for('tibia') or is_procedure_for('fibula'):
            return ('KNEE', 'procedure')
        if is_procedure_for('forearm'):
            return ('ELBOW', 'procedure')
        if is_procedure_for('upper arm') or is_procedure_for('humerus') or is_procedure_for('upper extremity'):
            return ('SHOULDER', 'procedure')

    # Spine procedures (by level)
    is_infection = any(x in scenario_lower for x in ['infection', 'discitis', 'abscess'])

    if is_procedure_for('cervical') and is_procedure_for('spine'):
        if is_infection:
            return ('SPINE INFECTION', 'procedure+context')
        return ('C-SPINE', 'procedure')

    if is_procedure_for('thoracic') and is_procedure_for('spine'):
        if is_infection:
            return ('SPINE INFECTION', 'procedure+context')
        return ('T-SPINE', 'procedure')

    if is_procedure_for('lumbar') and is_procedure_for('spine'):
        if is_infection:
            return ('SPINE INFECTION', 'procedure+context')
        return ('L-SPINE', 'procedure')

    # Multi-level spine
    if is_procedure_for('spine') and (is_procedure_for('complete') or is_procedure_for('total') or
            (is_procedure_for('cervical') and is_procedure_for('lumbar'))):
        if is_infection:
            return ('SPINE INFECTION', 'procedure+context')
        return ('SCREENING SPINE', 'procedure')

    # ========================================
    # SCENARIO-BASED REFINEMENTS
    # ========================================

    is_neuro = is_procedure_for('head') or is_procedure_for('brain') or \
               is_procedure_for('iac') or is_procedure_for('orbit') or \
               is_procedure_for('sella') or is_procedure_for('pituitary') or \
               region == 'neuro'

    is_spine = is_procedure_for('spine') or is_procedure_for('cervical') or \
               is_procedure_for('thoracic') or is_procedure_for('lumbar') or \
               is_procedure_for('sacr') or region == 'spine'

    is_msk = is_procedure_for('knee') or is_procedure_for('shoulder') or \
             is_procedure_for('hip') or is_procedure_for('ankle') or \
             is_procedure_for('wrist') or is_procedure_for('elbow') or \
             is_procedure_for('extremity') or is_procedure_for('foot') or \
             is_procedure_for('hand') or is_procedure_for('femur') or \
             is_procedure_for('tibia') or region == 'msk'

    # Neuro scenario rules
    if is_neuro:
        if ('stroke' in scenario_lower or 'ischemic' in scenario_lower) and 'acute' in scenario_lower:
            return ('BRAIN', 'scenario')
        if re.search(r'(^|[\s,;.\-])tia([\s,;.\-]|$)', scenario_lower) or 'transient ischemic' in scenario_lower:
            return ('TIA', 'scenario')
        if any(x in scenario_lower for x in ['tumor', 'mass', 'lesion', 'metasta']):
            return ('BRAIN TUMOR/INF', 'scenario')
        if 'seizure' in scenario_lower or 'epilep' in scenario_lower:
            return ('SEIZURE', 'scenario')
        if 'multiple sclerosis' in scenario_lower or ' ms ' in scenario_lower or 'demyelinat' in scenario_lower:
            return ('BRAIN MS', 'scenario')
        if 'pituitary' in scenario_lower or 'sellar' in scenario_lower:
            return ('PITUITARY', 'scenario')

    # MSK infection rules
    if is_msk:
        if any(x in scenario_lower for x in ['osteomyelitis', 'septic arthritis', 'soft tissue infection', 'cellulitis', 'abscess']):
            return ('OSTEOMYELITIS', 'scenario')
        if 'infection' in scenario_lower and 'brain' not in scenario_lower and 'discitis' not in scenario_lower:
            return ('OSTEOMYELITIS', 'scenario')

    # Spine infection fallback
    if is_spine:
        if any(x in scenario_lower for x in ['spine infection', 'discitis', 'epidural abscess', 'spondylodiscitis']):
            return ('SPINE INFECTION', 'scenario')
        # Generic spine fallback
        if is_procedure_for('spine'):
            return ('L-SPINE', 'fallback')

    return (None, None)


def check_routing_appropriateness(proc_name, routed_protocol, scenario_name):
    """
    Check if the routed protocol seems appropriate for the procedure.
    Returns (is_appropriate, concern) tuple.
    """
    proc_lower = proc_name.lower()
    proto_lower = (routed_protocol or '').lower()

    concerns = []

    # Check for obvious mismatches
    body_part_to_expected = {
        'brain': ['brain', 'neuro', 'tia', 'seizure', 'ms', 'tumor'],
        'head': ['brain', 'neuro', 'tia', 'seizure', 'ms', 'tumor', 'orbits', 'iac', 'tmj', 'sinus'],
        'spine': ['spine', 'c-spine', 't-spine', 'l-spine', 'screening'],
        'cervical': ['spine', 'c-spine', 'screening', 'infection'],
        'lumbar': ['spine', 'l-spine', 'screening', 'infection'],
        'thoracic': ['spine', 't-spine', 'screening', 'infection'],
        'pelvis': ['pelvis', 'prostate', 'rectal'],
        'liver': ['liver', 'mrcp'],
        'kidney': ['kidney', 'renal'],
        'abdomen': ['liver', 'abdomen', 'kidney', 'mrcp', 'pancreas'],
        'knee': ['knee'],
        'shoulder': ['shoulder'],
        'hip': ['hip', 'pelvis'],
        'ankle': ['ankle', 'foot'],
        'wrist': ['wrist', 'hand'],
        'breast': ['breast'],
        'heart': ['cardiac', 'heart'],
        'cardiac': ['cardiac', 'heart'],
        'sella': ['pituitary', 'sella'],
        'pituitary': ['pituitary', 'sella'],
        'orbit': ['orbit'],
        'iac': ['iac', 'auditory'],
        'tmj': ['tmj', 'temporomandibular'],
    }

    # Find what body part the procedure is for
    proc_body_parts = []
    for part in body_part_to_expected.keys():
        if part in proc_lower:
            proc_body_parts.append(part)

    # Check if routed protocol matches expected
    if routed_protocol and proc_body_parts:
        expected_protocols = set()
        for part in proc_body_parts:
            expected_protocols.update(body_part_to_expected[part])

        # Check if any expected keyword is in the protocol name
        matches_expected = any(exp in proto_lower for exp in expected_protocols)

        if not matches_expected:
            concerns.append(f"Procedure '{proc_name}' routed to '{routed_protocol}' - expected one of: {expected_protocols}")

    return (len(concerns) == 0, concerns)


def main():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent

    print("=" * 70)
    print("Procedure-to-Protocol Routing Audit")
    print("=" * 70)

    protocols, scenarios = load_data(project_root)
    protocol_names = {p['name'] for p in protocols}

    print(f"\nLoaded {len(protocols)} protocols")
    print(f"Loaded {len(scenarios)} scenarios")

    # Track results
    results = {
        'routed': [],
        'not_routed': [],
        'mismatches': [],
        'missing_protocols': [],
    }

    # Unique procedure names we've seen
    seen_procedures = set()
    procedure_routing = {}  # proc_name -> (protocol, match_type, example_scenario)

    # Process all scenarios
    for scenario in scenarios:
        scenario_name = scenario.get('name', '')
        region = scenario.get('_region', '')

        for proc in scenario.get('procedures', []):
            proc_name = proc.get('name', '')
            if not proc_name or proc_name.strip() == '':
                continue

            # Skip non-MRI
            modality = proc.get('modality', '')
            if modality != 'MRI' and 'MRI' not in proc_name.upper() and 'MR ' not in proc_name.upper():
                continue

            # Skip low-rated procedures
            rating = proc.get('rating', 0)
            if rating < 5:
                continue

            # Avoid duplicate processing
            proc_key = (proc_name, scenario_name)
            if proc_key in seen_procedures:
                continue
            seen_procedures.add(proc_key)

            # Simulate routing
            routed_protocol, match_type = simulate_procedure_routing(proc_name, scenario_name, region, protocols)

            # Check if protocol exists
            if routed_protocol and routed_protocol not in protocol_names:
                results['missing_protocols'].append({
                    'procedure': proc_name,
                    'scenario': scenario_name,
                    'routed_to': routed_protocol,
                })
                continue

            # Check appropriateness
            is_appropriate, concerns = check_routing_appropriateness(proc_name, routed_protocol, scenario_name)

            if routed_protocol:
                results['routed'].append({
                    'procedure': proc_name,
                    'scenario': scenario_name,
                    'protocol': routed_protocol,
                    'match_type': match_type,
                    'region': region,
                })

                if not is_appropriate:
                    results['mismatches'].append({
                        'procedure': proc_name,
                        'scenario': scenario_name,
                        'protocol': routed_protocol,
                        'match_type': match_type,
                        'concerns': concerns,
                    })

                # Track unique procedure routing
                if proc_name not in procedure_routing:
                    procedure_routing[proc_name] = (routed_protocol, match_type, scenario_name)

            else:
                results['not_routed'].append({
                    'procedure': proc_name,
                    'scenario': scenario_name,
                    'region': region,
                })

    # Print results
    print("\n" + "=" * 70)
    print("RESULTS SUMMARY")
    print("=" * 70)

    print(f"\nRouted procedures: {len(results['routed'])}")
    print(f"Not routed (will use scoring): {len(results['not_routed'])}")
    print(f"Potential mismatches: {len(results['mismatches'])}")
    print(f"Missing protocols referenced: {len(results['missing_protocols'])}")

    # Show mismatches
    if results['mismatches']:
        print("\n" + "-" * 70)
        print("POTENTIAL MISMATCHES (procedure body part doesn't match protocol)")
        print("-" * 70)
        for item in results['mismatches'][:20]:
            print(f"\n  Procedure: {item['procedure']}")
            print(f"  Scenario: {item['scenario'][:70]}...")
            print(f"  Routed to: {item['protocol']} ({item['match_type']})")
            for concern in item['concerns']:
                print(f"  CONCERN: {concern}")

        if len(results['mismatches']) > 20:
            print(f"\n  ... and {len(results['mismatches']) - 20} more")

    # Show missing protocols
    if results['missing_protocols']:
        print("\n" + "-" * 70)
        print("MISSING PROTOCOLS (referenced but don't exist)")
        print("-" * 70)
        missing_names = set(item['routed_to'] for item in results['missing_protocols'])
        for name in sorted(missing_names):
            count = sum(1 for item in results['missing_protocols'] if item['routed_to'] == name)
            print(f"  {name}: {count} procedures")

    # Show unrouted procedures
    if results['not_routed']:
        print("\n" + "-" * 70)
        print("SAMPLE UNROUTED PROCEDURES (first 15)")
        print("-" * 70)
        # Group by procedure name
        unrouted_by_proc = defaultdict(list)
        for item in results['not_routed']:
            unrouted_by_proc[item['procedure']].append(item['scenario'])

        for proc_name, scenarios in list(unrouted_by_proc.items())[:15]:
            print(f"\n  {proc_name}")
            print(f"    Used in {len(scenarios)} scenarios")
            print(f"    Example: {scenarios[0][:60]}...")

    # Unique procedure -> protocol mapping
    print("\n" + "-" * 70)
    print("UNIQUE PROCEDURE ROUTING MAP")
    print("-" * 70)

    # Group by protocol
    by_protocol = defaultdict(list)
    for proc_name, (protocol, match_type, example) in procedure_routing.items():
        by_protocol[protocol].append((proc_name, match_type))

    for protocol in sorted(by_protocol.keys()):
        procs = by_protocol[protocol]
        print(f"\n  {protocol}:")
        for proc_name, match_type in procs[:5]:
            print(f"    - {proc_name} ({match_type})")
        if len(procs) > 5:
            print(f"    ... and {len(procs) - 5} more")

    # Save detailed report
    output_path = project_root / "tools" / "results" / "procedure_routing_audit.json"
    output_path.parent.mkdir(exist_ok=True)

    report = {
        'summary': {
            'routed_count': len(results['routed']),
            'not_routed_count': len(results['not_routed']),
            'mismatch_count': len(results['mismatches']),
            'missing_protocol_count': len(results['missing_protocols']),
        },
        'mismatches': results['mismatches'],
        'missing_protocols': list(set(item['routed_to'] for item in results['missing_protocols'])),
        'not_routed': results['not_routed'][:100],  # Limit size
        'procedure_routing': {k: {'protocol': v[0], 'match_type': v[1]} for k, v in procedure_routing.items()},
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"\n\nDetailed report saved to: {output_path}")


if __name__ == "__main__":
    main()
