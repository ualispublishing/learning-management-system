import React from 'react';
import { Text, View } from 'react-native';
import { useThemeColors } from '../../lib/useThemeColors';

/** Plain text only: source-processing notes can describe literal source markup. */
export function AISourceReviewNotice({ notices, reviewed = false }: { notices?: readonly string[]; reviewed?: boolean }) {
  const colors = useThemeColors();
  if (!notices?.length) return null;
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginVertical: 12 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: 'bold' }}>Source processing notes</Text>
      {!reviewed && <Text style={{ color: colors.textSecondary, marginTop: 6 }}>Check these notes against the original file before approving the result.</Text>}
      {notices.map((notice, index) => <Text key={`${index}-${notice}`} style={{ color: colors.text, marginTop: 6 }}>• {notice}</Text>)}
    </View>
  );
}
