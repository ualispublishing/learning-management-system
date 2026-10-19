/**
 * @fileoverview Root Expo Router shell for app initialization and layout chrome.
 *
 * Reviewer notes:
 * - Owns settings, font, and LMS bootstrap before any routed screen renders.
 * - Gates shared-demo sign-in and principal refresh behavior in development.
 * - Keeps web canvas resizing local to the shell so feature screens can remain
 *   focused on LMS or flashcard behavior.
 */
import { useState, useEffect, useMemo } from 'react';
import { Stack, ErrorBoundaryProps, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSettingsStore } from '../lib/store/useSettingsStore';
import { useLMSStore } from '../lib/store/useLMSStore';
import { setI18nConfig } from '../lib/i18n';
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { getError } from '../lib/errorCodes';
import { InstitutionBrand, InstitutionColorBar } from '../components/ui/InstitutionBrand';
import branding from '../lib/branding.generated.json';
import { GlobalHeader } from '../components/ui/GlobalHeader';

import { View, Platform, StyleSheet, Text, Pressable, KeyboardAvoidingView, ActivityIndicator, useWindowDimensions, PanResponder } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useThemeColors } from '../lib/useThemeColors';
import { typography, spacing } from '../lib/theme';
import {
  AppCanvasResizeSide,
  APP_CANVAS_RESIZE_CONTROL_SIZE,
  clampAppContentWidth,
  MIN_APP_CONTENT_WIDTH,
  MIN_RESIZABLE_VIEWPORT_WIDTH,
  resolveAppCanvasDragWidth,
  resolveAppCanvasKeyboardWidth,
  resolveAppCanvasMaxWidth,
  resolveAppCanvasResizeControlLeft,
  resolveAppCanvasViewportMaximum,
} from '../lib/appCanvasWidth';
import { isSharedDemoMode, subscribeToSharedDemoChanges } from '../lib/repositories/remote/SharedDemoRepositoryFactory';
import { DemoSignIn } from '../components/lms/DemoSignIn';
import { isPreparedAIDemo } from '../lib/ai/preparedDemo';

const safeInitializationError = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (__DEV__) return message || 'LMS initialization failed.';
  if (message.startsWith('Institution repositories are not configured.')) {
    return 'This LMS deployment is not connected to its institution services. No learner data was loaded.';
  }
  return 'Institutional data could not be securely loaded. Retry or contact your institution.';
};

const APP_CANVAS_RESIZE_SIDES: readonly AppCanvasResizeSide[] = ['left', 'right'];

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const colors = useThemeColors();
  return (
    <View style={[styles.errorContainer, { backgroundColor: colors.background }]}>
      <View style={{ marginBottom: 20 }}><InstitutionBrand size={64} showName /></View>
      <Text accessibilityRole="header" style={[styles.errorTitle, { color: colors.text }]}>Oops! Something went wrong.</Text>
      <Text style={[styles.errorSubtitle, { color: colors.textSecondary }]}>We have encountered an unexpected error.</Text>
      <View style={[styles.errorBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.errorText, { color: colors.text }]}>
          {__DEV__ ? `${getError('S5000')}\n\n${error.message}` : getError('S5000')}
        </Text>
      </View>
      <Pressable accessibilityRole="button" style={[styles.retryButton, { backgroundColor: colors.primary }]} onPress={retry}>
        <Text style={[styles.retryButtonText, { color: colors.buttonText }]}>Try Again</Text>
      </Pressable>
    </View>
  );
}

