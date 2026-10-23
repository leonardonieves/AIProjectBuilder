import React, { createContext, useContext, useEffect, useState } from 'react';
import messages from './locales/en.json';
import spanish from './locales/es.json';
import generatorEn from './locales/generator-en.json';
import generatorEs from './locales/generator-es.json';

const Preferences = createContext(null);
function saved(key, allowed, fallback) {
  try { const value = localStorage.getItem(key); return allowed.includes(value) ? value : fallback; }
  catch { return fallback; }
}
export function I18nProvider({ children }) {
  const [language, setLanguage] = useState(() => saved('aipb.language', ['en', 'es'], 'en'));
  const [theme, setTheme] = useState(() => saved('aipb.theme', ['dark', 'light'], 'dark'));
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('aipb.language', language); localStorage.setItem('aipb.theme', theme); } catch { /* Memory-only preferences when storage is unavailable. */ }
  }, [language, theme]);
  const t = (text, values) => {
    const catalog = language === 'es' ? { ...spanish, ...generatorEs } : { ...messages, ...generatorEn };
    const message = Object.hasOwn(catalog, text) ? catalog[text] : text;
    return typeof message === 'string' && values
      ? message.replace(/\{(\w+)\}/g, (placeholder, key) => Object.hasOwn(values, key) ? String(values[key]) : placeholder)
      : message;
  };
  const date = value => value ? new Date(value).toLocaleString(language === 'es' ? 'es' : 'en') : '—';
  return <Preferences.Provider value={{ language, setLanguage, theme, setTheme, t, date }}>{children}</Preferences.Provider>;
}
export const useI18n = () => useContext(Preferences);
export function PreferenceControls() {
  const { language, setLanguage, theme, setTheme, t } = useI18n();
  return <div className="preferences">
    <label>{t('Idioma')}<select value={language} onChange={e => setLanguage(e.target.value)}>
      <option value="en">English</option><option value="es">Español</option>
    </select></label>
    <label>{t('Tema')}<select value={theme} onChange={e => setTheme(e.target.value)}>
      <option value="dark">{t('Oscuro')}</option><option value="light">{t('Claro')}</option>
    </select></label>
  </div>;
}
