import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, FileUp, LockKeyhole, MessageCircle, Sparkles, TriangleAlert } from 'lucide-react';
import type { Answer, ReminderPlan, Slot } from '../../shared/types';
import { api, fmtDate, fmtDateTime, fmtShort, fmtTime, type ProtocolInfo } from '../api';
import { useClarity } from '../state';
import { useT } from '../i18n';
import { specialtyLabel, type Lang } from '../../shared/i18n';
import { PrepPlan, Reminders, ReportCard, ScreeningSummary } from '../assistant/Cards';
import { useFilePickers } from './docs/ui';
import { classifyError, extractReport, type DocError } from './docs/upload';

export type ModalId = 'screening' | 'prep' | 'reminder' | 'result' | 'booking' | 'inbox' | 'visit' | 'dayof';

const ANS: Answer[] = ['no', 'yes', 'unknown'];

/** «Невролог (демо) — А. Сапарова» → специальность на языке интерфейса. */
const doctorLabel = (doctor: string, lang: Lang) =>
  lang === 'kk' ? doctor.replace(/^(.+?) \(демо\)/, (_m, s: string) => `${specialtyLabel(s.trim(), 'kk')} (демо)`) : doctor;
/** Специальность в середине фразы: по-русски со строчной буквы (кроме аббревиатур вроде «ЛОР»). */
const specInline = (s: string, lang: Lang) => {
  const l = specialtyLabel(s, lang);
  return lang === 'ru' && !/^[А-ЯЁA-Z]{2}/.test(l) ? l.toLowerCase() : l;
};

export default function Modal({ id, onClose, go }: { id: ModalId; onClose: () => void; go: (m: ModalId) => void }) {
  const { state, openAssistant, assistantName } = useClarity();
  const { t, lang } = useT();
  const [protocol, setProtocol] = useState<ProtocolInfo | null>(null);
  // Вопросы анкеты — на текущем языке; при смене языка перезагружаем протокол.
  useEffect(() => {
    let alive = true;
    api.protocol(lang).then(p => { if (alive) setProtocol(p); }).catch(() => undefined);
    return () => { alive = false; };
  }, [lang]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  if (!state) return null;

  const withClary = (action: Parameters<typeof openAssistant>[0]) => { onClose(); openAssistant(action); };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={t('modals.aria')}>
        <button className="modal-close" onClick={onClose} aria-label={t('modals.close')}>×</button>

        {id === 'screening' && protocol && <ScreeningForm protocol={protocol} go={go} onClose={onClose} withClary={() => withClary({ type: 'screening_start' })} />}

        {id === 'prep' && <>
          <div className="modal-kicker">{t('modals.prepKicker')}</div>
          <h2>{t('modals.prepTitle')}</h2>
          <p className="modal-lead">{t('modals.prepLead')}</p>
          <PrepPlan items={state.prepPlan} checked={state.journey.prepChecks} />
          <div className="warning-panel"><TriangleAlert size={19} /><p><b>{t('modals.prepWarnTitle')}</b><br />{t('modals.prepWarnText')}</p></div>
          <div className="modal-footer"><button className="subtle-button" onClick={() => go('screening')}><ArrowLeft size={15} /> {t('modals.backToScreening')}</button><button className="primary-button" onClick={() => go('reminder')}>{t('modals.toReminders')} <ArrowRight size={15} /></button></div>
        </>}

        {id === 'reminder' && <ReminderForm onDone={onClose} />}

        {id === 'result' && <ReportForm go={go} withClary={() => withClary({ type: 'report_start' })} />}

        {id === 'booking' && <BookingForm />}

        {id === 'dayof' && protocol && <DayOfForm protocol={protocol} onDone={onClose} />}

        {id === 'visit' && <VisitForm onDone={onClose} />}

        {id === 'inbox' && <InboxView go={go} />}

        {id === 'screening' && !protocol && <p className="modal-lead">{t('modals.loadingProtocol')}</p>}
        <div className="modal-clary"><button onClick={() => withClary(undefined)}><Sparkles size={14} /> {t('modals.withAssistant', { name: assistantName })}</button></div>
      </section>
    </div>
  );
}

