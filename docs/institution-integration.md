# Institution integration contract

The LMS is backend-agnostic through a versioned JSON gateway. It does **not** connect a mobile client directly to an institution database. Each institution maps its SIS/LMS/database model to this contract behind its own authenticated API. This keeps database credentials, tenant authorization, field mapping, and data-governance logic on the server.

The current contract version is `1.0`. A complete example is in [`institution-sync.example.json`](./institution-sync.example.json).

## Required bootstrap adapters

A production bootstrap must replace every demo adapter before rendering authenticated routes. The preferred single entry point is:

```ts
configureInstitutionLMS({
  repositories: {
    adapter: new HttpInstitutionAdapter({
      baseUrl: 'https://lms-gateway.institution.edu',
      tenantId: 'institution-id',
      getAccessToken,
    }),
    getSessionUser,
    login,             // starts/resumes institution OIDC or SAML sign-in
    logout,
    lookupDirectoryUser, // authenticated exact ID/email lookup for enrollment
    subscribeToMessages, // authenticated WebSocket or SSE bridge
    liveSessions,        // authenticated LiveSessionRepository implementation
  },
  assetService: new HttpAssetService({
    baseUrl: 'https://lms-gateway.institution.edu',
    getAccessToken,
  }),
  aiService: new InstitutionAIService({
    baseUrl: 'https://lms-gateway.institution.edu',
    getAccessToken,
  }),
  snapshotCache, // optional encrypted InstitutionSnapshotCache
});
```

If live sessions, asset storage, AI, or authentication are not configured, those operations fail closed with a visible error. Production code must not use the bundled demo repositories.

`HttpInstitutionAdapter` also supplies the bounded chat-history endpoint described below. A non-HTTP/custom adapter can implement `InstitutionAdapter.loadMessagePage`, or inject the equivalent `repositories.loadMessagePage` callback when its chat service is separate from the snapshot gateway.

## Architecture-neutral connectors

The mobile/web client has exactly one institutional integration: this gateway contract. OneRoster, LTI, Ed-Fi, vendor REST/GraphQL APIs, scheduled CSV feeds, message buses, and legacy databases are **server-side connector concerns**. A connector translates its source into the canonical snapshot and mutation shapes; it never adds provider SDKs, database credentials, or provider-specific role logic to the app.

Snapshots should declare every upstream source and its effective capabilities:

```json
{
  "integrations": [{
    "id": "district-oneroster",
    "kind": "oneroster",
    "displayName": "District OneRoster",
    "version": "1.2",
    "capabilities": ["courses.read", "roster.read", "grades.write"]
  }]
}
```

`kind` is intentionally open so a new standard or vendor does not require an app release. Capabilities are closed and validated so a connector cannot silently advertise behavior the client does not understand. When descriptors are present, unsupported course, roster, content, submission, grade, or chat writes fail before network transport. An omitted `integrations` field preserves compatibility with legacy schema-1.0 gateways and means they implement the full mutation contract; new gateways must declare capabilities explicitly. An empty array is read-only/no-upstream and does not inherit legacy behavior.

The gateway owns a durable mapping table from `(tenant, sourceId, entityType, externalId)` to the contract's stable opaque ID. Never concatenate display labels or use array positions as identity. When several upstreams contribute data, the gateway also owns field authority and conflict rules—for example, the SIS may own enrollment while the LMS owns coursework and this app owns flashcard review history.

See [`architecture-compatibility.md`](./architecture-compatibility.md) for connector profiles, ownership rules, and acceptance requirements.

## Authentication and authorization

- Use institution SSO (OIDC/OAuth 2.1 or a server-mediated SAML exchange). The client callback must return the subject currently authenticated by the institution.
- Access tokens should be short-lived, audience-restricted, tenant-bound, and stored using the platform secure credential store—not AsyncStorage.
- Offline snapshot caching is opt-in and must be encrypted, principal-keyed, cleared on logout/account removal, and protected by the device credential boundary. Cache APIs receive the authenticated principal ID; implementations must never share a cache key across accounts. The app caches only complete validated principal projections after a successful repository load or acknowledged mutation. A cache read never mutates demo/global repositories, never overrides a successful network response, and is used only as a whole-snapshot fallback with a visible stale-data warning. Cache read/write/erase failures are surfaced rather than silently ignored.
- The server is the authorization authority. Client role checks are presentation safeguards only.
- Enforce course membership, group membership, staff-only announcements, grade permissions, live-session host permissions, and object access on every server request and subscription event.
- Never accept `senderId`, `gradedBy`, tenant ID, or role solely because the client supplied it. Derive or verify them from the authenticated principal.
- A tenant/global administrator claim does not automatically become a course role in the client contract. Enroll that subject explicitly with course role `admin` when course-level access is required; this preserves authoritative `createdBy`, sender-role, and `gradedBy` audit validation.

