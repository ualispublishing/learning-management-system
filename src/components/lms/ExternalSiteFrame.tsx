/**
 * @fileoverview src/components/lms/ExternalSiteFrame.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { EXTERNAL_SITE_ALLOW, EXTERNAL_SITE_SANDBOX } from '../../lib/externalSiteSecurity';
import { DemoEmbeddedCoursePortalId, getDemoEmbeddedCoursePortalDocument } from '../../lib/demoEmbeddedCoursePortal';
import { canonicalSafeHttpsUrl } from '../../lib/safeUrl';
import { useSettingsStore } from '../../lib/store/useSettingsStore';
import { useThemeColors } from '../../lib/useThemeColors';
import { userAlert as Alert } from '../../lib/userAlert';
import { getLearningStateService, recordConsentedLearningActivity } from '../../lib/learningState';

interface ExternalSiteFrameProps {
  url: string;
  title: string;
  minimumHeight?: number;
  /** Gives a site-only course the remaining app viewport without outer scroll. */
  fillViewport?: boolean;
  principalId?: string;
  courseId?: string;
  contentItemId?: string;
  previewMode?: boolean;
  /** Selects a reviewed, project-owned demo document. Arbitrary HTML is never accepted here. */
  demoPortalId?: DemoEmbeddedCoursePortalId;
}

const openExternal = async (url: string) => {
  try {
    await Linking.openURL(url);
  } catch (error) {
    Alert.alert('Course site could not be opened', error instanceof Error ? error.message : 'Try again or contact course staff.');
  }
};

/**
 * Full-course web presentation for an explicitly configured HTTPS resource.
 * It intentionally withholds camera, microphone, location, payment, and
 * referrer data. Institutions should still enforce a provider allow-list at
 * the server boundary; pages may refuse framing through CSP/X-Frame-Options.
 */
