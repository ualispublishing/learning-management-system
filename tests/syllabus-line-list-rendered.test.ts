import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { useState } from 'react';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'ShadowRoot', 'MutationObserver'] as const) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) });
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === 'react-native' ? 'react-native-web' : specifier, context);
  },
});

test('syllabus list editing keeps new lines and spaces while typing and emits clean course entries', async () => {
  const ui = await import('@testing-library/react');
  const { SyllabusLineListInput } = await import('../src/components/lms/SyllabusLineListInput');
  let saved: string[] = [];
  function Form({ initial }: { initial: string[] }) {
    const [values, setValues] = useState(initial);
    return React.createElement(SyllabusLineListInput, {
      accessibilityLabel: 'Learning objectives', values,
      onChangeValues: next => { saved = next; setValues(next); },
    });
  }
  try {
    const rendered = ui.render(React.createElement(Form, { initial: ['Explain computation.'], key: 'first-source' }));
    const input = ui.screen.getByRole('textbox', { name: 'Learning objectives' }) as HTMLTextAreaElement;
    ui.fireEvent.change(input, { target: { value: 'Explain computation.\n' } });
    assert.equal(input.value, 'Explain computation.\n', 'Enter must leave a new line available for typing');
    ui.fireEvent.change(input, { target: { value: input.value + 'Write ' } });
    assert.equal(input.value, 'Explain computation.\nWrite ', 'a space between words must survive a controlled render');
    ui.fireEvent.change(input, { target: { value: input.value + 'small programs.\n\n' } });
    assert.deepEqual(saved, ['Explain computation.', 'Write small programs.']);
    ui.fireEvent.blur(input);
    assert.equal(input.value, saved.join('\n'), 'blur removes empty entries without losing meaningful text');
    ui.fireEvent.change(input, { target: { value: '' } });
    ui.fireEvent.blur(input);
    assert.deepEqual(saved, []);
    assert.equal(input.value, '');
    rendered.rerender(React.createElement(Form, { initial: ['Replacement source goal.'], key: 'second-source' }));
    assert.equal((ui.screen.getByRole('textbox', { name: 'Learning objectives' }) as HTMLTextAreaElement).value, 'Replacement source goal.');
  } finally { ui.cleanup(); }
});

test.after(() => { hooks.deregister(); dom.window.close(); });
