import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HttpInstitutionAdapter,
  InstitutionAdapterError,
} from '../src/lib/integration/InstitutionAdapter';
import {
  configureAIService,
  generateValidatedFlashcards,
  InstitutionAIService,
  validateInstitutionFlashcardResult,
  validateInstitutionSyllabusResult,
} from '../src/lib/ai/service';
import {
  FLASHCARD_PROMPT_VERSION,
  FLASHCARD_RESPONSE_SCHEMA,
  FLASHCARD_SYSTEM_PROMPT,
  SYLLABUS_PROMPT_VERSION,
  SYLLABUS_RESPONSE_SCHEMA,
  SYLLABUS_SYSTEM_PROMPT,
} from '../src/lib/ai/prompts';
import { assertAssetMatchesAIProvenance, HttpAssetService } from '../src/lib/integration/assetService';

test('institution mutation transport sends authenticated, atomic, idempotent JSON batches', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const adapter = new HttpInstitutionAdapter({
    baseUrl: 'http://localhost:3000/api/',
    getAccessToken: async () => 'token-123',
    tenantId: 'tenant-1',
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      const requestBody = JSON.parse(String(init?.body)) as { mutations: { id: string }[] };
      return new Response(JSON.stringify({ acceptedIds: requestBody.mutations.map(mutation => mutation.id), rejected: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: '"snapshot-8"' },
      });
    },
  });

  const result = await adapter.pushMutations([{
    id: 'mutation-1', entity: 'course', operation: 'update', entityId: 'course-1', occurredAt: 1, payload: { title: 'Updated' },
  }], { cursor: 'cursor-7', etag: '"snapshot-7"' });
  assert.deepEqual(result.acceptedIds, ['mutation-1']);
  assert.equal(result.nextEtag, '"snapshot-8"');
  assert.equal(capturedUrl, 'http://localhost:3000/api/lms/v1/mutations');
  assert.equal(capturedInit?.redirect, 'error');
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer token-123');
  assert.equal(headers.get('X-Institution-Id'), 'tenant-1');
  assert.equal(headers.get('If-Match'), '"snapshot-7"');
  assert.ok(headers.get('Idempotency-Key'));
  const body = JSON.parse(String(capturedInit?.body)) as { atomic: boolean; cursor?: string };
  assert.equal(body.atomic, true);
  assert.equal(body.cursor, 'cursor-7');
});

