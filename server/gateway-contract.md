# Reference written-assessment gateway

This is an implemented, locally tested increment of W04–W07. It is **not the complete institution backend or an approved production deployment**. The production app bootstrap still requires its full service set. This gateway is not wired into the normal app sign-in screen and does not replace the synthetic demo.

## Supported workflow

A verified, explicitly mapped OIDC identity receives the existing application cookie. An operator provisions a course, its term dates and its enrollments. A teacher or TA creates an individual assessment with 1–20 written questions. A student saves one draft, resumes it, and submits once. Staff assign per-question scores and feedback, save an unreleased grade, then release it. Canonical readback and database reopening preserve the records.

The HTTP adapter and actual client repositories exercise this sequence in `tests/reference-gateway.test.ts`; separate server tests use the real auth handler with a synthetic identity-provider interface. `server/tests/auth.test.ts` tests actual OIDC processing/signatures with synthetic provider responses. None of these is a live-provider browser acceptance test.

## Enable and provision

Use the same private configuration and database as the [authentication service](./README.md). Set all three additional environment values; leaving all unset retains auth-only operation. Partial values fail startup:

```dotenv
LMS_INSTITUTION_ID=example-school
LMS_INSTITUTION_NAME=Example School
LMS_INSTITUTION_TIME_ZONE=America/Toronto
```

The descriptor is bound to the database at initialization. Changing it requires a planned migration; changing an environment variable cannot switch the installation to another tenant. The database and learning tables share one host/file with identity/session records. AuthStore must initialize the file before GatewayStore opens it; the main service and provisioning commands do this automatically.

Provision approved issuer/subject mappings first, using the existing authentication command. Stable LMS identifiers use at most 128 ASCII letters/digits plus `.`, `_`, `:`, `-`, beginning with a letter/digit. Names have at most 500 characters. Then, for synthetic test accounts:

```sh
node --env-file=/absolute/private/auth.env server/provision-gateway.ts course course-001 "Example course" 2026-09-01T00:00:00Z 2027-01-01T00:00:00Z
node --env-file=/absolute/private/auth.env server/provision-gateway.ts enroll course-001 teacher-001 teacher
node --env-file=/absolute/private/auth.env server/provision-gateway.ts enroll course-001 learner-001 student
node --env-file=/absolute/private/auth.env server/main.ts
```

`teacher`, `ta`, and `student` are the supported course roles. A global administrator flag grants no implicit course access. Provisioning is a local operator command, not a public enrollment API. The same service/configuration shape supports either agreed operating profile.

Route `/lms/v1/snapshot` and `/lms/v1/mutations`, in addition to the authentication routes, through the **same HTTPS origin and trusted loopback proxy**. Preserve Origin, Cookie, Set-Cookie, ETag, If-Match and Idempotency-Key; disable caching; enforce body/concurrency/rate limits; redact credentials, callback query strings and answer bodies from logs. No CORS or forwarded-header authentication is supplied.

## Transport and data contract

| Endpoint | Contract |
| --- | --- |
| `GET /lms/v1/snapshot` | Authenticated schema `1.0` full snapshot, restricted to courses with active access; only the learner's submissions unless that principal is course staff |
| `GET /lms/v1/snapshot?cursor=...` | Always a full snapshot when changed; no delta-history promise. Exact current `If-None-Match` returns 304 |
| `POST /lms/v1/mutations` | JSON `{schemaVersion:"1.0", atomic:true, cursor?, mutations:[...]}`; 1–10 operations, at most 1 MiB; exact Origin, valid cookie, Idempotency-Key and current If-Match required |

`content/create` accepts the existing content shape with `category=coursework`, `presentationSlot=current`, `isGraded=true`, `gradingCategory=Assessments`, `workType=individual`, and optional `submissionTarget=in-app`. Questions require unique IDs, a label, text content, `answerType=text`, and 1–1000 integer points. `quizConfig` must be `{questionsPerPage:"all",maxAttempts:1,allowRevisit:true}`. Title/description are supported; timers, due dates, groups, answer keys, files and other question types are rejected. Content is immutable in this increment.

`submission/create` and `submission/update` accept the existing submission shape plus `expectedRevision`. The server supplies identity/name, timestamps, revisions and attempt number. Learners may write answers as strings or null; submitted attempts must contain every question, using null for an unanswered question. Only draft → draft/submitted is allowed, during the server-checked course term. Attempts are capped at one per learner/item, including drafts.

Staff updates require an existing submitted/graded record, `status=graded`, `gradeStatus=draft|released`, `expectedRevision`, `expectedGradeRevision`, and a valid score for every response. Answers and ownership cannot change. Totals and grader audit fields come from the server. A default single `question-id:overall` rubric total is accepted when it equals the score. Other rubric features are unsupported. Grades may be corrected or withdrawn to draft with another authorized revision; notification/history UI is future work.

