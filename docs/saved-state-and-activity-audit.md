# Saved state, activity data, and refresh/resume audit

Last reviewed: 2026-09-05

## Outcome

The MVP now has one bounded learner-state contract for operational resume data. Every record is keyed by authenticated principal and, where relevant, course, content item, conversation, or deck. Operational state is separate from analytics: a resume write never grants permission to transmit activity, and the demo has no analytics sink or consent provider.

The implementation deliberately does not claim that a generic cross-origin iframe can report clicks, answers, scrolling, navigation, or completion. It cannot. The browser blocks inspection, and the sandbox gives the frame an opaque origin.

## State matrix

| Area | Refresh/resume behavior | Scope and owner | Retention / remaining loss |
| --- | --- | --- | --- |
| Role onboarding | Completion survives refresh; the tour can be replayed explicitly. | Local principal + role. | Durable local preference. Account switches do not share completion. |
| Theme and custom colours | Theme, custom colour, accessibility settings, app canvas width, and tutorial preferences survive refresh. | Device preference, intentionally shared by accounts on that device. | No learning activity is inferred or sent. |
| Course presentation | Teacher-selected `presentationMode` is an institution course record. The learner's vertical/horizontal choice now resumes. | Presentation: course repository. Learner view: principal + course. | Learner view: 180 days. Teacher edit/preview mode remains transient. |
| Selected course and page | The open course is addressable in the route. Stable content-bucket ID, vertical offset, and expanded static-widget ID now resume. | Principal + course. | Page state: 30 days. The course list does not auto-open the last course. |
| Announcements | Posts and chat-linked announcement records are repository-owned. Dismissals now resume. | Announcement: institution repository. Dismissal: principal. | Dismissal: 180 days. A failed save is shown through the chat error channel and can be retried by dismissing again. |
| Generic external site | The LMS can record only a consent-gated `frame loaded` event. No generic in-site progress is collected or restored. | Event: principal + course + content item. Provider page remains provider-owned. | Refresh starts at the configured URL. Provider resume requires a separate reviewed protocol. |
| Static custom widget | Host expand/minimize state resumes as part of course-page state. The iframe is script-free, so there are no in-widget actions to capture. | Principal + course; widget ID only. | 30 days. HTML form/script state does not exist by design. |
| Hosted custom workspace | The bounded workspace renderer does not execute or upload learner code. | Current screen memory only. | Editor text, check result, selected tab, and milestone interaction reset on close/refresh. This is intentional until a reviewed workspace state contract exists. |
| Assessment | Answers, timing, attachments after upload, attempt number, and status are durable submissions. Current assessment page now resumes. | Submission repository plus principal + course + content item navigation state. | Navigation: 30 days and removed after successful submit. Pending local file-picker handles are lost; already uploaded asset references remain in the draft. |
| Chat and read state | Messages, revisions, reports, and read receipts are repository-owned. Text, mentions, reply target, and message idempotency ID now resume per conversation. | Principal + conversation. | Draft: 7 days and removed after send. Pending attachment UI/file handles and new-topic/direct-message modal fields remain transient. |
| Course study set | Current card, reveal state, and understood-card IDs now resume. Saving to My Flashcards already creates a principal-scoped durable personal deck. | Principal + course + content item; personal deck store for copied decks. | Course study state: 30 days. |
| My Flashcards / Learn | Decks, cards, layers, notes, and review logs are already principal-scoped and durable (web storage or native SQLite). | Flashcard principal + deck/card IDs. | Active study card, reveal/depth UI, and unfinished quiz UI remain transient. Full Learn expansion is deferred. |
| Media | Caption/transcript metadata is course content. Player time is currently transient. | Provider/player memory. | Playback position is lost on refresh. Media resume is a documented next step, not silently inferred from page visits. |
| Authoring drafts | Saved course/content mutations are durable; open editor/modal buffers generally are not. Close guards prevent common accidental loss. | Screen memory until explicit save. | Unsaved course/content/topic form edits are lost on hard refresh. |

## Learning-state contract

`src/lib/learningState.ts` validates versioned records before use. Keys include the complete normalized scope, payloads are capped at 64 KB, identifiers and lists are bounded, writes are serialized in the local implementation, expired records are erased, and corrupt or cross-scope records fail closed.

