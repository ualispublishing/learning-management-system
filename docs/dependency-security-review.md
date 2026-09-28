# Dependency security review

Review date: 2026-09-17

This is an engineering triage of the exact current `package-lock.json`, not a
penetration test or future vulnerability guarantee.

## Current result

A live npm registry audit was rerun after Expo's SDK installer aligned all
native packages to the current SDK 57 compatibility map. `npm audit fix`
applied every compatible non-breaking patch. The following advisory families
were removed during the original and current dependency passes:

- `brace-expansion` denial of service;
- `js-yaml` quadratic parsing;
- `nanoid` zero-length custom-generator loop;
- `postcss` source-map file disclosure; and
- `shell-quote` quadratic parsing.

The SDK patch update also exposed `GHSA-vcc3-ghjq-m6fr`, a moderate
denial-of-service advisory in `decode-uri-component@0.2.2` reached through
Expo Router's query-string dependency. The package publisher's patched 0.5.0
release preserves the public decoder contract, so the root package now pins an
npm override to `decode-uri-component@0.5.0`. The strict audit confirms that
this advisory is no longer present.

The final audit reports 4 high-severity dependency-chain entries. They are not
4 independent defects: all trace to two advisories in transitive
`image-size@1.2.1`:

- `GHSA-w3rx-r6r6-pgpr`: malformed ICNS may cause an infinite loop; and
- `GHSA-5p2g-fcmc-qvqq`: malformed JXL/HEIF may cause an infinite loop.

Metro 0.84 requires `image-size@^1`, while the advisory covers versions through
2.0.2. npm therefore offers only an incompatible Expo 53 downgrade; that would
regress the supported SDK 57 application and was deliberately not applied.

The 2026-09-17 registry result was 0 critical, 4 high, 0 moderate, 0 low, and
0 informational findings across 888 audited packages. The final dependency set
uses `expo@57.0.23`, `expo-audio@57.0.5`, `expo-video@57.0.4`,
`expo-asset@57.0.17`, `expo-router@57.0.21`, and
`expo-splash-screen@57.0.9`.

## Exposure and release action

`image-size` is used by Metro while compiling developer-controlled static
assets. It is not called by the exported LMS when a learner or teacher uploads
media. Until Expo/Metro publishes a compatible patched dependency:

1. Do not allow untrusted ICNS, JXL, or HEIF files into source/build asset
   directories or CI checkout inputs.
2. Keep user uploads in the authenticated asset-service path; never feed them
   to Metro.
3. Track both advisories and update Expo/Metro as soon as its supported SDK line
   accepts a fixed `image-size` release.
4. Keep build workers resource/time constrained; treat a build timeout as a
   security event.
5. Rerun a live registry audit and all three production exports at every release.

The checked-in CycloneDX SBOM and license review are in
[`sbom.cdx.json`](./sbom.cdx.json) and
[`third-party-license-review.md`](./third-party-license-review.md).
