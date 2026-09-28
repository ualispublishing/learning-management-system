/**
 * @fileoverview src/lib/notifications/schedule.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export const MAX_DAILY_DECK_REMINDERS = 32;

export interface ReminderSlot {
  hour: number;
  minute: number;
}

const parseTime = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
};

export function buildDailyReminderSlots(
  frequencyMinutes: number,
  startTime: string,
  endTime: string,
): ReminderSlot[] {
  if (!Number.isInteger(frequencyMinutes) || frequencyMinutes < 1 || frequencyMinutes > 10_080) {
    throw new Error('Reminder frequency must be between 1 minute and 7 days.');
  }
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  if (start === null || end === null || start >= end) {
    throw new Error('Reminder times must use HH:MM with the start before the end.');
  }
  const slots: ReminderSlot[] = [];
  for (let minuteOfDay = start; minuteOfDay <= end; minuteOfDay += frequencyMinutes) {
    slots.push({ hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 });
  }
  if (slots.length > MAX_DAILY_DECK_REMINDERS) {
    throw new Error(`This window creates more than ${MAX_DAILY_DECK_REMINDERS} daily reminders. Increase the frequency or shorten the window.`);
  }
  return slots;
}
