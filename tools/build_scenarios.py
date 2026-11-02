#!/usr/bin/env python3
"""
Build the scenario data the site serves from the raw ACR portal captures.

This replaces tools/rebuild-acr-data.cjs, which only kept procedures with
certain name prefixes (dropping MRA, MRV, bone scans, image-guided procedures
and more) and lost ACR's disagreement flags.

Input:  raw captures, one JSON file per fetch ($ACR_RAW/acr_scenarios/*.json)
Output: data/regions/*.json, one entry per scenario per region
        data/search/scenario_names.json, the flat index global search uses
        data/search/topics.json, scenario ids grouped by ACR topic
        data/data-info.json, capture dates and counts shown on the site

Usage:
    python tools/build_scenarios.py [--check]

--check parses and reports without writing anything.
"""
import argparse
import collections
import glob
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RAW = Path(os.environ.get('ACR_RAW', 'C:/Users/Patrick/OneDrive/ACR Info')) / 'acr_scenarios'

CATEGORIES = {
    'usually appropriate': ('Usually Appropriate', 9),
    'may be appropriate': ('May Be Appropriate', 5),
    'usually not appropriate': ('Usually Not Appropriate', 2),
}
CATEGORY_RE = re.compile(r'^(usually appropriate|may be appropriate|usually not appropriate)\s*(\(disagreement\))?$', re.I)
DOSE_RE = re.compile(r'(msv|^varies$)', re.I)

# First match wins, so more specific groups come first. Tested against the ACR
# topic title. Every topic must land in a region; tests/data.test.mjs checks it.
REGION_RULES = [
    ('breast', r'breast|mammo|\baxilla\b|nipple|epigastric arteries|lactating|ductal carcinoma'),
    ('msk', r'osteomyelitis'),
    ('chest', r'aortic valve|pulmonary arteriovenous|cardiothoracic|left atrial'),
    ('vascular', r'aortic|aneurysm, suspected|aortic aneurysm|claudication|arterial|venous|vascular malformation|'
                 r'vascular anomal|vasculitis|iliac artery|mesenteric ischemia|dialysis|thoracic outlet|renovascular|'
                 r'deep vein|cold, painful leg'),
    ('neuro', r'head and neck|head trauma|headache|cerebrovascular|brain|neck mass|penetrating neck|facial trauma|'
              r'dementia|seizure|ataxia|dizz|hearing|cranial|horner|orbit|sinus|ear disease|thyroid|parathyroid|'
              r'movement disorder|demyelin|altered mental|plexopathy|intracranial|neuroendocrine imaging|tinnitus|'
              r'salivary|sinonasal|vision loss'),
    ('spine', r'back pain|spine|spinal|scoliosis|myelopathy|vertebral|cervical pain|spondyloarthr'),
    ('chest', r'chest|\blungs?\b|pulmonary|cough|dyspnea|hemoptysis|cardiac|coronary|heart|myocardial|endocarditis|'
              r'mediastin|pneumonia|respiratory|tuberculosis|rib fracture|pleural|chylothorax|mesothelioma|thymic|'
              r'tracheobronchial|syncope'),
    ('msk', r'shoulder|elbow|hand|wrist|\bhip\b|knee|ankle|foot|joint|bone|fracture|osteo|soft tissue|musculoskeletal|'
            r'arthroplasty|limping|arthritis|extremit'),
    ('abdomen', r'abdom|liver|hepat|pancrea|renal|kidney|hematuria|pelvi|bowel|crohn|quadrant|epigastric|jaundice|'
                r'hernia|ovarian|adnexal|uter|fibroid|trimester|fetal|gestation|placenta|cervix|prostat|bladder|'
                r'urinary|urothelial|scrotal|testicular|hematospermia|colon|colorectal|rectal|anal|anorectal|gastric|'
                r'esophag|dysphagia|gastrointestinal|flank|pyelonephritis|adrenal|bariatric|hydronephrosis|'
                r'endometri|vagina|vulvar|postpartum|infertility|nuchal|antenatal|penetrating torso|gravid|'
                r'appendicitis|vomiting|retroperitoneal'),
]


