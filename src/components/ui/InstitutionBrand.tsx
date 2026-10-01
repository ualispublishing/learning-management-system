import { Image, StyleSheet, Text, View } from 'react-native';
import branding from '../../lib/branding.generated.json';
import { useThemeColors } from '../../lib/useThemeColors';

const logo = require('../../../assets/brand/institution-logo.png');

/** One shared logo/wordmark for sign-in, app chrome and recovery screens. */
export function InstitutionBrand({ size = 40, showName = false }: { size?: number; showName?: boolean }) {
  const colors = useThemeColors();
  const width = Math.min(size * 3, Math.max(size * 0.6, size * branding.logoAspect));
  return (
    <View style={styles.row}>
      <View style={[styles.logoSurface, { backgroundColor: branding.logoBackground }]}>
        <Image source={logo} accessibilityLabel={`${branding.name} logo`} resizeMode="contain" style={{ width, height: size }} />
      </View>
      {showName ? <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>{branding.name}</Text> : null}
    </View>
  );
}
export function InstitutionColorBar() {
  const colors = useThemeColors();
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.bar}>
    <View style={{ flex: 3, backgroundColor: colors.brandPrimary }} />
    <View style={{ flex: 1, backgroundColor: colors.brandSecondary }} />
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0, flexShrink: 1 },
  logoSurface: { padding: 4, borderRadius: 10, overflow: 'hidden', flexShrink: 0 },
  name: { fontSize: 16, fontWeight: '800', flexShrink: 1 },
  bar: { height: 4, width: '100%', flexDirection: 'row' },
});
