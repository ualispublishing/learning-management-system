# Production and company-pitch review — 28 September 2026

**Verdict: suitable for a synthetic-data product demonstration and design-partner discussion; not ready for an institutional production deployment.** This is a substantial functional client prototype with useful integration contracts and defensive engineering. It still lacks the deployed services, reliability, release evidence, and operating capability needed to sell it as a finished LMS.

This review covered the current working directory, including uncommitted and untracked files. It combined architecture, security, UI, persistence and release-tooling inspection, repository checks, targeted failure reproductions, and a short rendered learner walkthrough. It is not a line-by-line certification of all 367 source files, a penetration test, an accessibility certification, or a production load test. No application code was changed. The exported web build was regenerated for verification.

| Intended use | Assessment |
| --- | --- |
| Portfolio or product demo using synthetic data | Yes, with the documented boundaries and known defects disclosed |
| Company discovery / design-partner pitch | Yes; propose a bounded problem and pilot scope |
| Pilot handling real learner records | Not yet; resolve the critical persistence defects and implement/verify the chosen services |
| Enterprise rollout or general institutional release | No |
| Commercial demand, learning outcomes or willingness to pay | Not established by this code review |

The gap is materially larger than polish. Interfaces for a backend are valuable, but are not an implemented backend. Likewise, an acceptance checklist is not evidence that its checks have passed.

**Walkthrough of the system**

| Layer / flow | What exists | Assessment |
| --- | --- | --- |
| Startup and routing | Expo Router shell loads settings, fonts and LMS state; provides error/retry UI and gates authentication | Coherent shell, but font failures can strand startup |
| Identity and roles | Demo identities; injected institution session; centralized course permissions; principal-scoped state | Strong separation of demo and institution modes; actual SSO lifecycle belongs to the missing provider |
| State and repositories | Zustand slices, domain helpers, repository interfaces, demo repositories and institution adapters | Sensible architectural boundaries, weakened by some large components and synchronization defects |
| Courses and content | Four presentation modes, scheduling, groups, content authoring, staff preview and role restrictions | Real product behavior, not merely static screens |
| Assessment and grading | Drafts, timed-attempt binding, validation, grading/revisions and release rules | Meaningful implementation; failed-save handling has a serious answer-loss bug |
| Chat and live sessions | Role/thread policies, announcements, message operations and live session contracts; shared demo service | Demonstrable collaboration; durable production realtime, moderation and operational behavior still require services |
| Flashcards and study | Local web/native storage, import/export, layered cards, FSRS study scheduling and principal filtering | Useful standalone functionality; web persistence loses updates across tabs; not an institutional multi-device record |
| Institution sync | Validated snapshots, bounded HTTP responses, HTTPS, ETags, mutation acknowledgements and capability checks | Good contract discipline, but reads and writes do not maintain a coherent canonical cache |
| AI and assets | Authenticated injectable services, input/response constraints, consent and human review | Real client workflows; provider processing, storage/scanning and lifecycle controls are external work |
| Release and operations | CI definition, dependency policy, SBOM/notices, security headers and provider acceptance manifest | Good preparation; does not prove a deployed, monitored, recoverable service |

