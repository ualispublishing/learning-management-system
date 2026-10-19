# Isolated generation record

The user requested fresh generation using the current model in a temporary agent
without the accumulated conversation. The parent session's current-turn metadata
identified `gpt-6-astra` with `xhigh` effort. The temporary agent was explicitly
started with those settings and `fork_turns: none` on October 6, 2026.

The agent was instructed to read only the task prompts/schemas in
`src/lib/ai/prompts.ts` and the four canonical extraction files. It was instructed
not to read prior results, references, tests or conversation history, and to
generate one syllabus and three six-card sets. Standard Codex instructions and
tools still applied. This is an isolated Codex generation, not an API response.

- `candidate/` preserves the four files written by the temporary agent.
- `request.json` snapshots the explicit prompts, schemas and canonical source
  text used for the task. It does not include private Codex instructions and does
  not claim to capture the entire model request or a reproducible API transcript.
- `record.json` records the configuration and input/output digests, the absence
  of an API response ID, and the lack of independent instructor approval.

On October 7, the parent checked all quoted evidence against its exact supplied
location, strict schemas and bounds, and required field evidence using the
existing `runAIProvider` validation. It also read the generated questions,
answers and syllabus fields against the supplied sources. The candidates were
then copied byte-for-byte to `results/` and `reference/`; no answer or quotation
was edited. Earlier outputs were archived under `generation/2026-10-01-legacy/`.

The syllabus now has 10 policies, 28 citations and two warnings; its 12 sessions
remain undated, and conditional grading weights remain omitted. Each lesson
format has six cards. PDF and PowerPoint sets differ where their supplied text
differs. Audio, video and captions share one transcript-derived set.

This validates source alignment and the software workflow, not independent
educational accuracy, completeness, original transcription quality or live API
equivalence. The configured model ID is supported by the agent dispatch, not an
API receipt or a guarantee of an immutable model snapshot.
