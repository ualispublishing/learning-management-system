'use strict';

const { applyReleaseEnvironment } = require('./scripts/release-config.cjs');
const branding = require('./src/lib/branding.generated.json');

// App identity/security remains operator-configured; visual branding comes
// from the same generated manifest consumed by the app's theme and chrome.
module.exports = ({ config }) => {
  const release = applyReleaseEnvironment(config, process.env);
  return {
    ...release,
    name: branding.name,
    android: { ...release.android, adaptiveIcon: { ...release.android?.adaptiveIcon, backgroundColor: branding.logoBackground } },
    plugins: release.plugins.map(plugin => {
      if (!Array.isArray(plugin)) return plugin;
      if (plugin[0] === 'expo-splash-screen') return [plugin[0], { ...plugin[1], backgroundColor: branding.logoBackground }];
      if (['expo-audio', 'expo-image-picker'].includes(plugin[0])) return [plugin[0], Object.fromEntries(Object.entries(plugin[1]).map(([key, value]) => [key, typeof value === 'string' && config.name ? value.replaceAll(config.name, branding.name) : value]))];
      return plugin;
    }),
  };
};
