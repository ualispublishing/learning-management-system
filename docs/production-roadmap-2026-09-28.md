# LMS production roadmap

Planning baseline: 28 September 2026. Covers corporate training, schools/colleges/universities, independent course providers, and future customer types.

Sources: the [code review](production-and-pitch-review-2026-09-28.md) and your supplied personal-project versus professional-product comparison table (not redistributed).

This is a remaining-work plan. The original review records the 28 September baseline; the implementation update below records subsequent work. Production readiness must be demonstrated for an exact release, supported customer profile, and deployment environment.

## 1. Correct starting point

**Automated tests already exist.** The baseline review observed all 391 tests passing across its runs. The implementation batch now passes **412 automated tests and 270 synthetic repository/store journeys from a clean checkout**, including two rendered assessment tests. Strict TypeScript, lint, fixture checks, dependency/security checks, SBOM/notices and a CI workflow definition are also present. See section 8 for current evidence and limits.

The missing pieces are broader maintained rendered-component coverage and browser E2E tests, real-provider integration evidence, additional failure/concurrency coverage, supported-device/accessibility acceptance, and enforced production promotion. Static source checks and synthetic journeys remain useful; they do not establish those other forms of assurance.

| Status | Current evidence | Consequence for this plan |
| --- | --- | --- |
| Existing foundation | Domain rules, repository interfaces, role checks, principal scoping, bounded transports, tests and release scripts | Extend these; do not replace them merely to appear more professional |
| Defect baseline | D01–D05 now have client repairs and regression coverage; D06 font recovery and D07 destination-bound media consent remain | Complete remaining repairs and verify the deployed provider and supported devices before a real-data pilot |
| Missing production implementation in this repository | Connected durable institutional backend, real identity bootstrap and service operations | Implement one reference production deployment and its supported service contracts |
| Existing definition, deployment unverified | CI workflow, security headers, acceptance manifest, dependency exceptions | Prove their behavior on a tracked revision and deployed candidate |
| Evidence outstanding | Manual/device/accessibility plan marked NOT RUN; restore/load/production-provider evidence absent | Execute checks and retain results; do not turn absence of evidence into a passing status |
| Source tracking | Baseline preserved in `3ee8e3b`; reliability work in `19f0109`; reproducible SBOM fix in `cb5d5a3`; clean checkout verified | Configure the organization-owned remote and enforce required review/release checks |

## 2. Product scope: shared core and customer profiles

Support all requested audiences through a shared product core and explicit profile requirements. Sequence pilots to control risk; the first validated profile does not certify the others. Avoid separate application forks unless an actual requirement justifies one.

| Profile | Additional decisions and capabilities | Acceptance evidence |
| --- | --- | --- |
| Shared core | Organizations, users, roles, courses, enrollment, content, assessment, grading/completion, study, export, support and privacy controls | A user can complete the supported learning journey, reload/resume, and recover from failures without losing acknowledged work |
| Corporate training | Employee lifecycle, department/team mapping, manager visibility, recurring training, completion reporting; SSO/HR import when required | Joiner/mover/leaver scenario; manager sees only authorized people; completion report matches source records |
| Education | Sections/terms, staff roles, grading rules, withdrawals and historical records; SIS/LMS integration and accommodations required by the buyer | Enroll/withdraw/re-enroll without losing historical grades; assessment accommodations and grade-release policy verified |
| Independent providers | Creator/learner permissions, account recovery, invitations or self-enrollment, course ownership/export; commerce only if paid self-service access is offered | Creator publishes; eligible learner enrolls; unauthorized access denied; account recovery and export work; payment/refund entitlement cases if commerce is included |
| Other customers | A recorded requirement assessment: users, data, workflows, identity, integrations, jurisdictions, support and operating constraints | Profile requirements mapped to existing capabilities or explicit work items before a production commitment |

Maintain a capability matrix with **implemented**, **simulated**, **planned**, **disabled**, and **verified for release** states. Institution activation currently simulates provisioning. The locale inventory does not establish full LMS translation. State platform/media/offline limitations explicitly.