Main control flow: `src/app/_layout.tsx` → `useLMSStore` and its slices → domain authorization/validation → repository factory → development repositories or injected institution services. Flashcards use their own principal-aware local persistence. In production, the default repository factory deliberately rejects operations until configured; no application bootstrap invocation connecting a real institution was found. See [factory.ts](../src/lib/repositories/factory.ts#L103) and [bootstrap.ts](../src/lib/integration/bootstrap.ts#L45).

**Prioritized defects**

1. **High — assessment answers can be lost after a failed autosave.** [AssessmentPlayer.tsx:186](../src/components/lms/AssessmentPlayer.tsx#L186) clears the pending payload before saving. Rejection reports an error but does not restore the payload. Once the failed promise settles, [closeAssessment at line 416](../src/components/lms/AssessmentPlayer.tsx#L416) asks the same flush function to save; it finds nothing pending and returns success. Reproduction: edit → save fails → wait for error → exit → reopen. An extracted-source execution harness confirmed that close succeeded with only one failed save attempt and no retained dirty payload. Retain dirty revisions until acknowledgement, support retry, and allow exit only after success or explicit discard. Test this through a rendered component.

2. **High — separate browser tabs silently overwrite flashcard data.** [db/store.ts:38](../src/lib/db/store.ts#L38) uses one storage key; [line 176](../src/lib/db/store.ts#L176) loads it once per runtime, and [line 191](../src/lib/db/store.ts#L191) rewrites the whole blob. The queues coordinate only one tab. A controlled reproduction using two independent instances of the real module and shared storage showed: A inserts deck A, B inserts deck B, both report success, reload contains only B. This can also erase other principals' records because their filtered views share the underlying blob. Use record-level transactional storage or cross-tab locking with fresh reads and version checks. Test independent clients, not just concurrent calls into one module.

3. **High — a concurrent snapshot read can hide an acknowledged mutation.** [InstitutionRepositoryFactory.ts:117](../src/lib/integration/InstitutionRepositoryFactory.ts#L117) serializes mutations, while a read can replace `this.data` at [line 187](../src/lib/integration/InstitutionRepositoryFactory.ts#L187). An in-flight update then writes its result into a detached old object at [line 866](../src/lib/integration/InstitutionRepositoryFactory.ts#L866). A controlled adapter reproduction paused a write, completed a snapshot refresh, then acknowledged the write: the client still showed the old course title. Serialize cache replacement with commits, or detect/rebase against snapshot generations. The reproduction used zero cache TTL to make the race deterministic; normal TTL expiry creates the same condition.

4. **High — mutation acknowledgements can mark noncanonical local values as current.** [PushResult](../src/lib/integration/InstitutionAdapter.ts#L42) returns IDs and cursor/ETag, not canonical changed records. The client advances its cursor/ETag at [line 277](../src/lib/integration/InstitutionRepositoryFactory.ts#L277) and keeps the locally proposed values. If the server normalizes a value, the next conditional read can return 304 and preserve stale client data. Reproduction: server stores `Server canonical course title`, client retains `Client proposed course title` after a not-modified read. This is especially consequential for server-authoritative timestamps and assessment state, although the executed reproduction used a course title. Return and validate canonical records, or refresh canonical data before treating the new cursor/ETag as locally represented.

5. **Medium — a type-valid integration can make logout ineffective.** The provider logout callback is optional at [InstitutionRepositoryFactory.ts:50](../src/lib/integration/InstitutionRepositoryFactory.ts#L50). [The implementation](../src/lib/integration/InstitutionRepositoryFactory.ts#L789) succeeds when it is absent, while `getCurrentUser` can still return the old provider session. Reload can therefore restore the supposedly signed-out account. This is conditional on provider configuration, not a finding about a deployed IdP. Require app-session invalidation, clear retained repository state, and test logout → reload against the actual provider.

6. **Medium — a font-load error can leave startup loading indefinitely.** [The root shell](../src/app/_layout.tsx#L94) ignores the error returned by `useFonts` and keeps the spinner while `fontsLoaded` is false. The installed font hook leaves that flag false after rejection. Use system-font fallback or a recoverable error. Verified by source inspection; not reproduced by blocking a browser font request.

7. **Low — remote-media consent is not bound to its destination.** [CardDisplay.tsx:104](../src/components/ui/CardDisplay.tsx#L104) stores approval as a boolean. Switching depth layers reuses media components, allowing approval for host A to remain when the URI changes to host B. Key approval to the validated destination or remount by URI. Source-backed finding; rendered A→B reproduction remains to be added.

One additional async account-switch concern was not promoted to a confirmed defect: `useLMSStore.updateContentGrouping` lacks the principal-generation guard used by neighboring operations, but institution adapter session checks mitigate some paths. Investigate it when fixing account-transition tests.

**Production disparity beyond the defects**

- **Services and ownership:** implement and deploy real identity, durable data, tenant authorization, asset storage/scanning, AI processing and realtime services. Decide explicitly which you operate and which the customer supplies. “The customer can implement the interface” is a custom integration engagement, not a turnkey SaaS offering.
- **Data lifecycle:** prove backup restoration, retention/deletion, export, account removal, migrations and enrollment history. The v1 active-membership schema needs a deliberate withdrawn/completed history model to preserve historical grades and messages. Local flashcards are not synchronized institutional records or encrypted storage merely because the UI filters by principal.
- **Reliability and scale:** measure the deployed product with realistic rosters, courses, messages, assets, concurrent sessions, slow connections and provider failures. Snapshot validation bounds are useful defenses but do not prove scale. The web export has a roughly 5.1 MB uncompressed entry bundle; profile real load and interaction before optimizing. Sub-millisecond synthetic helper timings are not page-performance measurements.
- **Accessibility and devices:** the repository manual acceptance plan is explicitly `NOT RUN`. Our short browser check confirmed learner sign-in, course list and timeline rendering; it does not close that plan. Physical device, keyboard/focus, screen-reader, zoom, media and interruption evidence remains missing. W3C explicitly calls for knowledgeable human evaluation in addition to tools: [WAI evaluation guidance](https://www.w3.org/WAI/test-evaluate/).
- **Release reproducibility:** this checkout has only an initial Git commit; `src/`, `tests/`, `scripts/` and `.github/` are untracked. A clean checkout of the current commit does not contain the reviewed implementation or CI workflow. Commit reviewed source, keep secrets excluded, and prove an install/build/test from that exact revision before sharing a release candidate. No commit was made during this review.
- **Release enforcement:** the provided GitHub workflow runs the release suite and audit; it does not perform production promotion or invoke the provider acceptance gate. Keep a protected promotion step tied to actual service evidence. The manifest checks evidence metadata; it does not inspect or independently certify the referenced reports.
- **Dependencies and distribution:** the live audit passed the configured policy with two allowed `image-size` advisories. This is not zero vulnerabilities. Notices and SBOM are current, but 16 notice-source entries remain unresolved according to the generator. Resolve the repository's documented release-owner review before distribution; this review makes no legal-clearance claim.
- **Product scope:** institution activation is a development simulation, including a timer-based preflight and local activation flag. Localization is partial: 200 locale files do not translate the core LMS/Chat workflows. Remote course/chat push, richer enrollment lifecycle, offline mutation queues, standards integration and complete enterprise gradebook behavior must be scoped against an actual buyer's needs, not implied by a broad LMS label.

**What was verified**

| Check | Observed result |
| --- | --- |
| Lint and strict TypeScript | Passed |
| Course fixtures | All four validated |
| Security configuration / marker scan | Passed; these are configuration checks, not a penetration test |
| Automated tests | 389 passed initially; two loopback server tests were sandbox-blocked and then both passed when rerun with loopback permission: all 391 passed across those runs |
| Synthetic journeys | 270 journeys / 1,620 steps passed; repository/store execution rather than 270 rendered browser journeys |
| Dependency compatibility/tree | Passed using Expo's local compatibility map; Expo warned that online version validation was unavailable |
| Live production dependency policy | Passed after allowing registry access; one affected package entry, two allowed advisory roots |
| Notices and CycloneDX SBOM | Current; 544 runtime package versions/components; 16 unresolved notice entries |
| Production web export and verification | Passed; 29 files, no source maps or high-confidence secret markers found |
| Production identity preflight | Failed as expected: institution-owned package identifiers and build numbers absent |
| Provider acceptance preflight | Failed as expected: protected evidence manifest absent |
| Browser smoke check | Shared-demo sign-in, learner course list and timeline rendered successfully |
| Targeted failure checks | Autosave loss, cross-tab persistence loss and two institution cache inconsistencies reproduced locally |

The existing tests contain valuable domain and authorization checks. However, [web-rendered-accessibility-contract.test.ts](../tests/web-rendered-accessibility-contract.test.ts#L1) checks source text rather than rendering components. Other UI contracts inspect ASTs. No maintained browser/component-rendering suite was found in the checked test configuration. These checks can all pass while a real interaction loses data, as this review demonstrated.

**What to retain and what to change in future coding practice**

Retain the strict domain validation, centralized roles, production fail-closed behavior, principal scoping, HTTPS/bounded transport, script-free content isolation, explicit AI review and candid demo documentation. These are meaningful engineering strengths.

1. **Finish one durable vertical flow before expanding features.** Start with authenticate → assign → submit → grade → reload on another device → recover from failure. Make its real backend, tests and operating behavior work before adding more presentation modes or integration promises.
2. **Define invariants before implementing async code.** Examples: an acknowledged answer survives reload; failed writes remain dirty; one tab cannot erase another's work; a cursor describes data the client actually holds; logout invalidates the app session.
3. **Test boundaries and failures.** Include timeout after server commit, retry, refresh during a write, two devices/tabs, account switch during a request, expired sessions, storage quota, reload and backup restoration. Test the user's observable result rather than matching implementation text.
4. **Keep the server authoritative.** Roles, enrollment, grades, assessment timing, resource ownership and audit identities must be independently enforced by the backend. Return canonical committed state and design idempotency/concurrency as part of the contract.
5. **Separate persistence controllers from visual components.** Extract assessment session/save behavior first. Large modules such as `LMSComponents.tsx` (~1,778 lines), Chat (~1,600), the schema (~2,458) and institution factory (~2,063) are not inherently disqualifying, but mixed responsibilities make async invariants harder to reason about. Use focused modules and narrow store subscriptions.
6. **Treat test counts as evidence of specific behaviors only.** Maintain a small rendered suite for high-risk journeys and manual device/accessibility evidence alongside domain tests. Name source-contract tests accurately.
7. **Commit in reviewable increments and prove clean builds.** A working local tree is not a reproducible release. Bind CI, migration checks and deployment artifacts to the reviewed revision.
8. **Make product claims traceable to evidence.** Keep an implemented/simulated/planned capability matrix. For security requirements, [OWASP ASVS](https://owasp.org/projects/asvs) provides a basis for verifiable controls; completing a custom checklist alone does not establish equivalent assurance.

**Suggested order of work and company positioning**

First fix the four data-loss/cache-consistency defects and session invalidation, with regression tests. Commit a reproducible candidate. Then choose one customer type, a web-first scope if suitable, and one production provider implementation. Complete a real assignment-to-grade workflow, cross-account isolation, recovery and rendered acceptance against it. Only then run a bounded real-data pilot with named support and service ownership.

Pitch today as an integrated learning-workflow prototype combining configurable courses, assessments, communication and layered flashcards, seeking a design partner for a narrowly scoped deployment. Demonstrate one workflow that matters to that buyer. Ask what system it must coexist with, what problem is costly enough to solve, who would administer it, and which evidence is required for a pilot. Treat improved learning outcomes, adoption and savings as hypotheses to measure.

Do not pitch it as a production-ready enterprise LMS, a proven secure/compliant platform, a fully localized 200-language product, or an out-of-the-box replacement for an institution's current stack. The next milestone is a reliable, deployable, supported slice with a real customer need—not a larger feature inventory.
