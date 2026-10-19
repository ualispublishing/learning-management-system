import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { configureAIService, InstitutionAIService } from '../src/lib/ai/service';
import { createAIGateway } from '../server/ai';
import { fixture, origin } from '../server/tests/helpers/gateway-fixture';
import type { AIRequestHistoryPage } from '../src/lib/ai/types';
import type { Course } from '../src/types/lms';
import { SYLLABUS_PROMPT_VERSION } from '../src/lib/ai/prompts';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: origin, pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'ShadowRoot', 'MutationObserver'] as const) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) });
const stubs: Record<string, string> = {
  'react-native': 'import React from "react"; export * from "react-native-web"; export const Modal = ({visible,children}) => visible ? React.createElement("div",{role:"dialog"},children) : null;',
  '@expo/vector-icons/Ionicons': 'export default () => null;',
  '../../lib/useThemeColors': 'export const useThemeColors = () => ({background:"#fff",card:"#fff",text:"#111",textSecondary:"#333",primary:"#005fcc",border:"#777",buttonText:"#fff"});',
  './PreparedSourcePicker': 'export const PreparedSourcePicker = () => null; export const PreparedAccuracyNotice = () => null;',
  'expo-document-picker': 'export const getDocumentAsync = async () => ({canceled:false,assets:[globalThis.__historyAsset]});',
  'expo-linear-gradient': 'export const LinearGradient = () => null;',
  'expo-router': 'export const router = {push(){}};',
  '../../lib/store/useLMSStore': 'export const useLMSStore = selector => selector(globalThis.__historyState);',
  '../../lib/store/useSettingsStore': 'export const useSettingsStore = () => ({});',
  '../../lib/store/selectors': 'export const useCourseRole = () => "teacher";',
  '../../lib/integration/assetService': 'export const assertAssetMatchesAIProvenance = () => {}; export const getAssetService = () => {throw new Error("Unexpected publication before review");};',
  './BaseModal': 'import React from "react"; export const BaseModal = ({visible,children}) => visible ? React.createElement("div",{role:"dialog"},children) : null;',
  './AssessmentGrader': 'export const AssessmentGrader = () => null;',
  './PollResults': 'export const PollResults = () => null;',
  './ExternalGradeCreator': 'export const ExternalGradeCreator = () => null;',
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) { return stubs[specifier] ? { url: `history-ui:${specifier}`, shortCircuit: true } : nextResolve(specifier, context.parentURL?.startsWith('history-ui:') ? { ...context, parentURL: import.meta.url } : context); },
  load(url, context, nextLoad) { return url.startsWith('history-ui:') ? { format: 'module', source: stubs[url.slice('history-ui:'.length)], shortCircuit: true } : nextLoad(url, context); },
});

