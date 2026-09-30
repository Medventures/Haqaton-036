import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bell, BookOpen, CalendarDays, CalendarPlus, Car, Check, ChevronDown, ChevronRight, ClipboardCheck, ClipboardList, Clock3, FileText, FlaskConical, FolderOpen, MapPin, MessageCircle, Mic, ShieldCheck, Star, Stethoscope, TriangleAlert, Upload, UserRound } from 'lucide-react';
import type { AssistantAction, PatientState } from '../../shared/types';
import { specialtyLabel, type Lang } from '../../shared/i18n';
import AssistantAvatar from '../assistant/AssistantAvatar';
import { OrnamentBand, OrnamentPattern } from '../brand/Ornament';
import { api, countdown, durationUntil, fmtDate, fmtDayNum, fmtMonthShort, fmtTime } from '../api';
import { useT } from '../i18n';
import { useClarity } from '../state';
import type { ModalId } from './Modals';

type Go = (p: 'home' | 'prep' | 'documents' | 'progress' | 'inbox') => void;
type T = (key: string, vars?: Record<string, string | number>) => string;

// ── Склонение имени ассистента в казахском (сингармонизм) ──────────────────────
const BACK = /[аоұыяёю]/;
const VOWELS = /[аәеёиоөуұүыіэюя]/;
function lastVowelBack(w: string): boolean {
  for (let i = w.length - 1; i >= 0; i--) { const c = w[i]; if (VOWELS.test(c)) return BACK.test(c); }
  return true;
}
/** -мен (дауысты, л м н ң р й у), -бен (ж з), -пен (қатаң). */
function kkIns(w: string): string {
  const c = w.at(-1)!.toLowerCase();
  return w + (VOWELS.test(c) || 'лмнңрйу'.includes(c) ? 'мен' : 'жз'.includes(c) ? 'бен' : 'пен');
}
/** -ға/-ге (дауысты, ұяң), -қа/-ке (қатаң). */
function kkDat(w: string): string {
  const c = w.at(-1)!.toLowerCase(), back = lastVowelBack(w.toLowerCase());
  const hard = 'кқпстфхцчшщ'.includes(c);
  return w + (hard ? (back ? 'қа' : 'ке') : (back ? 'ға' : 'ге'));
}
/** -нан/-нен (м н ң), -дан/-ден (дауысты, ұяң), -тан/-тен (қатаң). */
function kkAbl(w: string): string {
  const c = w.at(-1)!.toLowerCase(), back = lastVowelBack(w.toLowerCase());
  const base = 'мнң'.includes(c) ? 'н' : 'кқпстфхцчшщ'.includes(c) ? 'т' : 'д';
  return w + base + (back ? 'ан' : 'ен');
}
/** Переменные для подстановки имени ассистента: {name}, {nameIns}, {nameDat}, {nameAbl}. */
export function nameVars(name: string, lang: Lang) {
  if (lang !== 'kk') return { name, nameIns: name, nameDat: name, nameAbl: name };
  return { name, nameIns: kkIns(name), nameDat: kkDat(name), nameAbl: kkAbl(name) };
}
export function useNameVars() {
  const { assistantName, lang } = useClarity();
  return nameVars(assistantName, lang);
}

/** Ключевые моменты визита, вычисленные из протокола (числа берутся из пунктов плана подготовки). */
export function visitKeyTimes(s: PatientState) {
  const start = new Date(s.visit.startsAt).getTime();
  const num = (id: string, def: number) => { const m = s.prepPlan.find(x => x.id === id)?.title.match(/\d+/); return m ? Number(m[0]) : def; };
  const fastingH = num('fasting', 4), arriveMin = num('arrive', 30), labMaxDays = num('labs', 30);
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    fastingH, arriveMin, labMaxDays,
    lastMeal: iso(start - fastingH * 3_600_000),
    arriveAt: iso(start - arriveMin * 60_000),
    minus3d: iso(start - 3 * 86_400_000),
    minus1d: iso(start - 86_400_000),
  };
}

/** Состояние анализа на креатинин: нужен ли, есть ли, не устарел ли. */
export function labState(s: PatientState): { needed: boolean; status: 'ok' | 'missing' | 'stale'; ageDays?: number } {
  const sc = s.journey.screening;
  const needed = sc ? sc.labsRequired : true;
  const stale = sc?.flags.find(f => f.key === 'lab:stale');
  if (stale) return { needed, status: 'stale', ageDays: sc?.labAgeDays };
  if (s.journey.lab.status !== 'provided') return { needed, status: 'missing' };
  return { needed, status: 'ok', ageDays: sc?.labAgeDays };
}