**Scope constraint in today's code:** production bootstrap requires AI, assets and durable learning state; the current production validator expects native identifiers, the full advertised capability set, 28 evidence checks, six approval functions, and the 41-case manual plan. A narrower web-only or AI-disabled offering requires a deliberate, versioned change to runtime capability gates, UI, validation, documentation and tests. Do not simply skip checks or mark missing functionality passed. Preserve universal controls such as identity, authorization, data integrity, privacy and recovery in every profile.

## 3. Delivery sequence and release gates

Priority **A** means act first on confirmed release blockers. **B** means required before real-data use of the relevant capability. **C** means expansion work conditional on customer commitments. A pilot with real data still needs production controls within its advertised scope.

| Phase | Work items | Exit gate |
| --- | --- | --- |
| 0 — Preserve and define | W01 requirements, W02 reproducible source | Tracked source; clean-checkout verification; named customer/profile requirements, owners and launch limits |
| 1 — Correctness | W03 defect repairs; first W07 regression/component tests | Reproduced defects fixed; dirty work retained; concurrent clients safe; session invalidation and startup recovery demonstrated |
| 2 — Real services | W04 backend/identity, W05 data lifecycle, W06 security/privacy; extend W07 | Production-like staging completes real end-to-end journeys with server authorization and durable canonical data |
| 3 — Prove operation | W08 experience/accessibility, W09 performance, W10 delivery/operations | Supported-target acceptance; measured load; successful rollback and restore; alerts reach a named operator |
| 4 — Controlled production pilot | W11 distribution, W12 support/business; production evidence | Exact release approved for its profile; open risks have owners; support and recovery available; production checks pass |
| 5 — Expand safely | Additional profiles, integrations, platforms and measured capacity | Each expansion passes its changed requirements and regression gates before being advertised |

Requirements, service decisions and defect repairs can progress in parallel. Release automation cannot be finalized until the deployment scope is known. End-to-end staging tests depend on actual services. Do not assign a calendar release date before these dependencies and staffing are understood.

## 4. Implementation work packages

Ownership below describes responsibilities, not an assumption that a separate hire is needed for each row. You remain the product/release decision maker unless you designate someone else. Engineering work can be carried out here in reviewed increments; service access, policy decisions, customer participation and accountable approval need human owners.

### W01 — Requirements, scope and customer acceptance — A

- [ ] Write a short product brief for each requested audience: buyer, end users, expensive problem, essential journeys, measurable outcomes, and exclusions.
- [ ] Define learner/staff/admin permissions, enrollment lifecycle, grading/completion behavior, content ownership, supported platforms/languages and offline expectations.
- [ ] Identify the system of record for each entity and which integrations are required for the first contract.
- [ ] Agree supported workload limits and service objectives: organizations, enrolled/active/concurrent users, course sizes, upload limits, availability, response-time targets, tolerable disaster data loss and recovery time.
- [ ] Put requirements, acceptance criteria, priority, dependencies and owners into an issue backlog; link tests/evidence back to requirement IDs.

**Done when:** each offered profile has an approved scope with numeric workload/service limits, clear exclusions and testable acceptance criteria. No critical launch decision remains silently assumed. **Owner:** product owner with engineering and pilot representatives.

### W02 — Version control, maintainability and reproducibility — A

- [x] Preserve existing work and commit source, tests, configuration and CI with private/generated artifacts excluded. Baseline: `3ee8e3b`; first reliability batch: `19f0109`.
- [x] Prove dependency installation, checks and web build from a clean checkout with the pinned runtime and lockfile. Revision `cb5d5a3` passed on Node 26.5.0 / npm 11.17.0; commands and limits are recorded in section 8. Hosted CI and other platform evidence remain outstanding.
- [ ] Establish protected main/release branches, required checks, systematic review, release tags, and an emergency-change procedure suitable for the team's size.
- [ ] Extract assessment persistence into a focused controller/state machine; isolate snapshot concurrency behavior; split large components when doing so makes responsibilities clearer. Use narrow store selectors.
- [ ] Maintain architecture decisions, API ownership, coding conventions and a short onboarding guide. Have another qualified person reproduce setup and a routine change.

