# Present the local demo

From the app folder, run `npm run web`. Keep that terminal open and visit
<http://127.0.0.1:4178/demo>. The role picker and app headers also link to this
**Demo guide**. `npm run demo:multiuser` runs the same setup. The deliberately
frontend-only command is `npm run web:standalone`.

## Suggested presentation

1. **AI before & after:** choose Syllabus, show its prepared result, then compare
   Course information, Updated syllabus and Field mapping. Choose a lesson format
   to show six flashcards in the same view as course study sets. Tap a question
   to reveal its answer and evidence; use Got it · Next, Review again or Previous.
   Course information also uses the actual Course Info component. The expanded
   schema fills supported fields, including three learning goals and two meeting
   entries. **View extraction JSON schema** exposes the model response contract.
   Use **Choose file** to select a file from `demo/ai/sources/`, or choose a
   sample button. After processing, select **Export syllabus draft**, **Export
   course mapping**, or **Export result JSON** to inspect the export, then
   **Save file** to download it. **Copy export text** and the selectable text
   provide alternatives. Use Reset preview to repeat without changing a course.
   Close with **Finish demo · View evaluation** for published teacher-workload
   evidence and pilot criteria. Research statistics describe other workflows,
   not measured savings or accuracy for this app.
2. **Courses & teaching:** choose Teacher. On the Courses dashboard, choose the
   course tile's **Syllabus** action, select the prepared syllabus sample,
   acknowledge processing, and choose **Analyze document**. Review the evidence
   and warnings, confirm the review, then **Apply reviewed fields**. Missing
   source dates and grading weights preserve the course's existing settings.
   For a lesson, open the Timeline course, choose **Add Course Materials** →
   **Add Content**, select the prepared PDF sample and give it a title. Turn on
   **Generate Flashcards**, keep **File to Cards** enabled and the maximum at six,
   then choose **Save & Add to Course**. Acknowledge processing, generate the six cards, review each card against
   its source, and publish. Both the lesson and study set appear together.
   Return to Courses, switch to **Student A**, open the same course and choose
   **Study Flashcards** to reveal answers and source citations as a learner.
3. **Course presentations:** the guide links to timeline, sequential, linked-site
   and interactive-workspace examples. In the last one, open Student Preview and
   Algorithm Studio to show Dashboard, Code lab and Visualization. Code checks
   inspect source text; they do not execute uploaded code. In Code lab, check the
   starter text to show feedback, use Show hint, then copy the displayed reference
   pattern into the editor and check again. Reset restores the starter. In
   Visualization, Generate sample updates both the bars and the text data table;
   these are deterministic sample values, not measured program performance.
   The back arrow inside the workspace returns to the course.
4. **Learn & flashcards:** choose one of the four showcase decks. Demonstrate a
   study session, layers and notes. Deck actions expose card browsing and editing;
   the guide also links to deck creation, due-card review and statistics.
5. **Chat & collaboration:** open a second tab on this computer, choose Student A
   and enter the same course discussion as Teacher. Send a synthetic message and
   observe it in the other session. Roles remain independent in each page.
6. **Institution colours:** preview both institution colours from the guide.
   For permanent branding, replace the root logo and two solid-colour image files;
   see [the branding guide](./institution-branding.md).
7. **Institution setup walkthrough:** demonstrate the six local planning stages.
   This does not create a tenant, connect SSO or accept a contract.

The guide remembers the requested destination while you choose a role. Its links
and the AI page's Back to LMS link use in-app navigation to retain the session.
Role restrictions still apply: use Teacher/Admin for authoring and Student A for
learner actions. Change roles from Courses, or sign out through the account menu.

## Repeat and recover

- Refreshing a tab intentionally signs it out. Use guide/navigation buttons when
  you want to keep the current account.
- Running `npm run web` again reuses a verified running demo without resetting it.
- Stop the owning terminal with Ctrl+C to stop both services. Restarting restores
  shared course, content and chat fixtures. `npm run demo:reset` also resets them;
  reload all open demo tabs afterwards.
- Personal flashcard progress, colour previews and setup drafts are browser-local
  and survive server restarts. The setup walkthrough and colour panel have their
  own reset controls. AI Reset preview only clears its temporary comparison.
- An occupied port belonging to another app produces a startup error. Stop that
  process in its terminal, or use distinct app and API ports as described in the
  [README](../README.md). An old tab on 8081 is not the complete demo on 4178.
- If an old in-app browser tab remains on an internal connection-error page after
  restarting the server, open a fresh tab directly at
  `http://127.0.0.1:4178/demo`. This recovered the browser verification session;
  there is no need to interact with the internal error-page URL.

## Verification and remaining boundaries

The latest broader automated run on October 19 passed 556 app tests, 54 server
tests and 270 synthetic journeys / 1,620 steps, plus lint, type/configuration and
metadata checks, web export and 30-file verification. It added cookie-authenticated
asset-client and complete upload-deadline coverage. See the
[verification record](./verification/asset-transport-check-2026-10-19.json).
This run did not repeat browser visual checks or exercise a deployed storage/SSO
service; the browser evidence below retains its original scope and dates.

