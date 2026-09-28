/**
 * @fileoverview src/lib/diagnosticLog.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export const DIAGNOSTIC_CONTEXTS = {
  audioModeConfiguration: 'Audio mode configuration failed.',
  ambientAudioPlayback: 'Ambient audio playback failed.',
  ambientAudioStop: 'Ambient audio stop failed.',
  csvImport: 'Flashcard CSV import failed.',
  csvExport: 'Flashcard CSV export failed.',
  cardSave: 'Flashcard save failed.',
  recordingStart: 'Audio recording start failed.',
  recordingSave: 'Audio recording save failed.',
  cardDelete: 'Flashcard delete failed.',
  deckImageStore: 'Deck image storage failed.',
  deckNotificationConfigure: 'Deck notification configuration failed.',
  deckSave: 'Deck save failed.',
  deckNotificationRemove: 'Deck notification removal failed.',
  deckDelete: 'Deck delete failed.',
  cardAudioPlayback: 'Card audio playback failed.',
  cardVideoPlayback: 'Card video playback failed.',
  fullscreenVideoPlayback: 'Fullscreen card video playback failed.',
  studyNoteSave: 'Study note save failed.',
  voiceNotePlayback: 'Voice note playback failed.',
  deckStatisticsLoad: 'Deck statistics load failed.',
  deckCardsLoad: 'Deck card browser load failed.',
  notificationsEnable: 'Notification enablement failed.',
  studySessionLoad: 'Study session load failed.',
  studyReviewSave: 'Study review save failed.',
  deckLibraryLoad: 'Deck library load failed.',
  deckProgressReset: 'Deck progress reset failed.',
} as const;

export type DiagnosticContext = typeof DIAGNOSTIC_CONTEXTS[keyof typeof DIAGNOSTIC_CONTEXTS];

function isDevelopmentBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

/**
 * Reports a fixed operation context in production without serializing exception
 * messages, response bodies, URLs, or other potentially sensitive diagnostics.
 */
export function logDiagnosticError(context: DiagnosticContext, detail?: unknown): void {
  if (isDevelopmentBuild()) {
    console.error(context, detail);
    return;
  }
  console.error(context);
}

export function logDiagnosticWarning(context: DiagnosticContext, detail?: unknown): void {
  if (isDevelopmentBuild()) {
    console.warn(context, detail);
    return;
  }
  console.warn(context);
}
