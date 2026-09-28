'use strict';

const PROVIDER_ACCEPTANCE_SCHEMA_VERSION = 2;

const REQUIRED_CAPABILITIES = Object.freeze([
  'courses.read',
  'courses.write',
  'roster.read',
  'roster.write',
  'content.read',
  'content.write',
  'submissions.read',
  'submissions.write',
  'grades.read',
  'grades.write',
  'chat.read',
  'chat.write',
  'chat.realtime',
  'live-sessions.read',
  'live-sessions.write',
  'live-sessions.realtime',
  'assets.write',
  'ai.generate',
]);

const MANUAL_ACCEPTANCE_CHECKS = Object.freeze({
  'acceptance.browser-five-role-journeys': 30,
  'accessibility.web-keyboard-zoom-forced-colors-voiceover': 30,
  'accessibility.ios-voiceover-media-permissions': 30,
  'accessibility.android-talkback-media-permissions': 30,
  'accessibility.disabled-user-critical-journeys': 30,
  'privacy.final-data-flow-review': 30,
  'legal.third-party-licenses-assets-release': 30,
});

const REQUIRED_CHECKS = Object.freeze({
  'identity.sso-subject-token-lifecycle': 90,
  'identity.tenant-isolation-negative': 90,
  'authorization.server-rbac-matrix': 90,
  'gateway.principal-scoped-snapshots': 90,
  'gateway.atomic-mutation-batches': 90,
  'gateway.cas-conflict-across-devices': 90,
  'gateway.idempotency-replay': 90,
  'announcements.atomic-outbox-recovery': 90,
  'realtime.thread-tenant-sender-scope': 90,
  'realtime.revision-tombstone-cas': 90,
  'uploads.authorization-and-object-scope': 90,
  'uploads.malware-quarantine': 30,
  'uploads.mime-digest-safe-disposition': 90,
  'uploads.retention-and-deletion': 90,
  'web.https-redirect-and-tls': 30,
  'web.response-security-headers': 30,
  'web.cache-and-spa-routing': 30,
  'release.ios-signing': 30,
  'release.android-signing': 30,
  'operations.audit-monitoring-alert': 90,
  'operations.backup-restore-drill': 365,
  ...MANUAL_ACCEPTANCE_CHECKS,
});

