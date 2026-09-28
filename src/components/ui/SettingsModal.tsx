/**
 * @fileoverview src/components/ui/SettingsModal.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Switch, Modal, ScrollView } from 'react-native';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { useSettingsStore } from '../../lib/store/useSettingsStore';
import { userAlert as Alert } from '../../lib/userAlert';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { useThemeColors } from '../../lib/useThemeColors';
import { typography, spacing } from '../../lib/theme';
import i18n from '../../lib/i18n';
import { generateSampleDeck } from '../../lib/db/seedSample';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

const getLanguageName = (code: string) => {
  const mapping: Record<string, string> = {
    ab: 'Abkhazian (аҧсуа бызшәа)',
    ady: 'Adyghe (адыгабзэ)',
    af: 'Afrikaans',
    ak: 'Akan',
    alt: 'Altai (алтай тили)',
    am: 'Amharic (አማርኛ)',
    an: 'Aragonese (aragonés)',
    ani: 'Andi (гъваналъигь)',
    aqc: 'Archi (аршаттен)',
    ar: 'Arabic (العربية)',
    arp: 'Arapaho (Hinóno\'eitíít)',
    ast: 'Asturian (asturianu)',
    av: 'Avaric (авар мацӀ)',
    ay: 'Aymara (aymar aru)',
    az: 'Azerbaijani (azərbaycan dili)',
    ba: 'Bashkir (башҡорт теле)',
    bdk: 'Budukh (будад маьз)',
    be: 'Belarusian (беларуская мова)',
    bg: 'Bulgarian (български)',
    bm: 'Bambara (bamanankan)',
    bn: 'Bengali (বাংলা)',
    br: 'Breton (brezhoneg)',
    bs: 'Bosnian (bosanski)',
    ca: 'Catalan (català)',
    ce: 'Chechen (нохчийн мотт)',
    ceb: 'Cebuano',
    chr: 'Cherokee (ᏣᎳᎩ)',
    cjs: 'Shor (шор тили)',
    clw: 'Chulym (чулым тили)',
    co: 'Corsican (corsu)',
    crh: 'Crimean Tatar (qırımtatarca)',
    cs: 'Czech (čeština)',
    cv: 'Chuvash (чӑваш чӗлхи)',
    cy: 'Welsh (Cymraeg)',
    da: 'Danish (dansk)',
    dar: 'Dargwa (дарган мез)',
    ddo: 'Tsez (цезйас)',
    de: 'German (Deutsch)',
    dlg: 'Dolgan (долган тыла)',
    doi: 'Dogri (डोगरी)',
    dv: 'Dhivehi (ދިވެހިބަސް)',
    ee: 'Ewe (Èʋegbe)',
    egl: 'Emilian (Emiliàn)',
    el: 'Greek (Ελληνικά)',
    en: 'English',
    eo: 'Esperanto',
    es: 'Spanish (Español)',
    et: 'Estonian (eesti)',
    eu: 'Basque (euskara)',
    ext: 'Extremaduran (estremeñu)',
    fa: 'Persian (فارسی)',
    fax: 'Fala (A fala)',
    fi: 'Finnish (suomi)',
    fo: 'Faroese (føroyskt)',
    fr: 'French (Français)',
    fur: 'Friulian (furlan)',
    fy: 'Frisian (Frysk)',
    ga: 'Irish (Gaeilge)',
    gag: 'Gagauz (Gagauzca)',
    gd: 'Gaelic (Gàidhlig)',
    gl: 'Galician (galego)',
    gn: 'Guarani (Avañe\'ẽ)',
    gu: 'Gujarati (ગુજરાતી)',
    ha: 'Hausa (Harshen Hausa)',
    haw: 'Hawaiian (ʻŌlelo Hawaiʻi)',
    hi: 'Hindi (हिन्दी)',
    hmn: 'Hmong (Hmoob)',
    hr: 'Croatian (hrvatski)',
    ht: 'Haitian Creole (Kreyòl ayisyen)',
    hu: 'Hungarian (magyar)',
    hy: 'Armenian (հայերեն)',
    id: 'Indonesian (Bahasa Indonesia)',
    ig: 'Igbo (Asụsụ Igbo)',
    inh: 'Ingush (ГӀалгӀай)',
    is: 'Icelandic (íslenska)',
    it: 'Italian (Italiano)',
    iw: 'Hebrew (עברית)',
    ja: 'Japanese (日本語)',
    jv: 'Javanese (Basa Jawa)',
    jw: 'Javanese (Basa Jawa)',
    ka: 'Georgian (ქართული)',
    kaa: 'Karakalpak (Qaraqalpaq tili)',
    kab: 'Kabyle (Taqbaylit)',
    kbd: 'Kabardian (адыгэбзэ)',
    kim: 'Tofa (тоъфа дыл)',
    kjh: 'Khakas (хакас тилі)',
    kjj: 'Khinalug (кетш мицI)',
    kk: 'Kazakh (қазақ тілі)',
    klj: 'Khalaj (خلج)',
    km: 'Khmer (ភាសាខ្មែរ)',
    kn: 'Kannada (ಕನ್ನಡ)',
    ko: 'Korean (한국어)',
    kok: 'Konkani (कोंकणी)',
    krc: 'Karachay-Balkar (Къарачай-Малкъар)',
    kri: 'Krio',
    kry: 'Kryts (кърыцIаь мез)',
    ku: 'Kurdish (Kurdî)',
    kum: 'Kumyk (Къумукъ)',
    ky: 'Kyrgyz (Кыргызча)',
    la: 'Latin (Latina)',
    lb: 'Luxembourgish (Lëtzebuergesch)',
    lbe: 'Lak (лакку маз)',
    lez: 'Lezghian (лезги чIал)',
    lg: 'Luganda (Oluganda)',
    li: 'Limburgish (Limburgs)',
    lij: 'Ligurian (lìgure)',
    lld: 'Ladin (ladin)',
    lmo: 'Lombard (lombard)',
    ln: 'Lingala (Lingála)',
    lo: 'Lao (ภาษาลาว)',
    lt: 'Lithuanian (lietuvių)',
    lv: 'Latvian (latviešu)',
    mai: 'Maithili (मैथिली)',
    mg: 'Malagasy',
    mi: 'Maori (Māori)',
    mk: 'Macedonian (македонски)',
    ml: 'Malayalam (മലയാളം)',
    mn: 'Mongolian (Монгол хэл)',
    mni: 'Manipuri (Meitei)',
    mr: 'Marathi (मराठी)',
    ms: 'Malay (Bahasa Melayu)',
    mt: 'Maltese (Malti)',
    mwl: 'Mirandese (Mirandés)',
    my: 'Burmese (မြန်မာဘာသာ)',
    mzo: 'Mizo',
    nap: 'Neapolitan (napulitano)',
    ne: 'Nepali (नेपाली)',
    nl: 'Dutch (Nederlands)',
    no: 'Norwegian (norsk)',
    ny: 'Nyanja (Chichewa)',
    oc: 'Occitan (occitan)',
    or: 'Oriya (ଓଡ଼ିଆ)',
    pa: 'Punjabi (ਪੰਜਾਬੀ)',
    pcd: 'Picard (Cht\'imi)',
    pl: 'Polish (Polski)',
    pms: 'Piedmontese (piemontèis)',
    ps: 'Pashto (پښتو)',
    pt: 'Portuguese (Português)',
    rm: 'Romansh (rumantsch)',
    ro: 'Romanian (română)',
    'roa-leo': 'Leonese (llionés)',
    'roa-tara': 'Tarantino (tarandíne)',
    ru: 'Russian (Русский)',
    rut: 'Rutul (мыхIабишды чIал)',
    rw: 'Kinyarwanda',
    sah: 'Yakut (саха тыла)',
    scn: 'Sicilian (sicilianu)',
    sd: 'Sindhi (سنڌي)',
    si: 'Sinhala (සිංහල)',
    sk: 'Slovak (slovenčina)',
    sl: 'Slovenian (slovenščina)',
    slr: 'Salar (Salırça)',
    sm: 'Samoan (Gagana Sāmoa)',
    sn: 'Shona (chiShona)',
    so: 'Somali (Af-Soomaali)',
    sq: 'Albanian (shqip)',
    sr: 'Serbian (српски)',
    st: 'Sotho (Sesotho)',
    su: 'Sundanese (Basa Sunda)',
    sv: 'Swedish (svenska)',
    sw: 'Swahili (Kiswahili)',
    szl: 'Silesian (ślōnskō)',
    ta: 'Tamil (தமிழ்)',
    tab: 'Tabasaran (табасаран чӀал)',
    te: 'Telugu (తెలుగు)',
    tg: 'Tajik (тоҷикӣ)',
    th: 'Thai (ไทย)',
    tk: 'Turkmen (Türkmençe)',
    tkr: 'Tsakhur (цӀахур мез)',
    tl: 'Tagalog (Filipino)',
    tr: 'Turkish (Türkçe)',
    ts: 'Tsonga (Xitsonga)',
    tt: 'Tatar (татарча)',
    tyv: 'Tuvinian (тыва дыл)',
    udi: 'Udi (удин маз)',
    ug: 'Uyghur (ئۇيغۇرچە)',
    uk: 'Ukrainian (українська)',
    ur: 'Urdu (اردو)',
    uz: 'Uzbek (oʻzbekcha)',
    vec: 'Venetian (veneto)',
    vi: 'Vietnamese (Tiếng Việt)',
    vls: 'Flemish (West-Vlams)',
    wa: 'Walloon (walon)',
    wo: 'Wolof',
    xh: 'Xhosa (isiXhosa)',
    yi: 'Yiddish (ייִديش)',
    yo: 'Yoruba (Yorùbá)',
    'zh-TW': 'Traditional Chinese (繁體中文)',
    zh: 'Simplified Chinese (简体中文)',
    zu: 'Zulu (isiZulu)',
  };
  const baseCode = code.split('-')[0].toLowerCase();
  return mapping[code] || mapping[baseCode] || code.toUpperCase();
};

export function SettingsModal({ visible, onClose }: SettingsModalProps) {
  const colors = useThemeColors();
  const {
    continuousCardView, setContinuousCardView,
    enableGlassmorphism,
    theme, setTheme,
    reducedMotion, setReducedMotion,
    simpleControls, setSimpleControls,
    language, setLanguage,
    adminCourseLayoutMode, setAdminCourseLayoutMode
  } = useSettingsStore();
  const { currentUserId, logout } = useLMSStore();

  const [showLangDropdown, setShowLangDropdown] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  // Grouping and sorting language codes
  const pinnedCodes = ['en', 'es', 'fr', 'de', 'zh', 'zh-TW', 'ja', 'ko', 'pt', 'it'];
  const otherCodes = Object.keys(i18n.translations)
    .filter((code) => !pinnedCodes.includes(code))
    .sort((a, b) => getLanguageName(a).localeCompare(getLanguageName(b)));

  const renderContent = () => (
    <View accessibilityViewIsModal style={[styles.settingsModal, enableGlassmorphism ? styles.glassModal : {}, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: colors.text }]}> 
      <ScrollView keyboardShouldPersistTaps="handled" style={{ width: '100%' }} contentContainerStyle={{ alignItems: 'center', paddingBottom: spacing[2] }} nestedScrollEnabled>
      <Text accessibilityRole="header" style={[styles.settingsTitle, { color: colors.text }]}>{i18n.t('settings')}</Text>
      
      <View style={styles.settingRow}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>{i18n.t('theme')}</Text>
        <View style={styles.themeToggleRow}>
          {['light', 'dark', 'system'].map((t) => (
            <Pressable 
              key={t}
              style={[
                styles.themeBtn, 
                theme === t ? [styles.themeBtnActive, { backgroundColor: colors.primary }] : { backgroundColor: colors.background }
              ]}
              onPress={() => setTheme(t as any)}
              accessibilityRole="radio"
              accessibilityState={{ checked: theme === t }}
              accessibilityLabel={`${t.charAt(0).toUpperCase() + t.slice(1)} theme`}
            >
              <Text style={[
                styles.themeBtnText, 
                theme === t ? { color: colors.buttonText } : { color: colors.textSecondary }
              ]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.settingRow}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>Admin Layout Mode</Text>
        <View style={styles.themeToggleRow}>
          {['compact', 'classic'].map((m) => (
            <Pressable 
              key={m}
              style={[
                styles.themeBtn, 
                adminCourseLayoutMode === m ? [styles.themeBtnActive, { backgroundColor: colors.primary }] : { backgroundColor: colors.background }
              ]}
              onPress={() => setAdminCourseLayoutMode(m as any)}
              accessibilityRole="radio"
              accessibilityState={{ checked: adminCourseLayoutMode === m }}
              accessibilityLabel={`${m.charAt(0).toUpperCase() + m.slice(1)} admin layout`}
            >
              <Text style={[
                styles.themeBtnText, 
                adminCourseLayoutMode === m ? { color: colors.buttonText, fontWeight: 'bold' } : { color: colors.textSecondary }
              ]}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.settingRow, { zIndex: showLangDropdown ? 1000 : 1, elevation: showLangDropdown ? 10 : 1 }]}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>{i18n.t('language')}</Text>
        <View style={{ width: '50%', position: 'relative', zIndex: 1000 }}>
          <Pressable 
            style={[styles.dropdownBtn, { backgroundColor: colors.background, borderColor: colors.border }]} 
            onPress={() => setShowLangDropdown(!showLangDropdown)}
            accessibilityRole="button"
            accessibilityLabel={`Language: ${language === 'system' ? 'System default' : getLanguageName(language)}`}
            accessibilityState={{ expanded: showLangDropdown }}
          >
            <Text style={[styles.dropdownBtnText, { color: colors.text }]} numberOfLines={1}>
              {language === 'system' ? 'SYSTEM' : getLanguageName(language)}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 10 }}>▼</Text>
          </Pressable>
          {showLangDropdown && (
            <View style={[styles.dropdownList, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 200 }} nestedScrollEnabled>
                <Pressable 
                  style={[styles.dropdownItem, language === 'system' && { backgroundColor: colors.background }]} 
                  onPress={() => { setLanguage('system'); setShowLangDropdown(false); }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: language === 'system' }}
                >
                  <Text style={[styles.dropdownItemText, { color: colors.text }]}>SYSTEM</Text>
                </Pressable>

                {/* Pinned Top Languages */}
                {pinnedCodes.map((l) => (
                  <Pressable 
                    key={l}
                    style={[styles.dropdownItem, language === l && { backgroundColor: colors.background }]} 
                    onPress={() => { setLanguage(l); setShowLangDropdown(false); }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: language === l }}
                  >
                    <Text style={[styles.dropdownItemText, { color: colors.text }]}>{getLanguageName(l)}</Text>
                  </Pressable>
                ))}

                {/* Divider for Pinned vs Alphabetical */}
                <View style={{ height: 28, backgroundColor: colors.background, justifyContent: 'center', paddingHorizontal: spacing[4] }}>
                  <Text style={{ fontSize: 11, fontWeight: 'bold', color: colors.textSecondary }}>A - Z</Text>
                </View>

                {/* Alphabetical List */}
                {otherCodes.map((l) => (
                  <Pressable 
                    key={l}
                    style={[styles.dropdownItem, language === l && { backgroundColor: colors.background }]} 
                    onPress={() => { setLanguage(l); setShowLangDropdown(false); }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: language === l }}
                  >
                    <Text style={[styles.dropdownItemText, { color: colors.text }]}>{getLanguageName(l)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.settingRow}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>{i18n.t('continuousCardView')}</Text>
        <Switch 
          value={continuousCardView} 
          onValueChange={setContinuousCardView}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.card}
          accessibilityLabel="Continuous Card View"
          accessibilityRole="switch"
        />
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.settingRow}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>{i18n.t('reducedMotion')}</Text>
        <Switch 
          value={reducedMotion} 
          onValueChange={setReducedMotion}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.card}
          accessibilityLabel="Reduced Motion"
          accessibilityRole="switch"
        />
      </View>

      <View style={styles.settingRow}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>{i18n.t('simpleControls')}</Text>
        <Switch 
          value={simpleControls} 
          onValueChange={setSimpleControls}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.card}
          accessibilityLabel="Simple Controls"
          accessibilityRole="switch"
        />
      </View>
      <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>
        Simplifies study page by replacing interactive knob with simple buttons.
      </Text>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.settingRow} accessibilityState={{ disabled: true }}>
        <Text style={[styles.settingLabel, { color: colors.textSecondary }]}>Study analytics sharing</Text>
        <Switch
          disabled
          value={false}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.card}
          accessibilityLabel="Study analytics sharing unavailable"
          accessibilityHint="No flashcard study analytics are transmitted to teachers."
          accessibilityRole="switch"
          accessibilityState={{ disabled: true, checked: false }}
        />
      </View>
      <Text style={[styles.settingDesc, { color: colors.textSecondary }]}> 
        Unavailable until the institution provides principal-scoped consent, audit, revocation, deletion, and export. No study analytics are currently transmitted to teachers.
      </Text>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {!!accountError && <Text accessibilityRole="alert" style={[styles.settingDesc, { color: colors.error }]}>{accountError}</Text>}
      {!!currentUserId && (
        <Pressable
          disabled={isSigningOut}
          style={[styles.tutorialBtn, { backgroundColor: colors.danger, opacity: isSigningOut ? 0.6 : 1 }]}
          onPress={() => {
            Alert.alert('Sign out?', 'Course, grade, and conversation data will be cleared from this session. Local flashcard retention follows the device policy.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: async () => {
                if (isSigningOut) return;
                setIsSigningOut(true);
                setAccountError(null);
                try {
                  await logout();
                  onClose();
                } catch (error) {
                  setAccountError(error instanceof Error ? error.message : 'The institution session could not be signed out.');
                } finally {
                  setIsSigningOut(false);
                }
              } },
            ]);
          }}
          accessibilityRole="button"
          accessibilityLabel="Sign out of institution account"
          accessibilityState={{ disabled: isSigningOut, busy: isSigningOut }}
        >
          <Text style={[styles.tutorialBtnText, { color: colors.buttonText }]}>{isSigningOut ? 'Signing out…' : 'Sign out'}</Text>
        </Pressable>
      )}

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <Pressable 
        style={({ pressed }) => [styles.tutorialBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.8 }]} 
        onPress={() => {
          void generateSampleDeck()
            .then(tutorialDeckId => {
              onClose();
              setTimeout(() => router.push(`/study/${tutorialDeckId}?target=20&mode=study&startPos=1`), 100);
            })
            .catch(error => setAccountError(error instanceof Error ? error.message : 'The tutorial deck could not be prepared.'));
        }}
        accessibilityLabel="View Tutorial Deck" 
        accessibilityRole="button"
      >
        <Text style={[styles.tutorialBtnText, { color: colors.buttonText }]}>🚀 Replay Tutorial</Text>
      </Pressable>

      <Pressable style={[styles.closeBtn, { backgroundColor: colors.buttonBackground }]} onPress={onClose} accessibilityLabel="Close settings" accessibilityRole="button">
        <Text style={[styles.closeBtnText, { color: colors.buttonText }]}>{i18n.t('close')}</Text>
      </Pressable>
      </ScrollView>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType={enableGlassmorphism ? 'fade' : 'slide'} onRequestClose={onClose}>
      {enableGlassmorphism ? (
        <BlurView intensity={30} tint="dark" style={styles.modalOverlay}>
          <Pressable accessible={false} importantForAccessibility="no" style={styles.modalBackdrop} onPress={onClose} />
          {renderContent()}
        </BlurView>
      ) : (
        <View style={styles.modalOverlay}>
          <Pressable accessible={false} importantForAccessibility="no" style={styles.modalBackdrop} onPress={onClose} />
          {renderContent()}
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  settingsModal: {
    width: '85%',
    maxWidth: 400,
    maxHeight: '90%',
    borderRadius: 24,
    padding: spacing[8],
    alignItems: 'center',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 10,
    borderWidth: 1,
  },
  glassModal: {
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  settingsTitle: {
    fontSize: typography['2xl'],
    fontWeight: '800',
    marginBottom: spacing[6],
  },
  sectionTitle: {
    fontSize: typography.base,
    fontWeight: '800',
    alignSelf: 'flex-start',
    marginTop: spacing[2],
    marginBottom: spacing[4],
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: spacing[3],
  },
  settingLabel: {
    fontSize: typography.lg,
    fontWeight: '700',
  },
  settingDesc: {
    fontSize: typography.sm,
    textAlign: 'left',
    lineHeight: 20,
    marginBottom: spacing[3],
    width: '100%',
  },
  tutorialBtn: {
    paddingVertical: 14,
    paddingHorizontal: spacing[8],
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginTop: spacing[2],
  },
  tutorialBtnText: {
    fontSize: typography.base,
    fontWeight: '800',
  },
  closeBtn: {
    paddingVertical: 14,
    paddingHorizontal: spacing[8],
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginTop: spacing[4],
  },
  closeBtnText: {
    fontSize: typography.base,
    fontWeight: '800',
  },
  themeToggleRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  themeBtn: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: 8,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  themeBtnActive: {},
  themeBtnText: {
    fontSize: typography.sm,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    width: '100%',
    marginVertical: spacing[3],
  },
  dropdownBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
  },
  dropdownBtnText: {
    fontSize: typography.sm,
    fontWeight: '600',
  },
  dropdownList: {
    position: 'absolute',
    top: 40,
    right: 0,
    width: '100%',
    borderRadius: 8,
    borderWidth: 1,
    zIndex: 999,
    elevation: 5,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingVertical: spacing[3],
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(0,0,0,0.1)',
    minHeight: 44,
  },
  dropdownItemText: {
    fontSize: typography.sm,
    fontWeight: '500',
  },
});
