import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildCoursePresentationBuckets,
  buildSequentialCourseBuckets,
  buildSequentialModuleScheduleChanges,
  buildTimelineCourseBuckets,
} from '../src/lib/coursePresentationBuckets';
import { ContentItem } from '../src/types/lms';

const NOW = Date.parse('2026-09-01T12:00:00Z');

const content = (overrides: Partial<ContentItem> & Pick<ContentItem, 'id' | 'title'>): ContentItem => ({
  courseId: 'course-1',
  category: 'material',
  presentationSlot: 'current',
  createdAt: NOW,
  ...overrides,
});

test('sequential presentation never exposes a locked module child as ungrouped content', () => {
  const lockedBlock = content({
    id: 'future-module',
    title: 'Future module',
    category: 'admin',
    presentationSlot: 'block-header',
    groupIcon: 'module-future',
    availableDate: '2026-09-08T12:00:00Z',
  });
  const child = content({
    id: 'future-module-child',
    title: 'Private future lesson title',
    groupIcon: 'module-future',
  });

  assert.deepEqual(buildSequentialCourseBuckets([lockedBlock, child], NOW), [
    { id: 'course-content', label: 'Course content', items: [] },
  ]);
});

test('sequential presentation orders visible module children once and retains true orphans', () => {
  const block = content({
    id: 'module',
    title: 'Module',
    category: 'admin',
    presentationSlot: 'block-header',
    groupIcon: 'module-one',
    orderIndex: 1,
  });
  const laterChild = content({ id: 'later', title: 'Later', groupIcon: 'module-one', orderIndex: 2 });
  const earlierChild = content({ id: 'earlier', title: 'Earlier', groupIcon: 'module-one', orderIndex: 1 });
  const orphan = content({ id: 'orphan', title: 'Orphan', orderIndex: 4 });

  const buckets = buildSequentialCourseBuckets([laterChild, orphan, block, earlierChild], NOW);
  assert.deepEqual(buckets.map(bucket => bucket.id), ['module', 'ungrouped']);
  assert.deepEqual(buckets[0].items.map(item => item.id), ['earlier', 'later']);
  assert.deepEqual(buckets[1].items.map(item => item.id), ['orphan']);
});

test('a malformed module without a group key cannot swallow ungrouped content', () => {
  const block = content({
    id: 'malformed-module',
    title: 'Malformed module',
    category: 'admin',
    presentationSlot: 'block-header',
  });
  const orphan = content({ id: 'orphan', title: 'Orphan' });

  const buckets = buildSequentialCourseBuckets([block, orphan], NOW);
  assert.deepEqual(buckets.map(bucket => [bucket.id, bucket.items.map(item => item.id)]), [
    ['malformed-module', []],
    ['ungrouped', ['orphan']],
  ]);
});

test('module scheduling updates the header and children as one mode-safe batch', () => {
  const items = [
    content({ id: 'module', title: 'Module', category: 'admin', presentationSlot: 'block-header', groupIcon: 'group:module' }),
    content({ id: 'child-a', title: 'A', groupIcon: 'group:module', presentationSlot: 'past' }),
    content({ id: 'child-b', title: 'B', groupIcon: 'group:module', presentationSlot: 'future' }),
    content({ id: 'orphan', title: 'Orphan' }),
  ];

  assert.deepEqual(buildSequentialModuleScheduleChanges(items, 'module', '2026-09-01T09:00'), [
    { itemId: 'module', updates: { availableDate: '2026-09-01T09:00', presentationSlot: 'block-header' } },
    { itemId: 'child-a', updates: { availableDate: '2026-09-01T09:00', presentationSlot: 'scheduled' } },
    { itemId: 'child-b', updates: { availableDate: '2026-09-01T09:00', presentationSlot: 'scheduled' } },
  ]);

  assert.deepEqual(buildSequentialModuleScheduleChanges(items, 'module', '  '), [
    { itemId: 'module', updates: { availableDate: undefined, presentationSlot: 'block-header' } },
    { itemId: 'child-a', updates: { availableDate: undefined, presentationSlot: 'current' } },
    { itemId: 'child-b', updates: { availableDate: undefined, presentationSlot: 'current' } },
  ]);
  assert.deepEqual(buildSequentialModuleScheduleChanges(items, 'missing', '2026-09-01T09:00'), []);
});

