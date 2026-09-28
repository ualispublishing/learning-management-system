# LMS self-test user journeys

This is the hands-on acceptance pack for the local LMS. It covers every
user-visible route and the shared interactions that cannot be proved in one
browser session. Run it only against the loopback shared demo; it is not a
production authorization, accessibility, device, or provider certification.

## Start and reset the shared test environment

From the app directory:

```bash
npm run demo:multiuser
```

Open `http://127.0.0.1:4178` in two separate browser tabs or windows. Each tab
starts at the synthetic account chooser. After sign-in, the app shows **Shared
multi-user server connected** above the identity controls. Use Session A for the
actor and Session B for the observer. A third session is useful for privacy
cases. Identity is held separately in each loaded page; refreshing a demo tab
signs that page out.

Before each destructive or multi-user section, restore the original fixtures:

```bash
npm run demo:reset
```

Reload every open test tab after a reset. Stopping the server also erases every
change because the shared server is deliberately in-memory and loopback-only.

| UI label | Person | ID | Course role |
| --- | --- | --- | --- |
| Teacher | Dr. Smith | `u1` | Teacher |
| TA | John Doe | `u2` | Teaching assistant |
| Student A | Alice Student | `u3` | Student, Group A |
| Student B | Bob Student | `u4` | Student, Group A |
| Student C | Charlie Student | `u5` | Student outside Group A |
| IT | Riley IT | `u6` | IT |
| Admin | Avery Administrator | `u7` | Administrator |

Use harmless unique text such as `SELFTEST-<case>-<time>` for messages and
posts. Never upload a personal file; use a synthetic text/image fixture.

## Result notation

Mark each row `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`. For a failure, record the
case ID, identity, URL, viewport/browser, exact expected versus actual result,
console error, and a screenshot. A case passes only when both the action and its
listed authorization/visibility boundary are observed.

## 1. Environment, navigation, and account isolation

| Done | ID | Session | Journey | Expected result |
| --- | --- | --- | --- | --- |
| [ ] | ENV-01 | A | Start `demo:multiuser`, open `/`, and wait for initialization. | Greeting, courses, tabs, and the shared-server banner render without an error. |
| [ ] | ENV-02 | A | Open `http://127.0.0.1:4180/health`. | JSON reports `mode: shared-demo` and nonzero fixture counts. |
| [ ] | ENV-03 | A/B | Sign in as Teacher in A and Student A in B. | Each page keeps its own greeting and selected identity. |
| [ ] | ENV-04 | A/B | Reload both pages. | Each page safely returns to the account chooser; no prior principal data or greeting flashes during initialization. |
| [ ] | ENV-05 | A | Switch Teacher → Student A → Admin rapidly but deliberately. | Final identity is Admin; no data from an intermediate account remains. |
| [ ] | ENV-06 | A/B | Leave A in Chat while switching B between Student A and Student B. | A does not change identity or conversation. |
| [ ] | ENV-07 | A/B | Run `demo:reset`, then reload both tabs. | Added messages/posts are gone and original fixture data returns. |
| [ ] | ENV-08 | A | Stop the shared server while the app is open, then trigger a fetch. | A bounded connection error appears; stale data is not presented as newly saved. |
| [ ] | ENV-09 | A | Restart `demo:multiuser` and reload. | The app reconnects to a clean fixture. |
| [ ] | ENV-10 | A | Navigate Courses → Learn → Chat → Courses using the bottom tabs. | One tab is selected at a time, URL/history remain coherent, and no page goes blank. |
| [ ] | ENV-11 | A | Open a deep course/deck route, use Back, then browser Back/Forward. | Each route returns to a valid parent without loops or stale modal state. |
| [ ] | ENV-12 | A | Open an unknown course, deck, card, and malformed study URL. | Every route fails safely with a named recovery action. |

## 2. Sign-in, sign-out, and role onboarding

Use a fresh page for the first-time cases. The shared demo intentionally uses a
role picker instead of passwords; production authentication remains owned by
the institution SSO adapter.