**Done when:** a specific commit reproduces the candidate; changes are reviewable; another maintainer can build, diagnose and release it. **Owner:** engineering lead; you choose repository ownership/reviewer access.

### W03 — Fix known correctness and recovery defects — A

| Item | Required repair | Regression acceptance |
| --- | --- | --- |
| D01 Assessment autosave | Keep unacknowledged answers dirty; expose retry; block exit unless saved or explicitly discarded | Save rejects, settles, user exits/retries/reopens: no silent loss; test close during failure and after failure |
| D02 Cross-tab flashcards | Replace unsafe whole-blob writes with transactionally safe persistence or coordinated fresh-read/versioned writes | Two independent tabs/principals insert and review concurrently; reload preserves every acknowledged operation |
| D03 Read/write snapshot race | Coordinate snapshot replacement and mutation commit, or detect and reconcile generation changes | Pause a write, complete a refresh, acknowledge the write: visible state remains correct |
| D04 Canonical acknowledgements | Return validated canonical server changes or refresh before advancing the represented cache version | Server changes submitted values; subsequent conditional reads still show authoritative data |
| D05 Logout | Require application-session invalidation and clear retained session/cache state | Logout/reload/expiry/account switch cannot restore access through stale app credentials; legitimate new SSO is distinguished from stale-session reuse |
| D06 Font failure | Fall back to usable fonts or show a recoverable startup error | Failed font request cannot produce an indefinite loading screen |
| D07 Media consent | Bind approval to the intended media destination and reset when it changes | Approve host A, move to a layer using host B: B is not contacted before required approval |
| D08 Account-switch lead | Investigate missing principal-generation guard in grouping updates; repair if reproduced | A delayed prior-account success/failure cannot affect the next account's state |

**Done when:** regression cases fail on the prior behavior and pass on the repair; existing relevant checks still pass. D08 is an investigation, not a confirmed vulnerability. **Owner:** engineering.

### W04 — Real identity, backend and API contracts — B

- [ ] Decide operator model: you host the product, customers host it, or both through supported deployment profiles. Document infrastructure, service and incident responsibilities.
- [ ] Implement a reference durable backend and connect it through the existing adapters before authenticated routes render. Managed services are acceptable; microservices are not a prerequisite.
- [ ] Implement real authentication/session recovery/logout. Support the identity method promised for each profile; enterprise SSO is conditional on that offering, while authenticated authorization is universal.
- [ ] Enforce tenant, principal, enrollment, role and object ownership server-side on reads, mutations, history, files and realtime subscriptions. Derive identity from the session.
- [ ] Make grade/timer/attempt state authoritative; use database transactions, revision conflict checks, stable idempotency across retries and canonical mutation responses. Test ambiguous timeouts after server commit.
- [ ] Define versioned API contracts, validation/error formats, pagination, quotas, rate limits and bounded retry/backoff. Keep client/provider contract tests synchronized.
- [ ] If chat/live/announcements ship, implement durable events/outbox, scoped subscriptions, reconnect reconciliation, duplicate/out-of-order delivery and moderation/report handling.
- [ ] If assets/AI ship, implement authorized storage, upload limits, quarantine/scanning, MIME checks, signed access and cleanup; protect AI requests with quotas, timeouts, cost controls, deletion and review requirements.

**Done when:** actual staging services complete the core journey and deny direct unauthorized API calls; restarting services does not erase acknowledged data. **Owner:** backend/infrastructure engineering; you provide service ownership and scoped access.

### W05 — Data model, migrations, retention and recovery — B

