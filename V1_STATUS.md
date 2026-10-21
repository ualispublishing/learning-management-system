# Learning Management System V1 status, remaining work and known issues

Updated: **21 October 2026**. Application package version: **1.0.0**.

**V1 is the first documented demonstration and integration baseline. It is not a
production-approved institutional release.** The local demo is usable with
synthetic data; real learner data requires the unfinished service, deployment and
acceptance work below. The version number is not evidence that those gates pass.

Use this document for a concise status review, the [app README](./README.md) for
setup, the [demo README](./demo/README.md) for presentations, and the
[production roadmap](./docs/production-roadmap-2026-09-28.md) for detailed work
packages and acceptance criteria. `git rev-parse HEAD` identifies the exact local
source revision; check results apply only to their recorded source and scope.

The October 21 naming update uses **Learning Management System** for the default
app name and `learning-management-system` for the package and GitHub target.
The full local checks passed again; see the [naming verification](./docs/verification/product-name-check-2026-10-21.json).

## What V1 includes

- A web demo launched by `npm run web`, with a guide, independent synthetic roles,
  shared course workflows, discussions, assessments and learner study tools.
- Institution logo/name and two-colour branding, with generated platform assets
  and in-app palette/appearance previews.
- Prepared AI syllabus extraction and lesson-to-flashcard examples from one
  coherent course bundle, including PDF, PowerPoint, audio, video and captions.
  The comparison screen reuses actual course/flashcard presentation components;
  the course workflow supports reviewed publication and learner viewing.
- JSON schemas, source citations, review warnings, recorded model attribution and
  exportable drafts. The demo replays saved results; it makes no live model call.
- Provider interfaces, an OpenAI Responses connector, bounded text/caption
  extraction, optional authenticated AI jobs, saved-result recovery and history.
- A reference OIDC/session service and narrow durable written-assessment gateway.
  Web clients support explicit same-origin HTTPS cookies; uploads also retain
  bearer authentication and complete-operation timeouts.
- Automated tests, synthetic journeys, build checks, a GitHub CI workflow and
  production integration/acceptance documentation.