test('institution mutation transport refuses to lose or reuse an If-Match ETag', async () => {
  const mutation = {
    id: 'mutation-1', entity: 'course' as const, operation: 'update' as const,
    entityId: 'course-1', occurredAt: 1, payload: { title: 'Updated' },
  };
  const missing = new HttpInstitutionAdapter({
    baseUrl: 'https://lms.example.edu',
    getAccessToken: async () => 'token',
    fetchImpl: async () => new Response(JSON.stringify({ acceptedIds: ['mutation-1'], rejected: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  await assert.rejects(() => missing.pushMutations([mutation], { etag: '"snapshot-1"' }), /next ETag/i);

  const stale = new HttpInstitutionAdapter({
    baseUrl: 'https://lms.example.edu',
    getAccessToken: async () => 'token',
    fetchImpl: async () => new Response(JSON.stringify({ acceptedIds: ['mutation-1'], rejected: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ETag: '"snapshot-1"' },
    }),
  });
  await assert.rejects(() => stale.pushMutations([mutation], { etag: '"snapshot-1"' }), /advance the ETag/i);
});

test('institution chat transport encodes bounded paging and search requests', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const adapter = new HttpInstitutionAdapter({
    baseUrl: 'http://localhost:3000/api',
    getAccessToken: async () => 'chat-token',
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ messages: [], hasMore: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  await adapter.loadMessagePage('thread/with spaces', { limit: 25, cursor: 'opaque+/=', query: 'lab schedule' });
  const url = new URL(capturedUrl);
  assert.equal(url.pathname, '/api/lms/v1/chat/threads/thread%2Fwith%20spaces/messages');
  assert.equal(url.searchParams.get('limit'), '25');
  assert.equal(url.searchParams.get('cursor'), 'opaque+/=');
  assert.equal(url.searchParams.get('query'), 'lab schedule');
  assert.equal(capturedInit?.method, 'GET');
  assert.equal(new Headers(capturedInit?.headers).get('Authorization'), 'Bearer chat-token');
  await assert.rejects(() => adapter.loadMessagePage('thread-1', { limit: 101 }), /page size/i);
});

test('institution learner-state transport is scoped, validated, and idempotent', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let storedRecord: unknown = null;
  const adapter = new HttpInstitutionAdapter({
    baseUrl: 'http://localhost:3000/api',
    getAccessToken: async () => 'state-token',
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      const method = init?.method;
      if (method === 'PUT') storedRecord = JSON.parse(String(init?.body));
      const body = method === 'GET' || method === 'PUT' ? storedRecord : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const scope = { principalId: 'student-1', courseId: 'course-1' };

  const saved = await adapter.save(scope, 'course-page', { pageId: 'current', verticalOffset: 240 }, 'stable-write-1');
  assert.equal(saved.writeId, 'stable-write-1');
  assert.equal(saved.payload.verticalOffset, 240);
  const putHeaders = new Headers(calls[0].init?.headers);
  assert.equal(putHeaders.get('Idempotency-Key'), 'stable-write-1');
  assert.equal(putHeaders.get('Authorization'), 'Bearer state-token');

  const loaded = await adapter.load(scope, 'course-page');
  assert.equal(loaded?.payload.pageId, 'current');
  const loadUrl = new URL(calls[1].url);
  assert.equal(loadUrl.pathname, '/api/lms/v1/learner-state');
  assert.equal(loadUrl.searchParams.get('kind'), 'course-page');
  assert.equal(loadUrl.searchParams.get('courseId'), 'course-1');
  assert.equal(loadUrl.searchParams.has('principalId'), false, 'the authenticated server derives the principal');

  await adapter.remove(scope, 'course-page');
  assert.ok(new Headers(calls[2].init?.headers).get('Idempotency-Key'));
  await adapter.recordActivity({
    schemaVersion: 1,
    eventId: 'activity-1',
    type: 'course-page-viewed',
    scope,
    occurredAt: 1_000,
    consentNoticeVersion: 'privacy-v1',
  });
  assert.equal(new Headers(calls[3].init?.headers).get('Idempotency-Key'), 'activity-1');
});

test('institution transport fails closed without an authenticated session', async () => {
  const adapter = new HttpInstitutionAdapter({
    baseUrl: 'https://lms.example.edu',
    getAccessToken: async () => null,
    fetchImpl: async () => new Response('{}'),
  });
  await assert.rejects(() => adapter.pullSnapshot(), (error: unknown) => {
    assert.ok(error instanceof InstitutionAdapterError);
    if (!(error instanceof InstitutionAdapterError)) return false;
    assert.equal(error.code, 'authentication_required');
    return true;
  });
});

test('institution snapshot transport preserves and verifies response ETags', async () => {
  let requestHeaders = new Headers();
  const adapter = new HttpInstitutionAdapter({
    baseUrl: 'https://lms.example.edu',
    getAccessToken: async () => 'token',
    fetchImpl: async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ snapshot: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: 'W/"snapshot-2"' },
      });
    },
  });
  const response = await adapter.pullSnapshot({ cursor: 'cursor-1', etag: 'W/"snapshot-1"' }) as Record<string, unknown>;
  assert.equal(requestHeaders.get('If-None-Match'), 'W/"snapshot-1"');
  assert.equal(response.etag, 'W/"snapshot-2"');
});

test('institution transport rejects oversized mutation requests before sending', async () => {
  let sent = false;
  const adapter = new HttpInstitutionAdapter({
    baseUrl: 'https://lms.example.edu',
    getAccessToken: async () => 'token',
    maxRequestBytes: 100,
    fetchImpl: async () => {
      sent = true;
      return new Response('{}');
    },
  });
  await assert.rejects(() => adapter.pushMutations([{
    id: 'mutation-1', entity: 'course', operation: 'update', entityId: 'course-1', occurredAt: 1, payload: { description: 'x'.repeat(1_000) },
  }]), (error: unknown) => {
    assert.ok(error instanceof InstitutionAdapterError);
    return error instanceof InstitutionAdapterError && error.code === 'request_too_large';
  });
  assert.equal(sent, false);
});

test('institution transport rejects unsafe URLs and invalid header or limit configuration', () => {
  const getAccessToken = async () => 'token';
  assert.throws(
    () => new HttpInstitutionAdapter({ baseUrl: 'https://user:secret@lms.example.edu', getAccessToken }),
    (error: unknown) => error instanceof InstitutionAdapterError && error.code === 'invalid_base_url',
  );
  assert.throws(
    () => new HttpInstitutionAdapter({ baseUrl: 'https://lms.example.edu?tenant=one', getAccessToken }),
    (error: unknown) => error instanceof InstitutionAdapterError && error.code === 'invalid_base_url',
  );
  assert.throws(
    () => new HttpInstitutionAdapter({ baseUrl: 'https://lms.example.edu', getAccessToken, tenantId: 'bad\nheader' }),
    (error: unknown) => error instanceof InstitutionAdapterError && error.code === 'invalid_configuration',
  );
  assert.throws(
    () => new HttpInstitutionAdapter({ baseUrl: 'https://lms.example.edu', getAccessToken, timeoutMs: Number.NaN }),
    (error: unknown) => error instanceof InstitutionAdapterError && error.code === 'invalid_configuration',
  );
});

test('institution transport stops reading streamed responses at the configured byte limit', async () => {
  const adapter = new HttpInstitutionAdapter({
    baseUrl: 'https://lms.example.edu',
    getAccessToken: async () => 'token',
    maxResponseBytes: 64,
    fetchImpl: async () => new Response(JSON.stringify({ payload: 'x'.repeat(1_000) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  await assert.rejects(
    () => adapter.pullSnapshot(),
    (error: unknown) => error instanceof InstitutionAdapterError && error.code === 'response_too_large',
  );
});

test('production transports do not surface upstream diagnostics or network URLs', async () => {
  const diagnostic = 'student@example.edu failed in internal shard secret-primary';
  const adapter = new HttpInstitutionAdapter({
    baseUrl: 'https://lms.example.edu',
    getAccessToken: async () => 'token',
    fetchImpl: async () => new Response(JSON.stringify({ message: diagnostic, code: 'access_denied' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  await assert.rejects(() => adapter.pullSnapshot(), (error: unknown) => {
    assert.ok(error instanceof InstitutionAdapterError);
    if (!(error instanceof InstitutionAdapterError)) return false;
    assert.doesNotMatch(error.message, /student@example|secret-primary/);
    assert.match(error.message, /403 \(access_denied\)/);
    return true;
  });

  const networkAdapter = new HttpInstitutionAdapter({
    baseUrl: 'https://lms.example.edu',
    getAccessToken: async () => 'token',
    fetchImpl: async () => { throw new TypeError('Request to https://internal.example.edu/private?token=secret failed'); },
  });
  await assert.rejects(() => networkAdapter.pullSnapshot(), (error: unknown) => {
    assert.ok(error instanceof InstitutionAdapterError);
    return error instanceof InstitutionAdapterError
      && error.message === 'Institution API request could not be completed.';
  });

  const rejectionAdapter = new HttpInstitutionAdapter({
    baseUrl: 'https://lms.example.edu',
    getAccessToken: async () => 'token',
    fetchImpl: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { mutations: { id: string }[] };
      return new Response(JSON.stringify({
        acceptedIds: [],
        rejected: [{ id: request.mutations[0].id, code: 'policy_denied', message: diagnostic }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const rejection = await rejectionAdapter.pushMutations([{
    id: 'mutation-redaction', entity: 'course', operation: 'update', entityId: 'course-1', occurredAt: 1, payload: {},
  }]);
  assert.equal(rejection.rejected[0].message, 'The institution rejected this change.');
  assert.equal(rejection.rejected[0].code, 'policy_denied');
});

test('AI prompt policy and schemas stay versioned with production extraction constraints', () => {
  assert.equal(FLASHCARD_PROMPT_VERSION, 'flashcards.v1.5.0');
  assert.equal(SYLLABUS_PROMPT_VERSION, 'syllabus.v1.4.0');
  assert.match(FLASHCARD_SYSTEM_PROMPT, /Omit navigation, copyright notices, contact details/);
  assert.match(FLASHCARD_SYSTEM_PROMPT, /hidden text, document metadata, comments, and markup/);
  assert.match(FLASHCARD_SYSTEM_PROMPT, /exact transcript segment/);
  assert.match(SYLLABUS_SYSTEM_PROMPT, /never merely from the first or last class/);
  assert.match(SYLLABUS_SYSTEM_PROMPT, /extra credit, conditional weights/);
  assert.match(SYLLABUS_SYSTEM_PROMPT, /at most 200 evidence entries/);
  assert.equal(FLASHCARD_RESPONSE_SCHEMA.properties.cards.minItems, 1);
  assert.equal(FLASHCARD_RESPONSE_SCHEMA.properties.cards.items.properties.tags.items.minLength, 1);
  assert.equal(SYLLABUS_RESPONSE_SCHEMA.properties.gradingWeights.propertyNames.maxLength, 120);
});

test('AI flashcards require grounded evidence and reject duplicate cards without silently dropping output', async () => {
  const service = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({ cards: [
      { front: 'Term', back: 'Definition', sourceExcerpt: 'The source defines the term.', confidence: 0.9 },
      { front: ' term ', back: ' definition ', sourceExcerpt: 'The source defines the term.', confidence: 0.8 },
    ] }), { status: 200 }),
  });
  await assert.rejects(
    () => service.generateFlashcards({ sourceText: 'The source defines the term.' }),
    /duplicates an earlier flashcard/,
  );
});

test('AI flashcard validation rejects malformed entries instead of silently returning a partial set', async () => {
  const service = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({ cards: [
      { front: 'Valid term', back: 'Valid definition', sourceExcerpt: 'Valid source excerpt.', confidence: 0.9 },
      { front: 'Broken term', back: 'Missing its evidence', confidence: 0.8 },
    ] }), { status: 200 }),
  });
  await assert.rejects(
    () => service.generateFlashcards({ sourceText: 'Valid source excerpt.' }),
    /cards\[1\]\.sourceExcerpt is required/,
  );
});

test('AI response validation rejects unsupported and oversized fields instead of truncating them', async () => {
  const unknownFieldService = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({ cards: [{
      front: 'Valid term', back: 'Valid definition', sourceExcerpt: 'Valid source excerpt.', confidence: 0.9, hiddenAnswer: 'discarded',
    }] }), { status: 200 }),
  });
  await assert.rejects(
    () => unknownFieldService.generateFlashcards({ sourceText: 'Valid source excerpt.' }),
    /hiddenAnswer is not supported/,
  );

  const oversizedService = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({ cards: [{
      front: 'x'.repeat(501), back: 'Valid definition', sourceExcerpt: 'Valid source excerpt.', confidence: 0.9,
    }] }), { status: 200 }),
  });
  await assert.rejects(
    () => oversizedService.generateFlashcards({ sourceText: 'Valid source excerpt.' }),
    /exceeds 500 characters/,
  );
});

test('AI syllabus extraction retains evidence and flags inconsistent grade totals', async () => {
  const service = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({
      title: 'Course',
      termStart: '2026-09-01',
      gradingWeights: { Exams: 60, Projects: 30 },
      schedule: [{ date: '2026-02-31', topic: 'Invalid date is omitted' }],
      evidence: [
        { field: 'title', sourceExcerpt: 'Course: Course' },
        { field: 'termStart', sourceExcerpt: 'Starts September 1, 2026' },
        { field: 'gradingWeights', sourceExcerpt: 'Exams 60%, Projects 30%' },
        { field: 'gradingWeights[0]', sourceExcerpt: 'Exams 60%' },
        { field: 'gradingWeights[1]', sourceExcerpt: 'Projects 30%' },
        { field: 'schedule[0]', sourceExcerpt: 'Invalid date is omitted' },
      ],
      warnings: [],
    }), { status: 200 }),
  });
  const result = await service.extractSyllabus({ sourceText: 'Course: Course\nStarts September 1, 2026\nExams 60%, Projects 30%\nInvalid date is omitted' });
  assert.equal(result.evidence.length, 6);
  assert.equal(result.schedule?.[0].date, undefined);
  assert.ok(result.warnings.some(warning => warning.includes('90%')));
  assert.ok(result.warnings.some(warning => warning.includes('schedule date')));
});

test('AI syllabus extraction rejects populated fields without matching evidence', async () => {
  const service = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({
      title: 'Course',
      description: 'Uncited description',
      evidence: [{ field: 'title', sourceExcerpt: 'Course: Course' }],
      warnings: [],
    }), { status: 200 }),
  });
  await assert.rejects(() => service.extractSyllabus({ sourceText: 'Course: Course' }), /omitted source evidence for: description/);
});

test('AI syllabus extraction requires evidence for every schedule and policy entry', async () => {
  const service = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({
      schedule: [{ topic: 'Week one' }, { topic: 'Week two' }],
      policies: [{ name: 'Late work', text: 'Late work loses ten percent.' }],
      evidence: [
        { field: 'schedule[0]', sourceExcerpt: 'Week one' },
        { field: 'policies', sourceExcerpt: 'Late work loses ten percent.' },
      ],
      warnings: [],
    }), { status: 200 }),
  });
  await assert.rejects(
    () => service.extractSyllabus({ sourceText: 'Week one\nWeek two\nLate work loses ten percent.' }),
    /schedule\[1\].*policies\[0\]/,
  );
});

