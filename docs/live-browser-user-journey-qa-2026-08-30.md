# Live browser user-journey QA — 2026-08-30 to 2026-09-01

Execution targets: `http://127.0.0.1:4176` for the original pass and a fresh
`http://127.0.0.1:4177` origin for the 2026-09-01 closure pass, both using the
Expo development bundle and synthetic demo repositories.

This record is exhaustive for the user-visible routes, role switches, and
locally reachable browser controls present in this repository on 2026-08-30.
It is deliberately not a replacement for the signed-candidate, physical-device,
assistive-technology, staging-service, or disabled-user acceptance gate in
[`manual-device-accessibility-acceptance-2026-08-20.md`](./manual-device-accessibility-acceptance-2026-08-20.md).

## Deduplication rule

The 30-iteration synthetic suite already proves repository authorization,
presentation builders, announcement reconciliation, flashcard rollback/CSV
contracts, route normalization, and AI consent/stale-result guards. The live
cases below do not repeat those handler assertions. They test the rendered
delta: visible/absent controls, navigation, dialogs, iframe output, status text,
focusable names, hit targets, and responsive behavior.

Status values: `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`. A `PASS` here applies only
to this development fixture and browser session.

## Execution summary

- 62 rendered user-journey cases inventoried from the app routes, centralized
  role policy, and visible control surface.
- 62 `PASS`, 0 `FAIL`, and 0 `BLOCKED` after fixes and focused retesting.
- Existing evidence was reused instead of repeated: 358/358 automated tests
  passed after the changes, and the unchanged 30-repetition synthetic gate had
  already passed 1,620/1,620 ordered steps on 2026-08-29.
- The closure pass added representative subject/core/applied tag fixtures and
  rendered, non-blocking web feedback for audio and CSV operations. Live tag
  filtering changed the Economics browse result from 50 cards to 25 and back to
  50. A synthetic CSV with a valid first row and invalid second row produced a
  visible row-2 error and left the deck at 50 cards with no partial insertion.
  Export produced its visible ready state with no JavaScript dialog. The in-app
  browser did not expose a download event for the Blob-backed anchor, so exported
  CSV bytes and round-trip integrity remain verified by the automated CSV and
  flashcard interaction tests rather than being claimed as a captured browser
  download artifact.

## Startup, navigation, and identity

| ID | Journey and expected rendered result | Existing coverage | Status |
| --- | --- | --- | --- |
| LIVE-START-01 | Open the production export on a fresh loopback origin. It must fail closed without institution repositories and expose Retry. | `production-fail-closed.test.ts`, `NET-01` | PASS |
| LIVE-START-02 | Open the development server on `127.0.0.1`; fixture data loads and the authenticated greeting is visible. | synthetic `role.*.load`, `ROLE-01..05` | PASS |
| LIVE-NAV-01 | Courses, Learn, and Chat tabs have unique accessible names, selected state, and live update/unread badges. | `ui-action-contract.test.ts`, `A11Y-01` | PASS |
| LIVE-NAV-02 | Tutorial prompt supports Start and Skip; Skip reveals the deck library without reload. | flashcard tests, `XAPP-08` | PASS |
| LIVE-ID-01 | Teacher switch changes the greeting to Dr. Smith and exposes teacher capabilities. | `demo-role-acceptance.test.ts`, `ROLE-03` | PASS |
| LIVE-ID-02 | TA switch changes the greeting to John Doe and exposes TA capabilities. | same, `ROLE-02` | PASS |
| LIVE-ID-03 | Student switch changes the greeting to Alice Student and hides staff capabilities. | same, `ROLE-01` | PASS |
| LIVE-ID-04 | IT switch changes the greeting to Riley IT and exposes configuration/roster only. | same, `ROLE-04` | PASS |
| LIVE-ID-05 | Admin switch changes the greeting to Avery Administrator and exposes all course-scoped capabilities. | same, `ROLE-05` | PASS |

