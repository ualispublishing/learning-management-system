# Architecture compatibility

## Compatibility promise

The app is compatible with an institutional architecture when a server-side connector can produce the versioned institution contract and honor its mutation acknowledgements. The app does not require a specific SIS, LMS, database, cloud, programming language, or transport behind that gateway.

This is not a claim that every product becomes zero-configuration. Standards reduce connector work; proprietary systems still require an audited mapper. Provider SDKs and secrets remain outside the Expo client.

## Supported connector profiles

| Upstream architecture | Preferred connector | Expected coverage |
| --- | --- | --- |
| OneRoster 1.2 REST | OneRoster connector | Users, organizations/classes, courses, enrollments, line items/results |
| OneRoster CSV/SFTP | Scheduled import connector | Batch roster and grade exchange; no real-time assumptions |
| LTI 1.3/Advantage | LTI launch + NRPS + AGS + Deep Linking | SSO/context launch, course roster, assignments/grade passback |
| Ed-Fi ODS/API | Ed-Fi connector or its OneRoster service | K-12 identity, organization, enrollment, academic data projection |
| Canvas, Google Classroom, Microsoft Education, Moodle, Brightspace, Blackboard, or another vendor API | Vendor connector | Provider-specific courses, roster, content, submissions, and grades according to granted scopes |
| Existing institutional middleware/ESB/iPaaS | Gateway-native connector | Map its canonical events/API into this contract |
| Legacy database | Institution-hosted read/change-data-capture adapter | Never expose database credentials or direct queries to the client |

## Connector boundary

Every connector must implement four concerns independently:

1. **Discovery and capability declaration** — source ID, kind/version, supported read/write/realtime features, and provider health.
2. **Canonical reads** — principal-scoped snapshots plus bounded cursor upserts and explicit tombstones.
3. **Canonical writes** — atomic/idempotent mutation batches, optimistic concurrency, authoritative timestamps, and exact acknowledgement.
4. **Identity and policy** — tenant isolation, subject mapping, role mapping, scopes, consent, retention, and audit evidence.

The gateway must maintain stable identity mappings. External IDs are scoped by tenant, source, and entity type. Email, names, course codes, and array positions are not keys.

## Authority and routing

Define one authoritative writer for each field/domain. A safe default is:

| Domain | Typical authority |
| --- | --- |
| Person identity, school, term, enrollment, section | SIS/OneRoster/Ed-Fi |
| Course content and native assignments | Existing LMS or this LMS, selected per course |
| External line items and grade passback | Existing LMS/SIS gradebook |
| Flashcard decks, cards, scheduling, and review history | This app |
| Chat/live-session state | This app's institutional realtime service |
| Authentication and global entitlements | Institution identity provider |

The gateway rejects conflicting writers instead of resolving them by last-write-wins. App-native records may retain an upstream source link, but an upstream refresh must not overwrite learner flashcard review state.

## Partial and read-only systems

Each source advertises validated capabilities such as `roster.read`, `content.write`, or `grades.write`. When a descriptor is present, the repository blocks unsupported writes before sending them. Read-only systems can still provide courses and rosters while app-native services own content and study activity.

The client must not infer write support because it can read a domain. Realtime chat and live sessions also require their injected authenticated repositories; a capability string alone does not create a transport.

## Incremental synchronization

Cursor upserts merge stable IDs. Remote deletion and roster add/drop use explicit `deletions` tombstones. The effective post-merge snapshot is fully revalidated, so a connector cannot remove a user, course, content item, or thread while leaving dependent enrollments, submissions, messages, or grade references behind.

Complete snapshots remain the recovery mechanism when a provider lacks reliable delta/change tracking. Gateways should checkpoint source cursors only after the canonical update commits successfully.

## Certification checklist

A connector is not production-ready until it passes:

- representative contract fixtures for every supported role and course topology;
- initial, delta, tombstone, add/drop, term rollover, and replay tests;
- capability-negative tests proving unsupported writes never reach the provider;
- identifier collision and source migration tests;
- idempotency and compare-and-swap conflict tests across devices;
- principal/tenant isolation and over-broad payload rejection tests;
- grade round-trip and release-visibility tests;
- provider rate-limit, pagination, token refresh/revocation, outage, and recovery tests;
- security, privacy, retention, accessibility, observability, backup, and disaster-recovery review.

Passing the app's generic contract suite establishes client compatibility. It does not replace provider certification such as OneRoster or LTI conformance testing.
