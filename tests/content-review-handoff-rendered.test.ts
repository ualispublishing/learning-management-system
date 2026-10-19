import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import type { BaseContentManagerChildProps } from '../src/components/lms/shared/BaseContentManager';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'ShadowRoot', 'MutationObserver'] as const) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, __DEV__: true, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) });
let writes = 0;
const state = { courses: [{ id: 'course', title: 'Example course', gradingWeights: {} }], contentItems: [], currentUserId: 'teacher', addContentItem: async () => { writes++; }, addContentItems: async () => { writes++; } };
Object.assign(globalThis, { __contentReviewTestState: state });

// Keep the manager real and model the editor/review as lightweight dialogs.
// This checks modal ownership, draft lifetime and absence of writes, without
// relying on CSS animation completion in jsdom (verified separately in-browser).
const stubs: Record<string, string> = {
  'react-native': 'import React from "react"; export * from "react-native-web"; export const Modal = ({visible,children}) => visible ? React.createElement("div",{role:"dialog"},children) : null;',
  '@expo/vector-icons/Ionicons': 'export default () => null;',
  'expo-document-picker': 'export const getDocumentAsync = async () => ({canceled:true});',
  '../../../lib/useThemeColors': 'export const useThemeColors = () => ({background:"#fff",card:"#fff",text:"#111",textSecondary:"#333",primary:"#005fcc",border:"#777"});',
  '../../../lib/store/useLMSStore': 'export const useLMSStore = selector => selector(globalThis.__contentReviewTestState);',
  '../../../lib/store/selectors': 'export const useCourseMembership = () => ({id:"member"}); export const useCourseRole = () => "teacher";',
  '../../../lib/ai': 'export const FLASHCARD_PROMPT_VERSION = "test"; export const attachAIProcessingAttestation = value => value; export const assertConfiguredAISource = () => {};',
  '../../../lib/integration/assetService': 'export const assertAssetMatchesAIProvenance = () => {}; export const getAssetService = () => {throw new Error("Unexpected upload before approval");};',
  './UnifiedContentCreator': `import React, {useState} from "react";
    export const UnifiedContentCreator = ({visible, initialData, onSave}) => {
      const [form,setForm] = useState(initialData);
      if (!visible) return null;
      return React.createElement("div", {role:"dialog"},
        React.createElement("input", {"aria-label":"Content title",value:form.title,onChange:e=>setForm({...form,title:e.target.value})}),
        React.createElement("textarea", {"aria-label":"Content description",value:form.description,onChange:e=>setForm({...form,description:e.target.value})}),
        React.createElement("input", {type:"checkbox",role:"switch","aria-label":"Generate a reviewed flashcard set",checked:form.generateFlashcards,onChange:e=>setForm({...form,generateFlashcards:e.target.checked})}),
        React.createElement("button", {onClick:()=>onSave("title_link",form)}, "Save and add to course"));
    };`,
  '../AssessmentBuilder': 'export const AssessmentBuilder = () => null;',
  '../AssessmentGrader': 'export const AssessmentGrader = () => null;',
  '../PopQuizHost': 'export const PopQuizHost = () => null;',
  '../DatePicker': 'export const DatePicker = () => null;',
  '../FlashcardReviewModal': 'import React from "react"; import {Modal} from "react-native"; export const FlashcardReviewModal = ({visible,onClose,sourceText,courseId}) => React.createElement(Modal,{visible},React.createElement("p",{"data-testid":"review-source","data-course-id":courseId},sourceText),React.createElement("button",{onClick:onClose},"Cancel review"));',
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) { return stubs[specifier] ? { url: `review-handoff:${specifier}`, shortCircuit: true } : nextResolve(specifier, context.parentURL?.startsWith('review-handoff:') ? { ...context, parentURL: import.meta.url } : context); },
  load(url, context, nextLoad) { return url.startsWith('review-handoff:') ? { format: 'module', source: stubs[url.slice('review-handoff:'.length)], shortCircuit: true } : nextLoad(url, context); },
});

test('content review has one interactive modal and cancellation restores the same unsaved draft', async () => {
  const ui = await import('@testing-library/react');
  // Compare primitive values on failure: formatting a React-owned DOM node can
  // traverse its cyclic internals and exhaust memory in Node's assertion printer.
  try {
    const { BaseContentManager } = await import('../src/components/lms/shared/BaseContentManager');
    ui.render(React.createElement(BaseContentManager, { courseId: 'course', renderContent: (props: BaseContentManagerChildProps) => React.createElement('button', { onClick: () => props.openAddModal('material') }, 'Add material') }));
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Add material' }));
    ui.fireEvent.change(ui.screen.getByLabelText('Content title'), { target: { value: 'Keep my title' } });
    ui.fireEvent.change(ui.screen.getByLabelText('Content description'), { target: { value: 'An algorithm has a way to stop.' } });
    const generationSwitch = ui.screen.getByRole('switch', { name: 'Generate a reviewed flashcard set' });
    ui.fireEvent.click(generationSwitch);
    for (let attempt = 0; attempt < 2; attempt++) {
      ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Save and add to course' }));
      await ui.screen.findByRole('button', { name: 'Cancel review' });
      await ui.act(async () => {});
      assert.equal(ui.screen.getAllByRole('dialog').length, 1, 'the content editor must not cover review');
      assert.ok(ui.screen.queryByRole('textbox', { name: 'Content title' }) === null, 'The editor must not be interactive during review.');
      assert.ok(ui.screen.queryByText('An algorithm has a way to stop.') !== null, 'Review receives the source text.');
      assert.equal(ui.screen.getByTestId('review-source').getAttribute('data-course-id'), 'course', 'Review receives its actual course scope.');
      assert.equal(writes, 0, 'opening review cannot publish course content');
      ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Cancel review' }));
      assert.equal(ui.screen.getAllByRole('dialog').length, 1);
      assert.equal((ui.screen.getByLabelText('Content title') as HTMLInputElement).value, 'Keep my title');
      assert.equal((ui.screen.getByLabelText('Content description') as HTMLInputElement).value, 'An algorithm has a way to stop.');
      assert.equal((ui.screen.getByRole('switch', { name: 'Generate a reviewed flashcard set' }) as HTMLInputElement).checked, true);
    }
  } finally { ui.cleanup(); }
});

test.after(() => { hooks.deregister(); dom.window.close(); Reflect.deleteProperty(globalThis, '__contentReviewTestState'); });
