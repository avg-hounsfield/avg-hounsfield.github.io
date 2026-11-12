import unittest
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from generate_static_pages import slugify, make_unique_slugs, make_display_name, REGION_ICONS, CSS_VERSION, render_region, render_protocol, render_about, render_privacy, render_not_found

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
    def test_region_icons_has_all_regions(self):
        expected = {"neuro", "spine", "msk", "abdomen", "chest", "vascular", "breast", "peds", "other"}
        self.assertEqual(set(REGION_ICONS.keys()), expected)

    def test_region_icons_values_are_nonempty_strings(self):
        for region, svg in REGION_ICONS.items():
            self.assertIsInstance(svg, str, f"REGION_ICONS[{region!r}] is not a string")
            self.assertTrue(len(svg) > 0, f"REGION_ICONS[{region!r}] is empty")

    def test_css_version_updated(self):
        self.assertEqual(CSS_VERSION, "20261112a")


def assert_shared_shell(case, html, active=None):
    """Every generated page carries the same header, nav, footer and script."""
    for href, label in [("/", "Search"), ("/topics/", "Topics"), ("/#protocols", "Protocols"),
                        ("/#builder", "Builder"), ("/about/", "About")]:
        case.assertIn(f'href="{href}" class="nav-link', html)
        case.assertIn(f">{label}</a>", html)
    case.assertIn('id="mobileMenuBtn"', html)
    case.assertIn('src="/js/site-nav.js', html)
    case.assertIn('class="site-footer"', html)
    case.assertIn('class="page"', html)
    case.assertNotIn('style="', html.split("<body>", 1)[1])
    if active:
        case.assertIn('class="nav-link active" aria-current="page">' + active, html)


class TestRenderRegion(unittest.TestCase):
    def _make_card(self, topic="Headache", count=33):
        return {"name": topic, "count": count}

    def _render(self, cards=None, protocols=None):
        if cards is None:
            cards = [self._make_card()]
        if protocols is None:
            protocols = []
        slug_map = {}
        return render_region("neuro", cards, protocols, slug_map, [], 100)

    def test_uses_shared_shell(self):
        assert_shared_shell(self, self._render(), active="Topics")

    def test_has_breadcrumb_and_title(self):
        html = self._render()
        self.assertIn('class="crumbs"', html)
        self.assertIn('<h1 class="page-title">Neuro imaging', html)

    def test_uses_topic_grid_class(self):
        html = self._render()
        self.assertIn('class="topic-grid"', html)

    def test_uses_topic_card_class(self):
        html = self._render()
        self.assertIn('class="topic-card"', html)

    def test_topic_links_open_the_topic_page(self):
        html = self._render(cards=[self._make_card(topic="Low Back Pain")])
        self.assertIn('href="/topics/low-back-pain/"', html)

    def test_no_consensus_claims(self):
        html = self._render()
        self.assertNotIn("consensus", html.lower())
        self.assertNotIn("%</span>", html)

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

    def test_has_one_call_to_action(self):
        html = self._render()
        self.assertEqual(html.count('class="page-cta"'), 1)


