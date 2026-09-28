import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  MANUAL_ACCEPTANCE_CHECKS,
  PROVIDER_ACCEPTANCE_SCHEMA_VERSION,
  REQUIRED_APPROVALS,
  REQUIRED_CAPABILITIES,
  REQUIRED_CHECKS,
  REQUIRED_EVIDENCE_KIND,
  evaluateProviderAcceptance,
} = require('../scripts/provider-readiness.cjs') as {
  MANUAL_ACCEPTANCE_CHECKS: Record<string, number>;
  PROVIDER_ACCEPTANCE_SCHEMA_VERSION: number;
  REQUIRED_APPROVALS: string[];
  REQUIRED_CAPABILITIES: string[];
  REQUIRED_CHECKS: Record<string, number>;
  REQUIRED_EVIDENCE_KIND: Record<string, string>;
  evaluateProviderAcceptance: (manifest: unknown, options?: Record<string, unknown>) => {
    ok: boolean;
    failures: string[];
    passedChecks: string[];
  };
};

const now = new Date('2026-08-20T12:00:00.000Z');
const releaseId = 'release-2026-08-20-1';
const commitSha = 'a'.repeat(40);
const evidenceSha = 'b17243ab2c439f5299db31337c1f6d9714868e6a0bed5c8a740074b476a0ea32';
const headerSha = 'c8c7bc06f4a572ae975987b410c30405749b6991c5107c47ee4b0c1dc47a25c8';
const manualPlanSha = '63713bcb537381901f16ac8cf7c6953adce4e322e517743643a24edf08168a69';
const manualCaseCount = 41;

const validManifest = () => ({
  schemaVersion: PROVIDER_ACCEPTANCE_SCHEMA_VERSION,
  release: { id: releaseId, commitSha, generatedAt: '2026-08-19T09:00:00.000Z' },
  manualAcceptance: { planSha256: manualPlanSha, requiredCaseCount: manualCaseCount },
  provider: {
    institutionId: 'north-campus',
    tenantId: 'north-campus-production',
    environment: 'production',
    ssoIssuer: 'https://login.school.edu',
    apiOrigin: 'https://lms-api.school.edu',
    assetOrigin: 'https://lms-assets.school.edu',
    realtimeOrigin: 'wss://lms-realtime.school.edu',
    webOrigin: 'https://learn.school.edu',
  },
  declaredCapabilities: [...REQUIRED_CAPABILITIES],
  web: {
    headerContractSha256: headerSha,
    indexPath: '/index.html',
    spaRoutePath: '/courses/acceptance-probe',
    staticAssetPath: '/_expo/static/js/web/app-deadbeef.js',
  },
  signing: {
    iosBundleIdentifier: 'edu.school.learning',
    iosTeamId: 'A1B2C3D4E5',
    iosCertificateSha256: 'd32ef26fcfc7e8302df1ee02fd521803866f43f9b9b737d009033778b18f6d68',
    androidPackage: 'edu.school.learning',
    androidCertificateSha256: 'e12635a8574f675f4f8c286c64ec559f31150ef3c1be6848408de70dc63ee3b6',
  },
  checks: Object.keys(REQUIRED_CHECKS).map((id, index) => ({
    id,
    status: 'passed',
    testedAt: '2026-08-19T10:00:00.000Z',
    expiresAt: '2026-09-08T10:00:00.000Z',
    environment: 'production',
    releaseId,
    evidence: [{
      kind: REQUIRED_EVIDENCE_KIND[id],
      location: `artifact://provider-acceptance/run-4821/result-${index}.json`,
      sha256: evidenceSha,
      runId: `provider-run-4821-${index}`,
    }],
  })),
  approvals: Object.fromEntries(REQUIRED_APPROVALS.map((role, index) => [role, {
    status: 'approved',
    approvedBy: `${role}-owner-${index}@school.edu`,
    approvedAt: '2026-08-19T11:00:00.000Z',
    releaseId,
  }])),
});

