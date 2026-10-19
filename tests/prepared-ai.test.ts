import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHttpJsonAIProvider, runAIProvider, sha256, type AIProviderRequest } from '../src/lib/ai/providerAdapter.server';
import { createPreparedAIDemo } from '../src/lib/testing/preparedAIDemoServer';
import { listenSharedDemoServer } from '../src/lib/testing/sharedDemoServer';
import { FLASHCARD_PROMPT_VERSION, SYLLABUS_PROMPT_VERSION } from '../src/lib/ai/prompts';
import { InstitutionAIService, validateCards } from '../src/lib/ai/service';

const root = path.resolve('demo/ai');
const source = { text: 'An algorithm has a way to stop.', segments: [{ location: 'Page 1', text: 'An algorithm has a way to stop.' }] };
const card = { front: 'What must an algorithm have to end?', back: 'A way to stop.', sourceExcerpt: source.text, sourceLocation: 'Page 1', confidence: 1 };

test('the browser AI transport preserves the global fetch receiver', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async function(this: unknown) {
      assert.equal(this, globalThis, 'WebKit rejects a class instance as the fetch receiver');
      return Response.json({ cards: [card], provenance: { promptVersion: FLASHCARD_PROMPT_VERSION, evidenceVerified: true, sourceSha256: sha256(source.text) } });
    };
    const service = new InstitutionAIService({ baseUrl: 'http://127.0.0.1:4180' });
    assert.equal((await service.generateFlashcards({ sourceText: source.text }))[0].back, card.back);
  } finally { globalThis.fetch = originalFetch; }
});

test('two different HTTP provider protocols produce the same validated draft without exposing credentials to the app', async () => {
  for (const protocol of ['messages', 'prediction']) {
    let encoded: Record<string, unknown> | undefined;
    const provider = createHttpJsonAIProvider({
      id: `institution-${protocol}`, endpoint: 'https://institution.example/model',
      headers: async () => ({ authorization: 'Bearer server-test-key' }),
      encode: (request: AIProviderRequest) => protocol === 'messages' ? { messages: [{ role: 'system', content: request.systemPrompt }, { role: 'user', content: request.source.text }], schema: request.responseSchema } : { input: request.source, instructions: request.systemPrompt, parameters: { schema: request.responseSchema } },
      decode: response => protocol === 'messages' ? JSON.parse((response as { message: { content: string } }).message.content) : (response as { prediction: unknown }).prediction,
      fetchImpl: async (_url, options) => {
        assert.equal(options?.redirect, 'error'); assert.ok(options?.signal);
        assert.equal((options?.headers as Record<string, string>).authorization, 'Bearer server-test-key');
        encoded = JSON.parse(String(options?.body));
        return Response.json(protocol === 'messages' ? { message: { content: JSON.stringify({ cards: [card] }) } } : { prediction: { cards: [card] } });
      },
    });
    const result = await runAIProvider(provider, 'flashcards', { sourceText: source.text }, source, 'provider-test');
    assert.ok(encoded && (protocol === 'messages' ? encoded.messages : encoded.input));
    const checked = validateCards(result, { sourceText: source.text });
    assert.equal(checked[0].reviewerVerified, false);
    assert.equal(checked[0].provenance?.sourceSha256, sha256(source.text));
    assert.equal(checked[0].provenance?.model, provider.id);
    assert.equal(JSON.stringify(result).includes('server-test-key'), false);
  }
});

test('provider boundary rejects invented locations, quotes, approval, provenance, extra fields and excessive cards', async () => {
  for (const invalid of [
    { cards: [{ ...card, sourceLocation: 'Page 2' }] },
    { cards: [{ ...card, sourceExcerpt: 'Made up evidence.' }] },
    { cards: [{ ...card, reviewerVerified: true }] },
    { cards: [card], provenance: {} },
    { cards: [card], secret: true },
    { cards: [card, { ...card, front: 'A second question?' }] },
  ]) await assert.rejects(() => runAIProvider({ id: 'untrusted', generate: async () => invalid }, 'flashcards', { sourceText: source.text, requestedCardCount: 1 }, source, 'test'));
});

test('HTTP adapters reject unsafe endpoints, non-JSON, oversized output and sanitize upstream errors', async () => {
  const config = { id: 'test', encode: () => ({}), decode: (value: unknown) => value };
  for (const endpoint of ['http://remote.example/ai', 'https://user:secret@remote.example/ai', 'https://remote.example/#secret']) assert.throws(() => createHttpJsonAIProvider({ ...config, endpoint }));
  for (const [response, message] of [
    [new Response('secret upstream data', { status: 500 }), /failed \(500\)/],
    [new Response('text only'), /must return JSON/],
    [Response.json({ output: 'x'.repeat(2_000_001) }), /exceeds 2 MB/],
  ] as const) {
    const provider = createHttpJsonAIProvider({ ...config, endpoint: 'https://example.test/model', fetchImpl: async () => response });
    await assert.rejects(() => runAIProvider(provider, 'flashcards', {}, source, 'test'), message);
  }
});

