# Contributions and development

This guide records completed work and explains how to contribute to the app,
reference services and prepared demonstration. The application existed before
the recent assisted development; this record summarizes the recent work rather
than attributing the entire codebase to one contributor.

Maintain [V1_STATUS.md](./V1_STATUS.md) alongside behavior changes: record newly
confirmed bugs, completed verification and changes to the offered capability scope.

## Completed contributions

| Area | Work completed | Evidence or guide |
| --- | --- | --- |
| Architecture and production planning | Code walkthrough, service boundaries, deployment profiles and a prioritized production gap outline | [Code review](./docs/code-walkthrough-review.md), [roadmap](./docs/production-roadmap-2026-09-28.md) |
| Institution branding | Root logo and two colour inputs, generated platform assets, shared in-app branding and palette previews | [Branding guide](./docs/institution-branding.md) |
| Complete web demo | Combined app/backend launcher, independent synthetic roles, demo navigation, reset/reuse behavior and startup checks | [Demo README](./demo/README.md), [launcher tests](./tests/demo-launcher.test.ts) |
| Prepared AI demonstration | Coherent syllabus/lesson bundle, before/after views, exact file matching, saved results, citations and generation attribution | [Bundle record](./demo/ai/README.md), [prepared-pack tests](./tests/prepared-ai.test.ts) |
| Course integration | Shared course-info/flashcard presentation, schema-based syllabus mapping, instructor review and learner-visible publication | [Presentation runbook](./docs/demo-setup.md), [publication tests](./tests/prepared-demo-publication.test.ts) |
| Live AI foundations | Provider interface and OpenAI connector, text/caption extraction, authenticated jobs, persisted receipts, recovery and request history | [Provider guide](./docs/ai-provider-adapters.md), [server AI contract](./server/ai-contract.md) |
| Identity and assessments | Reference OIDC sessions, scoped written-assessment gateway, revision/idempotency checks and cookie clients | [Server guide](./server/README.md), [assessment contract](./server/gateway-contract.md) |
| Upload reliability | Exact-origin HTTPS cookie mode, explicit bearer cookie omission, captured upload inputs, complete deadlines and late-response cleanup | [Asset contract](./docs/institution-integration.md#assets), [13 upload tests](./tests/asset-auth-transport.test.ts) |
| Verification and memory controls | Serial bounded tests, Metro worker limits, file-retention/failure-reporting repairs, synthetic journeys and recorded browser checks | [Memory investigation](./docs/memory-investigation-2026-10-05.md), [verification](./docs/verification/asset-transport-check-2026-10-19.json) |
| V1 handoff and privacy | App/demo onboarding, contribution record, open-issue register, metadata cleanup and sanitized local Git history | [V1 status](./V1_STATUS.md), [privacy scope](./docs/repository-privacy.md) |

The project owner supplied product direction, intended institutional use,
deployment preferences, branding/demo requirements and iterative acceptance
feedback. Codex assisted with code review, implementation, tests, documentation
and recorded verification. `git log` records the changes; author identities were
anonymized during the repository privacy cleanup.
The prepared educational outputs have their own
[generation and enrichment record](./demo/ai/generation/2026-10-07-course-mapping/README.md);
their configured model attribution is not an API receipt or authorship claim for
all application code. Independent instructor review remains pending.

## Verified baseline

The 19 October 2026 local run passed 556 application tests, 54 server tests and
270 synthetic journeys / 1,620 steps, plus lint, type checks, configuration and
metadata checks, web export and exported-file verification. Its process group
peaked at 1,752.6 MiB sampled RSS under a 3,072 MiB cutoff. The
[machine-readable record](./docs/verification/asset-transport-check-2026-10-19.json)
lists the exact commands, source hashes and limitations. This is not hosted CI,
load testing, production acceptance or a guarantee against future memory leaks.

The [roadmap](./docs/production-roadmap-2026-09-28.md) remains authoritative for
open work: complete app SSO, asset storage/retrieval, the offered backend feature
profile, binary/media extraction, live provider evaluation and operational
acceptance. A passing demo must not be presented as a completed production gate.

## Set up a development environment

Match CI's Node.js 26.5.0 and npm 11.17.0, then run from the repository root:

```bash
npm ci
npm ci --prefix server
npm run web
```

Use a feature branch for further work. Keep changes focused on one behavior and
record the problem, resulting behavior, checks run and known limitations in the
pull request. Do not commit dependencies, generated builds, local databases,
credentials or filled provider-acceptance manifests. `.gitignore` already covers
those paths. Original project code remains proprietary under [LICENSE](./LICENSE);
this guide does not grant public contribution or redistribution rights.

## Validate changes

Run the tests that exercise the changed behavior first. Keep test files serial
and preserve the existing timeouts and heap limits. For the full local release
pipeline:

```bash
npm run check:release
```

That command checks the app, reference service, dependency compatibility, SBOM,
web export and exported files. GitHub's
[release workflow](./.github/workflows/release-check.yml) also runs separate
dependency audits. The additional `npm run check:production` command requires
institution-owned configuration, current provider acceptance and audit policy;
do not bypass those gates to label a demo build production-ready.

Do not run several compilers, builds or test suites concurrently on a
memory-constrained machine. For changes to UI behavior, record the actual
browser/device path tested and include screenshots when useful; identify mocks
and untested paths. Avoid snapshots or failure messages that dump large rendered
trees or binary file objects.

## Preserve the important contracts

- Use shared domain validation and presentation components for both the demo and
  actual app. Keep prepared replay explicitly enabled and local; it must not
  silently replace a failed institutional service or start paid generation.
- Require server-side identity, tenant/course/object authorization, source
  validation and appropriate Origin/CSRF checks. Client-side roles and review
  checkboxes do not authorize server mutations.
- Keep uploaded inputs and result provenance bound to the same source. Preserve
  request keys when reconciling uncertain outcomes. Do not automatically repeat
  potentially billable or already-committed operations.
- Require an instructor to review AI drafts. Never manufacture approval or treat
  model confidence as independently measured correctness.
- Protect secrets in server-side configuration. `EXPO_PUBLIC_*` variables are
  bundled into the client and must not contain credentials.

## Change the prepared materials

Use one coherent, appropriately licensed course/lesson bundle. Record attribution
and changes, extract the exact source, review the outputs and deliberately update
the references and generation record before refreshing hashes. Do not edit
hash-bound source files simply to satisfy a formatting check, or regenerate
hashes to conceal an unexplained mismatch.

Run `npm run demo:ai:check` and relevant publication/rendered tests. Review the
[bundle instructions](./demo/ai/README.md) before changing the pack. Keep historical
generation records and verification evidence when they explain the active pack;
they are not disposable cache files.
