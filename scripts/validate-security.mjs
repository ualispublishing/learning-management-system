import { Buffer } from 'node:buffer';
import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async relativePath => JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
const failures = [];
const fail = message => failures.push(message);

const app = (await readJson('app.json')).expo;
if (app.android?.allowBackup !== false) fail('app.json must disable Android application backup.');
const requiredBlockedPermissions = [
  'android.permission.CAMERA',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
];
for (const permission of requiredBlockedPermissions) {
  if (!app.android?.blockedPermissions?.includes(permission)) fail(`app.json must block unused permission ${permission}.`);
}
if (app.ios?.privacyManifests?.NSPrivacyTracking !== false) fail('The checked configuration must explicitly disable iOS tracking.');
if ((app.ios?.privacyManifests?.NSPrivacyTrackingDomains || []).length !== 0) fail('Tracking domains require a reviewed privacy declaration.');
if (app.ios?.entitlements?.['com.apple.developer.default-data-protection'] !== 'NSFileProtectionComplete') {
  fail('The iOS default data-protection entitlement must remain NSFileProtectionComplete.');
}
const collectedData = app.ios?.privacyManifests?.NSPrivacyCollectedDataTypes || [];
const requiredCollectedData = [
  'NSPrivacyCollectedDataTypeName',
  'NSPrivacyCollectedDataTypeEmailAddress',
  'NSPrivacyCollectedDataTypeUserID',
  'NSPrivacyCollectedDataTypeSensitiveInfo',
  'NSPrivacyCollectedDataTypeEmailsOrTextMessages',
  'NSPrivacyCollectedDataTypePhotosorVideos',
  'NSPrivacyCollectedDataTypeAudioData',
  'NSPrivacyCollectedDataTypeOtherUserContent',
  'NSPrivacyCollectedDataTypeSearchHistory',
  'NSPrivacyCollectedDataTypeProductInteraction',
];
for (const type of requiredCollectedData) {
  const declaration = collectedData.find(entry => entry.NSPrivacyCollectedDataType === type);
  if (!declaration
    || declaration.NSPrivacyCollectedDataTypeLinked !== true
    || declaration.NSPrivacyCollectedDataTypeTracking !== false
    || !declaration.NSPrivacyCollectedDataTypePurposes?.includes('NSPrivacyCollectedDataTypePurposeAppFunctionality')) {
    fail(`The iOS privacy manifest is missing the linked, non-tracking app-functionality declaration for ${type}.`);
  }
}
if (app.web?.bundler !== 'metro' || app.web?.output !== 'single') fail('The production web output contract must remain an explicit Metro single-page application.');
const releasePlugin = app.plugins?.find(plugin => Array.isArray(plugin) && plugin[0] === './plugins/withReleaseSecurity');
if (!releasePlugin) fail('The native release-security config plugin is missing.');
const splashPlugin = app.plugins?.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
const splashImage = splashPlugin?.[1]?.image;
if (!app.plugins?.includes('expo-asset')) fail('The expo-asset config plugin is missing.');

const brandAssets = [
  ['application icon', app.icon, 1024, 1024],
  ['splash image', splashImage, 512, 512],
  ['adaptive foreground', app.android?.adaptiveIcon?.foregroundImage, 432, 432],
  ['adaptive monochrome image', app.android?.adaptiveIcon?.monochromeImage, 432, 432],
  ['web favicon', app.web?.favicon, 32, 32],
];
for (const [label, configuredPath, minimumWidth, minimumHeight] of brandAssets) {
  if (typeof configuredPath !== 'string' || !configuredPath.startsWith('./assets/brand/') || !configuredPath.endsWith('.png')) {
    fail(`The ${label} must reference a PNG under ./assets/brand/.`);
    continue;
  }
  try {
    const fullPath = path.join(root, configuredPath.slice(2));
    if (!(await stat(fullPath)).isFile()) throw new Error('not a file');
    const bytes = await readFile(fullPath);
    const isPng = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const width = isPng ? bytes.readUInt32BE(16) : 0;
    const height = isPng ? bytes.readUInt32BE(20) : 0;
    if (!isPng || width < minimumWidth || height < minimumHeight) {
      fail(`The ${label} must be a valid PNG of at least ${minimumWidth}×${minimumHeight} pixels.`);
    }
  } catch {
    fail(`The configured ${label} does not exist: ${configuredPath}.`);
  }
}

