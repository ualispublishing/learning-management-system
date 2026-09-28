/**
 * @fileoverview src/components/editor/ImportExport.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getError } from '../../lib/errorCodes';
import { userAlert as Alert } from '../../lib/userAlert';
import { RectLoader } from '../ui/RectLoader';
import * as Sharing from 'expo-sharing';
import { importCSV } from '../../lib/db/import';
import { exportToCSV } from '../../lib/db/export';
import { CSVValidationError, MAX_CSV_BYTES } from '../../lib/db/csv';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import { DIAGNOSTIC_CONTEXTS, logDiagnosticError } from '../../lib/diagnosticLog';
import { runExclusiveFlashcardAction } from '../../lib/flashcardLibrary';

interface ImportExportProps {
  deckId: string;
}

export default function ImportExport({ deckId }: ImportExportProps) {
  const colors = useThemeColors();
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<'import' | 'export' | null>(null);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const operationInFlight = React.useRef(false);

  const reportResult = (title: string, message: string, kind: 'success' | 'error') => {
    if (Platform.OS === 'web') {
      setStatus({ kind, message: `${title}: ${message}` });
    } else {
      Alert.alert(title, message);
    }
  };

  const handleImport = async () => {
    await runExclusiveFlashcardAction(operationInFlight, async () => {
      setStatus(null);
      setLoading(true);
      setOperation('import');
      try {
        const result = await DocumentPicker.getDocumentAsync({
          type: ['text/csv', 'text/comma-separated-values', '*/*'],
          copyToCacheDirectory: true,
        });

        if (result.canceled) {
          return;
        }

        const asset = result.assets[0];
        if (!asset) throw new Error('The selected CSV file could not be read. Choose the file again.');
        if (typeof asset.size === 'number' && asset.size > MAX_CSV_BYTES) {
          throw new CSVValidationError(`CSV files must be ${MAX_CSV_BYTES / (1024 * 1024)} MB or smaller.`);
        }
        const fileContent = Platform.OS === 'web'
          ? await (() => {
              if (!asset.file) throw new Error('The browser did not provide the selected CSV bytes. Choose the file again.');
              if (asset.file.size > MAX_CSV_BYTES) throw new CSVValidationError(`CSV files must be ${MAX_CSV_BYTES / (1024 * 1024)} MB or smaller.`);
              return asset.file.text();
            })()
          : await FileSystem.readAsStringAsync(asset.uri);
        
        const count = await importCSV(deckId, fileContent);

        if (count === 0) reportResult('Nothing imported', 'The CSV file did not contain any cards.', 'success');
        else reportResult('Success', `Imported ${count} ${count === 1 ? 'card' : 'cards'} successfully.`, 'success');
      } catch (e) {
        logDiagnosticError(DIAGNOSTIC_CONTEXTS.csvImport, e);
        reportResult('Import failed', e instanceof Error ? e.message : getError('E1004'), 'error');
      } finally {
        setLoading(false);
        setOperation(null);
      }
    });
  };

  const handleExport = async () => {
    await runExclusiveFlashcardAction(operationInFlight, async () => {
      setStatus(null);
      setLoading(true);
      setOperation('export');
      try {
        const csvData = await exportToCSV(deckId);

        if (Platform.OS === 'web') {
          if (typeof document === 'undefined' || !document.body || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('Browser downloads are not available in this session.');
          const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8' });
          const downloadUrl = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = downloadUrl;
          anchor.download = `deck_export_${Date.now()}.csv`;
          anchor.style.display = 'none';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
          reportResult('Export ready', 'The CSV download has started.', 'success');
        } else {
          if (!FileSystem.documentDirectory) throw new Error('No writable document directory is available.');
          const isAvailable = await Sharing.isAvailableAsync();
          const baseDirectory = isAvailable ? (FileSystem.cacheDirectory || FileSystem.documentDirectory) : FileSystem.documentDirectory;
          const fileUri = baseDirectory + `deck_export_${Date.now()}.csv`;
          await FileSystem.writeAsStringAsync(fileUri, csvData, {
            encoding: FileSystem.EncodingType.UTF8,
          });

          if (isAvailable) {
            try {
              await Sharing.shareAsync(fileUri);
            } finally {
              await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
            }
          } else {
            Alert.alert('Exported', `File saved to: ${fileUri}`);
          }
        }
      } catch (e) {
        logDiagnosticError(DIAGNOSTIC_CONTEXTS.csvExport, e);
        reportResult('Export failed', e instanceof Error ? e.message : getError('E1005'), 'error');
      } finally {
        setLoading(false);
        setOperation(null);
      }
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.card }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Import / Export</Text>
      
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.button, styles.importButton, { backgroundColor: colors.background, borderColor: colors.primary }]} 
          onPress={handleImport}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={operation === 'import' ? 'Importing CSV' : 'Import CSV'}
          accessibilityState={{ disabled: loading, busy: operation === 'import' }}
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>⬇️ Import CSV</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.button, styles.exportButton, { backgroundColor: colors.primary }]} 
          onPress={handleExport}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={operation === 'export' ? 'Exporting CSV' : 'Export CSV'}
          accessibilityState={{ disabled: loading, busy: operation === 'export' }}
        >
          <Text style={[styles.buttonText, { color: colors.buttonText }]}>⬆️ Export CSV</Text>
        </TouchableOpacity>
      </View>

      {loading && (
        <View accessibilityLiveRegion="polite" style={{ marginTop: spacing[6], alignItems: 'center' }}>
          <RectLoader text={operation === 'import' ? 'Importing cards…' : 'Exporting cards…'} />
        </View>
      )}
      {status && (
        <Text
          accessibilityRole={status.kind === 'error' ? 'alert' : undefined}
          accessibilityLiveRegion={status.kind === 'success' ? 'polite' : undefined}
          style={[styles.status, { color: status.kind === 'error' ? colors.error : colors.primary }]}
        >
          {status.message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing[4],
    borderRadius: 12,
    marginVertical: spacing[4],
  },
  title: {
    fontSize: typography.xl,
    fontWeight: 'bold',
    marginBottom: spacing[4],
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  button: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: spacing[2],
  },
  importButton: {
    borderWidth: 1,
  },
  exportButton: {
  },
  buttonText: {
    fontSize: typography.base,
    fontWeight: '600',
  },
  loader: {
    marginTop: spacing[4],
  },
  status: {
    marginTop: spacing[4],
    textAlign: 'center',
    fontWeight: '600',
  },
});