test('complete production evidence passes and binds provider, source, headers, and signing identity', () => {
  const result = evaluateProviderAcceptance(validManifest(), {
    now,
    expectedCommitSha: commitSha,
    expectedHeaderContractSha256: headerSha,
    expectedManualAcceptancePlanSha256: manualPlanSha,
    expectedManualAcceptanceCaseCount: manualCaseCount,
    expectedIosBundleIdentifier: 'edu.school.learning',
    expectedAndroidPackage: 'edu.school.learning',
  });
  assert.equal(result.ok, true, result.failures.join('\n'));
  assert.equal(result.passedChecks.length, Object.keys(REQUIRED_CHECKS).length);
});

test('seven manual, accessibility, privacy, and legal gates raise the total to 28', () => {
  assert.equal(Object.keys(MANUAL_ACCEPTANCE_CHECKS).length, 7);
  assert.equal(Object.keys(REQUIRED_CHECKS).length, 28);
  assert.deepEqual(Object.keys(MANUAL_ACCEPTANCE_CHECKS), [
    'acceptance.browser-five-role-journeys',
    'accessibility.web-keyboard-zoom-forced-colors-voiceover',
    'accessibility.ios-voiceover-media-permissions',
    'accessibility.android-talkback-media-permissions',
    'accessibility.disabled-user-critical-journeys',
    'privacy.final-data-flow-review',
    'legal.third-party-licenses-assets-release',
  ]);
  assert.deepEqual(REQUIRED_APPROVALS, ['security', 'operations', 'privacy', 'accessibility', 'legal', 'releaseOwner']);
});

test('manual acceptance checks require their platform-specific immutable evidence and final approvers', () => {
  const manifest = validManifest();
  manifest.checks = manifest.checks.filter(check => check.id !== 'acceptance.browser-five-role-journeys');
  const iosCheck = manifest.checks.find(check => check.id === 'accessibility.ios-voiceover-media-permissions')!;
  iosCheck.evidence[0].kind = 'android-device-acceptance-report';
  manifest.approvals.accessibility.status = 'pending';
  manifest.approvals.legal.status = 'pending';

  const result = evaluateProviderAcceptance(manifest, { now });
  assert.equal(result.ok, false);
  const detail = result.failures.join(' ');
  assert.match(detail, /Required provider-acceptance check is missing: acceptance\.browser-five-role-journeys/);
  assert.match(detail, /accessibility\.ios-voiceover-media-permissions requires ios-device-acceptance-report evidence/);
  assert.match(detail, /accessibility has not approved this release/);
  assert.match(detail, /legal has not approved this release/);
});

test('schema v2 binds production evidence to the exact 41-case repository plan', () => {
  const manifest = validManifest();
  manifest.schemaVersion = 1;
  manifest.manualAcceptance.planSha256 = headerSha;
  manifest.manualAcceptance.requiredCaseCount = 40;
  const result = evaluateProviderAcceptance(manifest, {
    now,
    expectedManualAcceptancePlanSha256: manualPlanSha,
    expectedManualAcceptanceCaseCount: manualCaseCount,
  });
  assert.equal(result.ok, false);
  const detail = result.failures.join(' ');
  assert.match(detail, /schemaVersion must be 2/);
  assert.match(detail, /planSha256 does not match/);
  assert.match(detail, /requiredCaseCount does not match/);
});

test('missing, pending, stale, cross-release, and unapproved evidence fails closed', () => {
  const manifest = validManifest();
  manifest.checks = manifest.checks.slice(1);
  manifest.checks[0].status = 'pending';
  manifest.checks[0].testedAt = '2025-01-01T00:00:00.000Z';
  manifest.checks[0].releaseId = 'different-release';
  manifest.approvals.security.status = 'pending';
  const result = evaluateProviderAcceptance(manifest, { now });
  assert.equal(result.ok, false);
  const detail = result.failures.join(' ');
  assert.match(detail, /Required provider-acceptance check is missing/);
  assert.match(detail, /has not passed/);
  assert.match(detail, /older than/);
  assert.match(detail, /not bound to this release/);
  assert.match(detail, /security has not approved/);
});

