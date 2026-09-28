import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCardMediaUri, findInvalidCardMediaUris, resolveCardMediaUri } from '../src/lib/cardMedia';

test('card media accepts app-owned filenames and resolves them inside document storage', () => {
  assert.deepEqual(classifyCardMediaUri('audio_123-abc.m4a'), {
    kind: 'local',
    filename: 'audio_123-abc.m4a',
  });
  assert.deepEqual(resolveCardMediaUri('audio_123-abc.m4a', 'file:///app/documents'), {
    kind: 'local',
    uri: 'file:///app/documents/audio_123-abc.m4a',
  });
});

test('card media canonicalizes safe remote HTTPS media and identifies its host', () => {
  assert.deepEqual(classifyCardMediaUri('https://MEDIA.example.edu/path/video.mp4'), {
    kind: 'remote',
    uri: 'https://media.example.edu/path/video.mp4',
    host: 'media.example.edu',
  });
});

test('card media rejects unsafe addresses and device paths', () => {
  for (const uri of [
    'http://example.edu/image.png',
    'javascript:alert(1)',
    'file:///private/data.txt',
    '../private/data.txt',
    'folder/image.png',
    ' image.png',
    'https://user:secret@example.edu/image.png',
  ]) {
    assert.equal(classifyCardMediaUri(uri).kind, 'invalid', uri);
  }
});

test('card media does not resolve a local filename without document storage', () => {
  assert.deepEqual(resolveCardMediaUri('audio.m4a', null), {
    kind: 'invalid',
    reason: 'This local media file is not available on this device.',
  });
});

test('card media validation checks Markdown images and custom media tags', () => {
  assert.deepEqual(
    findInvalidCardMediaUris('![safe](https://cdn.example/image.png) [AUDIO:audio.m4a] [VIDEO:http://tracker.example/video]'),
    ['http://tracker.example/video'],
  );
});