export const ExternalSiteFrame = ({
  url,
  title,
  minimumHeight = 640,
  fillViewport = false,
  principalId,
  courseId,
  contentItemId,
  previewMode = false,
  demoPortalId,
}: ExternalSiteFrameProps) => {
  const colors = useThemeColors();
  const reducedMotion = useSettingsStore(state => state.reducedMotion);
  const safeUrl = useMemo(() => canonicalSafeHttpsUrl(url), [url]);
  const demoDocument = useMemo(() => getDemoEmbeddedCoursePortalDocument(demoPortalId), [demoPortalId]);
  const frameShellRef = useRef<View | null>(null);
  const wasCenteredRef = useRef(false);
  const [frameRevision, setFrameRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [isCentered, setIsCentered] = useState(false);
  const [hasScrolledPast, setHasScrolledPast] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    let animationFrame = 0;
    const updatePosition = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const element = frameShellRef.current as unknown as HTMLElement | null;
        if (!element || focusMode) return;
        const bounds = element.getBoundingClientRect();
        const centerLine = window.innerHeight / 2;
        const centered = bounds.top <= centerLine && bounds.bottom >= centerLine;
        if (centered) wasCenteredRef.current = true;
        setIsCentered(centered);
        setHasScrolledPast(wasCenteredRef.current && bounds.bottom < 84);
      });
    };
    updatePosition();
    window.addEventListener('scroll', updatePosition, { capture: true, passive: true });
    window.addEventListener('resize', updatePosition, { passive: true });
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [focusMode]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !focusMode) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setFocusMode(false);
    };
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [focusMode]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !safeUrl || loaded) return;
    const timer = setTimeout(() => setLoadTimedOut(true), 8_000);
    return () => clearTimeout(timer);
  }, [frameRevision, loaded, safeUrl]);

  if (!safeUrl) {
    return (
      <View accessibilityRole="alert" style={[styles.notice, { borderColor: colors.error, backgroundColor: colors.card }]}> 
        <Text style={{ color: colors.error, fontWeight: '700' }}>This course site was blocked because it is not a valid HTTPS URL.</Text>
      </View>
    );
  }

  if (Platform.OS !== 'web') {
    return (
      <View style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.card }]}> 
        <Ionicons name="phone-portrait-outline" size={28} color={colors.primary} />
        <Text style={[styles.noticeTitle, { color: colors.text }]}>Open the course site full-screen</Text>
        <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>On mobile, linked courses use the device browser so they fill the screen and retain their own navigation and accessibility support.</Text>
        <Pressable accessibilityRole="link" accessibilityLabel={`Open ${title}`} onPress={() => void openExternal(safeUrl)} style={[styles.primaryAction, { backgroundColor: colors.primary }]}> 
          <Text style={{ color: colors.buttonText, fontWeight: '700' }}>Open course site</Text>
        </Pressable>
      </View>
    );
  }

  const isSameOrigin = typeof window !== 'undefined' && new URL(safeUrl).origin === window.location.origin;
  if (isSameOrigin) {
    return (
      <View accessibilityRole="alert" style={[styles.notice, { borderColor: colors.error, backgroundColor: colors.card }]}> 
        <Text style={{ color: colors.error, fontWeight: '700' }}>For security, the LMS cannot embed itself as a linked course.</Text>
        <Pressable accessibilityRole="link" onPress={() => void openExternal(safeUrl)} style={[styles.secondaryAction, { borderColor: colors.primary }]}> 
          <Text style={{ color: colors.primary, fontWeight: '700' }}>Open separately</Text>
        </Pressable>
      </View>
    );
  }

  const contextLine = focusMode
    ? 'Focus mode · press Escape to return to the LMS'
    : demoDocument
      ? 'Project-owned portal · static, sandboxed, and network-free'
      : isCentered
      ? 'Centered · Focus locks outer LMS scrolling around this site'
      : 'Embedded HTTPS course site · scroll inside the page';
  const flexibleFrame = focusMode || fillViewport;
  const handleFrameLoad = () => {
    setLoaded(true);
    setLoadTimedOut(false);
    if (previewMode || !principalId || !courseId || !contentItemId) return;
    const scope = { principalId, courseId, contentItemId };
    const loadedAt = Date.now();
    const service = getLearningStateService();
    // A generic opaque-origin embed can persist only the fact that its outer
    // frame loaded. It cannot safely claim provider progress or a resume point.
    void service.load(scope, 'external-site').then(existing => service.save(scope, 'external-site', {
      ...(existing?.payload || {}),
      loadedAt,
    })).catch(() => undefined);
    void recordConsentedLearningActivity({
      type: 'external-site-loaded',
      scope,
      occurredAt: loadedAt,
      source: 'lms-ui',
    }).catch(() => undefined);
  };

  return (
    <>
      {focusMode ? <View style={[styles.focusBackdrop, { pointerEvents: 'none' }]} /> : null}
      <View
        ref={frameShellRef}
        accessibilityViewIsModal={focusMode}
        style={[
          styles.frameShell,
          { borderColor: focusMode ? colors.primary : colors.border, backgroundColor: colors.card },
          fillViewport && styles.viewportFrameShell,
          focusMode && styles.focusFrameShell,
        ]}
      >
        <View style={[styles.frameToolbar, { borderBottomColor: colors.border, backgroundColor: colors.card }]}> 
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '700' }}>{title}</Text>
            <Text accessibilityLiveRegion="polite" numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12 }}>{contextLine}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={focusMode ? `Exit focus mode for ${title}` : `Focus ${title}`}
            accessibilityHint={focusMode ? 'Returns to the surrounding LMS page.' : 'Fills the viewport and temporarily locks outer LMS scrolling.'}
            accessibilityState={{ expanded: focusMode }}
            onPress={() => setFocusMode(value => !value)}
            style={[styles.iconAction, { borderColor: focusMode ? colors.primary : colors.border }]}
          >
            <Ionicons name={focusMode ? 'contract-outline' : 'scan-outline'} size={19} color={colors.primary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Reload ${title}`}
            onPress={() => { setLoaded(false); setLoadTimedOut(false); setFrameRevision(value => value + 1); }}
            style={[styles.iconAction, { borderColor: colors.border, marginLeft: 8 }]}
          >
            <Ionicons name="refresh" size={19} color={colors.primary} />
          </Pressable>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${title} in a new tab`}
            onPress={() => void openExternal(safeUrl)}
            style={[styles.iconAction, { borderColor: colors.border, marginLeft: 8 }]}
          >
            <Ionicons name="open-outline" size={19} color={colors.primary} />
          </Pressable>
        </View>
        {!loaded && (
          <View style={[styles.loadingNotice, { backgroundColor: colors.background, pointerEvents: 'none' }]}> 
            <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>
              {loadTimedOut ? 'The site may be offline or blocking embedded access.' : 'Loading course site…'}
            </Text>
          </View>
        )}
        <iframe
          key={frameRevision}
          src={demoDocument ? undefined : safeUrl}
          srcDoc={demoDocument || undefined}
          title={title}
          loading="eager"
          referrerPolicy="no-referrer"
          sandbox={EXTERNAL_SITE_SANDBOX}
          allow={EXTERNAL_SITE_ALLOW}
          onLoad={handleFrameLoad}
          style={{
            display: 'block',
            width: '100%',
            minHeight: flexibleFrame ? 0 : minimumHeight,
            height: flexibleFrame ? 'auto' : minimumHeight,
            flex: flexibleFrame ? 1 : undefined,
            border: 'none',
            background: '#fff',
          }}
        />
        <View style={[styles.fallbackBar, { borderTopColor: colors.border }]}> 
          <Text style={{ color: colors.textSecondary, fontSize: 12, flex: 1 }}>
            {demoDocument
              ? 'Project-owned demo portal: no external data is sent. The official Python tutorial remains available separately.'
              : 'Cross-origin privacy: the LMS sees only that this frame loaded—not clicks, typing, scrolling, or completion. Blank or blocked?'}
          </Text>
          <Pressable accessibilityRole="link" onPress={() => void openExternal(safeUrl)}>
            <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Open separately</Text>
          </Pressable>
        </View>
      </View>
      {hasScrolledPast && !fillViewport && !focusMode ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Return to embedded course site ${title}`}
          onPress={() => {
            const element = frameShellRef.current as unknown as HTMLElement | null;
            element?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
          }}
          style={[styles.returnCue, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="arrow-up" size={17} color={colors.buttonText} />
          <Text style={{ color: colors.buttonText, fontWeight: '800', marginLeft: 7 }}>Course site is above</Text>
        </Pressable>
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  frameShell: { width: '100%', borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  viewportFrameShell: { flex: 1, minHeight: 0, borderRadius: 0, borderLeftWidth: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  focusBackdrop: {
    position: 'fixed' as never,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 999,
    backgroundColor: 'rgba(2,8,16,.82)',
  },
  focusFrameShell: {
    position: 'fixed' as never,
    top: 8,
    right: 8,
    bottom: 8,
    left: 8,
    zIndex: 1000,
    width: 'auto',
    minHeight: 0,
    borderRadius: 14,
    ...(Platform.OS === 'web' ? { boxShadow: '0 28px 80px rgba(0,0,0,.55)' } : {}),
  },
  frameToolbar: { minHeight: 58, paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center' },
  iconAction: { width: 40, height: 40, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  loadingNotice: { position: 'absolute', top: 58, left: 0, right: 0, height: 52, zIndex: 1, alignItems: 'center', justifyContent: 'center' },
  fallbackBar: { minHeight: 42, paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  returnCue: {
    position: 'fixed' as never,
    right: 20,
    bottom: 20,
    zIndex: 100,
    minHeight: 44,
    paddingHorizontal: 15,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { boxShadow: '0 10px 28px rgba(0,0,0,.3)' } : {}),
  },
  notice: { minHeight: 240, borderWidth: 1, borderRadius: 14, padding: 24, alignItems: 'center', justifyContent: 'center' },
  noticeTitle: { fontSize: 18, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  primaryAction: { marginTop: 18, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12 },
  secondaryAction: { marginTop: 16, borderWidth: 1, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11 },
});
