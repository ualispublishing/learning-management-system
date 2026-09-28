'use strict';

const { applyReleaseEnvironment } = require('./scripts/release-config.cjs');

// Expo supplies the normalized app.json `expo` object as `config`. Returning
// that object directly keeps static and dynamic configuration in one schema.
module.exports = ({ config }) => ({
  ...config,
  ...applyReleaseEnvironment(config, process.env),
});
