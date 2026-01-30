"""
Generate Smart Summary Cards for ACR Scenarios - v3
Uses radiology semantic dictionary for enhanced synonym matching.
"""

import json
import re
from collections import defaultdict, Counter
from pathlib import Path
from datetime import datetime

# Configuration
MIN_SCENARIOS_FOR_CARD = 3
STRONG_CONSENSUS_THRESHOLD = 0.70
MODERATE_CONSENSUS_THRESHOLD = 0.40

# Imaging modalities to include (exclude treatments)
IMAGING_MODALITIES = {'CT', 'MRI', 'US', 'XR', 'PET', 'NM', 'Mammo', 'Fluoro'}

def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))

def load_region_data(region_name):
    path = Path(__file__).parent.parent / "data" / "regions" / f"{region_name}.json"
    return load_json(path)

def load_all_regions():
    regions = ['neuro', 'spine', 'msk', 'abdomen', 'chest', 'vascular', 'breast', 'peds']
    all_scenarios = []
    for region in regions:
        try:
            data = load_region_data(region)
            for scenario in data.get('scenarios', []):
                scenario['_region'] = region
                all_scenarios.append(scenario)
        except FileNotFoundError:
            print(f"Warning: {region}.json not found")
    return all_scenarios

def load_semantic_dictionary():
    """Load the radiology semantic dictionary for synonym expansion."""
    base_path = Path(__file__).parent.parent / "data" / "search"

    # Load synonym mappings
    synonyms = {}
    try:
        syn_data = load_json(base_path / "radiology_synonyms_kg.json")
        # syn_data is a dict mapping term -> list of synonyms
        synonyms = syn_data
        print(f"Loaded {len(synonyms)} synonym mappings")
    except Exception as e:
        print(f"Warning: Could not load radiology_synonyms_kg.json: {e}")

    # Load medical concepts for body system mapping
    concepts = []
    concept_synonyms = {}
    try:
        concepts = load_json(base_path / "medical_concepts_kg.json")
        # Build reverse synonym lookup
        for concept in concepts:
            name = concept.get('name', '').lower()
            syns = concept.get('synonyms', [])
            for syn in syns:
                concept_synonyms[syn.lower()] = name
            concept_synonyms[name] = name
        print(f"Loaded {len(concepts)} medical concepts")
    except Exception as e:
        print(f"Warning: Could not load medical_concepts_kg.json: {e}")

    return synonyms, concept_synonyms, concepts