const REQUIRED_APPROVALS = Object.freeze([
  'security',
  'operations',
  'privacy',
  'accessibility',
  'legal',
  'releaseOwner',
]);
const REQUIRED_EVIDENCE_KIND = Object.freeze({
  'identity.sso-subject-token-lifecycle': 'automated-test-report',
  'identity.tenant-isolation-negative': 'penetration-test-report',
  'authorization.server-rbac-matrix': 'automated-test-report',
  'gateway.principal-scoped-snapshots': 'automated-test-report',
  'gateway.atomic-mutation-batches': 'automated-test-report',
  'gateway.cas-conflict-across-devices': 'automated-test-report',
  'gateway.idempotency-replay': 'automated-test-report',
  'announcements.atomic-outbox-recovery': 'automated-test-report',
  'realtime.thread-tenant-sender-scope': 'automated-test-report',
  'realtime.revision-tombstone-cas': 'automated-test-report',
  'uploads.authorization-and-object-scope': 'automated-test-report',
  'uploads.malware-quarantine': 'automated-test-report',
  'uploads.mime-digest-safe-disposition': 'automated-test-report',
  'uploads.retention-and-deletion': 'automated-test-report',
  'web.https-redirect-and-tls': 'automated-test-report',
  'web.response-security-headers': 'automated-test-report',
  'web.cache-and-spa-routing': 'automated-test-report',
  'release.ios-signing': 'signing-certificate-record',
  'release.android-signing': 'signing-certificate-record',
  'operations.audit-monitoring-alert': 'automated-test-report',
  'operations.backup-restore-drill': 'runbook-drill-report',
  'acceptance.browser-five-role-journeys': 'browser-acceptance-report',
  'accessibility.web-keyboard-zoom-forced-colors-voiceover': 'web-accessibility-report',
  'accessibility.ios-voiceover-media-permissions': 'ios-device-acceptance-report',
  'accessibility.android-talkback-media-permissions': 'android-device-acceptance-report',
  'accessibility.disabled-user-critical-journeys': 'disabled-user-accessibility-review',
  'privacy.final-data-flow-review': 'privacy-data-flow-review',
  'legal.third-party-licenses-assets-release': 'legal-release-review',
});
const EVIDENCE_KINDS = new Set([
  'automated-test-report',
  'configuration-export',
  'penetration-test-report',
  'runbook-drill-report',
  'signing-certificate-record',
  'security-review',
  'browser-acceptance-report',
  'web-accessibility-report',
  'ios-device-acceptance-report',
  'android-device-acceptance-report',
  'disabled-user-accessibility-review',
  'privacy-data-flow-review',
  'legal-release-review',
]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const PLACEHOLDER = /(?:^|[-_.\s])(?:example|placeholder|replace|sample|demo|test|todo|tbd|change-me|your[-_ ]?(?:org|tenant|institution))(?:$|[-_.\s])/i;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const IOS_IDENTIFIER = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/;
const ANDROID_IDENTIFIER = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasOnlyKeys = (value, allowed) => Object.keys(value).every(key => allowed.has(key));
const normalizedString = value => typeof value === 'string' ? value.trim() : '';
const validBoundedString = (value, maximum = 256) => {
  const normalized = normalizedString(value);
  return Boolean(normalized) && normalized.length <= maximum && !CONTROL_CHARACTERS.test(normalized);
};
const parsedTime = value => {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};
const validSha256 = value => {
  const normalized = normalizedString(value).toLowerCase();
  return SHA256.test(normalized) && !/^(.)\1{63}$/.test(normalized);
};
const daysBetween = (left, right) => (right - left) / 86_400_000;

const validatePublicOrigin = (value, label, protocols, failures) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    failures.push(`${label} must be an absolute production URL.`);
    return;
  }
  if (!protocols.includes(url.protocol)) failures.push(`${label} must use ${protocols.join(' or ')}.`);
  if (url.username || url.password || url.search || url.hash) failures.push(`${label} cannot contain credentials, a query, or a fragment.`);
  const hostname = url.hostname.toLowerCase();
  const privateIpv4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname);
  const localName = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal');
  if (!hostname || privateIpv4 || localName || hostname === '::1' || hostname === '[::1]') {
    failures.push(`${label} must identify a non-local production host.`);
  }
};

