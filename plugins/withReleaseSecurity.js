'use strict';

const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, withInfoPlist } = require('expo/config-plugins');

const LOCAL_NETWORK_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`;

const withAndroidTransportSecurity = (config, allowInsecureLocalhost) => withAndroidManifest(config, nextConfig => {
  const application = nextConfig.modResults.manifest.application?.[0];
  if (!application?.$) throw new Error('The Android application manifest is missing its application element.');
  application.$['android:allowBackup'] = 'false';
  application.$['android:usesCleartextTraffic'] = 'false';
  if (allowInsecureLocalhost) application.$['android:networkSecurityConfig'] = '@xml/lms_local_network_security_config';
  else delete application.$['android:networkSecurityConfig'];
  return nextConfig;
});

const withAndroidLocalhostConfig = (config, allowInsecureLocalhost) => {
  if (!allowInsecureLocalhost) return config;
  return withDangerousMod(config, ['android', async nextConfig => {
    const resourceDirectory = path.join(
      nextConfig.modRequest.platformProjectRoot,
      'app',
      'src',
      'main',
      'res',
      'xml',
    );
    await mkdir(resourceDirectory, { recursive: true });
    await writeFile(path.join(resourceDirectory, 'lms_local_network_security_config.xml'), LOCAL_NETWORK_CONFIG, 'utf8');
    return nextConfig;
  }]);
};

const withIosTransportSecurity = (config, allowInsecureLocalhost) => withInfoPlist(config, nextConfig => {
  nextConfig.modResults.NSAppTransportSecurity = allowInsecureLocalhost
    ? {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: true,
        NSExceptionDomains: {
          localhost: {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSIncludesSubdomains: false,
          },
        },
      }
    : {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: false,
      };
  return nextConfig;
});

/**
 * Keeps native release transport and backup policy independent of Expo's
 * template defaults. Local cleartext traffic is an explicit development-only
 * opt-in supplied by app.config.js, never a production default.
 */
module.exports = (config, options = {}) => {
  const allowInsecureLocalhost = options.allowInsecureLocalhost === true;
  return withIosTransportSecurity(withAndroidLocalhostConfig(
    withAndroidTransportSecurity(config, allowInsecureLocalhost),
    allowInsecureLocalhost,
  ), allowInsecureLocalhost);
};

module.exports.LOCAL_NETWORK_CONFIG = LOCAL_NETWORK_CONFIG;
