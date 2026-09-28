# Release closeout — updated 2026-08-29

## Decision

The repository is a **green, repo-local release candidate**, not a certified or
deployable production system. The automated checks and platform exports listed
below passed, and the requested Courses/Admin, Chat, and Flashcards/Learn
connections are implemented. Production approval remains blocked by complete
rendered five-role acceptance, physical-device and assistive-technology testing, a real
institution backend and SSO, deployment configuration, and security/privacy/
legal sign-off that cannot be completed from this repository alone.

This document supersedes the verification counts in the 2026-08-12 audit
records. It is an engineering closeout, not an accessibility certification,
penetration test, legal opinion, patent freedom-to-operate opinion, or guarantee
that every possible user sequence has been exercised.

## Repo-local capability closeout

- **Courses/Admin ↔ Chat:** staff announcements use the authorized course
  announcement topic, stable IDs, exact-message links, bounded retrieval,
  subscription updates, retry deduplication, edit reconciliation, and
  tombstones. Reverse reconciliation is monotonic and verifies the current
  source permission before writing linked content. Restoring a withdrawn item
  produces ordinary inactive content; republishing requires a new canonical
  announcement identity. The course-admin activity panel exposes authorized
  announcement activity whether it originated from the admin publishing flow
  or Chat and links to the exact Chat message. This provides bidirectional
  visibility, but two client repositories are not a distributed transaction;
  true exactly-once publication still requires the canonical server entity and
  durable outbox described below.
- **Chat:** course forums, Q&A, announcements, study groups, office hours,
  assignment-group topics, and one-to-one conversations enforce participant,
  lifecycle, post/reply/attachment/mention, moderation, history, search, and
  realtime-merge boundaries at the client contract. The server remains the
  authorization and retention authority.
- **Course presentation:** timeline, sequential, custom static HTML/CSS, and
  linked-site modes share availability and ordering rules. Desktop web supports
  vertical or horizontal learner presentation and a compact, continuously
  draggable 768–1280 px canvas-width grip with keyboard/screen-reader controls.
  Narrow web and native layouts remain fluid/full-width and omit that desktop
  control. Linked HTTPS sites use a restricted full-canvas, internally
  scrollable iframe with reload/open-separately fallback; provider CSP or
  `X-Frame-Options` can still require the fallback.
- **Roles and identity:** Student, TA, Teacher, IT, and Administrator course
  boundaries are centralized and repository-checked. Authorized course
  managers can assign Student, TA, or Teacher while privileged-role and
  last-manager guards prevent unsafe demotion. Greetings and audit identities
  use the authenticated principal rather than an arbitrary enrollment. Learner
  directory projections retain only the minimum contact identity needed for
  shared-course/existing-direct-message discovery; email and enrollment detail
  remain restricted to authorized roster viewers.
- **Flashcards and learning:** principal-scoped decks, study-card handoff from
  course content, media study, AI generation with bounded inputs and grounded
  evidence, reviewer approval, FSRS scheduling, atomic review history, CSV
  import/export, and responsive/native behavior are implemented. AI processing
  cannot start before explicit source-rights acknowledgement; duplicate starts
  and stale retries are guarded, and publication retains the attestation and
  timestamp. Legacy `expo-av` use was removed in favor of SDK-compatible
  `expo-audio` and `expo-video`.
- **AI course setup:** syllabus analysis remains draft/review/apply rather than
  silent publication. Source permission acknowledgement is required before AI
  transmission; retained metadata includes source/prompt/request evidence,
  reviewer edits, approval, and the rights-attestation timestamp. Institution-
  specific vendor, residency, retention, training-use, and deletion terms are
  still required at deployment.
- **Accessibility and defensive controls:** semantic roles/states, live-region
  feedback, focusable 44 px actions, inactive-page hiding, reduced motion,
  contrast fixes, accessible reordering, responsive reflow, media alternatives,
  fail-closed remote content, upload validation, principal/session guards, and
  redacted production diagnostics are covered by source and automated checks.
  These controls do not replace testing by disabled users with real assistive
  technology.
