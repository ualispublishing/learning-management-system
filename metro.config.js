const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bound concurrent transforms on high-core machines to keep demo/build memory predictable.
config.maxWorkers = 2;

// expo-sqlite's web implementation loads its SQLite engine as a WASM asset.
// Explicitly preserve that extension in production web bundles.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
