# Full role and release QA record

Review date: 2026-08-12

> Historical baseline. The current decision, verification counts, and unchanged
> rendered/device acceptance gate are in the
> [2026-08-20 release closeout](./release-closeout-2026-08-20.md).

This record distinguishes automated scenario coverage from rendered manual
acceptance. It is an engineering test report, not a claim that an unbounded set
of “every possible” user action has been proven correct.

## What was exercised

The source was traced across routes, components, stores, schemas, demo and
institution repositories, transports, and realtime merge paths. ESLint and
strict TypeScript covered every active source file. Focused tests then exercised
the following journeys and failure boundaries:

- Courses/Admin ↔ Chat announcement creation, edit, retry, migration dedupe,
  popup election, exact-message navigation, withdrawal, and content conversion.
- Student, TA, Teacher, IT, and Administrator permission boundaries across
  course configuration, content, grading, live delivery, roster roles, forums,
  groups, direct messages, and analytics.
- Future, active, exact-close-boundary, ended, archived, and malformed course
  lifecycles; scheduled/current/past content; timeline, sequential, and custom
  presentation; vertical, horizontal, narrow-web, and native layout decisions.
- Missing/orphaned content, locked sequential modules, reordering, failed
  atomic batches, retries after ambiguous delivery, stale revisions, realtime
  rollback/resurrection attempts, account changes during fetches, and corrupt or
  unauthorized deep links.
- Flashcard principal isolation, serialized persistence, rollback after storage
  failure, review compare-and-swap, deck/card/note/layer/tag integrity, CSV
  bounds, media privacy, session bounds, reminders, keyboard behavior, and
  responsive accessibility helpers.
- Syllabus/AI input bounds, prompt/source evidence, request binding, retained
  provenance, human review, and explicit apply behavior.

The stress suite includes 75 role × lifecycle × presentation institution
content-write cases and 60 presentation × orientation × availability cases in
addition to focused repository, schema, route, chat, assessment, AI, and
flashcard tests.

## Role-played capability matrix

| Role | Expected and verified capability boundary |
| --- | --- |
| Student | Read eligible course content; study/save course cards; submit eligible attempts; use active permitted forums, own groups, and two-person direct messages; manage own messages. No admin, staff-posting, grading, moderation, roster, or role mutation. |
| TA | Student-facing preview plus instructional content, grading, live delivery, staff chat/topic creation/moderation, roster viewing, and grade analytics. No course configuration or role assignment. |
| Teacher | TA capabilities plus course configuration, presentation settings, and instructional role assignment, subject to the last-manager and privileged-role guards. |
| IT | Course configuration, roster access, and role management. No instructional content, learner attempt, grade, live-host, or staff-chat privilege merely because the user is IT. |
| Administrator | All course-scoped capabilities, with explicit course membership still required so tenant/session privilege does not silently become an unaudited course identity. |

Every bundled demo course includes all five roles so the same visible data can
be replayed without changing fixtures. The authenticated principal, not a
random course membership, drives the greeting and repository scope.

## Important adversarial cases

- Exact `termEnd` and topic `closesAt` instants are closed, not open for one
  extra tick. Future courses allow staff preparation but reject learner/live
  delivery; ended and archived courses are learner-read-only.
- Inactive horizontal panels leave the accessibility tree; mobile/narrow views
  force fluid vertical presentation; the desktop canvas has a compact draggable
  768–1280 px control with keyboard and screen-reader adjustment.
- Group outsiders and stale former participants cannot read, post, report, or
  subscribe. Direct messages remain exactly two participants. Duplicate display
  names retain the selected mention user ID.
- Deleted chat messages stay redacted and cannot be resurrected by stale history
  or realtime events. Failed institution writes do not mutate local state.
- Invalid/repeated/oversized study and resource route parameters fail closed and
  expose a safe return path. Unknown and unauthorized course/deck routes do not
  trap users in a back-stack loop.
- Remote flashcard media is HTTPS/owned-file validated, is consent-gated where
  rendered, and is not silently prefetched. Static teacher HTML is conservatively
  sanitized and rendered under a script/network/navigation-blocking sandbox and
  CSP, with readable native fallback.

## Rendered browser and device status

The exported production web application was opened and its fail-closed
institution-configuration screen rendered correctly. The in-app Browser's saved
localhost permission rejected the development server. Its policy explicitly
forbade retrying through another hostname, raw browser protocol, or a different
browser, so a truthful live click-through of every role was not possible in this
run.

Before release, enable localhost in the in-app Browser and replay the five demo
roles at desktop widths, 400% zoom, keyboard-only, and mobile breakpoints. Then
complete physical iOS/Android checks with VoiceOver/TalkBack for media recording,
notifications, native sharing, orientation, focus order, captions/transcripts,
and embedded-site provider behavior. These are acceptance gates, not automated
test claims.

## Final verification

- `npm run check`: passed (ESLint, strict TypeScript, and four fixture
  validations).
- Automated tests: 256 passed, 0 failed, skipped, or cancelled.
- Loaded-library coverage: 77.80% lines, 75.76% branches, 87.89% functions.
- Web, iOS, and Android production exports passed (2,176, 2,526, and 2,605
  modules respectively).
- Expo's compatibility check and `npm ls --all` passed. A current registry audit
  was reduced from 20 findings to 14 dependency-chain findings, all caused by
  two unresolved `image-size` build-time denial-of-service advisories; details
  and release mitigations are in [`dependency-security-review.md`](./dependency-security-review.md).

Remaining service and product gates are tracked in
[`production-readiness-audit.md`](./production-readiness-audit.md). Rights and
license findings are tracked in [`content-and-ip-provenance.md`](./content-and-ip-provenance.md)
and [`third-party-license-review.md`](./third-party-license-review.md).
