import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { evaluateAuditReport } = require('./audit-policy.cjs');
const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, NO_UPDATE_NOTIFIER: '1', NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
  maxBuffer: 20 * 1024 * 1024,
});

if (audit.error) {
  console.error(`npm audit could not start: ${audit.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error('npm audit did not return JSON. A registry/network failure is a failed release audit, not a clean result.');
  if (audit.stderr.trim()) console.error(audit.stderr.trim());
  process.exit(1);
}

const result = evaluateAuditReport(report);
if (!result.ok) {
  console.error(`Production dependency audit failed:\n- ${result.failures.join('\n- ')}`);
  if (report?.error || report?.message) console.error('The audit registry did not return a usable vulnerability report.');
  process.exit(1);
}

const allowedSummary = result.allowedAdvisories.length
  ? `; documented allowlist present: ${result.allowedAdvisories.join(', ')}`
  : '';
console.log(`Production dependency audit policy passed (${result.vulnerabilityCount} affected package entries${allowedSummary}).`);
