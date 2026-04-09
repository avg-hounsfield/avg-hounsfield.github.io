# SEO: About Page E-E-A-T + Long-Tail Protocol Title Optimization

**Date:** 2026-04-08
**Goal:** Improve Google E-E-A-T signals on the about page and fix protocol page titles to match how radiology residents actually search.

---

## Context

Radex has near-zero impressions despite solid technical SEO. Root cause analysis identified two primary on-site gaps:

1. **E-E-A-T deficit** - Medical content with no named, credentialed author and no methodology transparency. Google's quality raters penalize anonymous YMYL content.
2. **Protocol page titles use malformed display names** - `make_display_name()` uses Python `.title()` which produces "Mri Brain W/O Contrast" instead of "MRI Brain Without Contrast". This mismatches the exact queries residents type.

These are both achievable in the repo. Backlink acquisition (the other major gap) requires external action outside this codebase.

---

## Change 1: About Page - E-E-A-T Sections

**File:** `about/index.html`

### 1a. New "Built By" section (insert after intro paragraph, before Key Statistics)

Named author block with credential and capstone-derived bio:

```
Patrick Matulich, DO
Radiology Resident | CoreGRAI

Radex was developed as a capstone project in radiology AI, motivated
by a recurring challenge in clinical training: imaging appropriateness
guidelines exist, but accessing them quickly at the point of care
remains cumbersome. Built on the ACR Appropriateness Criteria and
validated through systematic testing against 202 clinical queries,
Radex is designed to reduce time-to-answer from minutes to seconds
without sacrificing evidence fidelity.
```

Style: name in bold, role in `var(--text-muted)` using existing CSS classes. No new classes needed - reuse `.static-section-label` for the heading and existing text styles for the body.

### 1b. Expand "Data Sources" into "Data Sources & Methodology"

Keep the existing two paragraphs (Appropriateness Criteria source, MRI Protocols disclaimer). Add three new paragraphs below them:

**Consensus Algorithm:** Explains how 3,226 ACR scenarios are aggregated into 74 quick-answer topic cards - procedures scored by agreement percentage, topics classified as Strong Consensus (>=70%), Conditional (40-69%), High Variance (<40%), or Clinical First.

**Manual Validation:** All 74 topic cards were individually audited by a clinical domain expert prior to publication to identify and correct algorithmic errors (e.g., cases where frequency counting produced clinically incorrect primary recommendations).

**AI Methodology:** The search system uses a hybrid architecture: a 708 KB intent classifier (custom transformer, INT8-quantized for browser deployment) combined with rule-based patterns and a 375-term radiology semantic dictionary. Neither component alone provides sufficient clinical reliability; the hybrid approach achieves 82.2% phase accuracy and 86.6% urgency accuracy across 202 test queries.

### 1c. Update contact email

Change `contact@coregrai.com` to `support@coregrai.com` in the Contact section.

### 1d. Expand CoreGRAI blurb

Replace the single-line "GRAi is an AI-powered radiology clinical reference and decision support platform." with:

```
GRAi is an AI-powered radiology study and clinical reference platform
built for residents preparing for the ABR Core Exam. It provides
AI-assisted Q&A across radiology topics, RAG-based medical literature
search, differential diagnosis support, and structured lesson content -
all through a conversational interface. Built by Patrick Matulich, DO.
```

Link and styling unchanged - keep existing `<a href="https://coregrai.com">` wrapper.

### 1e. Update JSON-LD schema

Add a `Person` author node alongside the existing `Organization` node in the `@graph`:

```json
{
  "@type": "Person",
  "name": "Patrick Matulich",
  "honorificSuffix": "DO",
  "jobTitle": "Radiology Resident",
  "worksFor": {
    "@type": "Organization",
    "name": "CoreGRAI",
    "url": "https://coregrai.com"
  }
}
```

Also update the `WebApplication` node's `author` field to reference this Person rather than just the Organization.

---

## Change 2: Protocol Page Title Normalization

**File:** `tools/generate_static_pages.py`

**Problem:** `make_display_name()` calls `.title()` on canonical procedure strings, producing:
- "Mri Brain W/O Contrast" (should be "MRI Brain Without Contrast")
- "Ct Chest With Contrast" (should be "CT Chest With Contrast")
- "Mrcp" (should be "MRCP")

This means page titles like "Mri Brain W/O Contrast Protocol - Sequences & Indications | Radex" don't match queries like "MRI brain without contrast sequences."

**Fix:** Add a `normalize_procedure_name()` helper that runs before `.title()`:

1. Expand abbreviations before title-casing:
   - `W/O ` → `Without `
   - `W/ ` → `With `

2. After title-casing, fix medical acronyms to all-caps. Canonical list:
   - `Mri` → `MRI`
   - `Ct` → `CT`
   - `Mrcp` → `MRCP`
   - `Mra` → `MRA`
   - `Pet` → `PET`
   - `Us ` / `Us)` → `US ` / `US)` (ultrasound, careful with word boundary)
   - `Stir` → `STIR`
   - `Flair` → `FLAIR`
   - `Dwi` → `DWI`
   - `Swi` → `SWI`
   - `Dce` → `DCE`
   - `Dti` → `DTI`

3. Update `make_display_name()` to call `normalize_procedure_name()` on the result.

**Resulting title improvement example:**
- Before: `Mri Brain W/O Contrast Protocol - Sequences & Indications | Radex`
- After: `MRI Brain Without Contrast Protocol - Sequences & Indications | Radex`

### 2b. Add author to shared_head meta tag

Update line 169 in `shared_head()`:
```python
# Before
<meta name="author" content="CoreGRAI">
# After
<meta name="author" content="Patrick Matulich, DO - CoreGRAI">
```

### 2c. Add author to MedicalWebPage JSON-LD in protocol and region pages

In `render_protocol()` (line 255) and `render_region()` (line 378), add `author` field to the `jsonld` dict:

```python
"author": {
    "@type": "Person",
    "name": "Patrick Matulich",
    "honorificSuffix": "DO"
}
```

### 2d. Regenerate all static pages

After changes to the generator, run:
```bash
cd tools && python generate_static_pages.py
```

This regenerates all 80 static pages (72 protocols + 8 regions) with corrected titles and updated schema.

---

## Files Modified

| File | Change |
|------|--------|
| `about/index.html` | Add author section, expand methodology, update email, expand CoreGRAI blurb, update JSON-LD |
| `tools/generate_static_pages.py` | Add `normalize_procedure_name()`, update `make_display_name()`, update `shared_head()`, add author to JSON-LD |
| All files under `protocols/*/index.html` (72 files) | Regenerated via script |
| All files under `regions/*/index.html` (8 files) | Regenerated via script |

---

## Verification

1. Open `about/index.html` in a browser - verify author block appears between intro and Key Statistics, methodology section is readable, email is correct
2. Open `protocols/mri-brain-wo-contrast/index.html` - verify `<title>` reads "MRI Brain Without Contrast Protocol..." not "Mri Brain W/O Contrast..."
3. Check browser DevTools > Elements for JSON-LD on both about page and a protocol page - confirm Person schema is present
4. Validate JSON-LD at search.google.com/test/rich-results for one protocol page URL
5. Re-submit sitemap in Google Search Console after deployment
