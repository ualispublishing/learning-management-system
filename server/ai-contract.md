# Reference AI gateway

The optional Node/SQLite service connects the application's AI client to the
shared text extractor, provider adapter and result validators. It returns drafts
for review; it does not create courses, apply syllabus fields or publish cards.
The prepared six-file demo remains the default for `npm run web`, with no paid
provider requests. Tests use synthetic external model responses. Real app SSO,
instructor acceptance and deployment acceptance remain separate requirements.

## Enablement and packaging

Configure the [identity service](./README.md) and institution gateway first.
Leave every `LMS_AI_*` variable unset to disable generation. Partial configuration
fails startup. Set these only in private operator configuration:

| Variable | Value |
| --- | --- |
| `LMS_AI_PROVIDER` | `openai`, the built-in named connector |
| `LMS_AI_MODEL` | Institution-approved API model or snapshot |
| `LMS_AI_OPENAI_API_KEY` | Server-only provider credential |
| `LMS_AI_MAX_OUTPUT_TOKENS` | Required integer, 1–200,000 |
| `LMS_AI_REASONING_EFFORT` | Optional: none, minimal, low, medium, high or xhigh |
| `LMS_AI_RETENTION_HOURS` | Required integer, 24–720 |
| `LMS_AI_DAILY_REQUEST_LIMIT` | Required installation limit, 1–1,000 |

Confirm the chosen model supports the schema, effort and token budget; numeric
configuration bounds do not establish model support. `createAIGateway` also
accepts an injected `AIProvider` for another institution connector, which needs
its own request/response mapping and acceptance tests.

Preserve the repository layout at deployment: `server/` imports pure shared
modules in `src/lib/ai/` and `src/lib/id.ts`. Shipping only `server/` is insufficient.
Runtime installation uses the server lockfile; these modules do not require
Expo. Native Node may issue a benign module-type detection warning for shared
TypeScript under the app's CommonJS package. The web bundle excludes the
credential-bearing provider, extractor and gateway.

The listener binds loopback behind the exact configured HTTPS application
origin. Run one service process per installation/database: startup recovery
and generation capacity assume a single instance. Horizontal scaling needs
an extended and verified storage/job model.

## Request profile

`POST /lms/v1/ai/generate` uses the application session cookie and requires the
exact configured `Origin`. It rejects bearer authentication, cross-site requests
and mismatched installation/schema headers. The HTTP bridge checks the session
before buffering uploads. Session and course permissions are rechecked before
generation and before committing/returning output.

