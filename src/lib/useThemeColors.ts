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
import { useMemo } from 'react';
import branding from './branding.generated.json';
import { applyInstitutionColors } from './brandingPalette';

export function useThemeColors() {
  const themeSetting = useSettingsStore((state) => state.theme);
  const customThemeHex = useSettingsStore((state) => state.customThemeHex);
  const customSecondaryHex = useSettingsStore((state) => state.customSecondaryHex);
  const systemColorScheme = useColorScheme();

  const isDark = 
    themeSetting === 'dark' || 
    (themeSetting === 'system' && systemColorScheme === 'dark');

  const baseColors = colors[isDark ? 'dark' : 'light'];

  return useMemo(() => customThemeHex || customSecondaryHex
    ? applyInstitutionColors(baseColors, customThemeHex || branding.primary, customSecondaryHex || branding.secondary, isDark)
    : baseColors, [baseColors, customThemeHex, customSecondaryHex, isDark]);
}
