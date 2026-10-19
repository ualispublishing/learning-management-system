import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DemoGuide } from '../components/lms/DemoGuide';
import { InstitutionThemeSettings } from '../components/ui/InstitutionThemeSettings';
import { InstitutionActivationJourney } from '../components/lms/InstitutionActivationJourney';
import { isPreparedAIDemo } from '../lib/ai/preparedDemo';
import { resolveDemoDestination, type DemoDestinationKey } from '../lib/demoNavigation';
import { useLMSStore } from '../lib/store/useLMSStore';
import { DemoSignIn } from '../components/lms/DemoSignIn';
import { useThemeColors } from '../lib/useThemeColors';

export default function DemoScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { signIn } = useLocalSearchParams();
  const currentUserId = useLMSStore(state => state.currentUserId);
  const currentUserName = useLMSStore(state => state.currentUserName);
  const [branding, setBranding] = useState(false);
  const [activation, setActivation] = useState(false);
  const [destination, setDestination] = useState<DemoDestinationKey | null>(null);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (Platform.OS !== 'web' || !isPreparedAIDemo()) return <View><Text>The demo guide is available through npm run web in local development.</Text></View>;
  const open = (key: DemoDestinationKey) => {
    if (currentUserId) router.push(resolveDemoDestination(key));
    else setDestination(key);
  };
  if (destination || busyEmail || (signIn === '1' && !currentUserId)) return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back to Demo guide" disabled={!!busyEmail} accessibilityState={{ disabled: !!busyEmail }} onPress={() => { setDestination(null); router.setParams({ signIn: undefined }); }} style={{ padding: 16 }}><Text style={{ color: colors.primary, fontWeight: '700' }}>← Demo guide</Text></Pressable>
    <DemoSignIn busyEmail={busyEmail} error={error} onSignIn={async email => {
      if (busyEmail) return;
      setBusyEmail(email); setError(null);
      try {
        await useLMSStore.getState().login(email);
        await useLMSStore.getState().initializeMocks();
        router.replace(resolveDemoDestination(destination));
        setDestination(null);
      } catch (reason) {
        await useLMSStore.getState().logout().catch(() => {});
        setError(reason instanceof Error ? reason.message : 'The demo account could not be loaded.');
      } finally { setBusyEmail(null); }
    }} />
  </View>;
  return <>
    <DemoGuide signedInName={currentUserId ? currentUserName ?? 'demo user' : undefined} onOpen={open} onAI={() => router.push('/ai-demo')} onBranding={() => setBranding(true)} onActivation={() => setActivation(true)} />
    {branding ? <InstitutionThemeSettings onClose={() => setBranding(false)} /> : null}
    {activation ? <InstitutionActivationJourney visible onClose={() => setActivation(false)} /> : null}
  </>;
}