class TestRenderProtocol(unittest.TestCase):
    ROUTED = [
        {"id": "1", "name": "Headache, sudden onset", "topic": "Headache", "study": "MRI head without IV contrast"},
        {"id": "2", "name": "Headache, new, older patient", "topic": "Headache", "study": "MRI head without IV contrast"},
    ]

    def _make_protocol(self, region="neuro", sequences=None):
        return {
            "canonical_procedure": "MRI Brain W/O Contrast",
            "display_name": "BRAIN",
            "body_region": region,
            "indications": "General neurological evaluation.",
            "sequences": sequences or [
                {"sequence_name": "SAG T1", "sort_order": 1, "is_post_contrast": 0},
                {"sequence_name": "AX T2", "sort_order": 2, "is_post_contrast": 0},
            ],
            # Old precomputed list: often wrong (hand pain on the hip arthrogram
            # page), so pages must not show it.
            "scenario_matches": [{"scenario_name": "Hand pain, chronic, initial imaging", "relevance_score": 0.9}],
        }

    def _render(self, region="neuro", sequences=None, routed=None):
        return render_protocol(self._make_protocol(region, sequences), "mri-brain-wo-contrast",
                               self.ROUTED if routed is None else routed)

    def test_uses_shared_shell(self):
        assert_shared_shell(self, self._render())

    def test_uses_breadcrumb(self):
        self.assertIn('class="crumbs"', self._render())

    def test_breadcrumb_includes_region_link_for_known_region(self):
        html = self._render(region="neuro")
        self.assertIn('href="/regions/neuro/"', html)

    def test_breadcrumb_omits_region_link_for_unknown_region(self):
        html = self._render(region="neck")
        self.assertNotIn('href="/regions/neck/"', html)

    def test_says_it_is_an_mri_protocol(self):
        self.assertIn('class="page-kicker">MRI protocol, Neuro', self._render())

    def test_uses_sequence_table_class(self):
        html = self._render()
        self.assertIn('class="sequence-table"', html)

    def test_sequences_rendered_as_table_rows(self):
        html = self._render()
        self.assertIn("<tr>", html)
        self.assertIn("SAG T1", html)
        self.assertIn("Pre-contrast", html)

    def test_routed_topics_link_to_topic_pages(self):
        html = self._render()
        self.assertIn('href="/topics/headache/"', html)
        self.assertIn("2 scenarios where ACR rates this MRI usually appropriate", html)

    def test_old_precomputed_matches_not_shown(self):
        self.assertNotIn("Hand pain", self._render())

    def test_no_topic_section_without_routed_scenarios(self):
        self.assertNotIn("Where ACR recommends this study", self._render(routed=[]))

    def test_has_one_call_to_action(self):
        self.assertEqual(self._render().count('class="page-cta"'), 1)

    def test_no_old_inline_table_styles(self):
        html = self._render()
        self.assertNotIn("border-collapse:collapse", html)


class TestRenderAbout(unittest.TestCase):
    def test_uses_shared_shell(self):
        assert_shared_shell(self, render_about(), active="About")

    def test_key_stats_are_a_list(self):
        html = render_about()
        self.assertIn('class="page-list"', html)
        self.assertIn("<li>3,900+ clinical scenarios across 260+ topics</li>", html)

    def test_region_links_use_protocol_list_item(self):
        html = render_about()
        self.assertIn('class="protocol-list-item"', html)
        self.assertIn('href="/regions/neuro/"', html)
        self.assertIn('href="/regions/peds/"', html)

    def test_sections_use_shared_headings(self):
        html = render_about()
        for heading in ["Built by", "Data sources and methodology", "Important notice", "Contact"]:
            self.assertIn(f'class="page-section-title">{heading}<', html)

    def test_all_8_regions_linked(self):
        html = render_about()
        from generate_static_pages import REGION_DISPLAY
        for region in REGION_DISPLAY:
            self.assertIn(f'href="/regions/{region}/"', html)


class TestOtherPages(unittest.TestCase):
    def test_privacy_page_uses_shared_shell(self):
        html = render_privacy()
        assert_shared_shell(self, html)
        self.assertIn('class="page-callout"', html)
        self.assertIn("6. Age restrictions", html)

    def test_privacy_page_claims_no_collection(self):
        # The site collects nothing and certifies no compliance (owner, November 2026).
        html = render_privacy()
        self.assertIn("We do not collect your information.", html)
        self.assertNotIn("HIPAA", html)
        self.assertNotIn("search queries", html)
        self.assertNotIn("usage statistics", html)
        self.assertNotIn("Compliance with regulations", html)

    def test_not_found_uses_shared_shell(self):
        html = render_not_found()
        assert_shared_shell(self, html)
        self.assertIn('content="noindex, follow"', html)


if __name__ == "__main__":
    unittest.main()