- [ ] Model stable tenant/user/course IDs, lifecycle states, historical enrollment, submissions, grade revisions, deletions and audit records. Define import reconciliation and source-of-truth conflicts.
- [ ] Decide whether institutional flashcards must sync across devices; implement that repository if promised. Document limits and export/recovery if personal local storage remains supported.
- [ ] Define supported local cache content and shared-device cleanup. Principal filtering is not encryption. Apply storage protection appropriate to the agreed data policy.
- [ ] Add versioned migrations, validation against representative old data, backup checkpoints and a recovery strategy for failed/partial migrations. Destructive changes need an explicit staged transition.
- [ ] Implement account/tenant export, retention, deletion, holds where applicable, asset revocation and backup-expiry behavior.
- [ ] Automate protected backups; restore into an isolated environment and reconcile meaningful records and attachments against agreed recovery objectives.

**Done when:** old-version upgrade, withdrawal, export/deletion and disaster restore scenarios have evidence. A successful backup job alone is insufficient. **Owner:** backend/operations plus the data-policy owner.

### W06 — Security, privacy and governance — B

- [ ] Record assets, trust boundaries, threat scenarios and data flows for the deployed services, local storage, assets, AI, logs and support tools.
- [ ] Test tenant/role isolation by direct API calls, including guessed IDs, stale sessions, altered roles, answer-key access, grades and private conversations. Include provider token expiry, revocation and key rotation.
- [ ] Store secrets in the chosen secret manager; separate environments, rotate credentials, scope access and verify logging/build artifacts do not expose them.
- [ ] Apply and probe real HTTPS/CDN/header/CSRF-origin controls as appropriate to the selected auth design. Verify uploaded active content cannot execute with app authority.
- [ ] Define incident triage, vulnerability reporting, patch response and access review. Obtain a risk-appropriate independent security review before exposing real data.
- [ ] Inventory data purpose, recipients, region, retention, deletion and consent. Reconcile AI, analytics, backups and subprocessors with the actual deployment.
- [ ] Identify jurisdiction/customer-specific obligations with qualified reviewers; do not infer legal compliance or certification from automated checks. If minors are in scope, explicitly resolve the resulting requirements before launch.

