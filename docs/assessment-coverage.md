# Assessment and grading coverage

This matrix describes what the app currently implements and what still requires institution service work. It is a product/acceptance boundary, not a standards-conformance claim.

## Implemented and contract-tested

| Area | Current behavior | Production authority |
| --- | --- | --- |
| Authoring | Multiple choice (single/multiple answer), text, timed text, scale/spectrum, file upload, custom-code response capture, page breaks, per-question points/penalties, binary marking, and point rubrics | Client validates the draft; the repository accepts or rejects one acknowledged save |
| Structure | Stable question IDs, empty-answer/option rejection, page validation, configurable questions per page, revisit policy, availability/due dates, and unpublished new drafts | Institution content repository and mutation revisions |
| Attempts | Draft resume, attempts 1–100, immutable submitted attempts, revision compare-and-swap, first-view timing bind, and explicit close waiting for draft persistence | Server creates/resumes attempts and enforces counts, deadlines, lateness, and accommodations using server time |
| Responses | Text, selections, numeric scale values, uploaded attachment metadata, and captured source code; every submitted attempt contains one response for every answerable question | Server authorizes ownership/group membership, validates attachments, and grades authoritative raw answers |
| Auto-grading | Exact/contains text matching, single/multiple-choice matching, penalties, decimal scores, unanswered handling, and normalized totals | Server must repeat grading; client scoring is preview/defense-in-depth only |
| Manual grading | Per-response feedback, rubric scores, correct/incorrect marking, overall feedback, global-score external columns, draft grade versus explicit release, grader/timestamp audit, pinned form revisions, stale multi-grader refusal, and meaningful grade revisions | Server verifies grader identity, score bounds, release policy, and compare-and-swap revision |
| Group work | First-class group sets, one group owner per group attempt, group-grade rows, and cross-reference validation | Server freezes/records authoritative membership for the attempt; current-membership lookup alone is insufficient after add/drop |
| Live quiz/poll | Host reveal/lock flow, absolute per-question timers, authenticated participant answers, results, atomic finalization into complete submissions, and idempotent archive retries | Injected realtime/live-session service with durable compare-and-swap state and server deadlines |
| External grades | Atomic grade-column plus placeholder creation for every learner/group, optional rubric, external HTTPS reference, and validated global maximum | Institution gradebook repository and any SIS/LMS passback connector |
| Recovery/audit | Recoverable discarded submissions, explicit deletion timestamps, immutable learner-submitted evidence, grade revision audit fields, and released-grade filtering | Institution retention, legal hold, audit export, and permanent deletion jobs |

Learner-scoped JSON must omit answer keys, private code test cases, unreleased scores, staff feedback, rubric scores, grader identity, and grading timestamps. Staff-authoring projections may include answer keys/test cases only when the authenticated scope permits them.

## Required launch work outside the client

Priority 0 for an institution pilot:

- Authoritative attempt-start/resume endpoint with server time, atomic limit enforcement, late policy, per-user overrides, group ownership snapshots, and idempotency.
- Server-side grading and grade-release policy; never trust client-computed correctness, score, timer, lateness, role, or grader fields.
- Malware/DLP scanning, content-type inspection, quotas, signed-URL renewal, retention, and orphan cleanup for assessment files and feedback files.
- A resource-limited isolated execution service before enabling custom-code grading. The app captures code and keeps test cases private but deliberately executes neither.
- Gradebook/SIS reconciliation with compare-and-swap conflicts, passback retry/idempotency, audit records, and explicit handling for missing, incomplete, excused, and overridden work.
- Accessibility certification for keyboard/switch/screen-reader use, focus order, math content, time-limit warnings, and accommodations.

Priority 1 enterprise assessment features:

- question banks, pools, random selection, variants, and QTI import/export;
- accommodations and per-user/group attempt, due-date, and time overrides;
- numeric/formula, matching, ordering, hotspot, accessible math, and recorded audio/video responses;
- anonymous, double-blind, moderated, and second-marker grading plus grade-change approval;
- plagiarism/originality and academic-integrity case workflows;
- file annotation, feedback attachments, inline document review, and bulk grading;
- outcomes/competencies, mastery rules, item analysis, distractor statistics, reliability, and psychometrics;
- grading schemes, drops, extra credit, curves, weighted subgroups, final-grade calculation/export, and formal grade appeal workflows.

Priority 2 interoperability/product expansion:

- LTI 1.3/Advantage deep linking, assignment and grade services, OneRoster results, Caliper events, and provider-certified passback;
- proctoring only after a privacy/accessibility policy review;
- offline assessment policy, reconnect recovery, resumable uploads, and conflict UX;
- localization of authoring, learner delivery, feedback, rubrics, date/time language, and audit exports.

## Minimum acceptance suite per institution

1. Exercise teacher, TA, administrator, IT, individual learner, and group learner scopes; verify every forbidden read/write fails at the server.
2. Race two devices on draft saves, attempt creation, submission, grading, release, restore, and live-host transitions; one authoritative revision must win without partial state.
3. Test lost acknowledgements and retries for attempt creation, submission, external-column creation, grading, passback, live finalization, and file upload.
4. Test DST boundaries, server/client clock skew, expired sessions, late joins, deadline crossing during upload, accommodations, and maximum attempts.
5. Test empty, maximum-size, malformed, duplicate-ID, unsupported, over-broad, and cross-tenant payloads; every failure must be atomic and observable.
6. Validate learner projections contain no answer keys, private tests, other learners' submissions, or unreleased grading data.
7. Run keyboard, screen-reader, zoom/reflow, reduced-motion, contrast, and timed-interaction accommodation testing on every question type and grading flow.
8. Reconcile a full grade round trip against the target SIS/LMS, including conflict, outage, retry, withdrawal, reinstatement, and term rollover.

The builder and grader are useful for the implemented common workflows, but they are not yet a complete enterprise assessment platform until the launch work and institution-selected feature gaps above are delivered and certified.