def build_topic_patterns(synonyms, concept_synonyms):
    """Build enhanced topic patterns using synonyms."""

    # Base clinical topics with their search patterns
    BASE_TOPICS = {
        # Neuro
        'headache': ['headache', 'cephalgia', 'migraine', 'head pain'],
        'stroke': ['stroke', 'cva', 'cerebrovascular accident', 'infarct', 'ischemic stroke'],
        'tia': ['transient ischemic attack', 'mini-stroke'],
        'seizure': ['seizure', 'epilepsy', 'convulsion', 'ictal'],
        'dementia': ['dementia', 'alzheimer', 'cognitive decline', 'cognitive impairment'],
        'brain tumor': ['brain tumor', 'brain mass', 'intracranial mass', 'glioma', 'meningioma'],
        'head trauma': ['head trauma', 'traumatic brain injury', 'tbi', 'concussion'],
        'vertigo': ['vertigo', 'dizziness', 'vestibular'],
        'aneurysm': ['aneurysm', 'cerebral aneurysm', 'intracranial aneurysm'],
        'multiple sclerosis': ['multiple sclerosis', 'demyelinating'],
        'meningitis': ['meningitis', 'meningeal'],
        'hydrocephalus': ['hydrocephalus', 'ventriculomegaly'],

        # Spine - expanded patterns
        'back pain': ['back pain', 'low back pain', 'lumbar pain', 'lumbago', 'lumbar spine pain', 'thoracic spine pain'],
        'neck pain': ['neck pain', 'cervical pain', 'cervicalgia', 'cervical spine pain'],
        'radiculopathy': ['radiculopathy', 'radicular pain', 'sciatica', 'nerve root'],
        'myelopathy': ['myelopathy', 'cord compression'],
        'disc herniation': ['disc herniation', 'herniated disc', 'bulging disc', 'prolapsed disc'],
        'spinal stenosis': ['spinal stenosis', 'canal stenosis'],
        'spondylosis': ['spondylosis', 'degenerative disc', 'spondyloarthritis'],
        'spine trauma': ['spine trauma', 'spinal trauma', 'cervical spine trauma', 'lumbar spine trauma', 'thoracic spine trauma', 'vertebral fracture'],
        'spine infection': ['spine infection', 'spinal infection', 'discitis', 'vertebral osteomyelitis', 'epidural abscess'],

        # MSK - expanded with new joints and conditions
        'knee pain': ['knee pain', 'knee injury', 'knee trauma', 'knee replaced'],
        'shoulder pain': ['shoulder pain', 'rotator cuff', 'shoulder injury'],
        'hip pain': ['hip pain', 'hip injury'],
        'ankle pain': ['ankle pain', 'ankle injury', 'ankle sprain', 'ankle trauma'],
        'wrist pain': ['wrist pain', 'wrist injury', 'carpal'],
        'elbow pain': ['elbow pain', 'elbow injury', 'tennis elbow', 'golfer elbow'],
        'foot pain': ['foot pain', 'foot injury', 'plantar'],
        'fracture': ['fracture', 'broken bone', 'fx'],
        'stress fracture': ['stress fracture', 'stress reaction', 'insufficiency fracture'],
        'arthritis': ['arthritis', 'arthritic', 'osteoarthritis', 'rheumatoid'],
        'osteomyelitis': ['osteomyelitis', 'bone infection'],
        'osteonecrosis': ['osteonecrosis', 'avascular necrosis', 'avn', 'bone infarct'],
        'soft tissue mass': ['soft tissue mass', 'soft tissue tumor'],
        'soft tissue infection': ['soft tissue infection', 'cellulitis', 'abscess', 'necrotizing fasciitis'],
        'bone tumor': ['bone tumor', 'primary bone tumor', 'bone neoplasm', 'osseous tumor', 'bone lesion'],

        # Abdomen - expanded
        'abdominal pain': ['abdominal pain', 'belly pain', 'stomach pain'],
        'appendicitis': ['appendicitis', 'appendiceal'],
        'cholecystitis': ['cholecystitis', 'gallbladder', 'biliary colic'],
        'pancreatitis': ['pancreatitis', 'pancreatic inflammation'],
        'bowel obstruction': ['bowel obstruction', 'intestinal obstruction', 'ileus', 'sbo'],
        'liver mass': ['liver mass', 'hepatic mass', 'liver lesion', 'hepatic lesion'],
        'renal mass': ['renal mass', 'kidney mass', 'renal lesion', 'adrenal mass'],
        'kidney stone': ['kidney stone', 'renal calculus', 'nephrolithiasis', 'ureteral stone'],
        'hematuria': ['hematuria', 'blood in urine'],
        'diverticulitis': ['diverticulitis', 'diverticular'],
        'hydronephrosis': ['hydronephrosis', 'ureteral obstruction', 'urinary obstruction'],
        'sepsis': ['sepsis', 'septic'],

        # Chest
        'chest pain': ['chest pain', 'thoracic pain'],
        'pulmonary embolism': ['pulmonary embolism', 'pe suspected', 'lung clot', 'pulmonary emboli'],
        'pneumonia': ['pneumonia', 'lung infection', 'consolidation'],
        'lung nodule': ['lung nodule', 'pulmonary nodule', 'lung mass'],
        'lung cancer': ['lung cancer', 'bronchogenic', 'lung carcinoma', 'lung cancer screening'],
        'pleural effusion': ['pleural effusion', 'pleural fluid'],

        # Vascular - expanded
        'aortic aneurysm': ['aortic aneurysm', 'aaa', 'abdominal aortic aneurysm', 'thoracic aortic aneurysm'],
        'aortic dissection': ['aortic dissection', 'dissecting aneurysm'],
        'dvt': ['dvt', 'deep vein thrombosis', 'deep venous thrombosis', 'leg clot'],
        'carotid stenosis': ['carotid stenosis', 'carotid disease', 'carotid plaque'],
        'vascular malformation': ['vascular malformation', 'avm', 'arteriovenous malformation', 'hemangioma', 'vascular tumor', 'vascular lesion'],
        'peripheral arterial disease': ['peripheral arterial disease', 'pad', 'claudication', 'limb ischemia'],
        'hemodialysis access': ['hemodialysis access', 'dialysis access', 'av fistula', 'av graft'],

        # Breast
        'breast mass': ['breast mass', 'breast lump', 'breast lesion'],
        'breast cancer': ['breast cancer', 'breast carcinoma', 'breast malignancy', 'breast cancer screening'],

        # Oncology - new category
        'melanoma': ['melanoma', 'cutaneous melanoma', 'muco-cutaneous melanoma', 'skin cancer'],
        'ovarian cancer': ['ovarian cancer', 'ovarian mass', 'ovarian cancer screening'],

        # Pediatric / Other
        'child abuse': ['child abuse', 'physical abuse', 'non-accidental trauma', 'nat', 'abuse suspected'],
    }

    # Expand with synonyms from semantic dictionary
    for topic, patterns in BASE_TOPICS.items():
        expanded = set(patterns)
        for pattern in patterns:
            # Check if this pattern has synonyms
            if pattern in synonyms:
                expanded.update(synonyms[pattern])
            # Also check concept synonyms
            if pattern in concept_synonyms:
                expanded.add(concept_synonyms[pattern])
        BASE_TOPICS[topic] = list(expanded)

    return BASE_TOPICS

