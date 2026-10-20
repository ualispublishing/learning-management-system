# Deployment security contract

The application deliberately has no built-in institution URL, tenant, SSO client, access token, signing identity, or production bundle identifier. A production host must provide those values and call `configureInstitutionLMS` with authenticated adapters before rendering authenticated routes. Without that bootstrap, production remains on the fail-closed sign-in/configuration screen and does not load demo institution data.

## Native builds

Set institution-owned identifiers only in the release environment:

```text
LMS_IOS_BUNDLE_IDENTIFIER=<institution-owned reverse-DNS identifier>
LMS_ANDROID_PACKAGE=<institution-owned lowercase reverse-DNS package>
LMS_IOS_BUILD_NUMBER=<next Apple build number>
LMS_ANDROID_VERSION_CODE=<next positive Android version code>
```

Set `LMS_PROVIDER_ACCEPTANCE_FILE` to the protected, completed evidence manifest
and `LMS_RELEASE_COMMIT_SHA` to the exact full source revision. Then run
`npm run check:production` before native release work. It rejects missing,
malformed, or obvious placeholder identifiers, missing or invalid store build
numbers, public environment variables named like secrets, the development
cleartext override, and incomplete, stale, or cross-release provider evidence.
The schema-v2 evidence manifest requires 28 passed checks and six current named
approvals; seven of those checks bind the exact 41-case rendered/device/
accessibility plan, final privacy data-flow review, and legal release review.
It also requires the live dependency-registry audit to pass; an offline or
unreachable registry is a production-check failure.
Advance both build numbers for every store submission.
`LMS_ALLOW_INSECURE_LOCALHOST=1` exists only for an explicitly local native
development build; it must never be present in a release environment.

CI installs with `npm ci`, runs `npm run check:release`, and separately performs a live registry audit with `npm run audit:release`. The audit fails closed on registry/network errors, critical findings, unresolved advisory roots, and any advisory except the two `image-size` build-time advisories documented in `docs/dependency-security-review.md`. Ordinary offline checks do not claim that a stale or unavailable registry audit is clean.

Repository checks also cannot infer external controls from client code. Before a
production promotion, complete the provider-neutral evidence manifest described
in [`provider-acceptance.md`](./provider-acceptance.md). `npm run
validate:provider` validates the path in `LMS_PROVIDER_ACCEPTANCE_FILE`; the
validator can also be run directly with an explicit protected-manifest path.
The committed example is intentionally pending and fails validation. The filled
manifest belongs in a protected release record, not the public application
bundle. See the executable
[`manual device and accessibility acceptance gate`](../docs/manual-device-accessibility-acceptance-2026-08-20.md)
for case IDs, target slots, evidence fields, and truthful unsupported-feature
boundaries; a simulator or export cannot satisfy its physical-device checks.

Android backup, camera, legacy external-storage, and overlay permissions are disabled. Audio recording, photo selection, notifications, file selection, sharing, and network access remain because corresponding user-facing features invoke them. iOS App Transport Security and Android cleartext traffic both default to deny.

The checked iOS privacy manifest declares no tracking code/domains and conservatively reports the linked account identity, potentially sensitive course communications, messages, media, other user content, search history, and product interaction that the advertised LMS can send to institution services for app functionality. The institution must reconcile those declarations and complete App Store and Play Console privacy forms for its actual SSO, API, asset, AI, support, and analytics services. Any additional purpose or data flow requires a reviewed manifest update; do not remove a category merely because one institution has not enabled that feature.

## Web hosting

Apply every entry in `web-security-headers.json` as an HTTP response header at the CDN or origin. The JSON is provider-neutral by design; translate it into the selected provider's configuration rather than assuming a bundled file can set response headers. Narrow `connect-src`, media, image, and frame origins to institution-approved hosts when those origins are known.

The host must also:

1. Redirect HTTP to HTTPS before serving any route.
2. Rewrite application routes to `/index.html` without rewriting static asset requests.
3. Apply the no-store HTML policy and immutable hashed-asset policy in the header contract.
4. Keep SSO tokens out of URLs, `EXPO_PUBLIC_*` variables, browser storage, source maps, logs, and crash metadata.
5. Configure server-side authorization, tenant isolation, CSRF/origin checks, rate limits, audit retention, malware scanning, backups, restore drills, and monitoring.
6. Test the final header policy against SSO redirects and every approved external course-site/media host before launch.

## Remaining external release gates

- Institution SSO and an access-token provider; tokens are held in memory and injected into adapters, not supplied as public build variables.
- HTTPS LMS, asset, and AI endpoints with transactional mutation behavior and authorization enforced independently of the client.
- Apple/Google signing, store records, notification credentials, universal/app-link domains, privacy/support URLs, and institutional branding.
- CDN/origin header installation, DNS/TLS, WAF/rate limiting, observability, incident response, data-retention policy, and backup/restore verification.
- Physical iOS/Android, assistive-technology, browser, SSO, and role-based acceptance testing against the deployed services.
- Physical-device regression of the completed `expo-audio`/`expo-video` migration, including permission denial, interruptions, recording cleanup, silent-mode behavior, fullscreen video, and repeated mount/unmount cycles.
- Release-owner/legal resolution or documented counsel-approved disposition for every package in `THIRD_PARTY_NOTICES.md`'s unresolved section (currently 12), validation of every pinned official publisher/release binding, and approval of the exact SBOM, notices, copied assets, fonts, and distribution obligations. Freshness and digest checks do not substitute for that review.
