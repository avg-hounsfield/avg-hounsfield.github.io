import unittest
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from generate_static_pages import slugify

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

if __name__ == "__main__":
    unittest.main()
