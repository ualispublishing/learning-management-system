/**
 * @fileoverview src/app/(tabs)/index.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ActivityIndicator, Platform, Modal, ImageBackground } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { DeckStore } from '../../lib/db/store';
import { userAlert as Alert } from '../../lib/userAlert';
import { seedDemoData } from '../../lib/db/seed';
import { generateSampleDeck, tutorialDeckNeedsSeed } from '../../lib/db/seedSample';
import { Deck } from '../../types';
import { TargetSelector, SessionTarget } from '../../components/ui/TargetSelector';
import { SettingsModal } from '../../components/ui/SettingsModal';
import { useSettingsStore } from '../../lib/store/useSettingsStore';
import { RectLoader } from '../../components/ui/RectLoader';
import { AnimatedNewBadge } from '../../components/ui/AnimatedNewBadge';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import i18n from '../../lib/i18n';
import * as FileSystem from 'expo-file-system/legacy';
import { classifyCardMediaUri } from '../../lib/cardMedia';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DIAGNOSTIC_CONTEXTS, logDiagnosticError } from '../../lib/diagnosticLog';
import { filterDeckLibrary } from '../../lib/flashcardLibrary';
import { seedProgrammingCourseLearnDemo } from '../../lib/db/seedProgrammingCourse';

const DeckActionTab = ({ color, icon, position, onPress, label }: { color: string, icon: string, position: 'top' | 'middle' | 'bottom', onPress: () => void, label: string }) => {
  const isTop = position === 'top';
  const isBottom = position === 'bottom';

  return (
    <Pressable
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      accessibilityLabel={label}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          backgroundColor: color,
          width: 44,
          flex: 1,
          borderTopLeftRadius: isTop ? 16 : 0,
          borderBottomLeftRadius: isBottom ? 16 : 0,
          paddingTop: 0,
          paddingBottom: 0,
          paddingLeft: 0,
          paddingRight: 0,
          shadowColor: '#000',
          shadowOffset: { width: -3, height: 0 },
          shadowOpacity: 0.5,
          shadowRadius: 4,
          elevation: 6,
        },
        pressed && { opacity: 0.8 }
      ]}
    >
      <View style={{
        flex: 1,
        borderColor: '#FFD700',
        borderLeftWidth: 1.5,
        borderTopWidth: isTop ? 1.5 : 0,
        borderBottomWidth: isBottom ? 1.5 : 0,
        borderRightWidth: 0,
        borderTopLeftRadius: isTop ? 13 : 0,
        borderBottomLeftRadius: isBottom ? 13 : 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.1)', 
      }}>
        <Text style={{ fontSize: 16, color: '#FFF', fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: {width: 1, height: 1}, textShadowRadius: 2 }}>
          {icon}
        </Text>
      </View>
    </Pressable>
  );
};

export default function MainMenu() {
  const router = useRouter();
  const colors = useThemeColors();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tutorialDeckId, setTutorialDeckId] = useState<string | null>(null);
  
  // Overlay state
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [infoDeck, setInfoDeck] = useState<Deck | null>(null);
  const [infoDeckStats, setInfoDeckStats] = useState<any>(null);
  const [infoStatsError, setInfoStatsError] = useState<string | null>(null);
  const [isResettingDeckStats, setIsResettingDeckStats] = useState(false);
  const activeDeckId = useRef<string | null>(null);
  const resetStatsOperationRef = useRef(false);
  const isNavigating = useRef(false);

  const [showSettings, setShowSettings] = useState(false);
  
  const { enableModernTypography, enableVibrantGradients, hasViewedTutorial, setHasViewedTutorial } = useSettingsStore();

  const loadDecks = React.useCallback(async (activeObj = { current: true }) => {
    try {
      if (activeObj.current) {
        setLoading(true);
        setLoadError(null);
      }
      await seedDemoData();
      await seedProgrammingCourseLearnDemo();
      let decksWithDue = await DeckStore.getAllWithStats();
      let tutorialDeck = decksWithDue.find(deck => deck.settings.isTutorial === true);
      if (tutorialDeckNeedsSeed(tutorialDeck)) {
        const loadedTutorialDeckId = await generateSampleDeck();
        decksWithDue = await DeckStore.getAllWithStats();
        tutorialDeck = decksWithDue.find(deck => deck.id === loadedTutorialDeckId);
      }
      if (activeObj.current) {
        setTutorialDeckId(tutorialDeck?.id ?? null);
        setDecks(decksWithDue.sort((a, b) => a.position - b.position));
      }
    } catch (error) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.deckLibraryLoad, error);
      if (activeObj.current) setLoadError('Your decks could not be loaded. Check local storage and retry.');
    } finally {
      if (activeObj.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      const activeObj = { current: true };
      loadDecks(activeObj);
      return () => { activeObj.current = false; };
    }, [loadDecks])
  );

  useEffect(() => {
    if (infoDeck) {
      activeDeckId.current = infoDeck.id;
      void Promise.resolve().then(async () => {
        setInfoDeckStats(null);
        setInfoStatsError(null);
        try {
          const stats = await DeckStore.getDeckDetailedStats(infoDeck.id);
          if (activeDeckId.current === infoDeck.id) setInfoDeckStats(stats);
        } catch (error) {
          logDiagnosticError(DIAGNOSTIC_CONTEXTS.deckStatisticsLoad, error);
          if (activeDeckId.current === infoDeck.id) setInfoStatsError('Deck statistics could not be loaded.');
        }
      });
    } else {
      activeDeckId.current = null;
    }
  }, [infoDeck]);

  const resetDeckStatistics = React.useCallback(async () => {
    if (!infoDeck || resetStatsOperationRef.current) return;
    const deckId = infoDeck.id;
    resetStatsOperationRef.current = true;
    setIsResettingDeckStats(true);
    try {
      await DeckStore.resetDeckStats(deckId);
      const updatedStats = await DeckStore.getDeckDetailedStats(deckId);
      if (activeDeckId.current === deckId) setInfoDeckStats(updatedStats);
      await loadDecks({ current: true });
    } catch (error) {
      logDiagnosticError(DIAGNOSTIC_CONTEXTS.deckProgressReset, error);
      Alert.alert('Reset failed', 'Deck progress could not be reset. Please retry.');
    } finally {
      resetStatsOperationRef.current = false;
      setIsResettingDeckStats(false);
    }
  }, [infoDeck, loadDecks]);

  const handleStartSession = (target: SessionTarget | number, mode: 'learn' | 'study' | 'quiz' = 'study', startPosition: number = 1) => {
    if (selectedDeckId && !isNavigating.current) {
      isNavigating.current = true;
      router.push(`/study/${selectedDeckId}?target=${target}&mode=${mode}&startPos=${startPosition}`);
      setTimeout(() => isNavigating.current = false, 500);
      setSelectedDeckId(null);
    }
  };

  const filteredDecks = filterDeckLibrary(decks, searchQuery);

  const getBannerSource = (bannerType?: string) => {
    if (!bannerType) return null;
    if (bannerType === 'math') return require('../../../assets/images/math_banner_original.jpg');
    if (!FileSystem.documentDirectory || !bannerType.startsWith(FileSystem.documentDirectory)) return null;
    const filename = bannerType.slice(FileSystem.documentDirectory.length);
    return classifyCardMediaUri(filename).kind === 'local' ? { uri: bannerType } : null;
  };

  // Dynamic Styles
  const fontFamilyBold = enableModernTypography ? 'Inter_800ExtraBold' : undefined;
  const fontFamilySemiBold = enableModernTypography ? 'Inter_600SemiBold' : undefined;
  const fontFamilyRegular = enableModernTypography ? 'Inter_400Regular' : undefined;

  if (loading) {
    return (
      <View style={[styles.container, styles.center, enableVibrantGradients ? { backgroundColor: 'transparent' } : { backgroundColor: colors.background }]}>
        {enableVibrantGradients && (
          <LinearGradient colors={['#A1C4FD', '#C2E9FB']} style={StyleSheet.absoluteFill} />
        )}
        <View style={[styles.center, { marginTop: spacing[10] }]}>
          <RectLoader text={i18n.t('fetchingDecks')} />
        </View>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background, padding: spacing[6] }]}> 
        <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: typography.lg, textAlign: 'center', marginBottom: spacing[4] }}>{loadError}</Text>
        <Pressable accessibilityRole="button" onPress={() => void loadDecks({ current: true })} style={{ backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: spacing[6], paddingVertical: spacing[3] }}>
          <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const Container: React.ComponentType<any> = enableVibrantGradients ? LinearGradient : View;
  const containerProps: any = enableVibrantGradients 
    ? { colors: ['#A1C4FD', '#C2E9FB'], style: styles.container }
    : { style: [styles.container, { backgroundColor: colors.background }] };

  if (!hasViewedTutorial) {
    return (
      <Container {...containerProps} style={[styles.container, styles.center, enableVibrantGradients ? { backgroundColor: 'transparent' } : { backgroundColor: colors.background }]}>
        <View style={{ alignItems: 'center', padding: spacing[6], backgroundColor: colors.card, borderRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 5, width: '90%', maxWidth: 400 }}>
          <Text style={{ fontSize: 48, marginBottom: spacing[4] }}>🚀</Text>
          <Text accessibilityRole="header" style={{ fontSize: typography['3xl'], fontWeight: '800', color: colors.text, marginBottom: spacing[2], textAlign: 'center', fontFamily: fontFamilyBold }}>Welcome!</Text>
          <Text style={{ fontSize: typography.lg, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing[8], lineHeight: 26, fontFamily: fontFamilyRegular }}>Learn the basics of formatting, media, and multi-layer flashcards in our interactive Tutorial Deck.</Text>
          
          <Pressable 
            disabled={!tutorialDeckId}
            accessibilityRole="button"
            accessibilityState={{ disabled: !tutorialDeckId }}
            style={({ pressed }) => [{ backgroundColor: colors.primary, paddingVertical: spacing[4], paddingHorizontal: spacing[8], borderRadius: 16, width: '100%', alignItems: 'center', marginBottom: spacing[3] }, pressed && { opacity: 0.8 }]} 
            onPress={() => {
              setHasViewedTutorial(true);
              if (tutorialDeckId && !isNavigating.current) {
                isNavigating.current = true;
                router.push(`/study/${tutorialDeckId}?target=20&mode=study&startPos=1`);
                setTimeout(() => isNavigating.current = false, 500);
              }
            }}
          >
            <Text style={{ color: colors.buttonText, fontSize: typography.xl, fontWeight: '700', fontFamily: fontFamilySemiBold }}>Start Tutorial</Text>
          </Pressable>
          
          <Pressable 
            style={({ pressed }) => [{ paddingVertical: spacing[3], paddingHorizontal: spacing[8], borderRadius: 16, width: '100%', alignItems: 'center' }, pressed && { opacity: 0.8 }]} 
            onPress={() => setHasViewedTutorial(true)}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.textSecondary, fontSize: typography.base, fontWeight: '600', fontFamily: fontFamilySemiBold }}>Skip for now</Text>
          </Pressable>
        </View>
      </Container>
    );
  }

  return (
    <Container {...containerProps}>

      <View style={styles.searchContainer}>
        <TextInput
          accessibilityLabel={i18n.t('searchDecks')}
          style={[styles.searchInput, { fontFamily: fontFamilySemiBold, backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          placeholder={i18n.t('searchDecks')}
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <Pressable
          onPress={() => setShowSettings(true)}
          style={[styles.settingsBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Open app settings"
        >
          <Text style={styles.settingsBtnText}>⚙️</Text>
        </Pressable>
      </View>

      <FlatList keyboardShouldPersistTaps="handled"
        data={filteredDecks}
        keyExtractor={item => item.id}
        renderItem={({ item }) => {
          const bannerSource = getBannerSource(item.settings?.bannerType);
          const progress = item.totalCount ? Math.max(0, Math.round(((item.totalCount - (item.dueCount || 0)) / item.totalCount) * 100)) : 0;
          
          return (
            <View style={{ marginBottom: 0 }}>
              <View
                style={[
                  styles.deckCard,
                  enableVibrantGradients && styles.glassDeckCard,
                  { padding: 0, overflow: 'hidden', marginBottom: 2 }, // override default margin
                  bannerSource ? { backgroundColor: '#0F172A', borderColor: '#334155' } : {} // Dark background when banner is present
                ]}
              >
                {bannerSource ? (
                  <ImageBackground 
                    source={bannerSource} 
                    style={[styles.bannerBackground, { padding: 0 }]}
                    imageStyle={{ opacity: 0.45 }} // slightly more opaque banner over a dark background
                  >
                    <View style={{ width: '100%', paddingBottom: 16 }}>
                      <View style={{ width: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 54, paddingTop: 56, paddingBottom: 0 }}>
                        <Text style={[styles.deckTitle, { fontFamily: fontFamilyBold, textAlign: 'center', color: '#FFFFFF', fontSize: 28, marginBottom: 2 }]}>{item.name}</Text>
                        <Text style={[styles.deckStats, { fontFamily: fontFamilyBold, textAlign: 'center', color: '#FCD34D' }]}>{item.dueCount || 0} {i18n.t('due')}</Text>
                      </View>
                        
                      {item.newCount && item.newCount > 0 ? (
                        <View style={{ position: 'absolute', left: 28, top: 54, zIndex: 10 }}>
                          <AnimatedNewBadge count={item.newCount} />
                        </View>
                      ) : null}

                      <View style={{ 
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: 44, 
                        backgroundColor: 'transparent',
                      }}>
                        <DeckActionTab color="#800000" icon="+" position="top" onPress={() => { if(!isNavigating.current){ isNavigating.current=true; router.push(`/deck/${item.id}/browse`); setTimeout(()=>isNavigating.current=false, 500); } }} label={i18n.t('browseCards')} />
                        <DeckActionTab color="#000080" icon="⚙️" position="middle" onPress={() => { if(!isNavigating.current){ isNavigating.current=true; router.push(`/deck/${item.id}/edit`); setTimeout(()=>isNavigating.current=false, 500); } }} label={i18n.t('editDeckSettings')} />
                        <DeckActionTab color="#4B0082" icon="ℹ️" position="bottom" onPress={() => setInfoDeck(item)} label={i18n.t('deckInfo')} />
                      </View>
                      
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 64, marginTop: 0 }}>
                        <View style={[styles.progressBarBg, { flex: 1, marginTop: 0, marginHorizontal: 0, width: 'auto' }]}>
                          <View style={[styles.progressBarFill, { width: `${Math.min(100, progress * 2)}%` }]} />
                        </View>
                        <Text style={{ marginHorizontal: 6, fontSize: 11, fontWeight: '800', color: '#FFFFFF', fontFamily: fontFamilyBold }}>
                          - {progress}% -
                        </Text>
                        <View style={[styles.progressBarBg, { flex: 1, marginTop: 0, marginHorizontal: 0, width: 'auto' }]}>
                          <View style={[styles.progressBarFill, { width: `${Math.max(0, (progress - 50) * 2)}%` }]} />
                        </View>
                      </View>
                    </View>
                  </ImageBackground>
                ) : (
                  <View style={[styles.bannerBackground, { padding: 0 }]}>
                    <View style={{ width: '100%', paddingBottom: 16 }}>
                      <View style={{ width: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 54, paddingTop: 56, paddingBottom: 0 }}>
                        <Text style={[styles.deckTitle, { fontFamily: fontFamilyBold, textAlign: 'center', fontSize: 28, marginBottom: 2 }]}>{item.name}</Text>
                        <Text style={[styles.deckStats, { fontFamily: fontFamilyBold, textAlign: 'center' }]}>{item.dueCount || 0} {i18n.t('due')}</Text>
                      </View>
                        
                      {item.newCount && item.newCount > 0 ? (
                        <View style={{ position: 'absolute', left: 28, top: 54, zIndex: 10 }}>
                          <AnimatedNewBadge count={item.newCount} />
                        </View>
                      ) : null}

                      <View style={{ 
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: 44, 
                        backgroundColor: 'transparent',
                      }}>
                        <DeckActionTab color="#800000" icon="+" position="top" onPress={() => { if(!isNavigating.current){ isNavigating.current=true; router.push(`/deck/${item.id}/browse`); setTimeout(()=>isNavigating.current=false, 500); } }} label={i18n.t('browseCards')} />
                        <DeckActionTab color="#000080" icon="⚙️" position="middle" onPress={() => { if(!isNavigating.current){ isNavigating.current=true; router.push(`/deck/${item.id}/edit`); setTimeout(()=>isNavigating.current=false, 500); } }} label={i18n.t('editDeckSettings')} />
                        <DeckActionTab color="#4B0082" icon="ℹ️" position="bottom" onPress={() => setInfoDeck(item)} label={i18n.t('deckInfo')} />
                      </View>
                      
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 64, marginTop: 0 }}>
                        <View style={[styles.progressBarBg, { flex: 1, marginTop: 0, marginHorizontal: 0, width: 'auto' }]}>
                          <View style={[styles.progressBarFill, { width: `${Math.min(100, progress * 2)}%` }]} />
                        </View>
                        <Text style={{ marginHorizontal: 6, fontSize: 11, fontWeight: '800', color: '#0A1828', fontFamily: fontFamilyBold }}>
                          - {progress}% -
                        </Text>
                        <View style={[styles.progressBarBg, { flex: 1, marginTop: 0, marginHorizontal: 0, width: 'auto' }]}>
                          <View style={[styles.progressBarFill, { width: `${Math.max(0, (progress - 50) * 2)}%` }]} />
                        </View>
                      </View>
                    </View>
                  </View>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}. ${item.dueCount || 0} due, ${item.newCount || 0} new, ${progress} percent complete. Choose a study session.`}
                  accessibilityHint="Opens session goal and mode choices"
                  onPress={() => setSelectedDeckId(item.id)}
                  style={({ pressed }) => [styles.deckMainPressTarget, pressed && styles.deckMainPressed]}
                />
              </View>
            </View>
          );
        }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, textAlign: 'center', padding: spacing[6] }}>{searchQuery ? 'No decks match your search.' : 'No decks yet. Add a deck to get started.'}</Text>}
      />
      
      <View style={styles.bottomButtonsContainer}>
        <Pressable accessibilityRole="button" style={({ pressed }) => [
          styles.reviewAllBtn,
          pressed && styles.reviewAllBtnPressed
        ]} onPress={() => { if(!isNavigating.current){ isNavigating.current=true; router.push('/review'); setTimeout(()=>isNavigating.current=false, 500); } }}>
          <Text style={[styles.reviewAllText, { fontFamily: fontFamilyBold }]}>{i18n.t('reviewAllDue')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={({ pressed }) => [
          styles.addDeckBtn,
          pressed && styles.reviewAllBtnPressed
        ]} onPress={() => { if(!isNavigating.current){ isNavigating.current=true; router.push('/deck/new'); setTimeout(()=>isNavigating.current=false, 500); } }}>
          <Text style={[styles.reviewAllText, { fontFamily: fontFamilyBold }]}>{i18n.t('addDeck')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View learning statistics"
          accessibilityHint="Opens review history and proficiency charts"
          style={({ pressed }) => [styles.statisticsBtn, pressed && styles.reviewAllBtnPressed]}
          onPress={() => { if(!isNavigating.current){ isNavigating.current=true; router.push('/stats'); setTimeout(()=>isNavigating.current=false, 500); } }}
        >
          <Ionicons name="stats-chart" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      <Modal visible={!!selectedDeckId} transparent animationType="fade" onRequestClose={() => setSelectedDeckId(null)}>
        <View style={styles.modalOverlay} accessibilityViewIsModal={true}>
          <Pressable accessible={false} importantForAccessibility="no" style={styles.modalBackdrop} onPress={() => setSelectedDeckId(null)} />
          <TargetSelector 
            key={selectedDeckId}
            onSelect={handleStartSession}
            deckId={selectedDeckId || undefined}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Close study target selector" style={[styles.modalCloseButton, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => setSelectedDeckId(null)}>
            <Text style={{ color: colors.text, fontSize: typography.lg, fontWeight: 'bold' }}>×</Text>
          </Pressable>
        </View>
      </Modal>

      <Modal visible={!!infoDeck} transparent animationType="fade" onRequestClose={() => setInfoDeck(null)}>
        <View style={styles.modalOverlay} accessibilityViewIsModal={true}>
          <Pressable accessible={false} importantForAccessibility="no" style={styles.modalBackdrop} onPress={() => setInfoDeck(null)} />
          {infoDeck && (
            <View style={styles.infoModal}>
              <Text accessibilityRole="header" style={styles.infoModalTitle}>{infoDeck.name}</Text>
              <Text style={styles.infoModalDesc}>{infoDeck.description || i18n.t('noDescription')}</Text>
              
              {infoStatsError ? (
                <View style={[styles.statsGrid, { justifyContent: 'center', alignItems: 'center', minHeight: 100 }]}> 
                  <Text accessibilityRole="alert" style={{ color: '#E53935', textAlign: 'center' }}>{infoStatsError}</Text>
                </View>
              ) : infoDeckStats ? (
                <View style={styles.statsGrid}>
                  <View style={styles.statsCol}>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>{i18n.t('totalCards')}</Text>
                      <Text style={styles.statValue}>{infoDeckStats.totalCards}</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>{i18n.t('dueToday')}</Text>
                      <Text style={styles.statValue}>{infoDeckStats.dueCards}</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>{i18n.t('cardsRead')}</Text>
                      <Text style={styles.statValue}>{infoDeckStats.totalReviews}</Text>
                    </View>
                  </View>
                  <View style={styles.statsCol}>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>{i18n.t('newCards')}</Text>
                      <Text style={styles.statValue}>{infoDeckStats.newCards}</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>{i18n.t('learning')}</Text>
                      <Text style={styles.statValue}>{infoDeckStats.learningCards}</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>{i18n.t('completion')}</Text>
                      <Text style={styles.statValue}>{infoDeckStats.completionPercentage.toFixed(1)}%</Text>
                    </View>
                  </View>
                </View>
              ) : (
                <View style={[styles.statsGrid, { justifyContent: 'center', alignItems: 'center', height: 150 }]}>
                  <ActivityIndicator size="large" color="#1D3557" />
                </View>
              )}

              <View style={styles.tipsContainer}>
                <Text style={styles.tipsTitle}>{i18n.t('shortcutsTitle')}</Text>
                {Platform.OS === 'web' ? (
                  <>
                    <Text style={styles.tipsText}>{i18n.t('shortcutFlipDesktop')}</Text>
                    <Text style={styles.tipsText}>{i18n.t('shortcutNextDesktop')}</Text>
                    <Text style={styles.tipsText}>{i18n.t('shortcutRateDesktop')}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.tipsText}>{i18n.t('shortcutSwipeMobile')}</Text>
                    <Text style={styles.tipsText}>{i18n.t('shortcutTapMobile')}</Text>
                  </>
                )}
              </View>

              <Pressable 
                style={[styles.infoModalBtn, { backgroundColor: '#E53935', marginBottom: 12, opacity: isResettingDeckStats ? 0.55 : 1 }]} 
                accessibilityRole="button"
                accessibilityLabel={isResettingDeckStats ? 'Resetting deck statistics' : 'Reset deck statistics'}
                accessibilityState={{ disabled: isResettingDeckStats, busy: isResettingDeckStats }}
                disabled={isResettingDeckStats}
                onPress={() => {
                  if (Platform.OS === 'web') {
                    if (window.confirm(i18n.t('resetDeckStatsConfirm'))) {
                      void resetDeckStatistics();
                    }
                  } else {
                    Alert.alert(
                      i18n.t('resetDeckStats'),
                      i18n.t('resetDeckStatsConfirm'),
                      [
                        { text: i18n.t('cancel'), style: 'cancel' },
                        { 
                          text: i18n.t('resetDeckStats'), 
                          style: 'destructive',
                          onPress: () => void resetDeckStatistics(),
                        }
                      ]
                    );
                  }
                }}
              >
                <Text style={styles.infoModalBtnText}>{isResettingDeckStats ? 'Resetting…' : i18n.t('resetDeckStats')}</Text>
              </Pressable>

              <Pressable accessibilityRole="button" style={styles.infoModalBtn} onPress={() => setInfoDeck(null)}>
                <Text style={styles.infoModalBtnText}>{i18n.t('close')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>

      <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />
    </Container>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: spacing[5],
    paddingHorizontal: spacing[6],
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  header: {
    fontSize: 72,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
    marginBottom: 4,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.15)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 6,
  },
  subtitle: {
    color: '#0A1828',
    fontSize: 16,
    marginBottom: 16,
    fontWeight: '700',
    textAlign: 'center',
    opacity: 0.9,
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.4)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  badgeText: {
    color: '#0A1828',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#E8F5E9',
    color: '#0A1828',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#C8E6C9',
    fontSize: 16,
    fontWeight: '600',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  listContent: {
    paddingBottom: 120,
  },
  deckCard: {
    backgroundColor: '#E8F5E9',
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#C8E6C9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  deckMainPressTarget: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 44,
    zIndex: 5,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  deckMainPressed: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  glassDeckCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  deckCardPressed: {
    backgroundColor: '#C8E6C9',
    transform: [{ scale: 0.98 }],
  },
  deckHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  deckTitle: {
    color: '#1D3557',
    fontSize: 38,
    fontWeight: '900',
    marginBottom: 2, // reduced gap between title and stats
  },
  deckStats: {
    color: '#E67E22',
    fontWeight: '800',
    fontSize: 16,
    marginBottom: 16,
  },
  bannerBackground: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressBarBg: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(29,53,87,0.1)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#1D3557',
    borderRadius: 4,
  },
  bottomButtonsContainer: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
    flexDirection: 'row',
    gap: 12,
  },
  reviewAllBtn: {
    flex: 2,
    backgroundColor: '#1D3557',
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 5,
  },
  addDeckBtn: {
    flex: 1,
    backgroundColor: '#4CAF50',
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 5,
  },
  statisticsBtn: {
    width: 56,
    minHeight: 56,
    backgroundColor: '#6D28D9',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 5,
  },
  reviewAllBtnPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  reviewAllText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  modalCloseButton: {
    position: 'absolute',
    top: spacing[5],
    right: spacing[5],
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 4,
  },
  settingsBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsBtnText: {
    fontSize: 20,
  },
  infoModal: {
    backgroundColor: '#FFF',
    borderRadius: 24,
    padding: 32,
    width: '85%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 10,
  },
  infoModalTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#1D3557',
    marginBottom: 12,
    textAlign: 'center',
  },
  infoModalDesc: {
    fontSize: 16,
    color: '#455A64',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  statsGrid: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    marginBottom: 24,
    gap: 12,
  },
  statsCol: {
    flex: 1,
    gap: 12,
  },
  statBox: {
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#1D3557',
  },
  infoModalBtn: {
    backgroundColor: '#1D3557',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  infoModalBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
  tipsContainer: {
    width: '100%',
    backgroundColor: '#F1F5F9',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1D3557',
    marginBottom: 8,
  },
  tipsText: {
    fontSize: 13,
    color: '#455A64',
    marginBottom: 4,
  }
});
