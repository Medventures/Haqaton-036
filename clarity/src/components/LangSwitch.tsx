// Переключатель языка интерфейса и разговора: RU | ҚАЗ.
import { LANG_LABEL, LANG_SHORT, LANGS } from '../../shared/i18n';
import { useT } from '../i18n';

export default function LangSwitch({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const { lang, setLang } = useT();
  return (
    <div className={`lang-switch ${compact ? 'compact' : ''} ${className}`} role="radiogroup" aria-label="Язык · Тіл">
      {LANGS.map(l => (
        <button key={l} role="radio" aria-checked={lang === l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)} title={LANG_LABEL[l]} lang={l}>
          {compact ? LANG_SHORT[l] : LANG_LABEL[l]}
        </button>
      ))}
    </div>
  );
}