## Courses and role capability surfaces

| ID | Journey and expected rendered result | Existing coverage | Status |
| --- | --- | --- | --- |
| LIVE-COURSE-01 | Courses render current/past sections, four fixture presentations, course action names, and safe empty-state copy. | course lifecycle tests, `ROLE-01..05` | PASS |
| LIVE-COURSE-02 | Student cards expose Info, Syllabus, Grades, and Contact; Settings, Analytics, and Roster are absent. | synthetic Student denials, `ROLE-01` | PASS |
| LIVE-COURSE-03 | TA cards expose grading, analytics, roster, and contact but not course Settings. | synthetic TA boundaries, `ROLE-02` | PASS |
| LIVE-COURSE-04 | Teacher cards expose grading, Settings, analytics, roster, and contact. | synthetic Teacher boundaries, `ROLE-03` | PASS |
| LIVE-COURSE-05 | IT cards expose Settings and roster but not grading or analytics. | synthetic IT boundaries, `ROLE-04` | PASS |
| LIVE-COURSE-06 | Admin cards expose the complete course action set. | synthetic Admin boundaries, `ROLE-05` | PASS |
| LIVE-COURSE-07 | Course Info, Syllabus, Grades, Settings, Analytics, Roster, and Contact modals/routes open, have headings/close controls, and return safely for authorized roles. | component tests, `A11Y-01` | PASS |
| LIVE-COURSE-08 | A student deep link to the course shows only eligible learner content and no authoring/delete controls. | route/permission tests, `SAFE-02` | PASS |
| LIVE-COURSE-09 | Unknown course deep link shows a safe Course not found state and Back to courses. | route tests, `SAFE-02` | PASS |
| LIVE-COURSE-10 | Announcement popup is dismissible; View opens the exact course Chat destination and removes only that popup. | synthetic exact navigation, `XAPP-04` | PASS |

## Course presentations, content, assessment, and roster

| ID | Journey and expected rendered result | Existing coverage | Status |
| --- | --- | --- | --- |
| LIVE-PRES-01 | Timeline edit view renders setup warnings, announcement activity, grouping, content sections, slots, edit/host/delete controls. | presentation/unit tests, `XAPP-01` | PASS |
| LIVE-PRES-02 | Teacher Student Preview removes mutating controls and shows past/current/future eligibility. | presentation tests, `XAPP-01` | PASS |
| LIVE-PRES-03 | Student view hides future content bodies and exposes eligible start/view-submission actions. | presentation tests, `ROLE-01` | PASS |
| LIVE-PRES-04 | Vertical/Horizontal tabs change selected state; horizontal exposes three named pages and pager controls. | synthetic responsive contract, `XAPP-01` | PASS |
| LIVE-PRES-05 | Sequential course renders ordered modules, locks, and ungrouped recovery content without disappearing items. | sequential tests, `XAPP-01` | PASS |
| LIVE-PRES-06 | Linked-site course renders an HTTPS sandboxed iframe or a clear blocked/fallback state with Reload/Open separately. | external-site tests, `XAPP-02` | PASS |
| LIVE-PRES-07 | Custom widget course renders sanitized static content; no script/form/navigation control appears inside the iframe. | static-widget tests, `SAFE-01` | PASS |
| LIVE-PRES-08 | Course setup review expands with two non-blocking warnings and remains keyboard-addressable. | setup-review tests | PASS |
| LIVE-PRES-09 | Announcement activity expands, lists active items, and exact-Chat controls are named. | announcement tests, `XAPP-04..06` | PASS |
| LIVE-ASSESS-01 | Student can open an eligible assessment, see authoritative attempt state, and exit without submitting. | assessment tests, `XAPP-11` | PASS |
| LIVE-ASSESS-02 | Staff preview opens without creating a learner attempt and closes safely. | assessment tests, `XAPP-11` | PASS |
| LIVE-ASSESS-03 | Staff builder opens with named fields, question-type actions, reorder, preview, save, and close controls. | assessment tests, `A11Y-02` | PASS |
| LIVE-ROSTER-01 | Authorized roster view supports search, role filters, participant rows, and a safe return path. | role management tests, `ROLE-02..05` | PASS |
| LIVE-ROSTER-02 | Teacher role editor offers Student/TA/Teacher and explains privileged/last-manager restrictions. | role-transition tests, `ROLE-03` | PASS |
| LIVE-ROSTER-03 | TA can view roster but has no role-change controls; Student cannot reach roster. | role-transition tests, `ROLE-01..02` | PASS |

