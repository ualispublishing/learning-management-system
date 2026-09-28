# Manual device and accessibility acceptance gate — 2026-08-20

Current execution status: **NOT RUN — manual evidence required.**

Workspace availability attempt on 2026-08-20: the Expo web development server
started successfully on port 8081, but the in-app Browser rejected localhost
because of its saved user permission and prohibited an alternate-browser or raw
automation workaround. Xcode 26.2 and an iOS 26.2 simulator runtime are
installed, but no simulator or physical-device session was active; Android
`adb` tooling was not installed. These observations are environment diagnostics,
not acceptance results, and none of the cases below are marked passed.

This is the bounded, executable acceptance record for the release candidate. It
does not claim a physical-device, browser, screen-reader, or disabled-user
result. Repository checks can prove configuration and code contracts; only the
signed candidate running against the intended staging services can close the
cases below.

The release remains blocked until every required case has an evidence record,
all required target slots are covered, and the exit criteria are signed. Never
infer a pass from an automated test, an Expo export, a simulator, a different
build, or the absence of a reported defect.

## Capability boundaries to preserve during testing

- Course and Chat data require the institution gateway. An offline institution
  snapshot is available only when the deployment injects a principal-bound,
  encrypted cache; it is stale/read-only and is not an offline mutation queue.
- Native notifications currently implement local flashcard due/reminder alerts.
  Remote course-announcement and Chat-message push, device-token registration,
  and push deep links are not implemented. If they are launch requirements,
  record a blocker rather than passing the local-reminder cases.
- Linked course sites embed only on web, using a restricted HTTPS iframe. iOS
  and Android intentionally open the device browser full-screen. A provider may
  deny framing, in which case the visible "Open separately" path must work.
- The desktop web canvas-width grip applies only at wide web widths. Narrow web
  and native layouts must remain fluid/full-screen and must not show the grip.
- Course video playback does not itself prove an accessible media alternative.
  The acceptance fixture must include accurate captions and an adjacent,
  keyboard/screen-reader-accessible transcript. If the intended content model
  cannot publish both, record a release blocker.
- Use a dedicated QA tenant and synthetic content only. Do not capture student
  PII, grades, access tokens, private messages, voice recordings, or notification
  contents in screenshots, videos, console logs, or defect systems.

## Candidate and evidence header

Complete once, before testing. Store evidence in an access-controlled release
folder and link it; do not paste secrets into this file.

| Field | Required value |
| --- | --- |
| Commit SHA and clean/dirty status | ___ |
| Web artifact URL and hash | ___ |
| iOS bundle ID, version/build, artifact hash | ___ |
| Android package, version/code, artifact hash | ___ |
| Staging tenant/API/realtime/asset/AI identifiers | ___ |
| Test data revision and reset procedure | ___ |
| Tester(s), organization, date/time/time zone | ___ |
| Accessibility reviewer and disabled-user review owner | ___ |
| Evidence folder | ___ |
| Approved supported browser/OS matrix | ___ |

Before manual execution, run these repository-local prerequisite gates at the
recorded SHA and attach the complete, privacy-reviewed CI logs in the controlled
evidence folder:

```sh
npm run validate:production-config
npm run audit:release
npm run check:release
node --import tsx --test tests/manual-acceptance-contract.test.ts
```

After the required reports and six approvals are stored in the protected
schema-v2 provider-acceptance manifest, run `npm run check:production`. That
final command deliberately cannot pass while these manual checks remain
`NOT RUN`, `BLOCKED`, pending, stale, or unapproved.

Use signed release candidates, not Expo Go or a development bundle. Configure
real staging SSO/session expiry, authenticated HTTPS APIs, realtime delivery,
asset storage/scanning, the approved AI service, and notification entitlements.
Seed the four presentation modes, current/future/past content, a sequential
lock, assessment and grade, study cards, a captioned/transcribed video, allowed
and frame-denied HTTPS sites, a valid and rejected attachment, an announcement,
forum/group/direct conversations, and two Student accounts.

## Required target slots

Every `ALL` case runs in slots W1, I1, and A1. Platform-specific cases run in
their named slots. I2/A2/T1 are risk sweeps over install/login, responsive
layout, orientation, media, file, interruption, and accessibility cases; a
failure expands testing to the affected supported OS/device family.

