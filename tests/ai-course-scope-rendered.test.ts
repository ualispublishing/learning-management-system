import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { configureAIService, InstitutionAIService } from '../src/lib/ai/service';
import { FLASHCARD_PROMPT_VERSION, SYLLABUS_PROMPT_VERSION } from '../src/lib/ai/prompts';
import type { AIGenerationInput, GeneratedFlashcard } from '../src/lib/ai/types';
import type { Course } from '../src/types/lms';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://lms.example.test/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'ShadowRoot', 'MutationObserver'] as const) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) });
const stubs: Record<string, string> = {
  'react-native': 'import React from "react"; export * from "react-native-web"; export const Modal = ({visible,children}) => visible ? React.createElement("div",{role:"dialog"},children) : null;',
  '@expo/vector-icons/Ionicons': 'export default () => null;',
  '../../lib/useThemeColors': 'export const useThemeColors = () => ({background:"#fff",card:"#fff",text:"#111",textSecondary:"#333",primary:"#005fcc",border:"#777",buttonText:"#fff"});',
  './PreparedSourcePicker': 'export const PreparedSourcePicker = () => null; export const PreparedAccuracyNotice = () => null;',
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) { return stubs[specifier] ? { url: `ai-scope:${specifier}`, shortCircuit: true } : nextResolve(specifier, context.parentURL?.startsWith('ai-scope:') ? { ...context, parentURL: import.meta.url } : context); },
  load(url, context, nextLoad) { return url.startsWith('ai-scope:') ? { format: 'module', source: stubs[url.slice('ai-scope:'.length)], shortCircuit: true } : nextLoad(url, context); },
});

test('switching courses with identical titles revokes AI consent and discards a late result from the old course', async () => {
  const ui = await import('@testing-library/react');
  const { FlashcardReviewModal } = await import('../src/components/lms/FlashcardReviewModal');
  const requests: { input: AIGenerationInput; resolve: (cards: GeneratedFlashcard[]) => void }[] = [];
  const sourceText = 'Algorithms are finite procedures.';
  configureAIService({ generateFlashcards: input => new Promise(resolve => { requests.push({ input, resolve }); }), extractSyllabus: async () => { throw new Error('Unexpected task'); } });
  let publications = 0;
  const render = (courseId: string) => React.createElement(FlashcardReviewModal, {
    courseId, courseTitle: 'Same course title', sourceText, visible: true,
    onClose: () => {}, onApprove: () => { publications++; },
  });
  const result = (front: string): GeneratedFlashcard[] => [{
    id: 'card', front, back: 'Finite procedures.', sourceExcerpt: sourceText, confidence: 0.9,
    provenance: { promptVersion: FLASHCARD_PROMPT_VERSION, evidenceVerified: true, sourceSha256: 'a'.repeat(64) },
  }];
  try {
    const view = ui.render(render('course-1'));
    assert.equal(ui.screen.getByRole('button', { name: 'Start generation' }).getAttribute('aria-disabled'), 'true');
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Start generation' }));
    assert.equal(requests.length, 0);
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Start generation' }));
    assert.equal(requests[0]?.input.courseId, 'course-1');
    view.rerender(render('course-2'));
    assert.equal(ui.screen.getByRole('checkbox').getAttribute('aria-checked'), 'false');
    assert.equal(ui.screen.getByRole('button', { name: 'Start generation' }).getAttribute('aria-disabled'), 'true');
    await ui.act(async () => { requests[0].resolve(result('Old course question')); });
    assert.equal(ui.screen.queryByLabelText('Card 1 front') === null, true);
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Start generation' }));
    assert.equal(requests[1]?.input.courseId, 'course-2');
    await ui.act(async () => { requests[1].resolve(result('Current course question')); });
    assert.equal((ui.screen.getByLabelText('Card 1 front') as HTMLTextAreaElement).value, 'Current course question');
    assert.equal(ui.screen.getByRole('checkbox').getAttribute('aria-checked'), 'false');
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    assert.equal(ui.screen.getByRole('checkbox').getAttribute('aria-checked'), 'true');
    ui.fireEvent.change(ui.screen.getByLabelText('Card 1 front'), { target: { value: 'Edited current question' } });
    assert.equal(ui.screen.getByRole('checkbox').getAttribute('aria-checked'), 'false');
    assert.equal(publications, 0);
  } finally { ui.cleanup(); configureAIService(null); }
});