test('timeline presentation classifies and orders explicit and scheduled content at release boundaries', () => {
  const items = [
    content({ id: 'past-explicit', title: 'Past explicit', presentationSlot: 'past', orderIndex: 2 }),
    content({ id: 'past-scheduled', title: 'Past scheduled', presentationSlot: 'scheduled', availableDate: '2026-09-01T10:00:00Z', displayDate: '2026-09-01T11:59:59Z', orderIndex: 1 }),
    content({ id: 'current-explicit', title: 'Current explicit', presentationSlot: 'current', orderIndex: 2 }),
    content({ id: 'current-scheduled', title: 'Current scheduled', presentationSlot: 'scheduled', availableDate: '2026-09-01T12:00:00Z', displayDate: '2026-09-01T13:00:00Z', orderIndex: 1 }),
    content({ id: 'future-explicit', title: 'Future explicit', presentationSlot: 'future', orderIndex: 2 }),
    content({ id: 'future-scheduled', title: 'Future scheduled', presentationSlot: 'scheduled', availableDate: '2026-09-01T12:00:00.001Z', orderIndex: 1 }),
    content({ id: 'future-malformed', title: 'Malformed schedule', presentationSlot: 'scheduled', availableDate: 'not-a-date', orderIndex: 3 }),
  ];

  const buckets = buildTimelineCourseBuckets(items, NOW);
  assert.deepEqual(buckets.map(bucket => bucket.id), ['past', 'current', 'future']);
  assert.deepEqual(buckets[0].items.map(item => item.id), ['past-scheduled', 'past-explicit']);
  assert.deepEqual(buckets[1].items.map(item => item.id), ['current-scheduled', 'current-explicit']);
  assert.deepEqual(buckets[2].items.map(item => item.id), ['future-scheduled', 'future-explicit', 'future-malformed']);
});

test('one shared page model covers timeline, sequential, and every renderable custom resource', () => {
  const deleted = content({ id: 'deleted', title: 'Deleted', deletedAt: NOW });
  const timeline = buildCoursePresentationBuckets([
    content({ id: 'past', title: 'Past', presentationSlot: 'past' }),
    content({ id: 'current', title: 'Current' }),
    content({ id: 'future', title: 'Future', presentationSlot: 'future' }),
    deleted,
  ], 'timeline', NOW);
  assert.deepEqual(timeline.map(bucket => bucket.items.map(item => item.id)), [['past'], ['current'], ['future']]);

  const sequential = buildCoursePresentationBuckets([
    content({ id: 'module', title: 'Module', category: 'admin', presentationSlot: 'block-header', groupIcon: 'module' }),
    content({ id: 'child', title: 'Child', groupIcon: 'module' }),
    deleted,
  ], 'sequential', NOW);
  assert.deepEqual(sequential.map(bucket => [bucket.id, bucket.items.map(item => item.id)]), [['module', ['child']]]);

  const custom = buildCoursePresentationBuckets([
    content({ id: 'custom-link', title: 'Full course site', category: 'admin', orderIndex: 2, contentUrl: 'https://course.example.edu/', metadata: { lmsContentType: 'custom', lmsCustomWidgetKind: 'link' } }),
    content({ id: 'custom-static', title: 'Static panel', category: 'admin', orderIndex: 1, description: JSON.stringify({ isCustomWidget: true, html: '<main>Course</main>' }) }),
    content({ id: 'ordinary-admin', title: 'Ordinary admin link', category: 'admin', contentUrl: 'https://example.edu/syllabus', description: 'Read the syllabus.' }),
    deleted,
  ], 'custom', NOW);
  assert.deepEqual(custom.map(bucket => [bucket.id, bucket.items[0].id]), [
    ['custom:custom-static', 'custom-static'],
    ['custom:custom-link', 'custom-link'],
  ]);
});

test('the shared page model feeds horizontal mode for all presentations while mobile stays full-width vertical', async () => {
  const [feedSource, courseSource] = await Promise.all([
    readFile(new URL('../src/components/lms/StudentFeed.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/admin/course/[id]/index.tsx', import.meta.url), 'utf8'),
  ]);
  const pageModel = feedSource.indexOf('buildCoursePresentationBuckets(');
  const horizontalRenderer = feedSource.indexOf("if (viewMode === 'horizontal')", pageModel);
  assert.ok(pageModel >= 0 && horizontalRenderer > pageModel, 'All modes must build pages before the orientation renderer branches.');
  assert.match(feedSource.slice(horizontalRenderer), /buckets\.map\(renderBucket\)/);
  assert.match(courseSource, /Platform\.OS === 'web' && windowWidth >= 768/);
  assert.match(courseSource, /const effectiveViewMode = supportsLayoutControls && !isSingleEmbeddedSiteCourse \? viewMode : 'vertical'/);
  assert.match(courseSource, /const showViewModeToggle = supportsLayoutControls && isPresentationView && !isSingleEmbeddedSiteCourse/);
  assert.match(courseSource, /presentationMode=\{course\.presentationMode\}/);
  assert.match(courseSource, /viewMode=\{effectiveViewMode\}/);
  assert.match(courseSource, /accessibilityLabel="Back to courses"/);
  assert.doesNotMatch(courseSource, /Back to Admin Dashboard/);
  assert.match(courseSource, /<Text accessibilityRole="header" style=\{\[styles\.title/);
});
