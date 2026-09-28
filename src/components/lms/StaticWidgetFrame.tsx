/**
 * @fileoverview src/components/lms/StaticWidgetFrame.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { staticWidgetDocument, staticWidgetPlainText } from '../../lib/staticWidget';
import { useThemeColors } from '../../lib/useThemeColors';

export { staticWidgetDocument, staticWidgetPlainText } from '../../lib/staticWidget';

interface StaticWidgetFrameProps {
  html: string;
  css: string;
  title: string;
  minimumHeight?: number;
}

/**
 * A script-free iframe whose height follows its document up to a practical
 * viewport, then scrolls internally. The native fallback exposes the authored
 * text instead of making the course material web-only. The
 * allow-same-origin token lets the trusted host measure the srcDoc; scripts,
 * forms, navigation, popups, and network requests remain sandboxed/CSP-blocked.
 */
export const StaticWidgetFrame = ({ html, css, title, minimumHeight = 320 }: StaticWidgetFrameProps) => {
  const colors = useThemeColors();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(minimumHeight);

  const measure = useCallback(() => {
    try {
      const document = frameRef.current?.contentDocument;
      if (!document) return;
      const nextHeight = Math.max(
        minimumHeight,
        document.documentElement?.scrollHeight || 0,
        document.body?.scrollHeight || 0,
        document.documentElement?.offsetHeight || 0,
        document.body?.offsetHeight || 0,
      );
      if (Number.isFinite(nextHeight)) setHeight(Math.min(nextHeight, 1_200));
    } catch {
      // If a browser tightens sandbox origin rules, retain the safe minimum
      // height instead of breaking the entire course view.
    }
  }, [minimumHeight]);

  const attachMeasurement = useCallback(() => {
    try {
      const document = frameRef.current?.contentDocument;
      measure();
      observerRef.current?.disconnect();
      if (!document) return;
      if (typeof ResizeObserver !== 'undefined' && document.body) {
        observerRef.current = new ResizeObserver(() => measure());
        observerRef.current.observe(document.body);
        if (document.documentElement) observerRef.current.observe(document.documentElement);
      }
    } catch {
      observerRef.current?.disconnect();
    }
  }, [measure]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  if (Platform.OS !== 'web') {
    const plainText = staticWidgetPlainText(html);
    return (
      <View style={{ minHeight: minimumHeight, padding: 20 }}>
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 12 }}>{title}</Text>
        <Text selectable style={{ color: colors.text }}>{plainText || 'This custom panel does not contain readable text. Ask course staff for an accessible alternative.'}</Text>
      </View>
    );
  }

  return (
    <iframe
      ref={frameRef}
      onLoad={attachMeasurement}
      scrolling="auto"
      style={{ display: 'block', width: '100%', height, border: 'none', overflow: 'auto' }}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      srcDoc={staticWidgetDocument(html, css, title)}
      title={title}
    />
  );
};
