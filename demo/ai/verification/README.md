# Demo verification

The October 18 visual follow-up verified the interactive workspace and syllabus views:

- The guide retained the workspace destination through Teacher sign-in. Student
  Preview opened Algorithm Studio; closing it returned to the same course.
- The code lab accepted the displayed reference pattern and Reset restored the
  starter text and removed the result. Incomplete-answer feedback and the hint
  were checked in the October 17 portion of this walkthrough. These are static
  text-pattern checks, not Python execution or proof of algorithm correctness.
- Generate sample updated the chart and its equivalent text values together.
  Returning to Dashboard showed 57% (four of seven activities explored) after
  visiting both panels and resetting the solution.
- Prepared syllabus processing displayed source checks, course information,
  the formatted draft and field mapping. The closing evaluation retained its
  distinction between published research and unmeasured app-specific outcomes.
- No browser console errors were recorded. The supervised server peaked at
  **1007.2 MiB** sampled process-group RSS during the 154.5-second session,
  excluding browser memory. The temporary tab and server were closed.

See the [visual-check record](./demo-visual-check-2026-10-18.json),
[code lab](./workspace-code-lab-browser-2026-10-18.jpg),
[visualization](./workspace-visualization-browser-2026-10-18.jpg),
[syllabus mapping](./syllabus-mapping-browser-2026-10-18.jpg),
[syllabus draft](./syllabus-draft-browser-2026-10-18.jpg), and
[evaluation](./evaluation-browser-2026-10-18.jpg).
No application code changed, so the latest full automated result remains the
October 16 run. This pass did not repeat publication, uploads or export downloads.

The October 17 browser pass verified the prepared demo and actual course publication:

- The real file chooser selected the bundled PowerPoint and returned six cards.
  PDF, PowerPoint, audio, video and captions all returned six-card results; reveal,
  citation display and Got it / Next worked. Video citations included both excerpt
  and original timestamps.
- The syllabus preview, formatted draft, field mapping and course-export preview
  showed three objectives, two meeting entries, twelve topics and 36 citations.
  The evaluation retained its explicit distinction between published research and
  unmeasured app-specific outcomes.
- Teacher applied the syllabus through the actual editor. A separate Student A
  tab saw the new fields and recorded model while Teacher remained signed in.
  Existing course dates and 40/30/30 grading weights stayed intact.
- A prepared PDF and six cards published together. Publication remained disabled
  after five review acknowledgements and enabled after all six. Student A opened
  the actual course player and saw the answer, PDF citation, source filename and
  **gpt-6-astra / xhigh** authoring footnote. These acknowledgements were synthetic
  test input, not independent instructor approval.
- AI/LMS navigation retained Teacher's account. Neither tab logged console errors;
  existing React Native Web deprecation and Expo push-listener warnings remained.
- The first supervised server session peaked at **977.2 MiB** and stopped at its
  20-minute safety limit while the file-selection tool was waiting. The resumed
  session peaked at **623.8 MiB** and was deliberately stopped after verification.
  Browser memory is excluded. Temporary tabs were closed and in-memory test
  publications discarded. This is not a long-duration memory-stability result.

See the [browser record](./ai-browser-check-2026-10-17.json),
[video comparison](./video-cards-browser-2026-10-17.jpg), and
[actual learner footnote](./learner-attribution-browser-2026-10-17.jpg).
No app code changed in this pass; the latest full automated result remains the
October 16 run below. Live model quality, production SSO and the full manual
acceptance matrix remain outstanding. Export preview and link were checked;
this pass did not save a fresh export download.

The October 16 attribution follow-up carries recorded authoring into actual course views:

- The prepared server attaches bounded authoring metadata after checking the
  generation record and source/extraction/result hashes. Validation rejects
  malformed records and disagreement between cards. Authoring model and replay
  engine remain separate; missing historical metadata is not guessed.
- Syllabus and flashcard review, saved syllabus, Course Info and the course study
  player show attribution. Publication and portable exports retain the record.
  Display uses saved metadata without a catalog fetch or new generation.
- Two new boundary tests cover malformed/mixed attribution and legacy/live
  labels. Existing tests now cover every prepared format, literal rendered text,
  review/recovery, portable exports, and real HTTP publication followed by learner
  re-login and rendering the actual course/player components in JSDOM.
- **All final checks passed:** 543 app tests, 54 server tests, 270 journeys / 1,620
  steps, lint, TypeScript, validation gates, web export and 30-file verification.
  The final serial run took **40.4 seconds**, peaking at **1711.5 MiB** sampled
  process-group RSS under the 3072 MiB cutoff. Neither bundle includes the checked
  server markers. See the [run summary](./ai-attribution-check-2026-10-16.json).

The React checklist was applied: a shared read-only footer, literal bounded text,
no new effects, subscriptions or network calls, and attribution derived from the
current item instead of cached component state. Earlier imports without authoring
metadata remain explicitly unattributed. Configured-agent attribution does not
prove API equivalence. No paid model request, live SSO, deployment or new browser
visual check was performed.

The October 16 pass aligned AI upload guidance with the declared service profile:

- Integrations can declare `sourceProfile: 'text-v1'`. The syllabus picker then
  offers TXT/Markdown, and flashcard guidance identifies TXT/Markdown/VTT/SRT or
  pasted text. Unsupported AI inputs are rejected before credentials or upload;
  dropped unsupported syllabi are rejected before an object URL is allocated.
