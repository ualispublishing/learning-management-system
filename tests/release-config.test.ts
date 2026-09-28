import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const base = require('../app.json') as { expo: Record<string, any> };
const dynamicConfig = require('../app.config.js') as (input: { config: Record<string, any> }) => Record<string, any>;
const packageManifest = require('../package.json') as { dependencies: Record<string, string> };
const {
  applyReleaseEnvironment,
  readBooleanFlag,
  resolveReleaseIdentity,
} = require('../scripts/release-config.cjs') as {
  applyReleaseEnvironment: (expo: Record<string, any>, environment: Record<string, string | undefined>) => Record<string, any>;
  readBooleanFlag: (environment: Record<string, string | undefined>, name: string) => boolean;
  resolveReleaseIdentity: (environment: Record<string, string | undefined>) => {
    iosBundleIdentifier?: string;
    androidPackage?: string;
    iosBuildNumber?: string;
    androidVersionCode?: number;
    allowInsecureLocalhost: boolean;
  };
};
const { LOCAL_NETWORK_CONFIG } = require('../plugins/withReleaseSecurity.js') as { LOCAL_NETWORK_CONFIG: string };

test('release environment applies institution-owned native identifiers without mutating the base config', () => {
  const environment = {
    LMS_IOS_BUNDLE_IDENTIFIER: 'org.releasecheck.learning',
    LMS_ANDROID_PACKAGE: 'org.releasecheck.learning',
    LMS_IOS_BUILD_NUMBER: '2026.8.20',
    LMS_ANDROID_VERSION_CODE: '20260820',
  };
  const result = applyReleaseEnvironment(base.expo, environment);
  assert.equal(result.ios.bundleIdentifier, environment.LMS_IOS_BUNDLE_IDENTIFIER);
  assert.equal(result.android.package, environment.LMS_ANDROID_PACKAGE);
  assert.equal(result.ios.buildNumber, environment.LMS_IOS_BUILD_NUMBER);
  assert.equal(result.android.versionCode, Number(environment.LMS_ANDROID_VERSION_CODE));
  assert.equal(base.expo.ios?.bundleIdentifier, undefined);
  assert.equal(base.expo.android?.package, undefined);
  const plugin = result.plugins.find((entry: unknown) => Array.isArray(entry) && entry[0] === './plugins/withReleaseSecurity');
  assert.deepEqual(plugin, ['./plugins/withReleaseSecurity', { allowInsecureLocalhost: false }]);
});

test('dynamic Expo configuration extends the normalized app.json config without nesting it', () => {
  const result = dynamicConfig({ config: base.expo });
  assert.equal(result.name, base.expo.name);
  assert.equal(result.slug, base.expo.slug);
  assert.equal(result.expo, undefined);
  assert.notEqual(result, base.expo);
});

test('release identifiers reject placeholders, malformed values, and public-style guesses', () => {
  assert.throws(
    () => resolveReleaseIdentity({ LMS_IOS_BUNDLE_IDENTIFIER: 'com.placeholder.appid' }),
    /non-placeholder/,
  );
  assert.throws(
    () => resolveReleaseIdentity({ LMS_IOS_BUNDLE_IDENTIFIER: 'edu.exampleuniversity.learning' }),
    /non-placeholder/,
  );
  assert.throws(
    () => resolveReleaseIdentity({ LMS_ANDROID_PACKAGE: 'edu.institution.product' }),
    /non-placeholder/,
  );
  assert.throws(
    () => resolveReleaseIdentity({ LMS_ANDROID_PACKAGE: 'Edu.Institution.LMS' }),
    /lowercase reverse-DNS/,
  );
  assert.throws(
    () => resolveReleaseIdentity({ LMS_ANDROID_PACKAGE: 'lms-app' }),
    /lowercase reverse-DNS/,
  );
});

