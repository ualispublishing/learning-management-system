import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getSingleEmbeddedSitePresentationItem } from '../src/lib/coursePresentation';
import { ContentItem } from '../src/types/lms';

const linkedItem = (overrides: Partial<ContentItem> = {}): ContentItem => ({
  id: 'site',
  courseId: 'course',
  category: 'admin',
  title: 'Course site',
  description: 'Embedded HTTPS course site',
  contentUrl: 'https://course.example.edu/',
  presentationSlot: 'current',
  createdAt: 1,
  metadata: { lmsContentType: 'custom', lmsCustomWidgetKind: 'link', lmsEmbedMode: 'embedded' },
  ...overrides,
});

test('only a true single embedded-site course may bypass the outer feed scroller', () => {
  assert.equal(getSingleEmbeddedSitePresentationItem([linkedItem()])?.id, 'site');
  assert.equal(getSingleEmbeddedSitePresentationItem([linkedItem({ metadata: { lmsContentType: 'custom', lmsCustomWidgetKind: 'link', lmsEmbedMode: 'external' } })]), null);
  assert.equal(getSingleEmbeddedSitePresentationItem([linkedItem({ contentUrl: 'http://course.example.edu/' })]), null);
  assert.equal(getSingleEmbeddedSitePresentationItem([linkedItem(), linkedItem({ id: 'resource-2' })]), null);
  assert.equal(getSingleEmbeddedSitePresentationItem([linkedItem(), linkedItem({ id: 'deleted', deletedAt: 2 })])?.id, 'site');
});

test('course presentation source preserves compact chrome, no-scroll site mode, and focus escape controls', async () => {
  const [layout, courseRoute, feed, frame] = await Promise.all([
    readFile(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/admin/course/[id]/index.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/lms/StudentFeed.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/lms/ExternalSiteFrame.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(layout, /pathname\.includes\('\/admin\/course\/'\)/);
  assert.match(layout, /maxWidth: isCourseScreen && Platform\.OS === 'web' \? undefined : appCanvasMaxWidth/);
  assert.match(courseRoute, /isPresentationView[\s\S]*styles\.presentationHeader/);
  assert.match(courseRoute, /canEdit && teacherMode === 'edit'[\s\S]*CourseSetupReviewPanel/);
  assert.match(feed, /if \(singleEmbeddedSiteItem && !isItemLocked\(singleEmbeddedSiteItem\)\)[\s\S]*fillViewport/);
  assert.match(frame, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(frame, /event\.key !== 'Escape'/);
  assert.match(frame, /The site may be offline or blocking embedded access\./);
  assert.match(frame, /Course site is above/);
  assert.match(frame, /sandbox=\{EXTERNAL_SITE_SANDBOX\}/);
  assert.match(frame, /allow=\{EXTERNAL_SITE_ALLOW\}/);
  assert.match(frame, /srcDoc=\{demoDocument \|\| undefined\}/);
  assert.match(feed, /lmsDemoPortal === 'programming-course-v1'/);
  assert.match(frame, /if \(previewMode \|\| !principalId \|\| !courseId \|\| !contentItemId\) return/);
  assert.match(frame, /getLearningStateService\(\)[\s\S]*'external-site'/);
});