def region_for_topic(topic):
    t = topic.lower()
    for region, pattern in REGION_RULES:
        if re.search(pattern, t):
            return region
    return 'other'


def parse_capture(content):
    """Returns (topic, variant, name, acr_code, rows) or None for a failed fetch."""
    if 'Appropriateness Category' not in content:
        return None
    head, body = content.split('Appropriateness Category', 1)

    head_lines = [l.strip() for l in head.split('\n') if l.strip()]
    topic = head_lines[head_lines.index('Home') + 1] if 'Home' in head_lines else ''
    variant = ''
    if 'Variants' in head_lines:
        start = head_lines.index('Variants') + 1
        rest = head_lines[start:]
        variant = ' '.join(rest[:rest.index('Documents')]) if 'Documents' in rest else ''

    lines = [l.strip() for l in body.split('\n') if l.strip()]
    if 'Footer' in lines:
        lines = lines[:lines.index('Footer')]
    if not lines:
        return None

    name = lines[0]
    rows = []
    current = []
    code = None
    for line in lines[1:]:
        if code is None and not current and re.fullmatch(r'\d{5,}', line):
            code = line
            continue
        if line.lower() == '(disagreement)':
            if rows:
                rows[-1]['hasDisagreement'] = True
            continue
        match = CATEGORY_RE.match(line)
        if match:
            if current:
                label, rating = CATEGORIES[match.group(1).lower()]
                rows.append({
                    'name': current[0],
                    'ratingLevel': label,
                    'rating': rating,
                    'hasDisagreement': bool(match.group(2)),
                    **parse_doses(current[1:]),
                })
            current = []
        else:
            current.append(line)
    return topic, variant, name, code, rows


def parse_doses(fields):
    doses = [f for f in fields if DOSE_RE.search(f)]
    adult = next((d for d in doses if '[ped]' not in d), None)
    ped = next((d.replace(' [ped]', '') for d in doses if '[ped]' in d), None)
    if ped is None and adult and adult.lower() == 'varies' and len(doses) > 1:
        ped = doses[1]
    return {'radiationDose': adult, 'radiationDosePed': ped}


def detect_modality(name):
    n = name.lower()
    if n.startswith(('mri', 'mra', 'mrv', 'mru', 'mrcp', 'mr ')) or ' mri ' in n:
        return 'MRI'
    if 'pet' in re.findall(r'[a-z]+', n) or 'pet/ct' in n or 'pet/mri' in n:
        return 'PET'
    if n.startswith(('ct', 'cta', 'ctv', 'ctu')) or ' ct ' in n:
        return 'CT'
    if n.startswith('us ') or 'ultrasound' in n or 'sonograph' in n:
        return 'US'
    if 'mammogr' in n or 'tomosynthesis' in n or n.startswith('dbt'):
        return 'Mammography'
    if 'arteriography' in n or 'aortography' in n or 'venography' in n or 'angiogr' in n:
        return 'Angiography'
    if 'fluoroscop' in n or 'barium' in n or 'esophagram' in n or 'voiding' in n:
        return 'Fluoroscopy'
    if re.search(r'scintigraph|spect|bone scan|wbc scan|renal scan|rbc scan|liver spleen scan|cisternography|gallium|'
                 r'sestamibi|mibg|v/q|nuclear|octreo|dotatate', n):
        return 'Nuclear'
    if n.startswith('image-guided') or 'percutaneous' in n or 'biopsy' in n or 'aspiration' in n:
        return 'Procedure'
    if 'radiograph' in n or n.startswith('xr'):
        return 'XR'
    return 'Other'


def detect_contrast(name):
    n = name.lower()
    if 'without and with' in n or 'with and without' in n:
        return 2
    if 'with iv contrast' in n or 'with contrast' in n:
        return 1
    return 0


