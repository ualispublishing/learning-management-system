import { isLoaded } from 'expo-font';

/** Never give native text an unavailable font, including after partial loading. */
export function getAppFontFamilies(enabled: boolean) {
  const available = (name: string) => enabled && isLoaded(name) ? name : undefined;
  return {
    regular: available('Inter_400Regular'),
    semiBold: available('Inter_600SemiBold'),
    bold: available('Inter_800ExtraBold'),
  };
}
