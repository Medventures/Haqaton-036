import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertOctagon, CheckCircle2, Clock3, FileText, Info, Phone, Printer, RefreshCw, Search, TriangleAlert, UserCheck, UserX, X } from 'lucide-react';
import type { StaffTask } from '../../shared/types';
import { api, ApiError, fmtDateTime, fmtShort, type StaffOverview, type StaffPatient } from '../api';
import { useT } from '../i18n';
import { specialtyLabel } from '../../shared/i18n';
import { cancelReasonLabel } from './MetricsDashboard';

// Интерфейс кабинета переводится; клинический свободный текст системы (staffText, заголовки и детали задач) остаётся на русском.

const PRIO_ICON: Record<StaffTask['priority'], ReactNode> = { urgent: <AlertOctagon size={14} />, high: <TriangleAlert size={14} />, normal: <Clock3 size={14} /> };

export default function StaffConsole({ view, toast }: { view: 'queue' | 'patients'; toast: (t: string) => void }) {
  const { t } = useT();
  const [data, setData] = useState<StaffOverview | null>(null);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);
  const [filter, setFilter] = useState<'all' | 'attention' | 'soon'>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api.staff()); setErr(''); } catch (e) { setErr(e instanceof ApiError ? e.message : t('staff.error')); }
  }, [t]);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); await load(); } catch (e) { toast(e instanceof Error ? e.message : t('staff.error')); }
  };

  const patients = useMemo(() => {
    if (!data) return [];
    const nowMs = Date.now();
    return data.patients.filter(p => {
      if (q && !p.profile.displayName.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === 'attention') return ['needs_review', 'hold_for_review'].includes(p.screening?.overall ?? '') || (p.reportLevel && p.reportLevel !== 'routine') || p.visit.prepViolation;
      if (filter === 'soon') { const h = (new Date(p.visit.startsAt).getTime() - nowMs) / 3_600_000; return h > -2 && h < 72; }
      return true;
    });
  }, [data, filter, q]);

  if (!data) return <div className="page"><div className="skeleton" />{err && <p className="notice crit">{err}</p>}</div>;

  const name = (pid: string) => data.patients.find(p => p.profile.id === pid)?.profile.displayName ?? pid;
  const open = data.tasks.filter(t => t.status === 'open');
  const tasks = showResolved ? data.tasks : open;
  const current = data.patients.find(p => p.profile.id === openId);

  return (
    <div className="page wide">
      <div className="page-head">
        <div><h1>{view === 'queue' ? t('staff.queueTitle') : t('staff.patientsTitle')}</h1><p className="muted">{view === 'queue' ? t('staff.queueLead') : t('staff.patientsLead')}</p></div>
        <button className="btn ghost" onClick={load}><RefreshCw size={16} /> {t('staff.refresh')}</button>
      </div>

      <div className="kpis">
        <div className="kpi-s crit"><b>{open.filter(t => t.priority === 'urgent').length}</b><span><AlertOctagon size={14} /> {t('staff.kpiUrgent')}</span></div>
        <div className="kpi-s"><b>{open.length}</b><span>{t('staff.kpiOpen')}</span></div>
        <div className="kpi-s warn"><b>{data.patients.filter(p => p.screening?.overall === 'hold_for_review').length}</b><span>{t('staff.kpiHold')}</span></div>
        <div className="kpi-s ok"><b>{data.patients.filter(p => p.visit.status === 'confirmed').length}<small>/{data.patients.length}</small></b><span>{t('staff.kpiConfirmed')}</span></div>
      </div>

      {view === 'queue' ? <>
        <div className="section-bar"><h2>{t('staff.tasks')}</h2><label className="check-inline"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> {t('staff.showResolved')}</label></div>
        <div className="tasks">
          {tasks.length === 0 && <div className="notice ok"><CheckCircle2 size={20} /><div><b>{t('staff.noOpenTasks')}</b></div></div>}
          {tasks.map(task => (
            <article key={task.id} className={`task p-${task.priority} ${task.status}`}>
              <div className="task-top">
                <span className={`prio p-${task.priority}`}>{PRIO_ICON[task.priority]}{t(`staff.prio.${task.priority}`)}</span>
                <span className="kind">{t(`staff.kind.${task.kind}`)}</span>
                <button className="who" onClick={() => setOpenId(task.patientId)}>{name(task.patientId)}</button>
                <small>{fmtShort(task.createdAt)}</small>
              </div>
              <h3 lang="ru">{task.title}</h3>
              <p lang="ru">{task.details}</p>
              {task.status === 'open' ? (
                <div className="task-actions">
                  <input className="input" placeholder={t('staff.resolutionPh')} value={notes[task.id] ?? ''} onChange={e => setNotes({ ...notes, [task.id]: e.target.value })} />
                  <button className="btn primary" onClick={() => act(() => api.resolveTask(task.id, notes[task.id] ?? ''), t('staff.taskClosed'))}>{t('staff.closeTask')}</button>
                </div>
              ) : <p className="resolution"><CheckCircle2 size={14} /> {task.resolution} · {task.resolvedAt && fmtShort(task.resolvedAt)}</p>}
            </article>
          ))}
        </div>
      </> : <>
        <div className="section-bar">
          <div className="seg-filter" role="tablist">{([['all', 'fAll'], ['attention', 'fAttention'], ['soon', 'fSoon']] as const).map(([v, l]) => <button key={v} role="tab" aria-selected={filter === v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{t(`staff.${l}`)}</button>)}</div>
          <label className="search"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t('staff.searchPh')} /></label>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>{t('staff.thPatient')}</th><th>{t('staff.thMri')}</th><th>{t('staff.thScreening')}</th><th>{t('staff.thEgfr')}</th><th>{t('staff.thPrep')}</th><th>{t('staff.thReport')}</th><th /></tr></thead>
            <tbody>
              {patients.map(p => (
                <tr key={p.profile.id} onClick={() => setOpenId(p.profile.id)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setOpenId(p.profile.id); }}>
                  <td><b>{p.profile.displayName}</b><small>{t('staff.age', { n: new Date().getFullYear() - p.profile.birthYear })} · {p.profile.sex === 'female' ? t('staff.sexF') : t('staff.sexM')}</small></td>
                  <td>{fmtShort(p.visit.startsAt)}<small>{t(`staff.visit.${p.visit.status}`)}{p.visit.prepViolation ? ` · ${t('staff.violation')}` : ''}</small></td>
                  <td><span className={`pill ov-${p.screening?.overall ?? 'none'}`}>{p.screening ? t(`staff.overall.${p.screening.overall}`) : t('staff.noData')}</span></td>
                  <td>{p.screening?.egfr ? <b className={p.screening.egfr < 30 ? 'crit-t' : p.screening.egfr < 45 ? 'warn-t' : ''}>{p.screening.egfr}</b> : '—'}</td>
                  <td>{p.prepDone}/{p.prepTotal}</td>
                  <td>{p.reportLevel ? <span className={`pill rl-${p.reportLevel}`}>{t(`staff.rl.${p.reportLevel}`)}</span> : '—'}</td>
                  <td className="chev">›</td>
                </tr>
              ))}
              {patients.length === 0 && <tr><td colSpan={7} className="muted">{t('staff.nobody')}</td></tr>}
            </tbody>
          </table>
        </div>
      </>}

      {current && <PatientDrawer p={current} questions={data.protocol.questions} tasks={data.tasks.filter(t => t.patientId === current.profile.id)} onClose={() => setOpenId(null)} act={act} />}
    </div>
  );
}