**Done when:** relevant controls are demonstrated against the candidate and service environment; residual risks have an accountable decision. **Owner:** security/privacy functions with engineering; you identify the responsible people and policy decisions. [OWASP ASVS](https://owasp.org/projects/asvs) is a useful source of verifiable technical requirements, not a certification granted by this plan.

### W07 — Automated testing and quality gates — A/B

Extend the existing suite rather than starting from zero. Require traceability to high-risk behaviors; a headline test count or arbitrary global coverage percentage is not a release decision.

| Layer | Remaining work | Where evidence belongs |
| --- | --- | --- |
| Unit/domain | Regression cases for D01–D08; permissions, grading, dates, schema edges, SRS and recovery invariants | Fast change checks; failures block affected releases |
| Rendered components | Assessment save/failure/exit/reopen tests now render the real component with React Native Web and a simulated DOM. Extend to editor/chat/session UI, keyboard/focus, dialogs and accessible state | Required checks for affected UI; rename source-only contract tests accurately |
| Real-service integration | Real test database/provider endpoints, transactions, migrations, token lifecycle, authorization, canonical responses and idempotency | Disposable test environment with synthetic identities and cleanup |
| Browser E2E | Actual built app with learner/staff/admin identities; publish → enroll → answer → submit → grade/release → reload; chat/study if included | Maintained CI smoke suite plus fuller staging acceptance, screenshots/traces on failure |
| Independent clients/faults | Two tabs/devices/tenants; server commit then timeout; offline/expiry; stale cache; restart; storage quota; duplicate/reordered messages | Deterministic fault tests and production-like staging scenarios |
| Accessibility | Automated rendered checks plus keyboard/focus/zoom/screen-reader review and representative users | CI for detectable regressions; signed manual evidence for the supported matrix |
| Native and compatibility | Signed builds, supported OS/device/browser versions, permission denial, interruption, backgrounding and media | Relevant build checks and real-device acceptance before claiming native support |
| Performance/recovery | Agreed concurrent load, large datasets, upload pressure, provider degradation, deployment rollback and backup restore | Release-bound reports; repeat when workload or architecture changes |

- [ ] Make fixtures deterministic and synthetic; isolate test tenants; control clocks/network failures; prevent tests from contacting real learners or paid providers unexpectedly.
- [ ] Track flaky tests as defects. A rerun must not erase evidence of an unreliable result; critical failures cannot be silently quarantined.
- [ ] Retain CI artifacts and bind evidence to the exact source/build. Establish review of coverage gaps and meaningful failure-path assertions.

**Done when:** critical journeys pass in rendered UI and against actual services, known failures are regression-covered, and required checks block release. **Owner:** engineering/QA; human/device participants are arranged by you or the customer.

### W08 — UX, design system, accessibility and compatibility — B

- [ ] Publish the supported browser/OS/device/version, language, media and offline matrix. Test the minimum supported targets as well as current ones.
- [ ] Standardize existing components/tokens for loading, empty, error, busy, success, validation, focus and unsaved-change states; avoid a cosmetic rewrite detached from user problems.
- [ ] Complete keyboard operation, focus return, modal behavior, labels, contrast, zoom/reflow, screen-reader feedback, captions/transcripts and reduced-motion behavior in critical journeys.
- [ ] Execute and record the applicable manual acceptance plan on the exact candidate. Include disabled-user feedback or an accountable accessibility research process.
- [ ] Observe representative corporate, education and independent-provider users. Track task completion, confusion and errors; fix blocking usability problems.
- [ ] Fully translate the supported language set, including errors/labels and RTL where promised. Label other languages as unsupported until verified.

**Done when:** every supported target and critical journey has passing evidence or the advertised scope is explicitly revised; no unsupported platform is implied. **Owner:** product/design/QA/accessibility. Tools alone cannot establish accessibility: [W3C evaluation guidance](https://www.w3.org/WAI/test-evaluate/).

### W09 — Performance, capacity and cost — B/C

- [ ] Establish realistic data/workload fixtures from W01, including concurrent submissions, large courses, chat history and slow networks/devices.
- [ ] Measure cold load, interaction latency, error rate, API percentiles, resource use and backend query behavior. Profile the roughly 5.1 MB uncompressed web entry bundle before choosing optimizations.
- [ ] Test limits, rate limiting and recovery when a dependency slows or capacity is exhausted. Prevent overload from corrupting accepted work.
- [ ] Set and verify capacity ceilings, quotas and cost budgets for hosting, storage, egress, AI, backups and observability. Track marginal cost per active organization/learner where useful.
- [ ] Improve pagination/indexing/caching or service layout based on measurements; document when scaling changes are needed.

**Done when:** the agreed supported workload meets approved numeric objectives and known cost/limit behavior; synthetic helper timings are not used as browser performance evidence. **Owner:** engineering/operations; you approve workload and spending limits.

### W10 — Environments, deployment and operations — B

- [ ] Separate local/test, staging and production configurations, databases and credentials. Keep real data out of development fixtures and routine logs.
- [ ] Make deployment repeatable with versioned configuration/infrastructure where appropriate; promote identifiable immutable artifacts instead of rebuilding unknown source at release time.
- [ ] Activate the existing CI workflow on tracked source; add profile-appropriate integration/E2E checks and protected production promotion. Keep security and evidence failures fail-closed.
- [ ] Implement useful structured logs, request correlation, health/readiness checks, crash reporting and metrics with redaction and bounded retention. Add traces where they resolve real diagnostic needs.
- [ ] Configure actionable alerts for authentication, failed submissions, error spikes, unhealthy dependencies, backup failures and capacity/cost pressure; prove delivery to a named person.
- [ ] Drill failed deploy, feature disablement, rollback and roll-forward with database compatibility. Avoid assuming application rollback reverses schema/data changes.
- [ ] Write deployment, incident, restore, migration, key-rotation and customer-offboarding runbooks; have another person follow them.

**Done when:** deploy/recover/restore drills succeed within agreed objectives, incidents can be detected and diagnosed, and a human accepts operational ownership. **Owner:** operations/engineering; you name the support and release owners.

### W11 — Distribution, dependencies and release evidence — B

- [ ] Resolve or obtain accountable disposition for the 16 unresolved notice-source entries and distributed assets/fonts/content. Keep the exact SBOM/notices current; do not treat generated inventory as legal approval.
- [ ] Track the two accepted `image-size` advisories with rationale, exposure restrictions, review date and upgrade owner. Rerun the live audit on release candidates.
- [ ] Define dependency updates and compatibility/security patch handling; test upgrades against supported targets and critical journeys.
- [ ] Supply application identity, signing/store records and privacy disclosures for native distributions; validate the actual delivered headers/routes for web.
- [ ] Assemble the required provider/manual/security/privacy/accessibility/distribution evidence and approvals for the candidate. Current gates require 28 checks and six approval functions; store the actual reports securely.
- [ ] Publish release notes, known limitations, supported versions and upgrade/migration guidance. Define end-of-support handling.

**Done when:** the exact distributed artifact has traceable source, passing applicable checks, current evidence, a distribution-rights decision and an accountable release decision. **Owner:** release owner plus qualified distribution/legal reviewers and engineering.

### W12 — Customer onboarding, support and continuing maintenance — B/C

- [ ] Implement audited tenant provisioning/invites/import/offboarding or document a tested operator-assisted process. A manual controlled process can serve early customers; the simulated activation UI cannot claim provisioning.
- [ ] Provide learner, instructor/creator, manager/admin and operator documentation for each supported profile. Publish a reachable support/bug-report path.
- [ ] Define issue severity, triage owner, response expectations, incident communication and escalation. Keep a reproducible issue template and customer-safe diagnostics.
- [ ] Agree pilot success/failure criteria, duration, participant roles and a return/export/exit plan. Capture adoption and completion/error metrics only under the agreed privacy policy.
- [ ] Set a product roadmap from customer evidence, reliability, support burden and unit costs. Do not infer learning improvements from feature availability.
- [ ] If commerce is offered, implement entitlement correctness, verified payment events, duplicate/retry handling, refunds/cancellations and customer support before selling access.
- [ ] Assign backup maintainers and continuing patch/support ownership; record commercial terms and relevant policies with accountable review.

**Done when:** customers can join, use, obtain help, upgrade and leave the supported offering; someone owns maintenance after launch. **Owner:** you/customer success/product, with engineering and qualified reviewers.

## 5. Traceability to your comparison table

Every area in your table is covered below. These are coverage mappings, not completed-task marks.

| Areas from your table | Work packages |
| --- | --- |
| Primary goal; Users; Requirements | W01, W12 |
| Architecture; Code quality | W02, W04 |
| Testing; Edge cases; Failure standard | W03, W07, W10 |
| Error handling; Reliability | W03, W07, W10 |
| Security; Secrets; Data validation | W04, W06, W11 |
| Privacy; Legal/compliance | W05, W06, W11, W12 |
| Performance; Scalability | W01, W09 |
| Compatibility; Accessibility | W07, W08 |
| UI/UX; Design system | W08 |
| Documentation; Ownership; Bus factor | W02, W10, W12 |
| Version control; Code review; CI | W02, W07, W10 |
| CD / releases; Environments; Configuration | W04, W10, W11 |
| Database changes; Backups | W05, W10 |
| Monitoring; Observability; Deployment failures | W09, W10 |
| Dependencies; Licensing | W11 |
| API design; Concurrency; Network failures | W03, W04, W07 |
| Analytics | W06, W09, W12 |
| Support; Issue tracking; Release notes | W01, W11, W12 |
| Maintenance; Roadmap | W11, W12 |
| Definition of done; Overall mindset | All packages and the release decision below |

## 6. How you can help

You do not need to implement every technical item yourself. Your highest-value contribution is supplying decisions, representative users, service ownership and acceptance criteria that cannot be inferred from code.

| Input from you | Concrete deliverable | What it unlocks |
| --- | --- | --- |
| Customer problems and priorities | One short brief for corporate, education and independent providers; rank their first essential workflows | Requirements and pilot order while retaining all audiences in the product plan |
| Scale, budget and operator model | Expected organizations/users/concurrency, platforms, data sizes, spending ceiling, who hosts/supports | Architecture, workload tests and operating plan |
| Product behavior | Examples of enrollment, grading/completion, withdrawal, manager access, offline expectations and integration needs | Domain rules and acceptance tests |
| Representative content | Synthetic/de-identified courses, assessments, grading rubrics, media and import files with known usage rights | Realistic fixtures and demonstrations |
| Access and ownership | Organization-owned repository/cloud/domain/identity accounts; scoped collaborator access through service controls | Staging and deployment; never paste secret keys into chat or source |
| Test participants | Learners, instructors, training managers, creators and administrators; access to supported devices and accessibility expertise | Usability, device and accessibility evidence |
| Data and policy decisions | Intended regions, age groups, data categories, retention/deletion, AI use, export expectations and qualified reviewers | Privacy design and accountable release decisions |
| Operational commitments | Who receives incidents, support availability, tolerable recovery time/data loss and backup maintainer | Runbooks, alert routing and support readiness |
| Commercial and pilot decisions | Success measures, prospective partners, pricing/commerce scope and pilot exit conditions | Evidence-based company pitch and controlled pilot |

An engineering agent can implement fixes, tests, adapters, migration/deployment code and draft runbooks with the agreed access. It cannot manufacture customer demand, human/device evidence, legal clearance, service ownership or accountable approval. Those require your participation or delegated specialists.

## 7. Definition of done and production decision

For each feature/change: approved behavior and failure states; appropriate automated tests; independently enforced access/data rules; review; documentation; deployable configuration; diagnostic visibility; migration/recovery implications addressed; supported-platform evidence; and an owner after release. Use only the checks applicable to that change, but record the reasoning for omissions.

A real-data release is **NO GO** if it has unresolved silent data-loss behavior, unauthorized access, unverified identity/session boundaries, failed required checks, no recoverable data strategy, no operator/support owner, or missing required privacy/accessibility/distribution evidence. A narrow scope can reduce features and platforms, not remove the protections needed by the remaining offering.

A release is **GO for the named profile and limits only** when the exact source and artifacts are reproducible, required journeys and failure cases pass, deployed services and recovery are verified, relevant manual evidence is complete, and accountable owners approve remaining bounded risks. Follow with a controlled pilot, monitored outcomes and an explicit expansion decision.

**First implementation batch:** preserve/track the source; convert D01–D04 into permanent regressions; repair those defects plus logout; add rendered assessment-save coverage; reproduce a clean CI build. In parallel, supply the W01 briefs and service/operating decisions. This batch improves every target audience without prematurely selecting a large infrastructure stack.


## 8. Implementation update — 30 September 2026

The first implementation batch is committed in `19f0109ecbac9ae7458ac5e35df29b9f8efe15be`, followed by the SBOM reproducibility repair in **`cb5d5a34e02735374c0886435bc31b22985bbab6`**, the clean-checkout verification revision. It improves the shared client used by every requested customer profile. It does not implement the production backend or certify a production deployment.

| Item | Implemented behavior | Evidence and limits |
| --- | --- | --- |
| D01 | A focused draft saver retains failed and newer pending answers until acknowledgement; exit retries and waits for saving | Controller tests plus two rendered AssessmentPlayer tests cover failure after settlement, retry, slow writes, latest-answer coalescing and reopening. Browser/tab closure and native interruption remain separate acceptance work |
| D02 | Every web write acquires an origin-wide Web Lock and reloads durable storage before changing it; reads refresh too | Independent module runtimes sharing storage preserve inserts and other principals' records; concurrent reviews accept one valid revision. Browsers without Web Locks reject writes while retaining reads/export. Real-browser matrix testing remains |
| D03 | Snapshot reads and mutation commits use one ordered client queue | A delayed write and overlapping read retain the committed server state |
| D04 | Production configuration requires a complete canonical snapshot after a mutation; cursor/ETag metadata alone is not treated as data; stores and record-returning APIs consume committed values | Tests cover server normalization, later 304 responses, malformed readback and metadata-free production acknowledgements. The gateway must provide read-your-writes consistency; a readback failure can follow an already committed write. Legacy low-level factories have an explicitly documented compatibility mode |
| D05 | App-session revocation, provider callback coordination, stale-result rejection, subscription cleanup and ordered cache erasure | Tests cover fresh-factory reload, missing/ineffective logout, pending same-user operations, sign-in overlapping logout, delayed cache save/restore and legitimate new sign-in. Actual SSO cookies/tokens and multi-device revocation still require provider evidence |
| D08 lead | Content-grouping changes now check principal generations and reload canonical data before updating the store | This closes the observed missing-guard pattern; the original review did not establish an exploitable vulnerability |
| Dependencies | Compatible Expo patches, patched Markdown parser and compatible brace-expansion updates; lockfile, notices and SBOM refreshed | Existing audit policy retained. Dependency exceptions and unresolved notice provenance still need the release owner's review |

The clean-checkout check found and fixed a preexisting SBOM reproducibility defect: npm labeled the root component with the checkout folder name. The generator now uses the declared package name; a permanent test generates and checks SBOMs in two differently named directories.

| Validation on 30 September 2026 | Result |
| --- | --- |
| Exact lockfile installation in a fresh local clone | `npm ci --fetch-timeout=20000 --fetch-retries=0` passed, without reusing the development checkout's node_modules |
| Full release pipeline on `cb5d5a3` | `npm run check:release` passed: lint, strict TypeScript, four fixture validations, security configuration checks, notices, tests, journeys, online Expo compatibility, dependency tree, SBOM, web export and artifact verification |
| Automated behavior checks | **412 passed, zero failed**; includes two rendered AssessmentPlayer tests. The remaining tests cover a mixture of actual domain/store/repository behavior and source/AST contracts |
| Synthetic journeys | **270 journeys / 1,620 steps passed**; these are repository/store journeys, not rendered browser journeys |
| Web artifact | Build and verification passed: 29 files, no source maps or detected high-confidence secret markers |
| Live dependency audit | `npm run audit:release` passed the existing policy; one affected package entry and two documented allowed advisory roots remain. This is not a zero-vulnerability claim |
| Distribution metadata | Notices and SBOM current for 527 runtime components; 16 unresolved notice entries still require release-owner provenance review |
| Production identifiers | `npm run validate:production-config` **failed as expected**: institution-owned iOS/Android identifiers and build values are absent |
| Production provider evidence | `npm run validate:provider` **failed as expected**: no protected acceptance manifest with actual provider evidence supplied |
| Hosted CI / deployment | Not executed: no remote repository configured. The local pipeline passed; branch protection, remote checks and production promotion remain work |
| Actual provider, native devices, accessibility and load/recovery acceptance | Not established by this batch; these remain required for their offered scope |

The expanded suite is a maintained starting point for rendered tests, not a complete browser E2E or real-provider suite. The documentation update after `cb5d5a3` does not change the verified application code, dependencies or tests.

**Next engineering work:** D06/D07 regressions and repairs; then implement a real authenticate → assign → submit → grade → reload/recover journey in staging (W04–W07). Continue remaining browser/device/accessibility acceptance, migration/restore/load tests, deployment/monitoring/support, distribution and customer validation before a real-data pilot. W01–W12 remain the production backlog; completing this batch does not mark those packages complete.

**Your next contribution:** provide a brief for each target audience containing its first essential workflow and success measure; expected pilot users/concurrency and supported platforms; a hosting/support owner and monthly budget; required identity/import integrations; and synthetic sample courses with usage rights. These inputs allow a bounded service implementation while preserving support for all three audiences and future profiles.