| Done | ID | Identity/session | Journey | Expected result |
| --- | --- | --- | --- | --- |
| [ ] | AUTH-01 | Signed out | Open the shared-demo URL. | The account chooser appears before any greeting, course, grade, roster, message, or flashcard data. |
| [ ] | AUTH-02 | Signed out | Inspect the chooser using keyboard and a screen reader. | Learner, instructional-staff, and administration groups have headings; every account states its person, role, and purpose. |
| [ ] | AUTH-03 | Admin | Activate `Admin · Avery Administrator` once. | That choice becomes busy, all account choices become unavailable during loading, and exactly one session starts. |
| [ ] | AUTH-04 | Admin | Wait for sign-in. | The app opens Courses, greets Avery Administrator, exposes Administrator capabilities, and never flashes Teacher or learner data. |
| [ ] | AUTH-05 | Student A | From a fresh page, sign in as Alice. | The app opens Courses, greets Alice Student, and exposes only learner actions and Alice-authorized data. |
| [ ] | AUTH-06 | A/B | Sign in as Admin in A and Student A in B. | Both identities remain independent while mutations and permitted observations share through the server. |
| [ ] | AUTH-07 | Any | Open the account menu. | It shows the authoritative name, email, and course role plus Close and Sign out actions. |
| [ ] | AUTH-08 | Any | Sign out from the account menu. | Principal-scoped courses, grades, conversations, unread state, and flashcards disappear before the chooser returns. |
| [ ] | AUTH-09 | Signed out | Use browser Back after signing out. | Protected data does not reappear; the chooser remains the authorization boundary. |
| [ ] | AUTH-10 | Any | Refresh the shared-demo tab. | The tab returns to the chooser because synthetic sessions are deliberately not persisted. |
| [ ] | AUTH-11 | Signed out | Stop the shared server, choose an account, then restart it. | A bounded sign-in error appears; no stale principal is retained, and retry succeeds after restart. |
| [ ] | AUTH-12 | Production build | Start without a configured institution adapter. | The SSO gate fails closed and no demo account picker or synthetic data appears. |
| [ ] | ONBOARD-01 | Admin | Complete first sign-in, then use Next and Back. | `Welcome to course administration` opens automatically at `Step 1 of 3`, shows one step at a time with the course-scoped authority boundary, and moves without skipping or leaving the 1–3 range. |
| [ ] | ONBOARD-02 | Admin | Finish the role tour, navigate away/back, then sign out/in again. | Completion persists for Avery only and the tour does not interrupt the next session. |
| [ ] | ONBOARD-03 | Admin | Advance the tour, close it, then activate `Replay role onboarding`. | The Administrator tour reopens at `Step 1 of 3` without changing account, course data, or permissions. |
| [ ] | ONBOARD-04 | Student A | Complete first sign-in. | `Welcome to your learner workspace` explains Courses, Learn, Chat, and the absence of staff capabilities. |
| [ ] | ONBOARD-05 | Student A/Admin | Finish Alice’s tour, then sign in as Admin in the same browser. | Alice’s completion does not suppress Avery’s principal-scoped Administrator tour. |
| [ ] | ONBOARD-06 | TA | Replay the role tour. | Teaching-assistant content, grading, live-support, moderation, and Settings boundary are accurate. |
| [ ] | ONBOARD-07 | Teacher | Replay the role tour. | Instructor setup, teaching, assessment, communication, and privileged-role boundary are accurate. |
| [ ] | ONBOARD-08 | IT | Replay the role tour. | IT configuration/roster responsibilities and instructional/grading exclusions are explicit. |
| [ ] | ONBOARD-09 | Any | Close the role tour with the close control, then replay it. | Close records completion, focus returns safely, and the explicit replay remains available. |
| [ ] | ONBOARD-10 | Student | Open Learn after finishing the LMS role tour. | The flashcard tutorial remains a separate learning-tool walkthrough and does not replace role onboarding. |
| [ ] | ONBOARD-11 | Any | Navigate the role tour with only a keyboard and inspect it with a screen reader. | Step progress is announced, Back is disabled on step 1, Next appears before the final step, Finish appears only on step 3, and modal focus does not escape into the page behind it. |

## 3. Identity and role capability matrix

