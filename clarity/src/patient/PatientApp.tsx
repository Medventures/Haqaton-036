import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, ClipboardList, FolderOpen, Home as HomeIcon, LogOut, MessageCircle, RotateCcw, Timer, Trophy, Type, Volume2, VolumeX, X } from 'lucide-react';
import { useAuth } from '../auth';
import { useClarity } from '../state';
import { api, fmtShort } from '../api';
import { AVATAR_NAME, type AvatarId } from '../../shared/i18n';
import AssistantAvatar from '../assistant/AssistantAvatar';
import LangSwitch from '../components/LangSwitch';
import { useT } from '../i18n';
import { OrnamentBand } from '../brand/Ornament';
import AssistantPanel from '../assistant/AssistantPanel';
import VoiceCall from '../assistant/VoiceCall';
import Modal, { type ModalId } from './Modals';
import Home, { useNameVars } from './Home';
import PrepPage from './PrepPage';
import ProgressPage from './ProgressPage';
import InboxPage from './InboxPage';
import DocumentsPage from './DocumentsPage';
import Celebration from './Celebration';

export type Page = 'home' | 'prep' | 'documents' | 'progress' | 'inbox';
const readPage = (): Page => { const h = location.hash.replace('#/', ''); return (['prep', 'documents', 'progress', 'inbox'] as const).find(p => h.startsWith(p)) ?? 'home'; };
const href = (p: Page) => (p === 'home' ? '#/' : `#/${p}`);

