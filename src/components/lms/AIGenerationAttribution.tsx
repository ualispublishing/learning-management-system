import React from 'react';
import { Text, View } from 'react-native';
import { attributionSourceName, generationAttribution } from '../../lib/ai/generationAttribution';
import { useThemeColors } from '../../lib/useThemeColors';

/** Read-only footer: no catalog fetch, new generation, or inferred authoring model. */
export function AIGenerationAttribution({ provenance, sourceName }: { provenance?: unknown; sourceName?: unknown }) {
  const colors = useThemeColors();
  const attribution = generationAttribution(provenance);
  const source = attributionSourceName(sourceName);
  if (!attribution) return null;
  return <View accessibilityLabel="AI generation details" style={{ width: '100%', marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border }}>
    <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18 }}>{attribution}</Text>
    {source && <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 }}>Source: {source}</Text>}
  </View>;
}
