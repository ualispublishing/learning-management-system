# Production provider acceptance

Client-side contract tests cannot prove that an institution's deployed SSO,
gateway, realtime service, object store, CDN, or signing accounts enforce their
side of the contract. They also cannot prove rendered five-role journeys,
physical-device behavior, assistive-technology access, final data-flow review,
or legal approval. This release therefore uses a provider-neutral acceptance
manifest as a fail-closed handoff between application CI and institution-owned
services and reviewers.

Copy `provider-acceptance.example.json` to a protected release workspace (not
the public application bundle), replace every placeholder, and attach immutable
evidence for every check. Then run:

```sh
LMS_RELEASE_COMMIT_SHA=<full-source-revision> \
LMS_IOS_BUNDLE_IDENTIFIER=<institution-bundle-id> \
LMS_ANDROID_PACKAGE=<institution-package> \
LMS_PROVIDER_ACCEPTANCE_FILE=/protected/release/provider-acceptance.json \
npm run check:production
```

For a focused preflight, run `npm run validate:provider` with the same
environment. `check:production` additionally validates the native release
identity, requires a live dependency-registry audit, and executes the complete
repository release suite.

The schema-v2 manifest contains **28 required checks**: 21 service/operations
checks plus seven rendered, device, accessibility, privacy, and legal checks.
Its `manualAcceptance` record must contain the SHA-256 digest and 41-case count
of [`../docs/manual-device-accessibility-acceptance-2026-08-20.md`](../docs/manual-device-accessibility-acceptance-2026-08-20.md).
The validator recomputes both values from the release source, so evidence for an
older or shortened checklist cannot be reused silently.

The command exits nonzero for absent, pending, stale, expired, duplicated,
unknown, cross-release, or cross-environment evidence. It also rejects local or
insecure service origins; missing advertised-app capabilities; a stale web
header contract; mismatched source revision or package identity; malformed
signing certificate fingerprints; a mismatched manual-plan hash/count; and
missing Security, Operations, Privacy, Accessibility, Legal, or Release Owner
approval. It never treats client code, a capability string, an unchecked
checkbox, or a simulator/export result as proof that an external control exists.

Evidence references must use an immutable HTTPS or protected artifact-store
location and record that artifact's SHA-256 digest and CI/run identifier. Store
no access tokens, private signing keys, learner records, malware samples, or
other secrets in the manifest. The validator checks the release record and
evidence metadata; the institution retains and access-controls the referenced
reports.

For manual evidence, start with the 41-case plan's evidence header and duplicate
its evidence record for every required case × target slot × role. Export a
privacy-reviewed report to the protected evidence store, hash the exact export,
and reference it with the required evidence kind below. A report may contain
multiple cases, but its case IDs, target slots, roles, candidate hashes, observed
results, defects/retests, and reviewer identity must be traceable. `NOT RUN`,
`BLOCKED`, or required cases omitted from the report cannot be represented as a
passed manifest check.

## Required execution evidence

The following checks must be run against the named production tenant and bound
to the exact release ID.

| Gate | Minimum acceptance scenario |
| --- | --- |
| SSO and token lifecycle | The callback subject matches the authenticated IdP subject; audience/tenant-bound access expires, refreshes, revokes, and logs out without token leakage. |
| Tenant isolation | Cross-tenant stable IDs, cursors, direct-message IDs, asset IDs, and replay keys are denied without revealing whether the target exists. |
| Server RBAC | Student, TA, teacher, IT, and administrator requests are replayed directly against every read/write endpoint; client-supplied roles and actor IDs never grant authority. |
| Principal snapshots | Over-broad courses, rosters, submissions, answer keys, grades, DMs, group threads, and realtime subscriptions are excluded server-side. |
| Atomic mutations | A deliberately failing member of a multi-entity batch leaves no partial course, attempt, grade, message, or content commit. |
| Compare-and-swap | Two devices write from the same ETag/revision; exactly one wins, the other receives a conflict, and no stale edit or tombstone resurrection occurs. |
| Idempotency | The same idempotency key is replayed before, during, and after an ambiguous timeout; the original result is returned and side effects occur once. |
| Announcement outbox | Content publication and its durable outbox record commit atomically. Worker failure/restart, duplicate delivery, edit, withdrawal, and poison-message recovery converge on one canonical Chat message. |
| Realtime scope and CAS | Subscriptions are tenant/thread/participant scoped; sender identity is server-derived; out-of-order edits, read receipts, and tombstones remain monotonic. |
| Upload authorization | Course and thread object scopes, quotas, signed URLs, tenant ACLs, redirect denial, and orphan cleanup are exercised. |
| Malware quarantine | The institution's approved harmless scanner test artifact remains quarantined until a clean verdict; failed/timeout verdicts never release an object. Do not store a sample in this repository. |
| MIME, digest, disposition | Declared type, detected type, extension, size, and SHA-256 are compared; active content uses safe disposition or isolated transformation. |
| Retention/deletion | Expiry, user deletion, legal hold, backup propagation, and signed-URL revocation follow the approved policy. |
| Web delivery | HTTP redirects to HTTPS; deployed HTML has no-store; hashed assets are immutable; SPA routes resolve; every response header in `web-security-headers.json` is observed at the origin/CDN and CSP origins are narrowed. |
| Native signing | Exported iOS and Android artifacts match the manifest's package IDs and public certificate fingerprints; CI proves release signing without exporting private keys. |
| Operations | Audit events identify tenant/principal/action/result without sensitive payloads, alerts are exercised, and a backup is restored and reconciled within approved objectives. |