function ScreeningForm({ protocol, go, onClose, withClary }: { protocol: ProtocolInfo; go: (m: ModalId) => void; onClose: () => void; withClary: () => void }) {
  const { state, run, assistantName } = useClarity();
  const { t } = useT();
  const [lab, setLab] = useState({ has: state!.journey.lab.status, value: String(state!.journey.lab.creatinineUmolL ?? ''), date: state!.journey.lab.takenOn ?? '' });
  if (!state) return null;
  const { journey, profile } = state;
  const qs = protocol.questions.filter(q => !q.femaleOnly || profile.sex === 'female');
  const answered = qs.filter(q => journey.answers[q.id]).length;
  const saveLab = () => {
    if (lab.has === 'provided') {
      const v = Number(lab.value.replace(',', '.'));
      if (!v || !lab.date) return run(async () => { throw new Error(t('modals.labErr')); });
      return run(() => api.lab({ status: 'provided', creatinineUmolL: v, takenOn: lab.date }), t('modals.labSaved'));
    }
    return run(() => api.lab({ status: lab.has === 'none' ? 'none' : 'unknown' }), t('modals.saved'));
  };
  return <>
    <div className="modal-kicker">{t('modals.scrKicker')}</div>
    <h2>{t('modals.scrTitle')}</h2>
    <p className="modal-lead">{t('modals.scrLead')} <button className="inline-link" onClick={withClary}>{t('modals.scrVoice', { name: assistantName })}</button></p>
    <div className="question-progress"><div style={{ width: `${(answered / qs.length) * 100}%` }} /></div>
    <div className="q-form">
      {qs.map((q, i) => (
        <fieldset key={q.id} className="q-item">
          <legend><span>{i + 1}.</span> {q.text}</legend>
          <small>{q.hint}</small>
          <div className="seg">
            {ANS.map(v => <button key={v} className={journey.answers[q.id] === v ? `on ans-${v}` : ''} onClick={() => run(() => api.answer(q.id, v))} aria-pressed={journey.answers[q.id] === v}>{t(`modals.ans.${v}`)}</button>)}
          </div>
        </fieldset>
      ))}
      <fieldset className="q-item lab">
        <legend><span>{qs.length + 1}.</span> {t('modals.labLegend', { n: protocol.labs.maxAgeDays })}</legend>
        <div className="seg">
          {([['provided', 'labHas'], ['none', 'labNone'], ['unknown', 'labUnknown']] as const).map(([v, l]) => <button key={v} className={lab.has === v ? 'on' : ''} onClick={() => setLab({ ...lab, has: v })}>{t(`modals.${l}`)}</button>)}
        </div>
        {lab.has === 'provided' && <div className="two-fields">
          <label className="form-label">{t('modals.labValue')}<input inputMode="decimal" value={lab.value} onChange={e => setLab({ ...lab, value: e.target.value })} placeholder={t('modals.labValuePh')} /></label>
          <label className="form-label">{t('modals.labDate')}<input type="date" value={lab.date} max={new Date().toISOString().slice(0, 10)} onChange={e => setLab({ ...lab, date: e.target.value })} /></label>
        </div>}
        <button className="outline-button save-lab" onClick={saveLab}><Check size={14} /> {t('modals.labSave')}</button>
      </fieldset>
    </div>
    {journey.screening && journey.screening.overall !== 'incomplete' && <ScreeningSummary result={journey.screening} />}
    <div className="modal-footer"><button className="subtle-button" onClick={onClose}><ArrowLeft size={15} /> {t('modals.close')}</button><button className="primary-button" disabled={!journey.screening || journey.screening.overall === 'incomplete'} onClick={() => go('prep')}>{t('modals.toPrep')} <ArrowRight size={15} /></button></div>
  </>;
}