Repeat the first six rows in both a fresh tab and a previously used tab.

| Done | ID | Identity | Journey | Expected result |
| --- | --- | --- | --- | --- |
| [ ] | ROLE-01 | Student A | Inspect course cards, a course, roster deep link, content tools, gradebook, and Chat. | Learner content and allowed chats appear; staff authoring, roster, analytics, grading, and settings are absent/denied. |
| [ ] | ROLE-02 | Student B | Open Group A and direct chat with Alice. | Group A and Alice/Bob direct conversation are visible. |
| [ ] | ROLE-03 | Student C | Inspect group and direct-chat lists. | Group A and Alice/Bob direct conversation are absent. |
| [ ] | ROLE-04 | TA | Inspect course actions and content management. | Content, grading, analytics, roster, live-hosting, and chat management appear; course Settings/privileged role changes do not. |
| [ ] | ROLE-05 | Teacher | Inspect all course actions. | Content, grading, analytics, roster, live-hosting, chat management, and ordinary course Settings appear. |
| [ ] | ROLE-06 | IT | Inspect all course actions. | Settings and roster appear; content authoring, grading, analytics, and live-hosting do not. |
| [ ] | ROLE-07 | Admin | Inspect all course actions. | Complete course-scoped action set appears. |
| [ ] | ROLE-08 | Teacher | Open an IT/Admin roster member. | Privileged membership is read-only with an explanation. |
| [ ] | ROLE-09 | IT | Open an Administrator roster member. | Administrator cannot be demoted; allowed IT-scoped choices remain bounded. |
| [ ] | ROLE-10 | Admin | Open each roster role editor. | Student, TA, Teacher, IT, and Admin choices follow the documented grant matrix. |
| [ ] | ROLE-11 | TA | Open roster and select a member. | Roster is viewable but no role mutation controls appear. |
| [ ] | ROLE-12 | Student | Paste a staff/admin deep link. | Server/UI deny the action; no protected data or transient staff controls appear. |
| [ ] | ROLE-13 | A/B | Change identities independently while watching network-backed data. | A never receives B’s private direct messages, submissions, or group-only state. |

## 4. Courses, presentations, content, and roster

| Done | ID | Identity | Journey | Expected result |
| --- | --- | --- | --- | --- |
| [ ] | COURSE-01 | Any | Inspect Upcoming, Current, and Past sections. | Courses are classified by authoritative lifecycle and empty states are explicit. |
| [ ] | COURSE-02 | Student | Open Info, Syllabus, Grades, and Contact. | Each modal has a heading, Close control, scoped data, and safe return. |
| [ ] | COURSE-03 | Teacher | Open Settings, Analytics, Roster, grading, and Contact. | Each authorized surface loads the selected course only. |
| [ ] | COURSE-04 | Teacher | Open timeline edit mode. | Setup warnings, announcements, grouping, slots, content actions, and student preview are present. |
| [ ] | COURSE-05 | Student | Open the same timeline course. | Only released/current learner content appears; future/locked bodies and mutations are absent. |
| [ ] | COURSE-06 | Teacher | Switch Vertical ↔ Horizontal presentation. | Selected state updates and all current content remains represented once. |
| [ ] | COURSE-07 | Teacher | In horizontal mode use tabs, Previous, and Next by mouse and keyboard. | Exactly one page is active and named; inactive pages leave the accessibility tree. |
| [ ] | COURSE-08 | Student | Open sequential presentation. | Ordered modules, locks, and true ungrouped items render without duplication. |
| [ ] | COURSE-09 | Teacher | Reorder/group sequential content, then refresh. | Order/grouping persists on the shared server. |
| [ ] | COURSE-10 | Student | Open linked-site course. | HTTPS sandboxed frame or a clear blocked/fallback state appears; Reload/Open are separate. |
| [ ] | COURSE-11 | Student | Open custom-widget course. | Sanitized static content renders with no form, script, autoplay, or remote-navigation control. |
| [ ] | COURSE-12 | Teacher | Expand course setup review and announcement activity. | Warnings are non-blocking, keyboard-addressable, and tied to the correct course. |
| [ ] | COURSE-13 | Teacher | Create a harmless material, edit it, reorder it, and soft-delete it. | Each change is visible once and survives refresh. |
| [ ] | COURSE-14 | Teacher | Open Recently Deleted and restore that material. | Restored item returns once in its saved position. |
| [ ] | COURSE-15 | Student | Attempt to reach the content creator by deep link. | Creation remains unavailable and the shared server rejects forged authoring. |
| [ ] | COURSE-16 | Admin | Add a directory student already enrolled, then a valid unenrolled identifier if available. | Duplicate enrollment is rejected; valid addition appears once. |
| [ ] | COURSE-17 | Admin | Change a learner role and then reset fixtures. | Role/capabilities refresh in the other session; reset restores the original role. |
| [ ] | COURSE-18 | Teacher | Attempt to demote the only remaining course manager in a prepared scenario. | Mutation is blocked with the last-manager explanation. |

