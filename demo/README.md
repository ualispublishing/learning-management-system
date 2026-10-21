# Learning Management System demo

This directory contains the prepared AI demonstration and its recorded evidence.
The demo runs within the app and uses its course-information, syllabus-review and
flashcard components. You can compare sources with prepared results without
modifying a course, or demonstrate an instructor publishing reviewed results and
a learner viewing them.

See [V1 status and known issues](../V1_STATUS.md) for current limits, unfinished
production work and the distinction between open risks and repaired bugs.

## Start the demo

Use Node.js 26.5.0 and npm 11.17.0 to match the repository's CI configuration.
Run these commands from the **repository root**, not this `demo` directory:

```bash
npm ci
npm run web
```

Keep that terminal open. No provider key is needed for prepared replay.

| Destination | URL |
| --- | --- |
| Guided entry point for all demo areas | <http://127.0.0.1:4178/demo> |
| App and independent synthetic roles | <http://127.0.0.1:4178/> |
| AI before/after comparison | <http://127.0.0.1:4178/ai-demo> |

`npm run demo:multiuser` is equivalent to `npm run web`. The frontend-only
`npm run web:standalone` command does not start the complete demo.

## Present the two AI workflows

Open `/ai-demo` in two tabs. Select **Syllabus** in one and a lesson format in the
other so each workflow can be inspected separately.

1. **Syllabus:** use the prepared source button, or Choose file and select
   `ai/sources/mit-6.0001-syllabus.txt` from this directory. Show the original,
   then choose **Show prepared result**. Walk through Course information, Updated
   syllabus, Field mapping, source evidence, review warnings and the JSON schema.
   The result includes course identity, instructors, learning goals, meeting
   information, policies and an undated session outline. Missing term dates and
   grading weights stay subject to instructor review.
2. **Learning material:** choose the PDF, PowerPoint, video, audio or captions
   sample, or upload its exact file from `ai/sources/`. Show the original and the
   six prepared flashcards. Reveal answers, inspect quotations and page/time
   citations, then show the recorded authoring-model attribution.
3. **Exports and evaluation:** inspect the syllabus draft, course mapping or
   result JSON export. The closing evaluation presents cited research and pilot
   criteria; it does not report measured savings or accuracy for this product.
4. **Repeat:** choose **Reset preview**. This clears only the comparison screen;
   it does not create or overwrite a course.

The [bundle README](./ai/README.md) lists every supported file, the generation
record and its exact boundaries. The [full presentation runbook](../docs/demo-setup.md)
covers course views, study tools, discussions, branding and institution setup.

## Demonstrate actual publication

Sign in as **Teacher** in the main app. Use the course's syllabus import to
review the extraction and apply supported fields. Add a prepared lesson through
the course material workflow, generate its cards, verify each card and publish.
Sign in as **Student A** in another tab to inspect the saved syllabus, lesson and
study set. These are the actual app review and publication flows backed by the
local synthetic service.

The side preview and course flows share the prepared generation endpoint,
validation, course mapping and presentation components. The side preview stops
before publication. A new course is not required for each presentation.

## What replay does

- The server matches uploaded file bytes against the prepared pack. Renaming a
  file works when its extension still represents the format; editing its bytes
  or uploading an unrelated file does not produce a matching prepared result.
- The syllabus source produces course information; the five lesson formats
  produce flashcards. There is no multiple-file batch import in this showcase.
- A temporary Codex agent configured as GPT-6 Astra with xhigh reasoning authored
  the recorded outputs; later syllabus enrichment copied additional exact source
  passages. Attribution distinguishes that authoring record from the replay engine.
- Audio/video cards use prepared transcript evidence. Replay does not transcribe
  media or call a live AI API. A future API call can produce different wording and
  still needs source extraction, schema/evidence validation and human review.

## Reset, troubleshoot and rebrand

- Keep each role in a separate tab. Refresh intentionally returns that tab to
  the role picker; use in-app navigation to retain its current session.
- `npm run demo:reset` resets shared fixtures. Reload all demo tabs afterwards.
  Stopping the owning terminal with Ctrl+C also stops both services; restarting
  restores the shared fixtures. Personal browser preferences have separate reset
  controls.
- Default ports are 4178 for the app and 4180 for the local API. If occupied,
  stop the older owning terminal or run
  `LMS_DEMO_APP_PORT=4190 LMS_DEMO_SERVER_PORT=4191 npm run web`.
- Replace `institution-logo.png`, `institution-primary.png` and
  `institution-secondary.png` at the repository root; use solid colour swatches
  for the latter two. Edit `institution.json` for the name/tagline. See the
  [branding guide](../docs/institution-branding.md).

## Evidence and limitations

`npm run demo:ai:check` verifies the prepared sources, results and attribution
hashes. [Browser records and screenshots](./ai/verification/README.md) document
the tested views and publication paths. The latest broader automated result is
the [19 October verification record](../docs/verification/asset-transport-check-2026-10-19.json).
The [contribution record](../CONTRIBUTING.md#completed-contributions) describes
the work completed across the demo and app.

Use synthetic data only. The demo service has no real SSO or durable production
storage, and its local success does not establish institutional acceptance. No
independent instructor approval, complete lecture coverage or measured teacher
time saving is claimed.

The MIT OCW bundle is attributed under **CC BY-NC-SA 4.0**. Commercial permission
is not included: obtain appropriate permission or replace it with approved
institution-owned/commercially licensed material before a sales presentation or
commercial release. See the [bundle terms](./ai/README.md#attribution-and-licence).