- The client bounds combined source bytes to 2,000,000, counting actual Blob size
  and UTF-8 text with multipart line-ending normalization. Pasted text is also
  bounded to 500,000 normalized characters. Native files require a known size.
  These checks supplement the authoritative gateway validation.
- Prepared demo media remain available, ordinary course attachments keep their
  existing flow, and undeclared services show institution-dependent guidance.
  This declaration does not implement automatic capability discovery or binary
  document/media extraction.
- Six new tests cover format/task boundaries, combined byte limits, actual file
  size, custom adapters, rejected flashcard review and syllabus drops. Existing
  rendered syllabus tests now verify picker filters and rejection before analysis;
  the actual client/gateway/provider integration test uses the declared profile.
  One obsolete disabled-expression assertion was replaced by rendered consent
  evidence after the first full run exposed it.
- **All final checks passed:** 541 app tests, 54 server tests, 270 journeys / 1,620
  steps, lint, TypeScript, validation gates, web export and 30-file verification.
  The serial run took **50.2 seconds**, peaking at **1594.8 MiB** sampled group RSS
  under the 3072 MiB cutoff. Both bundles exclude the checked server markers.
  See the [run summary](./ai-source-profile-check-2026-10-16.json).

The React checklist was applied to the picker and review changes: source checks
are memoized in flashcard review, unsupported actions expose disabled state,
source changes retain consent invalidation, and no polling or new subscription
was introduced. No paid provider call, live SSO, deployment or new browser visual
check was used. Real-provider acceptance and the remaining rollout gates still apply.

The October 14 pass added recovery after reload for authenticated `history-v1`
integrations:

- Both course editors offer **Find saved AI requests** after reselecting the
  original source and confirming processing rights. History is scoped to the
  current principal/course/task and returns at most 20 summaries per page.
- **Recover with selected source** calls a separate bounded endpoint. The server
  verifies the original file/text and settings; it cannot reserve a job or call
  a provider, including for expired or missing requests. Drafts require fresh
  human review, and switching courses discards stale history and syllabus results.
- Seven new app tests and four new server tests cover fresh clients, actual
  editors after remount, source/settings mismatch, pagination, permission changes,
  malformed pages and pending/uncertain/expired outcomes. The existing real HTTP
  test now covers recovery session preflight and streaming upload limits.
- **All checks passed:** 535 app tests, 54 server tests, 270 journeys / 1,620 steps,
  lint, TypeScript, validation gates, web export and 30-file build verification.
  The serial run took **55.8 seconds** and peaked at **1787.9 MiB** sampled group
  RSS, under a 3072 MiB cutoff and five-minute deadline. Both bundles exclude the
  checked server markers. See the [run summary](./ai-history-check-2026-10-14.json).
- The React checklist was applied: manual bounded loading, no polling or new
  subscriptions, stale-result guards, disabled/busy accessible controls, literal
  source labels, and a scrollable review entry panel. A preliminary compiler run
  hit a deliberately small 512 MiB heap; the established 1536 MiB compiler bound
  passed. Test processes stayed limited to 512 MiB.

No paid model request, live SSO, deployment or new browser visual check was used.
Original-source downloads and unsaved reviewer edits are not restored. App
bootstrap and real-provider acceptance remain work. Prepared local playback
keeps its existing flow and does not opt into this live history contract.

The final October 13 pass added read-only recovery in the current AI review:

- Institutions implementing the status contract can opt into
  `requestRecovery: 'status-v1'`. After a submitted failure, flashcard and syllabus
  review retain the request ID and offer **Check saved result** separately from
  **Start a new generation**. A check uses GET, refreshed credentials and strict
  request/course/task/source/provenance validation. Pending, uncertain, missing,
  expired and forbidden outcomes never cause a generation POST. Recovered drafts
  retain notes and still need instructor verification before publication.
- Nine recovery tests cover both actual client-to-gateway task paths after lost
  responses, current principal/course access, uncertainty/expiry, changed sources,
  malformed/mismatched status data, credential refresh, response limits, opt-in
  compatibility and timeout cleanup. Two additional rendered tests exercise the
  actual flashcard and syllabus editors, including pending-to-success recovery,
  retained/withdrawn consent and unverified recovered drafts with no writes.
  Syllabus consent/review checkboxes now expose their checked state on web.
- Cancellation checks exposed and corrected a late-response cleanup race.
  Credential/transport waits now end on abort; bounded readers cancel and release
  stalled bodies, including response arrival at the deadline. Injected transports
  still must honor cancellation to stop their own underlying work. A stale
  source-code assertion was replaced by rendered consent-gate evidence; a test
  expectation was corrected for the consent panel hiding after successful analysis.
- **`npm run check`, `npm --prefix server run check`, `npm run build:web` and
  `npm run verify:web-build` passed:** **528 app tests**, **50 server tests**,
  **270 synthetic journeys / 1,620 steps**, existing validation gates and a
  30-file web export. The final serial run took **39.4 seconds**, peaking at
  **1668.7 MiB** sampled process-group RSS under 1536 MiB Node/512 MiB test heaps,
  a 3072 MiB group cutoff and five-minute deadline. See the
  [run summary](./ai-recovery-check-2026-10-13.json). Both web bundles exclude
  the checked server extractor, vendor endpoint and AI database markers.

