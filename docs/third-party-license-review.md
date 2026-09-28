# Third-party license review

Lockfile workflow reviewed: 2026-08-27

This is an engineering inventory, not a legal opinion or a substitute for the
license text shipped by each package.

The exact installed runtime inventory is checked in as
[`sbom.cdx.json`](./sbom.cdx.json). `npm run sbom:generate` invokes npm's
built-in CycloneDX generator and normalizes only its random timestamp/serial so
an unchanged lockfile and install produce byte-identical output. The checked
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) is likewise generated
from license and notice files actually distributed in installed production
packages and from exact-commit files in package publishers' official
repositories. Pinned upstream sources, package/version assignments, official
URLs, full revisions, and byte digests are declared in
[`third_party/license-sources.json`](../third_party/license-sources.json).
The generator rejects stale components, license-expression mismatches,
unpinned or repository-mismatched GitHub/raw-GitHub provenance shapes, path
escapes, or changed source bytes. The publisher/repository relationship remains
an explicit review item. Both inventories have `--check` release gates and must be
regenerated after the final install. They do not include institution services,
prove that every copied asset is licensed correctly, approve a license choice,
or provide patent clearance.

| SPDX expression reported in exact production SBOM | Packages |
| --- | ---: |
| MIT | 459 |
| ISC | 19 |
| BSD-2-Clause | 11 |
| BSD-3-Clause | 10 |
| Apache-2.0 | 10 |
| BlueOak-1.0.0 | 5 |
| MIT OR CC0-1.0 | 2 |
| Unlicense | 2 |
| 0BSD | 2 |
| MPL-2.0 | 2 |
| MIT AND OFL-1.1 | 1 |
| MIT AND Apache-2.0 | 1 |
| MIT OR Apache-2.0 | 1 |
| Unicode-DFS-2016 | 1 |
| CC0-1.0 | 1 |
| BSD-3-Clause OR GPL-2.0 | 1 |
| Beerware | 1 |

Packages requiring explicit release-owner review include:

- `lightningcss` and its installed Darwin ARM64 package (`MPL-2.0`): retain notices and
  confirm file-level source obligations for any distributed modified files.
- `@expo-google-fonts/inter` (`MIT AND OFL-1.1`): ship the required font
  license/notice with the bundled Inter font files.
- `node-forge` (`BSD-3-Clause OR GPL-2.0`): document selection of the
  BSD-3-Clause licensing option and retain its notice.
- `make-plural` (`Unicode-DFS-2016`) and
  `react-native-fit-image` (`Beerware`): include their exact license text and
  validate any notice/attribution requirements.
- `@expo-google-fonts/material-symbols` (`MIT AND Apache-2.0`), `fb-dotslash`
  (`MIT OR Apache-2.0`), and the dual MIT/CC0 packages: record the selected or
  conjunctive terms in the generated notice file.

## Official-source resolution status

The current exact production graph contains 544 unique runtime package
versions. Of the 66 packages encountered without a recognized bundled license
file in the current and immediately preceding reviewed graphs:

- 49 now use checked-in text copied from exact official publisher commits:
  13 current React Native packages, 30 Metro package versions across the two
  installed Metro release lines, React Compiler, React DevTools, Hermes,
  DotSlash, and `bplist-parser`.
- `stream-buffers@2.2.0` is resolved from its already bundled `UNLICENSE`; the
  scanner now recognizes that standard filename.
- 16 remain unresolved. No generic SPDX template, mirror, license-summary
  website, similarly named sibling package, or current-branch text was used to
  fill these gaps.

Pinned text availability is an engineering provenance result only. In
particular, DotSlash's exact MIT and Apache-2.0 files are both retained; this
does not select an option on behalf of the release owner.

## Exact remaining legal-review set

These are the only package versions still listed in the generated unresolved
section:

| Package | Evidence gap that prevents an engineering resolution |
| --- | --- |
| `@expo/devcert@1.2.1` | The exact official artifact/commit has no full license file; its README gives only an MIT label and copyright shorthand. |
| `@expo/sdk-runtime-versions@1.0.0` | The official npm metadata/artifact declares MIT but supplies neither a repository/revision binding nor full text. |
| `@expo/ws-tunnel@2.0.0` | The official npm metadata has a gitHead but no repository binding, and the artifact has no full text. |
| `@expo/xcpretty@4.4.4` | The artifact omits BSD-3-Clause text and its npm gitHead is not retrievable from the declared archived repository. |
| `badgin@1.2.3` | The exact artifact/official commit gives an MIT label but no full terms. |
| `boolbase@1.0.0` | The artifact declares ISC but has no text or exact official revision binding. |
| `bser@2.1.1` | The artifact declares Apache-2.0 and has only a short source header, not the full terms; npm supplies no exact gitHead. |
| `client-only@0.0.1` | The artifact contains only an MIT metadata declaration and no repository/revision or license text. |
| `fb-watchman@2.0.2` | Metadata declares Apache-2.0 while the shipped source header points to an absent MIT root license; no exact gitHead resolves the conflict. |
| `jimp-compact@0.16.1` | The exact artifact/commit contains only an MIT label and a link to another project's moving license, not exact package terms. |
| `react-remove-scroll-bar@2.3.8` | The artifact README says only MIT; no full text is bundled and its npm gitHead is not retrievable from the declared repository. |
| `server-only@0.0.1` | The artifact contains only an MIT metadata declaration and no repository/revision or license text. |
| `standard-navigation@0.0.5` | The exact artifact/official commit declares MIT but contains no full license text. |
| `string-hash-64@1.0.3` | The exact artifact/official commit declares MIT but contains no full license text. |
| `structured-headers@0.4.1` | The artifact manifest names `LICENSE` for publication, but the exact installed artifact omits it and contains no full text. |
| `tr46@0.0.3` | The exact artifact/official commit declares MIT but contains no full license text. |

Release ownership must obtain exact terms from the publisher or otherwise make
and document a counsel-approved disposition for every row. The generator must
not be bypassed by copying a standard template without package-specific
official evidence.

## Required release gate

1. Regenerate and archive the CycloneDX SBOM from the exact release lockfile.
2. Run `npm run notices:generate`, then resolve or obtain a documented
   counsel-approved disposition for all 16 packages in its unresolved section.
   Validate every pinned official URL, exact revision, publisher/version
   binding, and digest. `notices:check` proves freshness and integrity, not
   legal completeness.
3. Scan the built web/native artifacts so transitive fonts, WASM, icons, and
   copied data are not missed.
4. Fail CI on unknown, disallowed, or newly introduced licenses and run a
   current vulnerability scan.
5. Have counsel/release ownership approve the final notices and distribution
   obligations before publishing.
