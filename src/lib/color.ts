/**
 * @fileoverview src/lib/color.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export const isSixDigitHexColor = (value: string): boolean => /^#[0-9a-f]{6}$/i.test(value);

const channelLuminance = (channel: number): number => {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (hex: string): number | null => {
  if (!isSixDigitHexColor(hex)) return null;
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
};

export const colorContrastRatio = (foreground: string, background: string): number | null => {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  if (first === null || second === null) return null;
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
};

/** Black or white always provides at least 4.58:1 against a valid solid color. */
export const accessibleTextColor = (background: string): '#000000' | '#FFFFFF' | null => {
  const blackRatio = colorContrastRatio('#000000', background);
  const whiteRatio = colorContrastRatio('#FFFFFF', background);
  if (blackRatio === null || whiteRatio === null) return null;
  return blackRatio >= whiteRatio ? '#000000' : '#FFFFFF';
};

export const hasAccessibleTextContrast = (foreground: string, background: string): boolean =>
  (colorContrastRatio(foreground, background) ?? 0) >= 4.5;

export const mixHexColors = (from: string, to: '#000000' | '#FFFFFF', amount: number): string => {
  const ratio = Math.max(0, Math.min(1, amount));
  const channels = [1, 3, 5].map(index => {
    const start = Number.parseInt(from.slice(index, index + 2), 16);
    const end = Number.parseInt(to.slice(index, index + 2), 16);
    return Math.round(start + (end - start) * ratio).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`.toUpperCase();
};

/** Finds the nearest 1% black/white mix that passes 4.5:1 on every surface. */
export const accessibleForegroundColor = (foreground: string, backgrounds: string[]): string | null => {
  if (!isSixDigitHexColor(foreground) || !backgrounds.length || backgrounds.some(value => !isSixDigitHexColor(value))) return null;
  const normalized = foreground.toUpperCase();
  if (backgrounds.every(background => hasAccessibleTextContrast(normalized, background))) return normalized;

  const endpoint = (['#000000', '#FFFFFF'] as const)
    .map(color => ({ color, minimum: Math.min(...backgrounds.map(background => colorContrastRatio(color, background) ?? 0)) }))
    .sort((left, right) => right.minimum - left.minimum)[0];
  if (endpoint.minimum < 4.5) return null;

  for (let percent = 1; percent <= 100; percent += 1) {
    const candidate = mixHexColors(normalized, endpoint.color, percent / 100);
    if (backgrounds.every(background => hasAccessibleTextContrast(candidate, background))) return candidate;
  }
  return endpoint.color;
};