Course permissions are intentionally separated:

| Capability | Allowed course roles |
| --- | --- |
| Author/manage content, host live assessments, grade, staff-only chat | `teacher`, `ta`, `admin` |
| Configure course identity, dates, weights, roster, and AI syllabus import | `teacher`, `it`, `admin` |
| View roster | `teacher`, `ta`, `it`, `admin` |
| View student grade analytics | `teacher`, `ta`, `admin` |

## Snapshot endpoint

`GET /lms/v1/snapshot?cursor=<opaque>`

Headers:

- `Authorization: Bearer <token>`
- `X-LMS-Schema-Version: 1.0`
- `X-Institution-Id: <tenant>` when the gateway is multi-tenant
- `If-None-Match` may be used for conditional retrieval

When the gateway uses entity-set ETags, return the current value in the HTTP `ETag` response header (or the validated snapshot `etag` field). The standard adapter preserves the header and sends it on conditional reads and writes. Cursor/ETag values are opaque, bounded to 2,048 characters, and rejected if they contain control characters.

Return a complete `snapshot` or an `upsert` payload matching the example. Initial snapshots are self-contained. Cursor upserts may omit unchanged `users` and `courses`, and may reference users, courses, content items, threads, messages, and submissions from the previously validated snapshot. New or changed course entries remain complete course imports. Payloads are validated atomically; references absent from both the upsert and its validated base snapshot, duplicate IDs within the upsert, unsafe URLs, invalid grading totals, incomplete assessment responses, oversized values, and unsupported schema versions reject the entire payload.

Cursor upserts reconcile removals with a `deletions` object containing stable ID arrays for `users`, `courses`, `contentItems`, `threads`, `messages`, and `submissions`. Updating and deleting the same ID in one payload is rejected. Tombstones are idempotent, but every dependent record must also be removed in the same atomic upsert; for example, removing a thread also requires message tombstones, and removing a course requires tombstones for its threads and submissions. The client applies the upsert and then revalidates the complete effective snapshot, preventing an add/drop or provider delete from leaving orphaned or stale state.

Use stable, opaque institution IDs. Timestamps are Unix milliseconds or unambiguous ISO-8601 values. Institution and optional course `timeZone` values are IANA identifiers; a course inherits the institution zone when omitted. Scheduling fields such as `availableDate` and `displayDate` must be epoch instants or ISO-8601 date-times with an explicit offset. Device-local strings such as `2026-11-01 01:30` are rejected because they vary by device and may be ambiguous at DST transitions. Course grading weights, when present, must total 100. Content and attachment URLs must be authorized, credential-free HTTPS URLs. Gateways should resolve internal/opaque asset IDs to short-lived signed HTTPS URLs rather than exposing an unrenderable private URI scheme.

Directory email is optional. Authentication and enrollment record matching use the institution subject/stable user ID; the course enrollment control accepts that ID and treats a disclosed email only as a directory-search convenience. Production enrollment of a user who is not already in the principal projection uses the authenticated `lookupDirectoryUser` option, which must return exactly one policy-authorized record matching the requested stable ID or email. The response is schema-validated and session-bound before any roster mutation; arbitrary user metadata is discarded. An email address is display/contact data and must never be synthesized or used as the durable join key. Provider roles must be mapped explicitly into the app's course roles, with unmapped provider detail retained only as bounded metadata or secondary labels.

The snapshot is principal-scoped, never institution-wide: return only courses, conversations, messages, submissions, and directory identities the authenticated subject may access. Students may receive only their own or their group's submissions; authorized course graders may receive the course grading set; direct messages require participation. The client atomically rejects inaccessible courses, conversations, submissions, answer keys, and grades. As an additional retention boundary, it discards directory identities that are not referenced by an authorized course or existing direct conversation before repository state or the encrypted offline cache is populated. This is defense in depth—not a substitute for row-level server authorization. Never put a whole-tenant roster, gradebook, or message archive into a client payload.

Learner course projections retain only the roster identity fields needed for access checks, groups, forums, and mentions (`id`, `name`, and course `role`); peer email, secondary-role labels, and user metadata are removed. Roles with `viewRoster` permission receive disclosed course-roster email and enrollment secondary roles, but arbitrary user metadata remains outside the app projection. The direct-message discovery repository always returns only `id`, `name`, and `role`, including for staff. Valid discovery targets are shared-course roster members and participants in an existing authorized direct conversation. Institutions that permit broader people search must implement a separate authenticated, policy-filtered, paginated search endpoint rather than placing a tenant directory in the sync snapshot.

Student-scoped course payloads must also remove `questions[].correctAnswer`, `questions[].customConfig.testCases`, solutions, private rubric keys, and equivalent secrets from metadata. Staff-authoring snapshots may include them. The client rejects explicit answer keys/test cases in a learner projection. For submissions whose `gradeStatus` is not `released`, learner projections must also omit totals, per-response scores/correctness, grader feedback, rubric scores, grader identity, and grading timestamps. The server must grade submitted raw answers authoritatively and must never trust client-supplied `score`, `isCorrect`, `totalScore`, timer, lateness, grader, or grade-release fields.

