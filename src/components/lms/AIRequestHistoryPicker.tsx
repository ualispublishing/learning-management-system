import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { getAIService } from '../../lib/ai/service';
import { AIRequestError, readAIHistoryPage, savedAIRequest, type AIRequestTask } from '../../lib/ai/requestRecovery';
import type { AIGenerationInput, AIRequestHistory, AIRequestHistoryPage } from '../../lib/ai/types';
import { useThemeColors } from '../../lib/useThemeColors';

interface Props { task: AIRequestTask; input: AIGenerationInput; disabled: boolean; onSelect: (request: AIRequestError) => void }

/** History is optional; prepared playback and status-only providers keep their existing UI. */
export function AIRequestHistoryPicker(props: Props) {
  let history: AIRequestHistory | undefined;
  try { history = getAIService().requestHistory; } catch { return null; }
  if (!history || !props.input.courseId) return null;
  return <HistoryList key={`${props.input.courseId}:${props.task}`} {...props} history={history} courseId={props.input.courseId} />;
}

function HistoryList({ task, input, courseId, disabled, onSelect, history }: Props & { history: AIRequestHistory; courseId: string }) {
  const colors = useThemeColors();
  const [page, setPage] = useState<AIRequestHistoryPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => () => { revision.current++; }, [history]);
  const load = async (cursor?: string) => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    const current = ++revision.current;
    setBusy(true); setError(null); setPage(null);
    try {
      const result = readAIHistoryPage(await history.list(task, courseId, cursor), task, courseId);
      if (current === revision.current) setPage(result);
    } catch {
      if (current === revision.current) setError('Saved requests could not be loaded. Check your session and course access, then refresh history.');
    } finally {
      inFlight.current = false;
      if (current === revision.current) setBusy(false);
    }
  };
  const unavailable = disabled || busy;
  const buttonStyle = { borderColor: colors.border, borderWidth: 1, borderRadius: 8, minHeight: 44, padding: 12, marginTop: 8 };
  return <View style={{ width: '100%', maxWidth: 560, marginTop: 12 }}>
    <Text style={{ color: colors.textSecondary }}>Already generated this material? Reselect the original file or text to recover a retained draft. Recovery checks the source and settings without generating again.</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: unavailable, busy }} disabled={unavailable} onPress={() => void load()} style={buttonStyle}>
      <Text style={{ color: colors.text, fontWeight: 'bold' }}>{busy ? 'Loading saved requests…' : 'Find saved AI requests'}</Text>
    </TouchableOpacity>
    {error && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 8 }}>{error}</Text>}
    {page && <>
      <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: 'bold', marginTop: 12 }}>Your saved requests for this course</Text>
      {page.items.length === 0 && <Text style={{ color: colors.textSecondary, marginTop: 8 }}>No retained requests were found.</Text>}
      <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled">
        {page.items.map(item => <View key={item.id} style={{ borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 10 }}>
          <Text style={{ color: colors.text }}>{item.fileName ?? 'Pasted source'}{item.fileName && item.hasPastedText ? ' + pasted text' : ''}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{new Date(item.createdAt).toLocaleString()} · {item.status === 'succeeded' ? 'Draft saved' : item.status === 'processing' ? 'Processing' : 'Outcome uncertain'}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Language: {item.locale}{task === 'flashcards' ? ` · Requested cards: ${item.requestedCardCount}` : ''} · Retained until {new Date(item.expiresAt).toLocaleString()}</Text>
          <Text selectable style={{ color: colors.textSecondary, fontSize: 12 }}>Request: {item.requestId}</Text>
          {item.status === 'uncertain' ? <Text style={{ color: colors.textSecondary }}>Ask your administrator to reconcile this request before generating again.</Text>
            : <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Recover saved request ${item.requestId}`} accessibilityState={{ disabled: unavailable }} disabled={unavailable}
              onPress={() => { if (!unavailable) onSelect(savedAIRequest(history, task, input, item.requestId)); }} style={buttonStyle}>
              <Text style={{ color: colors.text, fontWeight: 'bold' }}>Recover with selected source</Text>
            </TouchableOpacity>}
        </View>)}
      </ScrollView>
      {page.nextCursor && <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: unavailable }} disabled={unavailable} onPress={() => void load(page.nextCursor!)} style={buttonStyle}>
        <Text style={{ color: colors.text }}>Older saved requests</Text>
      </TouchableOpacity>}
    </>}
  </View>;
}