interface Next { icon: ReactNode; title: string; text: string; cta: string; clary?: AssistantAction; modal?: ModalId; page?: 'prep' | 'documents'; done?: boolean }

function nextStep(s: PatientState, nowIso: string, t: T, nv: Record<string, string>, lang: Lang): Next {
  const { journey: j, visit: v, prepPlan } = s;
  const h = (new Date(v.startsAt).getTime() - new Date(nowIso).getTime()) / 3_600_000;
  const booked = s.bookings.some(b => b.status === 'booked');
  const p = (k: string, vars?: Record<string, string | number>) => t(`patient.${k}`, { ...nv, ...vars });
  const lab = labState(s);
  const { labMaxDays } = visitKeyTimes(s);
  if (h < -1) {
    if (!j.lastReport) return { icon: <Upload />, title: p('nextUploadReportTitle'), text: p('nextUploadReportText'), cta: p('nextUploadReportCta'), clary: { type: 'report_start' }, page: 'documents' };
    if (j.offeredConsultation && !booked) return { icon: <UserRound />, title: p('nextBookTitle', { specialty: specialtyLabel(j.offeredConsultation.specialty, lang).toLowerCase() }), text: p('nextBookText'), cta: p('nextBookCta'), clary: { type: 'booking_start', specialty: j.offeredConsultation.specialty }, modal: 'booking' };
    return { icon: <Check />, title: p('nextDoneTitle'), text: p('nextDoneText'), cta: p('askName'), clary: { type: 'status' }, done: true };
  }
  if (!j.screening || j.screening.overall === 'incomplete') return { icon: <ClipboardCheck />, title: p('nextScreenTitle'), text: p('nextScreenText'), cta: Object.keys(j.answers).length ? p('nextScreenContinue') : p('nextScreenStart'), clary: { type: 'screening_start' }, modal: 'screening' };
  if (h <= 24 && !j.dayOfCheck && ['scheduled', 'confirmed'].includes(v.status)) return { icon: <Clock3 />, title: h > 12 ? p('nextDayofTomorrow') : p('nextDayofToday'), text: p('nextDayofText'), cta: p('nextDayofCta'), modal: 'dayof' };
  if (lab.needed && lab.status === 'stale') return { icon: <FlaskConical />, title: p('nextStaleLabTitle'), text: p('nextStaleLabText', { max: labMaxDays }), cta: p('nextUploadLabCta'), page: 'documents' };
  if (lab.needed && lab.status === 'missing') return { icon: <FlaskConical />, title: p('nextUploadLabTitle'), text: p('nextUploadLabText'), cta: p('nextUploadLabCta'), page: 'documents' };
  const critical = prepPlan.filter(x => x.critical && !j.prepChecks.includes(x.id));
  if (critical.length) return { icon: <BookOpen />, title: p('nextPrepTitle'), text: p('nextPrepText', { n: critical.length, list: `${critical.slice(0, 2).map(x => x.title.toLowerCase()).join('; ')}${critical.length > 2 ? '…' : ''}` }), cta: p('nextOpenInstruction'), page: 'prep' };
  if (!j.reminderPlan) return { icon: <Bell />, title: p('nextRemindTitle'), text: p('nextRemindText'), cta: p('nextRemindCta'), clary: { type: 'reminder_menu' }, modal: 'reminder' };
  if (v.status === 'scheduled') return { icon: <CalendarDays />, title: p('nextConfirmTitle'), text: p('nextConfirmText'), cta: p('nextConfirmCta'), clary: { type: 'visit_confirm' }, modal: 'visit' };
  return { icon: <Check />, title: p('nextReadyTitle'), text: p('nextReadyText'), cta: p('nextOpenInstruction'), page: 'prep', done: true };
}

const greetingKey = (nowIso: string) => { const h = Number(new Date(nowIso).toLocaleString('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', hour12: false })); return h < 5 ? 'greetNight' : h < 12 ? 'greetMorning' : h < 18 ? 'greetDay' : 'greetEvening'; };
/** Задержка появления блока (каскад); при prefers-reduced-motion анимации отключены в CSS. */
const enter = (i: number) => ({ ['--i' as string]: i }) as CSSProperties;