test('prepared HTTP flow accepts every bundled format, renamed bytes and bounded counts, and retains exactly those sources', async () => {
  const server = await listenSharedDemoServer({ port: 0, handlePreparedAI: await createPreparedAIDemo(root) });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    const catalog = await fetch(`${base}/demo-ai/catalog`).then(r => r.json()) as { entries: { id: string; captionSha256?: string }[] };
    assert.equal(catalog.entries.length, 6);
    assert.ok(catalog.entries.find(entry => entry.id === 'lecture-video')?.captionSha256);
    for (const entry of manifest.entries) {
      const preview = await fetch(`${base}/demo-ai/source/${entry.sha256}`).then(r => r.json());
      assert.equal(preview.documentSha256, entry.sha256);
      assert.ok(preview.text.length > 0 && preview.segments.length > 0);
      assert.equal(preview.result, undefined, 'source preview does not reveal results before processing');
      const bytes = await readFile(path.join(root, entry.source));
      const form = new FormData(); form.append('document', new Blob([bytes]), `renamed-${entry.name}`);
      form.append('task', entry.task); form.append('sourceKind', entry.kind); form.append('requestedCardCount', '3'); form.append('locale', 'en');
      form.append('promptVersion', entry.task === 'syllabus' ? SYLLABUS_PROMPT_VERSION : FLASHCARD_PROMPT_VERSION);
      const response = await fetch(`${base}/lms/v1/ai/generate`, { method: 'POST', body: form, headers: { 'x-request-id': 'known-file-test' } });
      const output = await response.json() as { cards?: typeof card[]; termStart?: string; gradingWeights?: object; evidence?: unknown[]; provenance: { documentSha256: string; model: string; preparedGeneration: { model: string; recordSha256: string } } };
      assert.equal(response.status, 200, JSON.stringify(output));
      assert.equal(output.provenance.documentSha256, entry.sha256);
      assert.equal(output.provenance.model, 'prepared-demo/v1');
      assert.equal(output.provenance.preparedGeneration.model, 'gpt-6-astra');
      assert.equal(output.provenance.preparedGeneration.recordSha256, manifest.generation.recordSha256);
      if (entry.task === 'flashcards') { assert.equal(output.cards?.length, 3); assert.equal(validateCards(output, { document: { uri: 'file:///test', name: entry.name }, requestedCardCount: 3 })[0].reviewerVerified, false); }
      else { assert.equal(output.termStart, undefined); assert.equal(output.gradingWeights, undefined); assert.equal(output.evidence?.length, 36); }
      const retain = new FormData(); retain.append('asset', new Blob([bytes]), entry.name);
      const stored = await fetch(`${base}/demo-ai/retain`, { method: 'POST', body: retain }).then(r => r.json()) as { url: string; sha256: string };
      assert.equal(stored.sha256, entry.sha256); assert.equal(stored.url, `https://prepared-demo.invalid/files/${entry.sha256}`);
      const range = await fetch(`${base}/demo-ai/files/${entry.sha256}`, { headers: { range: 'bytes=0-31' } });
      assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), `bytes 0-31/${bytes.length}`);
      assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 32));
    }
    const unrelated = new FormData(); unrelated.append('document', new Blob(['changed source bytes']), 'mit-6.0001-syllabus.txt');
    const rejected = await fetch(`${base}/lms/v1/ai/generate`, { method: 'POST', body: unrelated });
    assert.equal(rejected.status, 400); assert.match(await rejected.text(), /No prepared result matches/);
    const first = manifest.entries[0];
    for (const overrides of [{ task: 'flashcards' }, { sourceKind: 'audio' }, { locale: 'fr' }, { promptVersion: 'old-version' }, { sourceText: 'additional material' }, { requestedCardCount: '0' }]) {
      const form = new FormData(); form.append('document', new Blob([await readFile(path.join(root, first.source))]), first.name);
      for (const [key, value] of Object.entries({ task: 'syllabus', sourceKind: 'document', locale: 'en', promptVersion: SYLLABUS_PROMPT_VERSION, ...overrides })) form.append(key, value);
      const rejected = await fetch(`${base}/lms/v1/ai/generate`, { method: 'POST', body: form, headers: { 'x-request-id': 'invalid-fields' } }); assert.equal(rejected.status, 400);
    }
    assert.equal((await fetch(`${base}/demo-ai/catalog`, { headers: { origin: 'https://unrelated.example' } })).status, 403);
    assert.equal((await fetch(`${base}/demo-ai/source/${first.sha256}`, { headers: { origin: 'https://unrelated.example' } })).status, 403);
    assert.equal((await fetch(`${base}/demo-ai/files/${first.sha256}`, { headers: { range: 'bytes=99999999-' } })).status, 416);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('startup refuses modified extracted text or reference output rather than reporting a passed check', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'lms-prepared-test-'));
  try {
    await cp(root, temp, { recursive: true });
    const file = path.join(temp, 'extracted/syllabus.json'); const original = await readFile(file);
    await writeFile(file, '{"text":"tampered"}');
    await assert.rejects(() => createPreparedAIDemo(temp), /source\/result changed/);
    await writeFile(file, original);
    await writeFile(path.join(temp, 'reference/syllabus.json'), '{}');
    await assert.rejects(() => createPreparedAIDemo(temp), /does not match the reviewed reference/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('generation attribution records source enrichment and rejects metadata drift', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const recordBytes = await readFile(path.join(root, manifest.generation.record));
  const record = JSON.parse(recordBytes.toString());
  assert.equal(sha256(recordBytes), manifest.generation.recordSha256);
  assert.equal(record.generation.model, 'gpt-6-astra');
  assert.equal(record.generation.reasoningEffort, 'xhigh');
  assert.equal(record.modelEvidence.inheritedConversation, false);
  assert.equal(record.apiResponseId, null);
  assert.equal(record.apiEquivalenceVerified, false);
  assert.equal(record.independentInstructorApproval, false);
  assert.equal(sha256(await readFile(path.join(root, record.request.path))), record.request.sha256);
  for (const file of record.files) {
    if (file.id === 'syllabus') {
      const original = JSON.parse(await readFile(path.join(root, file.candidate), 'utf8'));
      const enriched = JSON.parse(await readFile(path.join(root, file.result), 'utf8'));
      const source = JSON.parse(await readFile(path.join(root, file.extracted), 'utf8'));
      assert.equal(enriched.evidence.length, original.evidence.length + 8);
      assert.equal(file.editsAfterGeneration[0].method, 'Exact source copy');
      for (const [key, value] of Object.entries(original)) {
        assert.deepEqual(key === 'evidence' ? enriched.evidence.slice(0, original.evidence.length) : enriched[key], value);
      }
      for (const entry of enriched.evidence.slice(original.evidence.length)) {
        assert.ok(source.segments.some((segment: { location: string; text: string }) => segment.location === entry.sourceLocation && segment.text.includes(entry.sourceExcerpt)));
      }
    } else {
      assert.deepEqual(await readFile(path.join(root, file.candidate)), await readFile(path.join(root, file.result)));
      assert.deepEqual(file.editsAfterGeneration, []);
    }
  }
  const temp = await mkdtemp(path.join(tmpdir(), 'lms-generation-test-'));
  try {
    await cp(root, temp, { recursive: true });
    await writeFile(path.join(temp, 'manifest.json'), JSON.stringify({ ...manifest, generation: { ...manifest.generation, model: 'unverified-model' } }));
    await assert.rejects(() => createPreparedAIDemo(temp), /attribution does not match/);
    await writeFile(path.join(temp, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(path.join(temp, manifest.generation.record), '{}');
    await assert.rejects(() => createPreparedAIDemo(temp), /generation record changed/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('expanded syllabus fields require indexed evidence and enforce schema bounds', async () => {
  const result = JSON.parse(await readFile(path.join(root, 'results/syllabus.json'), 'utf8'));
  const extracted = JSON.parse(await readFile(path.join(root, 'extracted/syllabus.json'), 'utf8'));
  for (const invalid of [
    { ...result, evidence: result.evidence.filter((entry: { field: string }) => entry.field !== 'learningObjectives[1]') },
    { ...result, evidence: result.evidence.filter((entry: { field: string }) => entry.field !== 'courseCode') },
    { ...result, meetingTimes: [17] },
    { ...result, learningObjectives: Array(51).fill('Unsupported objective') },
    { ...result, courseDuration: 'x'.repeat(301) },
    { ...result, officeAccessGranted: true },
  ]) {
    await assert.rejects(() => runAIProvider({ id: 'schema-test', generate: async () => invalid }, 'syllabus', { sourceText: extracted.text }, extracted, 'expanded-fields-test'));
  }
});
