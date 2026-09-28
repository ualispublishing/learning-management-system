/**
 * @fileoverview src/lib/notifications/scheduler.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { CardStore, DeckStore } from '../db/store';
import { buildDailyReminderSlots } from './schedule';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export const NotificationScheduler = {
  async ensurePermission(): Promise<void> {
    if (Platform.OS === 'web') throw new Error('Local reminder scheduling is available only in the iOS and Android apps.');
    const { status } = await Notifications.getPermissionsAsync();
    const finalStatus = status === 'granted'
      ? status
      : (await Notifications.requestPermissionsAsync()).status;
    if (finalStatus !== 'granted') throw new Error('Notification permission was not granted.');
  },

  async cancelMatching(predicate: (data: Record<string, unknown>) => boolean): Promise<void> {
    if (Platform.OS === 'web') return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled.flatMap(notification => {
      const rawData = notification.content.data;
      const data = rawData && typeof rawData === 'object' ? rawData as Record<string, unknown> : {};
      return predicate(data)
        ? [Notifications.cancelScheduledNotificationAsync(notification.identifier)]
        : [];
    }));
  },

  /** Refresh due-card alerts for decks whose owners explicitly enabled reminders. */
  async scheduleDueCards() {
    if (Platform.OS === 'web') return 0;
    const activeDeckIds = new Set((await DeckStore.getAll())
      .filter(deck => deck.settings.notifSchedule?.active)
      .map(deck => deck.id));
    if (activeDeckIds.size === 0) return 0;

    // Background/automatic refreshes must never display an unsolicited system
    // permission prompt. Permission requests happen only in explicit enable flows.
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') throw new Error('Notification permission is not currently granted. Re-enable it in system settings.');

    // Refresh due-card alerts without deleting unrelated per-deck reminders.
    await this.cancelMatching(data => data.notificationKind === 'due-card' || data.notificationKind === 'due-summary');
    const existingNotifications = await Notifications.getAllScheduledNotificationsAsync();
    const notificationBudget = Math.max(0, 64 - existingNotifications.length);
    if (notificationBudget === 0) return 0;

    // Fetch a bounded due batch. Daily deck reminders handle future reviews.
    const dueCardsData = (await CardStore.getAllDueCardsWithNotes(1_000))
      .filter(item => activeDeckIds.has(item.card.deck_id))
      .slice(0, 64);
    if (dueCardsData.length === 0) return;

    const now = Date.now();

    let scheduledCount = 0;

    if (dueCardsData.length > 0) {
      if (dueCardsData.length === 1) {
        const { card } = dueCardsData[0];
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Card Due Now!',
            body: 'A flashcard is ready for review.',
            data: { notificationKind: 'due-card', cardId: card.id, deckId: card.deck_id },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(now + 1000) },
        });
        scheduledCount++;
      } else {
        const deckIds = Array.from(new Set(dueCardsData.map(item => item.card.deck_id)));
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Cards Due!',
            body: `You have ${dueCardsData.length} flashcards ready for review.`,
            data: { notificationKind: 'due-summary', count: dueCardsData.length, deckIds },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(now + 1000) },
        });
        scheduledCount++;
      }
    }

    return scheduledCount;
  },

  async configureDeckReminder(
    deckId: string,
    deckName: string,
    active: boolean,
    frequencyMinutes: number,
    startTime: string,
    endTime: string,
  ): Promise<void> {
    if (Platform.OS === 'web') {
      if (active) throw new Error('Local reminder scheduling is available only in the iOS and Android apps.');
      return;
    }
    await this.cancelMatching(data => data.notificationKind === 'deck-reminder' && data.deckId === deckId);
    if (!active) return;
    const slots = buildDailyReminderSlots(frequencyMinutes, startTime, endTime);

    await this.ensurePermission();
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    if (existing.length + slots.length > 64) {
      throw new Error('The device notification limit would be exceeded. Disable another deck reminder or use a larger interval.');
    }
    try {
      for (const slot of slots) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Study Reminder',
            body: `It's time to review your ${deckName} deck!`,
            data: { notificationKind: 'deck-reminder', deckId },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour: slot.hour,
            minute: slot.minute,
          },
        });
      }
    } catch (error) {
      await this.cancelMatching(data => data.notificationKind === 'deck-reminder' && data.deckId === deckId);
      throw error;
    }
  },

  async removeDeckNotifications(deckId: string): Promise<void> {
    await this.cancelMatching(data => data.deckId === deckId
      || (Array.isArray(data.deckIds) && data.deckIds.includes(deckId)));
  },

  /**
   * Clears all scheduled notifications.
   */
  async clearAll() {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }
};
