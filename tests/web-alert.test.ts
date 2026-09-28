import assert from 'node:assert/strict';
import test from 'node:test';
import { showWebAlert, WebDialogHost } from '../src/lib/webAlert';

const dialogHost = (confirmed: boolean, prompted: string | null = null) => {
  const alerts: string[] = [];
  const confirms: string[] = [];
  const prompts: string[] = [];
  const host: WebDialogHost = {
    alert(message) { alerts.push(message || ''); },
    confirm(message) { confirms.push(message || ''); return confirmed; },
    prompt(message) { prompts.push(message || ''); return prompted; },
  };
  return { host, alerts, confirms, prompts };
};

test('web alerts remain visible instead of using React Native Web no-op Alert', () => {
  const dialog = dialogHost(false);
  showWebAlert(dialog.host, 'Assessment needs attention', 'Choose a category.');
  assert.deepEqual(dialog.alerts, ['Assessment needs attention\n\nChoose a category.']);
});

test('web confirmation invokes only the acknowledged action', () => {
  let discarded = 0;
  let cancelled = 0;
  const accepted = dialogHost(true);
  showWebAlert(accepted.host, 'Discard?', 'Unsaved work will be lost.', [
    { text: 'Keep editing', style: 'cancel', onPress: () => { cancelled += 1; } },
    { text: 'Discard', style: 'destructive', onPress: () => { discarded += 1; } },
  ]);
  assert.equal(discarded, 1);
  assert.equal(cancelled, 0);

  const rejected = dialogHost(false);
  showWebAlert(rejected.host, 'Discard?', 'Unsaved work will be lost.', [
    { text: 'Keep editing', style: 'cancel', onPress: () => { cancelled += 1; } },
    { text: 'Discard', style: 'destructive', onPress: () => { discarded += 1; } },
  ]);
  assert.equal(discarded, 1);
  assert.equal(cancelled, 1);
});

test('web multi-action fallback rejects invalid selections without choosing an action', () => {
  let actionCount = 0;
  let cancelCount = 0;
  const dialog = dialogHost(false, '9');
  showWebAlert(dialog.host, 'Choose', undefined, [
    { text: 'Cancel', style: 'cancel', onPress: () => { cancelCount += 1; } },
    { text: 'First', onPress: () => { actionCount += 1; } },
    { text: 'Second', onPress: () => { actionCount += 1; } },
  ]);
  assert.equal(actionCount, 0);
  assert.equal(cancelCount, 1);
  assert.match(dialog.alerts[0], /No action was taken/);
});