The schema is strict: unsupported fields are errors rather than silently discarded. Every institution content item and assessment question needs a stable backend ID; array-position fallbacks are rejected because reordering JSON must never change mutation, response, or grade references. Put JSON-safe institution extensions under `metadata`; each extension object is limited to 65,536 serialized characters, 12 levels, and 10,000 values. Identifiers are limited to 256 characters, human labels to 500, URLs to 8,192, and an institution payload to 10 MB. Assessment items permit at most 1,000 questions, 500 options per question, and 200 rubric criteria per question. These are client safety ceilings, not recommended page sizes.

The default client request and response limits are 10 MB and configuration is bounded to 100 MB. Response readers cancel the stream as soon as the byte limit is crossed where the runtime exposes streaming; runtimes without fetch streams still fail after bounded contract checks. Large authorized scopes should use cursor-based, bounded upserts rather than full snapshots. Chat histories, gradebooks, and large rosters need server pagination/cursors; do not enlarge the mobile snapshot until it becomes an archive.

## Course groups and learner study cards

Assignment membership uses first-class `course.groupSets[]`, each containing stable groups and `memberIds`. Group coursework and group chat reference `groupSetId` plus `groupId`. `secondaryRoles` remains suitable for section/cohort labels but is not an assignment-group authority. A legacy single-group projection can be inferred for compatibility, but the validator emits a warning and institutions should migrate to explicit group sets.

AI-generated and institution-authored review cards use `ContentItem.studyCards`, only on ungraded `material` items. They must never be encoded as `questions[].correctAnswer`, because correct answers are assessment secrets that learner-scoped gateways must remove. A study-card item looks like:

```json
{
  "id": "study-set-stoichiometry",
  "category": "material",
  "title": "Stoichiometry review cards",
  "presentationSlot": "current",
  "createdAt": "2026-09-05T14:00:00Z",
  "studyCards": [
    {
      "id": "study-card-1",
      "front": "What does a stoichiometric coefficient represent?",
      "back": "The relative number of particles or moles in a balanced reaction.",
      "tags": ["stoichiometry"],
      "sourceExcerpt": "Coefficients give relative particle and mole ratios.",
      "sourceLocation": "Week 1 notes, page 4",
      "confidence": 0.97,
      "reviewerVerified": true
    }
  ]
}
```

Cards require unique IDs and non-empty fronts/backs; a set supports at most 500 cards. Evidence and review/provenance metadata should be retained. A content item cannot mix `studyCards` with assessment `questions`.

## Atomic mutation endpoint

`POST /lms/v1/mutations`

The request contains:

```json
{
  "schemaVersion": "1.0",
  "cursor": "opaque-sync-cursor",
  "atomic": true,
  "mutations": [
    {
      "id": "mutation_uuid",
      "entity": "submission",
      "operation": "update",
      "entityId": "submission_123",
      "occurredAt": 1784476800000,
      "payload": {
        "revision": 4,
        "expectedRevision": 3,
        "gradeRevision": 2,
        "expectedGradeRevision": 1
      }
    }
  ]
}
```

The `Idempotency-Key` header identifies the batch. The server must commit an atomic batch entirely or reject it entirely, persist idempotency results, and use optimistic revision checks for submissions/grades. Return:

```json
{
  "acceptedIds": ["mutation_uuid"],
  "rejected": [],
  "nextCursor": "opaque-next-cursor",
  "nextEtag": "\"entity-set-version-42\""
}
```

Every requested mutation must appear exactly once in either `acceptedIds` or `rejected`. Unknown IDs, duplicates, overlap, malformed rejection records, and missing acknowledgements are treated as failures, and repository-confirmed UI state is not committed.

If the current snapshot carries an ETag, the client sends it as `If-Match`. A successful mutation response must return a different authoritative ETag in the HTTP `ETag` header or `nextEtag`; missing, unchanged, conflicting header/body, malformed, and unsupported acknowledgement fields fail closed. Custom adapters follow the same `nextEtag` rule.

An acknowledgement is not the canonical record. After a write, production configuration requests a complete snapshot without a cursor or ETag, validates it, and only then returns success and updates the local cursor, cache, and returned records. The gateway must provide read-your-writes consistency on that read; `304` and incremental responses cannot satisfy it. Reads and writes share a client queue so a refresh cannot detach an in-flight commit. If readback fails after the server accepted a write, its outcome may already be committed: refresh before retrying, and retain server-side idempotency and revision checks. This does not provide an offline mutation queue or cross-device locking.

