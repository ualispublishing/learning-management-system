# Repository privacy cleanup

Updated: **20 October 2026**.

The V1 source distribution has been sanitized to remove project-owner and local
development identifiers while keeping the application, attribution and prepared
demonstration usable. This covers the Git worktree and all retained historical
commits, not just the latest files. It is not a guarantee of anonymity.

## Changes

- Personal checkout paths became relative documentation links. The private
  conversation attachment reference was replaced with a description of the
  supplied planning table.
- Internal conversation/task references and recorded local process IDs were
  removed from the prepared-generation and verification records. Model name,
  reasoning configuration, methodology and review limitations remain recorded.
- Demo contacts previously using an institution-like domain now use
  `example.invalid`; related fixtures and assertions were updated together.
- PNG/JPEG text, EXIF and editing metadata were removed where present. Decoded
  pixels were compared before and after; images were not recompressed.
- PowerPoint editor/author/date properties were removed and ZIP entry timestamps
  normalized. Slide, relationship and embedded-resource parts remained identical.
- The PDF producer field was cleared without changing page content streams.
  Audio/video encoder and job tags were cleared, as were container creation and
  modification times. Encoded media bytes, track tables and file offsets remained
  intact. Public course and licensing credits were retained.
- File sizes and dependent SHA-256 references were updated together, including
  archived prepared-pack manifests. These records now identify the sanitized
  distribution; they are not byte-for-byte copies of the pre-cleanup archives.
  Prepared answers, extracted lesson text and citations were not regenerated.
- Git author/committer identities were replaced with
  `LMS Contributors <contributors@example.invalid>`. Commit timestamps were
  normalized to their original UTC calendar dates at midnight. Rewritten commits
  have new hashes; old backup refs, reflogs and unreachable objects were removed
  from this repo. The local Git identity is configured to avoid immediately
  restoring a personal author on the next commit.

The [verification record](./verification/repository-privacy-check-2026-10-20.json)
states the checks actually completed and their limits. A private recovery copy
was retained outside the project; it contains the original identifiers and must
not be included in an upload or shared archive.

## Information deliberately retained

Functional course/user/object IDs, route names, schema versions, integrity
digests, synthetic fixture dates and synthetic account names are necessary for
the code and tests. Package identities, dependency provenance, copyright notices,
public course/instructor credits, source URLs and licence terms also remain.
Public material may be recognizable from its contents even after metadata is
removed. Cleanup does not change ownership or grant permission to distribute it.

The contribution record describes work without naming private contributors.
Evidence retains calendar dates and technical runtime details that explain its
scope. Model attribution remains explicit; removing conversation IDs does not
create an API receipt or prove identical results from a future live request.

## Sharing and future changes

Upload through Git or create a source archive with `git archive`. Do not zip the
entire working directory: dependencies, caches, environment files, local databases,
build logs and recovery copies are not part of the reviewed source distribution.
Git does not version filesystem owners, file creation times or macOS extended
attributes; copies made through other tools may retain those properties.

GitHub repository ownership, uploader authentication, collaborator access and
GitHub audit records are separate from Git commit authorship. A token authenticates
the account performing the upload; an anonymous commit identity does not hide that
account. Previously shared copies, backups, browser history, editor history and
other repositories are outside this cleanup.

Before adding assets or evidence, inspect document/image/media metadata and
visible content. Use synthetic data and reserved example domains, keep credentials
outside the repository, and review staged changes before committing. Run
`npm run demo:ai:check` after changing any prepared source or generation record;
byte changes require deliberate updates to dependent integrity records.
