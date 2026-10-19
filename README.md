# LMS app

For the complete local demo, run `npm run web` and open
<http://127.0.0.1:4178/demo>. Follow the [demo presentation runbook](./docs/demo-setup.md).

For a focused product review, follow the
[`MVP overview walkthrough`](./docs/mvp-overview-walkthrough.md). It separates
the demo-ready experience from the institution-production launch gates.
For a source-code review, start with the
[`code walkthrough and review guide`](./docs/code-walkthrough-review.md). It maps
the runtime layers, key files, commenting standard, and reviewer priorities.

The Courses screen also includes a browser-local **Institution & business
activation** simulation. It walks a deployment owner through organization,
identity, source-data, governance, pilot preflight, and activation-handoff
stages without creating a tenant or contacting a real provider.
See the [`institution activation user journey`](./docs/institution-activation-user-journey.md)
for the actors, system outcomes, and production gates behind each stage.

## Institution branding

Replace `institution-logo.png`, `institution-primary.png` and
`institution-secondary.png` in this main folder. The last two files should be
solid colour swatches. Edit `institution.json` for the displayed name/tagline.
Startup and web builds generate the shared logo, palette and platform assets.
The shared demo also watches these files while it is running. Use the header's
palette button for quick two-colour previews and light/dark appearance.

See the [branding and demo setup guide](./docs/institution-branding.md) for exact
file requirements, refresh behavior and a presentation checklist.

## Prepared AI lesson demo

Start with the **Demo guide** at `http://127.0.0.1:4178/demo`, or choose
**Explore all demo features** on the role picker. It links to every main demo
area: AI, branding, institution setup, all four course presentations, Learn,
review, statistics, deck creation and Chat. The guide preserves the selected
destination through sign-in and is available from the app and deep-screen headers.

For a repeatable before-and-after presentation, run `npm run web` and
open **http://127.0.0.1:4178/ai-demo**. The same import backend displays syllabus
fields and flashcards beside their sources, without creating or changing courses.
Use **Reset preview** between presentations. The sign-in screen also links here.

The shared demo includes one coherent MIT OCW syllabus/lecture bundle with
PDF, editable PowerPoint, audio, video and captions. Choose or drop these files
to replay pre-generated syllabus extraction and study cards, inspect source
checks, and review before publishing. Run `npm run demo:ai:check` to verify it.
See the [prepared bundle guide](./demo/ai/README.md) and
[server AI provider adapters](./docs/ai-provider-adapters.md).
The OCW pack has a noncommercial licence; obtain permission or replace it before
a sales presentation or commercial release.

## Start the complete web demo

```bash
npm run web
```

`npm run web` starts both the shared backend and the web app with the role picker
and prepared AI pages enabled. `npm run demo:multiuser` is an equivalent command.
Keep the terminal open. Both commands use port **4178**, not Expo's default 8081.
An older browser tab on 8081 will still show the old standalone mode until you
open the URL printed by this launcher.

Starting the command again reuses a verified running demo without resetting it.
If a port belongs to an older launcher or another service, the command explains
the conflict instead of silently opening an incomplete demo. Stop that older
process with Ctrl+C in its terminal and retry. For a second independent demo:

```bash
LMS_DEMO_APP_PORT=4190 LMS_DEMO_SERVER_PORT=4191 npm run web
```

You can also pass `-- --port 4190` to change the web port, or `-- --clear` to
clear Metro's cache on a fresh start. Use a separate backend port for each demo.

## Shared multi-user acceptance mode

Open `http://127.0.0.1:4178` in two or three browser tabs/windows and sign in as
a different synthetic learner, staff member, IT user, or Administrator in each.
Every role receives a replayable, principal-scoped onboarding tour. Use the
global account menu to sign out and return to the role picker. Refreshing a demo
tab also signs it out; no password or production session is stored.

The loopback-only in-memory server shares
courses, posts, submissions, chats, read state, and live sessions. Chat and live
sessions converge automatically (chat uses bounded one-second polling and live
sessions use server-sent events); other shared mutations trigger an automatic
authorized refresh.

Learner resume preferences are stored locally under the selected synthetic
principal. Signing back in as the same demo identity restores them; switching
identities does not expose them. Demo analytics is disabled, and the demo must
never be used with real student or personal data.

Reset the fixtures between scenarios and reload every open test tab:

```bash
npm run demo:reset
```

Follow the complete manual checklist in
[`docs/self-test-user-journeys.md`](./docs/self-test-user-journeys.md).

This shared mode is test infrastructure, not a production backend. It has no
durable database or SSO, binds only to loopback, contains synthetic data, and
erases its state when stopped. Production integration requirements are in
[`docs/institution-integration.md`](./docs/institution-integration.md) and
[`deployment/README.md`](./deployment/README.md). The detailed refresh/resume,
privacy, retention, and cross-origin behavior is recorded in
[`docs/saved-state-and-activity-audit.md`](./docs/saved-state-and-activity-audit.md).

## Frontend-only development

`npm run web:standalone` runs Expo without the shared backend. It uses the local
single-user fixture mode and does not enable demo sign-in or the prepared AI
showcase. Use `npm run web` for presentations and multi-user testing.

## Checks

Install the app and separate reference service dependency graphs:

```bash
npm ci
npm ci --prefix server
```

```bash
npm run typecheck
npm run lint
npm test
npm run check:server
npm run check:release
```

App tests run one file at a time with a 512 MiB V8 old-space limit per process
and a 30-second test timeout. This limits test heap growth, not total system RSS.
TypeScript and lint can require more memory than an individual test. See the
[memory investigation](./docs/memory-investigation-2026-10-05.md) for measured
budgets, assertion guidance and the recent file-retention fix.

The [reference service](./server/README.md) provides OIDC authentication, durable
sessions and an optional [written-assessment gateway](./server/gateway-contract.md).
The actual client repositories pass the assign/submit/grade/reload workflow in
local tests. Live provider/HTTPS acceptance, app login wiring and the remaining
backend services are still required. Demo sign-in remains synthetic.
