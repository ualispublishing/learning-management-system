/**
 * @fileoverview src/components/lms/CustomLearningWorkspace.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  CustomLearningWorkspace as CustomLearningWorkspaceModel,
  evaluateWorkspaceSolution,
  WorkspaceSolutionResult,
} from '../../lib/customLearningWorkspace';
import { useSettingsStore } from '../../lib/store/useSettingsStore';

interface CustomLearningWorkspaceProps {
  moduleTitle: string;
  workspace: CustomLearningWorkspaceModel;
  onClose: () => void;
}

type WorkspacePanel = 'dashboard' | 'lab' | 'visualization';

const palette = {
  canvas: '#07111F',
  surface: '#0E1C2E',
  elevated: '#13263C',
  border: '#28415D',
  text: '#F5F8FC',
  muted: '#A7BAD0',
  cyan: '#62D9FF',
  mint: '#5BE7B4',
  amber: '#FFD479',
  error: '#FF9B9B',
};

const panelMeta: { id: WorkspacePanel; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid-outline' },
  { id: 'lab', label: 'Code lab', icon: 'code-slash-outline' },
  { id: 'visualization', label: 'Visualization', icon: 'bar-chart-outline' },
];

const milestoneIcon = (status: CustomLearningWorkspaceModel['milestones'][number]['status']) => {
  if (status === 'complete') return 'checkmark-circle' as const;
  if (status === 'current') return 'radio-button-on' as const;
  return 'ellipse-outline' as const;
};

export const CustomLearningWorkspace = ({ moduleTitle, workspace, onClose }: CustomLearningWorkspaceProps) => {
  const { width } = useWindowDimensions();
  const reducedMotion = useSettingsStore(state => state.reducedMotion);
  const [activePanel, setActivePanel] = useState<WorkspacePanel>('dashboard');
  const [source, setSource] = useState(workspace.challenge.starterCode);
  const [solutionResult, setSolutionResult] = useState<WorkspaceSolutionResult | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [chartRevision, setChartRevision] = useState(0);
  const [visitedVisualization, setVisitedVisualization] = useState(false);
  const [visitedSnippet, setVisitedSnippet] = useState(false);
  const isWide = width >= 900;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const generatedValues = useMemo(() => workspace.visualization.values.map((value, index) => {
    if (chartRevision === 0) return value;
    const shifted = (value + chartRevision * 13 * (index + 1)) % 91;
    return Math.max(8, Math.round(shifted));
  }), [chartRevision, workspace.visualization.values]);

  const configuredComplete = workspace.milestones.filter(milestone => milestone.status === 'complete').length;
  const completedActivities = configuredComplete
    + (visitedSnippet ? 1 : 0)
    + (visitedVisualization ? 1 : 0)
    + (solutionResult?.passed ? 1 : 0);
  const activityTotal = workspace.milestones.length + 3;
  const progress = Math.round((completedActivities / activityTotal) * 100);

  const openPanel = (panel: WorkspacePanel) => {
    setActivePanel(panel);
    if (panel === 'lab') setVisitedSnippet(true);
    if (panel === 'visualization') setVisitedVisualization(true);
  };

  const renderDashboard = () => (
    <View>
      <View style={[styles.hero, { flexDirection: isWide ? 'row' : 'column' }]}> 
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{workspace.eyebrow}</Text>
          <Text accessibilityRole="header" style={styles.heroTitle}>{workspace.title}</Text>
          <Text style={styles.heroSummary}>{workspace.summary}</Text>
          <View style={styles.heroActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${workspace.challenge.title}`}
              onPress={() => openPanel('lab')}
              style={styles.primaryButton}
            >
              <Ionicons name="play" size={17} color={palette.canvas} />
              <Text style={styles.primaryButtonText}>Continue code lab</Text>
            </Pressable>
            <View style={styles.securityPill}>
              <Ionicons name="shield-checkmark" size={16} color={palette.mint} />
              <Text style={styles.securityPillText}>Static checks · no execution</Text>
            </View>
          </View>
        </View>
        <View style={[styles.progressCard, isWide && { marginLeft: 28, marginTop: 0 }]}> 
          <Text style={styles.statLabel}>MODULE PROGRESS</Text>
          <Text accessibilityLiveRegion="polite" style={styles.progressValue}>{progress}%</Text>
          <View style={styles.progressTrack} accessibilityLabel={`${progress}% of workspace activities complete`}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.statCaption}>{completedActivities} of {activityTotal} activities explored</Text>
        </View>
      </View>

      <View style={[styles.metricGrid, isWide && styles.metricGridWide]}>
        {[
          { icon: 'terminal-outline' as const, value: workspace.language, label: 'Language' },
          { icon: 'flash-outline' as const, value: 'Local only', label: 'Execution' },
          { icon: 'analytics-outline' as const, value: `${workspace.visualization.values.length} points`, label: 'Dataset' },
        ].map(metric => (
          <View key={metric.label} style={[styles.metricCard, isWide && styles.metricCardWide]}>
            <Ionicons name={metric.icon} size={21} color={palette.cyan} />
            <Text style={styles.metricValue}>{metric.value}</Text>
            <Text style={styles.metricLabel}>{metric.label}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.dashboardGrid, isWide && styles.dashboardGridWide]}>
        <View style={[styles.sectionCard, isWide && { flex: 1.15 }]}>
          <View style={styles.sectionHeadingRow}>
            <View>
              <Text style={styles.kicker}>LEARNING PATH</Text>
              <Text accessibilityRole="header" style={styles.sectionTitle}>Today’s milestones</Text>
            </View>
            <Text style={styles.sectionMeta}>{workspace.milestones.length} steps</Text>
          </View>
          {workspace.milestones.map((milestone, index) => (
            <View key={`${milestone.label}-${index}`} style={styles.milestoneRow} accessibilityLabel={`${milestone.label}, ${milestone.status}`}>
              <Ionicons
                name={milestoneIcon(milestone.status)}
                size={21}
                color={milestone.status === 'complete' ? palette.mint : milestone.status === 'current' ? palette.cyan : palette.muted}
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.milestoneLabel}>{milestone.label}</Text>
                <Text style={styles.milestoneStatus}>{milestone.status === 'up-next' ? 'Up next' : milestone.status}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={[styles.sectionCard, isWide && { flex: 0.85 }]}>
          <Text style={styles.kicker}>PROFESSOR’S NOTEBOOK</Text>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{workspace.snippet.title}</Text>
          <View style={styles.codePreview}>
            <Text selectable style={styles.codeText} numberOfLines={8}>{workspace.snippet.code}</Text>
          </View>
          <Text style={styles.noteText}>{workspace.snippet.note}</Text>
          <Pressable accessibilityRole="button" onPress={() => openPanel('lab')} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Open annotated example</Text>
            <Ionicons name="arrow-forward" size={16} color={palette.cyan} />
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderLab = () => (
    <View style={[styles.labGrid, isWide && styles.labGridWide]}>
      <View style={[styles.sectionCard, isWide && { flex: 0.8 }]}>
        <Text style={styles.kicker}>REFERENCE PATTERN</Text>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{workspace.snippet.title}</Text>
        <View style={styles.codeWindow}>
          <View style={styles.windowDots} accessibilityElementsHidden>
            <View style={[styles.windowDot, { backgroundColor: '#FF7B72' }]} />
            <View style={[styles.windowDot, { backgroundColor: palette.amber }]} />
            <View style={[styles.windowDot, { backgroundColor: palette.mint }]} />
          </View>
          <Text selectable style={styles.codeText}>{workspace.snippet.code}</Text>
        </View>
        <View style={styles.callout}>
          <Ionicons name="bulb-outline" size={19} color={palette.amber} />
          <Text style={styles.calloutText}>{workspace.snippet.note}</Text>
        </View>
      </View>

      <View style={[styles.sectionCard, isWide && { flex: 1.2 }]}>
        <View style={styles.sectionHeadingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>SAFE PRACTICE</Text>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{workspace.challenge.title}</Text>
          </View>
          <View style={styles.languageBadge}><Text style={styles.languageBadgeText}>{workspace.language}</Text></View>
        </View>
        <Text style={styles.promptText}>{workspace.challenge.prompt}</Text>
        <TextInput
          accessibilityLabel={`Code editor for ${workspace.challenge.title}`}
          accessibilityHint="Your source stays on this device and is checked as text. It is not executed."
          multiline
          maxLength={8_000}
          autoCapitalize="none"
          autoCorrect={false}
          value={source}
          onChangeText={value => { setSource(value); setSolutionResult(null); }}
          style={styles.codeEditor}
          textAlignVertical="top"
        />
        <View style={styles.labActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setSolutionResult(evaluateWorkspaceSolution(workspace, source))}
            style={styles.primaryButton}
          >
            <Ionicons name="checkmark" size={18} color={palette.canvas} />
            <Text style={styles.primaryButtonText}>Check solution</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setSource(workspace.challenge.starterCode); setSolutionResult(null); }} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Reset</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showHint }} onPress={() => setShowHint(value => !value)} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{showHint ? 'Hide hint' : 'Show hint'}</Text>
          </Pressable>
        </View>
        {showHint ? <Text style={styles.hintText}>{workspace.challenge.hint}</Text> : null}
        {solutionResult ? (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.resultCard, { borderColor: solutionResult.passed ? palette.mint : palette.amber }]}
          >
            <Ionicons name={solutionResult.passed ? 'checkmark-circle' : 'information-circle'} size={21} color={solutionResult.passed ? palette.mint : palette.amber} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[styles.resultTitle, { color: solutionResult.passed ? palette.mint : palette.amber }]}>{solutionResult.passed ? 'Pattern complete' : 'Keep iterating'}</Text>
              <Text style={styles.resultMessage}>{solutionResult.message}</Text>
              {solutionResult.missingTokens.length ? <Text style={styles.missingText}>Look for: {solutionResult.missingTokens.join(', ')}</Text> : null}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );

  const renderVisualization = () => (
    <View style={[styles.visualizationGrid, isWide && styles.visualizationGridWide]}>
      <View style={[styles.sectionCard, isWide && { flex: 1.2 }]}>
        <Text style={styles.kicker}>LOCAL VISUAL GENERATOR</Text>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{workspace.visualization.title}</Text>
        <Text style={styles.promptText}>{workspace.visualization.description}</Text>
        <View
          accessibilityLabel={`Generated bar chart. ${workspace.visualization.labels.map((label, index) => `${label}: ${generatedValues[index]}`).join(', ')}`}
          style={styles.chart}
        >
          {generatedValues.map((value, index) => (
            <View key={`${workspace.visualization.labels[index]}-${index}`} style={styles.barColumn}>
              <Text style={styles.barValue}>{value}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.bar, { height: `${value}%`, backgroundColor: index % 2 ? palette.mint : palette.cyan }]} />
              </View>
              <Text numberOfLines={1} style={styles.barLabel}>{workspace.visualization.labels[index]}</Text>
            </View>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Generate another deterministic sample"
          onPress={() => setChartRevision(value => value + 1)}
          style={styles.primaryButton}
        >
          <Ionicons name="sparkles" size={17} color={palette.canvas} />
          <Text style={styles.primaryButtonText}>Generate sample</Text>
        </Pressable>
      </View>
      <View style={[styles.sectionCard, isWide && { flex: 0.8 }]}>
        <Text style={styles.kicker}>ACCESSIBLE DATA VIEW</Text>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Chart values</Text>
        <Text style={styles.noteText}>The visual always has an equivalent text table, and generation runs locally without network requests.</Text>
        <View accessibilityRole="list" style={{ marginTop: 14 }}>
          {workspace.visualization.labels.map((label, index) => (
            <View key={`${label}-row`} style={styles.dataRow} accessibilityLabel={`${label}: ${generatedValues[index]}`}>
              <Text style={styles.dataLabel}>{label}</Text>
              <Text style={styles.dataValue}>{generatedValues[index]}</Text>
            </View>
          ))}
        </View>
        <View style={styles.callout}>
          <Ionicons name="lock-closed-outline" size={18} color={palette.mint} />
          <Text style={styles.calloutText}>No uploaded script can alter this chart renderer or request outside data.</Text>
        </View>
      </View>
    </View>
  );

  return (
    <Modal
      visible
      animationType={reducedMotion ? 'none' : 'slide'}
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View accessibilityViewIsModal style={styles.shell}>
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Close ${workspace.title}`} onPress={onClose} style={styles.closeButton}>
            <Ionicons name="arrow-back" size={22} color={palette.text} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0, marginHorizontal: 12 }}>
            <Text numberOfLines={1} style={styles.topBarTitle}>{moduleTitle}</Text>
            <Text numberOfLines={1} style={styles.topBarSubtitle}>Hosted learning workspace</Text>
          </View>
          <View style={styles.safeBadge}>
            <Ionicons name="shield-checkmark" size={16} color={palette.mint} />
            {width >= 520 ? <Text style={styles.safeBadgeText}>Sandbox-safe</Text> : null}
          </View>
        </View>

        <View accessibilityRole="tablist" accessibilityLabel="Workspace sections" style={styles.tabBar}>
          {panelMeta.map(panel => (
            <Pressable
              key={panel.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: activePanel === panel.id }}
              onPress={() => openPanel(panel.id)}
              style={[styles.tab, activePanel === panel.id && styles.activeTab]}
            >
              <Ionicons name={panel.icon} size={18} color={activePanel === panel.id ? palette.cyan : palette.muted} />
              <Text style={[styles.tabLabel, activePanel === panel.id && styles.activeTabLabel]}>{panel.label}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
          {activePanel === 'dashboard' ? renderDashboard() : activePanel === 'lab' ? renderLab() : renderVisualization()}
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: palette.canvas },
  topBar: { minHeight: 64, paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surface, flexDirection: 'row', alignItems: 'center' },
  closeButton: { width: 44, height: 44, borderWidth: 1, borderColor: palette.border, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { color: palette.text, fontWeight: '800', fontSize: 16 },
  topBarSubtitle: { color: palette.muted, fontSize: 11, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.8 },
  safeBadge: { minHeight: 38, paddingHorizontal: 11, borderRadius: 19, borderWidth: 1, borderColor: '#245E51', backgroundColor: '#0B2C29', flexDirection: 'row', alignItems: 'center' },
  safeBadgeText: { color: palette.mint, fontSize: 12, fontWeight: '700', marginLeft: 6 },
  tabBar: { minHeight: 58, paddingHorizontal: 12, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border, flexDirection: 'row', alignItems: 'stretch', justifyContent: 'center' },
  tab: { minHeight: 48, paddingHorizontal: 16, borderBottomWidth: 3, borderBottomColor: 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  activeTab: { borderBottomColor: palette.cyan, backgroundColor: '#10283B' },
  tabLabel: { color: palette.muted, fontSize: 13, fontWeight: '700', marginLeft: 7 },
  activeTabLabel: { color: palette.text },
  scrollContent: { width: '100%', maxWidth: 1240, alignSelf: 'center', padding: 20, paddingBottom: 64 },
  hero: { padding: 28, borderWidth: 1, borderColor: '#27506B', borderRadius: 22, backgroundColor: '#0E2538', overflow: 'hidden', ...(Platform.OS === 'web' ? { boxShadow: '0 20px 50px rgba(0,0,0,.24)' } : {}) },
  eyebrow: { color: palette.cyan, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  heroTitle: { color: palette.text, fontSize: 32, lineHeight: 38, fontWeight: '800', marginTop: 8 },
  heroSummary: { color: palette.muted, fontSize: 16, lineHeight: 24, maxWidth: 720, marginTop: 10 },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 22 },
  primaryButton: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 16, borderRadius: 11, backgroundColor: palette.cyan, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryButtonText: { color: palette.canvas, fontWeight: '800' },
  securityPill: { minHeight: 38, paddingHorizontal: 12, borderRadius: 19, backgroundColor: '#0B2C29', flexDirection: 'row', alignItems: 'center' },
  securityPillText: { color: palette.mint, fontSize: 12, fontWeight: '700', marginLeft: 6 },
  progressCard: { minWidth: 230, padding: 20, marginTop: 22, borderRadius: 18, backgroundColor: '#081726', borderWidth: 1, borderColor: palette.border, justifyContent: 'center' },
  statLabel: { color: palette.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  progressValue: { color: palette.text, fontSize: 38, fontWeight: '800', marginTop: 7 },
  progressTrack: { height: 8, overflow: 'hidden', borderRadius: 4, backgroundColor: palette.border, marginTop: 10 },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: palette.mint },
  statCaption: { color: palette.muted, fontSize: 12, marginTop: 10 },
  metricGrid: { gap: 12, marginTop: 16 },
  metricGridWide: { flexDirection: 'row' },
  metricCard: { padding: 17, borderRadius: 16, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  metricCardWide: { flex: 1 },
  metricValue: { color: palette.text, fontSize: 18, fontWeight: '800', marginTop: 10 },
  metricLabel: { color: palette.muted, fontSize: 12, marginTop: 2 },
  dashboardGrid: { gap: 16, marginTop: 16 },
  dashboardGridWide: { flexDirection: 'row', alignItems: 'stretch' },
  sectionCard: { padding: 22, borderRadius: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  kicker: { color: palette.cyan, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, marginBottom: 6 },
  sectionTitle: { color: palette.text, fontSize: 21, lineHeight: 27, fontWeight: '800' },
  sectionMeta: { color: palette.muted, fontSize: 12 },
  milestoneRow: { minHeight: 56, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: palette.border, flexDirection: 'row', alignItems: 'center' },
  milestoneLabel: { color: palette.text, fontWeight: '700' },
  milestoneStatus: { color: palette.muted, fontSize: 11, marginTop: 3, textTransform: 'capitalize' },
  codePreview: { marginTop: 16, padding: 16, borderRadius: 13, backgroundColor: '#06101C', borderWidth: 1, borderColor: '#203B55' },
  codeText: { color: '#D8E7F5', fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
  noteText: { color: palette.muted, lineHeight: 21, marginTop: 13 },
  textButton: { alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  textButtonLabel: { color: palette.cyan, fontWeight: '800', marginRight: 7 },
  labGrid: { gap: 16 },
  labGridWide: { flexDirection: 'row', alignItems: 'flex-start' },
  codeWindow: { padding: 17, borderRadius: 14, backgroundColor: '#06101C', borderWidth: 1, borderColor: '#203B55', marginTop: 16 },
  windowDots: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  windowDot: { width: 9, height: 9, borderRadius: 5 },
  callout: { padding: 13, marginTop: 15, borderRadius: 12, backgroundColor: '#102536', flexDirection: 'row', alignItems: 'flex-start' },
  calloutText: { color: palette.muted, flex: 1, marginLeft: 9, lineHeight: 20 },
  languageBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#162F44' },
  languageBadgeText: { color: palette.cyan, fontFamily: 'monospace', fontWeight: '700', fontSize: 12 },
  promptText: { color: palette.muted, lineHeight: 22, marginTop: 12 },
  codeEditor: { minHeight: 290, marginTop: 16, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#315473', backgroundColor: '#050D17', color: palette.text, fontFamily: 'monospace', fontSize: 14, lineHeight: 21 },
  labActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 14 },
  secondaryButton: { minHeight: 44, paddingHorizontal: 15, borderRadius: 11, borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: palette.text, fontWeight: '700' },
  hintText: { color: palette.amber, padding: 13, marginTop: 12, borderRadius: 11, backgroundColor: '#2A2417', lineHeight: 20 },
  resultCard: { padding: 14, marginTop: 13, borderWidth: 1, borderRadius: 12, backgroundColor: '#0A1928', flexDirection: 'row', alignItems: 'flex-start' },
  resultTitle: { fontWeight: '800' },
  resultMessage: { color: palette.muted, marginTop: 3, lineHeight: 19 },
  missingText: { color: palette.text, fontFamily: 'monospace', fontSize: 12, marginTop: 7 },
  visualizationGrid: { gap: 16 },
  visualizationGridWide: { flexDirection: 'row', alignItems: 'stretch' },
  chart: { minHeight: 300, flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 18, paddingBottom: 10, marginVertical: 18, borderRadius: 15, backgroundColor: '#071421', borderWidth: 1, borderColor: '#203B55' },
  barColumn: { flex: 1, height: 250, minWidth: 36, alignItems: 'center', justifyContent: 'flex-end' },
  barValue: { color: palette.text, fontSize: 11, fontWeight: '800', marginBottom: 5 },
  barTrack: { width: '68%', height: 190, minWidth: 20, borderRadius: 8, overflow: 'hidden', backgroundColor: '#14283C', justifyContent: 'flex-end' },
  bar: { width: '100%', minHeight: 3, borderRadius: 7 },
  barLabel: { color: palette.muted, fontSize: 10, marginTop: 7, maxWidth: 80 },
  dataRow: { minHeight: 46, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: palette.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dataLabel: { color: palette.muted, flex: 1 },
  dataValue: { color: palette.text, fontWeight: '800', marginLeft: 10 },
});