`configureInstitutionLMS` / `configureInstitutionRepositories` always enable `requireCanonicalMutationReadback`. Low-level `createInstitutionRepositoryFactory` retains compatibility with metadata-free legacy adapters unless that option is explicitly enabled; adapters returning any cursor/ETag always trigger canonical readback. Production callers must use the configuration entry point or explicitly enable the option.

Production configuration also requires an app-session `logout` callback. Logout revokes local access immediately, cancels subscriptions, invalidates pending results and retained repository data, waits for earlier provider sign-in callbacks, calls provider logout, and verifies that `getSessionUser()` returns `null`. Cache erasure follows pending saves; restores started before erasure are ignored. A missing/failing callback or a surviving provider session is reported as a failure. Preauthenticated startup remains supported; after explicit logout, a new sign-in must call the configured `login` callback. This is app-session logout, not a requirement to terminate every session at the institution's identity provider. Verify cookie/token revocation and reload against the actual deployed provider before release.

Submission creation starts at `revision: 1`; each update must advance by exactly one and carry the prior value as `expectedRevision`. Grade-bearing changes independently advance `gradeRevision` by exactly one and carry `expectedGradeRevision`. Learners may update only their own/group draft and may transition it once to `submitted`; a submitted attempt is immutable to the learner. Staff grading transitions are constrained to submitted/graded/discarded recovery workflows. External grade-column creation must atomically include one ungraded revision-1 placeholder for every enrolled learner or active assignment group.

The client serializes its own read/validate/send/commit transactions, but this cannot prevent races between devices or services. The gateway must use a snapshot ETag or entity revision as compare-and-swap state, reject stale writes with a stable conflict code, and return the authoritative new revision/cursor. Idempotency keys must replay the original result, not perform the operation again. Course/group-set replacement payloads especially require this protection.

Optional fields that the client explicitly clears are sent as JSON `null`; omitted fields mean “leave unchanged.” Group scheduling/reordering is sent as one atomic batch. “Delete” in the course-content UI is a recoverable soft delete: the client sends an `update` with `deletedAt`, and restore sends `deletedAt: null`. Gateways must not translate this workflow into a physical delete. Permanent deletion belongs in an institution-controlled retention job after the recovery window and policy checks.

Graded `external-link` items may omit synthetic questions when they provide `metadata.gradingMaxPoints` as a finite number greater than zero and no more than 1,000,000. Submission `totalScore`, grader display, and analytics use that maximum. `gradingMaxPoints` is rejected on non-external items; external items without answerable questions or a valid maximum are invalid.

## Assets

`HttpAssetService` supports bearer authentication by default and explicitly omits
browser cookies in that mode. An HTTPS web deployment with an implemented asset
gateway at the app's origin can instead use its HttpOnly session cookie:

```ts
const assets = new HttpAssetService({
  baseUrl: window.location.origin,
  authentication: 'same-origin-cookie',
});
```