| Slot | Physical/manual target | Assistive settings | Device/build/evidence | Result |
| --- | --- | --- | --- | --- |
| W1 | Windows + Edge at the institution's supported version | Keyboard-only, 200%/400% zoom, Windows forced colors | ___ | NOT RUN |
| W2 | macOS + Safari at the institution's supported version | Keyboard-only and VoiceOver | ___ | NOT RUN |
| I1 | Physical iPhone on current supported iOS | VoiceOver, largest text, reduced motion | ___ | NOT RUN |
| I2 | Physical iPad or oldest supported iOS/iPadOS risk target | VoiceOver and hardware keyboard | ___ | NOT RUN |
| A1 | Physical Android phone on current supported Android | TalkBack, largest font/display, reduced motion | ___ | NOT RUN |
| A2 | Physical Android tablet or minimum supported API risk target | TalkBack and hardware keyboard | ___ | NOT RUN |
| T1 | One iOS and one Android interruption/privacy sweep | Lock screen, background/foreground, call/audio interruption, offline | ___ | NOT RUN |

Allowed results are `PASS`, `FAIL`, `BLOCKED`, and `NOT RUN`. A `PASS` requires
the exact candidate, expected outcome, and evidence link. `BLOCKED` identifies
the missing service, account, fixture, permission, or hardware; it is not a pass.

## Evidence record (duplicate for every case × required slot × role)

| Field | Value |
| --- | --- |
| Case ID / target slot / role | ___ |
| Result (`PASS`, `FAIL`, `BLOCKED`, `NOT RUN`) | NOT RUN |
| Tester and UTC/local timestamps | ___ |
| Device model; OS/browser/AT versions | ___ |
| Candidate build/hash and test-data revision | ___ |
| Starting account/course/thread/deck and network state | ___ |
| Actions actually performed | ___ |
| Expected result | ___ |
| Observed result | ___ |
| Screenshot/video/accessibility tree/console-device log link | ___ |
| Defect ID and severity, or `none` | ___ |
| Cleanup/reset completed | ___ |
| Retest evidence and reviewer initials | ___ |

## Role and cross-app journeys

- [ ] `ROLE-01` — `[ALL · Student]` Sign in as Student; verify the greeting is
  the authenticated person's name. Navigate current/past/future and locked
  course content, all presentations, grades, assessments, study cards, forum,
  own group, announcement, and one-to-one Chat. Expected: only eligible content,
  own attempts/grades/groups/DMs, and permitted learner actions appear; staff,
  roster, moderation, grading, role, and course controls are absent or rejected.
- [ ] `ROLE-02` — `[ALL · TA (Teaching assistant)]` Repeat the learner preview, then create/edit
  instructional content, post/moderate staff Chat, view roster, grade, view grade
  analytics, and host live delivery. Attempt course configuration and role
  assignment. Expected: instructional actions work; course configuration and
  role mutation are absent or authoritatively rejected.
- [ ] `ROLE-03` — `[ALL · Teacher]` Configure presentation, create/edit/publish
  content, grade/host, moderate Chat, and assign Student/TA/Teacher. Attempt to
  demote the last course manager and to change IT/Administrator roles. Expected:
  allowed actions persist with correct audit identity; privileged-role and
  last-manager guards explain and reject unsafe changes.
- [ ] `ROLE-04` — `[ALL · IT]` Configure the course, view the roster, and assign
  Student/TA/Teacher plus permitted IT roles. Attempt instructional content,
  grading, live hosting, and official staff Chat. Expected: management actions
  work; instructional/staff-posting actions are absent or rejected.
- [ ] `ROLE-05` — `[ALL · Administrator]` Exercise course configuration,
  roster/roles (including IT/Administrator), content, grading, live delivery,
  analytics, and Chat. Remove course membership and retry a deep link. Expected:
  full course-scoped access while enrolled; global status alone does not create
  an unaudited course identity after removal.
- [ ] `XAPP-01` — `[ALL · Student/Teacher]` In timeline, sequential, custom
  static-code, and linked-site courses, compare teacher preview with the Student
  view for ordering, current/past/future state, locks, empty/error states, and
  vertical/horizontal selection. Expected: the same learner eligibility rules
  apply in every presentation; preview creates no learner attempt or submission.
- [ ] `XAPP-02` — `[W1/W2/I1/A1 · Student]` Open the allowed linked site, scroll
  its full content, use its keyboard/screen-reader navigation, then use a
  frame-denied provider. Expected: web receives a full-width internally
  scrollable iframe plus reload/open-separately; native opens full-screen in the
  system browser; no clipped or nested dead-end view occurs.
- [ ] `XAPP-03` — `[W1/W2/I1/A1 · Student/Teacher]` On wide web drag the compact
  canvas-width grip continuously to both bounds and adjust it by keyboard and
  screen-reader action. Repeat on narrow web and native. Expected: 768–1280 px
  bounds, no content loss, selected horizontal page remains aligned, and the
  grip is absent on narrow/native layouts.
