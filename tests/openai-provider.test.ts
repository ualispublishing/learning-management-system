import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { createOpenAIResponsesProvider } from '../src/lib/ai/openaiProvider.server';
import { createHttpJsonAIProvider, runAIProvider, sha256, type AIProviderReceipt } from '../src/lib/ai/providerAdapter.server';
import { FLASHCARD_PROMPT_VERSION, FLASHCARD_SYSTEM_PROMPT, SYLLABUS_RESPONSE_SCHEMA } from '../src/lib/ai/prompts';
import { validateCards, validateInstitutionSyllabusResult } from '../src/lib/ai/service';

const source = { text: 'An algorithm has a way to stop.', segments: [{ location: 'Page 1', text: 'An algorithm has a way to stop.' }] };
const card = { front: 'What must an algorithm have to end?', back: 'A way to stop.', sourceExcerpt: source.text, sourceLocation: 'Page 1', confidence: 1, tags: null };
const config = { model: 'institution-selected-model', maxOutputTokens: 8000, getApiKey: async () => 'synthetic-test-key' };
const message = (payload: unknown) => ({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(payload) }] });
const envelope = (payload: unknown, extra: Record<string, unknown> = {}) => ({
  id: 'resp_test', model: 'reported-model-snapshot', status: 'completed',
  output: [{ type: 'reasoning', summary: [] }, message(payload)], usage: { input_tokens: 120, output_tokens: 45 }, ...extra,
});
const providerFor = (payload: unknown) => createOpenAIResponsesProvider({ ...config, fetchImpl: async () => Response.json(envelope(payload)) });

test('OpenAI sends the authoritative prompt, located source and strict schema, then records real envelope attribution', async () => {
  let receipt: AIProviderReceipt | undefined;
  let bodyHash = '';
  const provider = createOpenAIResponsesProvider({ ...config, reasoningEffort: 'xhigh', fetchImpl: async (url, options) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.method, 'POST');
    assert.equal((options?.headers as Record<string, string>).authorization, 'Bearer synthetic-test-key');
    const body = JSON.parse(String(options?.body)); bodyHash = sha256(String(options?.body));
    assert.equal(body.model, config.model);
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 8000);
    assert.deepEqual(body.reasoning, { effort: 'xhigh' });
    assert.ok(body.instructions.startsWith(FLASHCARD_SYSTEM_PROMPT));
    assert.equal(body.input[0].role, 'user');
    assert.deepEqual(JSON.parse(body.input[0].content[0].text), { task: 'flashcards', locale: 'fr', requestedCardCount: 1, courseTitle: 'Algorithms', source });
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.properties.cards.maxItems, 1);
    const fields = body.text.format.schema.properties.cards.items;
    assert.equal(fields.additionalProperties, false);
    assert.deepEqual(fields.required, ['front', 'back', 'sourceExcerpt', 'sourceLocation', 'confidence', 'tags']);
    assert.equal(fields.properties.sourceLocation.type, 'string');
    assert.equal(fields.properties.tags.anyOf[1].type, 'null');
    assert.equal(body.tools, undefined);
    return Response.json(envelope({ cards: [card] }), { headers: { 'x-request-id': 'req_http' } });
  } });
  const result = await runAIProvider(provider, 'flashcards', { sourceText: source.text, courseTitle: 'Algorithms', requestedCardCount: 1, locale: 'fr' }, source, 'gateway-1', { onReceipt: value => { receipt = value; } });
  const checked = validateCards(result, { sourceText: source.text });
  assert.equal(checked[0].reviewerVerified, false);
  assert.equal(checked[0].tags, undefined);
  assert.equal(result.provenance.model, 'reported-model-snapshot');
  assert.deepEqual(receipt, { model: 'reported-model-snapshot', responseId: 'resp_test', httpRequestId: 'req_http', reasoningEffort: 'xhigh', requestSha256: bodyHash, inputTokens: 120, outputTokens: 45, providerId: `openai/${config.model}`, requestId: 'gateway-1', task: 'flashcards', promptVersion: FLASHCARD_PROMPT_VERSION, sourceSha256: sha256(source.text), documentSha256: undefined, outputSha256: sha256(JSON.stringify(result)) });
  assert.equal(JSON.stringify({ result, receipt }).includes('synthetic-test-key'), false);
});

