import { useCallback, useEffect, useRef } from 'react';
import Avatar from './assistant/Avatar';
import { AuthProvider, useAuth } from './auth';
import { ClarityProvider } from './state';
import { initialLang, LangProvider } from './i18n';
import { api } from './api';
import type { Lang } from '../shared/i18n';
import Login from './auth/Login';
import Onboarding from './onboarding/Onboarding';
import PatientApp from './patient/PatientApp';
import StaffApp from './staff/StaffApp';

export default function App() {
  return <AuthProvider><WithLang /></AuthProvider>;
}

/** Язык: до входа — из браузера/localStorage, после входа — из профиля (сохраняется на сервере). */
function WithLang() {
  const { me, refreshMe } = useAuth();
  // Язык, выбранный до входа, переносим в профиль нового пользователя (ещё не прошедшего знакомство).
  const synced = useRef(false);
  useEffect(() => {
    const u = me?.user;
    if (!u || synced.current) return;
    synced.current = true;
    const pre = initialLang();
    if (!u.onboarded && u.role === 'patient' && pre !== u.lang) void api.prefs({ lang: pre }).then(refreshMe).catch(() => undefined);
  }, [me?.user, refreshMe]);
  const onChange = useCallback((l: Lang) => { if (me?.user) void api.prefs({ lang: l }).then(refreshMe).catch(() => undefined); }, [me?.user, refreshMe]);
  return <LangProvider serverLang={me?.user?.lang} onChange={onChange}><Root /></LangProvider>;
}

function Root() {
  const { me, loading, error, refreshMe } = useAuth();
  if (loading) return <div className="boot"><Avatar mood="happy" size={140} framing="head" /><p>Clarity…</p></div>;
  if (!me) return <div className="boot"><div className="boot-error"><b>Сервер Clarity недоступен / Clarity серверіне қосылу мүмкін емес</b><p>{error}</p><button className="btn primary" onClick={refreshMe}>Повторить / Қайталау</button></div></div>;
  if (!me.user) return <Login />;
  if (me.user.role === 'staff') return <StaffApp />;
  if (!me.user.onboarded) return <Onboarding defaultName={me.user.name} onDone={refreshMe} />;
  return <ClarityProvider><PatientApp /></ClarityProvider>;
}
