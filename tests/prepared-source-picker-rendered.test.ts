import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import type { AIDocumentAsset } from '../src/lib/ai/types';
import type { PreparedDemoSource } from '../src/lib/ai/preparedDemo';
import { configureAIService } from '../src/lib/ai/service';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:4178/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'ShadowRoot', 'MutationObserver'] as const) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, __DEV__: true, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) });
process.env.EXPO_PUBLIC_LMS_PREPARED_AI_DEMO = '1';
process.env.EXPO_PUBLIC_LMS_SHARED_DEMO_URL = 'http://127.0.0.1:4180';
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native') return nextResolve('react-native-web', context);
    if (specifier === '../../lib/useThemeColors') return { url: 'prepared-picker:theme', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'prepared-picker:theme') return { format: 'module', shortCircuit: true, source: 'export const useThemeColors = () => ({ text:"#111",textSecondary:"#333",primary:"#005fcc",border:"#777",error:"#a00" });' };
    return nextLoad(url, context);
  },
});
let ui: typeof import('@testing-library/react');
let PreparedSourcePicker: typeof import('../src/components/lms/PreparedSourcePicker').PreparedSourcePicker;
const bytes = 'Prepared lecture source';
const sample: PreparedDemoSource = { id: 'lesson', name: 'lesson.txt', title: 'Prepared lecture', mimeType: 'text/plain', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), task: 'flashcards', kind: 'document' };
const originalFetch = globalThis.fetch;
test.before(async () => {
  ui = await import('@testing-library/react');
  ({ PreparedSourcePicker } = await import('../src/components/lms/PreparedSourcePicker'));
});
test.beforeEach(() => {
  globalThis.fetch = async input => String(input).endsWith('/demo-ai/catalog') ? Response.json({ entries: [sample] }) : new Response(bytes);
});
test.afterEach(() => { ui.cleanup(); globalThis.fetch = originalFetch; });
test.after(() => { hooks.deregister(); dom.window.close(); });

test('syllabus drops reject unsupported declared formats before creating an object URL', async () => {
  const originalCreate = URL.createObjectURL;
  let created = 0, selected = 0;
  URL.createObjectURL = blob => { created++; return originalCreate(blob); };
  configureAIService({ sourceProfile: 'text-v1', generateFlashcards: async () => [], extractSyllabus: async () => ({ evidence: [], warnings: [] }) });
  try {
    ui.render(React.createElement(PreparedSourcePicker, { task: 'syllabus', onSelect: () => { selected++; } }));
    const file = new File(['Example PDF bytes'], 'syllabus.pdf', { type: 'application/pdf' });
    ui.fireEvent.drop(ui.screen.getByLabelText('syllabus file drop area'), { dataTransfer: { getData: () => '', files: [file] } });
    await ui.waitFor(() => assert.match(ui.screen.getByRole('alert').textContent ?? '', /TXT or Markdown/));
    assert.equal(created, 0); assert.equal(selected, 0);
  } finally { URL.createObjectURL = originalCreate; configureAIService(null); }
});

test('a prepared library drag carries its source identity through the real drop handler', async () => {
  const selected: { asset: AIDocumentAsset; sample?: PreparedDemoSource }[] = [];
  ui.render(React.createElement(PreparedSourcePicker, { task: 'flashcards', onSelect: (asset, sample) => selected.push({ asset, sample }) }));
  const handle = await ui.screen.findByLabelText('Drag lesson.txt to the drop area');
  const transfer = new Map<string, string>();
  const dataTransfer = { setData: (key: string, value: string) => transfer.set(key, value), getData: (key: string) => transfer.get(key) ?? '', files: [], effectAllowed: 'none' };
  ui.fireEvent.dragStart(handle, { dataTransfer });
  ui.fireEvent.drop(ui.screen.getByLabelText('flashcards file drop area'), { dataTransfer });
  await ui.waitFor(() => assert.equal(selected.length, 1));
  assert.equal(selected[0].sample?.id, sample.id);
  assert.equal(await selected[0].asset.file?.text(), bytes);
});

test('dropping renamed known bytes recovers sample metadata, and multiple files are rejected', async () => {
  const selected: { asset: AIDocumentAsset; sample?: PreparedDemoSource }[] = [];
  ui.render(React.createElement(PreparedSourcePicker, { task: 'flashcards', onSelect: (asset, sample) => selected.push({ asset, sample }) }));
  await ui.screen.findByLabelText('Drag lesson.txt to the drop area');
  const file = new File([bytes], 'renamed.txt', { type: 'text/plain' });
  const drop = ui.screen.getByLabelText('flashcards file drop area');
  ui.fireEvent.drop(drop, { dataTransfer: { getData: () => '', files: [file, file] } });
  assert.match(ui.screen.getByRole('alert').textContent ?? '', /one file at a time/);
  assert.equal(selected.length, 0);
  ui.fireEvent.drop(drop, { dataTransfer: { getData: () => '', files: [file] } });
  await ui.waitFor(() => assert.equal(selected.length, 1));
  assert.equal(selected[0].asset.name, 'renamed.txt');
  assert.equal(selected[0].sample?.id, sample.id);
});

test('replacing a selected source releases the previous file URL, and unmount releases the last one', async () => {
  const selected: AIDocumentAsset[] = [];
  const revoked: string[] = [];
  const originalRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = url => { revoked.push(url); originalRevoke(url); };
  try {
    const view = ui.render(React.createElement(PreparedSourcePicker, { task: 'flashcards', onSelect: asset => selected.push(asset) }));
    const choose = await ui.screen.findByRole('button', { name: 'Use prepared lesson.txt' });
    for (let count = 1; count <= 3; count++) {
      ui.fireEvent.click(choose);
      await ui.waitFor(() => assert.equal(selected.length, count));
      assert.deepEqual(revoked, selected.slice(0, -1).map(asset => asset.uri));
      assert.equal(await selected[count - 1].file?.text(), bytes, 'active source bytes remain available');
    }
    view.unmount();
    assert.deepEqual(revoked, selected.map(asset => asset.uri));
  } finally { ui.cleanup(); URL.revokeObjectURL = originalRevoke; }
});

test('same-tick source selections start only one download', async () => {
  let downloads = 0;
  let complete!: () => void;
  const gate = new Promise<void>(resolve => { complete = resolve; });
  globalThis.fetch = async input => {
    if (String(input).endsWith('/demo-ai/catalog')) return Response.json({ entries: [sample] });
    downloads++; await gate; return new Response(bytes);
  };
  const selected: AIDocumentAsset[] = [];
  ui.render(React.createElement(PreparedSourcePicker, { task: 'flashcards', onSelect: asset => selected.push(asset) }));
  const choose = await ui.screen.findByRole('button', { name: 'Use prepared lesson.txt' });
  await ui.act(async () => { ui.fireEvent.click(choose); ui.fireEvent.click(choose); complete(); });
  await ui.waitFor(() => assert.equal(selected.length, 1));
  assert.equal(downloads, 1);
});