See the [contribution record](./CONTRIBUTING.md#completed-contributions) for the
completed changes and their supporting files.

## Evidence available

The 19 October local run passed **556 application tests**, **54 server tests**,
**270 synthetic journeys / 1,620 steps**, lint, both TypeScript checks,
fixture/security/notices and server metadata checks, web export and verification
of 30 exported files. See the
[record](./docs/verification/asset-transport-check-2026-10-19.json).

The October 20 privacy-cleanup run repeated the app/server checks and web build
with the same passing counts. It also verified unchanged lesson content and
prepared results after sanitizing metadata. See the
[privacy verification](./docs/verification/repository-privacy-check-2026-10-20.json).

Targeted browser checks on October 17 covered all five prepared lesson formats,
PowerPoint file selection and actual Teacher-to-Student publication. October 18
covered workspace interactions and syllabus views. See the
[browser evidence](./demo/ai/verification/README.md). These were bounded checks,
not continuous browser regression coverage or complete device acceptance.

The full supported-device/accessibility matrix, real SSO/provider acceptance,
restore/migration/load drills and production promotion remain open. Existing
dependency audits are dated evidence; rerun them for the release candidate.
Test counts do not establish educational accuracy or production readiness.

## Work required before real-data use

| Priority / work | What remains | Completion evidence |
| --- | --- | --- |
| P0 — Offered scope and ownership | Choose the first supported customer profile, workflows, integrations, platforms, capacity and operator/support owners. Customer-operated is the default; publisher operation uses the same product when agreed. | Approved capability matrix, measurable acceptance criteria and named owners |
| P0 — Complete sign-in | Wire app bootstrap/routes to real services; validate issuer registration, HTTPS cookies, expiry, logout and deprovisioning. Implement native transport if native access is offered. | Supported-browser/device tests against the actual identity provider and deployment |
| P0 — Authorized durable services | Complete the advertised backend beyond the narrow assessment/AI reference profile, including learning state and any promised collaboration/realtime features. | End-to-end role/tenant/object authorization, persistence after restart and recovery from concurrent/failed writes |
| P0 — File service | Implement scoped upload/download, durable idempotency, MIME/signature limits, quarantine/scanning, safe access, retention and orphan cleanup. The client is not a storage backend. | Authorized teacher upload and learner retrieval, rejected unauthorized access, scanned files and retry/retention evidence |
| P0 — Data lifecycle and recovery | Version migrations; define export/deletion, holds, backup protection and recovery objectives; implement uncertain-commit reconciliation and any promised offline/outbox behavior. | Upgrade, failed migration, restore, revocation and timeout-after-commit drills |
| P1 — Live AI offering | Integrate the customer's approved provider; implement binary document/OCR/media workers for formats actually offered; add billing reconciliation and retention controls. | Repeated instructor-reviewed evaluations on representative new sources, provenance checks, quota/cost and failure tests |
| P1 — Operational security | Complete deployment threat review, secrets/rotation, redacted events, monitoring, alerts, incident response and independent review appropriate to the pilot. | Tested controls and alerts on the deployed candidate, with accountable residual-risk decisions |
| P1 — Supported experience | Run keyboard/screen-reader/device/media acceptance, interruption/reconnect cases and measured load/long-running memory tests. Verify promised localization. | Candidate-specific acceptance records on the supported matrix |
| P1 — Release and support | Enforce hosted CI/review, protected promotion, current audits and notices; clear content permissions; document upgrades, support and offboarding. | Approved release evidence, artifact identity, rollback/restore and support handoff |
| P2 — Expansion | Add further customer profiles, SIS/HR/SCIM/SAML integrations, remote notifications, commerce or broader offline use only when committed to the offering. | Each expanded capability meets its own requirements and regression gates |

Priorities describe dependencies, not a promised delivery date. The broader
[W01–W12 roadmap](./docs/production-roadmap-2026-09-28.md#4-implementation-work-packages)
governs the complete scope. A narrower pilot needs deliberately versioned and
tested capability gates; silently skipping production checks is not a release plan.

## Known limitations and unresolved risks

These items distinguish intentional demo behavior, missing implementation and
unverified risk. They are not all newly reproduced application bugs.

| ID | Status / affected behavior | Current handling and next action |
| --- | --- | --- |
| V1-01 | Demo limitation: refreshing signs out a synthetic role; restarting resets shared server data. | Use in-app navigation and independent tabs. Use real durable services for a real-data deployment. |
| V1-02 | Demo limitation: only the exact six prepared sources replay results; arbitrary new files and batch import are unsupported. | Use `demo/ai/sources/`; new content needs approved extraction and a live provider or a newly reviewed prepared pack. |
| V1-03 | Missing implementation: the reference live AI route supports text/Markdown/captions, not general PDF, DOCX, PPTX, audio or video extraction. | Declare the actual source profile; reject unsupported inputs until bounded workers are implemented and verified. |
| V1-04 | Recovery limitation: saved AI results can be recovered, but unsaved editor changes and original-source download are not restored. | Reselect the original source and review the recovered result again; implement draft/source recovery before promising it. |
| V1-05 | Integration risk: an upload timeout can occur after a server commit. | Retain the logical request key, reconcile the outcome and avoid automatic duplicate retries. The server and durable client recovery still need implementation. |
| V1-06 | Identity limitation: disabling an IdP account alone does not immediately revoke the reference service's existing eight-hour application session. | Agree and implement the required revalidation/revocation propagation; test against the real provider. Local mapping disablement is a separate control. |
| V1-07 | Capacity limitation: behind a same-host proxy, the reference login limiter is shared across that proxy's traffic. | Verify trusted edge limits and pilot capacity before multiuser production use. |
| V1-08 | Open investigation: the exact cause of the reported historical 80 GB total memory spike is unproven. | Confirmed runaway assertion formatting and retained Blob URLs were repaired; run bounded long-duration browser/server profiles before claiming memory stability. |
| V1-09 | Unverified behavior: full native/device/accessibility acceptance, Finder-to-browser drag paths and all failure/reconnect cases remain incomplete. | Use the verified Choose file/sample paths for demonstrations; execute the documented acceptance matrix and log actual failures. |
| V1-10 | Release dependency risk: the audit policy retains two named `image-size` advisory exceptions. | Keep untrusted build assets out of Metro, review current exposure and rerun live audits; this document does not assert today's registry is clear. |
| V1-11 | Release permissions: the current license-review inventory has 12 unresolved package dispositions; MIT OCW commercial permission is not included. | Resolve the exact notices/SBOM and replace the demonstration bundle or obtain appropriate permission for its intended commercial use. |

For underlying detail, see [server limits](./server/README.md),
[AI recovery](./server/ai-contract.md), [memory investigation](./docs/memory-investigation-2026-10-05.md),
[dependency policy](./docs/dependency-security-review.md),
[license review](./docs/third-party-license-review.md) and
[device/accessibility acceptance](./docs/manual-device-accessibility-acceptance-2026-08-20.md).

## Previously reported defects with repairs

The earlier review's assessment autosave, cross-tab persistence, snapshot race,
canonical acknowledgement, logout, font-loading and media-consent findings have
client repairs and regression coverage recorded in the roadmap. A principal
generation guard also addresses delayed account-switch results. These historic
findings must not be presented as freshly reproduced open defects without a retest.
Provider and deployment acceptance remain necessary.

Later demo repairs covered the editor/review modal handoff, multiline syllabus
typing, selected-file URL cleanup, duplicate selection, startup/port behavior and
unbounded test failure formatting. Upload deadlines now cover credential lookup
and response reading. Passing those regression cases does not rule out other bugs.

## Reporting and closing a bug

Record the version and commit, synthetic account role, browser/OS, source format,
minimal steps, expected/actual result, severity and frequency. Attach redacted
evidence; exclude tokens, personal data and real learner records. State whether
the issue occurs in prepared demo mode, the reference service or a deployment.

Use `open`, `investigating`, `fixed-awaiting-verification` and `verified` states.
Link a fix to a reproducing regression test and candidate-specific verification;
close it only after the original scenario passes. Add new confirmed issues to
this register and the repository issue tracker when one is configured.

## Moving beyond this baseline

Publish release notes for the exact candidate, including supported capabilities,
known issues, changed contracts and upgrade/rollback instructions. Run applicable
release and production checks and retain required approvals. Update this file
when behavior, evidence or release status changes; do not infer production
approval from a version bump or a successful GitHub upload.
