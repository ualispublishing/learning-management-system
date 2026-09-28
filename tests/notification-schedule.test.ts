import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDailyReminderSlots } from '../src/lib/notifications/schedule';

test('daily reminder slots honor the configured window and frequency', () => {
  assert.deepEqual(buildDailyReminderSlots(60, '09:00', '12:00'), [
    { hour: 9, minute: 0 },
    { hour: 10, minute: 0 },
    { hour: 11, minute: 0 },
    { hour: 12, minute: 0 },
  ]);
  assert.deepEqual(buildDailyReminderSlots(90, '09:15', '13:00'), [
    { hour: 9, minute: 15 },
    { hour: 10, minute: 45 },
    { hour: 12, minute: 15 },
  ]);
});

test('daily reminder slots reject ambiguous, reversed, and excessive schedules', () => {
  assert.throws(() => buildDailyReminderSlots(60, '9:00', '17:00'), /HH:MM/);
  assert.throws(() => buildDailyReminderSlots(60, '17:00', '09:00'), /start before the end/);
  assert.throws(() => buildDailyReminderSlots(0, '09:00', '17:00'), /between 1 minute/);
  assert.throws(() => buildDailyReminderSlots(1, '09:00', '17:00'), /more than 32/);
});
