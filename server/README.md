# Reference authentication service

This is the first real authentication infrastructure for the LMS. It is a separately installed Node service that can run under customer or publisher operation. It uses OpenID Connect authorization code flow with PKCE, state and nonce checks, signed ID-token validation, explicit issuer/subject mapping, and durable application sessions. Provider credentials and tokens stay on the server.

**Status: tested foundation, not a production deployment or a connected LMS backend.** No identity-provider account, client registration, HTTPS endpoint, or live browser acceptance has been supplied. The existing app demo still uses synthetic identities. Production app startup still fails closed until all institution adapters are configured. This service does not serve snapshots, coursework, files, AI or live sessions and does not grant access to the demo repositories.

## Demo versus real login

A supervised demonstration with synthetic data can use the current demo account picker. A real-data pilot needs actual authentication, server-side authorization and durable institutional records. The current work establishes the login boundary early so those services can be built around verified identity. A visual login form alone would not provide that boundary.

Authentication proves who signed in. Course membership, staff permissions, attempts, grade release, asset access and tenant scope must still be enforced by the forthcoming gateway. An identity provider's email or arbitrary role claim is never automatically treated as an LMS administrator assignment.

## Implemented behavior

- One configured issuer and customer installation per service/database. A separate installation can be operated by the publisher without an application fork.
- Server-side discovery and code exchange using pinned `openid-client`; PKCE S256, unpredictable state and nonce, browser-bound ten-minute single-use transactions, and JWS verification enabled.
- Accounts must be provisioned by stable issuer + subject. Provider email/name/role claims do not overwrite approved application identity or permissions.
- Opaque `__Host-` cookies with Secure, HttpOnly, SameSite=Lax and Path=/; no Domain attribute. Provider access/refresh/ID tokens are neither returned to the browser nor persisted.
- Eight-hour absolute application sessions with hashed cookie credentials in a private SQLite file; active-account checks on each session lookup. Restart preserves sessions; logout and operator disablement revoke them durably.
- Logout cancels a pending exchange and handles a callback completing before its cookie response arrives. It closes the application session; it does not terminate every session at the identity provider.
- Login and logout require POST and the exact configured Origin. Redirect destinations are fixed; no caller-controlled return URL. Callback uses the query response mode, with duplicate parameters and replay rejected.
- No-store/private responses, redacted errors, HTTPS provider endpoints, bounded login/session records and a bounded rate limiter. The HTTP listener accepts only GET/POST and no request bodies.

The reference store targets **one host and a dedicated installation**, not horizontal scaling or high availability. It uses Node's built-in SQLite with schema version 1. No external database credentials are embedded in the web/mobile client.

## Configure and run

Use the repository's pinned Node 26.5.0 and npm 11.17.0. Install both dependency graphs for the whole repository, or only the server graph when working on this service:

```sh
npm ci --prefix server
npm --prefix server run check
npm --prefix server run audit
```

Copy the *names* in [`.env.example`](./.env.example) into an operator-controlled private configuration/secret system. Supply:

| Input | Required value |
| --- | --- |
| `LMS_AUTH_PUBLIC_ORIGIN` | Exact HTTPS application origin, without a path, query or fragment |
| `LMS_AUTH_ISSUER` | Exact issuer identifier from the chosen single-tenant OIDC provider; preserve its declared trailing-slash semantics |
| `LMS_AUTH_CLIENT_ID` | Registered confidential web client ID |
| `LMS_AUTH_CLIENT_SECRET` | That client's server-only secret; never an `EXPO_PUBLIC_*` variable |
| `LMS_AUTH_DATABASE_PATH` | Absolute persistent file path inside a private, dedicated directory; not a temporary or in-memory database |
| `LMS_AUTH_PORT` | Loopback listener port, default 4190 |

Register this exact redirect at the provider: `https://<application-origin>/lms/v1/auth/callback`. Enable authorization-code flow and query response mode. The reference configuration requests only `openid`; names and LMS permissions come from the approved account mapping. Use the provider's confidential-client secret authentication supported by the installed library. No implicit flow, resource-owner password flow, password database or public self-registration is introduced.

Provision a test user's verified issuer subject and the stable LMS ID intended for the institutional gateway. Quoted display names are supported; these arguments are identity metadata, not passwords:

```sh
node --env-file=/absolute/private/auth.env server/provision.ts add learner-001 provider-subject-123 "Test Learner"
node --env-file=/absolute/private/auth.env server/main.ts
```

