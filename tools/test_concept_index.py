#!/usr/bin/env python3
"""
Automated Test Suite for Radex Concept Index

Tests:
1. Cross-anatomy contamination - concepts should only map to their body region
2. Synonym coverage - all synonyms should resolve to correct concepts
3. Phase detection accuracy - phases should match scenario content
4. Scenario coverage - concepts should have reasonable scenario counts
5. Relevance scoring - high relevance scenarios should actually match

Usage:
    python tools/test_concept_index.py
"""

import json
import re
from pathlib import Path
from collections import defaultdict

# Test configuration
MIN_SCENARIOS_PER_CONCEPT = 1
MAX_SCENARIOS_PER_CONCEPT = 100  # Flag if suspiciously high
MIN_RELEVANCE_THRESHOLD = 0.2

# Phase keywords for validation
PHASE_VALIDATORS = {
    "screening": ["screening", "asymptomatic", "risk factor", "average risk", "high risk"],
    "initial": ["initial", "suspected", "new onset", "evaluation", "diagnosis"],
    "pretreatment": ["pretreatment", "staging", "preoperative", "pre-op", "surgical planning"],
    "surveillance": ["surveillance", "follow-up", "treated", "recurrence", "post-treatment", "monitoring"],
    "complication": ["complication", "progression", "failure", "worsening"]
}