## Required rendered, accessibility, privacy, and legal evidence

All seven checks below have a 30-day acceptance window, must run against the
production tenant and exact signed/deployed release, and must reference the
strict evidence kind shown. These reports do not replace the more granular
records required by the 41-case plan.

| Gate ID | Required evidence kind | Minimum acceptance scenario |
| --- | --- | --- |
| `acceptance.browser-five-role-journeys` | `browser-acceptance-report` | Render Student, TA, Teacher, IT, and Administrator journeys across Courses/Admin, Chat, and Flashcards/Learn using the deployed web artifact. Cover the four presentations, role denial, greetings, bidirectional announcement edit/withdraw/reconnect, linked-site fallback, canvas dragger, assessment, files, and AI review. |
| `accessibility.web-keyboard-zoom-forced-colors-voiceover` | `web-accessibility-report` | Complete critical journeys with keyboard only, 200%/400% zoom and 320 CSS px reflow, Windows forced colors, and supported macOS Safari VoiceOver. Record focus/order/name/role/state/value, modal/live-region behavior, reordering, horizontal pages, media alternatives, and error recovery. |
| `accessibility.ios-voiceover-media-permissions` | `ios-device-acceptance-report` | On physical supported iPhone/iPad release builds, run VoiceOver, largest text, orientation/reduced-motion, media/fullscreen, captions/transcript, mic allow/deny/revoke/interruption, files/sharing, local notifications, offline/reconnect, account isolation, and background/termination cases. |
| `accessibility.android-talkback-media-permissions` | `android-device-acceptance-report` | On physical supported Android phone/tablet release builds, repeat the corresponding TalkBack, font/display size, system-back, media, mic, files/sharing, local notifications, offline/reconnect, interruption, and principal-isolation cases. |
| `accessibility.disabled-user-critical-journeys` | `disabled-user-accessibility-review` | Disabled users or an accountable accessibility research program review the institution's critical Student and staff journeys with representative access needs. Record participant-safe methodology, barriers, severity, remediation/retest, and reviewer conclusion without participant identity or health data. |
| `privacy.final-data-flow-review` | `privacy-data-flow-review` | Reconcile the exact deployed SSO, API, realtime, asset, AI, analytics/support, notification, cache, logs, backups, retention/deletion, and store declarations against observed traffic and policy. Close or explicitly block every unexplained collection, recipient, purpose, residency, retention, or deletion path. |
| `legal.third-party-licenses-assets-release` | `legal-release-review` | Review the exact artifact/SBOM/notices and every distributed dependency, font, icon, copied/AI/uploader asset, missing license text, attribution/source obligation, branding/trademark, takedown workflow, and institution content right. Record the accountable legal/license owner's release decision; this is not a patent freedom-to-operate claim. |

## Required approvals

After every check's latest `testedAt`, six named institutional owners must approve
the same release ID:

- Security — security and authorization evidence.
- Operations — deployment, monitoring, recovery, and service ownership.
- Privacy — the final observed data-flow and policy/store-declaration review.
- Accessibility — browser, physical-device, assistive-technology, and disabled-
  user evidence and remediation.
- Legal — third-party licenses, assets/content rights, notices, branding, and
  release obligations.
- Release Owner — the complete 28-check record and accepted residual risk.

The committed example is intentionally invalid. It is a complete checklist, not
a release attestation: all 28 checks and all six approvals remain `pending`.
Keep the filled manifest and evidence with the release audit record, rerun checks
within their 30/90/365-day windows, and regenerate approval after the final
check.
