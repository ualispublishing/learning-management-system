import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getCourseVideoAlternatives, getCourseVideoAsset } from '../src/lib/coursePresentation';
import {
  areVideoCaptionTracksBoundToAsset,
  buildCourseVideoAlternatives,
  MAX_VIDEO_CAPTION_TRACKS,
  MAX_VIDEO_TRANSCRIPT_CHARACTERS,
  validateCourseVideoAlternatives,
} from '../src/lib/videoAlternatives';
import { ContentItem } from '../src/types/lms';

const videoItem = (updates: Partial<ContentItem> = {}): ContentItem => ({
  id: 'video-1',
  courseId: 'course-1',
  category: 'material',
  title: 'Captioned lecture',
  presentationSlot: 'current',
  createdAt: 1,
  metadata: {
    asset: {
      id: 'asset-video-1',
      name: 'lecture.mp4',
      mimeType: 'video/mp4',
      url: 'https://media.example.edu/lecture.mp4',
    },
  },
  ...updates,
});

test('video alternatives normalize bounded HTTPS WebVTT captions and an adjacent transcript', () => {
  const result = validateCourseVideoAlternatives({
    captionTracks: [{
      url: 'https://media.example.edu/lecture-en.vtt',
      language: 'en-CA',
      label: 'English captions',
      format: 'text/vtt',
      isDefault: true,
    }],
    transcript: {
      text: 'Speaker: Welcome to the lecture.',
      url: 'https://media.example.edu/lecture-transcript.html',
      label: 'Full transcript',
    },
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data?.captionTracks?.[0].url, 'https://media.example.edu/lecture-en.vtt');
  assert.equal(result.data?.transcript?.text, 'Speaker: Welcome to the lecture.');
  assert.equal(areVideoCaptionTracksBoundToAsset(result.data, 'https://media.example.edu/lecture.mp4'), true);
  assert.equal(areVideoCaptionTracksBoundToAsset(result.data, 'https://different.example.edu/lecture.mp4'), false);
});

test('video alternative validation fails closed on unsafe, ambiguous, or unbounded authoring data', () => {
  const invalid = [
    { captionTracks: [{ url: 'http://media.example.edu/a.vtt', language: 'en', label: 'English', format: 'text/vtt' }] },
    { captionTracks: [{ url: 'https://user:secret@media.example.edu/a.vtt', language: 'en', label: 'English', format: 'text/vtt' }] },
    { captionTracks: [{ url: 'https://media.example.edu/a.vtt', language: 'not a tag', label: 'English', format: 'text/vtt' }] },
    { captionTracks: [{ url: 'https://media.example.edu/a.srt', language: 'en', label: 'English', format: 'text/srt' }] },
    { captionTracks: Array.from({ length: MAX_VIDEO_CAPTION_TRACKS + 1 }, (_, index) => ({ url: `https://media.example.edu/${index}.vtt`, language: 'en', label: `Track ${index}`, format: 'text/vtt' })) },
    { transcript: { text: 'x'.repeat(MAX_VIDEO_TRANSCRIPT_CHARACTERS + 1) } },
    { transcript: { label: 'Transcript without content' } },
    { captionTracks: [
      { url: 'https://media.example.edu/a.vtt', language: 'en', label: 'A', format: 'text/vtt', isDefault: true },
      { url: 'https://media.example.edu/b.vtt', language: 'fr', label: 'B', format: 'text/vtt', isDefault: true },
    ] },
  ];
  invalid.forEach(value => assert.equal(validateCourseVideoAlternatives(value).success, false, JSON.stringify(value).slice(0, 200)));
  assert.throws(() => buildCourseVideoAlternatives({ transcriptLabel: 'Label only' }), /Provide transcript text/);
});

test('learner projection exposes only validated alternatives on a recognized video asset', () => {
  const alternatives = buildCourseVideoAlternatives({
    captionTracks: [{ url: 'https://media.example.edu/en.vtt', language: 'en', label: 'English', format: 'text/vtt' }],
    transcriptText: 'A reviewed transcript.',
  });
  const item = videoItem({ videoAlternatives: alternatives });
  assert.ok(getCourseVideoAsset(item));
  assert.equal(getCourseVideoAlternatives(item)?.transcript?.text, 'A reviewed transcript.');
  assert.equal(getCourseVideoAlternatives({ ...item, metadata: undefined }), null);
  assert.equal(getCourseVideoAlternatives({ ...item, videoAlternatives: { transcript: { url: 'javascript:alert(1)' } } }), null);
});

test('shared authoring and presentation sources preserve accessible media controls without autoplay', async () => {
  const [feed, creator, manager] = await Promise.all([
    readFile(new URL('../src/components/lms/StudentFeed.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/lms/shared/UnifiedContentCreator.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/lms/shared/BaseContentManager.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(feed, /React\.createElement\('track',[\s\S]*?kind: 'captions'/);
  assert.match(feed, /accessibilityLabel={`Accessible media alternatives/);
  assert.match(feed, /selectable style=\{\[styles\.videoTranscriptText/);
  assert.match(feed, /instance\.pause\(\)/);
  assert.match(feed, /contentType: isCourseHlsAsset\(asset\) \? 'hls' : 'auto'/);
  assert.match(feed, /External WebVTT files open separately on this device/);
  assert.doesNotMatch(feed, /\bautoPlay\s*[:=]/);
  assert.match(creator, /Video accessibility alternatives/);
  assert.match(creator, /same HTTPS origin as the video/);
  assert.match(creator, /does not verify its accuracy or synchronization/);
  assert.match(manager, /videoAlternatives,/);
  assert.match(manager, /getCourseVideoAlternatives\(item\)/);
  assert.match(manager, /videoAlternatives\?\.captionTracks/);
});