## Chat and cross-app announcements

| ID | Journey and expected rendered result | Existing coverage | Status |
| --- | --- | --- | --- |
| LIVE-CHAT-01 | Main Chat renders accessible course/direct sections, unread counts, and New direct message. | chat policy tests, `XAPP-07` | PASS |
| LIVE-CHAT-02 | Student can enter announcement, discussion, Q&A, group, and direct threads only when membership/lifecycle allows. | chat policy tests, `XAPP-07` | PASS |
| LIVE-CHAT-03 | Conversation shows info, search, pagination, message details, reply/report, compose, attachment, and send controls with correct enabled state. | chat handler tests, `XAPP-07` | PASS |
| LIVE-CHAT-04 | Own-message detail exposes edit/delete; another sender exposes report; closed/announcement policy removes forbidden actions. | chat capability tests, `XAPP-07` | PASS |
| LIVE-CHAT-05 | Message search filters visible results, Clear restores the thread, and Load more/older announces busy state. | pagination tests, `XAPP-07` | PASS |
| LIVE-CHAT-06 | Teacher/TA/Admin see New course topic with bounded topic types and audience controls; Student/IT do not. | synthetic topic boundaries, `ROLE-01..05` | PASS |
| LIVE-CHAT-07 | Course popup View route highlights the exact announcement message and Back returns to the prior surface. | announcement bridge tests, `XAPP-04` | PASS |
| LIVE-CHAT-08 | New direct message lists only authorized directory users and opens/returns safely without creating a duplicate thread during repeated activation. | chat tests, `XAPP-07` | PASS |

## Learn, deck management, study, and review

| ID | Journey and expected rendered result | Existing coverage | Status |
| --- | --- | --- | --- |
| LIVE-FC-01 | Deck library search filters by deck name/description; clearing restores all fixture decks. | synthetic library filter | PASS |
| LIVE-FC-02 | Deck action buttons expose Browse cards, Edit deck settings, Deck info, study-session selection, Add Deck, Review All Due, and Statistics. | UI contract tests, `XAPP-08` | PASS |
| LIVE-FC-03 | Deck info opens with stats and safe close/reset controls; no action fires from an adjacent deck. | flashcard interaction tests | PASS |
| LIVE-FC-04 | Browse route supports card search, tag filters, mass edit, Add card, and named reordering controls. | synthetic card filter/reorder | PASS |
| LIVE-FC-05 | Move up/down changes visible order once and disabled boundary controls remain disabled. | reorder rollback tests, `A11Y-02` | PASS |
| LIVE-FC-06 | Add Deck and Edit Deck expose validation, color, reminder, save, and safe back controls; no destructive confirmation is accepted during this run. | deck tests, `DEVICE-07` | PASS |
| LIVE-FC-07 | Add Card exposes layers, formatting, preview, tags, colors, reversible-card, save, and web audio-unavailable feedback. | card tests, `DEVICE-03` | PASS |
| LIVE-FC-08 | Study selector supports Learn/Study/Quiz targets and starting position; one activation opens the normalized study route. | synthetic route/duplicate guard | PASS |
| LIVE-FC-09 | Study supports reveal, page navigation, note actions, proficiency ratings, keyboard shortcuts, and safe exit/completion. | study tests, `XAPP-08` | PASS |
| LIVE-FC-10 | Review All Due opens the review hub/interleave journey or explains that no cards are due. | review tests | PASS |
| LIVE-FC-11 | Statistics renders totals, retention, seven-day reviews, proficiency distribution, and a safe back path. | stats tests | PASS |
| LIVE-FC-12 | Import/Export controls are named and web export produces an explicit ready/download state; invalid CSV remains atomic. | CSV tests, `DEVICE-05..06` | PASS |
| LIVE-FC-13 | Unknown deck/card routes and invalid study params show a safe error/return path rather than blank or looping navigation. | study route tests, `SAFE-02` | PASS |

