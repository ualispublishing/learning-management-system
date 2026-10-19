import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { AIRequestError } from '../../lib/ai/requestRecovery';
import { useThemeColors } from '../../lib/useThemeColors';

export function AIRequestRecoveryActions({ failure, busy = false, disabled = false, onCheck, onNew }: {
  failure: AIRequestError; busy?: boolean; disabled?: boolean; onCheck: () => void; onNew: () => void;
}) {
  const colors = useThemeColors();
  const unavailable = busy || disabled;
  return (
    <View style={{ width: '100%', maxWidth: 520, marginTop: 12 }}>
      <Text selectable style={{ color: colors.textSecondary, fontSize: 12 }}>Request: {failure.requestId}</Text>
      <Text style={{ color: colors.textSecondary, marginTop: 8 }}>
        {failure.canCheckSavedResult ? 'Checking retrieves the saved request without starting another generation. ' : 'Saved-result recovery is not configured for this service. '}
        Starting a new generation may create another charge.
      </Text>
      {failure.canCheckSavedResult && <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: unavailable, busy }} disabled={unavailable} onPress={onCheck}
        style={{ backgroundColor: unavailable ? colors.border : colors.primary, borderRadius: 8, minHeight: 44, padding: 12, marginTop: 10, alignItems: 'center' }}>
        <Text style={{ color: unavailable ? colors.textSecondary : colors.buttonText, fontWeight: 'bold' }}>{busy ? 'Checking saved result…' : 'Check saved result'}</Text>
      </TouchableOpacity>}
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: unavailable }} disabled={unavailable} onPress={onNew}
        style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, minHeight: 44, padding: 12, marginTop: 10, alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontWeight: 'bold' }}>Start a new generation</Text>
      </TouchableOpacity>
    </View>
  );
}
