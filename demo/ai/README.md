# Prepared MIT OCW lesson demo

For installation and the complete presentation, see the
[demo README](../README.md). For development workflow and completed work, see
[the contribution guide](../../CONTRIBUTING.md).

The distributed sources were sanitized during the October 20 repository privacy
cleanup. Use fresh copies from `sources/` for uploads: older copies may have
different metadata and will fail exact-file matching. Lesson content, prepared
answers and citations are unchanged. Current and archived integrity records refer
to the sanitized copies; see [privacy scope](../../docs/repository-privacy.md).

All six files belong to **MIT 6.0001, Introduction to Computer Science and Programming in Python, Fall 2016**. The lesson is **Lecture 1: What is Computation?**, focused on declarative knowledge, imperative knowledge and algorithms. This is a coherent course sample, not a complete course.

| File in `sources/` | Prepared result |
| --- | --- |
| `mit-6.0001-syllabus.txt` | Course identity, description, three instructors, textbook, 12 undated sessions, 10 policies, 36 citations and two review warnings |
| `mit-6.0001-lecture1-slides.pdf` | Six source-grounded flashcards; original slides 9–12 plus attribution page 35 |
| `mit-6.0001-lecture1-adapted.pptx` | Six cards from the same lecture, citing the editable adapted slides |
| `mit-6.0001-lecture1-excerpt.mp4` | Six cards with transcript quotations and timestamps; 6 minutes 54 seconds |
| `mit-6.0001-lecture1-excerpt.m4a` | Audio of the same video excerpt, with the same six cards |
| `mit-6.0001-lecture1-captions.vtt` | Synchronized English captions for that excerpt, also usable as a card source |

The recording excerpt is **00:08:40–00:15:34 in the original lecture**. Cards cite both clip time and original lecture time. The PowerPoint is an adaptation of MIT's PDF slides, not an original MIT PowerPoint download. The historical syllabus uses Python 3.5. Do not present it as current institutional policy.

## Run and present

For repeatable presentations, open **http://127.0.0.1:4178/ai-demo** after starting `npm run demo:multiuser`, or click **Open AI before & after demo** on the sign-in screen or LMS home header. No demo login is needed for this explicit local showcase.

Choose **Syllabus**, then **Show prepared result**. Compare the source on the left with **Course information**, **Updated syllabus**, and **Field mapping** on the right. The formatted syllabus is a draft summary, with the original source, 36 citations and two review warnings available. Choose **PDF slides**, **PowerPoint**, **Video**, **Audio**, or **Captions**, then show the six-card result and tap the question to reveal its answer, then use **Got it · Next** or **Review again**. You can also drop any bundled file into the common drop area; its contents identify the example.

**Reset preview** clears only this screen. It does not create, overwrite, or publish a course. This is the same `InstitutionAIService` multipart endpoint, prepared provider, and validation used by course imports. `mapSyllabusToCourse` is shared between the preview and reviewed course import. `CourseInformationView` and `CourseStudyCardView` now also share the actual course presentation with the preview. Use **View extraction JSON schema** to inspect the validated response shape; **Finish demo · View evaluation** presents cited teacher-workload research and the separate, unmeasured app pilot criteria. The showcase stops before storage/publication; approvals are never manufactured. It is available only in the explicitly enabled local web demo.

For a file-upload presentation, use **Choose file** and select the files from
`demo/ai/sources/` one at a time, then choose **Show prepared result**. Use the
six files listed above without editing their contents. `.pptx` is supported by
this pack; it does not include a legacy `.ppt` example. The syllabus produces
course fields; the other five files produce flashcards. Multiple-file batch
import and arbitrary new files are not part of this prepared showcase.

## Generating model and live API claims

The active pack was generated on October 6, 2026 by a temporary Codex agent
configured as **GPT-6 Astra (`gpt-6-astra`), xhigh reasoning**, with no inherited
conversation history. It received the task prompts/schemas and the four canonical
text extractions. Its output files were initially validated and promoted unchanged on
October 7. The syllabus was subsequently extended with five field groups copied
from exact source passages: course code, duration, audience, goals and meeting
times. The original 28 citations remain, with eight added citations. Cards remain
unchanged. The revision is documented in
[generation/2026-10-07-course-mapping](generation/2026-10-07-course-mapping/README.md).
Model and reasoning settings, plus the enrichment note, appear beneath each result
and in result exports. They also appear in the actual syllabus/flashcard review
screens, saved syllabus and Course Info views, and published course study player.
New imports retain `provenance.preparedGeneration` with the generation-record hash;
these screens do not fetch the catalog to guess a model for old content. Earlier
imports without this record say the authoring model was not recorded; import a
fresh prepared result to retain the verified attribution. The separate schema
export describes the extraction contract. `prepared-demo/v1` still identifies
the replay engine, not the authoring model.

The [active generation record](generation/2026-10-07-course-mapping/record.json) links source,
extraction and result hashes to the configured model and context boundary.
The [input snapshot](generation/2026-10-06-isolated/request.json) records the
explicit task inputs; it is not a raw API request. Candidate outputs remain in
that folder. The earlier pack, whose exact model was unrecorded, is archived in
`generation/2026-10-01-legacy/`.