Retention is data-class specific:

- Announcement dismissals and course layout: 180 days.
- Course page, external-provider state, media position, widget state, course study set, and assessment navigation: 30 days.
- Chat drafts and future active Learn-session state: 7 days.

The last two classes are contract capacity, not a claim that every listed UI currently writes them. The state matrix above is authoritative for implemented behavior.

## Demo versus production

### Development and shared demo

- The local learning-state adapter uses AsyncStorage. Shared-demo server mutations remain in-memory and are synthetic test data only.
- Refresh signs the shared demo out. Signing back in as the same synthetic identity restores its local resume state; choosing another identity cannot read it because the key includes the principal.
- Demo analytics is off: the local adapter has no activity sink and no consent provider is configured.
- Chat drafts can contain text, so real personal, student, or institutional data must not be entered in the demo.

### Production

`configureInstitutionLMS` now requires a durable `LearningStateService`. `HttpInstitutionAdapter` supplies the default production implementation:

- `GET /lms/v1/learner-state` loads one exact kind/scope.
- `PUT /lms/v1/learner-state` saves a validated record with an idempotency key.
- `DELETE /lms/v1/learner-state` removes the exact kind/scope with an idempotency key.
- `POST /lms/v1/learning-activity` is a separate optional analytics channel.

The server must derive the principal from the access token, ignore or reject any cross-principal claim in the body, authorize course/content/conversation membership, encrypt sensitive state at rest, enforce the documented retention, and make idempotency keys durable for the retry window. An HTTPS transport alone is not an authorization boundary.

## Consent and privacy boundary

Operational resume state is necessary product data and is not reused as analytics. Activity transmission occurs only when all of these are true:

1. the institution configured an activity sink;
2. it configured a consent callback for the exact scope;
3. that callback returns affirmative consent and a bounded notice version.

Activity events contain IDs, event type, timestamp, and optional numeric position/progress. They do not contain chat text, assessment answers, page URLs, provider resume tokens, media names, or course content. Preview mode does not write learner resume state or activity.

## Cross-origin embed limitation

The external-site iframe keeps scripts but omits `allow-same-origin`. Combining those two permissions would weaken the sandbox. As a result:

- the LMS cannot read the iframe DOM, URL changes, scroll position, forms, answers, or local storage;
- ordinary `postMessage` from the opaque sandbox has origin `null`, so an exact provider web origin cannot be authenticated safely by the generic host;
- a successful iframe `load` event proves only that the browser fired the frame load event, not that the learner viewed or completed material;
- focus, reload, and “open separately” are LMS host controls, not provider progress.

The code includes strict metadata/message validators as a capability contract for a future, separately reviewed integration. They are not wired to the generic iframe. A deployable provider integration needs an authenticated server-side standard or broker (for example an institution-approved LTI/xAPI-style launch and callback), explicit field allow-list, consent notice, replay protection, provider allow-list, and provider-specific retention/deletion rules.

## Error, retry, and idempotency notes

- Local state writes are serialized so a slower earlier write cannot overwrite a later interaction.
- HTTP state writes and deletes carry idempotency keys; activity events use their event ID as the idempotency key.
- Assessment drafts already serialize repository writes and confirm the repository record before declaring submission success.
- Chat draft state preserves the message client ID. A retry of the same compose fingerprint reuses it; changing content after an uncertain send creates a new logical ID.
- Restore corruption is erased and surfaced where the user can act. Save failures appear in the relevant course, assessment, study-set, or chat UI; the next interaction retries with current state.
- There is no general-purpose offline mutation queue for resume state. Production deployments that require offline authoring need a separately designed encrypted queue and conflict policy.

## Explicitly deferred roadmap

The following are intentionally not part of this MVP:

- course notification UI, due-date summaries, and viewed/submitted/new-content indicators;
- full Learn/flashcard content expansion and active-session restoration;
- generic media playback resume;
- durable hosted-workspace editor/check state;
- generic cross-origin click/answer/completion tracking;
- unsaved teacher authoring-form recovery and pending attachment handle recovery.