test('AI syllabus extraction requires warnings and item-level evidence for every extracted list value', async () => {
  const missingWarnings = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({
      title: 'Course', evidence: [{ field: 'title', sourceExcerpt: 'Course' }],
    }), { status: 200 }),
  });
  await assert.rejects(() => missingWarnings.extractSyllabus({ sourceText: 'Course' }), /warnings must be an array/);

  const missingItemEvidence = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({
      instructorNames: ['Dr. Ada'],
      requiredMaterials: ['Course reader'],
      evidence: [
        { field: 'instructorNames', sourceExcerpt: 'Dr. Ada' },
        { field: 'requiredMaterials', sourceExcerpt: 'Course reader' },
      ],
      warnings: [],
    }), { status: 200 }),
  });
  await assert.rejects(
    () => missingItemEvidence.extractSyllabus({ sourceText: 'Dr. Ada\nCourse reader' }),
    /instructorNames\[0\].*requiredMaterials\[0\]/,
  );
});

test('AI syllabus extraction rejects out-of-range grading weights instead of silently clamping them', async () => {
  const service = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({
      gradingWeights: { Exams: 150 },
      evidence: [{ field: 'gradingWeights', sourceExcerpt: 'Exams 150%' }],
      warnings: [],
    }), { status: 200 }),
  });
  await assert.rejects(
    () => service.extractSyllabus({ sourceText: 'Exams 150%' }),
    /invalid grading category or percentage/,
  );
});

