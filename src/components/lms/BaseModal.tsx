/**
 * @fileoverview src/components/lms/BaseModal.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { ReactNode, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '../../lib/useThemeColors';

interface BaseModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  isLoading?: boolean;
  closeDisabled?: boolean;
}

export const BaseModal = ({ visible, onClose, title, children, isLoading = false, closeDisabled = false }: BaseModalProps) => {
  const colors = useThemeColors();
  const [isFullScreen, setIsFullScreen] = useState(false);
  const requestClose = () => { if (!closeDisabled) onClose(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={requestClose}>
      <View style={styles.modalOverlay}>
        <View
          accessibilityViewIsModal
          style={[
            styles.modalContent,
            { backgroundColor: colors.background, borderColor: colors.border },
            isFullScreen && styles.fullScreenModal,
          ]}
        >
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]} accessibilityRole="header">{title}</Text>
            <View style={styles.modalHeaderActions}>
              <TouchableOpacity
                onPress={() => setIsFullScreen(value => !value)}
                style={[styles.headerAction, { marginRight: 4 }]}
                accessibilityRole="button"
                accessibilityLabel={isFullScreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                <Ionicons name={isFullScreen ? 'contract' : 'expand'} size={24} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                disabled={closeDisabled}
                onPress={requestClose}
                style={[styles.headerAction, { opacity: closeDisabled ? 0.4 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Close modal"
                accessibilityHint="Closes the current dialog."
                accessibilityState={{ disabled: closeDisabled }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.modalBody}>
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <Text style={{ color: colors.textSecondary, fontStyle: 'italic' }}>Loading…</Text>
              </View>
            ) : children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: {
    width: '100%',
    maxWidth: 600,
    maxHeight: '80%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 10,
    ...(Platform.OS === 'web' ? { boxShadow: '0 10px 20px rgba(0,0,0,0.2)' } : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.2,
      shadowRadius: 20,
    }),
  },
  fullScreenModal: { width: '100%', height: '100%', maxHeight: '100%', maxWidth: '100%', borderRadius: 0 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', flex: 1 },
  modalHeaderActions: { flexDirection: 'row', alignItems: 'center' },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20 },
  loadingContainer: { flex: 1, padding: 40, justifyContent: 'center', alignItems: 'center' },
});
