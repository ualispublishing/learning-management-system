import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readPackage = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as {
  version?: string;
  dependencies?: Record<string, string>;
};

test('installed linkify-it stays on the markdown-it compatible major', () => {
  const markdownIt = readPackage('node_modules/markdown-it/package.json');
  const linkifyIt = readPackage('node_modules/linkify-it/package.json');
  const supportedRange = markdownIt.dependencies?.['linkify-it'];

  assert.match(supportedRange ?? '', /^\^5\./);
  assert.match(linkifyIt.version ?? '', /^5\./);
});