- `Idempotency-Key` and `X-Request-Id` must be identical stable IDs matching
  `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. The current client sends this pair.
- Use multipart fields `task`, `promptVersion`, `courseId`, `courseTitle`,
  `locale`, `requestedCardCount`, `sourceText`, `document` and `sourceKind`.
  Unknown/duplicate fields fail. Tasks are `flashcards` and `syllabus`; versions
  are `flashcards.v1.5.0` and `syllabus.v1.5.0`. Server code selects prompts/schema.
- The stored course title replaces client `courseTitle` as model context.
  Locale defaults to `en`. Flashcard count is 1–100, default 30; syllabus omits it.
- Active course teachers can request both tasks; active TAs can request cards.
  Students, outsiders and unrostered global administrators cannot.
- Supply nonblank pasted text, one file, or both. Supported files are UTF-8 TXT,
  Markdown, VTT and SRT. Files require matching `sourceKind` (`document` or
  `captions`); syllabus rejects captions. Unsupported files fail before a job
  or provider call is created.

Declare `sourceProfile: 'text-v1'` when configuring the matching
`InstitutionAIService` (or custom `AIService`). The syllabus picker then filters
to TXT/Markdown; both review flows display the connected service's limits and
reject unsupported AI sources before credential lookup or upload. General course
attachments remain unrestricted by this AI-only profile. The client allows at
most 2,000,000 combined source bytes, leaving space for multipart overhead below
the gateway's 2,064,000-byte request ceiling. It counts actual Blob bytes and
UTF-8 pasted text with multipart CRLF normalization; pasted text is also capped
at 500,000 normalized characters. Native file selections need a known size.

This declaration is not automatic capability discovery or server authorization.
An undeclared service retains the general client contract and shows institution-
dependent guidance. The prepared demo keeps its bundled media and saved results.
PDF/DOCX/PPTX/RTF, OCR and arbitrary audio/video transcription still need bounded
workers. Selecting a vendor/model does not add those extraction capabilities.

## Persistence, retries and inspection

Before calling a provider, the service commits a `processing` job with principal,
course, task, effective input, canonical source/passages, extraction metadata
and original file bytes. Multipart text is retained as received; browsers may
normalize its line endings on the wire. File hashes cover exact uploaded bytes.

After shared schema and quote/location validation, a transaction rechecks access
and saves the result plus any provider receipt. OpenAI receipts include the
API-reported model, response/request IDs, effective request hash, source/output
hashes, configured reasoning effort and token counts when supplied. Credentials
are not stored in these artifacts. Invalid output is not retained as a result;
quote checks do not prove educational accuracy.

Within retention, the same principal/key/effective input replays successful JSON
without another provider call. Changed input gives `409 idempotency_key_reused`;
pending work gives `409 ai_request_in_progress`. Provider failure, timeout,
cancellation or access revocation after reservation marks the job `uncertain`.
Retry then gives `409 ai_outcome_uncertain`. Startup marks interrupted processing
jobs uncertain. There is no automatic retry or fallback. A new key can incur
another charge; operator reconciliation with the provider remains necessary.

`GET /lms/v1/ai/requests/{key}` requires the same principal and current course
permission. It returns `id`, `requestId`, `courseId`, `task`, `status`, optional validated
`result`, `reviewNotices`, `createdAt` and `expiresAt`. Raw sources and receipts
currently require authorized operator database access. Generation leaves course
records and snapshot ETags unchanged.

Extraction notices are returned inline as `provenance.sourceReviewNotices`,
bounded to 10 nonblank strings of at most 600 characters each. They come from the
gateway's extractor, not generated task JSON, and are included before calculating
the saved output receipt hash. Successful responses also set
`X-LMS-AI-Review-Notices: present`; the status route retains `reviewNotices`.
The client renders notes as plain text in flashcard and syllabus review and
preserves them in publication metadata. Staff can also see saved syllabus notes.
Notes never count as instructor approval.

Deploy the matched client and gateway together. A response declaring notices but
omitting them inline fails client validation, including replay of older records
that only stored notices separately. Do not rewrite old results/receipt hashes to
hide that mismatch; an operator can inspect their saved status/source record.
The web client can opt into this status contract with
`requestRecovery: 'status-v1'` when constructing `InstitutionAIService`. After a
submitted request fails, the current flashcard/syllabus review retains its key
and offers **Check saved result**, a read-only GET. It checks current credentials,
request ID, course, task, source snapshot, response limits, provenance and notices.
Recovered drafts still require human review. Pending/uncertain/missing/expired
or forbidden records do not cause a new POST. The separate **Start a new
generation** action uses a fresh key and explains that it may create another charge.

Recovery checks have a 30-second deadline; credentials, transports and streaming
bodies cannot keep the caller waiting after cancellation. Injected transports
must still honor the signal to stop their own underlying work. There is no
automatic polling, retry or provider fallback.

The `status-v1` handle lasts only in the open review. No source, credential or
request history is written to browser storage. Institutions without a recovery
profile keep the ID and explicit new-generation action without speculative calls.

### Recovery after reload: `history-v1`

The reference gateway additionally implements `requestRecovery: 'history-v1'`.
This includes status recovery plus **Find saved AI requests** in both editors.
Reselect the original source, confirm processing rights, find a request, then
choose **Recover with selected source**. This retrieves the original generated
draft; unsaved reviewer edits and prior review approval are not restored.

- `GET /lms/v1/ai/requests?courseId={id}&task={flashcards|syllabus}&cursor={id}`
  returns `{ items, nextCursor }`. Omit `cursor` for the newest page. Each item
  contains `id`, `requestId`, `courseId`, `task`, `status`, `createdAt`, `expiresAt`,
  `fileName` (nullable), `hasPastedText`, `locale` and `requestedCardCount`.
  Pages contain at most 20 summaries, ordered by creation time then job ID,
  newest first. A non-null `nextCursor` equals the last item ID. Rows and cursors
  belong to the current principal/course/task; expired cursors require refreshing
  the first page. Unknown or duplicate query fields are rejected. Source text,
  bytes, results and receipts are excluded; client responses are capped at 64 KB.
- `POST /lms/v1/ai/requests/{requestId}/recover` accepts the same multipart source
  and task/course/prompt/count/locale fields as generation, with the same upload
  limits and exact-origin/session preflight. It accepts no idempotency key.
  The gateway repeats extraction and compares the original request digest,
  including file bytes, filename/MIME, pasted text, task, course and settings.
  The UI displays the original count and language; use those settings and the
  original source. The current prompt contract must also match the saved job.
  A match returns the status envelope above. A mismatch returns 409; an absent
  or expired request returns 404. This route **never reserves a job, writes a
  result or invokes a provider**, even when the original job has expired.
- Both routes recheck current session and course permissions. Recovery is manual,
  bounded to 30 seconds on the client, and does not poll. Pending or uncertain
  outcomes never trigger generation. Recovered drafts still require review;
  switching course or closing syllabus review discards the editor transaction.

Original-source download, restoration of unsaved edits, and operator billing
reconciliation remain unfinished. Copy a visible request ID for authorized
operator investigation. The prepared local demo does not opt into this live
history profile, and production bootstrap still needs the institution's services.

## Capacity and retention

| Bound | Current limit |
| --- | --- |
| Whole multipart upload | 2,064,000 bytes including overhead |
| Individual text file | 2,000,000 bytes |
| Combined canonical text | 500,000 characters |
| Located passages | 10,000; 1,000,000 total passage characters |
| Input artifact, file and notices per job | 8 MiB |
| Validated result / provider receipt | 2,000,000 / 16,384 bytes |
| Retained logical AI artifacts | 64 MiB, including reserved active-result headroom |
| Retained jobs / active uploads and generations | 1,000 / 2 |
| Rolling 24-hour reservations | Configured installation limit; per user the smaller of 20 and that limit |
| Provider deadline | 120 seconds |

Accepted reservations count toward quotas even on failure; successful replays
do not reserve again. Bounded readers and HTTP timeouts limit stalled uploads;
deadline/disconnect signals reach the provider. Injected SDKs must honor those
signals to stop underlying work. These are request/token limits, not currency
budgets or load-test evidence. SQLite overhead/journals are outside the logical
artifact limit.

Expiry is set at reservation. Expired non-processing rows, including source,
result, receipt and idempotency record, are deleted at startup, on reservation
and by a minute timer while the institution gateway runs. Cleanup continues
when new AI generation is disabled. Stopping/removing the gateway does not erase
its database or backups. Retry protection ends at expiry. Restrict/encrypt host
volumes and backups and agree institutional deletion/recovery policies; row
deletion is not secure erasure.

The AI table/index are additive schema objects created on startup. Versioned
migration/rollback, backup/restore, operational monitoring, spending reconciliation,
asset publication, supported-upload controls and real-provider evaluations
remain pilot gates in the [production roadmap](../docs/production-roadmap-2026-09-28.md).