function ReminderForm({ onDone }: { onDone: () => void }) {
  const { state, run } = useClarity();
  const { t } = useT();
  const [plan, setPlan] = useState<ReminderPlan>(state!.journey.reminderPlan ?? 'full');
  if (!state) return null;
  return <>
    <div className="modal-kicker">{t('modals.remKicker')}</div>
    <h2>{t('modals.remTitle')}</h2>
    <p className="modal-lead">{t('modals.remLead')}</p>
    <div className="plan-options">
      {([['full', 'planFull', 'planFullHint'], ['day_before', 'planDay', 'planDayHint'], ['none', 'planNone', '']] as const).map(([v, title, d]) => (
        <button key={v} className={`plan ${plan === v ? 'on' : ''}`} onClick={() => setPlan(v)}><span className="radio-dot" /><span><b>{t(`modals.${title}`)}</b>{d && <small>{t(`modals.${d}`)}</small>}</span></button>
      ))}
    </div>
    {state.journey.reminderPlan && <Reminders reminders={state.reminders} plan={state.journey.reminderPlan} />}
    <div className="modal-footer"><button className="subtle-button" onClick={onDone}><ArrowLeft size={15} /> {t('modals.close')}</button><button className="primary-button" onClick={() => run(() => api.reminders(plan), plan === 'none' ? t('modals.remOff') : t('modals.remOn'))}>{t('modals.save')} <Check size={15} /></button></div>
  </>;
}

function ReportForm({ go, withClary }: { go: (m: ModalId) => void; withClary: () => void }) {
  const { state, run, assistantName } = useClarity();
  const { t, lang } = useT();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [docErr, setDocErr] = useState<DocError | null>(null);
  const [recognized, setRecognized] = useState('');
  const fromFile = async (file: File) => {
    setReading(true); setDocErr(null); setRecognized('');
    try {
      const x = await extractReport(file);
      setText(x.text.slice(0, 6000));
      setRecognized(x.warning ?? t('docs.modalRecognized'));
    } catch (e) { setDocErr(classifyError(e)); }
    setReading(false);
  };
  const pickers = useFilePickers(fromFile);
  if (!state) return null;
  const report = state.journey.lastReport;
  const explain = async () => { setLoading(true); await run(() => api.report(text).then(r => r.state)); setLoading(false); };
  return <>
    <div className="modal-kicker">{t('modals.repKicker')}</div>
    <h2>{t('modals.repTitle')}</h2>
    <p className="modal-lead">{t('modals.repLead', { name: assistantName })} <b>{t('modals.repDemo')}</b></p>
    {pickers.inputs}
    <div className="docs-modal-upload">
      <button className="outline-button" onClick={pickers.takePhoto} disabled={reading}><Camera size={17} /> {t('docs.modalPhoto')}</button>
      <button className="outline-button" onClick={pickers.chooseFile} disabled={reading}><FileUp size={17} /> {t('docs.modalFile')}</button>
      {reading && <span className="docs-modal-reading" role="status"><i className="docs-spinner" aria-hidden /> {t('docs.readingText')}</span>}
    </div>
    {docErr && <div className="warning-panel"><TriangleAlert size={19} /><p><b>{t(`docs.err.${docErr.code}`)}</b><br />{t(`docs.errHint.${docErr.code}${docErr.code === 'llm_unavailable' || docErr.code === 'not_recognized' ? '_report' : ''}`)}</p></div>}
    {recognized && !docErr && <div className="info-panel"><CheckCircle2 size={17} /><span>{recognized}</span></div>}
    <textarea className="report-input" rows={5} value={text} onChange={e => setText(e.target.value)} placeholder={t('modals.repPh')} maxLength={6000} />
    <div className="upload-row">
      <button className="primary-button" disabled={text.trim().length < 10 || loading} onClick={explain}>{loading ? t('modals.explaining') : t('modals.explain')} <Sparkles size={14} /></button>
      <button className="subtle-button" onClick={withClary}>{t('modals.repWithAssistant', { name: assistantName })}</button>
    </div>
    {report && <ReportCard report={report} />}
    {report && report.level !== 'routine' && <div className={report.level === 'urgent' ? 'warning-panel urgent' : 'warning-panel'}><TriangleAlert size={19} /><p><b>{report.level === 'urgent' ? t('modals.repUrgent') : t('modals.repConsult', { spec: report.recommendedSpecialtyLabel ?? specialtyLabel(report.recommendedSpecialty, lang) })}</b><br />{t('modals.repNotDiagnosis')}</p></div>}
    <div className="modal-footer"><button className="subtle-button" onClick={() => go('inbox')}><MessageCircle size={15} /> {t('modals.myRequests')}</button><button className="primary-button" onClick={() => go('booking')}>{t('modals.bookSpecialist')} <ArrowRight size={15} /></button></div>
  </>;
}

