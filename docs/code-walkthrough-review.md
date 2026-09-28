# LMS App Architectural Breakdown

## System Context

`lms-app` is an Expo Router / React Native learning-management prototype with two connected product surfaces:

- A role-aware LMS for courses, timelines, assignments, grading, chat, announcements, live quizzes, institution imports, and deployment-readiness workflows.
- A flashcard study system that can run locally and can also be scoped to the currently authenticated institution principal.

The app is intentionally designed around replaceable data providers. Development builds can use local SQLite/memory repositories or a loopback shared-demo server. Production builds fail closed until the host application configures authenticated institution-backed repositories.

## Architectural Layers

### 1. App Shell And Routing

Primary files:

- `src/app/_layout.tsx`
- `src/app/(tabs)/_layout.tsx`
- `src/app/(tabs)/admin.tsx`
- `src/app/(tabs)/chat.tsx`
- `src/app/(tabs)/index.tsx`
- `src/app/study/[deckId].tsx`
- `src/app/admin/course/[id]/index.tsx`

Responsibilities:

- Initialize settings, fonts, i18n, and LMS state before routed screens render.
- Gate shared-demo sign-in in development mode.
- Provide global app chrome, error boundaries, status bar behavior, and desktop web canvas resizing.
- Keep route files thin; most domain behavior is delegated into components and store actions.

The root shell is security-relevant because account initialization and shared-demo refreshes happen before feature screens can safely assume a principal exists.

### 2. Presentation Components

Primary files:

- `src/components/lms/CourseList.tsx`
- `src/components/lms/LMSComponents.tsx`
- `src/components/lms/AssessmentBuilder.tsx`
- `src/components/lms/AssessmentPlayer.tsx`
- `src/components/lms/AssessmentGrader.tsx`
- `src/components/lms/ContentManager.tsx`
- `src/components/lms/CustomLearningWorkspace.tsx`
- `src/components/lms/RoleOnboardingModal.tsx`
- `src/components/ui/*`

Responsibilities:

- Render role-appropriate learner, instructor, IT, and administrator surfaces.
- Translate UI events into store actions rather than calling repositories directly.
- Keep course details, modals, setup review, syllabus extraction review, analytics, roster actions, and content authoring visible from the admin course flows.
- Preserve accessibility contracts for alerts, modals, keyboard controls, screen-reader labels, and mobile/desktop layouts.

`LMSComponents.tsx` is a large UI bundle. It is best reviewed by feature area rather than top-to-bottom: announcements, syllabus import, analytics, settings, student info, course cards, and modals.

### 3. Application State

Primary files:

- `src/lib/store/useLMSStore.ts`
- `src/lib/store/slices/authSlice.ts`
- `src/lib/store/slices/courseSlice.ts`
- `src/lib/store/slices/contentSlice.ts`
- `src/lib/store/slices/chatSlice.ts`
- `src/lib/store/selectors.ts`
- `src/lib/store/principalGeneration.ts`

Responsibilities:

- Compose auth, courses, content, submissions, chat, live sessions, imports, and warnings into one Zustand store.
- Control login/logout, principal switching, snapshot restore, shared-demo refreshes, and institution imports.
- Prevent stale async repository results from committing after an account switch.
- Provide selectors so components can read derived role/course state without duplicating rules.

The central invariant is principal isolation. When the current user changes, the store clears principal-owned LMS and flashcard state before loading a new repository snapshot.

### 4. Domain Rules

Primary files:

- `src/lib/authorization/coursePermissions.ts`
- `src/lib/authorization/courseRoleManagement.ts`
- `src/lib/assessment/engine.ts`
- `src/lib/chat/threadPolicy.ts`
- `src/lib/chat/announcements.ts`
- `src/lib/groups/courseGroups.ts`
- `src/lib/courseLifecycle.ts`
- `src/lib/coursePresentation.ts`
- `src/lib/contentAvailability.ts`
- `src/lib/liveSessions/validation.ts`

Responsibilities:

- Keep permission, lifecycle, grouping, grading, and presentation rules outside JSX.
- Define which roles can view, create, edit, grade, moderate, host live sessions, and manage rosters.
- Normalize and validate learner-visible content availability across timeline, sequential, and custom course modes.
- Make assessment grading auditable and keep learner-visible study cards separate from answer keys.