for (const task of ['flashcards', 'syllabus'] as const) test(`${task} editor restores a retained draft after remount through the actual client and gateway`, async t => {
  const ui = await import('@testing-library/react');
  const { FlashcardReviewModal } = await import('../src/components/lms/FlashcardReviewModal');
  const { SyllabusModal } = await import('../src/components/lms/LMSComponents');
  const f = await fixture(); t.after(() => f.close());
  const sourceText = 'Algorithms are finite procedures.';
  const asset = (uri: string) => { const file = new File([sourceText], 'lesson.txt', { type: 'text/plain' }); return { uri, name: file.name, mimeType: file.type, size: file.size, file }; };
  const course: Course = { id: 'course-1', title: 'Course', description: '', status: 'active', presentationMode: 'timeline', participantsCount: 1, materialsCount: 0, staff: [], announcements: [], termStart: 1, termEnd: 2, gradingWeights: {}, visibilityTimer: 0 };
  let calls = 0, writes = 0;
  const routes: string[] = [];
  const gateway = createAIGateway({ origin, auth: f.auth, gateway: f.gateway, policy: { retentionHours: 24, dailyRequestLimit: 10 }, now: () => 1_800_000_000_000,
    provider: { id: 'synthetic-ui-history', generate: async request => {
      calls++;
      const evidence = { sourceExcerpt: request.source.segments[0].text, sourceLocation: request.source.segments[0].location };
      return task === 'flashcards' ? { cards: [{ front: 'Recovered question', back: 'Finite procedures.', confidence: 0.9, ...evidence }] } : { title: 'Recovered syllabus', evidence: [{ field: 'title', ...evidence }], warnings: [] };
    } } });
  const client = () => new InstitutionAIService({ baseUrl: origin, authentication: 'same-origin-cookie', requestRecovery: 'history-v1', fetchImpl: async (url, options) => {
    const path = new URL(String(url)).pathname; routes.push(path);
    const headers = new Headers(options?.headers); headers.set('Cookie', f.cookies['teacher-1']); headers.set('Origin', origin);
    const response = await gateway.handle(new Request(url, { ...options, headers }));
    if (path.endsWith('/generate')) throw new Error('Lost response after server commit');
    return response;
  } });
  const render = (source: ReturnType<typeof asset>) => {
    Object.assign(globalThis, { __historyAsset: source, __historyState: { contentItems: [], updateCourse: async () => { writes++; } } });
    return task === 'flashcards' ? ui.render(React.createElement(FlashcardReviewModal, { visible: true, courseId: course.id, courseTitle: course.title, sourceDocument: source, onClose: () => {}, onApprove: () => { writes++; } }))
      : ui.render(React.createElement(SyllabusModal, { visible: true, course, onClose: () => {} }));
  };
  const select = async () => { if (task === 'syllabus') await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Select syllabus document' })); }); };
  try {
    configureAIService(client());
    render(asset('blob:first')); await select();
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: task === 'flashcards' ? 'Start generation' : 'Analyze document' })); });
    await ui.waitFor(() => assert.equal(ui.screen.queryByRole('button', { name: 'Check saved result' }) !== null, true));
    assert.equal(calls, 1); assert.equal(ui.screen.getByRole('button', { name: 'Check saved result' }) !== null, true);
    ui.cleanup(); configureAIService(client());
    render(asset('blob:reselected')); await select();
    assert.equal(ui.screen.getByRole('button', { name: 'Find saved AI requests' }).getAttribute('aria-disabled'), 'true');
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Find saved AI requests' })); assert.equal(routes.length, 1);
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Find saved AI requests' })); });
    assert.equal(ui.screen.getByRole('heading', { name: 'Your saved requests for this course' }) !== null, true);
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    assert.equal(ui.screen.getByRole('button', { name: /Recover saved request/ }).getAttribute('aria-disabled'), 'true');
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: /Recover saved request/ })); });
    await ui.waitFor(() => assert.equal(ui.screen.queryByLabelText(task === 'flashcards' ? 'Card 1 front' : 'Extracted course title') !== null, true));
    const field = ui.screen.getByLabelText(task === 'flashcards' ? 'Card 1 front' : 'Extracted course title') as HTMLInputElement;
    assert.equal(field.value, task === 'flashcards' ? 'Recovered question' : 'Recovered syllabus');
    assert.equal(ui.screen.getByRole('button', { name: task === 'flashcards' ? 'Publish 1 review cards' : 'Apply reviewed fields' }).getAttribute('aria-disabled'), 'true');
    assert.equal(ui.screen.getByRole('checkbox').getAttribute('aria-checked'), 'false');
    assert.equal(calls, 1); assert.equal(writes, 0); assert.equal(routes.length, 3);
    assert.equal(routes[0], '/lms/v1/ai/generate'); assert.equal(routes[1], '/lms/v1/ai/requests'); assert.equal(routes[2].endsWith('/recover'), true);
  } finally { ui.cleanup(); configureAIService(null); Reflect.deleteProperty(globalThis, '__historyAsset'); Reflect.deleteProperty(globalThis, '__historyState'); }
});

