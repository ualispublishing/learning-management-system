# Content, asset, and IP provenance

Last engineering review: 2026-10-01

This inventory supports release review; it is not a copyright, trademark,
patent, or freedom-to-operate legal opinion.

## Product-owned demo content

- The bundled LMS fixtures use the fictional course name “Foundations of
  Programming” and original demo copy.
- Generic demo outbound links use the IANA-reserved `example.com` domain and
  remain placeholders unless they are listed in the showcase exception below.
- Course-authored static widgets are original examples and execute without
  JavaScript, forms, network requests, or popups in a sandboxed frame.

## Learn showcase collection

The non-production Learn seed creates four small, principal-scoped example
decks. The Statistics, Scientific Reasoning, and Learn Workflow decks contain
original explanatory copy written for this product demo. The Programming
Concept Ladder is connected to the existing “Foundations of Programming”
fixtures through deck metadata and matching lecture links.

- Programming lecture links point to official MIT OpenCourseWare pages for
  *Introduction to Computer Science and Programming in Python*. The optional
  remote video page points to the low-bandwidth copy linked by the official
  lecture page. MIT OpenCourseWare identifies this material as CC BY-NC-SA
  4.0. It is not bundled or preloaded, playback requires an explicit remote
  host approval, and the card includes a text alternative linking to the
  official page with captions and transcript. Because of the non-commercial
  restriction, replace or separately license this material before a commercial
  release.
- Supplemental Python language links point to the official Python tutorial.
  The Python documentation is distributed under the Python Software Foundation
  License Version 2. The showcase links to those pages rather than copying
  their text.
- Each seeded card records its fixture key and provenance in note fields; each
  seeded deck records its fixture version, content origin, and any source URLs
  in deck settings. The seed is idempotent per active flashcard principal.

Remote availability, CORS/range support, media codecs, and browser privacy
settings remain outside the app's control. The text path must remain usable if
optional media playback is unavailable.

## Generated asset

| Asset | Created | Method | Intended use |
| --- | --- | --- | --- |
| `assets/images/math_banner_original.jpg` | 2026-08-12 | OpenAI image generation from an original prompt written for this project; no reference image was supplied; resized and JPEG-compressed locally from the retained generation master | Crop-safe generic mathematics deck banner |
| `assets/brand/lms-app-icon-master.png` | 2026-08-20 | OpenAI image generation from an original project prompt with no reference image; the selected square artwork was resized locally for the app icon and favicon | Brand-neutral LMS application icon |
| `assets/brand/lms-app-mark-master.png` | 2026-08-20 | OpenAI edit of the project-generated icon to remove the background and preserve a transparent alpha channel; no external reference image was used | Android adaptive foreground and splash mark |
| `institution-logo.png` | 2026-10-01 | Copy of the existing `lms-app-icon-master.png` above; no new artwork | Default input for replaceable institution branding |
| `institution-primary.png`, `institution-secondary.png` | 2026-10-01 | Original solid navy/blue colour swatches, created programmatically | Default palette inputs |
| `assets/brand/institution-*.png` | 2026-10-01 | Deterministic resizing, containment and neutral padding of `institution-logo.png` by `scripts/sync-branding.mjs` | Shared in-app logo, favicon, native icons and splash |

Generation constraints explicitly prohibited logos, school names, brand
marks, copied diagrams, characters, trademarks, and watermarks. The prompt
requested only generic mathematical notation in an original abstract
composition. Retain the generation record with the release evidence.

The app-mark prompt likewise prohibited text, school seals, existing brands,
characters, copied logos, and watermarks. It requested an abstract combination
of stacked study cards, a conversation bubble, and three ascending learning
steps. The derived PNGs were resized from the retained masters without adding
new artwork. Institution-specific names and branding still require a separate
owner-approved release review.

The prior `assets/images/math_banner.jpg` is no longer referenced. Its origin
is not documented, so it must not be shipped unless provenance and permission
are supplied. It remains in the working tree only to avoid destructively
deleting a user-owned file during this review.

## Application and platform assets

The configured app icon, adaptive foreground, favicon, and splash derive from
the replaceable root `institution-logo.png`, whose current default is the
project-generated master recorded above. When replacing it, record the
institution's permission and source alongside the release evidence. The
[branding guide](./institution-branding.md) describes the generation workflow.
The earlier Expo-template graphics
remain unreferenced source files and are not part of the configured release
identity. Bundled fonts, icon fonts, WASM, and all dependency artifacts still
require a release-owner license check. Before distribution:

The exact-lockfile engineering inventory currently contains 518 runtime
components. Its generated
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) uses bundled text plus
digest-pinned exact official sources; 15 package versions still require the
release-owner disposition documented in
[`third-party-license-review.md`](./third-party-license-review.md). This does
not constitute legal approval or artifact-level completeness.

1. Regenerate the checked CycloneDX SBOM and notices after the final install,
   then scan exported web and native artifacts for files outside npm's graph.
2. Resolve the remaining notice gaps and ship approved third-party notices,
   including font/data attribution and all file-level copyleft obligations.
3. Run a current vulnerability/license policy scan in CI; an offline audit is not current evidence.
4. Record creator, source, license, and approved uses for every product image and educational-content fixture.
5. Provide a rights-attestation and takedown workflow for teacher/student uploads, AI sources, links, and generated material.

## Patent marking

The unsupported “Patent Pending” UI and locale strings were removed during
this review. Do not restore any patent marking unless counsel confirms that an
active application covers the marked feature and that the exact wording and
territories are appropriate. Source review cannot establish patentability or
freedom to operate.

## AI content safeguards required for production

- Show institution-specific vendor, retention, training-use, data-residency,
  privacy, and copyright disclosures before any syllabus or course material is
  uploaded.
- Require the uploader to attest that they are permitted to process the source.
- Preserve source digest, excerpt evidence, model/prompt version, human edits,
  reviewer identity, approval timestamp, and publication history.
- Keep generated modules, calendar entries, summaries, quizzes, and flashcards
  as drafts until a teacher explicitly reviews and publishes them.
