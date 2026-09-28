import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const base = require(path.join(root, 'app.json'));
const { applyReleaseEnvironment, resolveReleaseIdentity } = require(path.join(root, 'scripts/release-config.cjs'));

const identity = resolveReleaseIdentity(process.env);
const failures = [];
if (!identity.iosBundleIdentifier) failures.push('LMS_IOS_BUNDLE_IDENTIFIER is required.');
if (!identity.androidPackage) failures.push('LMS_ANDROID_PACKAGE is required.');
if (!identity.iosBuildNumber) failures.push('LMS_IOS_BUILD_NUMBER is required.');
if (!identity.androidVersionCode) failures.push('LMS_ANDROID_VERSION_CODE is required.');
if (identity.allowInsecureLocalhost) failures.push('LMS_ALLOW_INSECURE_LOCALHOST must be disabled for a production build.');

const expo = applyReleaseEnvironment(base.expo, process.env);
if (identity.iosBundleIdentifier && expo.ios?.bundleIdentifier !== identity.iosBundleIdentifier) failures.push('The iOS bundle identifier was not applied.');
if (identity.androidPackage && expo.android?.package !== identity.androidPackage) failures.push('The Android package name was not applied.');
if (identity.iosBuildNumber && expo.ios?.buildNumber !== identity.iosBuildNumber) failures.push('The iOS build number was not applied.');
if (identity.androidVersionCode && expo.android?.versionCode !== identity.androidVersionCode) failures.push('The Android version code was not applied.');
if (expo.android?.allowBackup !== false) failures.push('Android backup must remain disabled.');
const plugin = expo.plugins?.find(entry => Array.isArray(entry) && entry[0] === './plugins/withReleaseSecurity');
if (!plugin || plugin[1]?.allowInsecureLocalhost !== false) failures.push('The secure native transport plugin is not configured for production.');

for (const name of Object.keys(process.env)) {
  if (/^EXPO_PUBLIC_.*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|CREDENTIAL|API_KEY)/.test(name)) {
    failures.push(`${name} is named like a secret but would be embedded in the public client bundle.`);
  }
}

if (failures.length) {
  console.error(`Production configuration is incomplete:\n- ${failures.join('\n- ')}`);
  console.error('No platform identifier was guessed. Supply institution-owned identifiers only in the release environment.');
  process.exitCode = 1;
} else {
  console.log(`Production identity validated for ${identity.iosBundleIdentifier} (${identity.iosBuildNumber}) and ${identity.androidPackage} (${identity.androidVersionCode}).`);
  console.log('This validates repository-local build policy only; SSO, backend adapters, signing, store privacy disclosures, and hosting remain external gates.');
}
