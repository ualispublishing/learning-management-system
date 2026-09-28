/**
 * @fileoverview src/lib/errorCodes.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export const ERROR_CODES = {
  // Database & Storage
  E1001: "Failed to save deck.",
  E1002: "Failed to delete deck.",
  E1003: "Failed to save card.",
  E1004: "Failed to import CSV file.",
  E1005: "Failed to export CSV file.",
  E1006: "Error loading settings from AsyncStorage",
  
  // Permissions & Hardware
  E2001: "Please enable notifications in your system settings to use this feature.",
  E2002: "Failed to schedule notifications.",
  E2003: "Please grant microphone permissions to record audio.",
  E2004: "Failed to start recording",
  
  // Validation
  V3001: "Deck name is required.",
  V3002: "Front content and at least one layer are required.",

  // Global Unexpected
  S5000: "An unexpected system error occurred."
}

export function getError(code: keyof typeof ERROR_CODES) {
  return `${ERROR_CODES[code]} (${code})`;
}
