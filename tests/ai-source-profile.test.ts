import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAISourceProfile, sourceProfileDescription, sourceProfilePickerTypes } from '../src/lib/ai/sourceProfile';
import { configureAIService, generateValidatedFlashcards, extractValidatedSyllabus, InstitutionAIService } from '../src/lib/ai/service';
import { TEXT_EXTRACTION_LIMITS } from '../src/lib/ai/textExtraction.server';
import type { AIDocumentAsset } from '../src/lib/ai/types';

const document = (name: string, size = 20): AIDocumentAsset => ({ uri: 'file:///selected-source', name, size });

test('text profile matches supported tasks and exposes conservative byte and UTF-8 limits', () => {
  for (const name of ['lesson.TXT', 'lesson.md', 'lesson.vtt', 'lesson.srt']) assert.doesNotThrow(() => assertAISourceProfile({ document: document(name) }, 'flashcards', 'text-v1'));
  for (const name of ['syllabus.txt', 'syllabus.md']) assert.doesNotThrow(() => assertAISourceProfile({ document: document(name) }, 'syllabus', 'text-v1'));
  for (const name of ['syllabus.vtt', 'syllabus.srt', 'syllabus.pdf', 'syllabus.pptx']) assert.throws(() => assertAISourceProfile({ document: document(name) }, 'syllabus', 'text-v1'), /TXT or Markdown/);
  for (const name of ['lesson.pdf', 'lesson.docx', 'lesson.mp3', 'lesson.mp4', 'lesson.rtf']) assert.throws(() => assertAISourceProfile({ document: document(name) }, 'flashcards', 'text-v1'), /TXT, Markdown, VTT or SRT/);
  assert.doesNotThrow(() => assertAISourceProfile({ document: document('lesson.txt', TEXT_EXTRACTION_LIMITS.fileBytes) }, 'flashcards', 'text-v1'));
  assert.throws(() => assertAISourceProfile({ document: document('lesson.txt', TEXT_EXTRACTION_LIMITS.fileBytes + 1) }, 'flashcards', 'text-v1'), /2,000,000/);
  assert.throws(() => assertAISourceProfile({ document: document('lesson.txt', 1_999_999), sourceText: 'é' }, 'flashcards', 'text-v1'), /combined/);
  assert.throws(() => assertAISourceProfile({ document: document('lesson.txt', 1_999_997), sourceText: 'a\nb' }, 'flashcards', 'text-v1'), /combined/);
  assert.throws(() => assertAISourceProfile({ sourceText: 'x'.repeat(500_001) }, 'flashcards', 'text-v1'), /500,000/);
  for (const size of [0, -1, NaN, Infinity, 0.5]) assert.throws(() => assertAISourceProfile({ document: document('lesson.txt', size) }, 'flashcards', 'text-v1'), /nonempty/);
});

test('actual Blob size cannot evade the profile, and native sources need known size', () => {
  const file = new File(['x'.repeat(2_000_001)], 'lesson.txt', { type: 'text/plain' });
  assert.throws(() => assertAISourceProfile({ document: { ...document(file.name, 1), file } }, 'flashcards', 'text-v1'), /2,000,000/);
  assert.throws(() => assertAISourceProfile({ document: { uri: 'file:///lesson', name: 'lesson.txt' } }, 'flashcards', 'text-v1'), /known size/);
});

test('declared input limits reject generation and history recovery before credentials or network work', async () => {
  let credentials = 0, calls = 0;
  const service = new InstitutionAIService({ baseUrl: 'https://lms.example.test', sourceProfile: 'text-v1', requestRecovery: 'history-v1',
    getAccessToken: async () => { credentials++; return 'token'; }, fetchImpl: async () => { calls++; throw new Error('Unexpected network'); } });
  await assert.rejects(service.generateFlashcards({ courseId: 'course', document: document('lesson.pptx') }), /TXT, Markdown/);
  await assert.rejects(service.extractSyllabus({ courseId: 'course', document: document('syllabus.pdf') }), /TXT or Markdown/);
  await assert.rejects(service.requestHistory!.recover('flashcards', { courseId: 'course', document: document('lesson.mp4') }, 'saved'), /TXT, Markdown/);
  await assert.rejects(service.generateFlashcards({ courseId: 'course', document: document('lesson.txt', 2_000_001) }), /2,000,000/);
  assert.equal(credentials, 0); assert.equal(calls, 0);
  assert.throws(() => new InstitutionAIService({ baseUrl: 'https://lms.example.test', sourceProfile: 'unknown' as 'text-v1', getAccessToken: async () => 'token' }), /Unsupported AI source profile/);
});

test('custom adapters use the same declared guard and undeclared/prepared services do not acquire the narrow profile', async () => {
  let calls = 0;
  configureAIService({ sourceProfile: 'text-v1', generateFlashcards: async () => { calls++; return []; }, extractSyllabus: async () => { calls++; return { evidence: [], warnings: [] }; } });
  try {
    await assert.rejects(generateValidatedFlashcards({ document: document('lecture.mp3') }), /TXT, Markdown/);
    await assert.rejects(extractValidatedSyllabus({ document: document('syllabus.pdf') }), /TXT or Markdown/);
    assert.equal(calls, 0);
  } finally { configureAIService(null); }
  assert.doesNotThrow(() => assertAISourceProfile({ document: document('lecture.mp4') }, 'flashcards', undefined));
  assert.match(sourceProfileDescription('flashcards', undefined, true), /bundled source files/);
  assert.match(sourceProfileDescription('flashcards', undefined, false), /depend on your institution/);
  assert.deepEqual(sourceProfilePickerTypes('syllabus', 'text-v1'), ['text/plain', 'text/markdown']);
  assert.equal(sourceProfilePickerTypes('syllabus', undefined).includes('application/pdf'), true);
});
