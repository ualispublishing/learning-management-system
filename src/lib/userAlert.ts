/**
 * @fileoverview src/lib/userAlert.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { Alert, AlertButton, AlertOptions, Platform } from 'react-native';
import { showWebAlert } from './webAlert';

/**
 * React Native Web intentionally implements Alert.alert as a no-op. Route all
 * user-facing alerts through this adapter so validation and confirmation flows
 * remain functional on web while native platforms retain the system dialog.
 */
export const userAlert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions): void {
    if (Platform.OS !== 'web') {
      Alert.alert(title, message, buttons, options);
      return;
    }

    if (typeof window === 'undefined') return;
    showWebAlert(window, title, message, buttons);
  },
};
