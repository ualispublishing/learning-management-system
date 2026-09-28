import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { COURSE_ROLE_LABELS } from '../src/lib/authorization/courseRoleManagement';
import { demoUsers } from '../src/lib/repositories/memory/demoData';

const require = createRequire(import.meta.url);
const appConfig = require('../app.json') as {
  expo: {
    orientation?: string;
    plugins?: (string | [string, Record<string, unknown>])[];
    android?: { blockedPermissions?: string[] };
  };
};
const packageManifest = require('../package.json') as { dependencies: Record<string, string> };
const acceptancePath = new URL('../docs/manual-device-accessibility-acceptance-2026-08-20.md', import.meta.url);
const acceptance = readFileSync(acceptancePath, 'utf8');
const normalizedAcceptance = acceptance.replace(/\s+/g, ' ');

const checklistEntries = Array.from(acceptance.matchAll(/^- \[([ xX])\] `([A-Z0-9-]+)`/gm));

test('manual acceptance gate stays explicitly unexecuted and evidence-ready', () => {
  assert.match(acceptance, /Current execution status: \*\*NOT RUN — manual evidence required\.\*\*/);
  assert.ok(checklistEntries.length >= 38, `expected at least 38 executable cases, found ${checklistEntries.length}`);
  assert.equal(new Set(checklistEntries.map(entry => entry[2])).size, checklistEntries.length, 'case IDs must be unique');
  assert.ok(checklistEntries.every(entry => entry[1] === ' '), 'the repository must not pre-claim a completed manual case');

  [
    'Commit SHA and clean/dirty status',
    'iOS bundle ID, version/build, artifact hash',
    'Android package, version/code, artifact hash',
    'Case ID / target slot / role',
    'Device model; OS/browser/AT versions',
    'Actions actually performed',
    'Expected result',
    'Observed result',
    'Defect ID and severity',
    'Retest evidence and reviewer initials',
  ].forEach(field => assert.ok(acceptance.includes(field), `missing evidence field: ${field}`));
});

test('manual gate covers every role, platform, assistive mode, and high-risk device boundary', () => {
  const requiredCaseIds = [
    'ROLE-01', 'ROLE-02', 'ROLE-03', 'ROLE-04', 'ROLE-05',
    'XAPP-04', 'XAPP-05', 'XAPP-06',
    'A11Y-01', 'A11Y-03', 'A11Y-04', 'A11Y-05', 'A11Y-06',
    'DEVICE-01', 'DEVICE-03', 'DEVICE-05', 'DEVICE-07',
    'NET-01', 'NET-02', 'NET-03', 'NET-04', 'NET-06',
  ];
  const actualCaseIds = new Set(checklistEntries.map(entry => entry[2]));
  requiredCaseIds.forEach(caseId => assert.ok(actualCaseIds.has(caseId), `missing required manual case ${caseId}`));

  const roleLabels = Object.values(COURSE_ROLE_LABELS);
  roleLabels.forEach(label => assert.ok(acceptance.includes(label), `missing course role ${label}`));
  const fixtureRoles = new Set(demoUsers.map(user => user.role));
  Object.keys(COURSE_ROLE_LABELS).forEach(role => assert.ok(fixtureRoles.has(role as keyof typeof COURSE_ROLE_LABELS), `demo fixture lacks ${role}`));

  [
    'Physical iPhone', 'Physical iPad', 'Physical Android phone', 'Physical Android tablet',
    'VoiceOver', 'TalkBack', 'keyboard only', '400% browser zoom', 'forced-colors',
    'microphone', 'document', 'local notification', 'offline', 'reconnect',
    'timeline', 'sequential', 'custom static-code', 'linked-site',
  ].forEach(boundary => assert.ok(normalizedAcceptance.toLocaleLowerCase().includes(boundary.toLocaleLowerCase()), `missing boundary: ${boundary}`));
});

test('native configuration exposes prerequisites for the documented physical-device cases', () => {
  assert.equal(appConfig.expo.orientation, 'default', 'both native orientations must remain available for acceptance');

  const pluginNames = new Set((appConfig.expo.plugins ?? []).map(plugin => Array.isArray(plugin) ? plugin[0] : plugin));
  ['expo-audio', 'expo-video', 'expo-image-picker', 'expo-notifications'].forEach(plugin => {
    assert.ok(pluginNames.has(plugin), `missing native plugin prerequisite ${plugin}`);
  });
  ['expo-document-picker', 'expo-file-system', 'expo-sharing'].forEach(dependency => {
    assert.ok(packageManifest.dependencies[dependency], `missing device dependency prerequisite ${dependency}`);
  });

  const blockedPermissions = new Set(appConfig.expo.android?.blockedPermissions ?? []);
  ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'].forEach(permission => {
    assert.ok(blockedPermissions.has(permission), `legacy broad storage permission must remain blocked: ${permission}`);
  });
});

test('the manual gate states deployment-owned offline, push, embed, and media-alternative limits', () => {
  assert.match(acceptance, /offline institution\s+snapshot is available only when the deployment injects/i);
  assert.match(acceptance, /is not an offline mutation queue/i);
  assert.match(acceptance, /Remote course-announcement and Chat-message push[\s\S]*?are not implemented/i);
  assert.match(acceptance, /Linked course sites embed only on web/i);
  assert.match(acceptance, /accurate captions and an adjacent,[\s\S]*?transcript/i);
  assert.match(acceptance, /record a release blocker/i);
});