On October 18, a visual follow-up verified workspace entry, code-pattern feedback
and reset, chart/table updates, workspace exit, and the prepared syllabus's course
information, draft, field mapping and evaluation views. No console errors were
recorded. Server-process RSS peaked at 1007.2 MiB, excluding browser memory, and
the temporary server was stopped. See the [record and screenshots](../demo/ai/verification/demo-visual-check-2026-10-18.json).
No application code changed during that visual pass. The then-current automated
check was the October 16 run in the [verification log](../demo/ai/verification/README.md).

On October 17, the browser pass verified all five prepared lesson formats,
PowerPoint file selection, syllabus draft/mapping/export preview, and actual
Teacher-to-Student A publication. The learner saw the syllabus fields and the
published flashcard set with source citations and recorded model attribution.
Both sessions remained independent, AI/LMS navigation retained Teacher's account,
and neither tab reported console errors. Server-process RSS peaked below 1 GiB;
browser memory was not measured. The temporary verification server was stopped
and its test publications discarded. See the [browser evidence](../demo/ai/verification/ai-browser-check-2026-10-17.json).

On October 10, compatible Expo SDK 57 patches were installed and Metro was
limited to two transform workers. Dependency alignment, regenerated notices/SBOM,
the full app check (**470 tests and 270 synthetic journeys**), the production web
export and exported-file verification all passed. The unchanged reference service
passed its 34 tests on October 9. A post-update browser check confirmed syllabus
mapping, video flashcards with evidence, Teacher sign-in and AI/LMS navigation,
with no browser console errors. The check/build process group peaked at about
1.56 GiB; the browser-server group peaked at about 1.50 GiB. These short checks
exclude browser memory and do not establish long-duration memory stability.

On October 8, the full app check passed with **470 app tests and 270 synthetic
journeys**, plus lint, TypeScript, branding, prepared-pack, fixture, security
configuration and notice checks. Browser verification applied the expanded
syllabus through Teacher's review flow and confirmed its fields in a separate
Student A session, preserving existing dates and grading settings. A typing bug
in multiline syllabus fields was fixed and regression-tested. The side demo and
course player share the actual presentation components; the closing evaluation
keeps published research separate from unmeasured app results. See the
[current verification record](../demo/ai/verification/README.md).

On October 3, 2026, browser checks opened every guide destination, verified the
post-sign-in destination, inspected both branding inputs and the setup modal,
exercised Algorithm Studio feedback/visualization, and confirmed AI-to-LMS
navigation preserves the account. Earlier shared-session checks confirmed that a
teacher's message appears for the learner without a reload.

The earlier complete release check passed: 460 app tests, 34 reference-service tests,
270 synthetic journeys, lint, TypeScript, fixture/security checks, dependency
alignment, notices/SBOM and exported-web verification. These are automated and
targeted browser checks, not a claim that every manual acceptance row was run.

On October 4, browser verification selected the bundled PowerPoint through the
file chooser and generated its six cards. Downloads of the syllabus Markdown,
course mapping and flashcard JSON completed, and the saved files were inspected.
Exports use HTTP attachments from the local backend instead of transient browser
Blob downloads. All six source formats have tests comparing saved bytes with
their visible export previews. Portable drafts keep source evidence, warnings
and pending review status; they omit temporary request/card IDs. Fourteen focused
AI tests, lint and TypeScript passed after this change.

In the initial October 5 pass, an in-app drag of the prepared PDF into the learning-material area
worked. The content editor was then fixed to yield to the flashcard review dialog:
consent, generation of six cards, and the publication review gate were checked.
Canceling returned the same draft, and reopening allowed generation again. This
initial pass did not publish another study set. A subsequent memory investigation fixed
runaway test-failure formatting and retained file URLs, and added serial test
execution with heap limits and timeouts. See the
[memory investigation](./memory-investigation-2026-10-05.md) for bounded check
results and the limits of the diagnosis.

The resumed October 5–6 browser pass completed syllabus analysis and application
with 23 evidence entries, 12 undated topics and five warnings. It also generated,
reviewed and published a prepared PDF lesson's six cards. Publication stayed
disabled until every card was acknowledged. After switching to the actual
Student A account, the source lesson and study set were visible, the first answer
and PDF page/slide citation rendered correctly, and card navigation worked. No
browser console errors appeared in the October 6 flow. See the
[learner screenshot](../demo/ai/verification/learner-publication-2026-10-06.png).

The new HTTP integration test covers syllabus mapping, paired lesson/card
publication, learner re-login, source matching, transcripts/captions and role
restrictions. It passed along with TypeScript and targeted lint; the full release
suite was not rerun. The October 6 browser pass used a supervised `npm run web`
process with a Node heap limit and server-process memory/time limits. These are
bounded functional checks, not a long-duration memory test or an accuracy audit.

Prepared AI accepts the bundled sources; a live institutional AI provider and
arbitrary-document extraction are separate integration work. SSO and durable
production hosting are also separate. Native-device behavior, syllabus dragging
and dragging files from Finder into the browser retain the manual checks
documented in [demo verification](../demo/ai/verification/README.md).
Obtain permission or replace the noncommercial MIT OCW pack before commercial
presentations.