class ConceptIndexTester:
    def __init__(self, project_root):
        self.project_root = Path(project_root)
        self.concept_index = None
        self.region_data = {}
        self.errors = []
        self.warnings = []
        self.stats = defaultdict(int)

    def load_data(self):
        """Load concept index and region data."""
        # Load concept index
        index_path = self.project_root / "data" / "search" / "concept_index.json"
        with open(index_path, 'r', encoding='utf-8') as f:
            self.concept_index = json.load(f)

        # Load all region data
        regions_dir = self.project_root / "data" / "regions"
        for region_file in regions_dir.glob("*.json"):
            region_name = region_file.stem
            with open(region_file, 'r', encoding='utf-8') as f:
                self.region_data[region_name] = json.load(f)

        print(f"Loaded concept index with {len(self.concept_index['concepts'])} concepts")
        print(f"Loaded {len(self.region_data)} regions")
        print()

    def test_cross_anatomy_contamination(self):
        """Test that concepts only map to scenarios in their body region."""
        print("=" * 60)
        print("TEST: Cross-Anatomy Contamination")
        print("=" * 60)

        contaminated = []

        for concept_id, concept in self.concept_index['concepts'].items():
            expected_region = concept['body_region']

            for mapping in concept['scenario_mappings']:
                actual_region = mapping.get('region')

                if actual_region and actual_region != expected_region:
                    contaminated.append({
                        'concept': concept_id,
                        'concept_region': expected_region,
                        'scenario_id': mapping['scenario_id'],
                        'scenario_name': mapping['scenario_name'][:60],
                        'scenario_region': actual_region
                    })

        if contaminated:
            print(f"FAIL: Found {len(contaminated)} cross-anatomy contaminations:")
            for c in contaminated[:10]:  # Show first 10
                print(f"  - {c['concept']} ({c['concept_region']}) -> {c['scenario_name']} ({c['scenario_region']})")
            if len(contaminated) > 10:
                print(f"  ... and {len(contaminated) - 10} more")
            self.errors.append(f"Cross-anatomy contamination: {len(contaminated)} cases")
        else:
            print("PASS: No cross-anatomy contamination found")

        self.stats['contamination_count'] = len(contaminated)
        print()
        return len(contaminated) == 0

    def test_synonym_coverage(self):
        """Test that all synonyms resolve to correct concepts."""
        print("=" * 60)
        print("TEST: Synonym Coverage")
        print("=" * 60)

        synonym_to_concept = self.concept_index['synonym_to_concept']

        # Check all synonyms in concept definitions are in the lookup
        missing_synonyms = []
        for concept_id, concept in self.concept_index['concepts'].items():
            for synonym in concept.get('synonyms', []):
                syn_lower = synonym.lower()
                if syn_lower not in synonym_to_concept:
                    missing_synonyms.append((concept_id, synonym))
                elif synonym_to_concept[syn_lower] != concept_id:
                    self.warnings.append(f"Synonym '{synonym}' maps to {synonym_to_concept[syn_lower]} not {concept_id}")

        if missing_synonyms:
            print(f"FAIL: {len(missing_synonyms)} synonyms missing from lookup:")
            for concept_id, syn in missing_synonyms[:5]:
                print(f"  - '{syn}' for {concept_id}")
            self.errors.append(f"Missing synonyms: {len(missing_synonyms)}")
        else:
            print(f"PASS: All {len(synonym_to_concept)} synonyms properly mapped")

        self.stats['total_synonyms'] = len(synonym_to_concept)
        print()
        return len(missing_synonyms) == 0

    def test_phase_detection(self):
        """Test that phase detection matches scenario content."""
        print("=" * 60)
        print("TEST: Phase Detection Accuracy")
        print("=" * 60)

        phase_mismatches = []
        phase_correct = 0
        phase_total = 0

        for concept_id, concept in self.concept_index['concepts'].items():
            for mapping in concept['scenario_mappings']:
                scenario_name = mapping['scenario_name'].lower()
                detected_phase = mapping['metadata'].get('phase', 'initial')

                # Check if detected phase keywords are in scenario name
                phase_keywords = PHASE_VALIDATORS.get(detected_phase, [])
                has_keyword = any(kw in scenario_name for kw in phase_keywords)

                # Also check if another phase's keywords are more prominent
                other_phase_match = None
                for other_phase, other_keywords in PHASE_VALIDATORS.items():
                    if other_phase != detected_phase:
                        if any(kw in scenario_name for kw in other_keywords):
                            other_phase_match = other_phase
                            break

                phase_total += 1

                if has_keyword:
                    phase_correct += 1
                elif other_phase_match and not has_keyword:
                    phase_mismatches.append({
                        'scenario': mapping['scenario_name'][:50],
                        'detected': detected_phase,
                        'likely': other_phase_match
                    })

        accuracy = (phase_correct / phase_total * 100) if phase_total > 0 else 0

        print(f"Phase detection accuracy: {accuracy:.1f}% ({phase_correct}/{phase_total})")

        if phase_mismatches:
            print(f"Potential mismatches ({len(phase_mismatches)}):")
            for m in phase_mismatches[:5]:
                print(f"  - '{m['scenario']}...' detected={m['detected']}, likely={m['likely']}")
            if len(phase_mismatches) > 5:
                print(f"  ... and {len(phase_mismatches) - 5} more")

        if accuracy >= 70:
            print("PASS: Phase detection accuracy acceptable")
        else:
            print("WARN: Phase detection accuracy below 70%")
            self.warnings.append(f"Phase detection accuracy: {accuracy:.1f}%")

        self.stats['phase_accuracy'] = accuracy
        print()
        return accuracy >= 70

    def test_scenario_coverage(self):
        """Test that concepts have reasonable scenario counts."""
        print("=" * 60)
        print("TEST: Scenario Coverage")
        print("=" * 60)

        low_coverage = []
        high_coverage = []
        coverage_stats = []

        for concept_id, concept in self.concept_index['concepts'].items():
            count = len(concept['scenario_mappings'])
            coverage_stats.append((concept_id, concept['display_name'], count))

            if count < MIN_SCENARIOS_PER_CONCEPT:
                low_coverage.append((concept_id, count))
            elif count > MAX_SCENARIOS_PER_CONCEPT:
                high_coverage.append((concept_id, count))

        # Sort by count
        coverage_stats.sort(key=lambda x: x[2], reverse=True)

        print("Top 10 concepts by scenario count:")
        for concept_id, name, count in coverage_stats[:10]:
            print(f"  {count:4d} - {name}")

        print(f"\nBottom 10 concepts by scenario count:")
        for concept_id, name, count in coverage_stats[-10:]:
            print(f"  {count:4d} - {name}")

        if low_coverage:
            print(f"\nWARN: {len(low_coverage)} concepts with < {MIN_SCENARIOS_PER_CONCEPT} scenarios")
            self.warnings.append(f"Low coverage concepts: {len(low_coverage)}")

        if high_coverage:
            print(f"\nWARN: {len(high_coverage)} concepts with > {MAX_SCENARIOS_PER_CONCEPT} scenarios (may be too broad)")
            for concept_id, count in high_coverage:
                print(f"  - {concept_id}: {count}")
            self.warnings.append(f"High coverage concepts: {len(high_coverage)}")

        avg_coverage = sum(c[2] for c in coverage_stats) / len(coverage_stats) if coverage_stats else 0
        print(f"\nAverage scenarios per concept: {avg_coverage:.1f}")

        self.stats['avg_scenarios_per_concept'] = avg_coverage
        print()
        return len(low_coverage) == 0

    def test_relevance_scores(self):
        """Test that high relevance scenarios actually contain concept keywords."""
        print("=" * 60)
        print("TEST: Relevance Score Validation")
        print("=" * 60)

        false_positives = []

        for concept_id, concept in self.concept_index['concepts'].items():
            # Get top scenarios by relevance
            top_scenarios = sorted(
                concept['scenario_mappings'],
                key=lambda x: x['relevance_score'],
                reverse=True
            )[:5]

            # Check if any synonym appears in the scenario name
            synonyms = [s.lower() for s in concept.get('synonyms', [])]

            for mapping in top_scenarios:
                scenario_lower = mapping['scenario_name'].lower()
                has_match = any(syn in scenario_lower for syn in synonyms)

                if not has_match and mapping['relevance_score'] > 0.3:
                    false_positives.append({
                        'concept': concept_id,
                        'scenario': mapping['scenario_name'][:50],
                        'score': mapping['relevance_score']
                    })

        if false_positives:
            print(f"Potential false positives ({len(false_positives)}):")
            for fp in false_positives[:10]:
                # Sanitize for Windows console
                scenario = fp['scenario'].encode('ascii', 'replace').decode('ascii')
                print(f"  - {fp['concept']}: '{scenario}...' (score={fp['score']})")
            self.warnings.append(f"Potential false positives: {len(false_positives)}")
        else:
            print("PASS: Top relevance scenarios appear accurate")

        print()
        return len(false_positives) < 10

    def test_region_scenario_ids(self):
        """Test that scenario IDs in concept index exist in region data."""
        print("=" * 60)
        print("TEST: Scenario ID Validation")
        print("=" * 60)

        # Build set of all scenario IDs per region
        region_ids = {}
        for region_name, region_data in self.region_data.items():
            region_ids[region_name] = set()
            for scenario in region_data.get('scenarios', []):
                if scenario.get('id'):
                    region_ids[region_name].add(scenario['id'])

        missing_ids = []
        valid_ids = 0

        for concept_id, concept in self.concept_index['concepts'].items():
            for mapping in concept['scenario_mappings']:
                scenario_id = mapping['scenario_id']
                region = mapping.get('region')

                if region and region in region_ids:
                    if scenario_id in region_ids[region]:
                        valid_ids += 1
                    else:
                        missing_ids.append({
                            'concept': concept_id,
                            'scenario_id': scenario_id,
                            'region': region
                        })

        if missing_ids:
            print(f"FAIL: {len(missing_ids)} scenario IDs not found in region data:")
            for m in missing_ids[:5]:
                print(f"  - {m['concept']}: ID {m['scenario_id']} not in {m['region']}")
            self.errors.append(f"Missing scenario IDs: {len(missing_ids)}")
        else:
            print(f"PASS: All {valid_ids} scenario IDs validated")

        print()
        return len(missing_ids) == 0

    def test_query_simulation(self):
        """Simulate common queries and check results."""
        print("=" * 60)
        print("TEST: Query Simulation")
        print("=" * 60)

        test_queries = [
            # (query, expected_concept, expected_region)
            ("brain tumor", "brain_neoplasm", "neuro"),
            ("stroke", "stroke", "neuro"),
            ("headache", "headache", "neuro"),
            ("appendicitis", "appendicitis", "abdomen"),
            ("liver mass", "liver_lesion", "abdomen"),
            ("lung nodule", "lung_nodule", "chest"),
            ("knee pain", "knee_pain", "msk"),
            ("breast cancer", "breast_cancer", "breast"),
            ("aortic aneurysm", "aortic_aneurysm", "chest"),  # ACR puts aortic in chest
            ("back pain", "back_pain", "spine"),
            ("dvt", "dvt", "msk"),  # DVT scenarios are in MSK
            ("aortic dissection", "aortic_dissection", "chest"),
        ]

        synonym_lookup = self.concept_index['synonym_to_concept']
        passed = 0
        failed = []

        for query, expected_concept, expected_region in test_queries:
            query_lower = query.lower()

            # Try exact match
            matched_concept = synonym_lookup.get(query_lower)

            # Try partial match if no exact
            if not matched_concept:
                for syn, cid in synonym_lookup.items():
                    if query_lower in syn or syn in query_lower:
                        matched_concept = cid
                        break

            if matched_concept == expected_concept:
                concept = self.concept_index['concepts'].get(matched_concept)
                if concept and concept['body_region'] == expected_region:
                    passed += 1
                    print(f"  PASS: '{query}' -> {matched_concept} ({expected_region})")
                else:
                    failed.append((query, f"wrong region: {concept['body_region'] if concept else 'N/A'}"))
            else:
                failed.append((query, f"got {matched_concept}, expected {expected_concept}"))

        for query, reason in failed:
            print(f"  FAIL: '{query}' - {reason}")

        print(f"\nQuery simulation: {passed}/{len(test_queries)} passed")

        if failed:
            self.errors.append(f"Query simulation failures: {len(failed)}")

        print()
        return len(failed) == 0

    def run_all_tests(self):
        """Run all tests and report results."""
        print("\n" + "=" * 60)
        print("RADEX CONCEPT INDEX TEST SUITE")
        print("=" * 60 + "\n")

        self.load_data()

        results = []
        results.append(("Cross-Anatomy Contamination", self.test_cross_anatomy_contamination()))
        results.append(("Synonym Coverage", self.test_synonym_coverage()))
        results.append(("Phase Detection", self.test_phase_detection()))
        results.append(("Scenario Coverage", self.test_scenario_coverage()))
        results.append(("Relevance Scores", self.test_relevance_scores()))
        results.append(("Scenario ID Validation", self.test_region_scenario_ids()))
        results.append(("Query Simulation", self.test_query_simulation()))

        # Summary
        print("=" * 60)
        print("TEST SUMMARY")
        print("=" * 60)

        passed = sum(1 for _, r in results if r)
        total = len(results)

        for name, result in results:
            status = "PASS" if result else "FAIL"
            print(f"  [{status}] {name}")

        print(f"\nResults: {passed}/{total} tests passed")

        if self.errors:
            print(f"\nErrors ({len(self.errors)}):")
            for e in self.errors:
                print(f"  - {e}")

        if self.warnings:
            print(f"\nWarnings ({len(self.warnings)}):")
            for w in self.warnings:
                print(f"  - {w}")

        print(f"\nStatistics:")
        for key, value in self.stats.items():
            print(f"  {key}: {value}")

        return passed == total


def main():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent

    tester = ConceptIndexTester(project_root)
    success = tester.run_all_tests()

    return 0 if success else 1


if __name__ == "__main__":
    exit(main())
