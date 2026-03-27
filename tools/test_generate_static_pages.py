import unittest
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from generate_static_pages import slugify, make_unique_slugs, make_display_name, REGION_ICONS, CSS_VERSION, render_region, render_protocol, render_about

class TestSlugify(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(slugify("MRI Brain W/O Contrast"), "mri-brain-wo-contrast")

    def test_with_contrast(self):
        self.assertEqual(slugify("MRI Brain W/ Contrast"), "mri-brain-w-contrast")

    def test_ampersand(self):
        self.assertEqual(slugify("CT Abdomen & Pelvis W/ Contrast"), "ct-abdomen-and-pelvis-w-contrast")

    def test_w_and_wo(self):
        self.assertEqual(slugify("MRI Brain W/ & W/O Contrast"), "mri-brain-w-and-wo-contrast")

    def test_already_clean(self):
        self.assertEqual(slugify("MRI Knee"), "mri-knee")

    def test_consecutive_hyphens_collapsed(self):
        result = slugify("MRI  Brain")
        self.assertNotIn("--", result)

    def test_no_leading_trailing_hyphens(self):
        result = slugify("MRI Brain")
        self.assertFalse(result.startswith("-"))
        self.assertFalse(result.endswith("-"))

class TestMakeUniqueSlugs(unittest.TestCase):
    def _p(self, canonical, display):
        return {"canonical_procedure": canonical, "display_name": display}

    def test_no_collision(self):
        protocols = [self._p("MRI Brain W/O Contrast", "BRAIN")]
        result = make_unique_slugs(protocols)
        self.assertEqual(result[0], "mri-brain-wo-contrast")

    def test_collision_appends_display_name(self):
        protocols = [
            self._p("MRI Brain W/O Contrast", "BRAIN"),
            self._p("MRI Brain W/O Contrast", "SEIZURE"),
        ]
        result = make_unique_slugs(protocols)
        self.assertEqual(result[0], "mri-brain-wo-contrast")
        self.assertEqual(result[1], "mri-brain-wo-contrast-seizure")

    def test_triple_collision_appends_numeric(self):
        protocols = [
            self._p("MRI Brain W/O Contrast", "BRAIN"),
            self._p("MRI Brain W/O Contrast", "SEIZURE"),
            self._p("MRI Brain W/O Contrast", "SEIZURE"),  # duplicate display_name
        ]
        result = make_unique_slugs(protocols)
        self.assertEqual(result[0], "mri-brain-wo-contrast")
        self.assertEqual(result[1], "mri-brain-wo-contrast-seizure")
        self.assertEqual(result[2], "mri-brain-wo-contrast-seizure-2")

    def test_all_slugs_unique(self):
        protocols = [
            self._p("MRI Brain W/O Contrast", "BRAIN"),
            self._p("MRI Brain W/O Contrast", "SEIZURE"),
            self._p("MRI Knee W/O Contrast", "KNEE"),
        ]
        result = make_unique_slugs(protocols)
        self.assertEqual(len(set(result.values())), 3)

class TestMakeDisplayName(unittest.TestCase):
    def test_display_name_is_substring_no_parens(self):
        # "brain" IS in "mri brain w/o contrast"
        result = make_display_name("MRI Brain W/O Contrast", "BRAIN")
        self.assertNotIn("(", result)
        self.assertIn("Brain", result)

    def test_display_name_not_substring_adds_parens(self):
        # "seizure" is NOT in "mri brain w/o contrast"
        result = make_display_name("MRI Brain W/O Contrast", "SEIZURE")
        self.assertIn("(Seizure)", result)

    def test_title_case_applied(self):
        result = make_display_name("MRI BRAIN W/O CONTRAST", "BRAIN")
        self.assertTrue(result[0].isupper())
        # Not all-caps
        self.assertFalse(result == result.upper())

class TestConstants(unittest.TestCase):
    def test_region_icons_has_all_8_regions(self):
        expected = {"neuro", "spine", "msk", "abdomen", "chest", "vascular", "breast", "peds"}
        self.assertEqual(set(REGION_ICONS.keys()), expected)

    def test_region_icons_values_are_nonempty_strings(self):
        for region, svg in REGION_ICONS.items():
            self.assertIsInstance(svg, str, f"REGION_ICONS[{region!r}] is not a string")
            self.assertTrue(len(svg) > 0, f"REGION_ICONS[{region!r}] is empty")

    def test_css_version_updated(self):
        self.assertEqual(CSS_VERSION, "20260324a")

class TestRenderRegion(unittest.TestCase):
    def _make_card(self, topic="Headache", card_type="STRONG", consensus=95, rec_name="CT Head"):
        return {
            "display_name": topic,
            "topic": topic,
            "region": "neuro",
            "card_type": card_type,
            "primary_recommendation": {"name": rec_name, "consensus_pct": consensus},
        }

    def _render(self, cards=None, protocols=None):
        if cards is None:
            cards = [self._make_card()]
        if protocols is None:
            protocols = []
        slug_map = {}
        return render_region("neuro", cards, protocols, slug_map, [], 100)

    def test_uses_static_hero_class(self):
        html = self._render()
        self.assertIn('class="static-hero"', html)

    def test_hero_contains_svg_icon(self):
        html = self._render()
        self.assertIn('class="static-hero-icon"', html)
        # neuro icon path
        self.assertIn('circle cx="12" cy="8"', html)

    def test_uses_topic_grid_class(self):
        html = self._render()
        self.assertIn('class="topic-grid"', html)

    def test_uses_topic_card_class(self):
        html = self._render()
        self.assertIn('class="topic-card"', html)

    def test_strong_badge_class(self):
        html = self._render(cards=[self._make_card(card_type="STRONG")])
        self.assertIn("topic-badge-strong", html)

    def test_conditional_badge_class(self):
        html = self._render(cards=[self._make_card(card_type="CONDITIONAL")])
        self.assertIn("topic-badge-cond", html)

    def test_consensus_pct_displayed(self):
        html = self._render(cards=[self._make_card(consensus=95)])
        self.assertIn("95%", html)

    def test_zero_consensus_badge_omitted(self):
        html = self._render(cards=[self._make_card(consensus=0)])
        self.assertNotIn("0%", html)

    def test_protocols_use_protocol_list_class(self):
        protos = [{"canonical_procedure": "MRI Brain W/O Contrast",
                   "display_name": "BRAIN", "body_region": "neuro"}]
        slug_map = {0: "mri-brain-wo-contrast"}
        html = render_region("neuro", [], protos, slug_map, protos, 100)
        self.assertIn('class="protocol-list"', html)
        self.assertIn('class="protocol-list-item"', html)

    def test_no_protocols_section_when_empty(self):
        html = render_region("neuro", [], [], {}, [], 100)
        self.assertNotIn('class="protocol-list"', html)

    def test_no_cards_section_when_empty(self):
        html = render_region("neuro", [], [], {}, [], 100)
        self.assertNotIn('class="topic-grid"', html)

    def test_uses_protocol_cta(self):
        html = self._render()
        self.assertIn('class="protocol-cta"', html)


class TestRenderProtocol(unittest.TestCase):
    def _make_protocol(self, region="neuro", sequences=None, matches=None):
        return {
            "canonical_procedure": "MRI Brain W/O Contrast",
            "display_name": "BRAIN",
            "body_region": region,
            "indications": "General neurological evaluation.",
            "sequences": sequences or [
                {"sequence_name": "SAG T1", "sort_order": 1, "is_post_contrast": 0},
                {"sequence_name": "AX T2", "sort_order": 2, "is_post_contrast": 0},
            ],
            "scenario_matches": matches or [
                {"scenario_name": "Headache, acute onset", "relevance_score": 0.9},
            ],
        }

    def _render(self, region="neuro", sequences=None, matches=None):
        return render_protocol(self._make_protocol(region, sequences, matches), "mri-brain-wo-contrast")

    def test_uses_static_breadcrumb_class(self):
        html = self._render()
        self.assertIn('class="static-breadcrumb"', html)

    def test_breadcrumb_includes_region_link_for_known_region(self):
        html = self._render(region="neuro")
        self.assertIn('href="/regions/neuro/"', html)

    def test_breadcrumb_omits_region_link_for_unknown_region(self):
        html = self._render(region="neck")
        self.assertNotIn('href="/regions/neck/"', html)

    def test_uses_protocol_type_badge(self):
        html = self._render()
        self.assertIn('class="protocol-type-badge"', html)

    def test_uses_sequence_table_class(self):
        html = self._render()
        self.assertIn('class="sequence-table"', html)

    def test_sequences_rendered_as_table_rows(self):
        html = self._render()
        self.assertIn("<tr>", html)
        self.assertIn("SAG T1", html)
        self.assertIn("Pre-contrast", html)

    def test_uses_scenario_pill_class(self):
        html = self._render()
        self.assertIn('class="scenario-pill"', html)

    def test_scenario_name_displayed(self):
        html = self._render()
        self.assertIn("Headache, acute onset", html)

    def test_uses_protocol_cta_class(self):
        html = self._render()
        self.assertIn('class="protocol-cta"', html)

    def test_no_old_inline_table_styles(self):
        html = self._render()
        self.assertNotIn("border-collapse:collapse", html)

    def test_uses_static_section_label(self):
        html = self._render()
        self.assertIn('class="static-section-label"', html)


class TestRenderAbout(unittest.TestCase):
    def test_key_stats_uses_scenario_pill(self):
        html = render_about()
        self.assertIn('class="scenario-pill"', html)

    def test_region_links_use_protocol_list_item(self):
        html = render_about()
        self.assertIn('class="protocol-list-item"', html)
        self.assertIn('href="/regions/neuro/"', html)
        self.assertIn('href="/regions/peds/"', html)

    def test_list_headings_use_static_section_label(self):
        html = render_about()
        self.assertIn('class="static-section-label"', html)

    def test_prose_headings_do_not_use_static_section_label(self):
        html = render_about()
        for heading in ["Data Sources", "Important Notice", "Contact"]:
            self.assertNotIn(f'class="static-section-label">{heading}', html)

    def test_all_8_regions_linked(self):
        html = render_about()
        from generate_static_pages import REGION_DISPLAY
        for region in REGION_DISPLAY:
            self.assertIn(f'href="/regions/{region}/"', html)


if __name__ == "__main__":
    unittest.main()