These modules are the best place to review correctness because they are covered by focused tests and are less noisy than the UI layer.

### 5. Repository Boundary

Primary files:

- `src/lib/repositories/interfaces.ts`
- `src/lib/repositories/factory.ts`
- `src/lib/repositories/sqlite/*`
- `src/lib/repositories/memory/*`
- `src/lib/repositories/remote/*`

Responsibilities:

- Define the data access contracts used by the store.
- Hide whether data is coming from local demo storage, memory, the shared-demo server, or an institution provider.
- Own server/repository responsibilities such as authorization, timestamps, revision advancement, idempotency, and principal scoping.
- Fail closed in production until real authenticated adapters are configured.

The repository factory is the switchboard:

```text
development + shared-demo URL -> remote shared-demo repositories
development without shared-demo -> local demo repositories
production without configured adapters -> unconfigured factory that throws
production with host adapters -> configured repository factory
```

### 6. Institution Integration

Primary files:

- `src/lib/integration/InstitutionAdapter.ts`
- `src/lib/integration/InstitutionRepositoryFactory.ts`
- `src/lib/integration/institutionSync.ts`
- `src/lib/integration/assetService.ts`
- `src/lib/schema/CourseSchema.ts`
- `docs/institution-integration.md`
- `deployment/README.md`

Responsibilities:

- Pull institution snapshots and push mutation batches through bounded authenticated JSON APIs.
- Enforce HTTPS outside local development.
- Use ETags, idempotency keys, and explicit mutation acknowledgements to avoid stale writes and replay ambiguity.
- Validate imported institution data before caching or committing it to the app state.
- Redact upstream/provider details in production-facing errors.
- Scope uploaded assets and learner-state records to the authenticated principal, course, content, or conversation.

This layer is the boundary between a demo app and a production deployment. Reviews should treat it as a trust boundary, not a convenience wrapper.

### 7. Flashcard Persistence

Primary files:

- `src/lib/db/store.ts`
- `src/lib/db/schema.ts`
- `src/lib/db/import.ts`
- `src/lib/db/export.ts`
- `src/lib/db/principal.ts`
- `src/lib/srs/*`
- `src/app/study/[deckId].tsx`
- `src/app/review/index.tsx`

Responsibilities:

- Store decks, cards, layers, notes, review logs, and FSRS/SRS state.
- Support import/export, tutorial/demo seeding, study sessions, review queues, and per-principal isolation.
- Namespace flashcard data to the active institution principal when the LMS is signed in.

The flashcard system is local-first, but it still participates in the LMS principal boundary through `setFlashcardPrincipal`.

### 8. Testing And Release Gates

Primary files:

- `tests/*.test.ts`
- `src/lib/testing/*`
- `scripts/run-synthetic-journeys.ts`
- `scripts/validate-security.mjs`
- `scripts/validate-production-config.mjs`
- `scripts/validate-provider-readiness.mjs`
- `deployment/provider-acceptance.md`

Responsibilities:

- Cover permissions, principal switching, repository contracts, institution sync, live sessions, chat, assessments, accessibility contracts, and synthetic user journeys.
- Keep production acceptance separate from local automated confidence.
- Prevent release promotion until provider evidence, security headers, dependency notices, SBOM, and manual acceptance gates are satisfied.

## Core Runtime Flows

### App Startup

```text
src/app/_layout.tsx
  -> load user settings
  -> configure i18n
  -> load fonts
  -> useLMSStore.initializeMocks()
      -> repoFactory.auth.getCurrentUser()
      -> restore/cache/validate institution snapshot if present
      -> fetch courses, content, submissions, chats, progress
  -> render routed app or shared-demo sign-in
```

Important invariant: routed screens should not render against partially initialized institutional state.

### Login And Account Switch

```text
UI sign-in / demo role switch
  -> useLMSStore.login(email)
      -> advance principal generation
      -> clear existing principal-scoped state
      -> repoFactory.auth.login(email)
      -> verify authoritative current user
      -> set flashcard principal
      -> initializeMocks()
```

