import React, { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import branding from '../../lib/branding.generated.json';
import { accessibleTextColor, isSixDigitHexColor } from '../../lib/color';
import { useThemeColors } from '../../lib/useThemeColors';
import { useSettingsStore } from '../../lib/store/useSettingsStore';

export function InstitutionThemeSettings({ onClose }: { onClose: () => void }) {
  const colors = useThemeColors();
  const { customThemeHex, customSecondaryHex, setCustomThemeHex, setCustomSecondaryHex, theme, setTheme } = useSettingsStore();
  const [primary, setPrimary] = useState(customThemeHex || branding.primary);
  const [secondary, setSecondary] = useState(customSecondaryHex || branding.secondary);
  const valid = isSixDigitHexColor(primary.trim()) && isSixDigitHexColor(secondary.trim());
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <ScrollView accessibilityViewIsModal style={[styles.panel, { backgroundColor: colors.card }]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Institution colours</Text>
        <Text style={{ color: colors.textSecondary, lineHeight: 21 }}>Try colours for this demo on your device. Reset to {branding.name} defaults at any time.</Text>
        {([{ label: 'Primary', value: primary, update: setPrimary }, { label: 'Secondary', value: secondary, update: setSecondary }]).map(({ label, value, update }) => {
          const swatch = isSixDigitHexColor(value.trim()) ? value.trim() : colors.border;
          return <View key={label} style={{ marginTop: 20 }}>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 8 }}>{label} colour</Text>
            <View style={styles.inputRow}>
              {Platform.OS === 'web' ? React.createElement('input', {
                type: 'color', 'aria-label': `Choose ${label.toLowerCase()} colour`, value: swatch,
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => update(event.target.value.toUpperCase()),
                style: { width: 48, height: 48, padding: 2, border: `1px solid ${colors.border}`, borderRadius: 8, cursor: 'pointer', background: colors.card },
              }) : <View style={[styles.swatch, { backgroundColor: swatch, borderColor: colors.border }]} />}
              <TextInput accessibilityLabel={`${label} colour hex code`} autoCapitalize="characters" autoCorrect={false} maxLength={7} value={value} onChangeText={update} placeholder="#1D3557" placeholderTextColor={colors.textSecondary} style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
            </View>
          </View>;
        })}
        {!valid ? <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 12 }}>Enter both colours as six-digit hex codes, for example #1D3557.</Text> : null}
        <View style={[styles.preview, { borderColor: colors.border }]}>
          <View style={{ flex: 3, backgroundColor: valid ? primary.trim() : colors.border, padding: 12 }}><Text style={{ color: valid ? accessibleTextColor(primary.trim())! : colors.text, fontWeight: '700' }}>Primary</Text></View>
          <View style={{ flex: 2, backgroundColor: valid ? secondary.trim() : colors.border, padding: 12 }}><Text style={{ color: valid ? accessibleTextColor(secondary.trim())! : colors.text, fontWeight: '700' }}>Secondary</Text></View>
        </View>
        <Text style={{ color: colors.text, fontWeight: '700', marginTop: 20, marginBottom: 8 }}>Appearance</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={styles.actions}>
          {(['light', 'dark', 'system'] as const).map(mode => <Pressable key={mode} accessibilityRole="radio" accessibilityLabel={`${mode} appearance`} accessibilityState={{ checked: theme === mode }} aria-checked={theme === mode} onPress={() => setTheme(mode)} style={[styles.button, { backgroundColor: theme === mode ? colors.primary : colors.background, flex: 1 }]}>
            <Text style={{ color: theme === mode ? colors.buttonText : colors.text, textTransform: 'capitalize', fontWeight: '600' }}>{mode}</Text>
          </Pressable>)}
        </View>
        <Pressable accessibilityRole="button" onPress={() => { setCustomThemeHex(null); setCustomSecondaryHex(null); onClose(); }} style={[styles.button, { borderWidth: 1, borderColor: colors.border, marginTop: 20 }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Use institution colours</Text>
        </Pressable>
        <View style={[styles.actions, { marginTop: 12 }]}>
          <Pressable accessibilityRole="button" onPress={onClose} style={[styles.button, { flex: 1 }]}><Text style={{ color: colors.text }}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !valid }} disabled={!valid} onPress={() => { setCustomThemeHex(primary); setCustomSecondaryHex(secondary); onClose(); }} style={[styles.button, { flex: 1, backgroundColor: colors.primary, opacity: valid ? 1 : 0.5 }]}><Text style={{ color: colors.buttonText, fontWeight: '700' }}>Apply colours</Text></Pressable>
        </View>
      </ScrollView>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  panel: { maxHeight: '90%', width: '100%', maxWidth: 440, borderRadius: 20, flexGrow: 0 },
  content: { padding: 24 }, title: { fontSize: 23, fontWeight: '800', marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderRadius: 8, fontSize: 16 },
  swatch: { width: 48, height: 48, borderRadius: 8, borderWidth: 1 },
  preview: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden', marginTop: 20 },
  actions: { flexDirection: 'row', gap: 8 },
  button: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
});