test('AI syllabus extraction rejects evidence fabricated outside pasted source text', async () => {
  const service = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({
      title: 'Invented Course',
      evidence: [{ field: 'title', sourceExcerpt: 'Course: Invented Course' }],
      warnings: [],
    }), { status: 200 }),
  });
  await assert.rejects(() => service.extractSyllabus({ sourceText: 'Course: Grounded Course' }), /was not found in the supplied source text/);
});

test('AI document ingestion rejects disguised unsupported files before upload', async () => {
  const service = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response('{}', { status: 200 }),
  });
  await assert.rejects(
    () => service.generateFlashcards({ document: { uri: 'file:///tmp/payload.exe', name: 'payload.exe', mimeType: 'application/pdf', size: 10 } }),
    /Supported AI sources/,
  );
  await assert.rejects(
    () => service.generateFlashcards({ document: { uri: 'https://intranet.example.edu/private.pdf', name: 'private.pdf', mimeType: 'application/pdf', size: 10 } }),
    /document URI is not supported/,
  );
});

test('AI document ingestion accepts PPTX with a generic picker MIME and rejects extension/MIME mismatches', async () => {
  const provenance = {
    promptVersion: FLASHCARD_PROMPT_VERSION,
    evidenceVerified: true,
    sourceSha256: 'a'.repeat(64),
    documentSha256: 'b'.repeat(64),
  };
  const service = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({
      cards: [{ front: 'Slide topic', back: 'Slide definition', sourceExcerpt: 'Slide evidence', confidence: 0.9 }],
      provenance,
    }), { status: 200 }),
  });
  const cards = await service.generateFlashcards({ document: {
    uri: 'file:///tmp/slides.pptx', name: 'slides.pptx', mimeType: 'application/octet-stream', size: 10,
  } });
  assert.equal(cards.length, 1);
  await assert.rejects(() => service.generateFlashcards({ document: {
    uri: 'file:///tmp/fake.pdf', name: 'fake.pdf', mimeType: 'text/plain', size: 10,
  } }), /Supported AI sources/);
});

