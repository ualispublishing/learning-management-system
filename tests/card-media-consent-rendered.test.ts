import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import type { CardData } from '../src/components/ui/CardDisplay';

// Real CardDisplay, Markdown, URI validation, React reconciliation, and DOM
// controls. Native adapters record every load input, including during render;
// no external media is fetched by this harness.
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
interface Player { uri: string | null; released: boolean; plays: number }
const state = {
  loads: [] as string[], players: [] as Player[], audioLoads: [] as string[], failPlay: false,
};
Object.assign(globalThis, { __cardConsentState: state });
const sources: Record<string, string> = {
  'card-consent:settings': 'export const useSettingsStore = () => ({ reducedMotion: true, continuousCardView: false });',
  'card-consent:theme': 'export const useThemeColors = () => ({background:"#fff",card:"#fff",border:"#777",text:"#111",textSecondary:"#333",primary:"#005fcc",buttonText:"#fff",error:"#a00"});',
  'card-consent:icon': 'export default function Icon() { return null; }',
  'card-consent:fit-image': 'export default function FitImage() { return null; }',
  'card-consent:files': 'export const documentDirectory = "file:///app/documents/";',
  'card-consent:speech': 'export const stop = () => {}; export const speak = () => {};',
  'card-consent:events': 'export const useEvent = (_player, _event, initial) => initial;',
  'card-consent:animation': `import React from 'react'; import { View } from 'react-native';
    export default { View }; export const useSharedValue = value => React.useRef({ value }).current;
    export const useAnimatedStyle = fn => fn(); export const withSpring = value => value;
    export const interpolate = (value, inputs, outputs) => outputs[value ? outputs.length - 1 : 0];`,
  'card-consent:image': `import React from 'react';
    export function Image({source, accessibilityLabel, onLoadEnd}) {
      globalThis.__cardConsentState.loads.push(source.uri);
      React.useEffect(() => { onLoadEnd?.(); }, [source.uri]);
      return React.createElement('div', {role: 'img', 'aria-label': accessibilityLabel, 'data-media-uri': source.uri});
    }`,
  'card-consent:video': `import React from 'react';
    export function useVideoPlayer(source) {
      const uri = source?.uri ?? null;
      const player = React.useMemo(() => {
        const state = globalThis.__cardConsentState;
        if (uri) state.loads.push(uri);
        const player = {uri, released: false, plays: 0, status: 'readyToPlay', playing: false,
          play() { if (state.failPlay) throw new Error('Decoder unavailable'); this.plays++; }, pause() {} };
        state.players.push(player); return player;
      }, [uri]);
      React.useEffect(() => () => { player.released = true; }, [player]);
      return player;
    }
    export function VideoView({player, nativeControls}) {
      return React.createElement('div', {'data-testid': 'video', 'data-media-uri': player.uri, 'data-native-controls': String(nativeControls)});
    }`,
  'card-consent:audio': `import React from 'react';
    export const RecordingPresets = {HIGH_QUALITY: {}};
    export const requestRecordingPermissionsAsync = async () => ({granted: false});
    export const setAudioModeAsync = async () => {};
    export const useAudioRecorder = () => React.useMemo(() => ({stop: async () => {}}), []);
    export const useAudioPlayer = source => {
      if (source) globalThis.__cardConsentState.audioLoads.push(source.uri);
      return React.useMemo(() => ({replace(source) {globalThis.__cardConsentState.audioLoads.push(source.uri);}, play() {}, pause() {}, seekTo: async () => {}}), []);
    };
    export const useAudioPlayerStatus = () => ({playing: false, didJustFinish: false});`,
};
const stubs: Record<string, string> = {
  '../../lib/store/useSettingsStore': 'card-consent:settings',
  '../../lib/useThemeColors': 'card-consent:theme',
  '@expo/vector-icons/Ionicons': 'card-consent:icon',
  'expo-file-system/legacy': 'card-consent:files',
  'expo-speech': 'card-consent:speech',
  'expo': 'card-consent:events',
  'react-native-reanimated': 'card-consent:animation',
  'expo-image': 'card-consent:image',
  'expo-video': 'card-consent:video',
  'expo-audio': 'card-consent:audio',
  'react-native-fit-image': 'card-consent:fit-image',
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native') return nextResolve('react-native-web', context);
    const url = stubs[specifier];
    if (url) return { url, shortCircuit: true };
    const resolved = nextResolve(specifier, context);
    // A virtual file extension avoids tsx treating Metro's JSX-bearing .js as
    // plain JavaScript. The original directory preserves dependency resolution.
    return resolved.url.includes('/node_modules/react-native-markdown-display/') && resolved.url.endsWith('.js')
      ? { url: resolved.url.replace(/\.js$/, '.markdown-test'), format: 'module', shortCircuit: true }
      : resolved;
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.markdown-test')) {
      const source = ts.transpileModule(readFileSync(new URL(url.replace(/\.markdown-test$/, '.js')), 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, allowJs: true },
        fileName: 'markdown.jsx',
      }).outputText;
      return { format: 'module', source, shortCircuit: true };
    }
    return sources[url] ? { format: 'module', source: sources[url], shortCircuit: true } : nextLoad(url, context);
  },
});
let ui: typeof import('@testing-library/react');
let CardDisplay: typeof import('../src/components/ui/CardDisplay').CardDisplay;
test.before(async () => {
  ui = await import('@testing-library/react');
  ({ CardDisplay } = await import('../src/components/ui/CardDisplay'));
});
test.beforeEach(() => {
  state.loads.length = 0; state.players.length = 0; state.audioLoads.length = 0; state.failPlay = false;
});
test.afterEach(() => ui.cleanup());