- **Executable interaction acceptance:** source parsing verifies every active
  JSX action contract across 487 pointer controls, 41 modals, 23 switches, and
  three keyboard-submit paths. Headless journeys invoke the same Zustand
  actions, authorization policy, repositories, reconciliation, and navigation
  builders used by the rendered controls. They cover all five course roles;
  course/content/roster/presentation actions; Chat topics, posts, replies,
  direct messages, moderation, and exact announcement navigation;
  Admin-to-Chat and Chat-to-Admin create/edit/withdraw/retry behavior; and the
  flashcard library/import/export/study/note/audio/principal-isolation flow.
  This pass fixed a quiz-reveal bypass, same-frame duplicate import/export
  starts, and missing disabled/busy accessibility state on asynchronous
  controls. It is behavioral evidence, not pixel, screen-reader, or device
  evidence.
- **Repeated synthetic journey telemetry:** a test-only isolated runner now
  replays the five role boundaries plus Courses/presentation, Admin↔Chat,
  Flashcards, navigation, and AI consent/review flows through production
  handlers and repositories. Ordered coverage contracts reject partial or
  out-of-order journeys; redacted events report completion, denial accuracy,
  transport counts, rollback/idempotency/convergence checks, and repeated
  p50/p95 latency. The 30-repetition run completed 270/270 journey instances and
  1,620/1,620 steps, including 270 expected denials, 30 injected failure/retry
  recoveries, and 90 duplicate/stale no-ops, with zero system errors. These are
  local handler/repository timings, not rendered or human-performance results;
  see [synthetic journey testing](./synthetic-journey-testing.md).
- **Release configuration:** production identifiers and store build versions
  are environment-owned and validated; placeholder/missing values fail closed.
  iOS ATS/file protection/privacy declarations, Android cleartext/backup/
  permission restrictions, provider-neutral web security headers, deterministic
  notices/SBOM checks, and a pinned CI release workflow are present.

## Latest verification evidence

| Check | Result on 2026-08-29 | Boundary |
| --- | --- | --- |
| Repository release gates and final automated suite | Passed: ESLint, strict TypeScript, four fixture validations, security/configured-asset validation, notice freshness, dependency alignment/tree validation, SBOM freshness, web export verification, **354/354 automated tests**, and **1,620/1,620 ordered synthetic journey steps** | Source, contract, repository, schema, role/lifecycle/presentation matrices, and executable UI-handler logic; not complete rendered human acceptance |
| Executed source coverage | Passed: **82.63% lines**, **76.90% branches**, **90.62% functions** across the instrumented TypeScript/JavaScript modules | Native SQLite/device paths and much rendered UI still require platform/human testing |
| Expo SDK/native configuration | Current live `expo-doctor` **21/21 checks passed** | This is compatibility/config validation, not a signed build or store review |
| Web production export | Passed: **2,191 modules**, **29 files**, **7,323,475 bytes** total; main JavaScript **4,926,130 bytes** | Hosting headers and institution bootstrap are external |
| iOS production export | Passed: **2,544 modules** | Export is not a signed store build or physical-device result |
| Android production export | Passed: **2,628 modules** | Export is not a signed store build or physical-device result |
| `npm run audit:release` against the live registry | Passed the release policy with **4 affected package entries** and only the two allowlisted, documented build-time `image-size` advisories below | Registry availability and allowlist freshness remain live release requirements |
| CycloneDX/runtime notices | Deterministic SBOM passed freshness checks with **544 runtime components**; 49 gaps use digest-pinned exact official sources and one bundled `UNLICENSE` is recognized | **16 package versions remain without bundled or pinned official text** and require publisher evidence or a counsel-approved disposition; source integrity is not legal approval |

The remaining dependency roots are `GHSA-w3rx-r6r6-pgpr` and
`GHSA-5p2g-fcmc-qvqq` in transitive `image-size@1.2.1`, used by Metro for
developer-controlled build assets. The current Expo/Metro line has no
compatible fixed version; npm's proposed forced fix is an incompatible Expo 53
downgrade. CI fails on registry failure, any critical, an unresolved root, or
any new advisory, and permits only these two documented roots. Release owners
must keep untrusted ICNS/JXL/HEIF out of source/CI inputs, constrain build
workers, track the upstream fix, and explicitly accept or defer this residual
risk. See [the dependency review](./dependency-security-review.md).

## Open production gates

All of the following must be closed or explicitly accepted by the accountable
institution before launch:

