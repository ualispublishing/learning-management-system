/**
 * @fileoverview src/components/lms/FlashcardReviewModal.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { userAlert as Alert } from '../../lib/userAlert';
import { useThemeColors } from '../../lib/useThemeColors';
import {
  AIDocumentAsset,
  AIProcessingAttestation,
  AIProvenance,
  beginAIRequestSession,
  completeAIRequestSession,
  createAIProcessingAttestation,
  createAIRequestSessionState,
  GeneratedFlashcard,
  generateValidatedFlashcards,
  isCurrentAIRequestSession,
  resetAIRequestSession,
  runAttestedAIRequest,
} from '../../lib/ai';
import { createEntityId } from '../../lib/id';

interface FlashcardReviewModalProps {
  visible: boolean;
  onClose: () => void;
  onApprove: (cards: GeneratedFlashcard[], attestation: AIProcessingAttestation) => Promise<void> | void;
  sourceText?: string;
  sourceDocument?: AIDocumentAsset;
  courseTitle?: string;
  requestedCardCount?: number;
}

export const FlashcardReviewModal = ({
  visible,
  onClose,
  onApprove,
  sourceText,
  sourceDocument,
  courseTitle,
  requestedCardCount = 30,
}: FlashcardReviewModalProps) => {
  const colors = useThemeColors();
  const [isGenerating, setIsGenerating] = useState(false);
  const [cards, setCards] = useState<GeneratedFlashcard[]>([]);
  const [provenance, setProvenance] = useState<AIProvenance | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [sourceRightsConfirmed, setSourceRightsConfirmed] = useState(false);
  const [sourceAttestation, setSourceAttestation] = useState<AIProcessingAttestation | null>(null);
  const [generationStarted, setGenerationStarted] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const publishingRef = useRef(false);
  const generationSessionRef = useRef(createAIRequestSessionState());
  const sourceDocumentUri = sourceDocument?.uri;
  const sourceDocumentName = sourceDocument?.name;
  const sourceDocumentMimeType = sourceDocument?.mimeType;
  const sourceDocumentSize = sourceDocument?.size;
  const sourceDocumentFile = sourceDocument?.file;
  const sourceDocumentKind = sourceDocument?.kind;
  const generationInput = useMemo(() => ({
    sourceText,
    document: sourceDocumentUri && sourceDocumentName ? {
      uri: sourceDocumentUri,
      name: sourceDocumentName,
      mimeType: sourceDocumentMimeType,
      size: sourceDocumentSize,
      file: sourceDocumentFile,
      kind: sourceDocumentKind,
    } : undefined,
    courseTitle,
    requestedCardCount,
  }), [courseTitle, requestedCardCount, sourceDocumentFile, sourceDocumentKind, sourceDocumentMimeType, sourceDocumentName, sourceDocumentSize, sourceDocumentUri, sourceText]);

  const generate = useCallback(async (session: number, attestation: AIProcessingAttestation) => {
    setIsGenerating(true);
    setError(null);
    setCards([]);
    setProvenance(undefined);
    try {
      const generated = await runAttestedAIRequest(attestation, () => generateValidatedFlashcards(generationInput));
      if (isCurrentAIRequestSession(generationSessionRef.current, session)) {
        setCards(generated);
        setProvenance(generated[0]?.provenance);
      }
    } catch (generationError) {
      if (isCurrentAIRequestSession(generationSessionRef.current, session)) {
        setError(generationError instanceof Error ? generationError.message : 'Flashcard generation failed.');
      }
    } finally {
      if (completeAIRequestSession(generationSessionRef.current, session)) setIsGenerating(false);
    }
  }, [generationInput]);

  useEffect(() => {
    resetAIRequestSession(generationSessionRef.current);
    // The modal is a transactional editor: a source/visibility change must discard its prior transaction.
    /* eslint-disable react-hooks/set-state-in-effect */
    setIsGenerating(false);
    setCards([]);
    setProvenance(undefined);
    setError(null);
    setPublishError(null);
    setSourceRightsConfirmed(false);
    setSourceAttestation(null);
    setGenerationStarted(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [generationInput, visible]);

  const startGeneration = () => {
    if (!visible || !sourceRightsConfirmed) return;
    const session = beginAIRequestSession(generationSessionRef.current);
    if (session === null) return;
    const attestation = createAIProcessingAttestation();
    setSourceAttestation(attestation);
    setGenerationStarted(true);
    void generate(session, attestation);
  };

  const retryGeneration = () => {
    if (!visible || !sourceAttestation) return;
    const session = beginAIRequestSession(generationSessionRef.current);
    if (session === null) return;
    void generate(session, sourceAttestation);
  };

  const handleEdit = (id: string, field: 'front' | 'back' | 'sourceExcerpt' | 'sourceLocation', value: string) => {
    setPublishError(null);
    setCards(previous => previous.map(card => card.id === id ? { ...card, [field]: value, reviewerEdited: true, reviewerVerified: false } : card));
  };

  const handleAdd = () => {
    if (cards.length >= 100) return;
    setPublishError(null);
    setCards(previous => [...previous, {
      id: createEntityId('review-card'),
      front: '',
      back: '',
      sourceExcerpt: '',
      confidence: 0,
      tags: ['reviewer-authored'],
      reviewerEdited: true,
      reviewerVerified: false,
      provenance,
    }]);
  };

  const publishableCards = cards
    .filter(card => card.front.trim() && card.back.trim() && card.sourceExcerpt.trim())
    .map(card => ({
      ...card,
      front: card.front.trim(),
      back: card.back.trim(),
      sourceExcerpt: card.sourceExcerpt.trim(),
      sourceLocation: card.sourceLocation?.trim() || undefined,
      tags: card.tags?.map(tag => tag.trim()).filter(Boolean),
    }));
  const incompleteCardCount = cards.length - publishableCards.length;
  const unverifiedCardCount = publishableCards.filter(card => !card.reviewerVerified).length;
  const normalizedCardKeys = publishableCards.map(card => `${card.front.normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase()}\u0000${card.back.normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase()}`);
  const duplicateCardCount = normalizedCardKeys.length - new Set(normalizedCardKeys).size;
  const canPublish = publishableCards.length > 0 && incompleteCardCount === 0 && unverifiedCardCount === 0 && duplicateCardCount === 0 && Boolean(sourceAttestation) && !isPublishing;
  const closeReview = () => {
    if (isPublishing) return;
    if (!isGenerating && !cards.length) {
      onClose();
      return;
    }
    Alert.alert(
      isGenerating ? 'Cancel flashcard generation?' : 'Discard reviewed flashcards?',
      isGenerating
        ? 'The remote request may already be processing, and no generated cards will be retained.'
        : 'Generated cards, reviewer edits, and verification choices have not been published.',
      [
        { text: 'Keep reviewing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={closeReview}>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold' }}>Review AI-generated flashcards</Text>
              <Text style={{ color: colors.textSecondary, marginTop: 5 }}>Verify each card against its cited source before publishing.</Text>
            </View>
            <TouchableOpacity disabled={isPublishing} onPress={closeReview} style={{ padding: 5, opacity: isPublishing ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel="Close flashcard review" accessibilityState={{ disabled: isPublishing, busy: isPublishing }}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {!generationStarted ? (
            <View style={styles.loadingContainer}>
              <Ionicons name="shield-checkmark-outline" size={42} color={colors.primary} />
              <Text accessibilityRole="header" style={{ color: colors.text, marginTop: 16, fontSize: 18, fontWeight: 'bold', textAlign: 'center' }}>Confirm source rights and AI processing</Text>
              <Text style={{ color: colors.textSecondary, marginTop: 10, textAlign: 'center', maxWidth: 560 }}>
                Generation sends the selected source material to the institution-configured AI service. Vendor, retention, training use, deletion, and data residency are governed by your institution&apos;s policy. Do not include learner personal data unless your institution authorizes it.
              </Text>
              <TouchableOpacity
                onPress={() => setSourceRightsConfirmed(confirmed => !confirmed)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: sourceRightsConfirmed }}
                style={{ flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: 560, minHeight: 44, marginTop: 16 }}
              >
                <Ionicons name={sourceRightsConfirmed ? 'checkbox' : 'square-outline'} size={22} color={sourceRightsConfirmed ? colors.primary : colors.textSecondary} />
                <Text style={{ color: colors.text, marginLeft: 8, flex: 1 }}>I am authorized to process this material and understand that it will be sent to the configured AI service.</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={!sourceRightsConfirmed}
                onPress={startGeneration}
                accessibilityRole="button"
                accessibilityState={{ disabled: !sourceRightsConfirmed }}
                accessibilityHint={sourceRightsConfirmed ? 'Starts source-grounded flashcard generation.' : 'Confirm source rights and AI processing before generation.'}
                style={[styles.retryButton, { backgroundColor: sourceRightsConfirmed ? colors.primary : colors.border, minHeight: 44, justifyContent: 'center' }]}
              >
                <Text style={{ color: sourceRightsConfirmed ? colors.buttonText : colors.textSecondary, fontWeight: 'bold' }}>Start generation</Text>
              </TouchableOpacity>
            </View>
          ) : isGenerating ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={{ color: colors.text, marginTop: 20, fontSize: 18, fontWeight: 'bold' }}>Analyzing source material…</Text>
              <Text style={{ color: colors.textSecondary, marginTop: 10, textAlign: 'center' }}>Documents and media may take several minutes to extract. Nothing is published automatically.</Text>
            </View>
          ) : error ? (
            <View style={styles.loadingContainer}>
              <Ionicons name="alert-circle" size={40} color={colors.error} />
              <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 18, marginTop: 12 }}>Generation did not complete</Text>
              <Text style={{ color: colors.textSecondary, marginTop: 8, textAlign: 'center', maxWidth: 520 }}>{error}</Text>
              <TouchableOpacity style={[styles.retryButton, { backgroundColor: colors.primary }]} onPress={retryGeneration} accessibilityRole="button">
                <Text style={{ color: colors.buttonText, fontWeight: 'bold' }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <ScrollView pointerEvents={isPublishing ? 'none' : 'auto'} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
                {cards.map((card, index) => (
                  <View key={card.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.cardHeader}>
                      <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Card {index + 1}</Text>
                      <TouchableOpacity onPress={() => { setPublishError(null); setCards(previous => previous.filter(candidate => candidate.id !== card.id)); }} accessibilityRole="button" accessibilityLabel={`Delete card ${index + 1}`}>
                        <Ionicons name="trash-outline" size={20} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>FRONT</Text>
                    <TextInput
                      accessibilityLabel={`Card ${index + 1} front`}
                      style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                      value={card.front}
                      onChangeText={text => handleEdit(card.id, 'front', text)}
                      maxLength={500}
                      multiline
                    />
                    <Text style={[styles.label, { color: colors.textSecondary }]}>BACK</Text>
                    <TextInput
                      accessibilityLabel={`Card ${index + 1} back`}
                      style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                      value={card.back}
                      onChangeText={text => handleEdit(card.id, 'back', text)}
                      maxLength={2000}
                      multiline
                    />
                    <View style={[styles.evidence, { borderColor: colors.border }]}> 
                      <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: 'bold' }}>SOURCE EVIDENCE · {Math.round(card.confidence * 100)}% grounding confidence</Text>
                      <Text style={{ color: colors.text, marginTop: 5 }}>{card.sourceExcerpt}</Text>
                      {card.sourceLocation && <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 5 }}>{card.sourceLocation}</Text>}
                      {card.reviewerEdited && (
                        <>
                          <Text style={[styles.label, { color: colors.textSecondary, marginTop: 10 }]}>SUPPORTING SOURCE EXCERPT *</Text>
                          <TextInput
                            accessibilityLabel={`Card ${index + 1} supporting source excerpt`}
                            style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                            value={card.sourceExcerpt}
                            onChangeText={text => handleEdit(card.id, 'sourceExcerpt', text)}
                            maxLength={600}
                            multiline
                          />
                          <Text style={[styles.label, { color: colors.textSecondary }]}>SOURCE LOCATION</Text>
                          <TextInput
                            accessibilityLabel={`Card ${index + 1} source location`}
                            style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                            value={card.sourceLocation || ''}
                            onChangeText={text => handleEdit(card.id, 'sourceLocation', text)}
                            maxLength={160}
                          />
                        </>
                      )}
                      <TouchableOpacity
                        onPress={() => { setPublishError(null); setCards(previous => previous.map(candidate => candidate.id === card.id ? { ...candidate, reviewerVerified: !candidate.reviewerVerified } : candidate)); }}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: card.reviewerVerified === true }}
                        style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingVertical: 8 }}
                      >
                        <Ionicons name={card.reviewerVerified ? 'checkbox' : 'square-outline'} size={22} color={card.reviewerVerified ? colors.primary : colors.textSecondary} />
                        <Text style={{ color: colors.text, marginLeft: 8, flex: 1 }}>I verified this card against the cited source.</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                <TouchableOpacity disabled={cards.length >= 100} style={[styles.addButton, { borderColor: cards.length >= 100 ? colors.border : colors.primary, backgroundColor: `${colors.primary}10` }]} onPress={handleAdd} accessibilityRole="button" accessibilityState={{ disabled: cards.length >= 100 }}>
                  <Ionicons name="add" size={20} color={cards.length >= 100 ? colors.textSecondary : colors.primary} style={{ marginRight: 5 }} />
                  <Text style={{ color: cards.length >= 100 ? colors.textSecondary : colors.primary, fontWeight: 'bold' }}>{cards.length >= 100 ? '100-card review limit reached' : 'Add reviewer-authored card'}</Text>
                </TouchableOpacity>
              </ScrollView>
              <View style={[styles.footer, { borderTopColor: colors.border }]}> 
                {incompleteCardCount > 0 && <Text accessibilityRole="alert" style={{ color: colors.error, flex: 1, marginRight: 10 }}>Complete or delete {incompleteCardCount} unfinished card{incompleteCardCount === 1 ? '' : 's'}.</Text>}
                {incompleteCardCount === 0 && duplicateCardCount > 0 && <Text accessibilityRole="alert" style={{ color: colors.error, flex: 1, marginRight: 10 }}>Remove or revise {duplicateCardCount} duplicate card{duplicateCardCount === 1 ? '' : 's'}.</Text>}
                {incompleteCardCount === 0 && duplicateCardCount === 0 && unverifiedCardCount > 0 && <Text accessibilityRole="alert" style={{ color: colors.error, flex: 1, marginRight: 10 }}>Verify {unverifiedCardCount} card{unverifiedCardCount === 1 ? '' : 's'} against the source.</Text>}
                {publishError && <Text accessibilityRole="alert" style={{ color: colors.error, flex: 1, marginRight: 10 }}>{publishError}</Text>}
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel flashcard review" accessibilityState={{ disabled: isPublishing }} disabled={isPublishing} style={[styles.button, { backgroundColor: colors.border, marginRight: 10, opacity: isPublishing ? 0.5 : 1 }]} onPress={closeReview}>
                  <Text style={{ color: colors.textSecondary, fontWeight: 'bold' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: canPublish ? colors.primary : colors.border, flex: 1 }]}
                  disabled={!canPublish}
                  onPress={() => {
                    if (publishingRef.current || !sourceAttestation) return;
                    publishingRef.current = true;
                    setIsPublishing(true);
                    setPublishError(null);
                    void Promise.resolve(onApprove(publishableCards, sourceAttestation))
                      .catch(publishFailure => setPublishError(publishFailure instanceof Error ? publishFailure.message : 'The reviewed cards could not be published.'))
                      .finally(() => {
                        publishingRef.current = false;
                        setIsPublishing(false);
                      });
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canPublish, busy: isPublishing }}
                >
                  <Text style={{ color: canPublish ? colors.buttonText : colors.textSecondary, fontWeight: 'bold', textAlign: 'center' }}>{isPublishing ? 'Publishing…' : `Publish ${publishableCards.length} review cards`}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.6)' },
  container: { width: '100%', maxWidth: 760, height: '86%', borderRadius: 16, overflow: 'hidden', elevation: 10 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  header: { padding: 20, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  card: { padding: 15, borderRadius: 12, borderWidth: 1, marginBottom: 15 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
  label: { marginBottom: 5, fontSize: 12, fontWeight: 'bold' },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 15, minHeight: 46, textAlignVertical: 'top' },
  evidence: { borderTopWidth: 1, paddingTop: 12 },
  addButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', padding: 15, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', marginBottom: 30 },
  footer: { padding: 20, borderTopWidth: 1, flexDirection: 'row' },
  button: { padding: 15, borderRadius: 8, justifyContent: 'center' },
  retryButton: { marginTop: 18, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 8 },
});
