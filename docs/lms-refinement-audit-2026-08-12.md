# LMS refinement and integration audit

Review date: 2026-08-12

> Historical baseline. The current capability closeout, verification counts,
> and production gates are in the
> [2026-08-20 release closeout](./release-closeout-2026-08-20.md).

This is an engineering review of the Courses/Admin, Chat, and Flashcards/Learn
surfaces. It is not a legal opinion, an accessibility certification, or an
institution-deployment approval.

## Outcome of this pass

### Courses/Admin ↔ Chat

- Course announcement messages now carry a stable announcement ID plus bounded
  title, severity, and linked-content provenance.
- Admin publishing chooses a deterministic course announcement thread instead
  of the first matching thread or a hard-coded ID.
- The learner announcement popup reads both legacy course announcements and
  authorized announcement-thread messages, subscribes to new messages, sorts
  newest first, and deduplicates migration/retry copies.
- “View” opens and highlights the exact announcement message in Chat.
- Every bundled demo course has a valid announcement thread.

Remaining service milestone: admin content and chat are separate repositories.
Creating an admin announcement persists content first and reports a visible
chat-delivery failure, but it is not a distributed atomic transaction. Admin
edits correct the stable linked chat message, chat tombstones withdraw its
legacy popup, deleted/type-converted content is suppressed, and retries reuse a
stable message ID. A chat-originated announcement still does not materialize a
first-class admin content record. Production should use one canonical
Announcement entity, an idempotent durable outbox, server-side edit/delete
tombstones, and reconciliation health.

### Course presentation

- Timeline, sequential, and custom modes use deterministic explicit ordering.
- Orphaned sequential content appears in an “Ungrouped content” recovery bucket
  instead of disappearing from the learner view.
- Custom mode supports vertical and horizontal learner presentation; each
  custom widget is a page when horizontal presentation is selected.
- Horizontal mode is web/desktop-only. Narrow web and native views are forced
  to a fluid full-screen vertical layout, and teacher controls are shown only
  when they affect the student preview.
- A compact desktop drag handle continuously resizes the canvas from 768–1280
  px, clamps to the available viewport, persists the chosen width, supports
  keyboard/screen-reader adjustment, and is absent on mobile.
- Linked HTTPS course sites can fill the course canvas in a sandboxed iframe
  with internal scrolling, reload, and “Open separately” fallback. Same-origin
  self-embedding is blocked. Native opens the site full-screen in the device
  browser. Institutions must enforce a provider allow-list; CSP and
  `X-Frame-Options` may prevent embedding.
- Institution-owned video assets render in an accessible inline player. Generic
  arbitrary URLs remain HTTPS external links rather than trusted media.
- Static HTML/CSS is script-, form-, frame-, navigation-, and network-blocked.
  Long web panels scroll internally, and native exposes a bounded accessible
  text fallback rather than hiding the content.
- Custom widgets have accessible move-earlier/move-later ordering controls.

### Identity and roster roles

- The global greeting uses the authenticated principal display name, not the
  first matching course membership.
- Course managers can assign Student, TA, or Teacher through an accessible role
  dialog. IT/admin memberships are preserved for privileged actors rather than
  silently downgraded by instructional staff.
- Both UI and institution repository guard against the only remaining course
  manager demoting themself. Saves expose pending and failure states.

Promotions now preserve role-at-send on historical messages and existing
submissions, remove incompatible active assignment-group membership, and
reconcile private group-chat access. New and realtime messages are checked
against the current directory/course identity. The remaining schema milestone
is effective-dated enrollment and role history for withdrawal, re-enrollment,
completion, and historical groups; those events must not orphan prior academic
records.

### Accessibility and privacy

- Horizontal pages outside the current viewport are removed from the assistive
  technology tree; page changes have a polite announcement and pager controls
  have 44 px targets.
- Course paging and timeline auto-scroll honor reduced-motion settings.
- Key modal/error/loading/sign-in controls gained roles, state, live-region
  feedback, labels, and larger action targets. Custom-mode secondary text and
  selected-tab/button text use higher-contrast pairs.
- Emoji navigation icons and always-on fake notification dots were replaced by
  platform icons and actual course/chat update state.
- The unused “Share analytics with teacher” toggle was retired. No study
  analytics transmission exists, and the legacy device setting is erased.
- Native orientation is not locked to portrait; phones and tablets may reflow
  in either orientation while retaining the fluid vertical course layout.