test('AI flashcards accept bounded course video and require timestamped transcript evidence', async () => {
  let requestBody: FormData | undefined;
  const provenance = {
    promptVersion: FLASHCARD_PROMPT_VERSION,
    evidenceVerified: true,
    sourceSha256: 'a'.repeat(64),
    documentSha256: 'b'.repeat(64),
  };
  const service = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async (_input, init) => {
      requestBody = init?.body as FormData;
      return new Response(JSON.stringify({
        cards: [{ front: 'What is recursion?', back: 'A function solving a problem by calling itself on smaller inputs.', sourceExcerpt: 'Recursion solves the smaller version first.', sourceLocation: 'Video 00:04:12', confidence: 0.92 }],
        provenance,
      }), { status: 200 });
    },
  });
  const cards = await service.generateFlashcards({ document: {
    uri: 'file:///tmp/lecture.mp4', name: 'lecture.mp4', mimeType: 'video/mp4', size: 10, kind: 'video',
  } });
  assert.equal(cards.length, 1);
  assert.equal(requestBody?.get('sourceKind'), 'video');

  const missingTimestamp = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({
      cards: [{ front: 'What is recursion?', back: 'Self-reference on smaller inputs.', sourceExcerpt: 'Recursion solves the smaller version first.', confidence: 0.9 }],
      provenance,
    }), { status: 200 }),
  });
  await assert.rejects(() => missingTimestamp.generateFlashcards({ document: {
    uri: 'file:///tmp/lecture.mp4', name: 'lecture.mp4', mimeType: 'video/mp4', size: 10, kind: 'video',
  } }), /transcript timestamp/);
});

test('AI transport sends the validated inferred source kind when callers omit the hint', async () => {
  let requestBody: FormData | undefined;
  const service = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async (_input, init) => {
      requestBody = init?.body as FormData;
      return new Response(JSON.stringify({
        cards: [{ front: 'Caption concept', back: 'Caption definition', sourceExcerpt: 'Caption source excerpt', sourceLocation: '00:00:12', confidence: 0.9 }],
        provenance: {
          promptVersion: FLASHCARD_PROMPT_VERSION,
          evidenceVerified: true,
          sourceSha256: 'a'.repeat(64),
          documentSha256: 'b'.repeat(64),
        },
      }), { status: 200 });
    },
  });
  await service.generateFlashcards({ document: {
    uri: 'file:///tmp/lecture.srt', name: 'lecture.srt', mimeType: 'application/x-subrip', size: 10,
  } });
  assert.equal(requestBody?.get('sourceKind'), 'captions');
});

