import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { DEMO_DESTINATIONS, resolveDemoDestination } from '../src/lib/demoNavigation';
import { demoCourses } from '../src/lib/repositories/memory/demoData';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:4178', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'ShadowRoot', 'MutationObserver'] as const) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) });
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native') return nextResolve('react-native-web', context);
    if (specifier === '../../lib/useThemeColors') return { url: 'demo-guide:theme', shortCircuit: true };
    if (specifier === '../ui/InstitutionBrand') return { url: 'demo-guide:brand', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'demo-guide:theme') return { format: 'module', shortCircuit: true, source: 'export const useThemeColors = () => ({background:"#fff",card:"#fff",text:"#111",textSecondary:"#333",primary:"#005fcc",border:"#777"});' };
    if (url === 'demo-guide:brand') return { format: 'module', shortCircuit: true, source: 'export const InstitutionBrand = () => null;' };
    return nextLoad(url, context);
  },
});
let ui: typeof import('@testing-library/react');
let DemoGuide: typeof import('../src/components/lms/DemoGuide').DemoGuide;
test.before(async () => { ui = await import('@testing-library/react'); ({ DemoGuide } = await import('../src/components/lms/DemoGuide')); });
test.afterEach(() => ui.cleanup());
test.after(() => { hooks.deregister(); dom.window.close(); });

test('every guide destination is operable and maps to the bundled courses or a supported feature', () => {
  const opened: string[] = [];
  ui.render(React.createElement(DemoGuide, { onOpen: key => opened.push(key), onAI: () => opened.push('ai'), onBranding: () => opened.push('branding'), onActivation: () => opened.push('activation') }));
  assert.ok(ui.screen.getByText('Choose a role when you open an LMS feature'));
  for (const item of DEMO_DESTINATIONS) {
    ui.fireEvent.click(ui.screen.getByRole('button', { name: `Open ${item.title}` }));
    if (item.path.startsWith('/admin/course/')) assert.ok(demoCourses.some(course => course.id === item.path.split('/').at(-1)));
  }
  for (const title of ['AI before & after', 'Institution colours', 'Institution setup walkthrough']) ui.fireEvent.click(ui.screen.getByRole('button', { name: `Open ${title}` }));
  assert.deepEqual(opened, [...DEMO_DESTINATIONS.map(item => item.key), 'ai', 'branding', 'activation']);
});

test('guide retains the signed-in identity and states demo limits', () => {
  ui.render(React.createElement(DemoGuide, { signedInName: 'Alice Student', onOpen() {}, onAI() {}, onBranding() {}, onActivation() {} }));
  assert.ok(ui.screen.getByText('Signed in as Alice Student'));
  assert.ok(ui.screen.getByText(/personal flashcards and setup drafts remain saved/));
  assert.ok(ui.screen.getByText(/Live AI and institution SSO require provider setup/));
});

test('post-sign-in destinations reject untrusted URLs, arrays and unknown keys', () => {
  assert.equal(resolveDemoDestination('learn'), '/');
  assert.equal(resolveDemoDestination('workspace'), '/admin/course/c4');
  for (const value of ['https://example.com', '//example.com', '/admin/course/other', 'constructor', ['learn'], null, undefined]) assert.equal(resolveDemoDestination(value), '/admin');
});