The presentation can accurately say: “These drafts were generated by a fresh
Codex agent configured with GPT-6 Astra and xhigh reasoning, checked against the
supplied source text, and saved for this demonstration; additional syllabus fields were then copied from their exact source passages.” Standard Codex
instructions and tools still applied. Media results use prepared transcripts;
this was not a fresh audio/video transcription or a standalone OpenAI API call.
Independent instructor approval remains pending.

The API integration remains a separate step. It can use the same model identifier
and reasoning effort, but must supply the required source processing, prompts,
tools and validation. A fresh call may produce different results. To establish
live quality, record actual API model/response IDs and evaluate new outputs;
replaying the archived results guarantees the same saved content. See
[the adapter integration requirements](../../docs/ai-provider-adapters.md).

## Publish into a demo course

The course flow remains available when you want to demonstrate actual publication:

1. Run `npm run demo:ai:check`, then `npm run demo:multiuser` from the app folder.
2. Open `http://127.0.0.1:4178/`, enter the teacher demo account, and open the programming course.
3. In course syllabus import, choose the prepared syllabus, drag its library entry into the drop area, or drop the downloaded TXT there. Confirm the source-processing acknowledgement and extract.
4. Read the evidence and warnings. Exact term dates are absent. Conditional grading weights are deliberately omitted; existing course grading stays in place. Review the draft, then apply it.
5. Add learning material. Choose a prepared PDF, PowerPoint, audio, video or caption file. The sample enables Media to Cards and requests six cards. Video selection also fills its matching caption track and transcript. Generate, inspect each quotation and answer, explicitly verify each card, then publish.
6. Open a student session to see the material and study set. Source links resolve to the same retained bytes. Files and results remain in this folder; published demo course changes survive browser reloads but reset when the in-memory demo server restarts or `npm run demo:reset` is used.

Use the syllabus drop area for the syllabus, and the learning material drop area for the lesson files. A renamed copy works if its extension still represents its format. Edited or unrelated bytes fail with an explanation; they do not receive another source's results. This flow does not generate new teaching content during the presentation and does not call a live model.

## What is checked

`manifest.json` pins source, extracted-text, result and generation-record hashes. `extracted/` contains canonical text and source locations. `results/` contains the prepared task JSON. `reference/` freezes the active accepted output. `checks.json` records the reproducible automated check results. The server repeats those checks at startup, rejects attribution that disagrees with the generation record, and checks the uploaded file bytes again for each request.

Checks cover hashes, exact quotations and locations, strict output shape, required field evidence, timestamps, count limits and duplicate cards. A model cannot supply human approval or authoritative provenance. Human review still controls publication.

The reference is **a regression baseline, not an independent expert answer key**. Codex authored the prepared outputs against the linked sources and inspected the selected slides. No independent instructor has approved the educational meaning, completeness or caption synchronization. There is no measured “100% accuracy” claim. Model confidence measures claimed source support, not measured correctness.

To change this pack: select a coherent lesson, establish its usage rights, prepare/extract its actual files, author and review grounded outputs, update the saved references intentionally, and update all manifest hashes. Run `npm run demo:ai:check -- --write` to refresh the report, then run `npm run check:release`. Do not simply refresh hashes to silence a failed check. Different materials require new prepared outputs or a live extraction/provider integration.

## Attribution and licence

**Ana Bell, Eric Grimson, and John Guttag. 6.0001 Introduction to Computer Science and Programming in Python, Fall 2016. Massachusetts Institute of Technology: MIT OpenCourseWare.**

- [Course](https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/)
- [Syllabus](https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/pages/syllabus/)
- [Lecture recording and transcript](https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/resources/lecture-1-what-is-computation/)
- [Original slides](https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/resources/mit6_0001f16_lec1/)
- [CC BY-NC-SA 4.0 licence](https://creativecommons.org/licenses/by-nc-sa/4.0/)
- [MIT terms and interpretation of noncommercial use](https://ocw.mit.edu/pages/privacy-and-terms-of-use/)

The educational adaptations and prepared outputs in this folder are provided under **CC BY-NC-SA 4.0**. Application code is separately licensed. `provenance.json` records download URLs, original hashes, authors and changes. Changes include plain-text conversion, PDF page selection, an editable slide adaptation, trimmed/re-encoded video, extracted audio, shifted captions and generated study cards. MIT does not endorse this application.

**Commercial permission is not included.** This pack supports local educational preparation. MIT's terms restrict uses intended to generate sales or profit; obtain permission or replace this pack with institution-owned or commercially licensed material before a sales presentation or commercial release. Attribution alone does not remove that restriction.

## What you can help with

- Supply one institution-owned lesson bundle (syllabus, slides, recording and transcript), or obtain appropriate permission for the intended presentation.
- Have an instructor review the six answers, the syllabus omissions and caption synchronization against the sources.
- Confirm the institution's chosen API, permitted region, data-retention policy and an approved test credential through its server secret store when live integration begins. Never put API secrets in `EXPO_PUBLIC_*` variables or source files.