def short_name(name):
    out = name
    for pattern, repl in [
        (r'without and with IV contrast', 'W/O & W/ Contrast'),
        (r'with IV contrast', 'W/ Contrast'),
        (r'without IV contrast', 'W/O Contrast'),
        (r'abdomen and pelvis', 'Abd/Pelvis'),
        (r'Digital breast tomosynthesis', 'DBT'),
    ]:
        out = re.sub(pattern, repl, out, flags=re.I)
    return out


def clean_name(name):
    return ' '.join(name.split()).replace('Low pack pain', 'Low back pain')


def age_for(variant, topic, name):
    v = variant.lower()
    both = re.search(r'\badult or child\b|\bchild or adult\b|\badolescent or adult\b|\badults? and child', v)
    if both or re.search(r'\bchild\b.*\b(or older|and older)\b.*\badult\b', v):
        return 'any'
    if re.search(r'\b(adult|woman|women|man|men|female|male|pregnant|postmenopausal|premenopausal)\b', v) and \
            not re.search(r'\b(child|infant|neonate|newborn|adolescent|pediatric)\b', v):
        return 'adult'
    if re.search(r'\b(child|infant|neonate|newborn|adolescent|pediatric|younger than 18)\b', v):
        return 'pediatric'
    if re.search(r'-child\b|-infant\b|\bchild\b', topic, re.I) or name.lower().startswith('ped'):
        return 'pediatric'
    return 'adult'


def load_captures():
    """Latest capture per scenario id, plus a count of ids whose captures disagree."""
    by_id = collections.defaultdict(list)
    failed = 0
    for path in glob.glob(str(RAW / '*.json')):
        with open(path, encoding='utf8') as fh:
            doc = json.load(fh)
        if not isinstance(doc, dict) or 'content' not in doc:
            failed += 1
            continue
        match = re.search(r'senarioId=(\d+)', doc.get('url', ''))
        parsed = parse_capture(doc['content'])
        if not match or not parsed or not parsed[4]:
            failed += 1
            continue
        by_id[match.group(1)].append((doc.get('fetched_at') or '', parsed, doc['url']))

    latest = {}
    conflicts = []
    for sid, captures in by_id.items():
        captures.sort(key=lambda c: c[0])
        signatures = {tuple((r['name'], r['ratingLevel']) for r in c[1][4]) for c in captures}
        if len(signatures) > 1:
            conflicts.append(sid)
        latest[sid] = captures[-1]
    return latest, conflicts, failed


def build():
    latest, conflicts, failed = load_captures()
    scenarios = []
    for sid, (fetched, (topic, variant, name, code, rows), url) in latest.items():
        procedures = []
        seen = set()
        for row in rows:
            if row['name'] in seen:
                continue
            seen.add(row['name'])
            procedures.append({
                'name': row['name'],
                'shortName': short_name(row['name']),
                'modality': detect_modality(row['name']),
                'usesContrast': detect_contrast(row['name']),
                'rating': row['rating'],
                'ratingLevel': row['ratingLevel'],
                'hasDisagreement': row['hasDisagreement'],
                'radiationDose': row['radiationDose'],
                'radiationDosePed': row['radiationDosePed'],
            })
        scenarios.append({
            'id': sid,
            'name': clean_name(name),
            'topic': ' '.join(topic.split()),
            'variant': re.sub(r'^Variant:?\s*\d+\s*', '', variant).strip(),
            'ageGroup': age_for(variant, topic, name),
            'procedures': procedures,
            'sourceUrl': url,
            'capturedAt': fetched[:10],
        })

    # Identical names can hide different patients (male and female breast
    # screening). Say so in the name wherever their recommendations differ.
    by_name = collections.defaultdict(list)
    for s in scenarios:
        by_name[s['name']].append(s)
    disambiguated = 0
    for group in by_name.values():
        tiers = {tuple(sorted(p['name'] for p in s['procedures'] if p['rating'] == 9)) for s in group}
        if len(group) > 1 and len(tiers) > 1 and len({s['topic'] for s in group}) > 1:
            for s in group:
                s['name'] = f"{s['name']} ({s['topic']})"
                disambiguated += 1
    scenarios.sort(key=lambda s: int(s['id']))
    return scenarios, conflicts, failed, disambiguated


