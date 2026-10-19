import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DEMO_DESTINATIONS, type DemoDestinationKey } from '../../lib/demoNavigation';
import { useThemeColors } from '../../lib/useThemeColors';
import { InstitutionBrand } from '../ui/InstitutionBrand';

interface DemoGuideProps {
  signedInName?: string;
  onOpen: (key: DemoDestinationKey) => void;
  onAI: () => void;
  onBranding: () => void;
  onActivation: () => void;
}

/** A presenter map for the existing features, with no course or role mutations. */
export function DemoGuide({ signedInName, onOpen, onAI, onBranding, onActivation }: DemoGuideProps) {
  const colors = useThemeColors();
  const cards = [
    { title: 'AI before & after', detail: 'Compare a syllabus, PDF, PowerPoint, video, audio or captions with prepared results and source checks. Reset and replay without changing courses.', action: onAI },
    { title: 'Institution colours', detail: 'Preview a primary and secondary colour. Root logo and colour-image files provide the saved institution branding.', action: onBranding },
    { title: 'Institution setup walkthrough', detail: 'Walk through organization, identity, source data and pilot planning. This is a local simulation; it does not provision an institution.', action: onActivation },
    ...DEMO_DESTINATIONS.map(item => ({ title: item.title, detail: item.detail, action: () => onOpen(item.key) })),
  ];
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.page}>
    <View style={styles.content}>
      <InstitutionBrand size={44} showName />
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Demo guide</Text>
      <Text style={[styles.intro, { color: colors.textSecondary }]}>Everything in one place. Start with the AI comparison, explore a course, then show learning and collaboration.</Text>
      <View style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{signedInName ? `Signed in as ${signedInName}` : 'Choose a role when you open an LMS feature'}</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>{signedInName ? 'Your current role is kept when you follow these links. Change roles from Courses, or sign out from the account menu.' : 'The role picker will take you straight to the feature you selected. AI, colours and the setup walkthrough can be explored without signing in.'}</Text>
      </View>
      <View style={styles.grid}>
        {cards.map(card => <Pressable key={card.title} accessibilityRole="button" accessibilityLabel={`Open ${card.title}`} onPress={card.action} style={({ pressed }) => [styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}>
          <Text style={[styles.cardTitle, { color: colors.primary }]}>{card.title} →</Text>
          <Text style={[styles.description, { color: colors.textSecondary }]}>{card.detail}</Text>
        </Pressable>)}
      </View>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>Present and repeat</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>Use npm run web and keep its terminal open. Open another tab on the same computer for a second role. Refreshing a tab signs it out. Restarting the server clears shared course and chat changes; personal flashcards and setup drafts remain saved in this browser. Use Reset preview in the AI showcase to replay its results.</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>AI outputs are prepared examples, with source checks and instructor review still required. Live AI and institution SSO require provider setup. The included MIT OCW material needs permission or replacement for commercial presentations.</Text>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { alignItems: 'center', padding: 24 }, content: { width: '100%', maxWidth: 1100 },
  title: { fontSize: 34, fontWeight: '800', marginTop: 24 }, intro: { fontSize: 17, lineHeight: 26, marginTop: 10, marginBottom: 22 },
  notice: { borderWidth: 1, borderRadius: 12, padding: 18, marginBottom: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  card: { flexGrow: 1, flexBasis: 300, borderWidth: 1, borderRadius: 14, padding: 20 },
  cardTitle: { fontSize: 18, fontWeight: '700' }, description: { fontSize: 14, lineHeight: 22, marginTop: 9 },
  sectionTitle: { fontSize: 22, fontWeight: '700', marginTop: 28 },
});