No paid provider, live SSO, deployment or new browser visual acceptance was used.
The React checklist was applied to the shared recovery controls and both editors:
no polling or new subscription is introduced, actions share the existing in-flight
guards, and flashcard source changes clear recovery state. At that point recovery
lasted only in the open review; the October 14 pass above adds cross-session
history. Original-source retrieval, full app bootstrap and real-provider acceptance
remain work. The
prepared replay stays unchanged and does not opt into live status recovery.

The later October 13 pass made extraction notes visible in the real review flow:

- The gateway attaches bounded `provenance.sourceReviewNotices` from extraction
  before hashing/saving the output receipt. Flashcard and syllabus review render
  them as literal text; edits and publication retain them in provenance. Staff
  can inspect saved syllabus notes. They do not supply human approval.
- Seven additional app tests cover note snapshots and receipt hashes, invalid
  metadata, model attempts to fabricate notes, contradictory per-card provenance,
  syllabus mapping/saved metadata, declared-but-missing notes, and the rendered
  flashcard review/edit/publication/reset flow. The actual client-to-gateway test
  now includes a VTT file with excluded comments and checks saved receipt hashes;
  the server test also checks inline notes through status and successful replay.
- **`npm run check`, `npm --prefix server run check`, `npm run build:web` and
  `npm run verify:web-build` passed**: **517 app tests**, **50 server tests**,
  **270 synthetic journeys / 1,620 steps**, and the existing validation gates
  and 30-file export. The run took **40.4 seconds**, peaking at **1693.8 MiB**
  sampled process-group RSS under the same 1536 MiB Node/512 MiB test heaps,
  3072 MiB group cutoff and five-minute deadline. See the
  [run summary](./ai-source-notices-check-2026-10-13.json).
- Both web JavaScript bundles exclude the checked server extractor, vendor
  endpoint and AI database markers. No new dependency, paid model call, deployed
  provider, live SSO or browser visual check was used. The React review checklist
  found no new effects, async state or unbounded render collections in the notice
  component; existing course/source reset behavior clears prior notes.

At that milestone, saved-job recovery remained work; the final pass above adds
current-review recovery. Full SSO/bootstrap, assets, binary/media workers and real
provider evaluation remain work. Deploy the matched gateway/client together:
older successful records declaring notes only out-of-band fail new client
validation and require operator inspection rather than silent note loss.

The October 13 pass completed the optional authenticated reference AI gateway:

- The actual `InstitutionAIService` now has a tested path through the OIDC
  session boundary, course permissions, shared text/caption extraction and
  OpenAI connector. Successful generations durably retain source artifacts,
  validated results and provider receipts in SQLite. Generation leaves course
  data and snapshot ETags unchanged; review/publication remain separate actions.
- Sixteen new server tests cover opt-in configuration, authorization, canonical
  course context, persistence/replay, unsupported input, session/enrollment
  revocation, daily/concurrent limits, fabricated evidence/approval, provider
  failure, cancellation, deadlines, retention/recovery and a real loopback HTTP
  upload. The additional app integration test uses the actual client and server
  layers with synthetic OpenAI envelopes; it checks file hashes, reported model,
  saved receipts, missing syllabus fields and unchanged course state.
- **`npm run check`, `npm --prefix server run check`, `npm run build:web` and
  `npm run verify:web-build` passed:** **510 app tests**, **50 server tests**,
  **270 synthetic journeys / 1,620 steps**, TypeScript, lint, fixtures, security
  configuration, notices, server dependency metadata, branding, prepared-pack
  validation and a 30-file export. Both exported JavaScript bundles were also
  checked for the server extractor, vendor endpoint and AI database markers;
  none were present. The new integration test initially exposed conflicting
  Node/React Native multipart typings, corrected before this successful pass.
- The serial run took **52.2 seconds** and peaked at **1626.2 MiB** sampled
  process-group RSS, with a 1536 MiB Node heap, 512 MiB test-worker heap,
  3072 MiB group cutoff and five-minute deadline. No cutoff was reached. See
  [the run summary](./ai-gateway-check-2026-10-13.json). Owned check processes
  ended; no persistent server or browser was started. October 10 remains the
  latest browser visual verification. No paid API, external issuer acceptance,
  dependency audit, deployment or institution acceptance was performed here.

The prepared six-format demo remains unchanged. Live reference generation is
disabled by default and currently supports pasted text, TXT/Markdown and
VTT/SRT, with stricter limits than the general picker. App SSO/bootstrap, asset
publication, saved-job recovery, binary/media workers and instructor evaluation
remain work; the later pass above adds note display. The [AI server contract](../../../server/ai-contract.md)
documents the implemented profile and retention-limited retry guarantees.

A final storage refinement also retains the task and prompt version in the input
artifact before generation, including failed/uncertain jobs. After that change,
server TypeScript, all 15 direct AI handler tests and the client-to-gateway
integration test passed again. HTTP behavior and client bundle code were unchanged.

## Earlier verification

The October 12 completion pass verified the AI client's authentication and
course-scope changes after the previous verification was interrupted:

