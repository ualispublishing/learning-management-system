import assert from 'node:assert/strict';
import test from 'node:test';
import { appendMultipartAsset, validateMultipartAssetBytes } from '../src/lib/integration/multipartAsset';

test('browser multipart uploads append the selected bytes instead of a URI object string', async () => {
  const file = new Blob(['real browser bytes'], { type: 'text/plain' });
  const asset = { uri: 'blob:https://example.edu/source', name: 'source.txt', mimeType: 'text/plain', size: file.size, file };
  validateMultipartAssetBytes(asset, 1_000);
  const form = new FormData();
  appendMultipartAsset(form, 'asset', asset);
  const appended = form.get('asset');
  assert.ok(appended instanceof Blob);
  assert.equal(await appended.text(), 'real browser bytes');
});

test('browser multipart validation rejects changed size and MIME metadata', () => {
  const file = new Blob(['bytes'], { type: 'text/plain' });
  assert.throws(() => validateMultipartAssetBytes({
    uri: 'blob:https://example.edu/source', name: 'source.txt', mimeType: 'text/plain', size: file.size + 1, file,
  }, 1_000), /size changed/);
  assert.throws(() => validateMultipartAssetBytes({
    uri: 'blob:https://example.edu/source', name: 'source.pdf', mimeType: 'application\/pdf', size: file.size, file,
  }, 1_000), /does not match/);
});
