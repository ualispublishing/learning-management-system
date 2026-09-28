const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, 'src/lib/i18n/locales');
const indexFile = path.join(__dirname, 'src/lib/i18n/index.ts');

const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.ts'));

let imports = `import { I18n } from 'i18n-js';\nimport { getLocales } from 'expo-localization';\n`;
let dictObj = `\nconst i18n = new I18n({\n`;

files.forEach(file => {
  const lang = file.replace('.ts', '');
  const cleanVar = lang.replace(/[^a-zA-Z0-9_]/g, '');
  imports += `import ${cleanVar} from './locales/${lang}';\n`;
  if (lang.includes('-') || lang.match(/[^a-zA-Z0-9_]/)) {
    dictObj += `  '${lang}': ${cleanVar},\n`;
  } else {
    dictObj += `  ${lang}: ${cleanVar},\n`;
  }
});

dictObj += `});\n`;

const restOfFile = `
i18n.enableFallback = true;
i18n.defaultLocale = 'en';

export const setI18nConfig = (languageCode: string) => {
  if (languageCode === 'system') {
    const locales = getLocales();
    i18n.locale = locales && locales.length > 0 ? locales[0].languageCode ?? 'en' : 'en';
  } else {
    i18n.locale = languageCode;
  }
};

export default i18n;
`;

fs.writeFileSync(indexFile, imports + dictObj + restOfFile);
console.log('Updated i18n index.ts');
