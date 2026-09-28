/**
 * @fileoverview src/lib/useThemeColors.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { useColorScheme } from 'react-native';
import { useSettingsStore } from './store/useSettingsStore';
import { colors } from './theme';
import { accessibleForegroundColor, accessibleTextColor, isSixDigitHexColor } from './color';

export function useThemeColors() {
  const themeSetting = useSettingsStore((state) => state.theme);
  const customThemeHex = useSettingsStore((state) => state.customThemeHex);
  const systemColorScheme = useColorScheme();

  const isDark = 
    themeSetting === 'dark' || 
    (themeSetting === 'system' && systemColorScheme === 'dark');

  const baseColors = colors[isDark ? 'dark' : 'light'];

  if (customThemeHex && isSixDigitHexColor(customThemeHex)) {
    const accessiblePrimary = accessibleForegroundColor(customThemeHex, [baseColors.background, baseColors.card])
      || baseColors.primary;
    return {
      ...baseColors,
      // Header surfaces retain their tested palette. The custom accent is
      // adjusted only as much as needed for the active light/dark surfaces.
      primary: accessiblePrimary,
      buttonBackground: accessiblePrimary,
      buttonText: accessibleTextColor(accessiblePrimary) || baseColors.buttonText,
      onPrimary: accessibleTextColor(accessiblePrimary) || baseColors.onPrimary,
    };
  }

  return baseColors;
}