test('OpenAI syllabus nulls preserve missing fields while ordered grading entries keep indexed evidence', async () => {
  const text = 'Computing. Exam 60%. Labs 40%. Session 1: Algorithms.';
  const inputSource = { text, segments: [{ location: 'Syllabus', text }] };
  const syllabus = { ...Object.fromEntries(Object.keys(SYLLABUS_RESPONSE_SCHEMA.properties).map(key => [key, null])), title: 'Computing', gradingWeights: [{ category: 'Exam', weight: 60 }, { category: 'Labs', weight: 40 }], schedule: [{ topic: 'Algorithms', date: null }], warnings: ['Term dates are not supplied.'], evidence: [
    { field: 'title', sourceExcerpt: 'Computing.', sourceLocation: 'Syllabus' },
    { field: 'gradingWeights[0]', sourceExcerpt: 'Exam 60%.', sourceLocation: 'Syllabus' },
    { field: 'gradingWeights[1]', sourceExcerpt: 'Labs 40%.', sourceLocation: 'Syllabus' },
    { field: 'schedule[0]', sourceExcerpt: 'Session 1: Algorithms.', sourceLocation: 'Syllabus' },
  ] };
  const provider = createOpenAIResponsesProvider({ ...config, fetchImpl: async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    const schema = body.text.format.schema;
    assert.equal(schema.$schema, undefined);
    assert.deepEqual(schema.required, Object.keys(SYLLABUS_RESPONSE_SCHEMA.properties));
    assert.equal(schema.properties.gradingWeights.anyOf[0].type, 'array');
    assert.equal(schema.properties.gradingWeights.anyOf[0].items.additionalProperties, false);
    assert.match(body.instructions, /gradingWeights\[0\]/);
    return Response.json(envelope(syllabus));
  } });
  const result = await runAIProvider(provider, 'syllabus', { sourceText: text }, inputSource, 'syllabus-1');
  const checked = validateInstitutionSyllabusResult(result, { sourceText: text });
  assert.equal(checked.termStart, undefined);
  assert.equal(checked.description, undefined);
  assert.deepEqual(checked.gradingWeights, { Exam: 60, Labs: 40 });
  assert.deepEqual(checked.schedule, [{ topic: 'Algorithms', date: undefined }]);
  assert.equal(SYLLABUS_RESPONSE_SCHEMA.properties.gradingWeights.type, 'object', 'the application contract is unchanged');
});

test('OpenAI rejects refusals, truncated results, multiple answers and tool outputs without returning upstream text', async () => {
  for (const output of [
    { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    { status: 'failed', error: { message: 'private-upstream-data' } },
    { output: [] },
    { output: [{ ...message({}), status: 'in_progress' }] },
    { output: [{ ...message({}), content: [{ type: 'refusal', refusal: 'private-upstream-data' }] }] },
    { output: [message({ cards: [card] }), message({ cards: [card] })] },
    { output: [{ type: 'function_call', arguments: 'private-upstream-data' }] },
    { output: [{ ...message({}), content: [{ type: 'output_text', text: 'private-upstream-data' }] }] },
    { model: null },
    { usage: { input_tokens: -1, output_tokens: 5 } },
  ]) {
    const provider = createOpenAIResponsesProvider({ ...config, fetchImpl: async () => Response.json(envelope({ cards: [card] }, output)) });
    let recorded = false;
    await assert.rejects(runAIProvider(provider, 'flashcards', {}, source, 'failure', { onReceipt: () => { recorded = true; } }), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes('private-upstream-data'), false);
      return true;
    });
    assert.equal(recorded, false);
  }
});

test('OpenAI output still rejects fabricated evidence, approval and unknown fields including null ones', async () => {
  for (const output of [
    { cards: [{ ...card, sourceLocation: null }] },
    { cards: [{ ...card, sourceExcerpt: 'Invented evidence' }] },
    { cards: [{ ...card, reviewerVerified: true }] },
    { cards: [{ ...card, front: null }] },
    { cards: [card], provenance: null },
    { cards: [card], unknown: null },
    { cards: [card], constructor: null },
    Object.fromEntries([['cards', [card]], ['__proto__', null]]),
  ]) await assert.rejects(runAIProvider(providerFor(output), 'flashcards', {}, source, 'invalid'));
});