- `InstitutionAIService` now supports explicit same-origin HTTPS cookie mode.
  It rejects cross-origin/path-prefixed bases, mixed token credentials and
  non-browser cookie callers. Bearer mode explicitly omits cookies. Remote
  generation requires a stable course ID; the course syllabus and flashcard
  flows supply it. Request configuration/source metadata are captured before
  asynchronous credential lookup, and authentication failures never switch modes.
- Eleven new transport tests cover those boundaries using synthetic gateway
  responses. A rendered test verifies that switching between two courses with
  the same title clears consent, ignores the prior course's late result, and
  generates for the new course only after a new acknowledgement. Editing a card
  clears its verification. The test exposed missing web `aria-checked` state on
  consent/review checkboxes; both now report their state. The existing rendered
  content-manager test verifies that review receives its actual course ID.
- **`npm run check`, `npm run build:web` and `npm run verify:web-build` passed**:
  **509 tests**, **270 synthetic journeys / 1,620 steps**, lint, TypeScript,
  fixtures, security configuration, notices, branding, prepared-pack checks and
  a 30-file web export. Existing prepared upload, rendered showcase, syllabus
  mapping and paired publication tests passed. Two exported JavaScript bundles
  were separately checked for the extractor/OpenAI server markers; none were
  found. No provider credentials or paid model calls were used.
- The full sequential run took **50.7 seconds** and peaked at **1777.1 MiB**
  sampled process-group RSS, using a 1536 MiB Node heap cap, 3072 MiB group
  cutoff and four-minute deadline. The old process handle was missing and its
  temporary logs were unavailable, so the interrupted run was not counted as
  evidence; this was a fresh verification. No browser or persistent demo server
  was started. The October 10 browser evidence remains the latest visual check.