test('AI document results require a server grounding attestation', async () => {
  const service = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({ cards: [
      { front: 'Term', back: 'Definition', sourceExcerpt: 'Document excerpt', confidence: 0.9 },
    ] }), { status: 200 }),
  });
  await assert.rejects(
    () => service.generateFlashcards({ document: { uri: 'file:///tmp/source.pdf', name: 'source.pdf', mimeType: 'application/pdf', size: 10 } }),
    /omitted its server validation attestation/,
  );
});

test('AI provenance binds document output to the processed source digest', async () => {
  const document = { uri: 'file:///tmp/source.pdf', name: 'source.pdf', mimeType: 'application/pdf', size: 10 };
  const withoutDigest = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({
      cards: [{ front: 'Term', back: 'Definition', sourceExcerpt: 'Document excerpt', confidence: 0.9 }],
      provenance: { promptVersion: FLASHCARD_PROMPT_VERSION, evidenceVerified: true },
    }), { status: 200 }),
  });
  await assert.rejects(() => withoutDigest.generateFlashcards({ document }), /SHA-256 digest/);

  const withDigest = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async () => new Response(JSON.stringify({
      cards: [{ front: 'Term', back: 'Definition', sourceExcerpt: 'Document excerpt', confidence: 0.9 }],
      provenance: { promptVersion: FLASHCARD_PROMPT_VERSION, evidenceVerified: true, sourceSha256: 'A'.repeat(64), documentSha256: 'B'.repeat(64), requestId: 'ai-1' },
    }), { status: 200 }),
  });
  const cards = await withDigest.generateFlashcards({ document });
  assert.equal(cards[0].provenance?.sourceSha256, 'a'.repeat(64));
  assert.equal(cards[0].provenance?.documentSha256, 'b'.repeat(64));
  assert.equal(cards[0].provenance?.requestId, 'ai-1');
});

test('institution AI adapters cannot bypass human review or document provenance', () => {
  const sourceText = 'The grounded source defines the term.';
  const cards = validateInstitutionFlashcardResult([{
    id: 'adapter-card',
    front: 'Grounded term',
    back: 'Grounded definition',
    sourceExcerpt: sourceText,
    confidence: 0.9,
    reviewerEdited: true,
    reviewerVerified: true,
    provenance: {
      promptVersion: FLASHCARD_PROMPT_VERSION,
      evidenceVerified: true,
      sourceSha256: 'c'.repeat(64),
    },
  }], { sourceText });
  assert.equal(cards[0].reviewerEdited, false);
  assert.equal(cards[0].reviewerVerified, false);

  const document = { uri: 'file:///tmp/source.pdf', name: 'source.pdf', mimeType: 'application/pdf', size: 10 };
  assert.throws(
    () => validateInstitutionFlashcardResult([{
      id: 'missing-provenance', front: 'Term', back: 'Definition', sourceExcerpt: 'Document excerpt', confidence: 0.9,
    }], { document }),
    /source-digest attestation/,
  );
  assert.throws(
    () => validateInstitutionSyllabusResult({
      title: 'Course', evidence: [{ field: 'title', sourceExcerpt: 'Course: Course' }], warnings: [],
    }, { document }),
    /source-digest attestation/,
  );
});

test('institution AI adapters never receive invalid or oversized client input', async () => {
  let adapterCalled = false;
  configureAIService({
    async generateFlashcards() {
      adapterCalled = true;
      return [];
    },
    async extractSyllabus() {
      adapterCalled = true;
      throw new Error('should not be called');
    },
  });
  try {
    await assert.rejects(
      () => generateValidatedFlashcards({
        document: { uri: 'file:///tmp/source.exe', name: 'source.exe', mimeType: 'application/pdf', size: 10 },
      }),
      /Supported AI sources/,
    );
    assert.equal(adapterCalled, false);
  } finally {
    configureAIService(null);
  }
});

test('institution AI adapters require prompt and source-digest attestations for pasted text too', () => {
  assert.throws(
    () => validateInstitutionFlashcardResult([{
      id: 'unattested-card', front: 'Grounded term', back: 'Grounded definition', sourceExcerpt: 'Grounded source.', confidence: 0.9,
    }], { sourceText: 'Grounded source.' }),
    /prompt\/source-digest attestation/,
  );
  assert.throws(
    () => validateInstitutionSyllabusResult({
      title: 'Course', evidence: [{ field: 'title', sourceExcerpt: 'Course: Course' }], warnings: [],
    }, { sourceText: 'Course: Course' }),
    /prompt\/source-digest attestation/,
  );
});