test('OpenAI grading conversion rejects ambiguous categories and does not silently overwrite them', async () => {
  for (const entries of [
    [{ category: 'Exam', weight: 60 }, { category: 'exam', weight: 40 }],
    [{ category: '__proto__', weight: 100 }],
    [{ category: '2', weight: 100 }],
    [{ category: 'Exam', weight: 100, ignored: true }],
    { Exam: 100 }, [], [{ category: 'Exam', weight: null }],
  ]) await assert.rejects(runAIProvider(providerFor({ gradingWeights: entries, evidence: [], warnings: [] }), 'syllabus', {}, source, 'invalid-grading'), /grading/);
});

test('OpenAI concurrent requests keep model, response, usage and request receipts isolated', async () => {
  const receipts: AIProviderReceipt[] = [];
  const provider = createOpenAIResponsesProvider({ ...config, fetchImpl: async (_url, options) => {
    const text = JSON.parse(JSON.parse(String(options?.body)).input[0].content[0].text).source.text as string;
    const id = text === source.text ? 'first' : 'second';
    if (id === 'first') await nextTurn();
    return Response.json(envelope({ cards: [{ ...card, sourceExcerpt: text }] }, { id: `resp_${id}`, model: `model_${id}` }));
  } });
  const other = { text: 'An algorithm includes a stopping rule.', segments: [{ location: 'Page 1', text: 'An algorithm includes a stopping rule.' }] };
  const results = await Promise.all([source, other].map((item, i) => runAIProvider(provider, 'flashcards', {}, item, `gateway-${i}`, { onReceipt: value => { receipts.push(value); } })));
  assert.equal(results[0].provenance.model, 'model_first');
  assert.equal(results[1].provenance.model, 'model_second');
  assert.equal(receipts.find(item => item.requestId === 'gateway-0')?.responseId, 'resp_first');
  assert.equal(receipts.find(item => item.requestId === 'gateway-1')?.sourceSha256, sha256(other.text));
});

test('source drafts are snapshotted and receipts hash the actual sent body', async () => {
  const draft = structuredClone(source);
  const input = { sourceText: source.text, courseTitle: 'Original course' };
  let sentHash = '';
  let receipt: AIProviderReceipt | undefined;
  const provider = createOpenAIResponsesProvider({ ...config, fetchImpl: async (_url, options) => {
    sentHash = sha256(String(options?.body));
    const sent = JSON.parse(JSON.parse(String(options?.body)).input[0].content[0].text);
    assert.equal(sent.source.text, source.text);
    assert.equal(sent.source.segments[0].text, source.text);
    assert.equal(sent.courseTitle, 'Original course');
    return Response.json(envelope({ cards: [card] }));
  } });
  const pending = runAIProvider(provider, 'flashcards', input, draft, 'snapshot', { onReceipt: value => { receipt = value; } });
  draft.text = 'Changed after starting.';
  draft.segments[0].text = draft.text;
  input.sourceText = draft.text;
  input.courseTitle = 'Changed course';
  const result = await pending;
  assert.equal(result.provenance.sourceSha256, sha256(source.text));
  assert.equal(receipt?.requestSha256, sentHash);
});

test('provider input bounds fail before a credential read or outbound request', async () => {
  let calls = 0;
  const provider = createOpenAIResponsesProvider({ ...config, getApiKey: async () => { calls += 1; return 'test'; } });
  for (const input of [{ requestedCardCount: 101 }, { requestedCardCount: 0 }, { locale: '' }, { courseTitle: 'a'.repeat(301) }, { document: { uri: 'file:///source', name: 'source.pdf' } }]) await assert.rejects(runAIProvider(provider, 'flashcards', input, source, 'bounded'));
  for (const invalidSource of [ { ...source, segments: [] }, { ...source, segments: [{ location: 'Page 1', text: 'a'.repeat(1_000_001) }] }, { ...source, documentSha256: '' } ]) await assert.rejects(runAIProvider(provider, 'flashcards', {}, invalidSource, 'bounded'));
  assert.equal(calls, 0);
});

