import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ACTIVATION_PREFLIGHT_CHECKS,
  ACTIVATION_STEPS,
  buildTenantPreview,
  createInstitutionActivationDraft,
  getActivationStepError,
  normalizeActivationStepIndex,
  parseInstitutionActivationDraft,
} from '../src/lib/institutionActivation';

test('organization activation is a bounded six-stage journey', () => {
  assert.deepEqual(ACTIVATION_STEPS.map(step => step.id), [
    'organization',
    'identity',
    'data',
    'governance',
    'preflight',
    'activate',
  ]);
  assert.equal(normalizeActivationStepIndex(-8), 0);
  assert.equal(normalizeActivationStepIndex(99), 5);
  assert.equal(ACTIVATION_PREFLIGHT_CHECKS.length, 6);
});

test('activation validation blocks incomplete ownership, identity, governance, and preflight', () => {
  const draft = createInstitutionActivationDraft();
  assert.match(getActivationStepError(draft, 0) ?? '', /institution or business/i);
  Object.assign(draft, {
    organizationName: 'Northstar University',
    ownerName: 'Jordan Lee',
    ownerEmail: 'jordan@northstar.example',
  });
  assert.equal(getActivationStepError(draft, 0), null);
  assert.match(getActivationStepError(draft, 1) ?? '', /HTTPS/i);
  draft.identityDomain = 'https://login.northstar.example';
  assert.equal(getActivationStepError(draft, 1), null);
  draft.identityDomain = 'https://login.northstar.example/tenant/v2.0';
  assert.equal(getActivationStepError(draft, 1), null);
  draft.identityDomain = 'https://user:secret@login.northstar.example/tenant';
  assert.match(getActivationStepError(draft, 1) ?? '', /credential-free/i);
  draft.identityDomain = 'https://login.northstar.example';
  assert.match(getActivationStepError(draft, 3) ?? '', /security, privacy, and accessibility/i);
  draft.securityOwnerConfirmed = true;
  draft.privacyOwnerConfirmed = true;
  draft.accessibilityOwnerConfirmed = true;
  assert.equal(getActivationStepError(draft, 3), null);
  assert.match(getActivationStepError(draft, 4) ?? '', /pilot checks/i);
  draft.preflightCompleted = true;
  assert.equal(getActivationStepError(draft, 4), null);
});

test('saved activation drafts are versioned, bounded, and safely normalized', () => {
  const parsed = parseInstitutionActivationDraft({
    ...createInstitutionActivationDraft(),
    stepIndex: 200,
    organizationName: 'N'.repeat(300),
    pilotCohortSize: 999,
    activated: true,
    updatedAt: -5,
  });
  assert.ok(parsed);
  assert.equal(parsed.stepIndex, ACTIVATION_STEPS.length - 1);
  assert.equal(parsed.organizationName.length, 120);
  assert.equal(parsed.pilotCohortSize, 250);
  assert.equal(parsed.updatedAt, 0);
  assert.equal(parseInstitutionActivationDraft({ version: 2 }), null);
  assert.equal(parseInstitutionActivationDraft({ ...createInstitutionActivationDraft(), organizationType: 'business', dataSource: 'oneroster' })?.dataSource, 'hris');
});

test('tenant previews are stable display-only slugs', () => {
  assert.equal(buildTenantPreview('École North Star & Partners'), 'ecole-north-star-partners');
  assert.equal(buildTenantPreview('  '), 'organization');
  assert.ok(buildTenantPreview('x'.repeat(200)).length <= 42);
});

test('courses surface the activation journey as an explicit development simulation', async () => {
  const [courses, journey] = await Promise.all([
    readFile(new URL('../src/components/lms/CourseList.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/lms/InstitutionActivationJourney.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(courses, /Institution & business activation/);
  assert.match(courses, /Open activation journey/);
  assert.match(courses, /<InstitutionActivationJourney/);
  assert.match(journey, /Interactive activation simulation/);
  assert.match(journey, /No tenant, identity connection, contract, or learner record is created/);
  assert.match(journey, /Step \{draft\.stepIndex \+ 1\} of \{ACTIVATION_STEPS\.length\}/);
  assert.match(journey, /Activate simulated pilot/);
  assert.match(journey, /INSTITUTION_ACTIVATION_STORAGE_KEY/);
});
