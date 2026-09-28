'use strict';

const IOS_IDENTIFIER = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/;
const ANDROID_IDENTIFIER = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const PLACEHOLDER_IDENTIFIER = /(?:^|\.)(?:example(?:app|company|institution|org|school|university)?|placeholder|invalid|sample|demo|test|institution|your(?:app|company|institution|org|school))(?:\.|$)/i;

const readBooleanFlag = (environment, name) => {
  const value = environment[name]?.trim().toLowerCase();
  if (!value || value === '0' || value === 'false') return false;
  if (value === '1' || value === 'true') return true;
  throw new Error(`${name} must be one of: 1, true, 0, false.`);
};

const optionalIdentifier = (environment, name, pattern, label) => {
  const value = environment[name]?.trim();
  if (!value) return undefined;
  if (value.length > 255 || !pattern.test(value) || PLACEHOLDER_IDENTIFIER.test(value)) {
    throw new Error(`${name} must be a non-placeholder ${label}.`);
  }
  return value;
};

const optionalIosBuildNumber = environment => {
  const value = environment.LMS_IOS_BUILD_NUMBER?.trim();
  if (!value) return undefined;
  const components = value.split('.');
  if (components.length > 3
    || !/^\d{1,4}$/.test(components[0])
    || Number(components[0]) === 0
    || components.slice(1).some(component => !/^\d{1,2}$/.test(component))) {
    throw new Error('LMS_IOS_BUILD_NUMBER must contain a 1–4 digit positive major build and up to two 1–2 digit numeric components.');
  }
  return value;
};

const optionalAndroidVersionCode = environment => {
  const value = environment.LMS_ANDROID_VERSION_CODE?.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_100_000_000) {
    throw new Error('LMS_ANDROID_VERSION_CODE must be a whole number from 1 to 2,100,000,000.');
  }
  return parsed;
};

const resolveReleaseIdentity = (environment = process.env) => ({
  iosBundleIdentifier: optionalIdentifier(
    environment,
    'LMS_IOS_BUNDLE_IDENTIFIER',
    IOS_IDENTIFIER,
    'reverse-DNS iOS bundle identifier',
  ),
  androidPackage: optionalIdentifier(
    environment,
    'LMS_ANDROID_PACKAGE',
    ANDROID_IDENTIFIER,
    'lowercase reverse-DNS Android package name',
  ),
  iosBuildNumber: optionalIosBuildNumber(environment),
  androidVersionCode: optionalAndroidVersionCode(environment),
  allowInsecureLocalhost: readBooleanFlag(environment, 'LMS_ALLOW_INSECURE_LOCALHOST'),
});

const applyReleaseEnvironment = (baseExpo, environment = process.env) => {
  const identity = resolveReleaseIdentity(environment);
  const expo = JSON.parse(JSON.stringify(baseExpo));
  if (identity.iosBundleIdentifier) {
    expo.ios = { ...expo.ios, bundleIdentifier: identity.iosBundleIdentifier };
  }
  if (identity.iosBuildNumber) {
    expo.ios = { ...expo.ios, buildNumber: identity.iosBuildNumber };
  }
  if (identity.androidPackage) {
    expo.android = { ...expo.android, package: identity.androidPackage };
  }
  if (identity.androidVersionCode) {
    expo.android = { ...expo.android, versionCode: identity.androidVersionCode };
  }
  expo.plugins = (expo.plugins || []).map(plugin => {
    if (!Array.isArray(plugin) || plugin[0] !== './plugins/withReleaseSecurity') return plugin;
    return [plugin[0], { allowInsecureLocalhost: identity.allowInsecureLocalhost }];
  });
  return expo;
};

module.exports = {
  ANDROID_IDENTIFIER,
  IOS_IDENTIFIER,
  PLACEHOLDER_IDENTIFIER,
  applyReleaseEnvironment,
  readBooleanFlag,
  resolveReleaseIdentity,
};