const expoExecutable = path.join(root, 'node_modules', '.bin', 'expo');
const introspection = spawnSync(expoExecutable, ['config', '--type', 'introspect', '--json'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, LMS_ALLOW_INSECURE_LOCALHOST: '0' },
  maxBuffer: 20 * 1024 * 1024,
});
if (introspection.status !== 0) {
  fail(`Expo native configuration introspection failed: ${introspection.stderr.trim() || 'unknown error'}`);
} else {
  try {
    const native = JSON.parse(introspection.stdout);
    const infoPlist = native._internal?.modResults?.ios?.infoPlist;
    const androidManifest = native._internal?.modResults?.android?.manifest?.manifest;
    const application = androidManifest?.application?.[0]?.$;
    const permissions = androidManifest?.['uses-permission'] || [];
    if (infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads !== false
      || infoPlist?.NSAppTransportSecurity?.NSAllowsLocalNetworking !== false) {
      fail('The generated iOS release configuration does not deny arbitrary and local network loads.');
    }
    if (!infoPlist?.NSMicrophoneUsageDescription || !infoPlist?.NSPhotoLibraryUsageDescription || infoPlist?.NSCameraUsageDescription) {
      fail('Generated iOS permission descriptions do not match microphone/photo selection without camera access.');
    }
    if (application?.['android:allowBackup'] !== 'false' || application?.['android:usesCleartextTraffic'] !== 'false') {
      fail('The generated Android release manifest must disable backup and cleartext traffic.');
    }
    for (const permission of requiredBlockedPermissions) {
      const removal = permissions.find(entry => entry?.$?.['android:name'] === permission);
      if (removal?.$?.['tools:node'] !== 'remove') fail(`The generated Android manifest does not remove ${permission}.`);
    }
  } catch (error) {
    fail(`Expo native configuration introspection returned invalid JSON: ${error instanceof Error ? error.message : 'unknown parse error'}`);
  }
}

const headerConfig = await readJson('deployment/web-security-headers.json');
const requiredHeaders = [
  'Content-Security-Policy',
  'Permissions-Policy',
  'Referrer-Policy',
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'X-Frame-Options',
];
for (const name of requiredHeaders) {
  if (!headerConfig.globalHeaders?.[name]) fail(`Web header contract is missing ${name}.`);
}
const csp = headerConfig.globalHeaders?.['Content-Security-Policy'] || '';
for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "worker-src 'self' blob:", 'upgrade-insecure-requests']) {
  if (!csp.includes(directive)) fail(`Content-Security-Policy is missing ${directive}.`);
}
if (/['"]unsafe-eval['"]/.test(csp)) fail('Content-Security-Policy must not enable unsafe-eval.');

const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['GitHub token', /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{30,}\b/g],
  ['Slack token', /\bxox(?:a|b|p|r|s)-[A-Za-z0-9-]{20,}\b/g],
  ['OpenAI-style secret', /\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{20,}\b/g],
  ['Stripe live secret', /\bsk_live_[A-Za-z0-9]{20,}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['credentialed URL', /https?:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/g],
  ['npm authentication token', /(?:^|\n)\s*(?:_authToken|_auth)\s*=\s*[^\s${][^\n]*/g],
  ['publicly bundled secret variable', /\bEXPO_PUBLIC_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|CREDENTIAL|API_KEY)[A-Z0-9_]*\b/g],
];

const ignoredDirectories = new Set(['.expo', '.git', 'coverage', 'dist', 'node_modules', 'tests']);
const ignoredFiles = new Set(['THIRD_PARTY_NOTICES.md', 'package-lock.json', 'docs/sbom.cdx.json']);
const readableExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.jsx', '.mjs', '.md', '.ts', '.tsx', '.txt', '.yaml', '.yml']);

const scanDirectory = async directory => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(root, fullPath);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await scanDirectory(fullPath);
      continue;
    }
    if (!entry.isFile() || ignoredFiles.has(relativePath) || !readableExtensions.has(path.extname(entry.name))) continue;
    const content = await readFile(fullPath, 'utf8');
    for (const [label, pattern] of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) fail(`${relativePath} contains a high-confidence ${label} pattern.`);
    }
  }
};

await scanDirectory(root);

const rootEntries = await readdir(root);
for (const name of rootEntries) {
  if (/^\.env(?:\.|$)/.test(name) && name !== '.env.example') fail(`${name} must not be stored in the repository.`);
}

if (failures.length) {
  console.error(`Security configuration validation failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('Security configuration validation passed (native policy, web headers, and high-confidence secret scan).');
}