At the October 12 milestone, these changes implemented client transport and the
reference server did not yet have an AI route. October 13 adds authorization,
durable jobs/artifacts and quotas; asset authentication, app bootstrap and live
model acceptance remain work. The separate reference-service suite and dependency
audit were not rerun for this client change. See the
[client integration guide](../../../docs/ai-provider-adapters.md#client-authentication-and-course-scope).

The later October 11 extraction pass added bounded UTF-8 TXT, Markdown, WebVTT
and SRT processing and a local `npm run ai:extract` command:

- Twelve tests cover Unicode/whitespace fidelity, line and timestamp references,
  adjacent-cue context, overlapping cues, malformed separators, encoding and size
  limits, cancellation, file hashes, arbitrary-source provider validation and
  CLI output permissions/refusal to overwrite. Test provider responses are
  synthetic; they do not measure model accuracy.
- Running the CLI against the bundled sources produced **38 syllabus passages**
  from 6,787 characters and **eight caption passages covering all 161 cues** from
  5,485 canonical characters. The caption range ends at 00:06:51.622. Original
  files and prepared responses were not rewritten. JSON artifacts contain the
  source text and were written only to new private temporary files.
- `npm run check`, `npm run build:web` and `npm run verify:web-build` passed:
  **497 tests**, **270 synthetic journeys / 1,620 steps**, lint, TypeScript,
  fixtures, security configuration, notices, branding, prepared-pack checks and
  a 30-file export. Existing rendered and loopback tests still cover the prepared
  six-format demo and course publication. Two exported JavaScript bundles were
  separately checked for extractor/OpenAI server markers; none were present.
- The full check/build run took **32.1 seconds**, peaking at **1642.1 MiB** sampled
  process-group RSS under a 1536 MiB Node heap cap, 3072 MiB group cutoff and
  four-minute limit. The first attempt exposed TypeScript narrowing errors in a
  throwing helper; those were corrected before the successful run. A later fix
  excluded whitespace-only fragments from evidence while preserving the full
  source text. Its twelve focused tests, TypeScript and lint passed in 9.4
  seconds, peaking at 1677.9 MiB under the same memory cutoff. Owned check
  processes were stopped; no browser or persistent demo server was started.

These changes add a tested extraction component, not a live AI upload route.
PDF/DOCX/PowerPoint parsing, OCR, media transcription, authenticated gateway
integration, durable artifact storage and instructor acceptance remain separate
work. No credentials or paid model calls were used, and the reference-service
suite and dependency audit were not rerun. The October 10 browser evidence below
remains the latest visual verification. See the
[extraction guide](../../../docs/ai-provider-adapters.md#text-and-caption-extraction).

The October 11 provider-integration pass added an optional server-side OpenAI
Responses connector and retained the prepared demo's existing operation:

- Fifteen new tests cover strict schema translation, optional syllabus fields,
  grading/evidence ordering, refusals and incomplete responses, source snapshots,
  exact request hashes, concurrent response attribution, caller cancellation,
  timeouts, stalled streams, payload bounds and redacted transport failures.
  API envelopes and credentials are synthetic; no live provider call was made.
- `npm run check`, `npm run build:web` and `npm run verify:web-build` passed:
  **485 tests**, **270 synthetic journeys / 1,620 steps**, lint, TypeScript,
  fixture/security/notices/branding/prepared-pack checks, and a 30-file web export.
  The rendered showcase, real loopback upload paths for six formats, syllabus
  mapping and paired lesson/card publication regressions all passed. The
  reference service and live dependency audit were not rerun in this batch.
- The full suite caught an overbroad `window` check in the generic runner,
  because the rendered tests host a real Node backend beside a simulated DOM.
  It was removed from that generic path; credential-bearing HTTP adapters retain
  their server-only check. A separate review fixed unknown null fields matching
  inherited object properties and made receipts hash the actual request body.
- The final sequential check/build run completed in 32 seconds, peaking at
  1663.2 MiB sampled process-group RSS with a 1536 MiB Node heap cap, 3072 MiB
  group cutoff and four-minute limit. An initial 1024 MiB type-check cap was too
  small and terminated that process; the established 1536 MiB cap passed.
  No demo server or browser was started for this batch. The October 10 browser
  evidence below remains the latest visual verification.

The new connector has no route or browser configuration switch, so adding it
does not turn on paid generation. Institution gateway integration, approved
credentials, extraction/transcription, quotas and live quality acceptance remain
separate work. See [the integration guide](../../../docs/ai-provider-adapters.md).

The October 10 dependency and release verification completed successfully:

- Updated seven direct Expo SDK 57 dependencies to compatible patches: Expo
  57.0.27, Asset 57.0.19, Constants 57.0.21, Linking 57.0.12, Notifications
  57.0.22, Router 57.0.25 and SQLite 57.0.4, with their compatible transitive
  updates. Expo's dependency validator reports that dependencies are up to date.
  Metro now uses at most two transform workers for normal demo and build runs.
- Regenerated and checked notices and the CycloneDX SBOM: 519 runtime package
  versions, 49 with pinned official license sources and 12 unresolved license
  text records. Inventory checks establish freshness, not legal clearance.
- **`npm run check`, `npm run build:web` and `npm run verify:web-build` passed**:
  470 app tests, 270 synthetic journeys (1,620 steps), lint, TypeScript, branding,
  all six prepared files, fixtures, security configuration and notices. The
  production web export contains 30 files, with no source maps or detected
  high-confidence secret markers. Dependency alignment and SBOM checks also
  passed separately. The unchanged reference-service dependency graph passed
  its TypeScript, metadata checks and 34 tests on October 9. This is not a new
  production-acceptance run or vulnerability audit.
- A fresh browser tab verified syllabus processing into the shared course
  information view with 36 citations and the two review warnings. The video
  example produced six cards; revealing the first answer displayed its source
  quotation and timestamps. The video reached readiness state 4, duration
  414.013 seconds and no media error. Back to LMS opened sign-in, Teacher reached
  the connected shared-server dashboard, and its AI link returned to the demo.
  There were no browser console errors. See the
  [post-update browser screenshot](./release-smoke-2026-10-10.png).
- The sequential app-check/build run took 47 seconds and peaked at 1596.4 MiB
  sampled process-group RSS. The browser-server run peaked at 1534.0 MiB over
  183.5 seconds. Both used a temporary 4096 MiB group stop threshold and ten-minute
  time limit; Node heap caps were 1536 MiB for checks/build and 2048 MiB for the
  server. The temporary server was stopped and its process group was confirmed
  absent. These measurements exclude browser and whole-machine memory and do
  not establish long-duration leak freedom. Normal `npm run web` uses the two
  Metro workers but does not include the temporary watchdog.

This smoke test used the built-in examples; native file-picker and external
drag-and-drop evidence remains as recorded below. Prepared responses still
require instructor review; live AI and production hosting are separate work.

On October 9, cleanup verification confirmed that the background worker observed
during the previous server shutdown was no longer running. No additional demo
server was started for this check.

The October 8 completion pass checked instructor editing, application and an
independent learner session:

- The complete app check first found one stale test expectation for syllabus
  prompt version 1.4.0; it was updated to the current 1.5.0 contract.
- Browser editing exposed immediate trimming of spaces and new lines in list
  fields. The shared `SyllabusLineListInput` now retains the input draft while
  typing and emits normalized entries for saving. All four fields—objectives,
  meeting times, instructor names and required materials—preserved a trailing
  new line and a space in the browser. Changes revoked the prior review
  confirmation. Temporary test edits were restored before application.
- Teacher applied the prepared syllabus through the actual modal. A separate
  Student A tab received the updated course title, audience, duration, objectives,
  meeting times, instructors, materials, schedule and policies. Original term
  dates and the existing 40/30/30 grading configuration remained intact. The
  learner's Syllabus view retained its source-file link and had no import/apply
  controls. See [the learner course information](./learner-syllabus-import-2026-10-08.png).
  Workflow review acknowledgements are test inputs, not independent instructor
  approval. Neither browser session reported console errors.
- **`npm run check` passed:** 470 app tests, 270 synthetic journeys (1,620 steps),
  branding, prepared-pack integrity, lint, TypeScript, fixtures, security
  configuration and third-party notices. This does not rerun the separate
  reference-service, dependency, release-build or production acceptance gates.
- The final app check ran for 31 seconds and peaked at 1674.1 MiB sampled
  process-group RSS. It used a 1536 MiB Node heap cap, with the test script's
  tighter 512 MiB cap and sequential execution. The final two-tab browser server
  peaked at 888.5 MiB under the same 2048 MiB heap / 6144 MiB group limits described
  below, and was stopped after verification. Browser memory is not included.

The October 8 browser pass verified the shared course presentation and expanded
syllabus mapping introduced on October 7:

- **Syllabus → Show prepared result** displayed the LMS's shared
  `CourseInformationView`: course code, duration, audience, three objectives,
  two meeting-frequency entries, instructors, materials, 12 session topics and
  policies. There are 36 citations and two review warnings. Unknown dates and
  conditional grading weights remain omitted. The extraction schema preview
  contains the new bounded fields. See [the course preview](./shared-course-info-2026-10-08.png).
- PowerPoint and video produced six cards using the actual course study-card
  components. Answer reveal, source evidence, previous/next, understood counts,
  review-again and reset on source change worked. The video reached readiness
  state 4, duration 414.013 seconds and no media error. The model footnote retained
  the original isolated-agent attribution and disclosed exact-source enrichment.
- The browser pass found and fixed a syllabus-only schema action incorrectly
  offered for flashcard results, and showcase button CSS overriding the shared
  card styles. Final computed card styles match the course player: 330 px minimum
  height, 28 px padding, 18 px radius and 2 px border. See
  [the final shared flashcard preview](./shared-flashcards-2026-10-08.png).
- The actual teacher dashboard's Course Info modal was inspected. A prepared PDF
  was also generated, reviewed and published with its study set in the temporary
  in-memory course. Student Preview opened the actual course player, revealed the
  answer and evidence, and advanced with one card marked understood. This run
  used Teacher's Student Preview; independent learner transport persistence is
  covered by the publication test. The review acknowledgements were functional
  test inputs, not independent instructor approval. Screenshots:
  [Course Info](./lms-course-info-2026-10-08.png),
  [course flashcards](./lms-flashcards-2026-10-08.png).
- **Finish demo · View evaluation** displayed the dated EEF controlled-trial and
  Gallup self-report findings, linked primary sources, and explicit separation
  from this app's unmeasured savings and educational accuracy. See
  [the evaluation panel](./demo-evaluation-2026-10-08.png).
- No browser console errors appeared. This pass used built-in source buttons;
  it does not add evidence for external drag-and-drop or native media pickers.
  The side showcase still performs no course publication or learner-progress
  writes.

All 19 focused provider, showcase and publication tests passed for the expanded
mapping and shared views on October 7, together with TypeScript, targeted ESLint
and pack-integrity checks. After the October 8 export-action fix, all 10 showcase
tests passed again, including coverage that all five learning formats expose
only their valid exports. Final targeted ESLint and `git diff --check` passed.
The full release suite was not repeated.

The October 8 tests peaked at 629.5 MiB sampled process-group RSS with a 512 MiB
Node heap cap. Three sequential supervised browser-server runs peaked at 2131.8,
795.3 and 848.0 MiB, respectively. Each used a 2048 MiB Node heap cap, a 6144 MiB
process-group RSS stop threshold, a 20-minute limit and bounded logs, and was
stopped after its checks. These figures exclude browser and whole-machine
memory; this is a short functional check, not a long-duration leak test.
Use normal `npm run web` to present; it does not include the temporary watchdog.

The additional October 7 confirmation checked the active regenerated pack:

- The native file chooser accepted syllabus TXT, PDF and PowerPoint. Syllabus
  processing showed 28 citations, two warnings and populated course mapping;
  the course-mapping JSON export retained generation attribution. PDF and
  PowerPoint rendered the first flashcard and its source evidence.
- The automated video file-chooser attempt stalled, and the supervised server
  reached its 20-minute time limit during that attempt. The native video upload
  path is inconclusive in this run. This is not evidence of an application memory
  leak or a successful video upload. The server was restarted with the same
  Node heap cap and a 15-minute runtime limit. A subsequent app/turn interruption
  ended the watchdog after 12.7 seconds while its demo process group survived.
  The recovered browser checks therefore retained the Node heap cap but were no
  longer covered by the process-group monitor. After verification, that specific
  orphaned server process group was stopped. Use normal `npm run web` to present.
- In the recovered browser session, built-in Video, Audio, Captions and PDF
  controls each produced six cards, exact cited evidence and model attribution.
  Video and audio had readiness state 4 and no media error, with durations
  414.013 and 414 seconds respectively. Card navigation and answer reveal worked.
- Flashcard JSON exported six cards with generation metadata and pending human
  review. Reset cleared the result, the Demo guide opened, and returning to the
  AI showcase successfully replayed the syllabus and displayed its formatted
  draft. No browser console errors appeared in the recovered session. See
  [the updated syllabus screenshot](./demo-confirmation-2026-10-07.png).
- The focused `prepared HTTP flow` test passed again against a real local HTTP
  server with all six source files, renamed filenames, bounded card counts,
  retained source bytes, range responses and changed-file rejection. It used a
  512 MiB Node heap cap and a 45-second watchdog. This supplements browser sample
  checks; it does not establish native-picker or external drag-and-drop success
  for the media files in this run. The earlier 16-test result below still applies;
  the full suite was not repeated for this read-only confirmation.

This confirms prepared demonstration behavior. Comparable live-model quality
remains an expectation to evaluate with the same extraction, instructions,
reasoning configuration and representative real course files. Source-quotation
checks do not establish semantic correctness, important-concept coverage or low
instructor editing effort. The six-card lesson examples illustrate a selected
excerpt, not complete coverage of an entire lecture or course. The intended
production outcome is instructor review and corrections after automatic drafting
and course-field mapping; it should be evaluated against the time required to
create and enter those materials manually.

The October 7 generation refresh promoted the unchanged outputs from the fresh
October 6 `gpt-6-astra` / `xhigh` agent. It received the explicit task, application
prompts, schemas and canonical source extractions without inherited conversation
history or previous results. The [generation record](../generation/2026-10-06-isolated/README.md)
documents those inputs, output hashes and limitations. This is recorded Codex
agent generation, not a live API response or independent instructor approval.

- In the browser, **Syllabus → Show prepared result** displayed 12 session topics,
  28 source citations and two review warnings. The exported syllabus contained
  ten policies and retained the model, reasoning and isolated-context attribution.
- **Video → Show prepared result → Reveal answer** displayed the new six-card
  set, “What is declarative knowledge?” / “Statements of fact.”, its exact source
  quotation and clip/original timestamps. The visible footnote identified
  `gpt-6-astra`, `xhigh`, the generation date and saved replay. See
  [the screenshot](./isolated-generation-2026-10-07.png).
- No browser console errors appeared. These checks used prepared sample buttons;
  the six native file-chooser checks below were performed against the previous
  pack on October 6. All six formats in the refreshed pack passed the current
  HTTP/rendered tests and source-integrity checks.
- All 16 focused provider, rendered-showcase and publication tests passed, as did
  TypeScript, targeted ESLint and pack-integrity validation. Tests also reject
  altered generation records and mismatched model attribution, and check that
  UI/export attribution stays separate from the prepared replay provider ID.
  The full release suite was not rerun.

Bounded tests used a 512 MiB Node heap cap and peaked at 532.9 MiB sampled
process-group RSS. Static checks peaked at 1602.9 MiB. The browser verification
server ran under a 2048 MiB Node heap cap, 6144 MiB process-group RSS stop threshold,
20-minute runtime limit and bounded logs. At approximately 3.6 minutes, its sampled
RSS was 1181.5 MiB with a peak of 2127.3 MiB. These measurements exclude browser
and whole-machine memory and do not constitute a long-duration leak test.
Normal `npm run web` does not include the temporary watchdog.

The October 6 upload/attribution double-check used the browser's **Choose file**
control for all six exact files in `demo/ai/sources/`, one at a time:

- Syllabus TXT displayed course information with 12 topics and 23 citations.
- PDF, PowerPoint (`.pptx`), MP4, M4A and VTT each displayed six cards. The first
  answer was revealed for each, with its quotation and page/slide or timestamps.
- Each result displayed the new attribution footnote: prepared with Codex on
  October 1, exact generating model not recorded, saved replay, live outputs may
  differ. The replay engine is separately labeled in Processing details.
- No browser console errors appeared. See the
  [video/result attribution screenshot](./upload-attribution-2026-10-06.png).

Fifteen focused provider, publication and rendered-showcase tests passed, along
with TypeScript, targeted lint and the six-file integrity check. Tests ran
sequentially with a 512 MiB per-process Node heap cap; peak sampled process-group
RSS was 573.1 MiB. Static checks peaked at 1621.4 MiB with a 1536 MiB Node heap
cap. These measurements exclude the browser. The full release suite was not
rerun. No live OpenAI call was made; the generic adapter does not yet establish
named-model provenance or equivalent live results. See
[the integration status](../../../docs/ai-provider-adapters.md#current-openai-integration-status).

The resumed October 5–6 pass completed the author-to-learner workflow using
`npm run web`:

- On October 5, the prepared syllabus was analyzed from the course tile's
  **Syllabus** action. Its 23 evidence entries, 12 undated topics and five warnings
  were reviewed, and the reviewed fields were applied. The title and description
  changed while the existing term remained intact.
- On October 6, Teacher selected the prepared PDF sample, generated six cards,
  acknowledged each card's source review and published the lesson and study set.
  Publication remained disabled until all six acknowledgements were present.
- The actual **Student A** account then opened the published study set, revealed
  “Statements of fact.” with the source quotation and PDF page 2/original slide 10
  citation, and moved to card 2. This check used a learner account, rather than
  relying only on Teacher's Student Preview. No browser console errors appeared.
  See [the learner screenshot](./learner-publication-2026-10-06.png).
- An old internal browser connection-error page was recovered by opening a fresh
  tab directly at `http://127.0.0.1:4178/demo` after server startup.
- Pointer attempts to drag the syllabus did not select it. The prepared sample
  button completed the flow; syllabus dragging and external Finder dragging
  still need manual verification. Use sample buttons or the previously verified
  file chooser for the presentation.

The new [`prepared-demo-publication.test.ts`](../../../tests/prepared-demo-publication.test.ts)
passed against real local HTTP transports and independent Teacher/Student
sessions. It verifies non-mutating generation, preservation of omitted course
settings, role enforcement, source hashes, atomic paired publication, learner
re-login, retained card evidence, video range responses and WebVTT captions.
Its review acknowledgements are synthetic test inputs, not instructor approval.
The October 5 bounded run completed in 0.4 seconds with a 256 MiB Node heap cap
and a maximum sampled individual-child RSS of 269.6 MiB. TypeScript and targeted
lint also passed; TypeScript's sampled maximum child RSS was 1623.6 MiB. The full
release suite was not rerun for this change.

The October 6 browser run used a supervised `npm run web` with a 2048 MiB Node
heap limit, a 6144 MiB server-process-tree RSS stop threshold, a 30-minute runtime
limit and bounded logs. The watchdog measures the demo server process tree,
not browser or whole-machine memory. At the final check, approximately six
minutes into the run, sampled server-tree RSS was 786.8 MiB with a peak of
2233.3 MiB. It is a short functional check, not a long-duration leak test.
Normal `npm run web` does not include this temporary verification watchdog.

In the initial October 5 pass, dragging the prepared PDF's in-app handle into the learning-material
area selected the source. A modal overlap was fixed so the editor no longer
covers flashcard review. Consent, six-card generation, the individual-review
publication gate, canceling back to the retained draft and reopening/generating
again were checked in the browser. That initial pass did not publish another study set.

The following memory investigation fixed a runaway allocation in the new test's
assertion formatter and unnecessary retention of replaced file URLs in the
picker. The 21 focused handoff/picker/consent/startup tests and eight showcase tests
passed, as did bounded TypeScript and lint runs. The full release suite and browser were not restarted
for the memory checks. See the [investigation report](../../../docs/memory-investigation-2026-10-05.md).

The October 4 file-transfer pass completed in the in-app browser:

- **Choose file** selected the bundled PowerPoint from disk; the correct sample
  opened and produced six checked flashcards.
- Source PowerPoint, syllabus Markdown, course-mapping JSON and flashcard JSON
  downloads completed. The three generated exports were read back from Downloads:
  the syllabus retained 23 citations, the mapping omitted unknown dates/weights,
  and all six cards retained pending instructor review.
- Generated exports now use allow-listed HTTP attachments from the local backend.
  Each export also has a selectable preview and a copy control with a visible
  fallback if clipboard access fails. No course is created or published.
- Fourteen focused AI tests passed, including exact equality between preview and
  download bytes for every bundled format and all three syllabus exports, plus
  copy success/failure and reset. Lint and TypeScript passed.

The October 3 Demo guide pass verified every main destination from `/demo`,
role selection continuing to the requested course, institution colour controls,
the setup walkthrough entry, and Algorithm Studio's feedback and visualization.
AI-to-LMS navigation now uses the app router and preserves the signed-in role.
The full release check passed with 460 app tests, 34 service tests and 270
synthetic journeys. See [the demo runbook](../../../docs/demo-setup.md).

The web startup path was repaired and checked on October 2–3, 2026:

- `npm run web` and `npm run demo:multiuser` start the same complete demo on 4178 with its backend on 4180. Frontend-only development is explicitly `npm run web:standalone`.
- Starting the second command while the first is running reuses the verified session successfully. Occupied unrelated ports and early child failures produce actionable errors; they cannot masquerade as readiness.
- Browser checks signed in as teacher and student in separate tabs. A teacher's test message appeared in the student's course discussion without a reload. The header's AI link opened the showcase and produced the syllabus mapping with source checks passed.
- 21 focused launcher, shared-server, AI-provider and rendered-showcase tests passed, as did lint and TypeScript checks. The launcher tests cover stale state, port collisions, early exits, missing executables, cancellation and normal Expo shutdown.

The separate `/ai-demo` showcase was verified on October 2, 2026:

- The sign-in screen's **Open AI before & after demo** button opens it without a course or account setup.
- Syllabus processing shows course information, the formatted syllabus draft and its field mapping beside the source.
- Video processing shows the six-card study preview, an answer and its timestamped quotation beside the actual lecture video. Video readiness reached state 4 with a 414.013-second duration and no media error. See `showcase-video.jpg`.
- **Reset preview** returns to the source/result action without writing or publishing a course. No browser console errors appeared in the verified flow.
- Rendered component tests use the real local HTTP server for all six formats and assert that the only non-GET requests go to `/lms/v1/ai/generate`. They cover repeat/reset, renamed and unknown files, stale responses, preservation of omitted settings and the explicit demo-mode gate.
- The original Blob-based export did not report a browser download event. This
  uncertainty was resolved by the October 4 HTTP export checks above. The
  original prepared JSON files also remain in `results/`.

Verified in the local web app on October 1–2, 2026:

- Prepared syllabus selected, extracted with 23 evidence entries, reviewed and applied. Missing exact dates and conditional grading weights were visibly flagged and omitted.
- Prepared lecture video selected; matching transcript and English WebVTT track populated automatically.
- Six prepared flashcards generated with exact excerpts and clip/original timestamps. Publication stayed gated on individual card review.
- Material and study set published together and appeared in Student Preview.
- Browser video metadata reported 414.013 seconds, readiness state 4, no media error; caption track readiness state 2 (loaded).
- Published six-card study set opened; its first answer and cited evidence rendered correctly. See `published-flashcards.jpg`.
- Browser console contained no errors in the completed publication flow.

The actual source-picker components also have rendered DOM tests covering the drag-start/drop handlers, matching renamed files by their contents, and rejecting multiple files. The earlier unsuccessful pointer-drag attempt was followed by the successful in-app PDF drag on October 5 described above. Syllabus dragging and external Finder-to-browser file dragging remain manual checks; sample-selection buttons were verified end to end.

The first browser run exposed an existing global `fetch` receiver problem; the AI and institution transport constructors now bind it correctly. A regression test models browsers that reject an incorrect receiver.

These are local demo behavior checks, not independent instructor approval, a measured educational accuracy evaluation, commercial licence permission, or production provider acceptance. Live institution APIs and native-device playback remain separate acceptance work.
