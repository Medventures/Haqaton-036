import { Fragment, useEffect, useState } from 'react';
import { CalendarCheck, ClipboardCheck, FileText, Lock, ShieldCheck, Stethoscope, UserRound, Users } from 'lucide-react';
import { AVATAR_NAME } from '../../shared/i18n';
import AssistantAvatar from '../assistant/AssistantAvatar';
import { OrnamentBand, OrnamentPattern, Rosette } from '../brand/Ornament';
import LangSwitch from '../components/LangSwitch';
import { api } from '../api';
import { useAuth } from '../auth';
import { useT } from '../i18n';

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Экраны уже 960px — мобильная раскладка (как в styles.css). */
function useNarrow(query = '(max-width: 960px)') {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia(query);
    const on = () => setM(mq.matches);
    on(); mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

/** Номера экстренных служб выделяются жирным. */
const emph = (s: string) => s.split(/(103|112)/).map((p, i) => (i % 2 ? <b key={i}>{p}</b> : <Fragment key={i}>{p}</Fragment>));

export default function Login() {
  const { me, demoLogin } = useAuth();
  const { t, lang } = useT();
  const narrow = useNarrow();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const name = AVATAR_NAME.aruzhan[lang];
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('auth_error');
    if (q) { setErr(q); history.replaceState(null, '', location.pathname + location.hash); }
  }, []);

  const demo = async (as: 'new_patient' | 'aliya' | 'staff') => {
    setBusy(as); setErr('');
    try { await demoLogin(as); } catch (e) { setErr(e instanceof Error ? e.message : t('auth.errLogin')); } finally { setBusy(''); }
  };

  return (
    <div className="login login-v4">
      <section className="login-hero">
        <OrnamentPattern className="kz-on-dark login-orn-pattern" color="#E7C86A" opacity={0.09} tile={96} />
        <div className="login-hero-top">
          <div className="brand light"><span className="brand-mark">✳</span><b>clarity</b><small>{t('auth.brandFor')}</small></div>
          <LangSwitch compact className="on-dark login-lang-mobile" />
        </div>
        <div className="login-hero-body">
          <figure className="login-portrait">
            <div className="login-portrait-stage">
              <div className="login-portrait-rosette" aria-hidden><Rosette className="kz-on-dark" color="#E7C86A" opacity={0.35} size={narrow ? 200 : 290} /></div>
              <div className="login-portrait-card">
                <AssistantAvatar avatar="aruzhan" mood="happy" framing="bust" size={narrow ? 150 : 210} />
              </div>
            </div>
            <figcaption className="login-portrait-tag">{t('auth.avatarTag', { name })}</figcaption>
          </figure>
          <div className="login-hero-text">
            <h1>{t('auth.heroTitle')}</h1>
            <p>{t('auth.heroText', { name })}</p>
            <ul className="login-points">
              <li><ClipboardCheck size={18} /> {t('auth.point1')}</li>
              <li><CalendarCheck size={18} /> {t('auth.point2')}</li>
              <li><FileText size={18} /> {t('auth.point3')}</li>
              <li><Stethoscope size={18} /> {t('auth.point4')}</li>
            </ul>
          </div>
        </div>
        <div className="login-band" aria-hidden><OrnamentBand className="kz-on-dark" color="#E7C86A" opacity={0.45} height={18} /></div>
        <div className="login-trust">
          <span><ShieldCheck size={15} /> {t('auth.trustDoctor')}</span>
          <span><Lock size={15} /> {t('auth.trustData')}</span>
          <span>✳ {t('auth.trustOpen')}</span>
        </div>
      </section>

      <section className="login-panel">
        <LangSwitch compact className="login-lang-desktop" />
        <div className="login-card">
          <h2>{t('auth.title')}</h2>
          <p className="muted">{t('auth.subtitle')}</p>

          {me?.google
            ? <a className="btn google" href={api.googleUrl}><GoogleG /> {t('auth.google')}</a>
            : <button className="btn google" disabled title={t('auth.googleDisabled')}><GoogleG /> {t('auth.google')}</button>}
          {!me?.google && <p className="hint">{t('auth.googleHint')}</p>}

          {err && <p className="form-error" role="alert">{err}</p>}

          {me?.demo && <>
            <div className="divider"><span>{t('auth.demoDivider')}</span></div>
            <button className="demo-btn" onClick={() => demo('new_patient')} disabled={!!busy}>
              <span className="demo-ico teal"><UserRound size={20} /></span>
              <span><b>{t('auth.demoNewTitle')}</b><small>{t('auth.demoNewText')}</small></span>
            </button>
            <button className="demo-btn" onClick={() => demo('aliya')} disabled={!!busy}>
              <span className="demo-ico sky">А</span>
              <span><b>{t('auth.demoAliyaTitle')}</b><small>{t('auth.demoAliyaText')}</small></span>
            </button>
            <button className="demo-btn" onClick={() => demo('staff')} disabled={!!busy}>
              <span className="demo-ico ink"><Users size={20} /></span>
              <span><b>{t('auth.demoStaffTitle')}</b><small>{t('auth.demoStaffText')}</small></span>
            </button>
          </>}
          <p className="login-legal">{t('auth.legal')} {emph(t('auth.emergency'))}</p>
        </div>
      </section>
    </div>
  );
}