test('insecure localhost transport is opt-in and accepts no ambiguous flag value', () => {
  assert.equal(readBooleanFlag({}, 'LMS_ALLOW_INSECURE_LOCALHOST'), false);
  assert.equal(readBooleanFlag({ LMS_ALLOW_INSECURE_LOCALHOST: '1' }, 'LMS_ALLOW_INSECURE_LOCALHOST'), true);
  assert.equal(readBooleanFlag({ LMS_ALLOW_INSECURE_LOCALHOST: 'false' }, 'LMS_ALLOW_INSECURE_LOCALHOST'), false);
  assert.throws(
    () => readBooleanFlag({ LMS_ALLOW_INSECURE_LOCALHOST: 'sometimes' }, 'LMS_ALLOW_INSECURE_LOCALHOST'),
    /must be one of/,
  );
  assert.match(LOCAL_NETWORK_CONFIG, /base-config cleartextTrafficPermitted="false"/);
  assert.match(LOCAL_NETWORK_CONFIG, /<domain includeSubdomains="false">localhost<\/domain>/);
  assert.match(LOCAL_NETWORK_CONFIG, /<domain includeSubdomains="false">127\.0\.0\.1<\/domain>/);
  assert.doesNotMatch(LOCAL_NETWORK_CONFIG, /cleartextTrafficPermitted="true"\s*\/>/);
});

test('native store build numbers are explicit, bounded, and never defaulted by the repository', () => {
  assert.throws(() => resolveReleaseIdentity({ LMS_IOS_BUILD_NUMBER: '0' }), /positive major/);
  assert.throws(() => resolveReleaseIdentity({ LMS_IOS_BUILD_NUMBER: '1.2.3.4' }), /up to two/);
  assert.throws(() => resolveReleaseIdentity({ LMS_IOS_BUILD_NUMBER: '10000.1.1' }), /1–4 digit/);
  assert.throws(() => resolveReleaseIdentity({ LMS_ANDROID_VERSION_CODE: '-1' }), /whole number/);
  assert.throws(() => resolveReleaseIdentity({ LMS_ANDROID_VERSION_CODE: '2100000001' }), /2,100,000,000/);
  const result = resolveReleaseIdentity({ LMS_IOS_BUILD_NUMBER: '7', LMS_ANDROID_VERSION_CODE: '42' });
  assert.equal(result.iosBuildNumber, '7');
  assert.equal(result.androidVersionCode, 42);
});

test('media runtime uses maintained modules with least-privilege native configuration', () => {
  assert.equal(packageManifest.dependencies['expo-av'], undefined);
  assert.match(packageManifest.dependencies['expo-asset'], /^~57\./);
  assert.match(packageManifest.dependencies['expo-audio'], /^~57\./);
  assert.match(packageManifest.dependencies['expo-video'], /^~57\./);

  assert.ok(base.expo.plugins.includes('expo-asset'));
  const splashPlugin = base.expo.plugins.find(
    (entry: unknown) => Array.isArray(entry) && entry[0] === 'expo-splash-screen',
  );
  assert.deepEqual(splashPlugin, ['expo-splash-screen', {
    image: './assets/brand/lms-app-splash.png',
    resizeMode: 'contain',
    backgroundColor: '#07183F',
  }]);

  const audioPlugin = base.expo.plugins.find(
    (entry: unknown) => Array.isArray(entry) && entry[0] === 'expo-audio',
  );
  assert.deepEqual(audioPlugin, ['expo-audio', {
    microphonePermission: 'Allow LMS App to record audio that you choose to add to flashcards.',
    recordAudioAndroid: true,
    enableBackgroundRecording: false,
    enableBackgroundPlayback: false,
  }]);

  const videoPlugin = base.expo.plugins.find(
    (entry: unknown) => Array.isArray(entry) && entry[0] === 'expo-video',
  );
  assert.deepEqual(videoPlugin, ['expo-video', {
    supportsBackgroundPlayback: false,
    supportsPictureInPicture: false,
  }]);
});
