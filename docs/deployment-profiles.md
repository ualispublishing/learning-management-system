# Deployment profiles and operating responsibilities

Decision recorded 30 September 2026: **customer-operated deployment is the default**. If negotiations require a hosted service, the publisher must be able to operate the same product. This is an implementation plan, not evidence that either production deployment exists today.

Implementation progress: the [reference authentication service](../server/README.md) now supplies server-side OIDC and persistent application sessions for one dedicated installation. It is not connected to an actual provider or the institutional data gateway yet; the remaining deployment and acceptance requirements below still apply.

Keep one application, one versioned service contract, and one migration/release process. Change deployment configuration and accountable operators between profiles. Avoid customer-specific application forks. The supported infrastructure matrix will be deliberately bounded; portability does not mean support for every database, cloud, operating system, or offline environment.

## 1. The two supported operating profiles

| Responsibility | Customer-operated default | Publisher-operated service |
| --- | --- | --- |
| Infrastructure, domains, certificates, capacity and costs | Customer's named operator | Publisher's named operator |
| Infrastructure and application secrets | Customer controls its credential stores | Publisher controls service credentials; customer controls its identity-provider credentials and policy |
| Application installation, patching and migrations | Customer runs the supported release procedure, with contracted assistance if agreed | Publisher runs the same supported release procedure |
| Backups, recovery drills, monitoring and incident response | Customer owns operation and proves it, unless explicitly contracted otherwise | Publisher owns operation and proves it |
| Identity, enrollment, staff roles, content and data-policy decisions | Customer | Customer; publisher implements agreed service controls |
| Product defects, security fixes, version support and documentation | Publisher maintains supported product releases | Publisher maintains the same releases |
| Support access | Explicit, scoped, time-bounded customer authorization with an audit trail | Scoped operational access with an audit trail; customer-facing support rules agreed in the service contract |
| Export, deletion and exit | Customer executes tested procedures | Publisher executes tested procedures and supplies agreed evidence |

Each contract must name people or teams for these responsibilities and define escalation, support hours, upgrade windows and recovery objectives. “Self-hosted” alone does not answer who notices a failed backup or installs an urgent patch. Neither profile currently has an agreed availability or support commitment.

For the first publisher-operated offering, use a separate deployment per customer as the planning baseline. This reuses the customer-operated installation model and gives a simpler transition between operators. Shared infrastructure or a multi-tenant service may be added after workload, isolation, restore and cost requirements justify it; the hosted option does not inherently require building a multi-tenant platform first.

## 2. Reuse the boundaries already in the code

The [institution integration contract](./institution-integration.md) and [bootstrap entry point](../src/lib/integration/bootstrap.ts) are the starting points:

| Boundary | Existing basis | Remaining implementation |
| --- | --- | --- |
| Web/native client to institutional services | `HttpInstitutionAdapter`, schema 1.0 snapshots and mutations | Reference gateway, version compatibility checks and real deployment configuration |
| Verified identity and sessions | Repository callbacks for login, session lookup, logout, directory lookup | Actual provider integration, safe credential handling, session revocation and direct authorization tests |
| Institutional records | Validated principal projections, canonical readback, revisions and idempotency in the client contract | Durable database, server-enforced roles/tenant scope, atomic transactions and persisted idempotency outcomes |
| Files, learning state and AI | Configurable asset, learning-state and AI service interfaces | Authorized durable storage, retention, quotas and any promised AI operations |
| Live/chat events | Required repository/subscription interfaces | Durable events, scoped delivery, reconnect handling and supported transport |
| Institutional imports | Canonical contract and capability descriptors | Buyer-required connector mappings, reconciliation and ownership rules |

A reference installation needs the client, an authenticated application gateway, a durable data store, protected object storage, identity integration, and operational services for backups and monitoring. Jobs and event delivery may initially run with the application service when that meets reliability requirements. Microservices and Kubernetes are not prerequisites.

Tenant identity must be verified server-side even in a dedicated installation. Do not turn installation configuration, a request header, or client role checks into an authorization authority. Never put database passwords, signing keys, or provider secrets in a web bundle or mobile package.

The current production bootstrap requires repositories, assets, AI and durable learning state. The current production validators also require the advertised capabilities and native identifiers. If the first contract is web-only or excludes AI/live features, implement and test an explicit capability profile across bootstrap, UI, validation and documentation before reducing those requirements. This document does not authorize silently bypassing release gates.

## 3. Portable release work still required

