import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTERNAL_SITE_ALLOW,
  EXTERNAL_SITE_SANDBOX,
  getExternalSiteBridgeConfiguration,
  normalizeExternalSiteProgressMessage,
} from '../src/lib/externalSiteSecurity';

test('external course embeds keep scripts in an opaque sandbox origin', () => {
  const tokens = new Set(EXTERNAL_SITE_SANDBOX.split(/\s+/));
  assert.equal(tokens.has('allow-scripts'), true, 'interactive course sites still need JavaScript');
  assert.equal(tokens.has('allow-same-origin'), false, 'scripts and same-origin must never be combined');
  assert.equal(tokens.has('allow-top-navigation'), false);
  assert.equal(tokens.has('allow-popups-to-escape-sandbox'), false);
});

test('external course embeds delegate fullscreen and no sensitive device capabilities', () => {
  assert.equal(EXTERNAL_SITE_ALLOW, 'fullscreen');
  assert.doesNotMatch(EXTERNAL_SITE_ALLOW, /camera|microphone|geolocation|payment|clipboard|serial|usb/i);
});

test('provider bridge declarations require an exact URL origin and reviewed capabilities', () => {
  const valid = getExternalSiteBridgeConfiguration({
    lmsEmbedBridge: {
      protocol: 'lms-embed-state-v1',
      origin: 'https://course.example.edu',
      capabilities: ['resume', 'progress'],
      privacyNotice: 'The provider reports progress only after learner consent.',
    },
  }, 'https://course.example.edu/module/1');
  assert.deepEqual(valid?.capabilities, ['resume', 'progress']);
  assert.equal(getExternalSiteBridgeConfiguration({
    lmsEmbedBridge: { ...valid, origin: 'https://other.example.edu' },
  }, 'https://course.example.edu/module/1'), null);
  assert.equal(getExternalSiteBridgeConfiguration({
    lmsEmbedBridge: { ...valid, capabilities: ['progress', 'camera'] },
  }, 'https://course.example.edu/module/1'), null);
});

test('provider progress payloads are content-bound and size/range bounded', () => {
  const valid = normalizeExternalSiteProgressMessage({
    type: 'lms.embed.progress.v1',
    contentItemId: 'module-1',
    messageId: 'message-1',
    progress: 0.75,
    positionSeconds: 42,
    resumeToken: 'opaque-provider-token',
  }, 'module-1');
  assert.equal(valid?.progress, 0.75);
  assert.equal(normalizeExternalSiteProgressMessage({ ...valid, contentItemId: 'module-2' }, 'module-1'), null);
  assert.equal(normalizeExternalSiteProgressMessage({ ...valid, progress: 1.01 }, 'module-1'), null);
  assert.equal(normalizeExternalSiteProgressMessage({ ...valid, resumeToken: 'x'.repeat(2_049) }, 'module-1'), null);
});