def extract_primary_topic(scenario_name, topic_patterns):
    """Extract the primary clinical topic using enhanced patterns."""
    name_lower = scenario_name.lower()

    # Check each topic's patterns
    for topic, patterns in topic_patterns.items():
        for pattern in patterns:
            # Use word boundary matching for short patterns
            if len(pattern) <= 3:
                if re.search(rf'\b{re.escape(pattern)}\b', name_lower):
                    return topic
            else:
                if pattern in name_lower:
                    return topic

    return None

def get_imaging_procedures(procedures):
    """Filter to only imaging procedures (exclude treatments)."""
    imaging_procs = []
    for p in procedures:
        modality = p.get('modality', 'Other')
        name = (p.get('shortName') or p.get('name', '')).lower()

        # Include known imaging modalities
        if modality in IMAGING_MODALITIES:
            imaging_procs.append(p)
        # Also include CTA, MRA which may be marked as "Other"
        elif any(x in name for x in ['cta', 'mra', 'mrv', 'ctv', 'angiograph', 'venograph']):
            imaging_procs.append(p)
        # Include radiography
        elif 'radiograph' in name or 'x-ray' in name or 'xray' in name:
            imaging_procs.append(p)

    return imaging_procs

def get_procedure_summary(procedures):
    """Analyze imaging procedures only."""
    imaging_procs = get_imaging_procedures(procedures)

    if not imaging_procs:
        return None

    usually_appropriate = []
    may_be_appropriate = []

    for p in imaging_procs:
        rating = p.get('rating', 0)
        proc_info = {
            'name': p.get('shortName') or p.get('name', 'Unknown'),
            'modality': p.get('modality', 'Other'),
            'rating': rating
        }

        if rating >= 7:
            usually_appropriate.append(proc_info)
        elif rating >= 5:
            may_be_appropriate.append(proc_info)

    usually_appropriate.sort(key=lambda x: -x['rating'])
    may_be_appropriate.sort(key=lambda x: -x['rating'])

    return {
        'usually_appropriate': usually_appropriate,
        'may_be_appropriate': may_be_appropriate,
        'has_positive': len(usually_appropriate) > 0,
        'top': usually_appropriate[0] if usually_appropriate else (
            may_be_appropriate[0] if may_be_appropriate else None
        )
    }