Automated source review is not WCAG conformance. Keyboard-only, zoom/reflow,
screen-reader, switch-control, voice-control, contrast, captions/transcripts,
and real-device testing remain release acceptance work. Teacher-authored static
HTML also needs a publish-time accessibility linter and an accessible-alternative
workflow before an institution can claim authored-content conformance.

### AI syllabus and course material

- Syllabus input supports PDF, DOCX, PPTX, TXT, Markdown, and RTF.
- One inferred source kind is validated and sent to the AI transport, avoiding a
  validation/request mismatch.
- Existing prompt-injection isolation, evidence requirements, source digests,
  request binding, bounded uploads/responses, human review, explicit apply, and
  provenance retention remain enforced.
- Reviewed title, description, dates, grading weights, instructors, materials,
  schedule, policies, warnings, evidence, and source asset are retained.

Remaining product milestone: schedule/material/policy output is reviewed course
metadata, not publishable draft modules or calendar entries. Add duplicate-aware
draft generation with a separate teacher publish step. Production upload also
needs institution-configured vendor, retention, training-use, residency,
copyright/permission, and deletion disclosures.

### Content and dependency rights

- Bundled MIT/OCW-named demo fixtures and links were replaced with fictional
  original course copy and IANA-reserved example domains.
- The unknown-provenance banner is no longer referenced. A new original banner
  was generated without reference imagery, brands, logos, characters, copied
  diagrams, or watermarks, and its generation provenance is documented.
- A lockfile license inventory identifies 960 third-party packages and flags MPL-2.0, OFL,
  CC-BY, dual-license, Unicode, Python, and other notice obligations. A checked-in
  CycloneDX 1.5 runtime SBOM records 552 components.
- Database/WAL/SHM files are ignored to reduce accidental learner-data commits.

The application necessarily uses copyrighted open-source code, fonts, icons,
and WASM under licenses; “no copyrighted material” is not a viable software
standard. The release standard is documented permission/license compliance.
Generate and ship exact third-party notices, regenerate the SBOM from the exact
release artifact, scan the built artifacts, and obtain release-owner approval.
Source review cannot prove freedom to operate. The unsupported “Patent Pending”
UI and locale copy were removed; do not restore patent marking without counsel.

## Verification

- `npm run check`: passed (lint, strict TypeScript, four fixture validations,
  and 256/256 automated tests).
- Loaded-library test coverage: 77.80% lines, 75.76% branches, and 87.89%
  functions. Rendered UI and native SQLite execution are not represented by
  those percentages.
- Web export passed: 2,176 modules; 29 files; 7,244,580 raw bytes; main
  JavaScript bundle 4,847,235 bytes.
- iOS export passed: 2,526 modules, 28 assets, 6.8 MB Hermes bundle.
- Android export passed: 2,605 modules, 32 assets, 7.0 MB Hermes bundle.
- A current registry audit was run. Non-breaking patches removed the
  `brace-expansion`, `js-yaml`, `nanoid`, `postcss`, and `shell-quote`
  findings. Fourteen reported dependency-chain findings remain, all tracing to
  two `image-size` build-time denial-of-service advisories for which the current
  Expo/Metro line has no compatible fix. The suggested forced downgrade was not
  applied; see `dependency-security-review.md`.
- `git diff --check`: passed.

The exported production fail-closed configuration screen rendered. Interactive
localhost development control was denied by the in-app Browser's saved policy,
which also prohibited hostname or browser workarounds. The production bundles
and automated gates are green, but the five-role visual/keyboard/device replay
in `full-role-qa-2026-08-12.md` is still required.

## Highest-priority remaining LMS milestones

1. Real tenant backend, SSO/token lifecycle, server-side RBAC, durable realtime,
   object storage scanning/DLP, audit export, backup/restore, and observability.
2. Effective-dated enrollment lifecycle, withdrawal/completion, accommodations,
   per-learner time/attempt overrides, and missing/excused/incomplete gradebook
   semantics.
3. Draft/publish/content version history, global calendar/digests, moderation
   queue plus block/mute/appeal, and announcement outbox/reconciliation.
4. Question banks/QTI, then LTI 1.3 Advantage and OneRoster certification;
   SCORM/xAPI/Caliper according to target-institution demand.
5. Institution-governed AI privacy/rights controls and reviewed draft
   module/calendar generation.

See also `production-readiness-audit.md`, `architecture-compatibility.md`,
`assessment-coverage.md`, `content-and-ip-provenance.md`, and
`third-party-license-review.md`.