export default function PatientApp() {
  const { state, error, refresh, toast, showToast, openAssistant, openCall, unread, notifications, markRead, health, avatar, speech, assistantName } = useClarity();
  const { me } = useAuth();
  const { t } = useT();
  const nv = useNameVars();
  const p = (k: string, vars?: Record<string, string | number>) => t(`patient.${k}`, { ...nv, ...vars });
  const [page, setPage] = useState<Page>(readPage);
  const [modal, setModal] = useState<ModalId | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  useEffect(() => { const h = () => { setPage(readPage()); window.scrollTo({ top: 0 }); setBellOpen(false); }; window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  const go = (p: Page) => { location.hash = p === 'home' ? '/' : `/${p}`; };

  if (!state) {
    if (error) return <div className="boot"><div className="boot-error"><b>{p('bootError')}</b><p>{error}</p><button className="btn primary" onClick={refresh}>{t('common.retry')}</button></div></div>;
    return (
      <div className="pz-boot" aria-busy="true">
        <div className="pz-boot-top"><span className="skeleton pz-sk-brand" /><span className="skeleton pz-sk-pill" /></div>
        <div className="pz-boot-main">
          <div className="pz-boot-hero">
            <div className="pz-boot-lines"><span className="skeleton pz-sk-line w40" /><span className="skeleton pz-sk-line h2 w70" /><span className="skeleton pz-sk-block" /></div>
            <span className="pz-boot-av"><AssistantAvatar avatar={avatar} mood="thinking" thinking size={120} framing="head" /></span>
          </div>
          <div className="pz-boot-tiles">{[0, 1, 2, 3].map(i => <span key={i} className="skeleton pz-sk-tile" />)}</div>
          <div className="pz-boot-cards"><span className="skeleton pz-sk-card" /><span className="skeleton pz-sk-card" /></div>
          <p className="muted center" role="status">{p('bootLoading')}</p>
        </div>
      </div>
    );
  }

  const tabIcon: Record<Page, ReactNode> = { home: <HomeIcon size={22} />, prep: <ClipboardList size={22} />, documents: <FolderOpen size={22} />, inbox: <MessageCircle size={22} />, progress: <Trophy size={22} /> };
  const label: Record<Page, string> = { home: p('tabHome'), prep: p('tabPrep'), documents: p('tabDocuments'), inbox: p('tabInbox'), progress: p('tabProgress') };
  const badge: Partial<Record<Page, number>> = { inbox: state.openTasks.length };
  // Шапка (десктоп): все разделы. Нижняя навигация (телефон): 4 раздела + ассистент в центре; «Прогресс» — в меню и на главной.
  const topTabs: Page[] = ['home', 'prep', 'documents', 'inbox', 'progress'];
  const bottomLeft: Page[] = ['home', 'prep'];
  const bottomRight: Page[] = ['documents', 'inbox'];
  const bottomLink = (id: Page) => (
    <a key={id} href={href(id)} className={page === id ? 'on' : ''} aria-current={page === id ? 'page' : undefined}>
      <span className="pz-nav-ico">{tabIcon[id]}{badge[id] ? <i className="count">{badge[id]}</i> : null}</span><span>{label[id]}</span>
    </a>
  );

  return (
    <div className={`papp pz-page-${page}`}>
      <a className="pz-skip" href="#pmain" onClick={e => { e.preventDefault(); document.getElementById('pmain')?.focus(); }}>{t('common.skipToContent')}</a>
      <header className="ptop">
        <div className="ptop-in">
          <a className="brand" href="#/" aria-label={t('common.brandHome')}><span className="brand-mark">✳</span><b>clarity</b><small className="clinic-chip">Green Clinic</small></a>
          <nav className="ptabs" aria-label={p('sections')}>
            {topTabs.map(id => <a key={id} href={href(id)} className={page === id ? 'on' : ''} aria-current={page === id ? 'page' : undefined}>{label[id]}{badge[id] ? <span className="count">{badge[id]}</span> : null}</a>)}
          </nav>
          <div className="ptop-actions">
            <LangSwitch compact className="pv-top-lang" />
            {me?.demo && <DemoClock />}
            <div className="pop-wrap">
              <button className="icon-btn" aria-label={unread ? p('remindersUnread', { n: unread }) : p('reminders')} onClick={() => { setBellOpen(!bellOpen); if (!bellOpen) markRead(); }}><Bell size={21} />{unread > 0 && <i className="dot" />}</button>
              {bellOpen && <div className="pop" role="dialog" aria-label={p('reminders')}>
                <div className="pop-head"><b>{p('reminders')}</b><button onClick={() => setBellOpen(false)} aria-label={t('common.close')}><X size={16} /></button></div>
                {notifications.length === 0 ? <p className="muted pad">{p('remindersEmpty')} {state.journey.reminderPlan ? p('remindersScheduled') : p('remindersSetupHint')}</p> :
                  notifications.map(n => <div key={n.id} className="pop-item"><b>{n.title}</b><p>{n.body}</p><small>{fmtShort(n.dueAt)}</small></div>)}
              </div>}
            </div>
            <UserMenu onReset={async () => { await api.resetPatient(); await refresh(); showToast(p('resetDone')); }} onProgress={() => go('progress')} />
          </div>
        </div>
        <span className="pv-top-band" aria-hidden><OrnamentBand className="kz-gold" height={8} opacity={0.45} accent="#0b7a70" /></span>
      </header>

      {health && health.timeOffsetHours !== 0 && <div className="time-warp" role="status">{p('demoTimeIs', { time: fmtShort(health.now) })}</div>}

      <main className="pmain" id="pmain" tabIndex={-1}>
        {page === 'home' && <Home open={setModal} go={go} />}
        {page === 'prep' && <PrepPage open={setModal} />}
        {page === 'documents' && <DocumentsPage open={setModal} />}
        {page === 'progress' && <ProgressPage />}
        {page === 'inbox' && <InboxPage open={setModal} />}
        <footer className="pfoot">{t('common.footer')}</footer>
      </main>

      <nav className="pbottom" aria-label={p('navigation')}>
        {bottomLeft.map(bottomLink)}
        <button className={avatar === 'clary' ? 'pbottom-clary' : 'pv-bottom-av'} onClick={openCall} aria-label={p('callAria')}><span className="pv-bottom-face"><AssistantAvatar avatar={avatar} size={58} framing="head" speaking={speech.speaking} mouth={speech.mouth} mouthSource={speech.getMouthFrame} /></span><span>{assistantName}</span></button>
        {bottomRight.map(bottomLink)}
      </nav>

      <button className="fab" onClick={() => openAssistant()} aria-label={p('writeTo')}><MessageCircle size={20} /><span>{p('askName')}</span></button>

      {modal && <Modal id={modal} onClose={() => setModal(null)} go={setModal} />}
      <AssistantPanel />
      <VoiceCall />
      <Celebration />
      {toast && <div className="toast pz-toast" role="status" aria-live="polite"><CheckCircle2 size={18} /><span className="pz-toast-text">{toast}</span><button onClick={() => showToast('')} aria-label={t('common.hide')}><X size={16} /></button></div>}
    </div>
  );
}

function UserMenu({ onReset, onProgress }: { onReset: () => Promise<void>; onProgress: () => void }) {
  const { me, logout } = useAuth();
  const { state, largeText, setLargeText, voiceOn, setVoiceOn, avatar, setAvatar, lang, showToast } = useClarity();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const p = state?.profile;
  const choose = async (a: AvatarId) => {
    if (a === avatar) return;
    try { await setAvatar(a); showToast(t('patient.avatarChanged', { name: AVATAR_NAME[a][lang] })); } catch (e) { showToast(e instanceof Error ? e.message : t('common.actionFailed')); }
  };
  const avatars: { id: AvatarId; hint: string }[] = [
    { id: 'aruzhan', hint: t('patient.avatarAruzhanHint') },
    { id: 'clary', hint: t('patient.avatarClaryHint') },
  ];
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="user-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label={t('patient.menuAria')}>
        {p?.picture ? <img src={p.picture} alt="" referrerPolicy="no-referrer" /> : <span className="initials">{p?.initials ?? '…'}</span>}
      </button>
      {open && <div className="pop menu pv-menu" role="menu">
        <div className="menu-who"><b>{p?.displayName}</b><small>{me?.user?.email}</small></div>
        <div className="pv-menu-row">
          <span className="pv-menu-label">{t('patient.menuLang')} · {lang === 'kk' ? 'Язык' : 'Тіл'}</span>
          <LangSwitch className="pv-menu-lang" />
        </div>
        <div className="pv-menu-row">
          <span className="pv-menu-label">{t('patient.menuAvatar')}</span>
          <div className="pv-avatar-pick" role="radiogroup" aria-label={t('patient.menuAvatar')}>
            {avatars.map(a => (
              <button key={a.id} role="radio" aria-checked={avatar === a.id} className={avatar === a.id ? 'on' : ''} onClick={() => void choose(a.id)}>
                <span className={`pv-pick-face av-${a.id}`}><AssistantAvatar avatar={a.id} size={44} framing="head" /></span>
                <span className="pv-pick-text"><b>{AVATAR_NAME[a.id][lang]}</b><small>{a.hint}</small></span>
              </button>
            ))}
          </div>
        </div>
        <button role="menuitem" onClick={() => { setOpen(false); onProgress(); }}><Trophy size={18} /> {t('patient.menuProgress')} {state && <span className="pz-menu-stars">★ {state.progress.points}</span>}</button>
        <button role="menuitemcheckbox" aria-checked={largeText} onClick={() => setLargeText(!largeText)}><Type size={18} /> {t('patient.menuLarge')} <span className={`sw ${largeText ? 'on' : ''}`} /></button>
        <button role="menuitemcheckbox" aria-checked={voiceOn} onClick={() => setVoiceOn(!voiceOn)}>{voiceOn ? <Volume2 size={18} /> : <VolumeX size={18} />} {t('patient.menuVoice')} <span className={`sw ${voiceOn ? 'on' : ''}`} /></button>
        {me?.user?.provider === 'demo' && <button role="menuitem" onClick={() => { if (confirm(t('patient.menuResetConfirm'))) { setOpen(false); void onReset(); } }}><RotateCcw size={18} /> {t('patient.menuReset')}</button>}
        <button role="menuitem" className="danger" onClick={() => void logout()}><LogOut size={18} /> {t('patient.menuLogout')}</button>
      </div>}
    </div>
  );
}

/** Демо-перемотка времени: напоминания и сценарий «после визита» без ожидания. */
function DemoClock() {
  const { state, health, refresh, showToast } = useClarity();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  if (!state || !health) return null;
  const visitMs = new Date(state.visit.startsAt).getTime();
  const presets: [string, number | null][] = [
    [t('patient.demoNow'), null],
    [t('patient.demoMinus3d'), visitMs - 71 * 3_600_000],
    [t('patient.demoEve'), visitMs - 23 * 3_600_000],
    [t('patient.demoDay'), visitMs - 2 * 3_600_000],
    [t('patient.demoAfter'), visitMs + 48 * 3_600_000],
  ];
  const set = async (target: number | null) => {
    const offsetHours = target === null ? 0 : Math.round((target - Date.now()) / 3_600_000);
    try { await api.setTime(offsetHours); await refresh(); showToast(target === null ? t('patient.demoReset') : t('patient.demoTimeIs', { time: fmtShort(new Date(Date.now() + offsetHours * 3_600_000).toISOString()) })); } catch (e) { showToast(e instanceof Error ? e.message : t('common.error')); }
    setOpen(false);
  };
  return (
    <div className="pop-wrap">
      <button className={`demo-clock ${health.timeOffsetHours ? 'on' : ''}`} onClick={() => setOpen(!open)} title={t('patient.demoTitle')} aria-label={t('patient.demoTitle')}><Timer size={16} /><span>{health.timeOffsetHours ? fmtShort(health.now) : t('patient.demoLabel')}</span></button>
      {open && <div className="pop small" role="menu">{presets.map(([l, target]) => <button key={l} role="menuitem" className="menu-plain" onClick={() => set(target)}>{l}</button>)}</div>}
    </div>
  );
}