def analyze_topic_cluster(scenarios, topic):
    """Analyze a cluster of scenarios for a topic."""

    # Track ALL appropriate procedures per scenario, not just the first
    recommendations = Counter()
    top_tier_recs = Counter()  # Procedures rated 8-9
    total = len(scenarios)
    no_imaging_count = 0

    for s in scenarios:
        proc_summary = get_procedure_summary(s.get('procedures', []))

        if not proc_summary or not proc_summary['top']:
            no_imaging_count += 1
            continue

        # Count all "Usually Appropriate" procedures (not just first)
        for proc in proc_summary['usually_appropriate']:
            recommendations[proc['name']] += 1
            if proc['rating'] >= 8:
                top_tier_recs[proc['name']] += 1

    # Calculate consensus - consider procedures that appear in majority of scenarios
    if recommendations:
        # Get top procedures sorted by count
        sorted_recs = recommendations.most_common()
        top_name, top_count = sorted_recs[0]

        # Find equivalent procedures (within 90% of top count AND in at least 30% of scenarios)
        equivalent_procs = []
        for name, count in sorted_recs:
            # Within 90% of top count
            if count >= top_count * 0.9:
                equivalent_procs.append(name)
            # Also include if very close in count and both are substantial
            elif count >= top_count * 0.85 and count / total >= 0.3:
                equivalent_procs.append(name)

        # Calculate consensus based on best single procedure
        consensus = top_count / total

        # If we have multiple equivalent high-consensus procedures, boost the card type
        # because the guidance is actually consistent (just multiple valid options)
        if len(equivalent_procs) > 1:
            # Check if all equivalent procs together cover most scenarios
            combined_coverage = sum(recommendations[p] for p in equivalent_procs) / total
            if combined_coverage >= 0.8:  # 80%+ scenarios have at least one of these
                consensus = max(consensus, 0.7)  # Treat as strong consensus
    else:
        top_name = None
        top_count = 0
        consensus = 0
        equivalent_procs = []

    # Determine card type
    if no_imaging_count / total > 0.6:
        card_type = 'CLINICAL_FIRST'
    elif consensus >= STRONG_CONSENSUS_THRESHOLD:
        card_type = 'STRONG'
    elif consensus >= MODERATE_CONSENSUS_THRESHOLD:
        card_type = 'CONDITIONAL'
    else:
        card_type = 'HIGH_VARIANCE'

    # Get alternatives (procedures not in equivalent list)
    alternatives = []
    for rec, count in recommendations.most_common(8):
        if rec not in equivalent_procs:
            pct = round(100 * count / total)
            if pct >= 10:  # At least 10% of scenarios
                alternatives.append({'name': rec, 'percentage': pct, 'count': count})

    # Determine region
    region_counts = Counter(s['_region'] for s in scenarios)
    primary_region = region_counts.most_common(1)[0][0] if region_counts else 'unknown'

    # Format equivalent procedures for display
    if len(equivalent_procs) > 1:
        primary_display = ' OR '.join([p[:25] for p in equivalent_procs[:3]])
    else:
        primary_display = top_name

    return {
        'topic': topic,
        'display_name': topic.replace('_', ' ').title(),
        'card_type': card_type,
        'scenario_count': total,
        'region': primary_region,
        'primary_recommendation': {
            'name': top_name,
            'display': primary_display,
            'equivalent_procedures': equivalent_procs,
            'count': top_count,
            'consensus_pct': round(100 * consensus) if consensus else 0
        },
        'alternatives': alternatives[:3],
        'no_imaging_pct': round(100 * no_imaging_count / total),
        'recommend_detailed_search': card_type == 'HIGH_VARIANCE' or (card_type == 'CLINICAL_FIRST' and no_imaging_count / total < 0.8),
        'sample_scenarios': [s['name'][:80] for s in scenarios[:3]]
    }