function PatientDrawer({ p, questions, tasks, onClose, act }: { p: StaffPatient; questions: { id: string; text: string }[]; tasks: StaffTask[]; onClose: () => void; act: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const { t, lang } = useT();
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  const s = p.screening;
  const age = new Date().getFullYear() - p.profile.birthYear;
  const ob = p.profile.onboarding;
  const eventLabel = (type: string) => { const k = `staff.ev.${type}`; const v = t(k); return v === k ? type : v; };
  return (
    <div className="drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="pdrawer" role="dialog" aria-modal="true" aria-label={t('staff.drawerAria', { name: p.profile.displayName })}>
        <header>
          <div><small>{t('staff.drawerKicker')}</small><h2>{p.profile.displayName}</h2><p className="muted">{t('staff.age', { n: age })} · {p.profile.sex === 'female' ? t('staff.woman') : t('staff.man')}{p.profile.phoneMasked ? ` · ${p.profile.phoneMasked}` : ''}{p.profile.email && !p.profile.email.endsWith('clarity.local') ? ` · ${p.profile.email}` : ''}</p></div>
          <div className="no-print"><button className="btn ghost sm" onClick={() => window.print()}><Printer size={16} /> {t('staff.print')}</button><button className="icon-btn" onClick={onClose} aria-label={t('staff.close')}><X size={20} /></button></div>
        </header>
        {lang !== 'ru' && <p className="staff-lang-note no-print" lang="kk"><Info size={14} /> {t('staff.clinicalRu')}</p>}

        <section>
          <h3>{t('staff.secVisit')}</h3>
          <div className="kv"><span>{t('staff.thMri')}</span><b>{fmtDateTime(p.visit.startsAt)}</b></div>
          <div className="kv"><span>{t('staff.status')}</span><b>{t(`staff.visit.${p.visit.status}`)}{p.visit.cancelReason ? ` — ${cancelReasonLabel(p.visit.cancelReason, lang)}` : ''}</b></div>
          {ob && <div className="kv"><span>{t('staff.patientSays')}</span><b>{ob.firstMri ? t('staff.firstMri') : t('staff.notFirstMri')} · {t('staff.anxiety', { n: ob.anxiety })}{ob.concerns.length ? ` · ${t('staff.concerns', { n: ob.concerns.length })}` : ''}</b></div>}
          <div className="row-actions no-print">
            <button onClick={() => act(() => api.logCall(p.profile.id, 'подготовка'), t('staff.callLogged'))}><Phone size={15} /> {t('staff.logCall')}</button>
            {['scheduled', 'confirmed'].includes(p.visit.status) && <>
              <button onClick={() => act(() => api.outcome(p.visit.id, 'attended', false), t('staff.visitMarked'))}><UserCheck size={15} /> {t('staff.attended')}</button>
              {/* Значение по умолчанию — клиническая запись, поэтому по-русски в любом языке интерфейса. */}
              <button onClick={() => { const note = prompt(t('staff.violationPrompt'), 'Не соблюдён интервал без еды'); if (note !== null) void act(() => api.outcome(p.visit.id, 'attended', true, note), t('staff.violationSaved')); }}><TriangleAlert size={15} /> {t('staff.attendedViolation')}</button>
              <button onClick={() => act(() => api.outcome(p.visit.id, 'no_show', false), t('staff.noShowSaved'))}><UserX size={15} /> {t('staff.noShow')}</button>
            </>}
          </div>
        </section>

        <section>
          <h3>{t('staff.secScreening')} <span className={`pill ov-${s?.overall ?? 'none'}`}>{s ? t(`staff.overall.${s.overall}`) : t('staff.noData')}</span></h3>
          <table className="qa">
            <tbody>
              {questions.filter(q => p.answers[q.id]).map(q => <tr key={q.id} className={p.answers[q.id] !== 'no' ? 'flag' : ''}><td lang="ru">{q.text}</td><td><b>{t(`staff.ans.${p.answers[q.id]}`)}</b></td></tr>)}
              {Object.keys(p.answers).length === 0 && <tr><td colSpan={2} className="muted">{t('staff.notFilled')}</td></tr>}
            </tbody>
          </table>
          <div className="kv"><span>{t('staff.creatinine')}</span><b>{p.lab.status === 'provided' ? `${t('staff.labValue', { v: p.lab.creatinineUmolL ?? '', date: p.lab.takenOn ?? '' })}${s?.labAgeDays !== undefined ? ` (${t('staff.labAge', { n: s.labAgeDays })})` : ''}` : p.lab.status === 'none' ? t('staff.labNone') : t('staff.labUnknown')}</b></div>
          {s?.egfr !== undefined && <div className="kv"><span>{t('staff.egfr')}</span><b className={s.egfr < 30 ? 'crit-t' : s.egfr < 45 ? 'warn-t' : ''}>{s.egfr} {t('staff.egfrUnit')}</b></div>}
          {s && s.flags.length > 0 && <ul className="flags" lang="ru">{s.flags.map(f => <li key={f.id} className={`sev-${f.severity}`}><b>{f.title}</b><span>{f.staffText}</span></li>)}</ul>}
        </section>

        <section>
          <h3>{t('staff.secPrep')}</h3>
          <div className="kv"><span>{t('staff.plan')}</span><b>{t('staff.planDone', { done: p.prepDone, total: p.prepTotal })}</b></div>
          <div className="kv"><span>{t('staff.reminders')}</span><b>{p.reminderPlan ? t(`staff.rem.${p.reminderPlan}`) : t('staff.remNotSet')}</b></div>
          <div className="kv"><span>{t('staff.dayOf')}</span><b>{p.dayOfCheck ? (p.dayOfCheck.ok ? t('staff.dayOk') : p.dayOfCheck.issues.join('; ')) : t('staff.dayNotDone')}</b></div>
        </section>

        {p.report && <section>
          <h3><FileText size={16} /> {t('staff.secReport')} <span className={`pill rl-${p.report.level}`}>{p.report.level === 'follow_up' ? t('staff.rlLong.follow_up') : t(`staff.rl.${p.report.level}`)}</span></h3>
          {p.report.redFlags.length > 0 && <div className="chips">{p.report.redFlags.map(f => <span key={f.id} className={`chip lvl-${f.level}`}>«{f.phrase}» → {specialtyLabel(f.specialty, lang)}</span>)}</div>}
          <blockquote lang="ru">{p.report.sentences.map(x => x.text).join(' ')}</blockquote>
          {p.bookings.map(b => <div key={b.id} className="kv"><span>{t('staff.booking')}</span><b>{specialtyLabel(b.specialty, lang)}, {fmtShort(b.startsAt)} · {b.status === 'completed' ? t('staff.bookingDone') : t('staff.bookingBooked')}{b.status === 'booked' && <button className="btn link sm no-print" onClick={() => act(() => api.completeBooking(b.id), t('staff.consultMarked'))}>{t('staff.markDone')}</button>}</b></div>)}
        </section>}

        {tasks.length > 0 && <section>
          <h3>{t('staff.tasks')}</h3>
          {tasks.map(task => <div key={task.id} className={`mini-task ${task.status}`}><span className={`prio p-${task.priority}`}>{t(`staff.prio.${task.priority}`)}</span><div><b lang="ru">{task.title}</b><small>{task.status === 'resolved' ? t('staff.resolved', { r: task.resolution ?? '' }) : fmtShort(task.createdAt)}</small></div></div>)}
        </section>}

        <section>
          <h3>{t('staff.secHistory')}</h3>
          <ol className="timeline">{p.events.slice().reverse().map(e => <li key={e.id}><small>{fmtShort(e.at)}</small><span>{eventLabel(e.type)}</span></li>)}</ol>
        </section>
        <p className="muted small">{t('staff.summaryNote')}</p>
      </aside>
    </div>
  );
}