Important invariant: stale async completions from the prior principal must not repopulate state after a newer login/logout begins.

### Course Administration

```text
admin route
  -> CourseList
      -> lifecycle buckets
      -> course card actions
      -> modals from LMSComponents
      -> store actions
      -> repository mutations
      -> local store reconciliation
```

Role checks are split between UI affordances and repository/domain enforcement. UI should hide unavailable actions, but repositories and domain rules must still reject unauthorized mutations.

### Institution Snapshot And Mutation Sync

```text
HttpInstitutionAdapter
  -> GET /lms/v1/snapshot
  -> validate and project snapshot
  -> cache snapshot per principal
  -> UI/store mutation
  -> POST /lms/v1/mutations with If-Match + Idempotency-Key
  -> verify acknowledgement and next ETag
  -> update local state or retain retryable error
```

Important invariant: imported or remote data is not trusted until it passes schema validation and principal-scope projection.

### Chat And Announcements

```text
Course announcement UI
  -> select canonical announcement thread
  -> fetch/subscribe to messages
  -> reconcile linked course content
  -> elect one global popup
  -> dismissal aliases update learner state
```

Chat has direct-message, group, course-topic, and announcement modes. Review cross-thread isolation, revision checks, tombstones, read receipts, and moderation separately.

### Live Sessions

```text
host publishes PopQuizState
  -> repository revision check
  -> learners submit bounded answers
  -> host finalizes active session
  -> repository archives answers as submissions
```

Important invariant: live finalization must be durable and idempotent for the coursework/session pair.

## Trust Boundaries

- **User principal boundary:** course, grade, chat, flashcard, cached snapshot, and learner-state data must not cross accounts.
- **Production/demo boundary:** demo repositories are development fixtures and must never be silently reachable in production.
- **Institution API boundary:** transport is authenticated, HTTPS-only outside local development, size-bounded, ETag-aware, and redacts upstream details.
- **Assessment boundary:** learner-safe snapshots must not expose answer keys; study cards are intentionally learner-visible and modeled separately.
- **Asset/embed boundary:** external sites, uploads, video captions, transcripts, and static widgets are normalized, sandboxed, or rejected.
- **AI boundary:** AI extraction is draft input with source-rights acknowledgement, provenance checks, and human review before applying changes.

## Data Ownership

- `Course`, `ContentItem`, `StudentSubmission`, `ChatThread`, `ChatMessage`, and `PopQuizState` live in `src/types/lms.ts` and are authoritative cross-layer contracts.
- Repositories own persistence, authorization, timestamps, revisions, and idempotency.
- The store owns client-side orchestration and view-ready state.
- Components own rendering, input gathering, and dispatching domain actions.
- Docs and deployment files own manual evidence and production readiness gates.

## Review Hotspots

- Principal clearing and stale async guards in `src/lib/store/useLMSStore.ts`.
- Production fail-closed behavior in `src/lib/repositories/factory.ts`.
- Role capability matrices in `src/lib/authorization/*`.
- Snapshot validation, projection, and cache handling in `src/lib/integration/*`.
- Assessment key handling in `src/lib/schema/CourseSchema.ts` and `src/lib/assessment/engine.ts`.
- Chat privacy, tombstones, moderation, and pagination in `src/lib/chat/*` and repository implementations.
- External embeds, static widgets, video alternatives, and asset upload validation.
- Test coverage for any change that crosses UI, store, repository, and institution sync boundaries.

## Commenting Standard

Every hand-authored TypeScript/TSX file under `src`, excluding generated locale files, has a standardized `@fileoverview` block. Use detailed reviewer notes for architectural files and concise pointers for leaf modules.

Within functions, comments should explain non-obvious decisions:

- Race prevention, idempotency, compare-and-swap, or cross-tab behavior.
- Authorization/privacy boundaries.
- Production fail-closed behavior.
- Data normalization that intentionally rejects or redacts fields.
- UI behavior constrained by platform quirks.

Avoid comments that restate JSX labels, variable names, or direct function calls.

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test
npm run test:journeys
npm run validate:security
npm run validate:production-config
```

For release-level confidence:

```bash
npm run check:release
```