## 5. Assessments, submissions, grading, and live delivery

Reset before this section.

| Done | ID | Sessions | Journey | Expected result |
| --- | --- | --- | --- | --- |
| [ ] | ASSESS-01 | Student | Open an eligible assessment and exit before answering. | Attempt state is explicit; no accidental submission occurs. |
| [ ] | ASSESS-02 | Student | Answer each supported question type and save a draft. | Values persist after closing/reopening; unanswered state remains distinguishable. |
| [ ] | ASSESS-03 | Student | Submit a completed assessment once. | Submitted state is immutable to the learner and no duplicate attempt is created. |
| [ ] | ASSESS-04 | Student | Try an unavailable/future/expired or exhausted-attempt assessment. | Start is denied with the authoritative reason. |
| [ ] | ASSESS-05 | Teacher | Open staff preview. | Preview creates no learner attempt or grade. |
| [ ] | ASSESS-06 | Teacher | Open builder, edit fields/questions/rubric, reorder, preview, save, and close. | Saved structure returns after refresh without duplicate questions. |
| [ ] | ASSESS-07 | Teacher | Enter invalid blank options, impossible scores, and oversized/unsupported live questions. | Save is blocked with field-specific validation. |
| [ ] | ASSESS-08 | TA | Open submitted work and grade it. | Grading controls work; course Settings remain absent. |
| [ ] | ASSESS-09 | Teacher | Save rubric/feedback, release grade, then inspect as Student. | Student sees only released totals/feedback for their own work. |
| [ ] | ASSESS-10 | Student C | Inspect another learner’s grade/submission URL. | Cross-learner work is absent/denied. |
| [ ] | ASSESS-11 | Admin | Create an external grade column with valid maximum. | One column and bounded student placeholders are created atomically. |
| [ ] | ASSESS-12 | Teacher | Attempt an invalid external-grade batch. | No partial column/submission records appear. |
| [ ] | LIVE-01 | A Teacher / B Student A | A hosts “Live Check: Python Basics”; B stays on the course. | B receives the live session without reload. |
| [ ] | LIVE-02 | A/B | A reveals question 1; B answers once. | A sees the participant/answer state; B cannot answer a stale question. |
| [ ] | LIVE-03 | A/B | A locks question 1 and advances. | B’s old answer control closes; the next question appears in both sessions. |
| [ ] | LIVE-04 | A/B | Let a question timer expire. | Server rejects late answers and both sessions show the closed state. |
| [ ] | LIVE-05 | A/B | A ends/finalizes the session. | Live UI closes and one authoritative submission is archived for each participant who answered. |
| [ ] | LIVE-06 | A Teacher / B Teacher | Both host tabs try to advance the same revision. | One succeeds; the stale host receives a revision conflict and cannot overwrite answers. |

## 6. Single-session chat behavior

