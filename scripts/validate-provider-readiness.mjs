import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { evaluateProviderAcceptance } = require('./provider-readiness.cjs');
const suppliedPath = process.argv[2] || process.env.LMS_PROVIDER_ACCEPTANCE_FILE;
const expectedCommitSha = process.env.LMS_RELEASE_COMMIT_SHA || process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA;
const expectedIosBundleIdentifier = process.env.LMS_IOS_BUNDLE_IDENTIFIER;
const expectedAndroidPackage = process.env.LMS_ANDROID_PACKAGE;
const manualAcceptancePlanPath = path.join(root, 'docs/manual-device-accessibility-acceptance-2026-08-20.md');

if (!suppliedPath) {
  console.error('Production provider acceptance is incomplete: LMS_PROVIDER_ACCEPTANCE_FILE (or a manifest path argument) is required.');
  console.error('Copy deployment/provider-acceptance.example.json outside the public bundle, attach real immutable evidence, and rerun this command.');
  process.exitCode = 1;
} else {
  try {
    const manifestPath = path.resolve(process.cwd(), suppliedPath);
    const [manifestText, headerContract, manualAcceptancePlan] = await Promise.all([
      readFile(manifestPath, 'utf8'),
      readFile(path.join(root, 'deployment/web-security-headers.json')),
      readFile(manualAcceptancePlanPath, 'utf8'),
    ]);
    const manualAcceptanceCaseCount = Array.from(
      manualAcceptancePlan.matchAll(/^- \[ \] `([A-Z0-9-]+)`/gm),
    ).length;
    const manifest = JSON.parse(manifestText);
    const result = evaluateProviderAcceptance(manifest, {
      expectedCommitSha,
      expectedHeaderContractSha256: createHash('sha256').update(headerContract).digest('hex'),
      expectedManualAcceptancePlanSha256: createHash('sha256').update(manualAcceptancePlan).digest('hex'),
      expectedManualAcceptanceCaseCount: manualAcceptanceCaseCount,
      expectedIosBundleIdentifier,
      expectedAndroidPackage,
    });
    if (!expectedCommitSha) result.failures.push('LMS_RELEASE_COMMIT_SHA (or the CI source-revision variable) is required to bind the acceptance record to source.');
    if (!expectedIosBundleIdentifier) result.failures.push('LMS_IOS_BUNDLE_IDENTIFIER is required to bind acceptance to the iOS artifact.');
    if (!expectedAndroidPackage) result.failures.push('LMS_ANDROID_PACKAGE is required to bind acceptance to the Android artifact.');
    result.ok = result.failures.length === 0;
    if (!result.ok) {
      console.error(`Production provider acceptance failed:\n- ${result.failures.join('\n- ')}`);
      console.error('No external capability is inferred from client code or an unchecked declaration. Supply current production evidence and institutional approvals.');
      process.exitCode = 1;
    } else {
      console.log(`Production provider acceptance passed with ${result.passedChecks.length} current, release-bound checks.`);
      console.log('The manifest records provider evidence; retain the referenced reports with the release audit record.');
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown manifest error';
    console.error(`Production provider acceptance could not be evaluated: ${detail}`);
    process.exitCode = 1;
  }
}