- [ ] `XAPP-04` — `[ALL · Teacher/Student]` Publish an Admin/Courses announcement,
  then observe popup and exact linked Chat message as Student. Edit it in Admin,
  refresh/reconnect, and compare both surfaces. Expected: one canonical message,
  newest edit wins, identity/time/audit data remain truthful, and no duplicate
  popup or message appears.
- [ ] `XAPP-05` — `[ALL · TA/Teacher/Student]` Post an official announcement in
  Chat, observe it in the Admin/Courses activity panel and Student popup, edit it
  in Chat, then deliver older realtime revisions after the edit. Expected: only
  an authorized current staff sender synchronizes, the latest revision remains
  on both surfaces, and stale/reversed events cannot roll content backward.
- [ ] `XAPP-06` — `[ALL · Teacher/Student]` Withdraw a linked announcement, retry
  after a simulated transport failure, replay the event, then restore the course
  item. Expected: deletion is idempotent and tombstoned on both surfaces;
  restoring produces ordinary inactive content and requires an explicit new
  publish/new announcement identity rather than reviving the tombstoned message.
- [ ] `XAPP-07` — `[ALL · Student/TA]` Search and paginate Chat; post/reply/edit/
  delete/report/mention/attach where permitted in announcement, discussion,
  Q&A, scheduled/closed, group, and direct threads. Expected: exact membership,
  lifecycle, reply, attachment, mention, moderation, and two-person DM bounds;
  same-name mentions target the chosen user ID and deleted text does not return.
- [ ] `XAPP-08` — `[ALL · Student]` Launch course study cards, complete reviews,
  leave/re-enter, then use owned decks to create/edit/reorder/search/interleave/
  import/export/review. Expected: handoff targets the correct course/deck/card,
  progress persists only for the authenticated principal, and cancel/back/error
  paths do not lose or duplicate cards or history.
- [ ] `XAPP-09` — `[ALL · authorized creator]` Generate flashcards from pasted
  text and one approved file/media source; deny source-rights acknowledgement,
  cancel, retry, inspect evidence, edit, reject one card, approve, and publish.
  Expected: no request before consent, bounded grounded results and provenance,
  human review before publication, no duplicate start/publish, and clear timeout,
  unsupported-file, and service-error recovery.
- [ ] `XAPP-10` — `[ALL · Teacher/Administrator]` Upload a syllabus, review every
  extracted field/evidence/warning, alter a draft, cancel, then explicitly apply.
  Expected: nothing silently publishes, ambiguous dates/weights remain unresolved,
  reviewer edits and source attestation are retained, and an unauthorized role
  cannot invoke or apply the workflow.
- [ ] `XAPP-11` — `[ALL · Student/TA/Teacher]` Submit eligible solo/group and
  timed work, resume an allowed draft, exhaust attempts, grade with rubric,
  release a grade, and run/join/end a live quiz with disconnect/rejoin. Expected:
  server-authoritative eligibility, timers, attempts, group ownership, grading,
  release visibility, and reconnect state; preview never writes learner data.

## Accessibility and responsive interaction

- [ ] `A11Y-01` — `[W1/W2 · all five roles]` Complete every primary journey with
  keyboard only. Expected: logical focus order, visible focus, no trap, all menus,
  dialogs, tabs, pagination, editors, embeds/fallbacks, and destructive confirms
  operable; focus returns to the invoking control after close.
- [ ] `A11Y-02` — `[W1/W2/I2/A2]` Reorder course content/cards/questions and
  adjust the canvas without precision dragging. Expected: named buttons,
  accessibility actions, or keys expose equivalent operations and announce
  position/value, bounds, disabled state, success, and failure.
- [ ] `A11Y-03` — `[W1/W2]` Run at 200% and 400% browser zoom, down to a 320 CSS
  px viewport, in portrait-like and landscape-like windows. Expected: reflow
  without loss/overlap; controls remain reachable; no two-dimensional page
  scrolling except intrinsically wide media/data; the canvas grip disappears at
  the narrow breakpoint.
- [ ] `A11Y-04` — `[W1]` Enable each supported Windows forced-colors/high-contrast
  theme. Expected: text, links, focus, selected/checked/disabled/error states,
  icons, inputs, charts/results, flashcard reveal, and dragger bounds remain
  perceivable without relying on color, shadow, background image, or emoji alone.
