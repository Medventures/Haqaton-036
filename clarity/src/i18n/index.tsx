import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isLang, LOCALE, type Lang } from '../../shared/i18n';
import { DICT } from './dictionary';
import { setFormatLang } from './format';

type Vars = Record<string, string | number>;

/** Русские плюралы: «день|дня|дней». В казахском числительное не меняет форму — берётся первая. */
function plural(forms: string, n: number, lang: Lang): string {
  const f = forms.split('|');
  // «+{n} звезда|звезды|звёзд»: префикс с числом из первой формы переносим в остальные.
  if (f.length > 1 && f[0].includes('{') && !f[1].includes('{')) {
    const prefix = f[0].slice(0, f[0].lastIndexOf(' ') + 1);
    for (let i = 1; i < f.length; i++) f[i] = prefix + f[i];
  }
  if (f.length < 2 || lang === 'kk') return f[0];
  const a = Math.abs(n) % 100, b = a % 10;
  return (a > 10 && a < 20) ? f[2] ?? f[1] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2] ?? f[1];
}

export function translate(lang: Lang, key: string, vars?: Vars): string {
  let s = DICT[lang][key] ?? DICT.ru[key] ?? key;
  if (s.includes('|') && vars && typeof vars.n === 'number') s = plural(s, vars.n, lang);
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
  return s;
}

interface LangCtx { lang: Lang; locale: string; setLang: (l: Lang) => void; t: (key: string, vars?: Vars) => string }
const Ctx = createContext<LangCtx | null>(null);

const STORE = 'clarity-lang';
export function initialLang(): Lang {
  try { const v = localStorage.getItem(STORE); if (isLang(v)) return v; } catch { /* нет хранилища */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('kk') ? 'kk' : 'ru';
}

/**
 * Язык интерфейса. serverLang — язык из профиля (после входа), onChange — сохранить на сервере.
 */
export function LangProvider({ children, serverLang, onChange }: { children: ReactNode; serverLang?: Lang; onChange?: (l: Lang) => void }) {
  const [lang, setLangRaw] = useState<Lang>(() => serverLang ?? initialLang());
  // Формат дат переключаем синхронно при рендере, чтобы даты сразу были на новом языке.
  setFormatLang(lang);
  useEffect(() => { if (serverLang && serverLang !== lang) setLangRaw(serverLang); }, [serverLang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.documentElement.lang = lang;
    setFormatLang(lang);
    try { localStorage.setItem(STORE, lang); } catch { /* ignore */ }
  }, [lang]);
  const setLang = useCallback((l: Lang) => { setLangRaw(l); onChange?.(l); }, [onChange]);
  const t = useCallback((key: string, vars?: Vars) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, locale: LOCALE[lang], setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT() {
  const c = useContext(Ctx);
  if (!c) throw new Error('LangProvider missing');
  return c;
}
