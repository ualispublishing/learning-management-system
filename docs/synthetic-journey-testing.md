# Synthetic full-app journey testing

Last verified: 2026-08-29

This runner is a privacy-safe, repository-local alternative for exercising
deterministic user-journey behavior when rendered browser automation is not
available. It invokes production store actions, repository authorization,
presentation builders, announcement reconciliation, navigation builders,
flashcard interaction helpers, CSV validation, and AI consent/session guards
against cloned synthetic fixtures.

It is not production telemetry and is not imported by the rendered app. It
does not contact institution SSO, APIs, realtime services, asset storage, AI
providers, SQLite, or a signed-in user account.

## Commands

Run the default 30 repetitions used for p50/p95 summaries:

```sh
npm run test:journeys
```

Write the complete aggregate report to a protected temporary path:

```sh
npm run test:journeys -- --output=/tmp/lms-synthetic-journeys.json
```

Emit one redacted NDJSON event after every measured step:

```sh
npm run test:journeys -- --events --iterations=30
```

The optional `--run-id=<stable-safe-id>` labels a run. Iterations are bounded
from 1 through 100. The repository `check` command runs the default 30-iteration
gate after the ordinary automated test suite.

## Executed plan

Every repetition runs nine complete journey instances and 54 ordered steps:

- Student, TA, Teacher, IT, and Administrator identity, greeting, content,
  course configuration, Chat topic, roster-role, denial, transport, and cleanup
  boundaries.
- Timeline, sequential, linked-site, custom-static, horizontal/shared-page,
  desktop-width, narrow-web, and native-fluid presentation contracts.
- Admin/Courses → Chat announcement publication, exact navigation, Admin edit,
  Chat reverse edit, withdrawal/tombstone, injected acknowledgement failure,
  retry, idempotency, and final convergence.
- Flashcard library/card search, tag filtering, reorder rollback, concurrent
  arrival retention, CSV import/export safety, rapid duplicate activation, and
  safe study-route normalization.
- AI source-rights denial, attested request, duplicate-start suppression,
  stale-completion suppression, reviewer approval, and publication provenance.

Required-step contracts fail on missing, duplicated, unexpected, or
out-of-order events. A successful partial journey cannot report 100% task
completion.

## Measurements and gates

Each event records stable synthetic identifiers only: run, journey, step,
iteration, area, role, completion boundary, expected/actual outcome, boolean
checks, numeric measurements, and monotonic duration. It never records names,
emails, course or message text, answers, grades, URLs, filenames, tokens, or raw
errors.

The aggregate includes:

- journey and required-step completion;
- expected-denial accuracy and unauthorized transport-call count;
- functional/integrity check pass rates;
- p50/p95/max step, task, area, role, and repeated-step latency;
- transport calls and entity-count measurements;
- duplicate activation, stale completion, rollback, idempotency, exact-route,
  announcement convergence, and cleanup results;
- sanitized error classes and telemetry-sink failures.

Functional, coverage, privacy, and telemetry-output failures fail the command.
Local performance budgets are reported separately because shared CI load can
change synthetic duration without changing correctness.

## Latest evidence

The 2026-08-29 default run passed:

- 30 repetitions;
- 270/270 journey instances completed;
- 1,620/1,620 ordered steps passed;
- 270/270 expected denials enforced;
- 30/30 injected announcement failures recovered and converged;
- 90/90 duplicate or stale actions produced the expected no-op;
- zero system or telemetry-sink errors;
- 100% local performance-budget pass rate;
- aggregate step p50 0.023 ms, step p95 0.466 ms, and journey p95 2.717 ms on
  this host.

Those latency values measure local handlers and injected in-memory repositories
on one development host. They are regression diagnostics, not click-to-render
or service-level objectives.

## What remains manual or deployment-backed

Backend/headless simulation cannot establish pixel layout, pointer hit targets,
drag/scroll feel, iframe sizing or provider framing, real Core Web Vitals,
keyboard focus order, screen-reader speech, browser zoom/reflow, native
permission sheets, notification delivery, physical media/device behavior,
background interruptions, production SSO/API/realtime latency, or human
comprehension and satisfaction.

The rendered five-role, physical-device, assistive-technology, staging-service,
security, privacy, legal, and institution acceptance gates therefore remain
open in
[`manual-device-accessibility-acceptance-2026-08-20.md`](./manual-device-accessibility-acceptance-2026-08-20.md).