Every unknown field/unsupported operation fails the batch. A failure returns a redacted JSON error and an HTTP failure status, with no partial acceptance. Success returns accepted mutation IDs, an empty rejected array, the next cursor and the matching ETag. A stale snapshot returns 412; conflicting revisions/attempts or reused keys return 409; missing snapshot preconditions return 428.

The server projects unreleased grades as submitted, with answers only: no scores, grader, feedback or grading result is exposed to students. Roster directory entries contain names/IDs/roles without email or global roles. Full course rosters are visible to course participants in this reference profile; the first customer's roster/privacy policy must be agreed before a pilot.

### Cookie client mode

`HttpInstitutionAdapter` now accepts:

```ts
new HttpInstitutionAdapter({
  baseUrl: window.location.origin,
  authentication: 'same-origin-cookie',
  tenantId: 'example-school',
});
```

This mode requires the exact HTTPS browser origin with no path prefix and no `getAccessToken`. Fetch uses `credentials: 'same-origin'` and `redirect: 'error'`. The browser supplies the HttpOnly cookie and POST Origin. JavaScript does not read or copy cookie credentials. Bearer mode remains the default and explicitly omits cookies. Cookie mode refuses native/server use without a browser origin and is not yet an app bootstrap/auth-screen integration. Asset and AI transports remain separate work.

### Atomicity, retries and revocation

Learning transactions acquire `BEGIN IMMEDIATE` on the same SQLite file as account disablement/session revocation. Identity is checked again inside that transaction after the request body is read; enrollment permission is checked for each operation. Unauthenticated or revoked principals cannot read acknowledgements by replaying an old key.

Acknowledgements are durable and scoped to the principal/key. Retrying **identical bytes and the original If-Match with the same key** returns the original acknowledgement, including after reopening the database. A changed request under the same key is rejected. Mutation IDs also cannot be applied twice under a different key. The digest excludes cookies, so a newly authenticated session for the same authorized principal can retry. It covers the original body and precondition.

This is a server retry guarantee. The existing client adapter creates a fresh batch key per call and does not persist/replay a pending batch after application restart. A client outbox and explicit uncertain-commit recovery are still needed before promising reliable offline/retry behavior. Canonical readback after successful writes is tested.

ETags are principal scoped and advance on any installation learning/provisioning write. This conservative installation-wide conflict scope can reject unrelated concurrent course changes. Finer scoped versions, workload/concurrency measurements and retry UX remain work.

To revoke one course's access:

```sh
node --env-file=/absolute/private/auth.env server/provision-gateway.ts enroll course-001 learner-001 remove
```

This suspends access without deleting the historical enrollment. The principal immediately loses that course in snapshots and all mutations/replays are denied. Other authorized participants retain the roster entry, labelled `Access suspended` in `secondaryRoles`, so historical submission owners/graders continue to satisfy the existing schema. Re-enrolling explicitly reactivates access. Changing a historical grader to a student is rejected; suspension remains available. The global `provision.ts disable` command revokes all sessions and prevents sign-in. A future schema should model historical enrollment/access status directly, with the associated retention and roster policy.

## Bounds, operational limits and next work

The reference limits are 100 courses, 1,000 retained enrollments, 100 assignments per course, 20 questions per assignment, 10,000 characters per question/answer/feedback, 8 MiB per serialized snapshot, 100,000 durable batch acknowledgements and 1,000,000 audit events. These are protective ceilings, not tested capacity/SLA claims. Audit rows record actor, operation, course/entity IDs and server time, not answer bodies. They are transactional database records, not an immutable external audit service. Retention/export/monitoring and operator capacity alerts are not implemented; reaching a capacity ceiling fails closed. No automatic acknowledgement pruning silently expires retry guarantees.

Still required before a real-data pilot:

- Live issuer/client registration, HTTPS proxy and browser cookie/CSRF/redirect acceptance; real app auth-screen/route lifecycle and capability-aware bootstrap.
- An explicit offered feature profile. This increment advertises only course/roster reads, content create, submission read/write and grade read/write. It does not supply coursework editing/deletion, multi-attempt or auto-graded assessments, chat, files/AI, live sessions, content progress or durable learner preference/activity services. Do not substitute demo adapters to pass production gates.
- A durable client outbox, uncertain-commit recovery, conflict UX and rendered/browser journey tests; native authentication separately.
- Versioned upgrades/migration tests, backup/restore drills, encrypted infrastructure/backups, retention/export/deletion and historical enrollment policy.
- Deployment packaging, health/readiness and redacted operational logs/alerts, trusted edge limits, measured load/recovery behavior and operator/support ownership.

The current SQLite design uses synchronous work on one host and does not establish HA, multi-replica operation or a hosted staging environment. Existing production acceptance gates remain unchanged.
