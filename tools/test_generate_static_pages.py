import unittest
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from generate_static_pages import slugify, make_unique_slugs

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

if __name__ == "__main__":
    unittest.main()
