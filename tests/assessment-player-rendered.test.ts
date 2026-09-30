import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import type { ContentItem, StudentSubmission } from '../src/types/lms';

// Render the real component with React Native Web. Only application services and
// native file/icon adapters are substituted; inputs, events, and modal are real DOM.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://lms.test/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'ShadowRoot', 'MutationObserver'] as const) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
});
const item: ContentItem = {
  id: 'assessment', courseId: 'course', category: 'coursework', title: 'Save reliability',
  presentationSlot: 'current', createdAt: 1, isGraded: false, workType: 'individual',
  quizConfig: { questionsPerPage: 'all', maxAttempts: 2, allowRevisit: true },
  questions: [{ id: 'answer', label: 'Response', content: 'Explain your reasoning.', answerType: 'text', points: 1 }],
};
let failing = false;
let hold: Promise<void> | null = null;
let writes = 0;
const state = {
  currentUserId: 'learner',
  courses: [{ id: 'course', staff: [{ id: 'learner', name: 'Learner', role: 'student' }] }],
  submissions: [] as StudentSubmission[],
  async addSubmission(submission: StudentSubmission) { state.submissions.push(structuredClone(submission)); },
  async updateSubmission(id: string, updates: Partial<StudentSubmission>) {
    writes++;
    if (hold) await hold;
    if (failing) throw new Error('Save connection unavailable');
    state.submissions = state.submissions.map(submission => submission.id === id ? { ...submission, ...structuredClone(updates) } : submission);
  },
};
Object.assign(globalThis, { __assessmentRenderedState: state });
const sources: Record<string, string> = {
  'assessment-rendered:store': 'export const useLMSStore = selector => selector(globalThis.__assessmentRenderedState);',
  'assessment-rendered:theme': 'export const useThemeColors = () => ({background:"#fff",card:"#fff",border:"#777",text:"#111",textSecondary:"#333",primary:"#005fcc",buttonText:"#fff",error:"#a00"});',
  'assessment-rendered:learning': 'export const getLearningStateService = () => ({load: async () => null, save: async () => null}); export const recordConsentedLearningActivity = async () => {};',
  'assessment-rendered:picker': 'export const getDocumentAsync = async () => ({canceled: true});',
  'assessment-rendered:icon': 'export default function Icon() { return null; }',
  'assessment-rendered:assets': 'export const getAssetService = () => { throw new Error("Unexpected upload"); };',
};
const stubs: Record<string, string> = {
  '../../lib/store/useLMSStore': 'assessment-rendered:store',
  '../../lib/useThemeColors': 'assessment-rendered:theme',
  '../../lib/learningState': 'assessment-rendered:learning',
  'expo-document-picker': 'assessment-rendered:picker',
  '@expo/vector-icons/Ionicons': 'assessment-rendered:icon',
  '../../lib/integration/assetService': 'assessment-rendered:assets',
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native') return nextResolve('react-native-web', context);
    const url = stubs[specifier];
    return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return sources[url] ? { format: 'module', source: sources[url], shortCircuit: true } : nextLoad(url, context);
  },
});
let ui: typeof import('@testing-library/react');
let AssessmentPlayer: typeof import('../src/components/lms/AssessmentPlayer').AssessmentPlayer;
test.before(async () => {
  ui = await import('@testing-library/react');
  ({ AssessmentPlayer } = await import('../src/components/lms/AssessmentPlayer'));
});
const reset = () => {
  failing = false; hold = null; writes = 0;
  state.submissions = [{ id: 'draft', studentId: 'learner', contentItemId: item.id, courseId: item.courseId, submittedAt: Date.now(), status: 'draft', responses: [], attemptNumber: 1 }];
};

test('rendered assessment keeps failed answers open, retries on exit, and restores acknowledged answers', async () => {
  const { render, screen, fireEvent, waitFor, cleanup, act } = ui;
  reset();
  let closed = 0;
  const props = { item, onClose: () => { closed++; } };
  render(React.createElement(AssessmentPlayer, props));
  const input = await screen.findByRole('textbox', { name: 'Answer for Response' });
  failing = true;
  fireEvent.change(input, { target: { value: 'My answer must survive' } });
  await screen.findByText('Save connection unavailable');
  assert.equal(writes, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Exit assessment' }));
  await waitFor(() => assert.equal(writes, 2));
  await act(async () => undefined);
  assert.equal(closed, 0);
  assert.equal((input as HTMLTextAreaElement).value, 'My answer must survive');
  failing = false;
  fireEvent.click(screen.getByRole('button', { name: 'Exit assessment' }));
  await waitFor(() => assert.equal(closed, 1));
  assert.equal(state.submissions[0].responses[0].answer, 'My answer must survive');
  cleanup();
  render(React.createElement(AssessmentPlayer, props));
  assert.equal((await screen.findByRole('textbox', { name: 'Answer for Response' }) as HTMLTextAreaElement).value, 'My answer must survive');
  cleanup();
});

test('rendered exit waits for slow autosave and the latest answer', async () => {
  const { render, screen, fireEvent, waitFor, cleanup, act } = ui;
  reset();
  let closed = false;
  const deferred = Promise.withResolvers<void>();
  hold = deferred.promise;
  render(React.createElement(AssessmentPlayer, { item, onClose: () => { closed = true; } }));
  const input = await screen.findByRole('textbox', { name: 'Answer for Response' });
  fireEvent.change(input, { target: { value: 'First' } });
  await waitFor(() => assert.equal(writes, 1));
  fireEvent.change(input, { target: { value: 'Latest' } });
  fireEvent.click(screen.getByRole('button', { name: 'Exit assessment' }));
  assert.equal(closed, false);
  await act(async () => { deferred.resolve(); });
  await waitFor(() => assert.equal(closed, true));
  assert.equal(state.submissions[0].responses[0].answer, 'Latest');
  assert.equal(writes, 2);
  cleanup();
});

test.after(() => {
  ui?.cleanup(); hooks.deregister(); dom.window.close();
  Reflect.deleteProperty(globalThis, '__assessmentRenderedState');
});