test('source notes render literally, survive card edits and publication, and clear when the review source changes', async () => {
  const ui = await import('@testing-library/react');
  const { FlashcardReviewModal } = await import('../src/components/lms/FlashcardReviewModal');
  const note = 'Caption markup <script>show()</script> remains literal; review the original captions.';
  const sourceText = 'Algorithms are finite procedures.';
  let published: GeneratedFlashcard[] = [];
  configureAIService({ generateFlashcards: async () => [{
    id: 'one', front: 'What are algorithms?', back: 'Finite procedures.', sourceExcerpt: sourceText, confidence: 0.9,
    provenance: { promptVersion: FLASHCARD_PROMPT_VERSION, evidenceVerified: true, sourceSha256: 'a'.repeat(64), sourceReviewNotices: [note], model: 'test-<script>literal()</script>' },
  }], extractSyllabus: async () => { throw new Error('Unexpected task'); } });
  const render = (text: string) => React.createElement(FlashcardReviewModal, {
    courseId: 'course-1', sourceText: text, visible: true, onClose: () => {}, onApprove: (cards: GeneratedFlashcard[]) => { published = cards; },
  });
  try {
    const view = ui.render(render(sourceText));
    assert.equal(ui.screen.queryByRole('heading', { name: 'Source processing notes' }) === null, true);
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Start generation' })); });
    assert.equal(ui.screen.getByRole('heading', { name: 'Source processing notes' }).textContent, 'Source processing notes');
    assert.equal(ui.screen.getByText(`• ${note}`).textContent, `• ${note}`);
    assert.equal(view.container.querySelector('script') === null, true);
    assert.match(ui.screen.getByLabelText('AI generation details').textContent || '', /test-<script>literal\(\)<\/script>/);
    assert.equal(ui.screen.getByRole('button', { name: 'Publish 1 review cards' }).getAttribute('aria-disabled'), 'true');
    ui.fireEvent.change(ui.screen.getByLabelText('Card 1 back'), { target: { value: 'Procedures with a finite sequence of steps.' } });
    assert.equal(ui.screen.getByText(`• ${note}`).textContent, `• ${note}`);
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Publish 1 review cards' })); });
    assert.deepEqual(published[0]?.provenance?.sourceReviewNotices, [note]);
    assert.equal(published[0]?.reviewerVerified, true);
    assert.equal(published[0]?.provenance?.model, 'test-<script>literal()</script>');
    view.rerender(render('Replacement lecture source.'));
    assert.equal(ui.screen.queryByRole('heading', { name: 'Source processing notes' }) === null, true);
    assert.equal(ui.screen.queryByLabelText('AI generation details') === null, true);
  } finally { ui.cleanup(); configureAIService(null); }
});

test('flashcard review checks an unresolved saved request and recovers without another POST or automatic approval', async () => {
  const ui = await import('@testing-library/react');
  const { FlashcardReviewModal } = await import('../src/components/lms/FlashcardReviewModal');
  const sourceText = 'Algorithms are finite procedures.';
  const methods: string[] = []; let key = ''; let checks = 0; let publications = 0;
  configureAIService(new InstitutionAIService({ baseUrl: 'https://lms.example.test', authentication: 'same-origin-cookie', requestRecovery: 'status-v1', fetchImpl: async (_url, options) => {
    methods.push(options?.method ?? 'GET');
    if (options?.method === 'POST') { key = new Headers(options.headers).get('X-Request-Id')!; throw new Error('Dropped response'); }
    checks++;
    return Response.json({ id: 'job-1', requestId: key, courseId: 'course-1', task: 'flashcards', status: checks === 1 ? 'processing' : 'succeeded', createdAt: 1_800_000_000_000, expiresAt: 1_800_086_400_000, reviewNotices: [],
      ...(checks === 1 ? {} : { result: { cards: [{ front: 'Recovered question', back: 'Finite procedures.', sourceExcerpt: sourceText, confidence: 0.9 }], provenance: { promptVersion: FLASHCARD_PROMPT_VERSION, evidenceVerified: true, sourceSha256: 'a'.repeat(64), requestId: key } } }),
    });
  } }));
  try {
    ui.render(React.createElement(FlashcardReviewModal, { courseId: 'course-1', sourceText, visible: true, onClose: () => {}, onApprove: () => { publications++; } }));
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Start generation' }));
    assert.deepEqual(methods, [], 'No provider request may start before consent.');
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Start generation' })); });
    assert.equal(ui.screen.getByText(`Request: ${key}`).textContent, `Request: ${key}`);
    assert.equal(ui.screen.queryByRole('button', { name: 'Retry' }) === null, true);
    assert.equal(ui.screen.getByRole('button', { name: 'Start a new generation' }).textContent, 'Start a new generation');
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Check saved result' })); });
    assert.equal(ui.screen.getByText(/Generation is still in progress/).textContent?.includes('Check the saved result'), true);
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Check saved result' })); });
    assert.equal((ui.screen.getByLabelText('Card 1 front') as HTMLTextAreaElement).value, 'Recovered question');
    assert.equal(ui.screen.getByRole('button', { name: 'Publish 1 review cards' }).getAttribute('aria-disabled'), 'true');
    assert.equal(publications, 0); assert.deepEqual(methods, ['POST', 'GET', 'GET']);
  } finally { ui.cleanup(); configureAIService(null); }
});