def top_tier(scenario):
    """The highest category present and the studies in it, in ACR's order."""
    for level in ('Usually Appropriate', 'May Be Appropriate', 'Usually Not Appropriate'):
        names = [p for p in scenario['procedures'] if p['ratingLevel'] == level]
        if names:
            return level, names
    return None, []


def write_json(path, data):
    with open(path, 'w', encoding='utf8', newline='\n') as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))


def write_outputs(scenarios):
    now = datetime.now(timezone.utc).isoformat()
    regions = collections.defaultdict(list)
    for s in scenarios:
        primary = region_for_topic(s['topic'])
        s['region'] = primary
        regions[primary].append(s)
        if s['ageGroup'] == 'pediatric':
            regions['peds'].append(s)

    for region, items in regions.items():
        write_json(REPO / 'data' / 'regions' / f'{region}.json', {
            'region': region, 'generatedAt': now, 'count': len(items), 'scenarios': items,
        })

    old_path = REPO / 'data' / 'search' / 'scenario_names.json'
    with open(old_path, encoding='utf8') as fh:
        keywords = {s['id']: s.get('keywords', []) for s in json.load(fh)['scenarios']}

    index = []
    for s in scenarios:
        level, studies = top_tier(s)
        lead = studies[0]
        index.append({
            'id': s['id'],
            'name': s['name'],
            'region': s['region'],
            'topic': s['topic'],
            'age': s['ageGroup'],
            'keywords': keywords.get(s['id'], []),
            'search': s['variant'],
            'top_procedure': {
                'name': lead['shortName'],
                'modality': lead['modality'],
                'rating': lead['rating'],
                'ratingLevel': level,
                'usesContrast': lead['usesContrast'],
                'radiationDose': lead['radiationDose'],
            },
            'top_tier': {
                'level': level,
                'studies': [p['shortName'] for p in studies],
                'disagreement': any(p['hasDisagreement'] for p in studies),
            },
        })
    write_json(old_path, {'version': '3.0', 'generated_at': now, 'count': len(index), 'scenarios': index})

    topics = collections.defaultdict(list)
    for s in scenarios:
        topics[s['topic']].append(s['id'])
    write_json(REPO / 'data' / 'search' / 'topics.json', {
        'generated_at': now,
        'topics': [{'name': t, 'region': region_for_topic(t), 'ids': ids} for t, ids in sorted(topics.items())],
    })

    dates = sorted(s['capturedAt'] for s in scenarios)
    write_json(REPO / 'data' / 'data-info.json', {
        'capturedFrom': dates[0], 'capturedTo': dates[-1],
        'scenarios': len(scenarios), 'topics': len(topics),
    })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if not RAW.is_dir():
        sys.exit(f'Raw captures not found at {RAW}; set ACR_RAW')

    scenarios, conflicts, failed, disambiguated = build()
    proc = [p for s in scenarios for p in s['procedures']]
    print('scenarios', len(scenarios), 'topics', len({s['topic'] for s in scenarios}), 'procedures', len(proc))
    print('failed captures', failed, 'ids with conflicting captures', len(conflicts), 'renamed', disambiguated)
    print('disagreement', sum(p['hasDisagreement'] for p in proc))
    print('levels', collections.Counter(p['ratingLevel'] for p in proc))
    print('modality', collections.Counter(p['modality'] for p in proc).most_common())
    print('age', collections.Counter(s['ageGroup'] for s in scenarios))
    print('no topic', sum(not s['topic'] for s in scenarios), 'no variant', sum(not s['variant'] for s in scenarios))
    print('regions', collections.Counter(region_for_topic(s['topic']) for s in scenarios))
    if not args.check:
        write_outputs(scenarios)
        print('written')


if __name__ == '__main__':
    main()