Cookie mode requires the exact HTTPS browser origin, with no path prefix or
`getAccessToken` callback. Cross-origin, HTTP, native and server-side cookie
configurations fail closed. The browser supplies the cookie and Origin; do not
copy cookies or CSRF state into a bearer-token callback. Cookie requests use
[`credentials: 'same-origin'`](https://developer.mozilla.org/en-US/docs/Web/API/Request/credentials)
and `mode: 'same-origin'`. Both modes reject redirects and disable request caching.
These client controls do not replace server authentication, exact Origin/CSRF
checks, or authorization for the current tenant, course and conversation.

The client captures the file metadata, browser Blob, destination, purpose and
request key before credential lookup. It rejects invalid inputs before accessing
credentials. A 120-second deadline covers credential lookup, upload and response
reading; oversized or unfinished response streams are cancelled. Native URI
contents remain the native transport's responsibility. A timeout does not prove
that the server discarded an upload: retain the logical operation's idempotency
key for reconciliation or an explicit retry. The client does not retry or fall
back automatically. A token provider or custom transport that ignores cancellation
cannot keep the caller waiting, but its own underlying work must be bounded too.

The reference server does not yet implement this asset route or storage. Do not
enable production uploads until the following contract and operating controls
are implemented and verified against the configured deployment.

`POST /lms/v1/assets` accepts multipart form data with `asset`, `purpose`, and optional `courseId`/`threadId`. The server must:

- authorize the purpose and course;
- enforce content-length and decompressed-size limits;
- inspect the actual file signature rather than trusting the filename/MIME type;
- malware-scan and quarantine before release;
- strip active content or force safe download headers as appropriate;
- encrypt at rest, apply retention/legal-hold rules, and issue non-guessable URLs;
- return `{ id, url, name, mimeType, size, sha256 }` with an authorized HTTPS URL.

Course-content and assessment-submission uploads require `courseId`; direct-message attachments require `threadId` and may intentionally have no course. The client supplies a stable `Idempotency-Key` for retryable operations, bounds the response, and rejects missing/invalid SHA-256 digests, credential-bearing/non-HTTPS asset URLs, and oversized returned files. The institution owns malware/DLP disposition, signed-URL renewal, retention, and orphan cleanup.

## AI generation

`POST /lms/v1/ai/generate` accepts multipart form data containing `task`, an allow-listed prompt-version request (`flashcards.v1.5.0` or `syllabus.v1.5.0`), `courseId`, `locale`, `courseTitle`, and either `sourceText` or the selected source bytes in `document`. Flashcard requests also send `requestedCardCount` (1–100). File requests send an explicit `sourceKind` of `document`, `captions`, `audio`, or `video`; the gateway must verify that value against the uploaded file rather than trusting it. The client deliberately does not send a system prompt or response schema; neither is an authoritative client-controlled input.

Remote `InstitutionAIService` requests require a stable `courseId` matching
`[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. The course syllabus and flashcard review flows
supply their actual course ID. The isolated local prepared showcase can omit it
because it does not create or modify a course. Custom `AIService` implementations
receive the optional context as well; institutions must enforce their own server
authorization, not rely on a title, client role or the presence of this field.

Bearer authentication remains the default and explicitly uses `credentials:
'omit'`. Web deployments can opt into `authentication: 'same-origin-cookie'`
with the exact HTTPS browser origin as `baseUrl` and no `getAccessToken` callback.
The browser supplies its HttpOnly cookie and Origin; application JavaScript does
not read or manufacture either header. Cookie mode rejects cross-origin URLs,
path-prefixed bases, non-HTTPS URLs and native/server callers without a browser
origin. Both modes reject redirects and require request-bound response provenance.

The gateway must validate the current principal and installation, check the
course's existence and the task's required staff permission before processing or
charging, enforce exact Origin/CSRF checks for cookie requests, and recheck access
before retaining or returning the result. The reference OIDC service now has an
optional cookie-authenticated AI route with these permission checks, durable
inputs/results/receipts, retained request keys and bounded reservation quotas.
Its [narrow text/caption profile](../server/ai-contract.md) has stricter upload
limits than the general client and does not complete app SSO bootstrap. See the
[AI integration guide](./ai-provider-adapters.md#client-authentication-and-course-scope).

The general client picker accepts PDF, DOCX, PPTX, TXT, Markdown, RTF, VTT/SRT captions, MP3/M4A/WAV audio, and MP4/MOV/WebM video. Client ceilings are 25 MB for documents/captions and 50 MB for audio/video, with a 300-second timeout; these are not a guarantee of backend support. The reference route currently handles only pasted text, TXT, Markdown and VTT/SRT, with a 2,064,000-byte whole-request ceiling and 120-second provider deadline. Syllabus extraction rejects captions, audio and video. Browser uploads contain selected `Blob` bytes, while native uploads retain the platform file URI plus verified metadata.

The server must select the exact allow-listed server prompt/schema for that version, reject unknown or retired versions, scan files, extract/OCR content in an isolated worker, enforce tenant data-residency/retention policy, redact sensitive data where required, and validate structured output against the server-side schema. Production JSON responses must include an attested envelope:

```json
{
  "provenance": {
    "promptVersion": "flashcards.v1.5.0",
    "evidenceVerified": true,
    "sourceSha256": "<SHA-256 of the exact extracted source text>",
    "documentSha256": "<SHA-256 of the raw uploaded bytes; required for documents>",
    "requestId": "<exact X-Request-Id echo>",
    "model": "<optional deployment identifier>"
  }
}
```

`Idempotency-Key` and `X-Request-Id` are supplied on every request. The idempotency key must replay the original result; the request ID binds the response to this request. The model-facing structured-output schema deliberately excludes provenance so a model cannot fabricate hashes or request IDs. The gateway computes and injects the final attestation only after extraction, evidence verification, and response-schema validation.

The client additionally enforces:

- 25 MB document/caption, 50 MB audio/video, and 500,000-character text limits;
- the source formats and task-specific restrictions listed above;
- server-owned prompt versions and response attestations;
- exact source excerpts and precise locations for grounding, including entry-level syllabus evidence and mandatory transcript timestamps/caption cues for audio or video cards;
- duplicate rejection and bounded field/card/list lengths;
- explicit per-card human source verification before saving;
- prompt version, `sourceSha256`, `documentSha256` when applicable, request/model provenance, source, evidence, confidence, and reviewer-edit metadata.

Gateway-controlled provenance may additionally include `sourceReviewNotices`,
an array of at most 10 nonblank processing notes of 600 characters each. These
notes are separate from model-generated syllabus `warnings`; the shared provider
boundary receives them from the extractor and includes them in the saved output
hash. Review views display them as plain text and retain them in publication
metadata. A response declaring `X-LMS-AI-Review-Notices: present` must include
inline notes or the client refuses the draft. Deploy matching clients/gateways;
older stored results with only out-of-band notices require operator inspection.

AI output is never a grade and is never published automatically.

For the reference text/caption gateway, declare `sourceProfile: 'text-v1'` on
`InstitutionAIService` or the custom `AIService`. This aligns picker guidance and
pre-submission validation: TXT/Markdown syllabi; TXT/Markdown/VTT/SRT flashcard
sources; 2 MB combined source bytes and up to 500,000 normalized pasted-text
characters. Unsupported formats and oversized sources fail before credentials or
upload. Ordinary course attachments keep their existing behavior. Undeclared
services retain the general input contract, with institution-dependent guidance;
there is no automatic capability discovery. Prepared demo media remain supported
as saved playback. See the [source profile](../server/ai-contract.md#request-profile).

Optional `requestRecovery: 'status-v1'` enables current-review recovery through
`GET /lms/v1/ai/requests/{requestId}`. The response includes its job `id`, the exact
`requestId`, `courseId`, `task`, `status` (`processing`, `uncertain` or `succeeded`),
`createdAt`, `expiresAt`, `reviewNotices` and a `result` only on success. The result
must carry matching request provenance and inline processing notes. The client
rechecks credentials, source/course/task identity, size limits and result schema.
Checking never submits another generation; a separately labelled new-generation
action can incur another charge. This handle is held in the open review only. The
additional `history-v1` profile provides a bounded, principal/course/task-scoped
history and source-matched recovery after reload. It adds GET `/lms/v1/ai/requests`
with course/task/cursor query fields and POST `/lms/v1/ai/requests/{requestId}/recover`
with the reselected original source and settings. The recovery POST never reserves
a job or invokes a provider, including on missing or expired requests. The UI
requires renewed source consent and human verification. Source download and
restoring unsaved reviewer edits remain work. See the
[reference profile](../server/ai-contract.md#persistence-retries-and-inspection).

Custom institution `AIService` implementations are also treated as runtime trust boundaries. Inputs are validated before the adapter is called; typed results are then revalidated for allowed fields, sizes, grounding, duplicate content, prompt version, and consistent provenance before review. Adapter-supplied `reviewerVerified`/`reviewerEdited` values are discarded; every generated card starts unverified and requires an explicit reviewer action. Every card produced from a document must carry the same valid source/digest attestation, document-generated syllabus results require the same provenance, and the durably retained source asset must have the same `documentSha256` before reviewed output can be published.

Syllabus extraction never edits a course automatically. Titles, descriptions, dates, weights, instructors, required materials, schedule entries, and policies remain in an editable review; every populated scalar and every list entry needs its own source evidence. The reviewer must explicitly verify the result, and the retained source, evidence, warnings, edits, prompt version, hashes, request ID, and review timestamps remain in the course audit metadata. The institution should move large extraction records to its document system rather than increasing the 65,536-character course metadata ceiling.

## Real-time chat and live sessions

Initial chat state comes from the snapshot repository and supports course, assignment-group, and direct user-to-user conversations. Production chat should inject `subscribeToMessages`, backed by an authenticated WebSocket or SSE connection. Events should be ordered, tenant/course authorized, replayable after reconnect, and deduplicated by message ID. When no live bridge is supplied, the repository falls back to authenticated snapshot polling at the configured snapshot TTL; malformed, impersonated, unsafe-attachment, and cross-thread realtime batches are rejected before entering state.

Course/group topics are staff-created forum records rendered as live chat. Every topic should include a stable `id`, `courseId`, `scope`, `title`, `description`, `guidelines`, `kind`, `createdBy`, `createdAt`, and explicit policy flags (`allowStudentPosts`, `allowReplies`, `allowAttachments`, and `allowMentions`). `kind` is one of `discussion`, `q-and-a`, `announcements`, `study-group`, or `office-hours`. `isPinned`, `opensAt`, and `closesAt` are optional. Group topics additionally require a valid `groupSetId` and `groupId`; direct threads require exactly two `participantIds` and no course. Announcement topics must use `kind: "announcements"`, `isAnnouncement: true`, and `allowStudentPosts: false`.

The server must apply both topic and course lifecycle. A course/group topic is scheduled before `course.termStart` or its later `opensAt`, active only while the course status is `active` and both windows are open, and closed after `course.termEnd` or its earlier `closesAt`. Direct messages remain active independently of a course term. Learner posting, replies, attachments, and mentions must each be authorized from the authenticated principal, current membership/group, topic phase, and policy flags; staff-only posting does not make a learner-authored mutation valid. Mention payloads use stable `mentionedUserIds`, but every ID must also correspond to an exact visible `@Display Name` token and to a participant the sender may mention in that course/group/direct scope.

Message history and search use:

`GET /lms/v1/chat/threads/{threadId}/messages?limit=50&cursor=<opaque>&query=<optional>`

- `limit` is a whole number from 1 to 100 and defaults to 50.
- `cursor` is an opaque continuation of at most 2,048 characters. Clients must return it unchanged and must not derive authorization or offsets from it.
- `query`, when present, contains 2–200 trimmed characters. The service searches only the authenticated principal's authorized conversation; the bundled fallback searches text, sender display name, and attachment name.
- A page contains the newest eligible messages before the cursor, ordered chronologically for display. A search page uses the same cursor semantics.

The response is a strict JSON envelope:

```json
{
  "messages": [{
    "id": "message-123",
    "revision": 2,
    "threadId": "thread-123",
    "senderId": "subject-123",
    "senderName": "Course Participant",
    "role": "student",
    "text": "@Learner Name, here is the updated message.",
    "mentionedUserIds": ["subject-456"],
    "timestamp": 1785949200000,
    "editedAt": 1785949260000,
    "readBy": 1,
    "readByUserIds": ["subject-123"]
  }],
  "hasMore": true,
  "nextCursor": "opaque-provider-cursor"
}
```

Unknown envelope fields, oversized pages, missing continuation cursors, invalid/cross-thread messages, unsafe attachments, and session changes during a request are rejected. A reply may point to an older authorized message not present in the current page; until that parent is loaded the UI renders a generic reply indicator. Self-replies, reply cycles, cross-thread targets that are locally known, and later reply-target reassignment are rejected.

Messages start at `revision: 1`. Text edits are author-only and deletion is author-or-authorized-course-staff. Both use exact compare-and-swap revisions through the atomic mutation endpoint:

```json
{ "action": "edit", "expectedRevision": 1, "message": { "id": "message-123", "revision": 2, "editedAt": 1785949260000 } }
{ "action": "delete", "expectedRevision": 2, "revision": 3, "deletedAt": 1785949320000 }
{ "action": "report", "reporterId": "subject-456", "reason": "Bounded moderation reason" }
```

The gateway must derive or verify the actor from the authenticated session, atomically reject stale revisions, and broadcast edits/deletions with a strictly newer revision. Equal- or older-revision content changes are ignored by client reconciliation; read receipts can still merge at the same revision. Deletions are tombstones, not physical deletes: an event may redact message text, but must retain stable message/thread/sender identity, the original timestamp, the advanced revision, and `deletedAt` so stale history cannot resurrect it. Reports must create a separate access-controlled moderation record, be idempotent per reporter/message, preserve evidence according to retention/legal-hold policy, and never expose reporter identity to ordinary participants.

The client now provides bounded message pagination, conversation search, author edits, sender/staff deletion, reporting, revision/tombstone reconciliation, and demo fixtures for course/group/direct interaction testing. Production services still own thread-list pagination, bounded retention, moderation queues and appeals, legal hold, block/mute policy, rate/abuse limits, offline-send idempotency, push delivery, and reconnect gap recovery. Fixture data is not a substitute for those services.

Cross-device quizzes/polls require a `LiveSessionRepository` with:

- `getSession(courseworkId)`;
- `publishSession(courseworkId, state)` for authorized hosts (never `null`);
- `submitAnswer(courseworkId, studentId, questionId, answer)`;
- `finalizeSession(courseworkId, sessionId)` for atomic durable closure;
- `subscribeToSession(courseworkId, listener)`.

Every state carries a globally unique stable `sessionId`, authoritative `startedAt`, and positive `revision`. Creation uses revision 1; every host-controlled question transition must atomically compare against the current run and advance by exactly one. Participant answer writes do not advance this host revision and host payloads never own the answer map—the server preserves authoritative answers while applying a host transition. This prevents a stale host snapshot from deleting a concurrently received answer. The server must reject stale host revisions and answers for stale, locked, expired, or ended questions, derive the student identity from the authenticated session, validate the answer against the current question, and enforce attempt eligibility in the same operation that stores it. A learner with a conflicting draft or no remaining valid attempt cannot answer. The bundled implementation is a bounded same-runtime demo transport only.

`finalizeSession` is a transactional server operation, not a client-side sequence. In one commit it must lock the exact live run, close it, archive its answer map, and create exactly one complete `StudentSubmission` for every participant who answered at least one question. Each archive record must:

- use a stable opaque submission ID and retain `liveSessionId: sessionId` permanently;
- identify the exact course, live content item, enrolled student, authoritative `startedAt`, next attempt number, and `revision: 1`;
- use individual ownership—group live sessions are rejected until a group archive contract is implemented;
- have `status: "submitted"` and contain one response for every non-page-break question, using `null` when that participant did not answer;
- include scoring fields only for graded live quizzes; polls and other ungraded work must not manufacture `score`, `isCorrect`, or `totalScore` values;
- be inserted together with session closure, or not at all.

Finalization must be idempotent on the composite `(courseworkId, sessionId)`. A retry after a lost response returns the same submission IDs and must never insert duplicates, reuse another attempt's ID, or roll an already graded archive back to its original submitted form. Retain idempotency records for at least the institution's maximum client retry/reconnect window. Starting a live session is refused when the adapter does not implement this contract. The client cross-validates returned archives and fails closed, but the service owns atomicity; it cannot clear transient answers first and attempt to save submissions afterward.

After a successful finalization, `getSession(courseworkId)` must no longer return that `sessionId` (a newer run may already exist). Calling `publishSession(courseworkId, null)` is not a deletion mechanism and is rejected; only finalization may remove a run. The client verifies this invariant so an archived session cannot be resurrected by a later realtime event. A newly observed session is not cleared when an older host operation finishes.

Live assessment questions are limited to multiple choice, text/timed text, and spectrum interactions. File uploads and custom-code responses are rejected at author save time for live mode. Optional per-question timers must be whole seconds from 1 to 86,400. Host mutations must be serialized and scoped to the exact coursework ID; the server must still enforce an authoritative session revision so separate host devices cannot overwrite each other.

For timed assessments, the backend must atomically create or resume the attempt and issue authoritative `startedAt`/`timeLimitExpiresAt` values before returning question content. It must enforce deadlines, attempt counts, accommodations, group ownership, late policy, and grading from server time. The client first-view binding and countdown are defense and UX; they are not an anti-cheating trust boundary.

## Learner resume state and optional activity

Production bootstrap requires a durable `LearningStateService`; the authenticated HTTP adapter implements it through:

- `GET /lms/v1/learner-state?kind=<kind>&courseId=<optional>&contentItemId=<optional>&threadId=<optional>&deckId=<optional>`;
- `PUT /lms/v1/learner-state` with one validated versioned record and `Idempotency-Key: <writeId>`;
- `DELETE /lms/v1/learner-state` with the exact versioned scope/kind and a stable idempotency key;
- optional `POST /lms/v1/learning-activity` with `Idempotency-Key: <eventId>`.

The URL intentionally omits `principalId`. The service derives the principal and tenant from the bearer token, verifies any principal carried in a PUT/event body, and authorizes the complete course/content/conversation/deck scope. It must never accept a client principal as authority. Loads return `null` or exactly one record for the requested scope and kind. PUT must return the authoritative record, including the same scope, kind, and write ID; the client rejects mismatches.

Resume records are capped at 64 KB and contain stable IDs and minimal UI position fields. Chat drafts are the only resume class containing free text. Encrypt them at rest, restrict support/administrator access, audit exceptional access, and erase them after seven days. Course page, assessment navigation, and course study-set state expire after 30 days; announcement dismissals and personal course layout expire after 180 days. Enforce expiry server-side and apply immediate deletion/account-erasure policy where required.

Operational resume writes do not authorize analytics. The activity endpoint stays disabled unless the institution supplies a separate scope-aware consent callback. Events are limited to event ID/type/time, scoped IDs, notice version, source, and optional numeric progress/position; reject raw answers, messages, URLs, provider tokens, filenames, or content. Consent withdrawal must stop new events and follow institutional deletion policy for prior events.

Generic external sites are hosted in an opaque-origin sandbox. The client cannot authenticate an ordinary provider `postMessage` by web origin and therefore does not connect its strict provider-message validators to the generic iframe. Provider progress/resume requires a separately reviewed authenticated launch/callback or broker with origin/provider allow-listing, replay protection, consent, retention, and deletion controls. A frame `load` event is not evidence of reading or completion.

See [`saved-state-and-activity-audit.md`](./saved-state-and-activity-audit.md) for the implemented refresh matrix and explicit remaining losses.

## Operational acceptance gates

Before launch, each institution integration needs contract tests using representative anonymized data plus authorization, tenant-isolation, retry/idempotency, compare-and-swap conflict, load, reconnect, accessibility, backup/restore, audit-retention, and disaster-recovery tests. FERPA/PIPEDA/GDPR and local accessibility/data-residency obligations require institution-specific review.

The generic JSON gateway does not imply support for QTI, LTI 1.3/Advantage, OneRoster, SCORM/xAPI, Caliper, SIS grade passback, question banks/randomization, per-user accommodations, anonymous/moderated grading, originality/proctoring, mastery/outcomes, advanced grade schemes, or file-annotation feedback. Institutions that need them must scope and certify those integrations explicitly.

Institution and course `timeZone` values must be valid IANA identifiers (for example, `America/Toronto` or `UTC`). Epoch timestamps cannot be negative, and every course `termEnd` must be later than its `termStart`. Invalid snapshots are rejected atomically before any local state changes.

Schema 1.0 represents current enrollment, not effective-dated enrollment history. An institution that supports add/drop, withdrawal, completion, or reinstatement must add an approved lifecycle extension/version before removing current roster entries that are still referenced by historical submissions, grades, messages, or grader audits. A naive roster delete is intentionally rejected as an orphaning mutation.
