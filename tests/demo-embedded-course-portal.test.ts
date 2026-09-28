import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDemoEmbeddedCoursePortalDocument,
  PROGRAMMING_COURSE_PORTAL_ID,
} from '../src/lib/demoEmbeddedCoursePortal';

test('the project-owned embedded portal is rich, accessible, static, and network-free', () => {
  const document = getDemoEmbeddedCoursePortalDocument(PROGRAMMING_COURSE_PORTAL_ID);
  assert.ok(document);
  assert.match(document, /<main id="overview">/);
  assert.match(document, /role="progressbar"/);
  assert.match(document, /This week’s sequence/);
  assert.match(document, /One-pass accumulator/);
  assert.match(document, /href="#modules"/);
  assert.match(document, /Content-Security-Policy/);
  assert.doesNotMatch(document, /<(?:script|form|iframe|object|embed)\b/i);
  assert.doesNotMatch(document, /https?:\/\//i);
  assert.doesNotMatch(document, /url\s*\(|@import/i);
});

test('unknown metadata cannot select arbitrary embedded markup', () => {
  assert.equal(getDemoEmbeddedCoursePortalDocument('unknown-portal'), null);
  assert.equal(getDemoEmbeddedCoursePortalDocument('<h1>injected</h1>'), null);
  assert.equal(getDemoEmbeddedCoursePortalDocument({ html: '<h1>injected</h1>' }), null);
});