| Done | ID | Identity | Journey | Expected result |
| --- | --- | --- | --- | --- |
| [ ] | CHAT-01 | Student | Open Chat home and a course. | Course/direct sections, summaries, unread counts, and permitted topics are named. |
| [ ] | CHAT-02 | Student | Open announcement, discussion, Q&A, office-hours, group, and direct threads. | Access follows membership, group, lifecycle, and participant scope. |
| [ ] | CHAT-03 | Student | Send text, then a reply and an exact visible `@Name` mention. | Each appears once; reply/mention metadata points to the intended user/message. |
| [ ] | CHAT-04 | Student | Try a blank, overlong, invalid mention, disallowed attachment, and reply to a deleted item. | Each is rejected without a ghost message. |
| [ ] | CHAT-05 | Student | Search by text/sender/attachment, clear, and load older pages. | Results are scoped, chronological, deduplicated, and Clear restores the thread. |
| [ ] | CHAT-06 | Student | Edit an own recent message. | Revision and Edited state advance once. |
| [ ] | CHAT-07 | Student | Delete an own message after confirmation. | Tombstone replaces content and does not resurrect after refresh. |
| [ ] | CHAT-08 | Student | Report another sender with a 10+ character reason; repeat it. | One report is accepted idempotently; own-message report is blocked. |
| [ ] | CHAT-09 | Teacher | Moderate another sender’s message. | Allowed moderation works without changing original authorship. |
| [ ] | CHAT-10 | Student | Attempt to post in Announcements. | Composer/action is absent or server rejects the post. |
| [ ] | CHAT-11 | Teacher | Create a course topic with each permitted type/audience. | Topic appears once for eligible users and never for excluded users. |
| [ ] | CHAT-12 | Student | Start the same direct conversation repeatedly. | Existing two-person thread reopens; no duplicate is created. |

## 7. Two- and three-user interaction journeys

Keep both sessions on the named destination before acting. Do not manually
reload unless the row says to; automatic refresh is part of the check. Allow up
to two seconds for shared-demo chat polling before recording a delivery failure.

| Done | ID | Session A | Session B/C | Action and expected cross-session result |
| --- | --- | --- | --- | --- |
| [ ] | MU-RR-01 | Student A | Student B | In `General Discussion`, A posts `SELFTEST-MU-RR-01`; B sees it in place without reload. |
| [ ] | MU-RR-02 | Student A | Student B | A mentions `@Bob Student`; B receives the exact mention and unread summary. |
| [ ] | MU-RR-03 | Student B | Student A | B replies; A sees the reply relation and one new message. |
| [ ] | MU-RR-04 | Student A | Student B | A edits the message; B sees the newer revision, not both versions. |
| [ ] | MU-RR-05 | Student A | Student B | A deletes the message; B sees a tombstone and cannot reply to deleted content. |
| [ ] | MU-RR-06 | Student A | Student B | Use the Alice/Bob direct thread for a two-way exchange; neither course audience nor Student C receives it. |
| [ ] | MU-RR-07 | Student A | Student B | Mark the direct thread read in B; unread state updates and remains correct after navigation. |
| [ ] | MU-RR-08 | Student A | Student B | Both submit different messages almost simultaneously. Both stable messages appear once in chronological order. |
| [ ] | MU-PRIV-01 | Student A | Student B / Student C | A posts in Group A. B sees it; C cannot see the group/thread/message through UI or deep link. |
| [ ] | MU-PRIV-02 | Student A | Student B / Student C | A starts/uses the Alice/Bob DM. B sees it; C has no summary, unread count, or search result. |
| [ ] | MU-PRIV-03 | Teacher | Student A / Student C | Teacher posts to Group A. A sees it; C remains excluded unless explicitly moved into that group. |
| [ ] | MU-PRIV-04 | Admin | Student A | Admin changes A out of Student role. Group/direct/course visibility refreshes according to the new authoritative membership. |
| [ ] | MU-ST-01 | Student A | Teacher | Student asks in Homework Help; Teacher sees it realtime and replies; A sees the reply realtime. |
| [ ] | MU-ST-02 | Teacher | Student A | Teacher creates a normal material. A’s course refreshes automatically and shows it once. |
| [ ] | MU-ST-03 | Teacher | Student A | Teacher edits then deletes/restores that material. A observes each authoritative state, never a duplicate. |
| [ ] | MU-ST-04 | Teacher | Student A | Teacher posts an official announcement. A receives popup/activity/Chat linkage with the exact title/body. |
| [ ] | MU-ST-05 | Teacher | Student A | Teacher edits the official announcement. A sees the corrected revision; stale text does not return. |
| [ ] | MU-ST-06 | Teacher | Student A | Teacher withdraws the announcement. A’s popup and linked Chat/content representation disappear or tombstone coherently. |
| [ ] | MU-ST-07 | Student A | Teacher | A submits an assessment; Teacher’s grading list refreshes and shows A’s submission only once. |
| [ ] | MU-ST-08 | Teacher | Student A | Teacher grades/releases A’s work; A receives only the released grade/feedback. |
| [ ] | MU-SA-01 | Student A | Admin | A posts in discussion; Admin receives, replies, and can moderate according to policy. |
| [ ] | MU-SA-02 | Admin | Student A | Admin creates a topic. A receives it automatically if audience policy includes learners. |
| [ ] | MU-SA-03 | Admin | Student A | Admin changes A Student → TA. A’s controls refresh to TA; learner-only group membership is removed as specified. |
| [ ] | MU-SA-04 | Admin | Student A | Reset fixtures and reload. A returns to Student and original group access. |
| [ ] | MU-STA-01 | Student A | TA | Student asks a question; TA replies/moderates and can grade, but cannot open course Settings. |
| [ ] | MU-SIT-01 | Student A | IT | Student posts course content/chat; IT can manage configuration/roster but cannot grade or author instructional content. |
| [ ] | MU-TT-01 | Teacher | TA | Exchange direct messages in the existing Dr. Smith/John Doe thread; delivery is realtime and private. |
| [ ] | MU-TT-02 | Teacher | TA | Both create different course topics. Both appear once; policy/audience settings remain attached to the correct topic. |
| [ ] | MU-AA-01 | Admin A tab | Admin B tab | Both attempt conflicting updates to the same message/host revision. Stale update is rejected rather than overwriting the newer revision. |
| [ ] | MU-RESET-01 | Any actor | Any observer | Run reset while both are on a shared surface, then reload. Both return to identical baseline counts and no self-test data remains. |