- [ ] `A11Y-05` — `[I1/I2 · VoiceOver · all five roles]` Traverse headings,
  landmarks/tabs, lists, messages, forms, errors, dialogs, content pages, embeds,
  media, flashcard reveal/rating, and reorder controls using swipe and rotor.
  Expected: concise unique names, correct roles/states/values, meaningful reading
  order, modal isolation, announcements once, no hidden horizontal page in the
  accessibility tree, and all actions operable.
- [ ] `A11Y-06` — `[A1/A2 · TalkBack · all five roles]` Repeat `A11Y-05` using
  swipe, explore-by-touch, local/context menus, and system back. Expected: the
  same functional outcome, stable focus after updates, and no gesture conflict
  with horizontal pages, sliders/drags, video, or nested scrolling.
- [ ] `A11Y-07` — `[ALL]` Trigger validation, permission denial, save/upload/
  network failure, offline warning, new message, announcement popup, progress,
  and success states. Expected: status is visible and announced once at the
  appropriate urgency; errors identify the field/action and recovery; focus is
  not stolen repeatedly and timeout-only content can be paused/dismissed.
- [ ] `A11Y-08` — `[I1/I2/A1/A2]` Use largest text/font and display size, portrait
  and landscape, light/dark mode, and reduced motion. Expected: no clipped text
  or controls, 44×44 pt/dp operable targets, scrolling where needed, preserved
  reading/interaction state on rotation, and no essential motion or forced
  animation. Native remains fluid with no desktop width grip.
- [ ] `A11Y-09` — `[I1/A1/W2]` Smoke test Switch Control/Voice Control or Android
  Switch Access/Voice Access and macOS VoiceOver keyboard navigation. Expected:
  visible controls have unique actionable names, scan order is logical, and
  reveal, rating, compose, send, close, media, and confirmation actions do not
  require touch location or drag-only input.

## Media, microphone, files, sharing, and notifications

- [ ] `DEVICE-01` — `[I1/I2/A1/A2/W1/W2]` Play/pause/seek a course and flashcard
  video, enter/exit fullscreen, rotate, background/foreground, disconnect, and
  recover. Expected: native controls remain reachable/labeled, aspect ratio is
  usable, state/errors are clear, no surprise background playback/PiP, and an
  accessible fallback link works when playback fails.
- [ ] `DEVICE-02` — `[ALL · Student/VoiceOver/TalkBack/keyboard]` Enable captions,
  navigate and search the adjacent transcript, and compare a representative
  segment with the audio. Expected: accurate synchronized captions, equivalent
  transcript, speaker/sound identification, focusable controls, and no autoplay.
  Missing caption/transcript publication is a blocker, not `N/A`.
- [ ] `DEVICE-03` — `[I1/A1]` From card creation and a study note, request mic
  access from an explicit user action, allow once, record, stop, replay, save,
  edit/delete, and abandon mid-recording. Expected: one contextual prompt, clear
  recording state, owned app-file URI, no background recording, cleanup on
  cancel/unmount, and no capture before consent.
- [ ] `DEVICE-04` — `[I1/A1/T1]` Deny mic access, choose "don't ask again" where
  available, revoke it in Settings, interrupt with a call/audio route change,
  lock/background, exhaust storage, and retry. Expected: no crash or silent
  recording, actionable error/Settings recovery, audio mode restored, partial
  files not attached, and prior recordings remain principal-private.
- [ ] `DEVICE-05` — `[ALL]` Pick/cancel an image and document for Chat, AI source,
  and CSV import using valid, wrong-extension/MIME, empty, duplicate, oversized,
  malformed, and provider-revoked files. Expected: cancel is harmless; bounded
  validation and upload progress/errors are accessible; no local path/credential
  leak, false sent state, or executable/unsafe preview.
- [ ] `DEVICE-06` — `[I1/A1/W1/W2]` Export CSV, save/download, invoke native share,
  cancel the share sheet, share successfully to an approved test target, and
  reopen the file. Expected: valid UTF-8 content, correct ownership, no unrelated
  records, clear unavailable/cancel/error behavior, and temporary export cleanup.
- [ ] `DEVICE-07` — `[I1/A1/T1]` Explicitly enable a deck reminder, allow local
  notification permission, schedule across the chosen daily window, receive it
  in foreground/background/locked states, open the app, edit/disable/delete the
  deck, and verify old alerts are removed. Expected: generic lock-screen-safe
  copy, no unsolicited prompt, bounded/deduplicated schedules, correct local
  time behavior, and unrelated notifications remain intact.