test('cancelling during credential lookup prevents a late outbound request and hides the cancellation reason', async () => {
  let resolveKey!: (key: string) => void;
  let calls = 0;
  const controller = new AbortController();
  const provider = createOpenAIResponsesProvider({ ...config, getApiKey: () => new Promise(resolve => { resolveKey = resolve; }), fetchImpl: async () => { calls += 1; return Response.json(envelope({ cards: [card] })); } });
  const result = runAIProvider(provider, 'flashcards', {}, source, 'cancelled', { signal: controller.signal });
  controller.abort('private-caller-data');
  await assert.rejects(result, { name: 'AbortError', message: 'AI generation was cancelled.' });
  resolveKey('test'); await nextTurn();
  assert.equal(calls, 0);
});

test('deadline bounds a stuck SDK and rejects late output before recording a receipt', async () => {
  let resolveOutput!: (value: unknown) => void;
  let recorded = false;
  const provider = { id: 'stuck-sdk', generate: () => new Promise(resolve => { resolveOutput = resolve; }) };
  await assert.rejects(runAIProvider(provider, 'flashcards', {}, source, 'timeout', { timeoutMs: 10, onReceipt: () => { recorded = true; } }), { name: 'TimeoutError' });
  resolveOutput({ cards: [{ ...card, tags: undefined }] }); await nextTurn();
  assert.equal(recorded, false);
});

test('pre-cancelled requests never read credentials, and failed credentials are not retried', async () => {
  let calls = 0;
  const provider = createOpenAIResponsesProvider({ ...config, getApiKey: async () => { calls += 1; throw new Error('private-key-error'); } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runAIProvider(provider, 'flashcards', {}, source, 'already-cancelled', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
  await assert.rejects(runAIProvider(provider, 'flashcards', {}, source, 'credential-failure'), /credentials are unavailable/);
  assert.equal(calls, 1);
});

test('deadline cancels a stalled HTTP body and releases its stream lock', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const provider = createOpenAIResponsesProvider({ ...config, fetchImpl: async () => new Response(stream, { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(runAIProvider(provider, 'flashcards', {}, source, 'stalled', { timeoutMs: 10 }), { name: 'TimeoutError' });
  await nextTurn();
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test('HTTP and credential failures do not expose secrets or upstream bodies', async () => {
  for (const overrides of [
    { getApiKey: async () => { throw new Error('synthetic-test-key'); } },
    { fetchImpl: async () => { throw new Error('synthetic-test-key'); } },
    { fetchImpl: async () => new Response('synthetic-test-key', { status: 429 }) },
    { fetchImpl: async () => new Response('synthetic-test-key', { headers: { 'content-type': 'application/json' } }) },
  ]) await assert.rejects(runAIProvider(createOpenAIResponsesProvider({ ...config, ...overrides }), 'flashcards', {}, source, 'redacted'), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes('synthetic-test-key'), false);
    return true;
  });
});

test('HTTP output limit cancels the stream before decoding and receipt persistence is required when configured', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2_000_001)); }, cancel() { cancelled = true; } });
  const provider = createOpenAIResponsesProvider({ ...config, fetchImpl: async () => new Response(stream, { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(runAIProvider(provider, 'flashcards', {}, source, 'oversized'), /exceeds 2 MB/);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
  await assert.rejects(runAIProvider(providerFor({ cards: [card] }), 'flashcards', {}, source, 'receipt', { onReceipt: async () => { throw new Error('Receipt storage unavailable.'); } }), /Receipt storage unavailable/);
});

test('generic HTTP transport rejects spoofed content types and bounds encoded requests', async () => {
  for (const [encode, fetchImpl, expected] of [
    [() => ({}), async () => new Response('{}', { headers: { 'content-type': 'text/application/json' } }), /must return JSON/],
    [() => 'a'.repeat(8_000_001), async () => { throw new Error('Must not send.'); }, /request exceeds 8 MB/],
  ] as const) {
    const provider = createHttpJsonAIProvider({ id: 'generic', endpoint: 'https://example.test', encode, decode: value => value, fetchImpl });
    await assert.rejects(runAIProvider(provider, 'flashcards', {}, source, 'bounded-http'), expected);
  }
});
