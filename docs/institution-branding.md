# Institution branding and demo setup

Replace three PNG files in the **project root folder**, alongside `package.json`:

| File | What to supply | What it updates |
| --- | --- | --- |
| `institution-logo.png` | The institution's logo; transparent PNG is welcome | Sign-in, loading/error screens, navigation headers, favicon, native app icon and splash |
| `institution-primary.png` | A small image filled with the primary colour | Main actions, headings, navigation accents and the primary brand stripe |
| `institution-secondary.png` | A small image filled with the secondary colour | Secondary accents and the secondary brand stripe |

The supplied files use the app's existing generic artwork and navy/blue colours. Keep these defaults until you have the institution's approved logo and colours. A wide logo keeps its proportions; it is contained rather than stretched or cropped. Native icons add safe padding. A neutral light or dark canvas is selected to keep the logo visible.

For a colour swatch, a **32 × 32 PNG filled with one colour** is sufficient. A logo can be up to 2048 × 2048 pixels; swatches can be up to 512 × 512. Each file must be at most 8 MiB. Use actual PNG files, not renamed JPEGs or SVGs. Swatches must be fully opaque wherever visible, with at least 90% of visible pixels the same colour. Photos and gradients are rejected with an explanatory error.

To change the displayed name and sign-in tagline, edit the optional `institution.json`:

```json
{
  "name": "Example Institution",
  "tagline": "Learning, together."
}
```

The name can contain up to 80 characters and the tagline up to 160. Keep both nonempty. This changes the displayed app name and browser title; it does not change native bundle identifiers, store accounts, domains or production identity configuration.

## Launch and refresh

From the project root folder:

```bash
npm run demo:multiuser
```

Open <http://127.0.0.1:4178>. Startup generates the branding, starts the shared synthetic demo backend and watches the four input files. Replacing a file while the demo is running regenerates the branding automatically. Allow a few seconds, then refresh if the page has not already updated. A refresh returns to demo sign-in. A browser may need a hard refresh to replace a cached favicon.

`npm run web` starts the complete demo and watches branding automatically, just like `npm run demo:multiuser`. For frontend-only or native development, `npm run web:standalone`, `npm start`, `npm run ios` and `npm run android` generate branding at startup. To watch changes during those sessions, run this in a separate terminal:

```bash
npm run brand:watch
```

To regenerate once, run `npm run brand:sync`. `npm run build:web` also regenerates before exporting. Generated images live in `assets/brand/institution-*.png`, and the generated palette/name manifest lives in `src/lib/branding.generated.json`. Do not edit those outputs directly. Commit the input files and generated outputs together; `npm run brand:check` detects stale outputs, and the normal checks include it.

Installed native launcher icons, app names and splash screens need a new native build and installation. A running web demo can refresh its in-app branding without rebuilding a native app. This workflow configures one institution per build; switching between organizations in a single production service remains separate work.

## Quick colour previews during a presentation

Use the palette button in the main header to open **Institution colours**. Pick or enter both colours, select light/dark/system appearance, and choose **Apply colours**. **Use institution colours** restores the colours from the root files.

Previews are stored only on that browser/device. They do not change other attendees' screens or the source files. To change the default for everyone, replace the two swatches. Saved previews are scoped to the generated branding revision, so a different institution's files do not inherit an earlier institution's preview.

The brand stripe preserves both supplied colours exactly. Text and action colours use readable variants where necessary, including for very light institutional colours. Success, error and warning colours retain their meaning.

## Rehearse the demo

1. Open two browser tabs and choose a learner in one and a teacher in the other. All accounts are fictional and require no password.
2. Walk through the Courses screen, a course, an assessment and Learn/flashcards. Use the shared chat if it is part of your pitch. The account menu signs out; the demo role controls switch identities.
3. Try both colours and check the institution logo on a narrow/mobile window. For the actual presentation, use the root files and clear any temporary preview.
4. For a fresh scenario, run `npm run demo:reset` and reload all demo tabs. Stopping the shared server also clears its in-memory course/chat state. Local learner preferences can remain on that browser.

The full scenario checklist is in [self-test user journeys](./self-test-user-journeys.md). This is a supervised, synthetic-data demo. Real accounts, connected institutional services, durable production storage and deployment acceptance remain in the [production roadmap](./production-roadmap-2026-09-28.md). The existing reference authentication service does not turn the demo role picker into real sign-in.

## What you can provide

- An approved PNG logo, the two exact brand colours (PNG swatches or hex values), institution name and preferred tagline.
- One believable demonstration course and the three or four tasks you want a buyer to see.
- A rehearsal on the actual presentation computer/browser, with notes on any confusing or broken step.

For a pitch, describe working demo features separately from simulated activation, optional external services and production work still required. The [MVP walkthrough](./mvp-overview-walkthrough.md) provides that distinction.