test('course changes discard late history pages and do not poll', async () => {
  const ui = await import('@testing-library/react');
  const { AIRequestHistoryPicker } = await import('../src/components/lms/AIRequestHistoryPicker');
  let resolve!: (page: AIRequestHistoryPage) => void; let calls = 0;
  configureAIService({ generateFlashcards: async () => { throw new Error('Unexpected generation'); }, extractSyllabus: async () => { throw new Error('Unexpected generation'); },
    requestHistory: { list: () => { calls++; return new Promise(value => { resolve = value; }); }, recover: async () => { throw new Error('Unexpected recovery'); } } });
  const render = (courseId: string) => React.createElement(AIRequestHistoryPicker, { task: 'flashcards', input: { courseId, sourceText: 'Source.' }, disabled: false, onSelect: () => {} });
  try {
    const view = ui.render(render('course-1'));
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Find saved AI requests' }));
    view.rerender(render('course-2'));
    await ui.act(async () => { resolve({ items: [], nextCursor: null }); });
    assert.equal(ui.screen.queryByRole('heading', { name: 'Your saved requests for this course' }) === null, true);
    assert.equal(calls, 1);
  } finally { ui.cleanup(); configureAIService(null); }
});

test('switching course during syllabus recovery discards the old source and late draft', async () => {
  const ui = await import('@testing-library/react');
  const { SyllabusModal } = await import('../src/components/lms/LMSComponents');
  const text = 'Algorithms are finite procedures.';
  const file = new File([text], 'syllabus.txt', { type: 'text/plain' });
  Object.assign(globalThis, { __historyAsset: { uri: 'blob:syllabus', name: file.name, mimeType: file.type, size: file.size, file }, __historyState: { contentItems: [], updateCourse: async () => { throw new Error('Unexpected publication'); } } });
  let resolve!: (value: unknown) => void; let recoveries = 0;
  configureAIService({ generateFlashcards: async () => { throw new Error('Unexpected generation'); }, extractSyllabus: async () => { throw new Error('Unexpected generation'); },
    requestHistory: {
      list: async () => ({ items: [{ id: 'job', requestId: 'saved', courseId: 'course-1', task: 'syllabus', status: 'succeeded', createdAt: 1_800_000_000_000, expiresAt: 1_800_086_400_000, fileName: file.name, hasPastedText: false, locale: 'en', requestedCardCount: 30 }], nextCursor: null }),
      recover: () => { recoveries++; return new Promise(value => { resolve = value; }); },
    } });
  const render = (id: string) => React.createElement(SyllabusModal, { visible: true, onClose: () => {}, course: { id, title: 'Same title', description: '', staff: [], announcements: [], gradingWeights: {} } as unknown as Course });
  try {
    const view = ui.render(render('course-1'));
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Select syllabus document' })); });
    ui.fireEvent.click(ui.screen.getByRole('checkbox'));
    await ui.act(async () => { ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Find saved AI requests' })); });
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Recover saved request saved' }));
    assert.equal(recoveries, 1);
    view.rerender(render('course-2'));
    await ui.act(async () => { resolve({ title: 'Old course result', evidence: [{ field: 'title', sourceExcerpt: text }], warnings: [], provenance: { promptVersion: SYLLABUS_PROMPT_VERSION, evidenceVerified: true, sourceSha256: 'a'.repeat(64), documentSha256: 'b'.repeat(64), requestId: 'saved' } }); });
    assert.equal(ui.screen.queryByLabelText('Extracted course title') === null, true);
    assert.equal(ui.screen.queryByRole('checkbox') === null, true);
    assert.equal(ui.screen.getByRole('button', { name: 'Select syllabus document' }) !== null, true);
  } finally { ui.cleanup(); configureAIService(null); Reflect.deleteProperty(globalThis, '__historyAsset'); Reflect.deleteProperty(globalThis, '__historyState'); }
});

test.after(() => { hooks.deregister(); dom.window.close(); });
