# Institution and business activation journey

This is the product-level journey that occurs before instructors and learners
use the LMS. The local Courses-screen experience demonstrates the sequence with
synthetic inputs. It does not provision infrastructure or contact identity,
student-information, human-resources, payment, or legal systems.

## Journey

| Stage | Organization owner supplies | System response | Production gate |
| --- | --- | --- | --- |
| 1. Organization | Legal/display name, education or business context, deployment owner, work email, and primary data region | Creates a resumable activation record and proposed tenant identifier | Commercial/procurement handoff and authorized owner verification |
| 2. Identity | OIDC issuer or SAML metadata URL from the identity team | Prepares tenant-bound SSO configuration | Redirect, signing-key rotation, audience, logout, revocation, and isolation tests |
| 3. Learning data | OneRoster/SIS, an existing LMS gateway, HRIS/directory, or a bounded secure-CSV pilot | Establishes the authoritative source and pilot ceiling | Contract mapping, stable IDs, role mapping, atomic sync, deletion, and reconciliation tests |
| 4. Governance | Named security, privacy, and accessibility ownership | Records accountable launch functions | Institution-specific approvals, data-flow/retention review, and accessibility acceptance |
| 5. Pilot preflight | The assembled activation draft | Checks that the pilot has identity, data, scope, and ownership decisions | Real provider evidence, signed applications, operations drills, and manual device/assistive-technology evidence |
| 6. Activation handoff | Final deployment-owner confirmation | Opens a bounded pilot workspace and presents the next gate | Invite approved pilot users, monitor first sync, test every role, support the pilot, then approve or reject production launch |

## Education and business paths

Education organizations can choose OneRoster/SIS, an existing LMS gateway, or a
secure CSV pilot. Businesses and nonprofits can choose an HRIS/directory, an
existing LMS gateway, or a secure CSV pilot. Both paths share the same identity,
tenant-isolation, data-governance, accessibility, evidence, and approval gates.

## Saved state and reset

The demo stores one versioned activation draft in browser-local storage under
`@lms_institution_activation_demo:v1`. Save and continue persists the completed
stage. Closing and reopening resumes the draft; Start over deletes it. The draft
contains only synthetic setup choices and must not be used for real credentials
or personal data.

Production activation state belongs in an authenticated deployment service with
tenant-scoped authorization, audit history, concurrency control, encryption,
retention/deletion policy, and immutable evidence references. The repository's
provider-acceptance manifest remains the release authority; the demo completion
screen cannot bypass it.
