import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';

// The root shell is real; adapters control font and institution startup results.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://lms.test/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'ShadowRoot', 'MutationObserver'] as const) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true, __DEV__: false,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
});
const state = {
  fonts: [false, null] as [boolean, Error | null],
  availableFonts: new Set<string>(),
  currentUserId: null as string | null,
  initializationError: null as Error | null,
  bootstrap: null as Promise<void> | null,
  async initializeMocks() {
    if (state.bootstrap) await state.bootstrap;
    if (state.initializationError) throw state.initializationError;
  },
  async login() {}, async logout() {}, async refreshSharedDemoState() {},
  async loadSettings() {}, setAppContentWidth() {},
  language: 'en', theme: 'light', appContentWidth: 800,
};
Object.assign(globalThis, { __fontStartupState: state });
const sources: Record<string, string> = {
  'font-startup:fonts': 'export const useFonts = () => globalThis.__fontStartupState.fonts; export const isLoaded = name => globalThis.__fontStartupState.availableFonts.has(name);',
  'font-startup:font-assets': 'export const Inter_400Regular = 1; export const Inter_600SemiBold = 2; export const Inter_800ExtraBold = 3;',
  'font-startup:settings': 'export const useSettingsStore = () => globalThis.__fontStartupState;',
  'font-startup:lms': 'export const useLMSStore = selector => selector(globalThis.__fontStartupState); useLMSStore.getState = () => globalThis.__fontStartupState;',
  'font-startup:i18n': 'export const setI18nConfig = () => {};',
  'font-startup:router': 'import React from "react"; export const Stack = () => React.createElement("div", null, "Authenticated application"); Stack.Screen = () => null; export const useRouter = () => ({replace() {}}); export const usePathname = () => "/study/test";',
  'font-startup:theme': 'export const useThemeColors = () => ({background:"#fff",card:"#fff",border:"#777",text:"#111",textSecondary:"#333",primary:"#005fcc",buttonText:"#fff",error:"#a00"});',
  'font-startup:header': 'export const GlobalHeader = () => null;',
  'font-startup:status': 'export const StatusBar = () => null;',
  'font-startup:gesture': 'export {View as GestureHandlerRootView} from "react-native";',
  'font-startup:icon': 'export default function Icon() { return null; }',
  'font-startup:demo': 'export const isSharedDemoMode = false; export const subscribeToSharedDemoChanges = () => () => {};',
  'font-startup:demo-ui': 'export const DemoSignIn = () => null;',
};
const stubs: Record<string, string> = {
  'expo-font': 'font-startup:fonts',
  '../lib/store/useSettingsStore': 'font-startup:settings',
  '../lib/store/useLMSStore': 'font-startup:lms',
  '../lib/i18n': 'font-startup:i18n',
  'expo-router': 'font-startup:router',
  '../lib/useThemeColors': 'font-startup:theme',
  '../components/ui/GlobalHeader': 'font-startup:header',
  'expo-status-bar': 'font-startup:status',
  'react-native-gesture-handler': 'font-startup:gesture',
  '@expo/vector-icons/Ionicons': 'font-startup:icon',
  '../lib/repositories/remote/SharedDemoRepositoryFactory': 'font-startup:demo',
  '../components/lms/DemoSignIn': 'font-startup:demo-ui',
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native') return nextResolve('react-native-web', context);
    const url = specifier.startsWith('@expo-google-fonts/inter/') ? 'font-startup:font-assets' : stubs[specifier];
    return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return sources[url] ? { format: 'module', source: sources[url], shortCircuit: true } : nextLoad(url, context);
  },
});
let ui: typeof import('@testing-library/react');
let Layout: typeof import('../src/app/_layout').default;
let getAppFontFamilies: typeof import('../src/lib/appFonts').getAppFontFamilies;
test.before(async () => {
  ui = await import('@testing-library/react');
  ({ default: Layout } = await import('../src/app/_layout'));
  ({ getAppFontFamilies } = await import('../src/lib/appFonts'));
});
test.beforeEach(() => {
  state.fonts = [false, null]; state.availableFonts.clear(); state.currentUserId = null;
  state.initializationError = null; state.bootstrap = null;
});
test.afterEach(() => ui.cleanup());

test('font rejection exits the spinner and preserves the production sign-in gate', async () => {
  const view = ui.render(React.createElement(Layout));
  await ui.act(async () => undefined);
  assert.ok(ui.screen.getByLabelText('Loading learning management system'));
  state.fonts = [false, new Error('Font download failed')];
  view.rerender(React.createElement(Layout));
  assert.ok(ui.screen.getByRole('button', { name: 'Continue with institution SSO' }));
  assert.equal(ui.screen.queryByLabelText('Loading learning management system'), null);
  assert.equal(ui.screen.queryByText('Authenticated application'), null);
});

test('font fallback still waits for institution bootstrap and allows its retry', async () => {
  state.fonts = [false, new Error('Font download failed')];
  state.currentUserId = 'learner';
  state.initializationError = new Error('Institution connection unavailable');
  const bootstrap = Promise.withResolvers<void>();
  state.bootstrap = bootstrap.promise;
  ui.render(React.createElement(Layout));
  assert.ok(ui.screen.getByLabelText('Loading learning management system'));
  await ui.act(async () => bootstrap.resolve());
  assert.ok(ui.screen.getByText('The LMS could not load.'));
  assert.equal(ui.screen.queryByText('Authenticated application'), null);
  state.initializationError = null;
  ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Retry' }));
  assert.ok(await ui.screen.findByText('Authenticated application'));
});

test('successful font loading retains normal application startup', async () => {
  state.fonts = [true, null]; state.currentUserId = 'learner';
  ui.render(React.createElement(Layout));
  assert.ok(await ui.screen.findByText('Authenticated application'));
});

test('typography uses system fonts for missing faces without changing the user preference', () => {
  const systemFonts = { regular: undefined, semiBold: undefined, bold: undefined };
  assert.deepEqual(getAppFontFamilies(true), systemFonts);
  state.availableFonts.add('Inter_400Regular');
  assert.deepEqual(getAppFontFamilies(true), { ...systemFonts, regular: 'Inter_400Regular' });
  state.availableFonts.add('Inter_600SemiBold'); state.availableFonts.add('Inter_800ExtraBold');
  assert.deepEqual(getAppFontFamilies(true), { regular: 'Inter_400Regular', semiBold: 'Inter_600SemiBold', bold: 'Inter_800ExtraBold' });
  assert.deepEqual(getAppFontFamilies(false), systemFonts);
});

test.after(() => {
  ui?.cleanup(); hooks.deregister(); dom.window.close();
  Reflect.deleteProperty(globalThis, '__fontStartupState');
});
