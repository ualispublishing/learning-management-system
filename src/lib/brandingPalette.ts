import { accessibleForegroundColor, accessibleTextColor, isSixDigitHexColor, mixHexColors } from './color';

/** Keep source colours exact on brand accents; derive readable UI tones. */
export function applyInstitutionColors<T extends { background: string; card: string; text: string; textSecondary: string }>(base: T, primary: string, secondary: string, dark: boolean) {
  if (!isSixDigitHexColor(primary) || !isSixDigitHexColor(secondary)) throw new Error('Institution colours must use six-digit hex values.');
  const endpoint = dark ? '#000000' : '#FFFFFF';
  const navBg = mixHexColors(primary, endpoint, dark ? 0.85 : 0.94);
  const navBgEnd = mixHexColors(secondary, endpoint, dark ? 0.85 : 0.94);
  const surfaces = [base.background, base.card, navBg, navBgEnd];
  const readablePrimary = accessibleForegroundColor(primary, surfaces) ?? base.text;
  return {
    ...base, primary: readablePrimary, secondary,
    brandPrimary: primary, brandSecondary: secondary,
    navBg, navBgEnd,
    textSecondary: accessibleForegroundColor(base.textSecondary, surfaces) ?? base.text,
    buttonBackground: readablePrimary,
    buttonText: accessibleTextColor(readablePrimary)!, onPrimary: accessibleTextColor(readablePrimary)!,
    onSecondary: accessibleTextColor(secondary)!,
  };
}