### Required pair coverage summary

| Pair | Minimum cases |
| --- | --- |
| Regular ↔ regular | `MU-RR-01..08`, `MU-PRIV-01..02` |
| Regular ↔ teacher | `MU-ST-01..08`, `LIVE-01..05` |
| Regular ↔ TA | `MU-STA-01` plus grading/reply/moderation |
| Regular ↔ IT | `MU-SIT-01` plus negative content/grade checks |
| Regular ↔ admin | `MU-SA-01..04` |
| Staff ↔ staff | `MU-TT-01..02`, `MU-AA-01`, `LIVE-06` |
| Authorized ↔ unauthorized observer | `MU-PRIV-01..04` |

## 8. Learn, flashcards, study, and review

Flashcards remain principal-scoped local data, intentionally separate from the
shared institution server. Account isolation—not cross-user sharing—is the
expected behavior in this section.

| Done | ID | Journey | Expected result |
| --- | --- | --- | --- |
| [ ] | FC-01 | Search deck names/descriptions and clear. | Matching decks filter and the full library returns. |
| [ ] | FC-02 | Open Deck info, Browse, Edit, session selector, Statistics, Add Deck, Review All. | Every adjacent action targets the correct deck. |
| [ ] | FC-03 | Browse Economics; search cards and select `core`, `applied`, subject, and All tags. | Counts/content change correctly and All restores 50. |
| [ ] | FC-04 | Move first/middle/last cards with named controls. | One move occurs; boundary controls are disabled. |
| [ ] | FC-05 | Enter/exit mass edit and edit one card. | Only intended cards enter edit mode; cancellation preserves data. |
| [ ] | FC-06 | Create a deck with valid colors; test blank name and inaccessible color pairs. | Valid deck saves; invalid forms remain with visible errors. |
| [ ] | FC-07 | Edit a deck’s name/description/colors and refresh. | Changes persist for that principal. |
| [ ] | FC-08 | Add a card with pages, formatting, tags, colors, preview, and reversible mode. | One or two cards save as selected and render correctly. |
| [ ] | FC-09 | Activate Record on web. | Visible unavailable message appears without a blocking dialog. |
| [ ] | FC-10 | Export CSV, then import a valid synthetic CSV. | Ready/import counts appear and cards round-trip. |
| [ ] | FC-11 | Import a valid first row followed by invalid second row. | Entire file is rejected; no partial card appears. |
| [ ] | FC-12 | Start Learn, Study, and Quiz with bounded targets/start positions. | One normalized study route opens per activation. |
| [ ] | FC-13 | Reveal, page forward/back, add/save/clear note, rate with controls/keyboard. | State stays on the current card until grading advances it once. |
| [ ] | FC-14 | Complete a one-card session and choose Continue/Return. | Completion actions work without loops. |
| [ ] | FC-15 | Open Review All Due/interleaved review. | Due queue or explicit empty state appears. |
| [ ] | FC-16 | Switch Student A ↔ Student B and inspect decks/notes/reviews. | Principal data never crosses accounts. |

