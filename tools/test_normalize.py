import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from generate_static_pages import normalize_procedure_name

def test_mri_expansion():
    assert normalize_procedure_name("MRI Brain W/O Contrast") == "MRI Brain Without Contrast"

def test_with_expansion():
    assert normalize_procedure_name("MRI Brain W/ Contrast") == "MRI Brain With Contrast"

def test_acronym_ct():
    assert normalize_procedure_name("CT Chest") == "CT Chest"

def test_lowercase_mri():
    assert normalize_procedure_name("mri brain") == "MRI Brain"

def test_mrcp():
    assert normalize_procedure_name("MRCP abdomen") == "MRCP Abdomen"

def test_mra():
    assert normalize_procedure_name("MRA Brain W/O Contrast") == "MRA Brain Without Contrast"

def test_flair():
    assert normalize_procedure_name("MRI Brain FLAIR") == "MRI Brain FLAIR"

def test_mixed_case_input():
    assert normalize_procedure_name("mri knee w/o contrast") == "MRI Knee Without Contrast"

def test_no_change_needed():
    assert normalize_procedure_name("MRI Shoulder") == "MRI Shoulder"

if __name__ == "__main__":
    passed = 0
    failed = 0
    tests = [
        test_mri_expansion, test_with_expansion, test_acronym_ct,
        test_lowercase_mri, test_mrcp, test_mra, test_flair,
        test_mixed_case_input, test_no_change_needed
    ]
    for t in tests:
        try:
            t()
            print(f"  PASS: {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"  FAIL: {t.__name__} - {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