test('mixed text and document AI input relies on the attested document digest for document excerpts', () => {
  const document = { uri: 'file:///tmp/source.pdf', name: 'source.pdf', mimeType: 'application/pdf', size: 10 };
  const flashcardProvenance = {
    promptVersion: FLASHCARD_PROMPT_VERSION,
    evidenceVerified: true as const,
    sourceSha256: 'b'.repeat(64),
    documentSha256: 'd'.repeat(64),
  };
  const cards = validateInstitutionFlashcardResult([{
    id: 'mixed-card', front: 'Document term', back: 'Document definition', sourceExcerpt: 'Excerpt found only in the document', confidence: 0.95,
    provenance: flashcardProvenance,
  }], { sourceText: 'Short course description.', document });
  assert.equal(cards.length, 1);

  const syllabus = validateInstitutionSyllabusResult({
    title: 'Document Course',
    evidence: [{ field: 'title', sourceExcerpt: 'Course: Document Course' }],
    warnings: [],
    provenance: { ...flashcardProvenance, promptVersion: SYLLABUS_PROMPT_VERSION },
  }, { sourceText: 'Short course description.', document });
  assert.equal(syllabus.title, 'Document Course');
});

test('AI requests send only a server-owned prompt version, not client policy text', async () => {
  let requestBody: FormData | undefined;
  let requestHeaders: Headers | undefined;
  let requestRedirect: RequestRedirect | undefined;
  const service = new InstitutionAIService({
    baseUrl: 'http://localhost:4000',
    fetchImpl: async (_input, init) => {
      requestBody = init?.body as FormData;
      requestHeaders = new Headers(init?.headers);
      requestRedirect = init?.redirect;
      return new Response(JSON.stringify({ cards: [
        { front: 'Term', back: 'Definition', sourceExcerpt: 'The source defines the term.', confidence: 0.9 },
      ] }), { status: 200 });
    },
  });
  await service.generateFlashcards({ sourceText: 'The source defines the term.' });
  assert.equal(requestBody?.has('systemPrompt'), false);
  assert.equal(requestBody?.has('responseSchema'), false);
  assert.match(String(requestBody?.get('promptVersion')), /^flashcards\.v/);
  assert.ok(requestHeaders?.get('Idempotency-Key'));
  assert.equal(requestRedirect, 'error');
});

