import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bell, BellOff, CalendarPlus, Car, Check, CircleStop, ClipboardCheck, Clock3, FlaskConical, IdCard, Info, Magnet, MapPin, MessageCircle, Mic, Printer, Sparkles, TriangleAlert, Upload, UtensilsCrossed, Volume2 } from 'lucide-react';
import type { PrepItem } from '../../shared/types';
import AssistantAvatar from '../assistant/AssistantAvatar';
import { api, dayKey, fmtDate, fmtDayNum, fmtMonthShort, fmtShort, fmtTime } from '../api';
import { useT } from '../i18n';
import { useClarity } from '../state';
import { labState, useNameVars, visitKeyTimes } from './Home';
import type { ModalId } from './Modals';

type PhaseId = 'before_3d' | 'before_1d' | 'day_of' | 'after';
const ORDER: PhaseId[] = ['before_3d', 'before_1d', 'day_of', 'after'];

interface Todo { id: string; icon: ReactNode; title: string; hint?: string; tone: 'todo' | 'warn' | 'crit' | 'info'; cta?: { label: string; onClick?: () => void; href?: string } }

/** «Инструкция к визиту»: сводка, «что сделать сейчас» и пошаговая шкала с конкретными датами. */
export default function PrepPage({ open }: { open: (m: ModalId) => void }) {
  const { state, health, openAssistant, openCall, run, speech, lang, avatar } = useClarity();
  const { t } = useT();
  const nv = useNameVars();
  const [reading, setReading] = useState(false);
  const readingRef = useRef(false);
  readingRef.current = reading;
  // Уходим со страницы — останавливаем чтение инструкции (но не чужую речь).
  useEffect(() => () => { if (readingRef.current) speech.stopSpeaking(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Запасной сброс кнопки: речь началась и закончилась, а onEnd не пришёл (например, остановил другой компонент).
  const startedRef = useRef(false);
  useEffect(() => {
    if (!reading) { startedRef.current = false; return; }
    if (speech.speaking) startedRef.current = true;
    else if (startedRef.current) setReading(false);
  }, [reading, speech.speaking]);
  if (!state) return null;
  const p = (k: string, vars?: Record<string, string | number>) => t(`patient.${k}`, { ...nv, ...vars });
  const { journey: j, visit: v, prepPlan } = state;
  const nowIso = health?.now ?? new Date().toISOString();
  const h = (new Date(v.startsAt).getTime() - new Date(nowIso).getTime()) / 3_600_000;
  const kt = visitKeyTimes(state);
  const lab = labState(state);
  const sc = j.screening;
  const checked = (id: string) => j.prepChecks.includes(id);
  const doneCount = prepPlan.filter(x => checked(x.id)).length;

  // ── Текущий этап по календарю (Алматы) ──────────────────────────────────
  const today = dayKey(nowIso);
  const current: PhaseId = h < -1 || today > dayKey(v.startsAt) ? 'after' : today === dayKey(v.startsAt) ? 'day_of' : today === dayKey(kt.minus1d) ? 'before_1d' : 'before_3d';
  const curIdx = ORDER.indexOf(current);

  // ── Что сделать сейчас ──────────────────────────────────────────────────
  const todos: Todo[] = [];
  if (h >= -1) {
    if (!sc || sc.overall === 'incomplete') todos.push({ id: 'screening', icon: <ClipboardCheck size={20} />, title: p('instrScreeningTodo'), hint: p('instrScreeningHint'), tone: 'todo', cta: { label: p('instrScreeningCta'), onClick: () => open('screening') } });
    if (lab.needed && lab.status === 'stale') todos.push({ id: 'lab', icon: <FlaskConical size={20} />, title: p('instrLabStale', { n: lab.ageDays ?? '—' }), hint: p('instrLabStaleHint', { max: kt.labMaxDays }), tone: 'warn', cta: { label: p('instrLabCta'), href: '#/documents' } });
    else if (lab.needed && lab.status === 'missing') todos.push({ id: 'lab', icon: <FlaskConical size={20} />, title: p('instrLabMissing'), hint: p('instrLabMissingHint', { max: kt.labMaxDays }), tone: 'todo', cta: { label: p('instrLabCta'), href: '#/documents' } });
    if (sc?.overall === 'hold_for_review') todos.push({ id: 'hold', icon: <TriangleAlert size={20} />, title: p('instrHoldNote'), hint: p('instrHoldHint'), tone: 'crit' });
    else if (sc?.overall === 'needs_review' || state.openTasks.some(x => x.kind === 'screening_review')) todos.push({ id: 'review', icon: <Info size={20} />, title: p('instrReviewNote'), hint: p('instrReviewHint'), tone: 'info' });
    if (h <= 24 && !j.dayOfCheck && ['scheduled', 'confirmed'].includes(v.status)) todos.push({ id: 'dayof', icon: <Clock3 size={20} />, title: p('prepDayofTodo'), hint: p('prepDayofHint'), tone: 'todo', cta: { label: p('nextDayofCta'), onClick: () => open('dayof') } });
    if (!j.reminderPlan) todos.push({ id: 'rem', icon: <Bell size={20} />, title: p('instrRemindTodo'), hint: p('instrRemindHint'), tone: 'todo', cta: { label: p('nextRemindCta'), onClick: () => open('reminder') } });
    if (v.status === 'scheduled') todos.push({ id: 'confirm', icon: <Check size={20} />, title: p('instrConfirmTodo'), hint: p('instrConfirmHint'), tone: 'todo', cta: { label: p('visitConfirm'), onClick: () => void run(() => api.confirmVisit(), p('visitConfirmed')) } });
  } else if (!j.lastReport) {
    todos.push({ id: 'report', icon: <Upload size={20} />, title: p('instrUploadReport'), hint: p('instrUploadReportHint'), tone: 'todo', cta: { label: p('nextUploadReportCta'), href: '#/documents' } });
  }

  // ── Главное ─────────────────────────────────────────────────────────────
  const keys: { id: string; icon: ReactNode; text: string }[] = [
    { id: 'food', icon: <UtensilsCrossed size={18} />, text: p('instrKeyFood', { h: kt.fastingH, time: fmtTime(kt.lastMeal) }) },
    { id: 'docs', icon: <IdCard size={18} />, text: p('instrKeyDocs') },
    ...(lab.needed ? [{ id: 'lab', icon: <FlaskConical size={18} />, text: p('instrKeyLab', { max: kt.labMaxDays }) }] : []),
    { id: 'metal', icon: <Magnet size={18} />, text: p('instrKeyMetal') },
    { id: 'arrive', icon: <Car size={18} />, text: p('instrKeyArrive', { time: fmtTime(kt.arriveAt), m: kt.arriveMin }) },
  ];

  // ── Шкала этапов ───────────────────────────────────────────────────────
  const phases: { id: PhaseId; label: string; items: PrepItem[]; meta?: { icon: ReactNode; text: string }[] }[] = [
    { id: 'before_3d', label: p('instrBy3d', { date: fmtDate(kt.minus3d) }), items: prepPlan.filter(x => x.phase === 'before_3d') },
    { id: 'before_1d', label: p('instrEve', { date: fmtDate(kt.minus1d) }), items: prepPlan.filter(x => x.phase === 'before_1d') },
    { id: 'day_of', label: p('instrDay', { date: fmtDate(v.startsAt), time: fmtTime(v.startsAt) }), items: prepPlan.filter(x => x.phase === 'day_of'),
      meta: [{ icon: <UtensilsCrossed size={15} />, text: p('instrLastMeal', { time: fmtTime(kt.lastMeal) }) }, { icon: <Car size={15} />, text: p('instrArriveAt', { time: fmtTime(kt.arriveAt) }) }] },
    { id: 'after', label: p('instrAfter'), items: prepPlan.filter(x => x.phase === 'after') },
  ];

  const speakText = () => [
    `${p('instrTitle')}.`,
    p('instrSpeakVisit', { when: `${fmtDate(v.startsAt)}, ${fmtTime(v.startsAt)}`, clinic: v.clinic, address: v.address }),
    `${p('instrSpeakMain')} ${keys.map(k => k.text).join('. ')}.`,
    todos.length ? `${p('instrNowTitle')}: ${todos.map(x => x.title).join('. ')}.` : '',
    ...phases.filter(ph => ph.items.length).map(ph => `${ph.label.replace(' · ', ', ')}: ${ph.items.map(i => i.title).join('. ')}.`),
  ].filter(Boolean).join(' ');
  const toggleRead = () => {
    if (reading) { speech.stopSpeaking(); setReading(false); return; }
    setReading(true);
    speech.speak(speakText(), { voice: true, lang, onEnd: () => setReading(false) });
  };

  const upcomingRem = state.reminders.filter(r => !r.deliveredAt).slice(0, 3);
  const phaseState = (ph: typeof phases[number], i: number) => {
    const all = ph.items.length > 0 && ph.items.every(x => checked(x.id));
    const missedCritical = i < curIdx && ph.items.some(x => x.critical && !checked(x.id));
    return { all, current: i === curIdx, past: i < curIdx, missed: missedCritical };
  };

  return (
    <div className="page pz-instr">
      <div className="page-head pz-instr-head">
        <div><h1>{p('instrTitle')}</h1><p className="muted">{p('instrSubtitle')}</p></div>
        <div className="pz-instr-tools no-print">
          <button className={`btn ghost ${reading ? 'pz-on' : ''}`} onClick={toggleRead} aria-pressed={reading}>{reading ? <><CircleStop size={18} /> {p('instrStop')}</> : <><Volume2 size={18} /> {p('instrRead')}</>}</button>
          <button className="btn ghost" onClick={() => window.print()}><Printer size={18} /> {p('instrPrint')}</button>
          <button className="btn primary" onClick={() => openAssistant({ type: 'instruction' })}><Sparkles size={18} /> {p('askName')}</button>
        </div>
      </div>

      <div className="grid-main pz-instr-grid">
        <div className="instr-print">
          <p className="print-only pz-print-head">Clarity · Green Clinic — {p('instrTitle')} · {p('instrPrintedFor', { name: state.profile.displayName })}</p>

          {/* Сводка */}
          <section className="pz-sum pz-enter" aria-labelledby="pz-sum-title">
            <div className="pz-sum-visit">
              <div className="date-tile" aria-hidden><span>{fmtMonthShort(v.startsAt)}</span><b>{fmtDayNum(v.startsAt)}</b></div>
              <div className="pz-sum-when">
                <small id="pz-sum-title">{p('instrYourVisit')}</small>
                <b>{fmtDate(v.startsAt)}, {fmtTime(v.startsAt)}</b>
                <span className="pz-sum-addr"><MapPin size={15} aria-hidden /> {v.clinic}, {v.address}, {v.city}</span>
                <span className={`pill st-${v.status}`}>{p(`visit_${v.status}`)}</span>
              </div>
            </div>
            <div className="pz-sum-main">
              <h2>{p('instrMain')}</h2>
              <ul className="pz-keys">{keys.map(k => <li key={k.id}><span className="pz-key-ico" aria-hidden>{k.icon}</span><span>{k.text}</span></li>)}</ul>
            </div>
          </section>

          {/* Шкала */}
          <ol className="pz-tl" aria-label={p('instrTitle')}>
            <li className="pz-tl-step is-now is-current">
              <span className="pz-tl-dot" aria-hidden><span className="pz-pulse" /></span>
              <div className="pz-tl-body">
                <div className="pz-tl-head"><h3>{p('instrNowTitle')}</h3><span className="pz-tag now">{fmtDate(nowIso)}</span></div>
                {todos.length === 0 ? <p className="pz-tl-empty"><Check size={18} aria-hidden /> {p('instrNowEmpty')}</p> : (
                  <ul className="pz-todos">
                    {todos.map(td => (
                      <li key={td.id} className={`pz-todo tone-${td.tone}`}>
                        <span className="pz-todo-ico" aria-hidden>{td.icon}</span>
                        <div className="pz-todo-text"><b>{td.title}</b>{td.hint && <small>{td.hint}</small>}</div>
                        {td.cta && (td.cta.href
                          ? <a className="btn primary sm no-print" href={td.cta.href}>{td.cta.label} <ArrowRight size={16} /></a>
                          : <button className="btn primary sm no-print" onClick={td.cta.onClick}>{td.cta.label} <ArrowRight size={16} /></button>)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>

            {phases.map((ph, i) => {
              const st = phaseState(ph, i);
              const n = ph.items.filter(x => checked(x.id)).length;
              return (
                <li key={ph.id} className={`pz-tl-step ${st.current ? 'is-current' : ''} ${st.past ? 'is-past' : ''} ${st.all ? 'is-done' : ''}`}>
                  <span className="pz-tl-dot" aria-hidden>{st.all ? <Check size={14} /> : i + 1}</span>
                  <div className="pz-tl-body">
                    <div className="pz-tl-head">
                      <h3>{ph.label}</h3>
                      {st.current && <span className="pz-tag now">{p('instrPhaseCurrent')}</span>}
                      {st.missed && <span className="pz-tag warn">{p('instrPhaseLate')}</span>}
                      {ph.items.length > 0 && <span className="pz-tl-count">{n}/{ph.items.length}</span>}
                    </div>
                    {ph.meta && <div className="pz-tl-meta">{ph.meta.map(m => <span key={m.text}>{m.icon} {m.text}</span>)}</div>}
                    <div className="pz-items">
                      {ph.items.map(item => {
                        const on = checked(item.id);
                        return (
                          <button key={item.id} className={`pz-item ${on ? 'on' : ''} ${item.personal ? 'personal' : ''} ${item.critical ? 'critical' : ''}`} onClick={() => void run(() => api.prep(item.id, !on))} aria-pressed={on}>
                            <span className="pz-box" aria-hidden>{on && <Check size={14} strokeWidth={3} />}</span>
                            <span className="pz-item-text">
                              <b>{item.title}</b>
                              <small>{item.detail}</small>
                              {(item.personal || item.critical) && <span className="pz-item-tags">
                                {item.personal && <em className="personal">{t('cards.personal')}</em>}
                                {item.critical && <em className="crit">{t('cards.critical')}</em>}
                              </span>}
                            </span>
                          </button>
                        );
                      })}
                      {ph.id === 'after' && !j.lastReport && h >= -1 && (
                        <a className="pz-item pz-item-link no-print" href="#/documents">
                          <span className="pz-box link" aria-hidden><Upload size={14} /></span>
                          <span className="pz-item-text"><b>{p('instrUploadReport')}</b><small>{p('instrUploadReportHint')}</small></span>
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="muted small pz-instr-progress">{p('instrChecked', { a: doneCount, b: prepPlan.length })}</p>
        </div>

        <aside className="no-print pz-instr-aside">
          <section className="card pz-card">
            <div className="card-head">{j.reminderPlan === 'none' ? <BellOff size={20} /> : <Bell size={20} />}<h2>{p('reminders')}</h2>
              <span className={`pill ${j.reminderPlan && j.reminderPlan !== 'none' ? 'st-confirmed' : 'st-scheduled'}`}>{j.reminderPlan ? (j.reminderPlan === 'none' ? p('remOff') : p('remOn')) : p('remNotSet')}</span>
            </div>
            {j.reminderPlan && j.reminderPlan !== 'none' ? <>
              <p className="muted small pz-nomargin">{p('instrRemPlanned', { n: state.reminders.length })}</p>
              {upcomingRem.length > 0 && <ul className="pz-rem">{upcomingRem.map(r => <li key={r.id}><Clock3 size={15} aria-hidden /><span><b>{r.title}</b><small>{fmtShort(r.dueAt)}</small></span></li>)}</ul>}
            </> : <p className="muted">{j.reminderPlan === 'none' ? p('instrRemOff') : p('prepRemText')}</p>}
            <div className="card-actions">
              <button className={`btn ${j.reminderPlan ? 'ghost' : 'primary'} sm`} onClick={() => open('reminder')}>{j.reminderPlan ? t('common.change') : p('prepRemSetup')}</button>
              <a className="btn ghost sm" href={api.icsUrl} download><CalendarPlus size={16} /> {p('prepCalDownload')}</a>
            </div>
          </section>

          <div className="notice warn"><TriangleAlert size={20} /><div><b>{p('prepMedsTitle')}</b><p>{p('prepMedsText')}</p></div></div>

          <section className="card pz-card pz-ask">
            <span className={`pz-ask-av av-${avatar}`} aria-hidden><AssistantAvatar avatar={avatar} size={64} framing="head" /></span>
            <div>
              <b>{p('instrAskTitle')}</b>
              <p className="muted">{p('instrAskText')}</p>
              <div className="card-actions">
                <button className="btn primary sm" onClick={() => openAssistant({ type: 'instruction' })}><MessageCircle size={16} /> {p('askName')}</button>
                <button className="btn ghost sm" onClick={openCall}><Mic size={16} /> {p('heroVoice')}</button>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
