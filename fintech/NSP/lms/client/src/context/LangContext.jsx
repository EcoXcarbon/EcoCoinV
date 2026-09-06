import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations } from '../i18n/translations';

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem('tl-lang') || 'en');

  const setLang = useCallback((l) => {
    setLangState(l);
    localStorage.setItem('tl-lang', l);
    const rtl = l === 'ur' || l === 'ps';
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = l;
  }, []);

  useEffect(() => {
    const rtl = lang === 'ur' || lang === 'ps';
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback((key) => {
    if (lang === 'en') return key;
    return translations[lang]?.[key] || key;
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export const useLang = () => useContext(LangContext);
