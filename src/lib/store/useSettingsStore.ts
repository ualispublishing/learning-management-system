/**
 * @fileoverview src/lib/store/useSettingsStore.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo } from 'react-native';
import { clampAppContentWidth, parseStoredAppContentWidth } from '../appCanvasWidth';
import { isSixDigitHexColor } from '../color';
import branding from '../branding.generated.json';

const primaryColorKey = `institution-primary-preview:${branding.revision}`;
const secondaryColorKey = `institution-secondary-preview:${branding.revision}`;

export type AppTheme = 'light' | 'dark' | 'system';
export type AppContentWidth = number;

interface SettingsState {
  // Existing settings
  continuousCardView: boolean;
  
  // New UI feature toggles
  enableGlassmorphism: boolean;
  enableModernTypography: boolean;
  enableVibrantGradients: boolean;
  enableCustomLoader: boolean;
  theme: AppTheme;
  lastCustomTarget: number;
  lastQuizStartPositions: Record<string, number>;
  customTargets: { study: string, learn: string, quiz: string };

  // New accessibility toggles
  reducedMotion: boolean;
  simpleControls: boolean;

  // i18n
  language: string;

  // Custom theme color
  customThemeHex: string | null;
  customSecondaryHex: string | null;

  // First time experience
  hasViewedTutorial: boolean;

  // Admin Layout Mode
  adminCourseLayoutMode: 'compact' | 'classic';
  /** Desktop-only app canvas width. Mobile always remains fluid. */
  appContentWidth: AppContentWidth;
  settingsError: string | null;

  // Actions
  setContinuousCardView: (value: boolean) => void;
  setEnableGlassmorphism: (value: boolean) => void;
  setEnableModernTypography: (value: boolean) => void;
  setEnableVibrantGradients: (value: boolean) => void;
  setEnableCustomLoader: (value: boolean) => void;
  setTheme: (theme: AppTheme) => void;
  setLastCustomTarget: (value: number) => void;
  setLastQuizStartPosition: (deckId: string, position: number) => void;
  setCustomTarget: (mode: 'study'|'learn'|'quiz', val: string) => void;
  setReducedMotion: (value: boolean) => void;
  setSimpleControls: (value: boolean) => void;
  setLanguage: (lang: string) => void;
  setHasViewedTutorial: (val: boolean) => void;
  setCustomThemeHex: (val: string | null) => void;
  setCustomSecondaryHex: (val: string | null) => void;
  setAdminCourseLayoutMode: (val: 'compact' | 'classic') => void;
  setAppContentWidth: (val: AppContentWidth) => void;
  clearSettingsError: () => void;
  loadSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const persistSetting = (operation: Promise<unknown>) => {
    void operation
      .then(() => set({ settingsError: null }))
      .catch(error => set({ settingsError: error instanceof Error ? error.message : 'App settings could not be saved.' }));
  };

  return ({
  continuousCardView: false,
  enableGlassmorphism: false,
  enableModernTypography: false,
  enableVibrantGradients: false,
  enableCustomLoader: true,
  theme: 'system',
  lastCustomTarget: 20,
  lastQuizStartPositions: {},
  customTargets: { study: '20', learn: '∞', quiz: '20' },
  reducedMotion: false,
  simpleControls: false,
  language: 'en',
  hasViewedTutorial: false,
  customThemeHex: null,
  customSecondaryHex: null,
  adminCourseLayoutMode: 'compact',
  appContentWidth: 768,
  settingsError: null,
  clearSettingsError: () => set({ settingsError: null }),

  setContinuousCardView: (value) => {
    set({ continuousCardView: value });
    persistSetting(AsyncStorage.setItem('continuousCardView', value ? 'true' : 'false'));
  },
  setEnableGlassmorphism: (value) => {
    set({ enableGlassmorphism: value });
    persistSetting(AsyncStorage.setItem('enableGlassmorphism', value ? 'true' : 'false'));
  },
  setEnableModernTypography: (value) => {
    set({ enableModernTypography: value });
    persistSetting(AsyncStorage.setItem('enableModernTypography', value ? 'true' : 'false'));
  },
  setEnableVibrantGradients: (value) => {
    set({ enableVibrantGradients: value });
    persistSetting(AsyncStorage.setItem('enableVibrantGradients', value ? 'true' : 'false'));
  },
  setEnableCustomLoader: (value) => {
    set({ enableCustomLoader: value });
    persistSetting(AsyncStorage.setItem('enableCustomLoader', value ? 'true' : 'false'));
  },
  setTheme: (theme) => {
    set({ theme });
    persistSetting(AsyncStorage.setItem('appTheme', theme));
  },
  setLastCustomTarget: (value: number) => {
    set({ lastCustomTarget: value });
    persistSetting(AsyncStorage.setItem('@last_custom_target', value.toString()));
  },
  setLastQuizStartPosition: (deckId: string, position: number) => {
    set((state) => {
      const updated = { ...state.lastQuizStartPositions, [deckId]: position };
      persistSetting(AsyncStorage.setItem('@last_quiz_start_positions', JSON.stringify(updated)));
      return { lastQuizStartPositions: updated };
    });
  },
  setCustomTarget: (mode, val) => {
    set((state) => {
      const updated = { ...state.customTargets, [mode]: val };
      persistSetting(AsyncStorage.setItem(`${mode}_custom`, val));
      return { customTargets: updated };
    });
  },
  setReducedMotion: (value: boolean) => {
    set({ reducedMotion: value });
    persistSetting(AsyncStorage.setItem('reducedMotion', value ? 'true' : 'false'));
  },
  setSimpleControls: (value) => {
    set({ simpleControls: value });
    persistSetting(AsyncStorage.setItem('simpleControls', value ? 'true' : 'false'));
  },
  setLanguage: (language) => {
    set({ language });
    persistSetting(AsyncStorage.setItem('language', language));
  },
  
  setHasViewedTutorial: (val) => {
    set({ hasViewedTutorial: val });
    persistSetting(AsyncStorage.setItem('hasViewedTutorial', val ? 'true' : 'false'));
  },
  
  setCustomThemeHex: (val) => {
    const normalized = val?.trim().toUpperCase() || null;
    const safeValue = normalized && isSixDigitHexColor(normalized) ? normalized : null;
    set({ customThemeHex: safeValue });
    if (safeValue) persistSetting(AsyncStorage.setItem(primaryColorKey, safeValue));
    else persistSetting(AsyncStorage.removeItem(primaryColorKey));
  },

  setCustomSecondaryHex: (val) => {
    const normalized = val?.trim().toUpperCase() || null;
    const safeValue = normalized && isSixDigitHexColor(normalized) ? normalized : null;
    set({ customSecondaryHex: safeValue });
    if (safeValue) persistSetting(AsyncStorage.setItem(secondaryColorKey, safeValue));
    else persistSetting(AsyncStorage.removeItem(secondaryColorKey));
  },

  setAdminCourseLayoutMode: (val) => {
    set({ adminCourseLayoutMode: val });
    persistSetting(AsyncStorage.setItem('adminCourseLayoutMode', val));
  },

  setAppContentWidth: (val) => {
    const normalized = clampAppContentWidth(val);
    set({ appContentWidth: normalized });
    persistSetting(AsyncStorage.setItem('appContentWidth', String(normalized)));
  },

  loadSettings: async () => {
    try {
      const vals = await AsyncStorage.multiGet([
        'continuousCardView',
        'enableGlassmorphism',
        'enableModernTypography',
        'enableVibrantGradients',
        'enableCustomLoader',
        'appTheme',
        '@last_custom_target',
        '@last_quiz_start_positions',
        'reducedMotion',
        'simpleControls',
        'language',
        'hasViewedTutorial',
        primaryColorKey,
        secondaryColorKey,
        'study_custom',
        'learn_custom',
        'quiz_custom',
        'adminCourseLayoutMode',
        'appContentWidth'
      ]);
      const updates: Partial<SettingsState> = { customThemeHex: null, customSecondaryHex: null };
      const customT = { study: '20', learn: '∞', quiz: '20' };
      
      // Default OS check for reduced motion
      const isReduceMotionEnabled = await AccessibilityInfo.isReduceMotionEnabled();
      updates.reducedMotion = isReduceMotionEnabled;

      vals.forEach(([key, val]) => {
        if (val !== null) {
          if (key === 'continuousCardView') updates.continuousCardView = val === 'true';
          if (key === 'enableGlassmorphism') updates.enableGlassmorphism = val === 'true';
          if (key === 'enableModernTypography') updates.enableModernTypography = val === 'true';
          if (key === 'enableVibrantGradients') updates.enableVibrantGradients = val === 'true';
          if (key === 'enableCustomLoader') updates.enableCustomLoader = val === 'true';
          if (key === 'appTheme') updates.theme = val as AppTheme;
          if (key === 'lastCustomTarget' || key === '@last_custom_target') updates.lastCustomTarget = parseInt(val, 10) || 20;
          if (key === '@last_quiz_start_positions') {
            try { updates.lastQuizStartPositions = JSON.parse(val); } catch { updates.settingsError = 'Saved quiz-position settings were corrupt and have been ignored.'; }
          }
          if (key === 'reducedMotion') updates.reducedMotion = val === 'true'; // override if set by user
          if (key === 'simpleControls') updates.simpleControls = val === 'true';
          if (key === 'language') updates.language = val;
          if (key === 'hasViewedTutorial') updates.hasViewedTutorial = val === 'true';
          if (key === primaryColorKey && isSixDigitHexColor(val)) updates.customThemeHex = val.toUpperCase();
          if (key === secondaryColorKey && isSixDigitHexColor(val)) updates.customSecondaryHex = val.toUpperCase();
          if (key === 'adminCourseLayoutMode' && (val === 'compact' || val === 'classic')) updates.adminCourseLayoutMode = val;
          if (key === 'appContentWidth') {
            const parsed = parseStoredAppContentWidth(val);
            if (parsed !== null) updates.appContentWidth = parsed;
          }
          if (key === 'study_custom') customT.study = val;
          if (key === 'learn_custom') customT.learn = val;
          if (key === 'quiz_custom') customT.quiz = val;
        }
      });
      updates.customTargets = customT;
      // Retire the legacy device-global toggle. It never had a transmission
      // path and was not scoped to an authenticated principal.
      await AsyncStorage.removeItem('shareAnalyticsWithTeacher');
      set(updates);
    } catch (e) {
      set({ settingsError: e instanceof Error ? e.message : 'App settings could not be loaded.' });
    }
  }
  });
});
