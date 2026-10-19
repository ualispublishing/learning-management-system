# Memory investigation — October 5, 2026

Following the reported 80 GB memory spike, the earlier test and demo sessions
were no longer running. No historical process snapshot was available, so the
exact process responsible for that entire peak cannot be established.

## Confirmed runaway in a new test

The newly added content-editor/review regression test compared a React-owned
jsdom element directly with `null`. When this assertion failed, Node's assertion
formatter attempted to print the element and its large cyclic React/DOM object
graph. The test had also depended on browser modal animation behavior that jsdom
did not reproduce.

A deliberately bounded reproduction used a 256 MiB V8 old-space heap limit,
a 10-second test timeout and an external process-tree watchdog (512 MiB RSS,
12 seconds, or 1 MiB of log output). The old assertion reached V8 heap exhaustion
in 1.9 seconds; sampled process-tree RSS peaked at 484.4 MiB. The native stack
included repeated string comparisons and array sorting inside failure formatting.
Comparing a boolean instead made the same failing assertion report normally in
0.8 seconds at 282.3 MiB sampled process-tree RSS.

This is strong evidence for the stalled test's runaway allocation, but does not
prove that it accounts for the entire historical 80 GB report. The failing test
was introduced during the demo work, rather than being an observed learner flow.

The regression test now uses lightweight editor/review dialogs around the real
content manager. It verifies that only one dialog is interactive, opening review
does not publish content, and canceling twice preserves the draft. Assertions
compare booleans, text, counts and field values. Similar DOM/null assertions in
the recent showcase, startup and media-consent tests were hardened as well.

## File retention fixed in the app

`PreparedSourcePicker` kept every previously selected file's Blob URL until the
picker unmounted. Repeated large selections could retain unnecessary file data
while the dialog stayed open. It now owns one URL, revokes the previous URL on
replacement, and revokes the final URL on unmount. The active file's Blob remains
available to the course import. A synchronous in-flight guard also prevents
same-tick selections from starting duplicate downloads.

Regression tests verify replacement/unmount cleanup and duplicate-click handling.
The modal handoff also hides the content editor while flashcard review is open,
so it cannot cover the review and consent controls; the draft stays mounted.

## Review scope and limits

The recent demo routes, launcher, source picker, AI showcase and import handoff
were inspected for repeating effects, timers, retained data and unbounded loops:

- Catalog and source-preview effects abort their fetches on cleanup. Their
  dependencies do not feed back from the state they update.
- The content manager clears its interval; the root layout cleans up its shared
  demo subscription and delayed refresh.
- Showcase source URLs are released after processing. The asset upload cache is
  bounded to 20 entries.
- The prepared backend preloads a fixed six-source pack and a fixed export map.
  Upload parsing has a 50 MiB file allowance plus multipart overhead.
- Launcher readiness polling has deadlines and a delay; its shutdown path stops
  its children and branding watcher.

No application-wide infinite loop was established by this review. This was a
focused investigation of recent changes, not a long-running browser heap profile
or a proof that every application path is leak-free.

## Checks and guardrails

`npm test` and `npm run test:coverage` now run one test file at a time, with a
512 MiB V8 old-space limit per Node process and a 30-second test timeout. A V8
heap limit is **not** a hard RSS or whole-machine memory limit: native allocations,
buffers, other heap regions and child processes can add to it. A synchronous
stall also warrants an external watchdog rather than relying only on test timers.

Targeted checks after the fixes:

| Check | Result | Observed memory |
| --- | --- | --- |
| Modal handoff, source picker, media consent and font startup | 21 tests passed in 3.32 seconds; 256 MiB heap per process | Maximum individual child RSS: 342.2 MiB |
| Prepared AI showcase and exports | 8 tests passed in 1.9 seconds; 256 MiB heap per process and 30-second external timeout | Maximum child RSS: 440.7 MiB |
| TypeScript | Passed in 8.2 seconds with a 1536 MiB heap limit and 45-second external timeout | Maximum child RSS: 1594.6 MiB |
| Lint for the changed components and tests | Passed in 5.9 seconds with the same bounded compiler budget | Maximum child RSS: 1772.0 MiB |

The initial 512 MiB compiler and lint attempts hit their heap caps. Both tools
completed normally with the larger bounded budget; they were run sequentially.
The RSS figures above use macOS child-resource accounting and are not total
machine memory measurements. The original reproduction separately sampled the
whole process tree.

The broad release suite, Expo server and browser were not restarted for this
investigation. The showcase tests briefly ran their own loopback HTTP fixture
server and closed it on completion. The October 3 full-release results remain historical evidence,
not a fresh full-suite result for these changes.

For future changes: assert on small values instead of live DOM objects, pair
resource allocation with cleanup, prevent duplicate in-flight work before state
updates render, and investigate failures with one capped process and an external
deadline before repeating a larger suite.