const a = 'https://media-a.example/first';
const b = 'https://media-b.example/second';
const props = { isRevealed: true, onReveal() {}, onUpdateNotes() {} };
const variants = [
  { name: 'fullscreen image', kind: 'image', content: (uri: string) => `[IMAGE:${uri}]` },
  { name: 'inline image', kind: 'image', content: (uri: string) => `Description [IMAGE:${uri}]` },
  { name: 'fullscreen video', kind: 'video', content: (uri: string) => `[VIDEO:${uri}]` },
  { name: 'inline video', kind: 'video', content: (uri: string) => `Description [VIDEO:${uri}]` },
];

for (const variant of variants) {
  test(`${variant.name}: changed depth destinations are blocked before any load, including same-host paths and queries`, () => {
    const card: CardData = { id: 'card', front: 'Question', back: 'Answer', depthLayers: [variant.content(a), variant.content(b)] };
    const view = ui.render(React.createElement(CardDisplay, { ...props, card, depthIndex: 0 }));
    assert.equal(state.loads.length, 0);
    ui.fireEvent.click(ui.screen.getByRole('button', { name: `Load remote ${variant.kind} from media-a.example` }));
    assert.ok(state.loads.includes(a));
    assert.equal(state.players.some(player => player.plays > 0), false, 'Approval must not autoplay');

    // Canonical aliases remain the same destination, and ordinary rerenders do
    // not reset approval. This also covers changing the contents of an editor preview.
    const aliasCard = { ...card, depthLayers: [variant.content('https://MEDIA-A.example:443/first'), variant.content(b)] };
    view.rerender(React.createElement(CardDisplay, { ...props, card: aliasCard, depthIndex: 0 }));
    assert.equal(ui.screen.queryByRole('button', { name: /Load remote/ }), null);

    // A new URL at the same part index must reset synchronously, before a media
    // adapter sees it; checking only the eventual prompt would miss an effect-reset leak.
    for (const destination of [b, `${b}?version=2`, 'https://media-b.example/third', a]) {
      state.loads.length = 0;
      const previouslyLoaded = state.players.filter(player => player.uri && !player.released);
      const nextCard = { ...card, depthLayers: [variant.content(a), variant.content(destination)] };
      view.rerender(React.createElement(CardDisplay, { ...props, card: nextCard, depthIndex: 1 }));
      assert.equal(state.loads.length, 0, `Unapproved destination reached a load sink: ${destination}`);
      assert.ok(previouslyLoaded.every(player => player.released), 'Previous video resources should be released');
      ui.fireEvent.click(ui.screen.getByRole('button', { name: `Load remote ${variant.kind} from ${new URL(destination).hostname}` }));
      assert.ok(state.loads.includes(destination));
      if (variant.kind === 'video') {
        assert.equal(ui.screen.getByTestId('video').getAttribute('data-native-controls'), 'false');
        ui.fireEvent.click(ui.screen.getByRole('button', { name: variant.name === 'fullscreen video' ? 'Play fullscreen card video' : 'Play card video' }));
        assert.equal(ui.screen.getByTestId('video').getAttribute('data-native-controls'), 'true');
      }
    }
  });

  test(`${variant.name}: local media still loads; invalid and later remote media cannot inherit consent`, () => {
    const card: CardData = { id: 'card', front: 'Question', back: variant.content('local.png') };
    const view = ui.render(React.createElement(CardDisplay, { ...props, card }));
    assert.ok(state.loads.includes('file:///app/documents/local.png'));
    state.loads.length = 0;
    view.rerender(React.createElement(CardDisplay, { ...props, card: { ...card, back: variant.content(a) } }));
    assert.equal(state.loads.length, 0);
    ui.fireEvent.click(ui.screen.getByRole('button', { name: `Load remote ${variant.kind} from media-a.example` }));
    assert.ok(state.loads.includes(a));
    for (const invalid of ['http://media-a.example/file', 'https://user:password@media-a.example/file', '../private.png']) {
      state.loads.length = 0;
      view.rerender(React.createElement(CardDisplay, { ...props, card: { ...card, back: variant.content(invalid) } }));
      assert.equal(state.loads.length, 0);
      assert.ok(ui.screen.getByText('Media unavailable'));
    }
    view.rerender(React.createElement(CardDisplay, { ...props, card: { ...card, back: variant.content(a) } }));
    assert.equal(state.loads.length, 0, 'Returning after invalid media needs a fresh approval');
    assert.ok(ui.screen.getByRole('button', { name: `Load remote ${variant.kind} from media-a.example` }));
  });
}