export default function Layout() {
  const { loadSettings, language, theme, appContentWidth, setAppContentWidth } = useSettingsStore();
  const { width: viewportWidth } = useWindowDimensions();
  const [isInitializingMocks, setIsInitializingMocks] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [demoBusyEmail, setDemoBusyEmail] = useState<string | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [isResizingCanvas, setIsResizingCanvas] = useState(false);
  const currentUserId = useLMSStore(state => state.currentUserId);
  const login = useLMSStore(state => state.login);
  const logout = useLMSStore(state => state.logout);
  const initializeLMS = useLMSStore(state => state.initializeMocks);
  const refreshSharedDemoState = useLMSStore(state => state.refreshSharedDemoState);
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.title = branding.name;
  }, []);

  useEffect(() => {
    setI18nConfig(language);
  }, [language]);

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    let active = true;
    Promise.all([loadSettings(), useLMSStore.getState().initializeMocks()])
      .then(() => { if (active) setInitializationError(null); })
      .catch(error => { if (active) setInitializationError(safeInitializationError(error)); })
      .finally(() => { if (active) setIsInitializingMocks(false); });
    return () => { active = false; };
  }, [initializationAttempt, loadSettings]);

  useEffect(() => {
    if (!isSharedDemoMode || !currentUserId) return;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeToSharedDemoChanges(currentUserId, event => {
      if (event.kind !== 'reset' && event.actorId === currentUserId) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refreshSharedDemoState(), 150);
    });
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [currentUserId, refreshSharedDemoState]);

  const colors = useThemeColors();
  const pathname = usePathname();
  const isDemoPage = Platform.OS === 'web' && isPreparedAIDemo() && (pathname === '/ai-demo' || pathname === '/demo');
  const isCourseScreen = pathname.includes('/admin/course/');
  const desktopResizeControlsVisible = !isDemoPage && !isCourseScreen && Platform.OS === 'web' && viewportWidth >= MIN_RESIZABLE_VIEWPORT_WIDTH;
  const viewportCanvasMaximum = desktopResizeControlsVisible
    ? resolveAppCanvasViewportMaximum(viewportWidth)
    : MIN_APP_CONTENT_WIDTH;
  const persistedDisplayedWidth = Platform.OS === 'web'
    ? clampAppContentWidth(appContentWidth, viewportCanvasMaximum)
    : appContentWidth;
  const displayedAppContentWidth = dragWidth ?? persistedDisplayedWidth;
  const appCanvasMaxWidth = resolveAppCanvasMaxWidth(
    Platform.OS === 'web',
    viewportWidth,
    displayedAppContentWidth,
  );

  const adjustCanvasWidth = (delta: number) => {
    const nextWidth = clampAppContentWidth(displayedAppContentWidth + delta, viewportCanvasMaximum);
    setDragWidth(null);
    setAppContentWidth(nextWidth);
  };

  const resizePanResponders = useMemo(() => {
    const createResizePanResponder = (side: AppCanvasResizeSide) => {
      const resolveDragWidth = (horizontalDrag: number) => resolveAppCanvasDragWidth(
        side,
        persistedDisplayedWidth,
        horizontalDrag,
        viewportCanvasMaximum,
      );
      const finishDrag = (_event: unknown, gestureState: { dx: number }) => {
        setIsResizingCanvas(false);
        setDragWidth(null);
        setAppContentWidth(resolveDragWidth(gestureState.dx));
      };
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gestureState) => Math.abs(gestureState.dx) > 1,
        onPanResponderGrant: () => {
          setIsResizingCanvas(true);
        },
        onPanResponderMove: (_event, gestureState) => {
          // The canvas stays centered: either edge moves one pixel while the
          // total width changes by two. Left-edge dragging has the inverse sign.
          setDragWidth(resolveDragWidth(gestureState.dx));
        },
        onPanResponderRelease: finishDrag,
        onPanResponderTerminate: finishDrag,
        onPanResponderTerminationRequest: () => false,
      });
    };
    return {
      left: createResizePanResponder('left'),
      right: createResizePanResponder('right'),
    };
  }, [persistedDisplayedWidth, setAppContentWidth, viewportCanvasMaximum]);

  // Custom typography is optional. A failed download must not block sign-in,
  // initialization recovery, or the application using system fonts.
  if ((!fontsLoaded && !fontError) || isInitializingMocks) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <InstitutionBrand size={72} showName />
        <View style={{ marginTop: 24 }}><ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Loading learning management system" /></View>
      </View>
    );
  }

  if (initializationError) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: colors.background }]}>
        <View style={{ marginBottom: 20 }}><InstitutionBrand size={64} showName /></View>
        <Text accessibilityRole="header" style={[styles.errorTitle, { color: colors.text }]}>The LMS could not load.</Text>
        <Text style={[styles.errorSubtitle, { color: colors.textSecondary }]}>{initializationError}</Text>
        <Pressable accessibilityRole="button" style={[styles.retryButton, { backgroundColor: colors.primary }]} onPress={() => {
          setIsInitializingMocks(true);
          setInitializationAttempt(attempt => attempt + 1);
        }}>
          <Text style={[styles.retryButtonText, { color: colors.buttonText }]}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (__DEV__ && isSharedDemoMode && !isDemoPage && (!currentUserId || isSigningIn)) {
    return (
      <DemoSignIn
        onShowGuide={Platform.OS === 'web' && isPreparedAIDemo() ? () => router.push('/demo') : undefined}
        onShowAI={Platform.OS === 'web' && isPreparedAIDemo() ? () => router.push('/ai-demo') : undefined}
        busyEmail={demoBusyEmail}
        error={signInError}
        onSignIn={async email => {
          if (isSigningIn) return;
          setIsSigningIn(true);
          setDemoBusyEmail(email);
          setSignInError(null);
          try {
            await login(email);
            await initializeLMS();
            router.replace('/admin');
          } catch (error) {
            try {
              await logout();
            } catch {
              // The sign-in error is the actionable result in this local flow.
            }
            setSignInError(error instanceof Error ? error.message : 'The shared demo account could not be loaded.');
          } finally {
            setDemoBusyEmail(null);
            setIsSigningIn(false);
          }
        }}
      />
    );
  }

  if (!__DEV__ && !currentUserId) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: colors.background }]}> 
        <View style={{ marginBottom: 20 }}><InstitutionBrand size={64} showName /></View>
        <Text accessibilityRole="header" style={[styles.errorTitle, { color: colors.text }]}>Sign in to your institution</Text>
        <Text style={[styles.errorSubtitle, { color: colors.textSecondary }]}>Your institution controls authentication. No course, grade, or message data loads before the signed-in identity is verified.</Text>
        {!!signInError && <Text accessibilityRole="alert" style={{ color: colors.error, textAlign: 'center', marginBottom: spacing[4] }}>{signInError}</Text>}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isSigningIn, busy: isSigningIn }}
          disabled={isSigningIn}
          style={[styles.retryButton, { backgroundColor: colors.primary, opacity: isSigningIn ? 0.6 : 1 }]}
          onPress={async () => {
            if (isSigningIn) return;
            setIsSigningIn(true);
            setSignInError(null);
            try {
              await login();
              await initializeLMS();
            } catch (error) {
              setSignInError(__DEV__ && error instanceof Error
                ? error.message
                : 'Institution sign-in could not be completed. Retry or contact your institution.');
            } finally {
              setIsSigningIn(false);
            }
          }}
        >
          <Text style={[styles.retryButtonText, { color: colors.buttonText }]}>{isSigningIn ? 'Signing in…' : 'Continue with institution SSO'}</Text>
        </Pressable>
      </View>
    );
  }

  const isDeepScreen = pathname.includes('/deck')
    || pathname.includes('/study')
    || pathname.includes('/review')
    || pathname.includes('/card')
    || pathname.includes('/stats')
    || isCourseScreen;
  return (
    <GestureHandlerRootView style={[styles.root, { backgroundColor: Platform.OS === 'web' ? colors.navBgEnd : colors.navBg }]}>
      <StatusBar style={theme === 'dark' ? 'light' : theme === 'light' ? 'dark' : 'auto'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, width: '100%', alignItems: 'center' }}>
        <View style={[styles.appContainer, { backgroundColor: colors.navBg, maxWidth: isDemoPage || (isCourseScreen && Platform.OS === 'web') ? undefined : appCanvasMaxWidth }]}>
          {isDemoPage ? null : isDeepScreen ? <View style={{ width: '100%', backgroundColor: colors.navBg }}>
            <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}><InstitutionBrand size={28} showName /></View>
            <InstitutionColorBar />
            {Platform.OS === 'web' && isPreparedAIDemo() ? <Pressable accessibilityRole="button" accessibilityLabel="Open Demo guide" onPress={() => router.push('/demo')} style={{ padding: 12 }}><Text style={{ color: colors.primary, fontWeight: '700' }}>Demo guide →</Text></Pressable> : null}
          </View> : <GlobalHeader />}
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        </View>
        {desktopResizeControlsVisible && (
          APP_CANVAS_RESIZE_SIDES.map(side => (
            <View
              key={side}
              {...resizePanResponders[side].panHandlers}
              {...(Platform.OS === 'web' ? {
                // React Native Web forwards slider keyboard events even though
                // the native View type does not declare them.
                onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
                  const key = event.key ?? event.nativeEvent?.key;
                  const nextWidth = resolveAppCanvasKeyboardWidth(key, displayedAppContentWidth, viewportCanvasMaximum);
                  if (nextWidth !== null) {
                    event.preventDefault?.();
                    setDragWidth(null);
                    setAppContentWidth(nextWidth);
                  }
                },
                'aria-orientation': 'horizontal',
                'aria-valuemin': MIN_APP_CONTENT_WIDTH,
                'aria-valuemax': viewportCanvasMaximum,
                'aria-valuenow': displayedAppContentWidth,
                'aria-valuetext': `${displayedAppContentWidth} pixels wide`,
              } as object : {})}
              accessible
              focusable
              accessibilityRole="adjustable"
              accessibilityLabel={`Resize app canvas from ${side} edge`}
              accessibilityHint={side === 'left'
                ? 'Drag left to expand or right to contract. Keyboard users can use the arrow, Home, and End keys.'
                : 'Drag right to expand or left to contract. Keyboard users can use the arrow, Home, and End keys.'}
              accessibilityValue={{
                min: MIN_APP_CONTENT_WIDTH,
                max: viewportCanvasMaximum,
                now: displayedAppContentWidth,
                text: `${displayedAppContentWidth} pixels wide`,
              }}
              accessibilityActions={[{ name: 'decrement', label: 'Make narrower' }, { name: 'increment', label: 'Make wider' }]}
              onAccessibilityAction={event => {
                if (event.nativeEvent.actionName === 'increment') adjustCanvasWidth(32);
                if (event.nativeEvent.actionName === 'decrement') adjustCanvasWidth(-32);
              }}
              style={[
                styles.resizeHandle,
                {
                  left: resolveAppCanvasResizeControlLeft(side, viewportWidth, displayedAppContentWidth),
                },
              ]}
            >
              <View style={[styles.resizeHandleVisual, { backgroundColor: colors.card, borderColor: isResizingCanvas ? colors.primary : colors.border }]}> 
                <Ionicons name="chevron-back" size={9} color={colors.primary} />
                <View style={[styles.resizeHandleDivider, { backgroundColor: colors.border }]} />
                <Ionicons name="chevron-forward" size={9} color={colors.primary} />
              </View>
            </View>
          ))
        )}
      </KeyboardAvoidingView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
  },
  appContainer: {
    flex: 1,
    width: '100%',
    ...(Platform.OS === 'web' ? {
      boxShadow: '0px 0px 30px rgba(0,0,0,0.2)',
    } : {}) as any,
  },
  resizeHandle: {
    position: 'absolute',
    top: '50%',
    width: APP_CANVAS_RESIZE_CONTROL_SIZE,
    height: APP_CANVAS_RESIZE_CONTROL_SIZE,
    marginTop: -(APP_CANVAS_RESIZE_CONTROL_SIZE / 2),
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    ...(Platform.OS === 'web' ? {
      cursor: 'ew-resize',
      touchAction: 'none',
      userSelect: 'none',
    } : {}) as any,
  },
  resizeHandleVisual: {
    width: 30,
    height: 26,
    borderWidth: 1,
    borderRadius: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { boxShadow: '0 2px 7px rgba(0,0,0,0.15)' } : {}) as any,
  },
  resizeHandleDivider: {
    width: 1,
    height: 12,
    marginHorizontal: 2,
  },

  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[6],
  },
  errorTitle: {
    fontSize: typography['3xl'],
    fontWeight: '900',
    marginBottom: spacing[2],
    textAlign: 'center',
  },
  errorSubtitle: {
    fontSize: typography.base,
    marginBottom: spacing[6],
    textAlign: 'center',
  },
  errorBox: {
    padding: spacing[4],
    borderRadius: 12,
    borderWidth: 1,
    width: '100%',
    maxWidth: 400,
    marginBottom: spacing[6],
  },
  errorText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: typography.sm,
  },
  retryButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  retryButtonText: {
    fontSize: typography.base,
    fontWeight: 'bold',
  }
});