def main():
    print("="*65)
    print("SMART SUMMARY CARDS v3 (with Semantic Dictionary)")
    print("="*65)

    # Load semantic dictionary
    print("\nLoading semantic dictionary...")
    synonyms, concept_synonyms, concepts = load_semantic_dictionary()

    # Build enhanced topic patterns
    topic_patterns = build_topic_patterns(synonyms, concept_synonyms)
    print(f"Built patterns for {len(topic_patterns)} topics")

    # Load scenario data
    print("\nLoading ACR scenarios...")
    all_scenarios = load_all_regions()
    print(f"Loaded {len(all_scenarios)} scenarios")

    # Match scenarios to topics
    print("\nMatching scenarios to topics...")
    topic_groups = defaultdict(list)
    unmatched = []

    for s in all_scenarios:
        topic = extract_primary_topic(s['name'], topic_patterns)
        if topic:
            topic_groups[topic].append(s)
        else:
            unmatched.append(s)

    matched = len(all_scenarios) - len(unmatched)
    print(f"Matched: {matched} ({round(100*matched/len(all_scenarios))}%)")
    print(f"Unmatched: {len(unmatched)}")

    # Generate cards
    print("\nGenerating summary cards...")
    cards = []
    for topic, scenarios in sorted(topic_groups.items(), key=lambda x: -len(x[1])):
        if len(scenarios) >= MIN_SCENARIOS_FOR_CARD:
            card = analyze_topic_cluster(scenarios, topic)
            cards.append(card)

    # Categorize
    card_types = defaultdict(list)
    for card in cards:
        card_types[card['card_type']].append(card)

    # Display results
    print("\n" + "="*65)
    print("RESULTS")
    print("="*65)

    for ct in ['STRONG', 'CONDITIONAL', 'CLINICAL_FIRST', 'HIGH_VARIANCE']:
        type_cards = sorted(card_types[ct], key=lambda x: -x['scenario_count'])
        print(f"\n{ct} ({len(type_cards)} topics):")
        for card in type_cards[:6]:
            rec = card['primary_recommendation']['name'] or 'varies'
            if len(rec) > 30:
                rec = rec[:27] + '...'
            print(f"  {card['topic']:<22} ({card['scenario_count']:>3}) -> {rec} ({card['primary_recommendation']['consensus_pct']}%)")

    # Save output
    output_path = Path(__file__).parent.parent / "data" / "search" / "summary_cards.json"
    output_data = {
        'version': '3.0.0',
        'generated_at': datetime.now().isoformat(),
        'total_scenarios': len(all_scenarios),
        'matched_scenarios': matched,
        'match_rate_pct': round(100 * matched / len(all_scenarios)),
        'cards': cards,
        'card_counts': {k: len(v) for k, v in card_types.items()}
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2)

    print(f"\n\nSaved {len(cards)} cards to: {output_path}")

    # Show example cards
    print("\n" + "="*65)
    print("EXAMPLE CARDS FOR KEY CLINICAL TOPICS")
    print("="*65)

    key_topics = ['headache', 'stroke', 'back pain', 'chest pain', 'knee pain', 'pulmonary embolism', 'seizure']
    for card in cards:
        if card['topic'] in key_topics:
            print(f"\n[{card['card_type']}] {card['topic'].upper()}")
            print(f"  Scenarios: {card['scenario_count']}")
            equiv = card['primary_recommendation'].get('equivalent_procedures', [])
            if len(equiv) > 1:
                print(f"  Primary: Multiple equivalent options ({card['primary_recommendation']['consensus_pct']}% consensus)")
                for p in equiv[:4]:
                    print(f"    - {p}")
            else:
                print(f"  Primary: {card['primary_recommendation']['name']} ({card['primary_recommendation']['consensus_pct']}%)")
            if card['alternatives']:
                alts = ', '.join([f"{a['name'][:25]} ({a['percentage']}%)" for a in card['alternatives'][:2]])
                print(f"  Also: {alts}")
            print(f"  Detailed search: {'Yes' if card['recommend_detailed_search'] else 'No'}")

if __name__ == "__main__":
    main()
