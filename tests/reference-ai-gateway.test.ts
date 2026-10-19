import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { InstitutionAIService } from '../src/lib/ai/service';
import { createOpenAIResponsesProvider } from '../src/lib/ai/openaiProvider.server';
import { sha256 } from '../src/lib/ai/providerAdapter.server';
import { SYLLABUS_RESPONSE_SCHEMA } from '../src/lib/ai/prompts';
import { createAIGateway } from '../server/ai';
import { fixture, origin } from '../server/tests/helpers/gateway-fixture';

test('actual AI client, authenticated gateway, extractor and OpenAI adapter return reviewable drafts without changing the course', async t => {
  const f = await fixture(); t.after(() => f.close());
  const text = 'Algorithms are finite procedures.';
  let calls = 0;
  // The external HTTP response is synthetic; all local integration layers are real.
  const provider = createOpenAIResponsesProvider({ model: 'configured-model', maxOutputTokens: 2000,
    getApiKey: async () => 'synthetic-key', fetchImpl: async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      const input = JSON.parse(body.input[0].content[0].text);
      assert.equal(input.courseTitle, 'A course'); assert.equal(input.source.text, text);
      const segment = input.source.segments[0];
      const output = input.task === 'flashcards'
        ? { cards: [{ front: 'What are algorithms?', back: 'Finite procedures.', sourceExcerpt: text, sourceLocation: segment.location, confidence: 0.9, tags: null }] }
        : { ...Object.fromEntries(Object.keys(SYLLABUS_RESPONSE_SCHEMA.properties).map(key => [key, null])), title: 'Algorithms', evidence: [{ field: 'title', sourceExcerpt: text, sourceLocation: segment.location }], warnings: ['Term dates were not supplied.'] };
      return Response.json({ id: `resp_${calls}`, model: 'reported-model-snapshot', status: 'completed', usage: { input_tokens: 100, output_tokens: 50 },
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      }, { headers: { 'x-request-id': `req_${calls}` } });
    } });
  const ai = createAIGateway({ origin, auth: f.auth, gateway: f.gateway, provider, policy: { retentionHours: 24, dailyRequestLimit: 10 }, now: () => 1_800_000_000_000 });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin } } });
  t.after(() => { if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window'); });
  const service = new InstitutionAIService({ baseUrl: origin, authentication: 'same-origin-cookie', sourceProfile: 'text-v1', fetchImpl: async (url, init) => {
    assert.equal(init?.credentials, 'same-origin');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), null); assert.equal(headers.get('cookie'), null);
    // Emulate browser-managed headers without exposing cookies to application code.
    headers.set('Cookie', f.cookies['teacher-1']); headers.set('Origin', origin);
    return ai.handle(new Request(url, { ...init, headers }));
  } });
  const snapshot = () => f.handle(new Request(`${origin}/lms/v1/snapshot`, { headers: { Cookie: f.cookies['teacher-1'] } }));
  const before = await snapshot(); assert.equal(before.status, 200);
  const file = new File([text], 'lecture.txt', { type: 'text/plain' });
  const cards = await service.generateFlashcards({ courseId: 'course-1', courseTitle: 'Untrusted title', requestedCardCount: 1, document: { uri: 'blob:synthetic', name: file.name, mimeType: file.type, size: file.size, file } });
  assert.equal(cards.length, 1); assert.equal(cards[0].reviewerVerified, false);
  assert.equal(cards[0].provenance?.model, 'reported-model-snapshot');
  assert.equal(cards[0].provenance?.documentSha256, sha256(text));
  assert.equal(cards[0].provenance?.sourceReviewNotices, undefined);
  const captions = new File([`WEBVTT\n\nNOTE\nA layout comment.\n\n00:00.000 --> 00:03.000\n${text}`], 'lecture.vtt', { type: 'text/vtt' });
  const captionCards = await service.generateFlashcards({ courseId: 'course-1', requestedCardCount: 1, document: { uri: 'blob:captions', name: captions.name, mimeType: captions.type, size: captions.size, file: captions } });
  assert.match(captionCards[0].provenance?.sourceReviewNotices?.[0] ?? '', /comment\/layout blocks were excluded/);
  const syllabus = await service.extractSyllabus({ courseId: 'course-1', courseTitle: 'Untrusted title', sourceText: text });
  assert.equal(syllabus.title, 'Algorithms'); assert.equal(syllabus.termStart, undefined);
  assert.deepEqual(syllabus.warnings, ['Term dates were not supplied.']);
  assert.equal(syllabus.provenance?.model, 'reported-model-snapshot'); assert.equal(calls, 3);
  const db = new DatabaseSync(f.file);
  try {
    const rows = db.prepare('SELECT key,state,receipt,result FROM gateway_ai_jobs ORDER BY rowid').all();
    assert.equal(rows.length, 3);
    for (const [index, row] of rows.entries()) {
      assert.equal(row.state, 'succeeded');
      const receipt = JSON.parse(String(row.receipt));
      assert.equal(receipt.model, 'reported-model-snapshot'); assert.equal(receipt.responseId, `resp_${index + 1}`);
      assert.equal(receipt.requestId, row.key); assert.equal(receipt.inputTokens, 100);
      assert.equal(receipt.outputSha256, sha256(String(row.result)));
    }
  } finally { db.close(); }
  const after = await snapshot(); assert.equal(after.status, 200);
  assert.equal(after.headers.get('etag'), before.headers.get('etag'));
  assert.deepEqual(await after.json(), await before.json());
});