- [ ] `DEVICE-08` — `[I1/A1]` Deny/revoke notification permission, exceed the
  device schedule budget, change time zone/daylight-saving boundary, reboot,
  and re-enable. Expected: actionable errors, no partial/duplicate schedule,
  safe recovery and cleanup. Confirm course/Chat push is not advertised; if
  required for launch, record the missing push service as a blocker.

## Offline, reconnect, lifecycle, and privacy

- [ ] `NET-01` — `[I1/A1/W1]` Start online, then cold-launch offline with no
  institution snapshot. Expected: fail closed with a recoverable connection
  state; no other principal's course/chat/grade data and no fake demo fallback.
- [ ] `NET-02` — `[I1/A1/W1]` With the deployment's encrypted snapshot enabled,
  load online, disconnect, relaunch, and inspect courses/content/grades/Chat.
  Expected: a prominent stale/read-only warning, only the signed-in principal's
  authorized snapshot, deterministic available/locked state, and no claim that
  data is current. If no production cache is injected, record `BLOCKED`.
- [ ] `NET-03` — `[I1/A1/W1 · all five roles]` While offline attempt message,
  announcement, role, content, grade, assessment, file, and AI mutations, while
  completing a local flashcard review. Expected: institution writes fail clearly
  without optimistic residue/duplication; unsent text is recoverable; supported
  principal-local flashcard work persists. No mutation is presented as queued.
- [ ] `NET-04` — `[I1/A1/W1 · Teacher/Student]` Reconnect after concurrent Chat
  and Admin announcement edits/deletes and reversed realtime revisions; retry
  once, refresh, and inspect on a second device. Expected: authoritative newest
  revision/tombstone wins, retry is idempotent, no resurrection/duplicate, and
  explicit reconciliation errors remain visible until resolved.
- [ ] `NET-05` — `[I1/A1/T1]` During send/upload/recording/AI generation/review/
  live assessment, toggle airplane mode, background, lock, terminate, relaunch,
  and rotate. Expected: no crash/data corruption; committed work is once-only;
  uncommitted work is recovered or truthfully discarded; timers and permissions
  use authoritative state rather than pausing invisibly.
- [ ] `NET-06` — `[I1/A1/W1]` Sign out offline/online, immediately sign in as the
  second Student and then a staff role, use back/deep links, and reconnect while
  an old request/subscription completes. Expected: principal generation rejects
  stale results; decks, snapshots, messages, roster, grades, greetings, search,
  files, notifications, and drafts never cross accounts.
- [ ] `SAFE-01` — `[ALL]` Open HTTP/custom-scheme/credentialed/localhost/same-
  origin/private-network and frame-denied course/media URLs. Expected: unsafe
  values fail closed, same-origin recursive embed is rejected, no camera/mic/
  location/referrer authority enters the iframe, and approved external fallback
  is explicit. Institution server allowlist/DNS controls remain required.
- [ ] `SAFE-02` — `[ALL · all five roles]` Expire/revoke the session, remove or
  change enrollment while a screen is open, then retry saved/deep links to
  course, thread, message, deck, assessment, grade, roster, and Admin routes.
  Expected: server authorization wins, sensitive state clears, return paths are
  safe, audit/greeting identity is current, and hidden UI never substitutes for
  an authorization check.

## Exit decision

Acceptance may be signed only when:

- [ ] Every required case/slot/role has a reviewed evidence record tied to the
  exact immutable candidate; no required case is `NOT RUN` or `BLOCKED`.
- [ ] There are zero open severity-0 or severity-1 defects (security/privacy
  exposure, authorization bypass, data loss/corruption, crash, or inability to
  complete a core/accessibility task). Any lower-severity risk has a named owner,
  due date, workaround, and accountable written acceptance.
- [ ] iOS VoiceOver, Android TalkBack, web keyboard/400% zoom/forced-colors, and
  caption/transcript results are reviewed by the accessibility owner; testing
  with disabled users is completed for the institution's critical journeys.
- [ ] Local-reminder, offline-cache, linked-site, AI, file-service, and realtime
  limitations match release claims and support documentation. Missing remote
  push or offline writes are either implemented and retested or explicitly out
  of scope—not silently marked passed.
- [ ] Security/privacy, institution operations, accessibility, product, and
  release owners record names, dates, decision, residual risks, and rollback
  criteria below.

| Sign-off | Name | Decision/date | Evidence or accepted risk |
| --- | --- | --- | --- |
| QA lead | ___ | NOT RUN | ___ |
| Accessibility owner | ___ | NOT RUN | ___ |
| Security/privacy owner | ___ | NOT RUN | ___ |
| Institution/product owner | ___ | NOT RUN | ___ |
| Release owner | ___ | NOT RUN | ___ |
