import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ALLOWED_ADVISORIES, evaluateAuditReport } = require('../scripts/audit-policy.cjs') as {
  ALLOWED_ADVISORIES: Record<string, string>;
  evaluateAuditReport: (report: unknown) => {
    ok: boolean;
    failures: string[];
    allowedAdvisories: string[];
    vulnerabilityCount: number;
  };
};

const counts = (high: number, critical = 0) => ({
  info: 0,
  low: 0,
  moderate: 0,
  high,
  critical,
  total: high + critical,
});

test('release audit allowlist contains only the two documented image-size advisories', () => {
  assert.deepEqual(ALLOWED_ADVISORIES, {
    'GHSA-5P2G-FCMC-QVQQ': 'image-size',
    'GHSA-W3RX-R6R6-PGPR': 'image-size',
  });
});

test('documented image-size advisories permit their transitive affected packages', () => {
  const result = evaluateAuditReport({
    metadata: { vulnerabilities: counts(3) },
    vulnerabilities: {
      'image-size': {
        severity: 'high',
        via: [
          { name: 'image-size', severity: 'high', url: 'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr' },
          { name: 'image-size', severity: 'high', url: 'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq' },
        ],
      },
      '@expo/image-utils': { severity: 'high', via: ['image-size'] },
      '@expo/cli': { severity: 'high', via: ['@expo/image-utils'] },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.allowedAdvisories, ['GHSA-5P2G-FCMC-QVQQ', 'GHSA-W3RX-R6R6-PGPR']);
});

test('documented advisories remain resolvable through npm dependency cycles', () => {
  const result = evaluateAuditReport({
    metadata: { vulnerabilities: counts(3) },
    vulnerabilities: {
      metro: { severity: 'high', via: ['metro-config'] },
      'metro-config': { severity: 'high', via: ['metro', 'metro-transform-worker'] },
      'metro-transform-worker': {
        severity: 'high',
        via: [
          'metro-config',
          { name: 'image-size', severity: 'high', url: 'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr' },
        ],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.allowedAdvisories, ['GHSA-W3RX-R6R6-PGPR']);
});

test('a dependency cycle without a concrete advisory remains unresolved', () => {
  const result = evaluateAuditReport({
    metadata: { vulnerabilities: counts(2) },
    vulnerabilities: {
      alpha: { severity: 'high', via: ['beta'] },
      beta: { severity: 'high', via: ['alpha'] },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /could not be resolved/i);
});

test('a new advisory ID fails even when npm classifies it below critical', () => {
  const result = evaluateAuditReport({
    metadata: { vulnerabilities: counts(1) },
    vulnerabilities: {
      'image-size': {
        severity: 'high',
        via: [{ name: 'image-size', severity: 'high', url: 'https://github.com/advisories/GHSA-AAAA-BBBB-CCCC' }],
      },
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /GHSA-AAAA-BBBB-CCCC/);
});

test('critical findings and unresolved transitive roots always fail', () => {
  const critical = evaluateAuditReport({
    metadata: { vulnerabilities: counts(0, 1) },
    vulnerabilities: {
      'image-size': {
        severity: 'critical',
        via: [{ name: 'image-size', severity: 'critical', url: 'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr' }],
      },
    },
  });
  assert.equal(critical.ok, false);
  assert.match(critical.failures.join(' '), /critical/i);

  const unresolved = evaluateAuditReport({
    metadata: { vulnerabilities: counts(1) },
    vulnerabilities: { '@expo/cli': { severity: 'high', via: ['missing-root'] } },
  });
  assert.equal(unresolved.ok, false);
  assert.match(unresolved.failures.join(' '), /missing-root/);
});

test('a complete zero-vulnerability audit passes without an allowlist match', () => {
  const result = evaluateAuditReport({
    metadata: { vulnerabilities: counts(0) },
    vulnerabilities: {},
  });
  assert.deepEqual(result, {
    ok: true,
    failures: [],
    allowedAdvisories: [],
    vulnerabilityCount: 0,
  });
});