| Work item | Concrete output | Acceptance evidence |
| --- | --- | --- |
| Supported installation target | One documented reference server environment and pinned database/storage versions; reproducible versioned service artifact and client build instructions | Install on a clean customer-like environment without developer-machine state |
| Configuration contract | Versioned schema for public endpoints, identity issuer/audience, storage, quotas and operational settings; separate server secret inputs | Missing/invalid configuration fails visibly before accepting traffic; secret scan of distributed client artifacts passes |
| Environment separation | Development fixtures, staging and production with separate credentials/data | No demo repository or fixture can serve production requests; staging cannot access production learner data |
| Installation and upgrades | Health/readiness checks, migrations, release notes, compatibility window and recoverable deployment procedure | Previous supported version upgrades with representative data; incompatible schema prevents unsafe rollback |
| Operational package | Backup/restore, key rotation, incidents, monitoring, support diagnostics and offboarding runbooks | A second operator follows the procedures; alerts reach the named owner; restore reconciles records and attachments |
| Customer configuration | Brand/profile settings and connector mappings represented as validated data | Same product revision serves two distinct customer configurations without source edits for their business rules |
| Release provenance | Source revision, locked dependencies, notices/SBOM, artifact checksums and retained acceptance reports | Operator can identify and verify the exact installed candidate and its supported upgrade path |
| Both profiles | Deployment configuration and responsibility sheets for each operator | The same release and acceptance suite work on customer-operated and publisher-operated staging installations |

Public configuration may be compiled into an Expo client build. Do not promise that one existing binary can switch arbitrary identity providers or endpoints at runtime: define the supported build/runtime boundary and validate it. Provider-specific implementation stays behind the gateway and adapter contracts.

Default support diagnostics must omit credentials, private course content and learner answers. Any remote support or monitoring service needs an agreed destination, data scope and access policy. A customer-operated installation must not depend on an undocumented publisher service. Required external services, including identity, AI, email or media providers, must be disclosed for the offered profile. Fully disconnected installation is a separate requirement, not an assumed consequence of portability.

## 4. Moving between operators

Moving a deployment is a controlled migration, not merely changing a URL. Preserve stable IDs, domain records, grade/submission history, assets, audit records, and any promised learning state. Make identity mapping explicit when the issuer or tenant changes; do not use email alone to join accounts.

The migration procedure must cover:

1. Inventory the supported release, data, integrations, domains, keys and retention obligations. Agree downtime, recovery limits and which operator is responsible at each step.
2. Provision the destination with compatible versions; transfer an encrypted export through an authorized channel. Establish destination secrets and keys without copying inappropriate access rights.
3. Restore records and files, validate counts/references/checksums, and test the destination with synthetic or authorized accounts. Reconfigure identity callbacks, allowlists, connectors, signed asset access and monitoring.
4. Quiesce writes or perform a verified final synchronization. Reconcile the last acknowledged changes; prevent conflicting writes on two active installations.
5. Cut over endpoints and clients, invalidate obsolete sessions and test sign-in → assignment → submission → grading → reload. Confirm backup and alert routing at the destination.
6. Apply the agreed rollback/roll-forward decision window, then retire the source and expire its retained data/backups according to the agreed policy. Provide completion evidence to both operators.

**Done when:** a staged customer-operated → publisher-operated transfer and a transfer back preserve the agreed records, permissions and recovery objectives. Reusing product code makes this achievable; it does not itself prove data portability.

## 5. Next implementation milestone and inputs

Build one real reference staging journey against the existing contract: authenticate → assign content → save/submit → grade/release → reload → logout/recover. Add direct API tests for unauthorized access and duplicate/conflicting writes. Restart services and restore a backup to prove durability. Package that installation so a second operator can reproduce it. Then run it under both responsibility profiles.

Before selecting the backend and hosting dependencies, obtain:

- The customer's supported hosting environment and whether publisher-operated staging is available; internet and external-service restrictions.
- Expected pilot users/concurrency, content/upload sizes, regions, supported client platforms and a spending ceiling.
- The first identity provider and required institutional integrations, with scoped test access through their normal access controls.
- Named product, installation, security-update, incident and support owners; acceptable recovery time/data loss and patch windows.
- The first essential workflow for each target audience and synthetic course/assessment fixtures with known usage rights.

Engineering can prepare contracts, tests, packaging and runbooks. The customer and publisher must supply the access, infrastructure constraints, operational ownership and acceptance decisions. Track completion through W01, W04–W07 and W10–W12 in the [production roadmap](./production-roadmap-2026-09-28.md).
