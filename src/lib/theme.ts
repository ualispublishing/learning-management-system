/**
 * @fileoverview src/lib/theme.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export const colors = {
  light: {
    background: '#F8FAFC',
    card: '#FFFFFF',
    text: '#0F172A',
    textSecondary: '#64748B',
    primary: '#1D3557', // brand primary
    secondary: '#4AA9D3',
    accent: '#FCD34D',
    border: '#E2E8F0',
    error: '#EF4444',
    success: '#10B981',
    warning: '#F59E0B',
    danger: '#800000',
    info: '#4B0082',
    navBg: '#A1C4FD',
    navBgEnd: '#C2E9FB',
    buttonBackground: '#1D3557',
    buttonText: '#FFFFFF',
    onPrimary: '#FFFFFF',
    onSecondary: '#0F172A',
    onAccent: '#0F172A',
    onError: '#0F172A',
    onSuccess: '#0F172A',
    onWarning: '#0F172A',
    onDanger: '#FFFFFF',
    onInfo: '#FFFFFF',
  },
  dark: {
    background: '#0F172A',
    card: '#1E293B',
    text: '#F8FAFC',
    textSecondary: '#94A3B8',
    primary: '#38BDF8',
    secondary: '#7DD3FC',
    accent: '#FCD34D',
    border: '#334155',
    error: '#F87171',
    success: '#34D399',
    warning: '#FBBF24',
    danger: '#EF4444',
    info: '#A78BFA',
    navBg: '#020617',
    navBgEnd: '#0F172A',
    buttonBackground: '#38BDF8',
    buttonText: '#0F172A',
    onPrimary: '#0F172A',
    onSecondary: '#0F172A',
    onAccent: '#0F172A',
    onError: '#0F172A',
    onSuccess: '#0F172A',
    onWarning: '#0F172A',
    onDanger: '#0F172A',
    onInfo: '#0F172A',
  },
};

export const typography = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
};

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
};

export type ThemeColors = typeof colors.light;