test('the real syllabus editor recovers a saved draft while retaining consent and requiring human review', async () => {
  const ui = await import('@testing-library/react');
  const sourceText = 'Algorithms are finite procedures.';
  const file = new File([sourceText], 'syllabus.txt', { type: 'text/plain' });
  const asset = { uri: 'blob:syllabus', name: file.name, mimeType: file.type, size: file.size, file };
  let writes = 0;
  Object.assign(globalThis, { __syllabusRecoveryAsset: asset, __syllabusRecoveryState: { contentItems: [], updateCourse: async () => { writes++; } } });
  Object.assign(stubs, {
    'expo-document-picker': 'export const getDocumentAsync = async options => { globalThis.__syllabusPickerOptions = options; return {canceled:false,assets:[globalThis.__syllabusRecoveryAsset]}; };',
    'expo-linear-gradient': 'export const LinearGradient = () => null;',
    'expo-router': 'export const router = {push(){}};',
    '../../lib/store/useLMSStore': 'export const useLMSStore = selector => selector(globalThis.__syllabusRecoveryState);',
    '../../lib/store/useSettingsStore': 'export const useSettingsStore = () => ({});',
    '../../lib/store/selectors': 'export const useCourseRole = () => "teacher";',
    '../../lib/integration/assetService': 'export const assertAssetMatchesAIProvenance = () => {}; export const getAssetService = () => {throw new Error("Unexpected publication before review");};',
    './BaseModal': 'import React from "react"; export const BaseModal = ({visible,children}) => visible ? React.createElement("div",{role:"dialog"},children) : null;',
    './AssessmentGrader': 'export const AssessmentGrader = () => null;',
    './PollResults': 'export const PollResults = () => null;',
    './ExternalGradeCreator': 'export const ExternalGradeCreator = () => null;',
    './PreparedSourcePicker': 'export const PreparedSourcePicker = () => null; export const PreparedAccuracyNotice = () => null;',
  });
  const methods: string[] = []; let key = '';
  configureAIService(new InstitutionAIService({ baseUrl: 'https://lms.example.test', authentication: 'same-origin-cookie', sourceProfile: 'text-v1', requestRecovery: 'status-v1', fetchImpl: async (_url, options) => {
    methods.push(options?.method ?? 'GET');
    if (options?.method === 'POST') { key = new Headers(options.headers).get('X-Request-Id')!; throw new Error('Dropped response'); }
    return Response.json({ id: 'job-1', requestId: key, courseId: 'course-1', task: 'syllabus', status: 'succeeded', createdAt: 1_800_000_000_000, expiresAt: 1_800_086_400_000, reviewNotices: ['Source layout was simplified.'],
      result: { title: 'Recovered syllabus', evidence: [{ field: 'title', sourceExcerpt: sourceText }], warnings: ['No dates supplied.'],
        provenance: { promptVersion: SYLLABUS_PROMPT_VERSION, evidenceVerified: true, sourceSha256: 'a'.repeat(64), documentSha256: 'b'.repeat(64), requestId: key, sourceReviewNotices: ['Source layout was simplified.'], model: 'synthetic-recovered-model' } },
    });
  } }));
  const course: Course = { id: 'course-1', title: 'Course', description: '', status: 'active', presentationMode: 'timeline', participantsCount: 1, materialsCount: 0, staff: [], announcements: [], termStart: 1, termEnd: 2, gradingWeights: {}, visibilityTimer: 0 };
  try {
    const { SyllabusModal } = await import('../src/components/lms/LMSComponents');
    ui.render(React.createElement(SyllabusModal, { visible: true, course, onClose: () => {} }));
    Object.assign(globalThis, { __syllabusRecoveryAsset: { ...asset, name: 'syllabus.pdf', mimeType: 'application/pdf' } });
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: /Select syllabus/ })); });
    assert.equal(ui.screen.queryByRole('button', { name: 'Analyze document' }) === null, true);
    assert.equal(ui.screen.getByText(/This AI service accepts TXT or Markdown syllabi/).textContent?.includes('Export'), true);
    assert.deepEqual(methods, []);
    assert.deepEqual((globalThis as unknown as { __syllabusPickerOptions: { type: string[] } }).__syllabusPickerOptions.type, ['text/plain', 'text/markdown']);
    Object.assign(globalThis, { __syllabusRecoveryAsset: asset });
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: /Select syllabus/ })); });
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Analyze document' })); });
    assert.equal(ui.screen.queryByRole('button', { name: 'Analyze document' }) === null, true);
    assert.equal(ui.screen.getByRole('checkbox').getAttribute('aria-checked'), 'true');
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    assert.equal(ui.screen.getByRole('button', { name: 'Check saved result' }).getAttribute('aria-disabled'), 'true');
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Check saved result' }));
    assert.deepEqual(methods, ['POST']);
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Check saved result' })); });
    assert.equal((ui.screen.getByLabelText('Extracted course title') as HTMLInputElement).value, 'Recovered syllabus');
    assert.match(ui.screen.getByLabelText('AI generation details').textContent || '', /synthetic-recovered-model/);
    assert.equal(ui.screen.getByRole('heading', { name: 'Source processing notes' }).textContent, 'Source processing notes');
    assert.deepEqual(ui.screen.getAllByRole('checkbox').map(node => node.getAttribute('aria-checked')), ['false']);
    assert.equal(ui.screen.getByRole('button', { name: 'Apply reviewed fields' }).getAttribute('aria-disabled'), 'true');
    assert.equal(writes, 0); assert.deepEqual(methods, ['POST', 'GET']);
  } finally { ui.cleanup(); configureAIService(null); Reflect.deleteProperty(globalThis, '__syllabusRecoveryAsset'); Reflect.deleteProperty(globalThis, '__syllabusRecoveryState'); Reflect.deleteProperty(globalThis, '__syllabusPickerOptions'); }
});

