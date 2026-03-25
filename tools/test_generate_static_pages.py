import unittest
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from generate_static_pages import slugify, make_unique_slugs, make_display_name, REGION_ICONS, CSS_VERSION

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

if __name__ == "__main__":
    unittest.main()