function BookingForm() {
  const { state, run } = useClarity();
  const { t, lang } = useT();
  const suggested = state?.journey.offeredConsultation?.specialty ?? 'Невролог';
  const [specialty, setSpecialty] = useState(suggested);
  const [specs, setSpecs] = useState<string[]>([]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [pick, setPick] = useState<Slot | null>(null);
  const urgent = state?.journey.lastReport?.level === 'urgent';
  useEffect(() => { setSlots(null); api.slots(specialty, urgent).then(r => { setSlots(r.slots); setSpecs(r.specialties); }).catch(() => setSlots([])); }, [specialty, urgent, state?.bookings.length]);
  if (!state) return null;
  return <>
    <div className="modal-kicker">{t('modals.bookKicker')}</div>
    <h2>{t('modals.bookTitle')}</h2>
    <p className="modal-lead">{state.journey.offeredConsultation ? t('modals.bookRecommended', { spec: specInline(state.journey.offeredConsultation.specialty, lang) }) : t('modals.bookChoose')} {t('modals.bookDemo')}</p>
    {state.bookings.filter(b => b.status === 'booked').map(b => <div key={b.id} className="success-panel"><CheckCircle2 size={18} /><p><b>{t('modals.bookedTitle', { spec: specialtyLabel(b.specialty, lang) })}</b><br />{fmtDateTime(b.startsAt)} · {b.format === 'online' ? t('modals.online') : t('modals.inClinic')}</p></div>)}
    <label className="form-label">{t('modals.specialist')}<select value={specialty} onChange={e => { setSpecialty(e.target.value); setPick(null); }}>{(specs.length ? specs : [suggested]).map(s => <option key={s} value={s}>{specialtyLabel(s, lang)}</option>)}</select></label>
    <div className="slot-grid">
      {slots === null && <p className="modal-lead">{t('modals.loadingSlots')}</p>}
      {slots?.length === 0 && <p className="modal-lead">{t('modals.noSlots')}</p>}
      {slots?.map(s => <button key={s.id} className={pick?.id === s.id ? 'on' : ''} onClick={() => setPick(s)}><b>{fmtDate(s.startsAt)}</b><span>{fmtTime(s.startsAt)} · {s.format === 'online' ? t('modals.online') : t('modals.inClinic')}</span><small>{doctorLabel(s.doctor, lang)}</small></button>)}
    </div>
    <div className="modal-footer"><span className="modal-hint">{pick ? `${doctorLabel(pick.doctor, lang)}, ${fmtShort(pick.startsAt)}` : t('modals.pickTime')}</span><button className="primary-button" disabled={!pick} onClick={() => pick && run(() => api.book(pick.id).then(r => r.state), t('modals.bookedToast')).then(() => setPick(null))}>{t('modals.book')} <Check size={15} /></button></div>
  </>;
}

function DayOfForm({ protocol, onDone }: { protocol: ProtocolInfo; onDone: () => void }) {
  const { state, run } = useClarity();
  const { t } = useT();
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  if (!state) return null;
  const done = state.journey.dayOfCheck;
  return <>
    <div className="modal-kicker">{t('modals.dayKicker')}</div>
    <h2>{t('modals.dayTitle')}</h2>
    <p className="modal-lead">{t('modals.dayLead')}</p>
    {done ? <div className={done.ok ? 'success-panel' : 'warning-panel'}>{done.ok ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}<p><b>{done.ok ? t('modals.dayOk') : t('modals.dayWarned')}</b><br />{done.ok ? t('modals.dayArrive', { time: fmtTime(state.visit.startsAt) }) : done.issues.join('; ')}</p></div> :
      <div className="q-form">{protocol.dayOfCheck.map(q => (
        <fieldset key={q.id} className="q-item"><legend>{q.text}</legend><div className="seg">{[true, false].map(v => <button key={String(v)} className={answers[q.id] === v ? `on ${v ? 'ans-no' : 'ans-yes'}` : ''} onClick={() => setAnswers({ ...answers, [q.id]: v })}>{t(v ? 'modals.ans.yes' : 'modals.ans.no')}</button>)}</div></fieldset>
      ))}</div>}
    <div className="modal-footer"><button className="subtle-button" onClick={onDone}><ArrowLeft size={15} /> {t('modals.close')}</button>{!done && <button className="primary-button" disabled={Object.keys(answers).length < protocol.dayOfCheck.length} onClick={() => run(() => api.dayOfCheck(answers))}>{t('modals.send')} <Check size={15} /></button>}</div>
  </>;
}

function VisitForm({ onDone }: { onDone: () => void }) {
  const { state, run } = useClarity();
  const { t } = useT();
  const [reason, setReason] = useState('');
  if (!state) return null;
  const v = state.visit;
  return <>
    <div className="modal-kicker">{t('modals.visitKicker')}</div>
    <h2>{v.procedure}</h2>
    <div className="visit-box"><div><b>{fmtDateTime(v.startsAt)}</b><p>{v.clinic}, {v.address}, {v.city}</p><p>{t('modals.visitStatus', { s: t(`modals.vs.${v.status}`) })}</p></div></div>
    <div className="upload-row">
      <a className="outline-button" href={api.icsUrl} download>{t('modals.addCalendar')}</a>
      {v.status === 'scheduled' && <button className="primary-button" onClick={() => run(() => api.confirmVisit(), t('modals.visitConfirmed'))}>{t('modals.confirmVisit')} <Check size={15} /></button>}
    </div>
    {['scheduled', 'confirmed'].includes(v.status) && <>
      <label className="form-label">{t('modals.rescheduleLabel')}<textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('modals.reschedulePh')} /></label>
      <button className="outline-button" disabled={reason.trim().length < 2} onClick={() => run(() => api.reschedule(reason.trim()), t('modals.rescheduleSent')).then(onDone)}>{t('modals.rescheduleBtn')}</button>
    </>}
    <div className="info-panel"><LockKeyhole size={17} /><span>{t('modals.visitSynthetic')}</span></div>
    <div className="modal-footer"><button className="subtle-button" onClick={onDone}><ArrowLeft size={15} /> {t('modals.close')}</button></div>
  </>;
}