test('capability, tenant, evidence, header, source, and signing mismatches fail closed', () => {
  const manifest = validManifest();
  manifest.declaredCapabilities.pop();
  manifest.provider.apiOrigin = 'http://127.0.0.1:8080';
  manifest.checks[0].evidence[0].location = 'http://example.test/report';
  manifest.checks[0].evidence[0].sha256 = 'not-a-digest';
  const result = evaluateProviderAcceptance(manifest, {
    now,
    expectedCommitSha: 'f'.repeat(40),
    expectedHeaderContractSha256: '0'.repeat(64),
    expectedIosBundleIdentifier: 'edu.school.other',
    expectedAndroidPackage: 'edu.school.other',
  });
  assert.equal(result.ok, false);
  const detail = result.failures.join(' ');
  assert.match(detail, /capabilities are missing/);
  assert.match(detail, /must use https/);
  assert.match(detail, /non-local production host/);
  assert.match(detail, /immutable HTTPS or artifact-store location/);
  assert.match(detail, /SHA-256 digest/);
  assert.match(detail, /source revision supplied by CI/);
  assert.match(detail, /web-security-headers/);
  assert.match(detail, /iOS identifier/);
  assert.match(detail, /Android package/);
});

test('the committed template enumerates every gate but cannot be mistaken for acceptance evidence', async () => {
  const [templateText, manualPlan] = await Promise.all([
    readFile(new URL('../deployment/provider-acceptance.example.json', import.meta.url), 'utf8'),
    readFile(new URL('../docs/manual-device-accessibility-acceptance-2026-08-20.md', import.meta.url), 'utf8'),
  ]);
  const template = JSON.parse(templateText);
  const caseCount = Array.from(manualPlan.matchAll(/^- \[ \] `([A-Z0-9-]+)`/gm)).length;
  assert.equal(template.schemaVersion, PROVIDER_ACCEPTANCE_SCHEMA_VERSION);
  assert.equal(template.manualAcceptance.planSha256, createHash('sha256').update(manualPlan).digest('hex'));
  assert.equal(template.manualAcceptance.requiredCaseCount, caseCount);
  assert.deepEqual(new Set(template.checks.map((entry: { id: string }) => entry.id)), new Set(Object.keys(REQUIRED_CHECKS)));
  assert.ok(template.checks.every((entry: { status: string; evidence: unknown[] }) => entry.status === 'pending' && entry.evidence.length === 0));
  assert.deepEqual(Object.keys(template.approvals), REQUIRED_APPROVALS);
  const result = evaluateProviderAcceptance(template, {
    now,
    expectedManualAcceptancePlanSha256: createHash('sha256').update(manualPlan).digest('hex'),
    expectedManualAcceptanceCaseCount: caseCount,
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /placeholder|has not passed|requires at least one immutable evidence/i);
});

test('provider handoff documents every strict manual evidence kind and the pending gate totals', async () => {
  const guide = await readFile(new URL('../deployment/provider-acceptance.md', import.meta.url), 'utf8');
  assert.match(guide, /28 required checks/);
  assert.match(guide, /41-case/);
  assert.match(guide, /six named institutional owners/);
  Object.keys(MANUAL_ACCEPTANCE_CHECKS).forEach(id => assert.ok(guide.includes(`\`${id}\``), `missing documented gate ${id}`));
  Object.values(MANUAL_ACCEPTANCE_CHECKS).forEach(maxAge => assert.equal(maxAge, 30));
  Object.keys(MANUAL_ACCEPTANCE_CHECKS).forEach(id => {
    const kind = REQUIRED_EVIDENCE_KIND[id];
    assert.ok(guide.includes(`\`${kind}\``), `missing documented evidence kind ${kind}`);
  });
  assert.match(guide, /all 28 checks and all six approvals remain `pending`/);
});

test('the production promotion command cannot bypass provider acceptance', async () => {
  const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  assert.equal(packageManifest.scripts?.['validate:provider'], 'node scripts/validate-provider-readiness.mjs');
  assert.match(packageManifest.scripts?.['check:production'] ?? '', /npm run validate:production-config && npm run validate:provider && npm run audit:release && npm run check:release/);
});