## 9. Accessibility, responsive layout, resilience, and safety

| Done | ID | Journey | Expected result |
| --- | --- | --- | --- |
| [ ] | A11Y-01 | Complete primary navigation with Tab/Shift+Tab/Enter/Space only. | Focus is visible, ordered, and never trapped outside an open modal. |
| [ ] | A11Y-02 | Inspect names/roles/states for tabs, switches, sliders, dialogs, alerts, and buttons. | Each control has one accurate accessible identity and state. |
| [ ] | A11Y-03 | Use canvas slider with Arrow/Home/End. | Numeric value stays bounded and visible width follows. |
| [ ] | A11Y-04 | Resize to 320 CSS px. | No essential control/content is lost or horizontally stranded. |
| [ ] | A11Y-05 | Test desktop wide, tablet-like, and phone-like widths. | Presentation mode/reflow follows documented breakpoints. |
| [ ] | A11Y-06 | Zoom browser to 200% and 400%. | Reading/order/actions remain operable without two-dimensional scrolling for ordinary content. |
| [ ] | A11Y-07 | Enable reduced motion. | No required information depends on animation. |
| [ ] | A11Y-08 | Enable supported forced colors/high contrast. | Focus, text, errors, selected state, and controls remain distinguishable. |
| [ ] | A11Y-09 | Use a supported screen reader on navigation, theme dialog, course, Chat, assessment, and study. | Headings/landmarks/live regions/modal boundaries make the journey understandable. |
| [ ] | A11Y-10 | Trigger validation, permission, route, server-offline, and upload errors. | Visible bounded alert/status text explains recovery; no native blocking web alert remains. |
| [ ] | SAFE-01 | Try HTTP/credentialed media URLs and unsafe external embed addresses. | Unsafe addresses are rejected or rendered as a safe blocked state. |
| [ ] | SAFE-02 | Try an oversized/unsupported attachment and cross-thread reply target. | No upload/message is committed. |
| [ ] | SAFE-03 | Paste another user’s course/chat/submission IDs into URLs. | Authorization fails closed without identity/data leakage. |
| [ ] | SAFE-04 | Disconnect/reconnect during send and retry with the same compose attempt. | At most one message is committed. |
| [ ] | SAFE-05 | Perform two rapid clicks on save/send/import/export/host. | Synchronous lock prevents duplicate work and later actions re-enable. |
| [ ] | SAFE-06 | Review browser console during all completed cases. | No uncaught errors; expected diagnostics are bounded and explain the deliberately rejected action. |
| [ ] | SAFE-07 | Run `npm test`, `npm run typecheck`, and `npm run lint` after testing. | All checks pass. |
| [ ] | SAFE-08 | Stop the server and verify no shared test data persists on restart. | Fresh counts and original messages/posts return. |

## Completion rule

The local self-test is complete only when every applicable row has a recorded
status, all failures have reproducible evidence, privacy/authorization cases
were tested with the named second or third observer, and the final reset was
performed. Physical iOS/Android, VoiceOver/TalkBack, Windows forced colors,
real SSO, production APIs/storage/realtime, concurrency across devices, and
institution approval remain separate acceptance gates in
`manual-device-accessibility-acceptance-2026-08-20.md`.