## Responsive, keyboard, accessibility tree, and failure states

| ID | Journey and expected rendered result | Existing coverage | Status |
| --- | --- | --- | --- |
| LIVE-A11Y-01 | Wide layout exposes Resize app canvas with adjustable role/name; Arrow/Home/End keep the value within documented bounds. | canvas tests, `XAPP-03` | PASS |
| LIVE-A11Y-02 | Narrow viewport reflows content, removes the canvas grip, forces vertical course presentation, and keeps primary controls reachable. | synthetic responsive contract, `A11Y-03` | PASS |
| LIVE-A11Y-03 | Horizontal inactive course pages are absent from the accessibility tree and pager state names the current page. | presentation tests, `A11Y-05` | PASS |
| LIVE-A11Y-04 | Theme/settings dialogs expose unique tabs/radios/switches, Close, and current selected/checked state. | settings tests, `A11Y-01` | PASS |
| LIVE-A11Y-05 | Keyboard Tab/Shift+Tab reaches primary tabs and modal controls; Enter/Space activates the focused control without a pointer-only dependency. | source contracts, `A11Y-01` | PASS |
| LIVE-A11Y-06 | Validation, permission, route, and unavailable-service states use visible alert/status text plus a named recovery or close action. | error tests, `A11Y-07` | PASS |
| LIVE-A11Y-07 | Browser console has no uncaught errors during all completed journeys; known framework deprecation/notification warnings are recorded separately. | release checks | PASS |

## Findings resolved during execution

1. Study and interleaved review crashed at render time with
   `LinkifyIt.default is not a constructor`. The root package override forced
   `linkify-it` 6.x outside `markdown-it`'s declared 5.x compatibility range.
   The compatible dependency is now locked and guarded by an automated test.
   Fresh five-card, one-card, and 354-card interleaved sessions opened without
   an uncaught error.
2. Revealed study cards nested note/media/page buttons inside a card button.
   Clicking Add note could advance to the next card, hidden bottom-bar controls
   remained named in the accessibility tree, and React reported invalid nested
   buttons. Card reveal is now an explicit sibling control, reveal-state
   surfaces use web `aria-hidden`, note save/clear stayed on the same card, and
   a one-card keyboard-rated session reached the completion screen and returned
   to the deck library with a clean console.
3. The proficiency control and desktop canvas exposed adjustable roles but not
   native web value attributes. Both now publish bounded `aria-value*` state;
   Arrow/Home/End update the value, and Enter submits a card rating.
4. Horizontal course pages all remained named to the accessibility tree, page
   tabs lacked selected/roving-tab state, and Enter/Space did not activate page
   arrows. Only the active page is now role-visible; the three tabs publish
   selected state and a single tab stop; keyboard paging changes the named live
   page.
5. New Deck rendered two Go back buttons because both the route and editor
   supplied one. The route-level duplicate was removed and the live form now
   has one heading and one Back control.
6. A Teacher viewing an IT/Admin roster member saw a read-only role choice with
   no explanation. The role dialog now explains that only course administrators
   can change privileged memberships while preserving the server-side guard.
7. Exact-announcement Chat navigation retained its old `courseId`, `chatId`,
   and `messageId` query after Back, so reload could resurrect the stale thread.
   Back and subsequent thread navigation now clear the deep-link route; the
   live URL changed to `/chat` while the intended course list remained visible.