function InboxView({ go }: { go: (m: ModalId) => void }) {
  const { state, run } = useClarity();
  const { t } = useT();
  const [text, setText] = useState('');
  if (!state) return null;
  return <>
    <div className="modal-kicker">{t('modals.inboxKicker')}</div>
    <h2>{t('modals.myRequests')}</h2>
    <p className="modal-lead">{t('modals.inboxLead')}</p>
    {state.openTasks.length === 0 ? <div className="success-panel"><CheckCircle2 size={18} /><p>{t('modals.noRequests')}</p></div> :
      <div className="alert-list">{state.openTasks.map(task => <div key={task.id}><TriangleAlert size={16} /><span><b>{t(`modals.task.${task.kind}`)}</b> — {task.title}</span><small>{task.priority === 'urgent' ? t('modals.urgent') : t('modals.inWork')}</small></div>)}</div>}
    <label className="form-label">{t('modals.askCoordinator')}<textarea rows={3} value={text} onChange={e => setText(e.target.value)} placeholder={t('modals.askPh')} /></label>
    <div className="modal-footer"><button className="subtle-button" onClick={() => go('booking')}>{t('modals.bookDoctor')}</button><button className="primary-button" disabled={!text.trim()} onClick={() => run(() => api.question(text.trim()), t('modals.questionSent')).then(() => setText(''))}>{t('modals.send')} <ArrowRight size={15} /></button></div>
  </>;
}