const evaluateProviderAcceptance = (manifest, options = {}) => {
  const failures = [];
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  if (!isRecord(manifest)) {
    return { ok: false, failures: ['Provider acceptance manifest must be a JSON object.'], passedChecks: [] };
  }
  const topLevelKeys = new Set([
    'schemaVersion', 'release', 'manualAcceptance', 'provider', 'declaredCapabilities', 'web', 'signing', 'checks', 'approvals',
  ]);
  if (!hasOnlyKeys(manifest, topLevelKeys)) failures.push('Provider acceptance manifest contains unsupported top-level fields.');
  if (manifest.schemaVersion !== PROVIDER_ACCEPTANCE_SCHEMA_VERSION) {
    failures.push(`Provider acceptance schemaVersion must be ${PROVIDER_ACCEPTANCE_SCHEMA_VERSION}.`);
  }

  const release = manifest.release;
  if (!isRecord(release) || !hasOnlyKeys(release, new Set(['id', 'commitSha', 'generatedAt']))) {
    failures.push('release must contain only id, commitSha, and generatedAt.');
  } else {
    if (!validBoundedString(release.id) || PLACEHOLDER.test(release.id)) failures.push('release.id must be a non-placeholder release identifier.');
    if (!COMMIT_SHA.test(normalizedString(release.commitSha).toLowerCase())) failures.push('release.commitSha must be a full 40- or 64-character source revision.');
    const generatedAt = parsedTime(release.generatedAt);
    if (!Number.isFinite(generatedAt) || generatedAt > now + 300_000 || daysBetween(generatedAt, now) > 30) {
      failures.push('release.generatedAt must be a valid time from the last 30 days and not in the future.');
    }
    if (options.expectedCommitSha && normalizedString(release.commitSha).toLowerCase() !== normalizedString(options.expectedCommitSha).toLowerCase()) {
      failures.push('release.commitSha does not match the release source revision supplied by CI.');
    }
  }

  const manualAcceptance = manifest.manualAcceptance;
  if (!isRecord(manualAcceptance) || !hasOnlyKeys(manualAcceptance, new Set(['planSha256', 'requiredCaseCount']))) {
    failures.push('manualAcceptance must contain only planSha256 and requiredCaseCount.');
  } else {
    if (!validSha256(manualAcceptance.planSha256)) {
      failures.push('manualAcceptance.planSha256 must be a non-placeholder SHA-256 digest.');
    }
    if (!Number.isInteger(manualAcceptance.requiredCaseCount)
      || manualAcceptance.requiredCaseCount < 1
      || manualAcceptance.requiredCaseCount > 10_000) {
      failures.push('manualAcceptance.requiredCaseCount must be a bounded positive whole number.');
    }
    if (options.expectedManualAcceptancePlanSha256
      && normalizedString(manualAcceptance.planSha256).toLowerCase() !== normalizedString(options.expectedManualAcceptancePlanSha256).toLowerCase()) {
      failures.push('manualAcceptance.planSha256 does not match the repository manual acceptance plan.');
    }
    if (options.expectedManualAcceptanceCaseCount !== undefined
      && manualAcceptance.requiredCaseCount !== options.expectedManualAcceptanceCaseCount) {
      failures.push('manualAcceptance.requiredCaseCount does not match the repository manual acceptance plan.');
    }
  }

  const provider = manifest.provider;
  if (!isRecord(provider) || !hasOnlyKeys(provider, new Set(['institutionId', 'tenantId', 'environment', 'ssoIssuer', 'apiOrigin', 'assetOrigin', 'realtimeOrigin', 'webOrigin']))) {
    failures.push('provider contains missing or unsupported fields.');
  } else {
    for (const field of ['institutionId', 'tenantId']) {
      if (!validBoundedString(provider[field]) || PLACEHOLDER.test(provider[field])) failures.push(`provider.${field} must be a non-placeholder stable identifier.`);
    }
    if (provider.environment !== 'production') failures.push('provider.environment must be production.');
    validatePublicOrigin(provider.ssoIssuer, 'provider.ssoIssuer', ['https:'], failures);
    validatePublicOrigin(provider.apiOrigin, 'provider.apiOrigin', ['https:'], failures);
    validatePublicOrigin(provider.assetOrigin, 'provider.assetOrigin', ['https:'], failures);
    validatePublicOrigin(provider.realtimeOrigin, 'provider.realtimeOrigin', ['https:', 'wss:'], failures);
    validatePublicOrigin(provider.webOrigin, 'provider.webOrigin', ['https:'], failures);
  }

  const capabilities = Array.isArray(manifest.declaredCapabilities) ? manifest.declaredCapabilities : [];
  if (!Array.isArray(manifest.declaredCapabilities)) failures.push('declaredCapabilities must be an array.');
  if (capabilities.some(capability => typeof capability !== 'string') || new Set(capabilities).size !== capabilities.length) {
    failures.push('declaredCapabilities must contain unique strings.');
  }
  const knownCapabilities = new Set(REQUIRED_CAPABILITIES);
  const missingCapabilities = REQUIRED_CAPABILITIES.filter(capability => !capabilities.includes(capability));
  const unknownCapabilities = capabilities.filter(capability => !knownCapabilities.has(capability));
  if (missingCapabilities.length) failures.push(`Required advertised-app capabilities are missing: ${missingCapabilities.join(', ')}.`);
  if (unknownCapabilities.length) failures.push(`Unknown provider capabilities are present: ${unknownCapabilities.join(', ')}.`);

  const web = manifest.web;
  if (!isRecord(web) || !hasOnlyKeys(web, new Set(['headerContractSha256', 'indexPath', 'spaRoutePath', 'staticAssetPath']))) {
    failures.push('web must contain only the checked header contract and deployed route paths.');
  } else {
    if (!validSha256(web.headerContractSha256)) failures.push('web.headerContractSha256 must be a non-placeholder SHA-256 digest.');
    if (options.expectedHeaderContractSha256
      && normalizedString(web.headerContractSha256).toLowerCase() !== normalizedString(options.expectedHeaderContractSha256).toLowerCase()) {
      failures.push('web.headerContractSha256 does not match deployment/web-security-headers.json.');
    }
    for (const field of ['indexPath', 'spaRoutePath', 'staticAssetPath']) {
      const value = normalizedString(web[field]);
      if (!value.startsWith('/') || value.startsWith('//') || value.length > 1_024 || CONTROL_CHARACTERS.test(value)) {
        failures.push(`web.${field} must be a bounded root-relative deployed path.`);
      }
    }
    if (web.indexPath === web.staticAssetPath || web.spaRoutePath === web.staticAssetPath) {
      failures.push('The immutable static-asset probe path must differ from HTML routes.');
    }
  }

  const signing = manifest.signing;
  if (!isRecord(signing) || !hasOnlyKeys(signing, new Set(['iosBundleIdentifier', 'iosTeamId', 'iosCertificateSha256', 'androidPackage', 'androidCertificateSha256']))) {
    failures.push('signing contains missing or unsupported fields.');
  } else {
    if (!IOS_IDENTIFIER.test(normalizedString(signing.iosBundleIdentifier)) || PLACEHOLDER.test(signing.iosBundleIdentifier)) failures.push('signing.iosBundleIdentifier is invalid or a placeholder.');
    if (!/^[A-Z0-9]{10}$/.test(normalizedString(signing.iosTeamId)) || PLACEHOLDER.test(signing.iosTeamId)) failures.push('signing.iosTeamId must be a 10-character Apple team identifier.');
    if (!validSha256(signing.iosCertificateSha256)) failures.push('signing.iosCertificateSha256 must be a non-placeholder certificate fingerprint.');
    if (!ANDROID_IDENTIFIER.test(normalizedString(signing.androidPackage)) || PLACEHOLDER.test(signing.androidPackage)) failures.push('signing.androidPackage is invalid or a placeholder.');
    if (!validSha256(signing.androidCertificateSha256)) failures.push('signing.androidCertificateSha256 must be a non-placeholder certificate fingerprint.');
    if (options.expectedIosBundleIdentifier && signing.iosBundleIdentifier !== options.expectedIosBundleIdentifier) failures.push('The attested iOS identifier does not match the release environment.');
    if (options.expectedAndroidPackage && signing.androidPackage !== options.expectedAndroidPackage) failures.push('The attested Android package does not match the release environment.');
  }

  const checks = Array.isArray(manifest.checks) ? manifest.checks : [];
  if (!Array.isArray(manifest.checks)) failures.push('checks must be an array.');
  const checksById = new Map();
  for (const check of checks) {
    if (!isRecord(check) || !hasOnlyKeys(check, new Set(['id', 'status', 'testedAt', 'expiresAt', 'environment', 'releaseId', 'evidence']))) {
      failures.push('Every check must contain only the provider-acceptance check fields.');
      continue;
    }
    const id = normalizedString(check.id);
    if (!Object.prototype.hasOwnProperty.call(REQUIRED_CHECKS, id)) {
      failures.push(`Unknown provider-acceptance check: ${id || '<missing>'}.`);
      continue;
    }
    if (checksById.has(id)) {
      failures.push(`Provider-acceptance check is duplicated: ${id}.`);
      continue;
    }
    checksById.set(id, check);
    if (check.status !== 'passed') failures.push(`${id} has not passed.`);
    if (check.environment !== 'production') failures.push(`${id} was not executed against production.`);
    if (isRecord(release) && check.releaseId !== release.id) failures.push(`${id} is not bound to this release.`);
    const testedAt = parsedTime(check.testedAt);
    const expiresAt = parsedTime(check.expiresAt);
    const maxAgeDays = REQUIRED_CHECKS[id];
    if (!Number.isFinite(testedAt) || testedAt > now + 300_000 || daysBetween(testedAt, now) > maxAgeDays) failures.push(`${id} test evidence is missing, future-dated, or older than ${maxAgeDays} days.`);
    if (!Number.isFinite(expiresAt) || expiresAt <= now || (Number.isFinite(testedAt) && expiresAt <= testedAt) || (Number.isFinite(testedAt) && daysBetween(testedAt, expiresAt) > maxAgeDays + 1)) {
      failures.push(`${id} evidence expiry is invalid or exceeds its ${maxAgeDays}-day acceptance window.`);
    }
    if (!Array.isArray(check.evidence) || check.evidence.length === 0) {
      failures.push(`${id} requires at least one immutable evidence reference.`);
    } else {
      check.evidence.forEach((evidence, index) => {
        if (!isRecord(evidence) || !hasOnlyKeys(evidence, new Set(['kind', 'location', 'sha256', 'runId']))) {
          failures.push(`${id} evidence ${index + 1} contains unsupported fields.`);
          return;
        }
        if (!EVIDENCE_KINDS.has(evidence.kind)) failures.push(`${id} evidence ${index + 1} has an unsupported kind.`);
        const location = normalizedString(evidence.location);
        if (!validBoundedString(location, 2_048)
          || PLACEHOLDER.test(location)
          || !/^(?:https:\/\/|artifact:\/\/|s3:\/\/|gs:\/\/)/i.test(location)) {
          failures.push(`${id} evidence ${index + 1} must use an immutable HTTPS or artifact-store location.`);
        }
        if (!validSha256(evidence.sha256)) failures.push(`${id} evidence ${index + 1} requires a non-placeholder SHA-256 digest.`);
        if (!validBoundedString(evidence.runId, 256) || PLACEHOLDER.test(evidence.runId)) failures.push(`${id} evidence ${index + 1} requires a non-placeholder run ID.`);
      });
      if (!check.evidence.some(evidence => isRecord(evidence) && evidence.kind === REQUIRED_EVIDENCE_KIND[id])) {
        failures.push(`${id} requires ${REQUIRED_EVIDENCE_KIND[id]} evidence.`);
      }
    }
  }
  for (const id of Object.keys(REQUIRED_CHECKS)) {
    if (!checksById.has(id)) failures.push(`Required provider-acceptance check is missing: ${id}.`);
  }

  const approvals = manifest.approvals;
  const latestTestTime = Math.max(0, ...checks.map(check => parsedTime(check?.testedAt)).filter(Number.isFinite));
  if (!isRecord(approvals) || !hasOnlyKeys(approvals, new Set(REQUIRED_APPROVALS))) {
    failures.push(`approvals must contain exactly: ${REQUIRED_APPROVALS.join(', ')}.`);
  } else {
    for (const role of REQUIRED_APPROVALS) {
      const approval = approvals[role];
      if (!isRecord(approval) || !hasOnlyKeys(approval, new Set(['status', 'approvedBy', 'approvedAt', 'releaseId']))) {
        failures.push(`${role} approval is missing or malformed.`);
        continue;
      }
      if (approval.status !== 'approved') failures.push(`${role} has not approved this release.`);
      if (!validBoundedString(approval.approvedBy, 320) || PLACEHOLDER.test(approval.approvedBy)) failures.push(`${role} approval needs a named institutional owner.`);
      if (isRecord(release) && approval.releaseId !== release.id) failures.push(`${role} approval is not bound to this release.`);
      const approvedAt = parsedTime(approval.approvedAt);
      if (!Number.isFinite(approvedAt) || approvedAt > now + 300_000 || approvedAt < latestTestTime) failures.push(`${role} approval must be current and occur after all acceptance evidence.`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    passedChecks: [...checksById.entries()].filter(([, check]) => check.status === 'passed').map(([id]) => id).sort(),
  };
};

module.exports = {
  MANUAL_ACCEPTANCE_CHECKS,
  PROVIDER_ACCEPTANCE_SCHEMA_VERSION,
  REQUIRED_APPROVALS,
  REQUIRED_CAPABILITIES,
  REQUIRED_CHECKS,
  REQUIRED_EVIDENCE_KIND,
  evaluateProviderAcceptance,
};
