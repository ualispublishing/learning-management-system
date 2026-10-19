import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { isPreparedAIDemo, loadPreparedSource, preparedDemoBaseUrl, type PreparedDemoSource } from '../../lib/ai/preparedDemo';
import type { AIDocumentAsset, AIProvenance } from '../../lib/ai/types';
import { useThemeColors } from '../../lib/useThemeColors';
import { assertConfiguredAISource } from '../../lib/ai/service';

const sourceMime = 'application/x-lms-prepared-source';
export function PreparedSourcePicker({ task, disabled = false, onSelect }: { task: 'syllabus' | 'flashcards'; disabled?: boolean; onSelect: (asset: AIDocumentAsset, sample?: PreparedDemoSource) => void }) {
  const colors = useThemeColors();
  const [sources, setSources] = useState<PreparedDemoSource[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const ownedUrl = useRef<string | null>(null); const active = useRef(true); const inFlight = useRef(false);
  const replaceOwnedUrl = (url: string) => {
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = url;
  };
  const demo = isPreparedAIDemo();
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    const base = preparedDemoBaseUrl();
    if (base && Platform.OS === 'web') void fetch(`${base}/demo-ai/catalog`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Start npm run demo:multiuser to load the prepared files.');
      const catalog = await response.json(); if (active.current && !controller.signal.aborted) setSources(catalog.entries);
    }).catch(reason => { if (active.current && !controller.signal.aborted) setError(reason.message); });
    return () => { active.current = false; controller.abort(); if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current); ownedUrl.current = null; };
  }, []);
  const choose = async (source: PreparedDemoSource) => {
    if (disabled || inFlight.current) return; inFlight.current = true; setBusy(true); setError('');
    try { const asset = await loadPreparedSource(source); if (!active.current) { URL.revokeObjectURL(asset.uri); return; } replaceOwnedUrl(asset.uri); onSelect(asset, source); }
    catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : 'Source could not be loaded.'); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const chooseDroppedFile = async (file: File) => {
    if (disabled || inFlight.current) return; inFlight.current = true; setBusy(true);
    try {
      // Learning-material drops can be ordinary attachments; syllabus drops are always AI input.
      if (task === 'syllabus') assertConfiguredAISource({ document: { uri: 'blob:pending', name: file.name, size: file.size, mimeType: file.type, file } }, task);
      const digest = demo ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('') : undefined;
      const sample = sources.find(source => source.sha256 === digest);
      if (sample && sample.task !== task) throw new Error('Use the syllabus area for the syllabus, and learning material for lecture files.');
      if (!active.current) return;
      const uri = URL.createObjectURL(file); replaceOwnedUrl(uri);
      onSelect({ uri, name: file.name, size: file.size, mimeType: file.type || sample?.mimeType, file, kind: sample?.kind }, sample);
    } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : 'The dropped file could not be read.'); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  if (Platform.OS !== 'web') return null;
  const zone = <View style={{ padding: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary, borderRadius: 8 }}>
    <Text style={{ color: colors.primary, fontWeight: '700' }}>{busy ? 'Loading source…' : `Drop one ${task === 'syllabus' ? 'syllabus document' : 'learning material file'} here`}</Text>
    <Text style={{ color: colors.textSecondary, marginTop: 4 }}>Or use the file selection button above.</Text>
  </View>;
  return <View style={{ marginTop: 12 }}>
    <div aria-label={`${task} file drop area`}
      onDragOver={(event: React.DragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = disabled || busy ? 'none' : 'copy'; }}
      onDrop={(event: React.DragEvent) => {
        event.preventDefault(); event.stopPropagation(); if (disabled || busy) return; setError('');
        const id = event.dataTransfer.getData(sourceMime);
        if (id) { const source = sources.find(entry => entry.id === id); if (!source || source.task !== task) { setError('Use the syllabus area for the syllabus, and learning material for lecture files.'); return; } void choose(source); return; }
        const files = event.dataTransfer.files;
        if (files.length !== 1) { setError('Drop one file at a time.'); return; }
        const file = files[0]; if (file.size > 50 * 1024 * 1024) { setError('Choose a file no larger than 50 MB.'); return; }
        void chooseDroppedFile(file);
      }}
    >{zone}</div>
    {demo ? <View style={{ marginTop: 14, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: '700' }}>Prepared MIT OCW demo files</Text>
      <Text style={{ color: colors.textSecondary, marginTop: 5 }}>6.0001, Fall 2016 · Lecture 1. Uses pre-generated results; no live AI call. Choose a sample, drag it to the area above, or download it and drop the file back in.</Text>
      {sources.filter(source => source.task === task).map(source => <div key={source.id}>
        <View style={{ marginTop: 10, gap: 6 }}>
          <div aria-label={`Drag ${source.name} to the drop area`} draggable={!disabled && !busy} onDragStart={(event: React.DragEvent) => { event.dataTransfer.setData(sourceMime, source.id); event.dataTransfer.effectAllowed = 'copy'; }} style={{ color: colors.textSecondary, cursor: disabled || busy ? 'default' : 'grab', fontFamily: 'system-ui, sans-serif', fontSize: 12, padding: '6px 0' }}>⠿ Drag this file</div>
          <Pressable disabled={disabled || busy} accessibilityState={{ disabled: disabled || busy }} accessibilityRole="button" accessibilityLabel={`Use prepared ${source.name}`} onPress={() => void choose(source)} style={{ padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 6 }}><Text style={{ color: colors.primary, fontWeight: '600' }}>{source.title}</Text><Text style={{ color: colors.textSecondary, fontSize: 12 }}>{source.name}</Text></Pressable>
          <Pressable accessibilityRole="link" accessibilityLabel={`Download ${source.name}`} onPress={() => void Linking.openURL(`${preparedDemoBaseUrl()}/demo-ai/files/${source.sha256}?download=1`)}><Text style={{ color: colors.primary }}>Download source</Text></Pressable>
        </View></div>)}
      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 12 }}>MIT OpenCourseWare · CC BY-NC-SA 4.0. Educational preparation only; obtain permission or replace before commercial use. No MIT endorsement.</Text>
    </View> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 8 }}>{error}</Text> : null}
  </View>;
}

export function PreparedAccuracyNotice({ provenance }: { provenance?: AIProvenance }) {
  const colors = useThemeColors();
  if (provenance?.model !== 'prepared-demo/v1') return null;
  return <View style={{ padding: 14, marginVertical: 12, borderWidth: 1, borderColor: colors.primary, borderRadius: 8 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: '700' }}>Prepared result · source checks passed</Text>
    <Text style={{ color: colors.textSecondary, marginTop: 6 }}>File contents match the prepared source. Quotations and locations were checked against the extracted text. Output matches the saved reference; response structure and requested card count were checked.</Text>
    <Text style={{ color: colors.textSecondary, marginTop: 6 }}>These checks do not establish error-free teaching content. Verify meaning and completeness below. Editing a draft requires renewed review. No live model was called.</Text>
  </View>;
}