test('remote AI responses must echo the exact request identifier in their provenance', async () => {
  const service = new InstitutionAIService({
    baseUrl: 'https://ai.example.edu',
    getAccessToken: async () => 'token',
    fetchImpl: async (_input, init) => new Response(JSON.stringify({
      cards: [{ front: 'Term', back: 'Definition', sourceExcerpt: 'Grounded source.', confidence: 0.9 }],
      provenance: {
        promptVersion: FLASHCARD_PROMPT_VERSION,
        evidenceVerified: true,
        sourceSha256: 'a'.repeat(64),
        requestId: `${new Headers(init?.headers).get('X-Request-Id')}-wrong`,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  await assert.rejects(() => service.generateFlashcards({ sourceText: 'Grounded source.' }), /not bound to this request identifier/);
});

test('remote AI configuration fails closed without an authenticated token provider', () => {
  assert.throws(
    () => new InstitutionAIService({ baseUrl: 'https://ai.example.edu' }),
    /authenticated access-token provider/,
  );
});

test('remote AI and asset errors expose bounded codes but not upstream diagnostic messages', async () => {
  const diagnostic = 'learner@example.edu source bytes retained in debug bucket secret-primary';
  const ai = new InstitutionAIService({
    baseUrl: 'https://ai.example.edu',
    getAccessToken: async () => 'token',
    fetchImpl: async () => new Response(JSON.stringify({ message: diagnostic, code: 'source_rejected' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  await assert.rejects(
    () => ai.generateFlashcards({ sourceText: 'Grounded source material.' }),
    (error: unknown) => error instanceof Error
      && /422\) \(source_rejected\)/.test(error.message)
      && !/learner@example|secret-primary/.test(error.message),
  );

  const assets = new HttpAssetService({
    baseUrl: 'https://assets.example.edu',
    getAccessToken: async () => 'token',
    fetchImpl: async () => new Response(JSON.stringify({ message: diagnostic, code: 'file_rejected' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  await assert.rejects(
    () => assets.upload(
      { uri: 'file:///tmp/notes.pdf', name: 'notes.pdf', mimeType: 'application/pdf', size: 10 },
      { courseId: 'course-1', purpose: 'course-content' },
    ),
    (error: unknown) => error instanceof Error
      && /422\) \(file_rejected\)/.test(error.message)
      && !/learner@example|secret-primary/.test(error.message),
  );
});

test('asset uploads are authenticated, idempotent, course-scoped, and integrity-checked', async () => {
  let request: RequestInit | undefined;
  const service = new HttpAssetService({
    baseUrl: 'http://localhost:4000',
    getAccessToken: async () => 'asset-token',
    fetchImpl: async (_input, init) => {
      request = init;
      return new Response(JSON.stringify({
        id: 'asset-1', url: 'https://assets.example.edu/asset-1', name: 'notes.pdf', mimeType: 'application/pdf', size: 10,
        sha256: 'a'.repeat(64),
      }), { status: 200 });
    },
  });
  const asset = await service.upload({ uri: 'file:///tmp/notes.pdf', name: 'notes.pdf', mimeType: 'application/pdf', size: 10 }, { courseId: 'course-1', purpose: 'course-content', idempotencyKey: 'syllabus-import-1' });
  assert.equal(asset.sha256, 'a'.repeat(64));
  const headers = new Headers(request?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer asset-token');
  assert.equal(headers.get('Idempotency-Key'), 'syllabus-import-1');
  assert.equal(request?.redirect, 'error');
  assert.equal((request?.body as FormData).get('courseId'), 'course-1');
});

test('published AI documents must match the exact bytes processed by the AI service', () => {
  const provenance = {
    promptVersion: FLASHCARD_PROMPT_VERSION,
    evidenceVerified: true as const,
    sourceSha256: 'a'.repeat(64),
    documentSha256: 'b'.repeat(64),
  };
  assert.doesNotThrow(() => assertAssetMatchesAIProvenance({
    id: 'asset-1', url: 'https://assets.example.edu/1', name: 'source.pdf', mimeType: 'application/pdf', sha256: 'B'.repeat(64),
  }, provenance));
  assert.throws(() => assertAssetMatchesAIProvenance({
    id: 'asset-2', url: 'https://assets.example.edu/2', name: 'source.pdf', mimeType: 'application/pdf', sha256: 'c'.repeat(64),
  }, provenance), /no longer matches/);
});

test('asset uploads reject missing course scope and missing integrity digests', async () => {
  const service = new HttpAssetService({
    baseUrl: 'http://localhost:4000',
    getAccessToken: async () => 'asset-token',
    fetchImpl: async () => new Response(JSON.stringify({ id: 'asset-1', url: 'https://assets.example.edu/asset-1' }), { status: 200 }),
  });
  const input = { uri: 'file:///tmp/notes.pdf', name: 'notes.pdf', mimeType: 'application/pdf', size: 10 };
  await assert.rejects(() => service.upload(input, { purpose: 'course-content' }), /course identifier is required/);
  await assert.rejects(() => service.upload(input, { purpose: 'chat-attachment' }), /conversation identifier is required/);
  await assert.rejects(() => service.upload(input, { courseId: 'course-1', purpose: 'course-content' }), /valid SHA-256 digest/);
});

test('asset uploads reject insecure source URIs and unsupported response fields', async () => {
  const insecure = new HttpAssetService({
    baseUrl: 'http://localhost:4000',
    getAccessToken: async () => 'asset-token',
    fetchImpl: async () => new Response('{}'),
  });
  await assert.rejects(
    () => insecure.upload({ uri: 'http://files.example.edu/notes.pdf', name: 'notes.pdf', mimeType: 'application/pdf', size: 10 }, { courseId: 'course-1', purpose: 'course-content' }),
    /URI is not supported/,
  );
  await assert.rejects(
    () => insecure.upload({ uri: 'https://intranet.example.edu/private.pdf', name: 'private.pdf', mimeType: 'application/pdf', size: 10 }, { courseId: 'course-1', purpose: 'course-content' }),
    /URI is not supported/,
  );

  const unknownField = new HttpAssetService({
    baseUrl: 'http://localhost:4000',
    getAccessToken: async () => 'asset-token',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'asset-1', url: 'https://assets.example.edu/asset-1', name: 'notes.pdf', mimeType: 'application/pdf', size: 10,
      sha256: 'a'.repeat(64), executable: true,
    }), { status: 200 }),
  });
  await assert.rejects(
    () => unknownField.upload({ uri: 'file:///tmp/notes.pdf', name: 'notes.pdf', mimeType: 'application/pdf', size: 10 }, { courseId: 'course-1', purpose: 'course-content' }),
    /unsupported field "executable"/,
  );
});

test('direct-message attachments are scoped to their conversation without requiring a course', async () => {
  let request: RequestInit | undefined;
  const service = new HttpAssetService({
    baseUrl: 'http://localhost:4000',
    getAccessToken: async () => 'asset-token',
    fetchImpl: async (_input, init) => {
      request = init;
      return new Response(JSON.stringify({
        id: 'asset-dm', url: 'https://assets.example.edu/asset-dm', name: 'message.txt', mimeType: 'text/plain', size: 10,
        sha256: 'b'.repeat(64),
      }), { status: 200 });
    },
  });
  await service.upload(
    { uri: 'file:///tmp/message.txt', name: 'message.txt', mimeType: 'text/plain', size: 10 },
    { threadId: 'thread-direct', purpose: 'chat-attachment' },
  );
  assert.equal((request?.body as FormData).get('threadId'), 'thread-direct');
  assert.equal((request?.body as FormData).has('courseId'), false);
});