test('Markdown images use the same destination boundary', () => {
  const card: CardData = { id: 'card', front: 'Question', back: `Description\n\n![Illustration](${a})` };
  const view = ui.render(React.createElement(CardDisplay, { ...props, card }));
  assert.equal(state.loads.length, 0);
  ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Load remote image from media-a.example' }));
  assert.ok(ui.screen.getByRole('img', { name: 'Illustration' }));
  state.loads.length = 0;
  view.rerender(React.createElement(CardDisplay, { ...props, card: { ...card, back: `Description\n\n![Illustration](${b})` } }));
  assert.equal(state.loads.length, 0);
  assert.ok(ui.screen.getByRole('button', { name: 'Load remote image from media-b.example' }));
});

for (const fullscreen of [false, true]) {
  test(`${fullscreen ? 'fullscreen' : 'inline'} video: changing destination clears a playback error`, () => {
    const content = (uri: string) => `${fullscreen ? '' : 'Description '}[VIDEO:${uri}]`;
    const card: CardData = { id: 'card', front: 'Question', back: content(a) };
    const view = ui.render(React.createElement(CardDisplay, { ...props, card }));
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Load remote video from media-a.example' }));
    state.failPlay = true;
    ui.fireEvent.click(ui.screen.getByRole('button', { name: fullscreen ? 'Play fullscreen card video' : 'Play card video' }));
    assert.ok(ui.screen.getByRole('alert'));
    state.failPlay = false;
    view.rerender(React.createElement(CardDisplay, { ...props, card: { ...card, back: content(b) } }));
    ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Load remote video from media-b.example' }));
    assert.equal(ui.screen.queryByRole('alert'), null);
    assert.ok(ui.screen.getByRole('button', { name: fullscreen ? 'Play fullscreen card video' : 'Play card video' }));
  });
}

test('remote audio remains lazy across source changes and plays only after an explicit action', async () => {
  const card: CardData = { id: 'card', front: 'Question', back: `[AUDIO:${a}]` };
  const view = ui.render(React.createElement(CardDisplay, { ...props, card }));
  assert.equal(state.audioLoads.length, 0);
  await ui.act(async () => ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Play remote card audio from media-a.example' })));
  assert.deepEqual(state.audioLoads, [a]);
  view.rerender(React.createElement(CardDisplay, { ...props, card: { ...card, back: `[AUDIO:${b}]` } }));
  assert.deepEqual(state.audioLoads, [a]);
  await ui.act(async () => ui.fireEvent.click(ui.screen.getByRole('button', { name: 'Play remote card audio from media-b.example' })));
  assert.deepEqual(state.audioLoads, [a, b]);
});

test.after(() => {
  ui?.cleanup(); hooks.deregister(); dom.window.close();
  Reflect.deleteProperty(globalThis, '__cardConsentState');
});