8. Theme settings now opens one `aria-modal` dialog and autofocuses its labeled
   hex input. The builder-to-staff-assessment-preview transition that appeared
   inert once during the exploratory pass was rerun from a fresh course state
   and passed without an implementation change or console error.
9. Fresh demo cards previously had no tags, so the browse filter dimension
   could not render. Seeded cards now carry a subject tag plus alternating
   `core`/`applied` tags. The live Economics filter reduced 50 visible cards to
   the expected 25 and All restored all 50.
10. Card audio and CSV completion/error feedback used blocking browser dialogs.
    Web now renders accessible inline alert/live-region text while native keeps
    its platform dialogs. The audio-unavailable and export-ready states both
    appeared without a JavaScript dialog.
11. The browser file chooser accepted a local synthetic CSV containing one
    valid row followed by a row with no layer. The UI reported `CSV row 2 must
    contain a front and at least one layer`; a subsequent browse showed 50 cards
    and no first-row content, confirming atomic rejection through the rendered
    journey.

Fresh post-fix study, course, deck, roster, Chat, audio, tag, and export journeys
reported no unexpected runtime errors. The intentional malformed-CSV case emits
one privacy-safe diagnostic error as designed while also rendering the bounded
user-facing validation message. Framework warnings retained for follow-up are
React Native Web's legacy `shadow*`, `textShadow*`, and `pointerEvents` notices
plus the documented `expo-notifications` web-support warning.

## Current-environment boundaries

The following existing acceptance areas cannot be closed by this session and
must remain `BLOCKED` or `NOT RUN` in the signed acceptance record: production
SSO/API/realtime/object storage/AI, offline encrypted institution cache,
physical iOS/Android behavior, native microphone/notifications/share sheets,
VoiceOver/TalkBack, Windows forced colors, browser 200%/400% zoom judged by a
human, captions/transcript accuracy, real frame-denied providers, network
interruption, multi-device concurrency, and disabled-user review.

## Shared multi-user follow-up — 2026-09-02

This continuation reused the live loopback server with separate Admin and Alice
browser sessions. It targeted journeys added after the original single-user
pass instead of repeating the 62 cases above.

| ID | Journey and rendered result | Status |
| --- | --- | --- |
| LIVE-SHARED-01 | Admin created an announcement; Alice received it without reload. Admin edited it; both sessions showed the new title. | PASS |
| LIVE-SHARED-02 | Admin deleted the test announcement; it disappeared for Alice. Recently Deleted restored it as ordinary content and both sessions received the restored item. | PASS |
| LIVE-SHARED-03 | Admin hosted `Live Check: Python Basics`; Alice joined in the waiting state, received the reveal, answered `def`, and the host count advanced from 0 to 1. Host summary showed the answer distribution. | PASS |
| LIVE-SHARED-04 | Admin changed Alice from Student to TA for the timeline course. Only that course gained staff controls; the other three courses retained learner actions. Returning Alice to Student removed those controls. | PASS |
| LIVE-SHARED-05 | A restored announcement followed by a live Student-to-TA transition no longer raises a false linked-event authorization banner while refreshed content is loading. The event stays fail-closed and retries after context arrives. | PASS |
| LIVE-SHARED-06 | Admin and Alice opened Learn simultaneously. Their Physics and Biology completion/due counts remained different, confirming principal-scoped study state. | PASS |
| LIVE-SHARED-07 | The shared sign-in and Admin onboarding screens were rendered at a 320×700 CSS-pixel viewport. Copy reflowed, the tour remained scrollable, and Finish stayed reachable. | PASS |
| LIVE-SHARED-08 | Content editing now renders `Edit course content` and `Save Changes`; the staff timeline renders `Custom code block` instead of serialized widget JSON. | PASS |

The shared fixture was reset after the destructive journeys. Both sessions were
reloaded and signed back in as Avery Administrator and Alice Student. Their
browser error logs were empty at handoff.
