import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path: string) => readFile(path, 'utf8');

test('web editor feedback remains rendered and non-blocking', async () => {
  const [cardEditor, importExport] = await Promise.all([
    source('src/components/editor/CardEditor.tsx'),
    source('src/components/editor/ImportExport.tsx'),
  ]);

  assert.match(cardEditor, /setRecordingStatus\('Unavailable on web:/);
  assert.match(cardEditor, /accessibilityRole="alert"[\s\S]{0,180}\{recordingStatus\}/);
  assert.doesNotMatch(cardEditor, /Alert\.alert\('Unavailable on web'/);

  assert.match(importExport, /if \(Platform\.OS === 'web'\) \{\s*setStatus/);
  assert.match(importExport, /reportResult\('Export ready'/);
  assert.match(importExport, /reportResult\('Import failed'/);
  assert.match(importExport, /accessibilityLiveRegion=\{status\.kind === 'success'/);
  assert.match(importExport, /accessibilityRole=\{status\.kind === 'error'/);
  assert.doesNotMatch(importExport, /Alert\.alert\('Export ready'/);
});

test('demo cards include filterable subject and alternating tags', async () => {
  const seed = await source('src/lib/db/seed.ts');

  assert.match(seed, /tags: \[data\.deck\.name\.toLocaleLowerCase\(\), cardIndex % 2 === 0 \? 'core' : 'applied'\]/);
});

test('course content editing uses edit-specific copy and readable custom summaries', async () => {
  const [creator, manager, timeline] = await Promise.all([
    source('src/components/lms/shared/UnifiedContentCreator.tsx'),
    source('src/components/lms/shared/BaseContentManager.tsx'),
    source('src/components/lms/TimelineManager.tsx'),
  ]);

  assert.match(manager, /isEditing=\{!!editingItemId\}/);
  assert.match(creator, /isEditing \? 'Edit course content'/);
  assert.match(creator, /isEditing \? 'Save course content changes'/);
  assert.match(creator, /isEditing \? 'Save Changes'/);
  assert.match(timeline, /return 'Custom code block'/);
});