test('flashcard review blocks a file unsupported by the connected service before credentials or upload', async () => {
  const ui = await import('@testing-library/react');
  const { FlashcardReviewModal } = await import('../src/components/lms/FlashcardReviewModal');
  let credentials = 0, calls = 0;
  configureAIService(new InstitutionAIService({ baseUrl: 'https://lms.example.test', sourceProfile: 'text-v1', requestRecovery: 'history-v1', getAccessToken: async () => { credentials++; return 'token'; }, fetchImpl: async () => { calls++; throw new Error('Unexpected network'); } }));
  const file = new File(['Unsupported binary fixture'], 'lesson.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  try {
    ui.render(React.createElement(FlashcardReviewModal, { visible: true, courseId: 'course-1', sourceDocument: { uri: 'blob:slides', name: file.name, size: file.size, mimeType: file.type, file }, onClose: () => {}, onApprove: () => {} }));
    assert.match(ui.screen.getByRole('alert').textContent ?? '', /TXT, Markdown, VTT or SRT/);
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    assert.equal(ui.screen.getByRole('button', { name: 'Start generation' }).getAttribute('aria-disabled'), 'true');
    assert.equal(ui.screen.getByRole('button', { name: 'Find saved AI requests' }).getAttribute('aria-disabled'), 'true');
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Start generation' }));
    assert.equal(credentials, 0); assert.equal(calls, 0);
  } finally { ui.cleanup(); configureAIService(null); }
});

test.after(() => { hooks.deregister(); dom.window.close(); });
