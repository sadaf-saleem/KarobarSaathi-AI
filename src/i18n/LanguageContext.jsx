import { createContext, useContext, useState, useCallback } from 'react';
import translations from './translations';

const LANGS = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'roman', label: 'Roman Urdu', dir: 'ltr' },
  { code: 'ur', label: 'اردو', dir: 'rtl' }
];

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('ks_lang') || 'en');

  const changeLang = useCallback((code) => {
    setLang(code);
    localStorage.setItem('ks_lang', code);
    const dir = LANGS.find(l => l.code === code)?.dir || 'ltr';
    document.documentElement.dir = dir;
    document.documentElement.lang = code === 'roman' ? 'ur-Latn' : code;
  }, []);

  const t = useCallback((key) => {
    const entry = translations[key];
    if (!entry) return key;
    return entry[lang] || entry.en || key;
  }, [lang]);

  const currentLang = LANGS.find(l => l.code === lang) || LANGS[0];
  const isRTL = currentLang.dir === 'rtl';

  return (
    <LanguageContext.Provider value={{ lang, setLang: changeLang, t, isRTL, currentLang, LANGS }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