The listener binds **127.0.0.1 only**. Put a trusted HTTPS reverse proxy on the same host and route `/lms/v1/auth` and its children to the service. Preserve Origin and Set-Cookie, disable response caching and request-URL logging for callbacks, and impose edge request-size/rate limits. Do not expose the loopback listener directly or silently downgrade public URLs to HTTP. HTTPS configuration is required even for manual browser trials because the session cookies are Secure.

Visit `https://<application-origin>/lms/v1/auth`. The functional server page starts SSO and offers sign-out; successful authentication redirects to the JSON session endpoint to make this first milestone inspectable. Its session response contains approved identity and expiry, never tokens. A wrong configuration, unknown/disabled account or invalid callback fails closed.

Disable a mapping with:

```sh
node --env-file=/absolute/private/auth.env server/provision.ts disable learner-001
```

Provisioning creates new mappings only, defaults to global role `user`, and fails on duplicates. It does not silently reactivate accounts, reassign ownership or grant course roles. Account updates/reactivation/admin assignment need an explicit audited operator workflow in a later increment.

## Integration work still required

1. Connect an actual customer test issuer and verify success, cancellation, callback rejection, reload, expiry, sign-out and deprovisioning in supported browsers. Test provider redirects against the page's CSP. The current tests replace provider HTTP transport, not the OIDC implementation.
2. Implement the durable institutional gateway and apply verified sessions plus object/tenant/course authorization to every API and subscription. Session lookup alone must never authorize arbitrary records.
3. Add an explicit same-origin cookie-authenticated web transport and route bootstrap. Existing `HttpInstitutionAdapter`, assets and AI clients require bearer tokens; do **not** fill their `getAccessToken` callback with cookie contents or the CSRF state. Bind the new transport to this exact origin and protect every unsafe request against CSRF. Wire real app sign-in only when the services required by `configureInstitutionLMS` are available, or deliberately version/test a narrower capability profile.
4. Add the native authentication transport, app-owned redirect scheme/universal links and secure credential handling. HttpOnly web cookies are not a cross-platform credential strategy. Native OAuth testing requires an Expo development build rather than Expo Go. See [Expo's authentication guide](https://docs.expo.dev/guides/authentication/).
5. Agree session lifetime, identity-provider deprovisioning propagation, MFA/conditional-access rules, support access and audit retention. MFA/password recovery remain provider responsibilities. Disabling an IdP account alone does not immediately revoke this eight-hour local application session; add the agreed revalidation/revocation mechanism before promising that behavior.
6. Add operator-visible, redacted authentication/security events, request correlation, health/readiness monitoring, alert delivery and key/secret-rotation procedures. Configure startup supervision and graceful termination on the actual host.
7. Back up and restore the private database with the associated account-mapping policy; prove upgrade/migration and disaster recovery. Encrypt/protect the host volume and backups under the agreed operating profile. Restrictive filesystem permissions are not encryption at rest.

The current rate limiter uses the socket peer address and deliberately ignores spoofable forwarding headers. Behind a same-host proxy its ten-login-per-minute limit is **shared by that proxy's traffic**, so it is a conservative reference ceiling, not a promised per-user limit. Before a multi-user pilot, agree capacity and implement/test trusted edge rate limits and any desired application limit changes. It does not rate-limit the public internet on its own.

SQLite portability is not cloud portability evidence. HA/multiple replicas require a shared transactional session/identity store with the same single-use and revocation guarantees, and acceptance tests on the chosen deployment. Fully offline authentication, multi-issuer tenant discovery, SAML, automated provisioning/SCIM and federation are additional capabilities, not implied by this implementation.

## Verification and maintenance

`npm run check:release` at the repository root now runs server type checks, protocol/handler/persistence/HTTP tests and release-metadata checks in addition to the existing application pipeline. CI installs the server lockfile and audits its runtime dependencies separately. Keep both lockfiles and generated metadata current:

```sh
npm --prefix server run metadata:generate
npm --prefix server run check
npm --prefix server run audit
```

[Server SBOM](./sbom.cdx.json) and [dependency license texts](./THIRD_PARTY_NOTICES.md) cover this separately installed service. They do not replace the client's existing notices/SBOM or release-owner review. Authentication tests exercise real discovery processing, PKCE exchange, RSA signature/issuer/audience/expiry/nonce validation, replay/browser binding, role mapping, logout races, persistence, cookie/header policy and the loopback HTTP bridge. External identity-provider, TLS/reverse-proxy, browser cookie and physical-device evidence remain separate release gates.

Protocol references: [openid-client maintained OIDC example](https://github.com/panva/openid-client/blob/main/examples/oidc.ts), [signature-validation option](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md), and [OAuth security best current practice, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html). The library implements the protocol checks; application account mapping and session lifecycle remain this service's responsibility.