export default function Home({ open, go }: { open: (m: ModalId) => void; go: Go }) {
  const { state, health, openAssistant, openCall, speech, mood, busy, run, avatar, lang } = useClarity();
  const { t } = useT();
  const nv = useNameVars();
  const [tipOpen, setTipOpen] = useState<string | null>(null);
  const nextRef = useRef<HTMLDivElement>(null);
  const [nextVisible, setNextVisible] = useState(true);
  useEffect(() => {
    const el = nextRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setNextVisible(e.isIntersecting), { rootMargin: '-64px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [state !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!state) return null;
  const p = (k: string, vars?: Record<string, string | number>) => t(`patient.${k}`, { ...nv, ...vars });
  const { journey: j, visit: v, profile, prepPlan, progress } = state;
  const nowIso = health?.now ?? new Date().toISOString();
  const name = profile.onboarding?.preferredName ?? profile.displayName.split(' ')[0];
  const next = nextStep(state, nowIso, t, nv, lang);
  const s = j.screening;
  const flags = s?.flags.filter(f => f.severity !== 'info') ?? [];
  const prepDone = prepPlan.filter(x => j.prepChecks.includes(x.id)).length;
  const booked = state.bookings.find(b => b.status === 'booked');
  const doNext = () => { if (next.page) go(next.page); else if (next.modal) open(next.modal); else if (next.clary) openAssistant(next.clary); };
  const upcoming = new Date(v.startsAt).getTime() > new Date(nowIso).getTime();
  const kt = visitKeyTimes(state);
  const docsCount = (j.labReports?.length ?? 0) + (j.lastReport ? 1 : 0);
  const pct = progress.nextLevelAt ? ((progress.points - progress.levelStartAt) / (progress.nextLevelAt - progress.levelStartAt)) * 100 : 100;

  const steps = [
    { id: 'screening', icon: <ClipboardCheck size={20} />, title: p('stepScreening'), done: Boolean(s && s.overall !== 'incomplete'), status: s ? p(`st_${s.overall}`) : p('stNotStarted'), warn: s && ['needs_review', 'hold_for_review'].includes(s.overall), form: () => open('screening'), clary: { type: 'screening_start' } as AssistantAction },
    { id: 'prep', icon: <BookOpen size={20} />, title: p('stepPrep'), done: prepDone === prepPlan.length, status: t('common.ofN', { a: prepDone, b: prepPlan.length }), form: () => go('prep'), clary: { type: 'instruction' } as AssistantAction },
    { id: 'reminders', icon: <Bell size={20} />, title: p('stepReminders'), done: Boolean(j.reminderPlan), status: j.reminderPlan ? (j.reminderPlan === 'none' ? p('remOff') : p('remOn')) : p('remNotSet'), form: () => open('reminder'), clary: { type: 'reminder_menu' } as AssistantAction },
    { id: 'report', icon: <FileText size={20} />, title: p('stepReport'), done: Boolean(j.lastReport), status: j.lastReport ? p(`rep_${j.lastReport.level}`) : p('repAfterVisit'), warn: j.lastReport && j.lastReport.level !== 'routine', form: () => go('documents'), clary: { type: 'report_start' } as AssistantAction },
    { id: 'consult', icon: <UserRound size={20} />, title: p('stepConsult'), done: Boolean(booked), status: booked ? `${specialtyLabel(booked.specialty, lang)}, ${fmtDate(booked.startsAt)}` : j.offeredConsultation ? p('consultRecommended') : p('consultAsNeeded'), form: () => open('booking'), clary: { type: 'booking_start', specialty: j.offeredConsultation?.specialty } as AssistantAction },
  ];

  const tiles: { id: string; icon: ReactNode; title: string; sub: string; onClick: () => void; meta?: string; tone: string }[] = [
    { id: 'instr', icon: <ClipboardList size={22} />, title: p('qaInstruction'), sub: p('qaInstructionSub'), onClick: () => go('prep'), meta: `${prepDone}/${prepPlan.length}`, tone: 'teal' },
    { id: 'docs', icon: <FolderOpen size={22} />, title: p('qaDocuments'), sub: p('qaDocumentsSub'), onClick: () => go('documents'), meta: docsCount ? String(docsCount) : undefined, tone: 'sky' },
    { id: 'voice', icon: <Mic size={22} />, title: p('qaVoice'), sub: p('qaVoiceSub'), onClick: openCall, tone: 'voice' },
    { id: 'book', icon: <Stethoscope size={22} />, title: p('qaBook'), sub: p('qaBookSub'), onClick: () => open('booking'), tone: 'gold' },
  ];

  return (
    <div className="page home pz-home">
      <section className={`hero pv-hero pz-hero av-${avatar} pz-enter`} style={enter(0)}>
        <span className="pv-hero-pattern" aria-hidden><OrnamentPattern className="kz-teal" tile={96} opacity={0.07} accent="#C9A23A" /></span>
        <span className="pv-hero-band" aria-hidden><OrnamentBand className="kz-gold" height={14} opacity={0.45} accent="#0b7a70" /></span>
        <div className="hero-text">
          <p className="eyebrow">{p(greetingKey(nowIso))}, {name}</p>
          <h1>{upcoming ? <>{p('heroUntilBefore')}<span className="accent">{durationUntil(v.startsAt, nowIso)}</span>{p('heroUntilAfter')}</> : p('heroAfter')}</h1>
          <p className="pz-hero-when"><CalendarDays size={16} aria-hidden /> <span>{fmtDate(v.startsAt)}, {fmtTime(v.startsAt)}</span><span className="pz-dot" aria-hidden>·</span><span>{v.clinic}</span></p>
          <div ref={nextRef} className={`next pz-next ${next.done ? 'done' : ''}`}>
            <span className="next-ico" aria-hidden>{next.icon}</span>
            <div className="pz-next-body"><small>{p('heroNextStep')}</small><b>{next.title}</b><p>{next.text}</p></div>
            <button className="btn primary pz-next-cta" onClick={doNext}>{next.cta} <ArrowRight size={18} /></button>
          </div>
        </div>
        <button className={avatar === 'clary' ? 'hero-avatar' : 'pv-hero-avatar'} onClick={openCall} aria-label={p('callAria')}>
          <span className="pv-portrait">
            <AssistantAvatar avatar={avatar} mood={mood} speaking={speech.speaking} mouth={speech.mouth} mouthSource={speech.getMouthFrame} thinking={busy} size={avatar === 'aruzhan' ? 236 : 250} />
          </span>
          <span className="bubble">{flags.length ? p('bubbleFlags') : next.done ? p('bubbleDone') : p('bubbleTap')}</span>
        </button>
      </section>

      <nav className="pz-quick" aria-label={p('quickTitle')}>
        {tiles.map((tile, i) => (
          <button key={tile.id} className={`pz-tile tone-${tile.tone} pz-enter`} style={enter(i + 1)} onClick={tile.onClick}>
            <span className="pz-tile-ico" aria-hidden>{tile.icon}</span>
            <span className="pz-tile-text"><b>{tile.title}</b><small>{tile.sub}</small></span>
            {tile.meta ? <span className="pz-tile-meta">{tile.meta}</span> : <ChevronRight className="pz-tile-chev" size={18} aria-hidden />}
          </button>
        ))}
      </nav>

      {flags.length > 0 && (
        <div className={`notice ${s?.overall === 'hold_for_review' ? 'crit' : 'warn'} pz-enter`} style={enter(5)} role="status">
          <TriangleAlert size={22} />
          <div><b>{s?.overall === 'hold_for_review' ? p('noticeHold') : p('noticeReview')}</b><p>{flags.map(f => f.title).join(' · ')}. {p('noticeText')}</p></div>
          <button className="btn ghost sm" onClick={() => go('inbox')}>{p('tabInbox')}</button>
        </div>
      )}

      <div className="grid-2 pz-grid">
        <section className="card visit pz-card pz-visit pz-enter" style={enter(5)}>
          <div className="card-head"><CalendarDays size={20} /><h2>{p('visitTitle')}</h2><span className={`pill st-${v.status}`}>{p(`visit_${v.status}`)}</span></div>
          <div className="visit-when">
            <div className="date-tile"><span>{fmtMonthShort(v.startsAt)}</span><b>{fmtDayNum(v.startsAt)}</b></div>
            <div className="pz-visit-info">
              <b className="visit-title">{v.procedure}</b>
              <p><Clock3 size={15} aria-hidden /> <span className="pz-cap">{fmtDate(v.startsAt)}, {fmtTime(v.startsAt)}</span></p>
              <p><MapPin size={15} aria-hidden /> <span>{v.clinic}, {v.city}</span></p>
              {upcoming && <p className="pz-visit-chips"><span className="chip-soft">{countdown(v.startsAt, nowIso)}</span><span className="pz-arrive"><Car size={15} aria-hidden /> {p('visitArrive', { time: fmtTime(kt.arriveAt) })}</span></p>}
            </div>
          </div>
          <div className="card-actions">
            {v.status === 'scheduled' && <button className="btn primary sm" onClick={() => run(() => api.confirmVisit(), p('visitConfirmed'))}><Check size={16} /> {p('visitConfirm')}</button>}
            <a className="btn ghost sm" href={api.icsUrl} download><CalendarPlus size={16} /> {p('visitCalendar')}</a>
            <button className="btn link sm" onClick={() => open('visit')}>{p('visitDetails')}</button>
          </div>
        </section>

        <section className="card progress-mini pz-card pz-progress pz-enter" style={enter(6)} onClick={() => go('progress')} role="link" tabIndex={0} aria-label={`${p('progressTitle')}: ${p('progressLevel', { n: progress.level, title: progress.levelTitle })}`} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('progress'); } }}>
          <div className="card-head"><Star size={20} /><h2>{p('progressTitle')}</h2><span className="stars"><Star size={15} fill="currentColor" /> {progress.points}</span></div>
          <b className="level">{p('progressLevel', { n: progress.level, title: progress.levelTitle })}</b>
          <div className="bar" aria-hidden><i style={{ width: `${pct}%` }} /></div>
          <small className="muted">{progress.nextLevelAt ? p('progressToNext', { title: progress.nextLevelTitle ?? '', n: progress.nextLevelAt - progress.points }) : p('progressMax')}</small>
          <div className="badges-row">{progress.achievements.map(a => <span key={a.id} className={`badge-mini ${a.earned ? 'on' : ''}`} title={`${a.title}${a.earned ? '' : ' — ' + a.hint}`}>{a.icon}</span>)}</div>
          <span className="pz-more">{p('progressOpen')} <ChevronRight size={16} aria-hidden /></span>
        </section>
      </div>

      <section className="card pz-card pz-enter" style={enter(7)}>
        <div className="card-head"><ShieldCheck size={20} /><h2>{p('pathTitle')}</h2><span className="muted">{t('common.ofN', { a: steps.filter(x => x.done).length, b: steps.length })}</span></div>
        <ol className="stepper pz-stepper">
          {steps.map((st, i) => (
            <li key={st.id} className={`${st.done ? 'done' : ''} ${st.warn ? 'warn' : ''}`}>
              <span className="st-dot" aria-hidden>{st.done ? <Check size={16} /> : i + 1}</span>
              <div className="st-body">
                <b>{st.title}</b>
                <small>{st.status}</small>
              </div>
              <div className="st-actions">
                <button className="btn link sm" onClick={() => openAssistant(st.clary)}>{p('withName')}</button>
                <button className="btn ghost sm" onClick={st.form}>{t('common.open')}</button>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {state.tips.length > 0 && (
        <section className="card pz-card pz-enter" style={enter(8)}>
          <div className="card-head"><MessageCircle size={20} /><h2>{p('tipsTitle')}</h2></div>
          <div className="tips">
            {state.tips.map(tip => (
              <div key={tip.id} className={`tip ${tipOpen === tip.id ? 'open' : ''}`}>
                <button onClick={() => setTipOpen(tipOpen === tip.id ? null : tip.id)} aria-expanded={tipOpen === tip.id}><b>{tip.title}</b><ChevronDown size={18} /></button>
                {tipOpen === tip.id && <p>{tip.answer}</p>}
              </div>
            ))}
          </div>
          <p className="muted small">{p('tipsSource')}</p>
        </section>
      )}

      <section className="assurance">
        <ShieldCheck size={22} />
        <p><b>{p('assuranceTitle')}</b> {p('assuranceText')}</p>
      </section>

      {!next.done && (
        <div className={`pz-sticky ${nextVisible ? '' : 'show'}`} aria-hidden={nextVisible}>
          <span className="pz-sticky-text"><small>{p('heroNextStep')}</small><b>{next.title}</b></span>
          <button className="btn primary sm" onClick={doNext} tabIndex={nextVisible ? -1 : 0}>{next.cta} <ArrowRight size={16} /></button>
        </div>
      )}
    </div>
  );
}
