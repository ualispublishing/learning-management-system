# LMS app

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

## Local single-user development

```bash
npm run web
```

## Shared multi-user acceptance mode

```bash
npm run demo:multiuser
```

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

The [reference service](./server/README.md) provides OIDC authentication, durable
sessions and an optional [written-assessment gateway](./server/gateway-contract.md).
The actual client repositories pass the assign/submit/grade/reload workflow in
local tests. Live provider/HTTPS acceptance, app login wiring and the remaining
backend services are still required. Demo sign-in remains synthetic.