1. **Rendered and device acceptance.** The exported production fail-closed
   bundles were generated and inspected by build validators. The manually
   opened in-app Browser rendered the initial responsive LMS screen, but Codex
   Browser automation rejected DOM interaction on that same localhost tab, so
   complete rendered role journeys could not be recorded. Executable handler,
   repository, authorization, persistence, and navigation contracts now cover
   the role journeys without claiming visual acceptance. Replay Student, TA,
   Teacher, IT, and Administrator journeys at desktop,
   narrow/mobile, 400% zoom, keyboard-only, forced-colors/high-contrast, and
   screen-reader settings. Complete physical iOS/Android VoiceOver/TalkBack,
   switch/voice control, orientation, notification, recording, interruption,
   sharing, fullscreen video, captions/transcripts, and embedded-provider tests.
2. **Institution backend and identity.** Supply real SSO/token lifecycle,
   tenant- and principal-scoped gateway projections, server-side RBAC/ABAC,
   revision/ETag compare-and-swap, durable idempotency, authoritative attempt/
   grading rules, authenticated realtime chat/live sessions, rate limiting,
   audit retention, and cross-device reconnect/replay tests. Admin content and
   Chat announcements need one canonical server entity, a durable outbox,
   reconciliation, and server tombstones for atomic delivery semantics.
3. **Files, embeds, and AI services.** Provide authenticated object storage with
   signature/MIME verification, malware scanning, DLP/CDR where applicable,
   encryption, quotas, signed URLs, retention/legal hold, and orphan cleanup.
   Enforce an institution embed allowlist plus DNS/private-network defenses.
   Contract an approved AI service with isolated extraction/OCR, server-owned
   prompts/schemas, source attestations, cost/rate controls, evaluation data,
   no-training/residency/deletion terms, and human escalation.
4. **Deployment operations.** Set institution-owned bundle/package IDs and
   incremented build numbers; provision Apple/Google signing, SSO callback and
   app-link domains, notification credentials, support/privacy URLs, and final
   branding. Install and test the supplied CDN/origin security headers, HTTPS,
   CSP/frame/connect allowlists, route rewrites, cache policy, WAF, monitoring,
   incident response, backup/restore, disaster recovery, and load/soak limits.
5. **Security, privacy, and accessibility assurance.** Run independent tenant-
   isolation and authorization penetration testing, mobile secure-token/cache
   review, privacy threat modeling and data-flow verification, final artifact
   malware/dependency/SBOM scanning, accessibility conformance testing, and
   institution policy review for FERPA/PIPEDA/GDPR, records retention,
   accommodations, academic integrity, and grading. Reconcile actual deployed
   data flows with App Store/Play privacy declarations.
6. **Copyright, licenses, and patents.** Software necessarily distributes
   copyrighted open-source code, fonts, icons, and data under licenses; the
   correct release standard is license compliance, not “no copyrighted
   material.” Resolve or obtain a documented counsel-approved disposition for
   the 16 remaining notice gaps, validate every pinned publisher/release
   binding, scan final artifacts, approve the exact notices/SBOM/assets and uploader takedown workflow, and
   obtain release-owner/counsel approval. The unsupported “Patent Pending” mark
   has been removed, but source review cannot establish patent freedom to
   operate. Institution branding/content also requires trademark and rights
   review.

## Product-scope decisions before an institution pilot

The current app covers a substantial LMS pilot, but it must not be marketed as
feature-equivalent to every enterprise LMS unless the buyer explicitly accepts
the remaining scope. Prioritize effective-dated enrollment/withdrawal history,
per-learner accommodations and time/attempt overrides, complete gradebook states
(missing, excused, incomplete, override, weighted rules), draft/publish/version
approval, global calendar/digests, moderation queue/block/mute/appeal, and
shared/multi-device flashcard storage. Add QTI question banks and LTI 1.3/
OneRoster certification first where the target institution requires them;
SCORM/xAPI/Caliper and other interoperability should follow contracted need.

Detailed integration, deployment, assessment, dependency, licensing, and IP
evidence remains in:

- [Institution integration contract](./institution-integration.md)
- [Deployment security contract](../deployment/README.md)
- [Assessment coverage](./assessment-coverage.md)
- [Dependency security review](./dependency-security-review.md)
- [Third-party license review](./third-party-license-review.md)
- [Content and IP provenance](./content-and-ip-provenance.md)
- [Full-role QA record](./full-role-qa-2026-08-12.md)
- [Synthetic journey testing](./synthetic-journey-testing.md)
