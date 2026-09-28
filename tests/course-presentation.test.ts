import assert from 'node:assert/strict';
import test from 'node:test';
import { getCoursePresentationAsset, getCourseSitePresentationMode, getCourseVideoAsset, isCustomCoursePresentationItem } from '../src/lib/coursePresentation';
import { ContentItem } from '../src/types/lms';

const item = (metadata?: Record<string, unknown>): ContentItem => ({
  id: 'content-1',
  courseId: 'course-1',
  category: 'material',
  title: 'Lecture',
  presentationSlot: 'current',
  createdAt: 1,
  metadata,
});

test('course media requires a complete institution asset record', () => {
  assert.equal(getCoursePresentationAsset(item({ asset: { url: 'https://cdn.example.edu/video.mp4', mimeType: 'video/mp4' } })), null);
  assert.equal(getCoursePresentationAsset(item({ asset: { id: 'asset-1', name: 'video.mp4', url: 'http://cdn.example.edu/video.mp4', mimeType: 'video/mp4' } })), null);
});

test('institution video assets are recognized and normalized', () => {
  const source = item({ asset: {
    id: 'asset-1',
    name: 'Lecture.mp4',
    url: 'https://cdn.example.edu/video.mp4',
    mimeType: 'VIDEO/MP4',
    size: 1_024,
  } });
  assert.equal(getCourseVideoAsset(source)?.mimeType, 'video/mp4');
  assert.equal(getCourseVideoAsset(source)?.url, 'https://cdn.example.edu/video.mp4');

  const hls = item({ asset: {
    id: 'asset-hls-1',
    name: 'lecture.m3u8',
    url: 'https://cdn.example.edu/lecture.m3u8',
    mimeType: 'application/vnd.apple.mpegurl',
  } });
  assert.equal(getCourseVideoAsset(hls)?.mimeType, 'application/vnd.apple.mpegurl');
});

test('course-site presentation defaults legacy links to embedded and honors external mode', () => {
  assert.equal(getCourseSitePresentationMode(item()), 'embedded');
  assert.equal(getCourseSitePresentationMode(item({ lmsEmbedMode: 'embedded' })), 'embedded');
  assert.equal(getCourseSitePresentationMode(item({ lmsEmbedMode: 'external' })), 'external');
  assert.equal(getCourseSitePresentationMode(item({ lmsEmbedMode: 'anything-else' })), 'embedded');
});

test('custom course mode does not promote ordinary admin links into a full-course site', () => {
  const adminItem = (overrides: Partial<ContentItem>): ContentItem => ({
    ...item(),
    category: 'admin',
    ...overrides,
  });
  assert.equal(isCustomCoursePresentationItem(adminItem({ contentUrl: 'https://example.edu/syllabus', description: 'Read the syllabus.' })), false);
  assert.equal(isCustomCoursePresentationItem(adminItem({ contentUrl: 'https://example.edu/course', metadata: { lmsContentType: 'custom', lmsCustomWidgetKind: 'link' } })), true);
  assert.equal(isCustomCoursePresentationItem(adminItem({ description: JSON.stringify({ isCustomWidget: true, html: '<h1>Course</h1>' }) })), true);
  assert.equal(isCustomCoursePresentationItem(adminItem({ description: JSON.stringify({ unrelated: true }) })), false);
});
