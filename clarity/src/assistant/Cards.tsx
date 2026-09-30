import { useState } from 'react';
import { AlertOctagon, BellRing, BookOpen, CalendarCheck, CalendarDays, CalendarPlus, Check, ChevronDown, CircleCheck, Clock3, FileText, FlaskConical, MapPin, PencilLine, Phone, ShieldAlert, Stethoscope, TriangleAlert, Video } from 'lucide-react';
import type { Booking, Card, LabReport, PrepItem, ReportExplanation, ScreeningResult, Slot, Visit, Reminder, ReminderPlan } from '../../shared/types';
import { specialtyLabel } from '../../shared/i18n';
import { api, fmtDate, fmtDateTime, fmtShort, fmtTime } from '../api';
import { useClarity } from '../state';
import { useT } from '../i18n';
import { LevelBanner, StatusChip, fmtValue, labDate } from '../patient/docs/labs';
import { setDocsIntent } from '../patient/docs/upload';

const OVERALL_TONE: Record<ScreeningResult['overall'], string> = { incomplete: 'muted', ready: 'ok', needs_review: 'warn', hold_for_review: 'crit' };

export function ScreeningSummary({ result }: { result: ScreeningResult }) {
  const { t } = useT();
  const tone = OVERALL_TONE[result.overall];
  return (
    <div className="c-card">
      <div className="c-head"><ShieldAlert size={16} /> {t('cards.screeningTitle')}</div>
      <div className={`c-status tone-${tone}`}>{tone === 'ok' ? <CircleCheck size={16} /> : <TriangleAlert size={16} />}{t(`cards.overall_${result.overall}`)}</div>
      {result.egfr !== undefined && <div className="c-row"><span>{t('cards.egfr')}</span><b>≈ {result.egfr}</b></div>}
      {result.labAgeDays !== undefined && <div className="c-row"><span>{t('cards.labAge')}</span><b>{t('cards.labAgeDays', { n: result.labAgeDays })}</b></div>}
      {result.flags.length > 0 && <ul className="c-flags">{result.flags.map(f => <li key={f.id} className={`sev-${f.severity}`}><b>{f.title}</b><span>{f.patientText}</span></li>)}</ul>}
      <p className="c-foot">{t('cards.screeningFoot', { version: result.protocolVersion })}</p>
    </div>
  );
}

const PHASES: PrepItem['phase'][] = ['before_3d', 'before_1d', 'day_of', 'after'];

export function PrepPlan({ items, checked, compact = false }: { items: PrepItem[]; checked: string[]; compact?: boolean }) {
  const { run } = useClarity();
  const { t } = useT();
  const done = items.filter(i => checked.includes(i.id)).length;
  return (
    <div className={`c-card ${compact ? 'compact' : ''}`}>
      <div className="c-head"><BookOpen size={16} /> {t('cards.prepTitle')} <span className="c-count">{done}/{items.length}</span></div>
      <div className="c-bar"><i style={{ width: `${(done / Math.max(1, items.length)) * 100}%` }} /></div>
      {PHASES.map(phase => {
        const list = items.filter(i => i.phase === phase);
        if (!list.length) return null;
        return (
          <div key={phase} className="c-phase">
            <div className="c-phase-label">{t(`cards.phase_${phase}`)}</div>
            {list.map(item => {
              const on = checked.includes(item.id);
              return (
                <button key={item.id} className={`c-check ${on ? 'on' : ''}`} onClick={() => run(() => api.prep(item.id, !on))} aria-pressed={on}>
                  <span className="c-box">{on && <Check size={13} />}</span>
                  <span className="c-check-text"><b>{item.title}{item.personal && <em>{t('cards.personal')}</em>}{item.critical && <em className="crit">{t('cards.critical')}</em>}</b>{!compact && <small>{item.detail}</small>}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const KIND_ICON: Record<Reminder['kind'], string> = { labs_docs: '🧪', prep_day_before: '🌙', leave_home: '🚗', confirm_visit: '✅' };

export function Reminders({ reminders, plan }: { reminders: Reminder[]; plan: ReminderPlan }) {
  const { showToast } = useClarity();
  const { t } = useT();
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const ask = async () => {
    if (typeof Notification === 'undefined') { showToast(t('cards.notifUnsupported')); return; }
    const p = await Notification.requestPermission();
    setPerm(p);
    showToast(p === 'granted' ? t('cards.notifOn') : t('cards.notifDenied'));
  };
  return (
    <div className="c-card">
      <div className="c-head"><BellRing size={16} /> {plan === 'none' ? t('cards.remindersOff') : t('cards.remindersTitle')}</div>
      <ul className="c-reminders">
        {reminders.map(r => (
          <li key={r.id} className={r.deliveredAt ? 'sent' : ''}>
            <span className="c-emoji" aria-hidden>{KIND_ICON[r.kind]}</span>
            <div><b>{r.title}</b><small>{fmtShort(r.dueAt)} · {r.deliveredAt ? t('cards.delivered') : t('cards.scheduled')}</small></div>
          </li>
        ))}
      </ul>
      <div className="c-actions">
        <a className="c-btn" href={api.icsUrl} download><CalendarPlus size={15} /> {t('cards.toCalendar')}</a>
        {perm !== 'granted' && perm !== 'unsupported' && <button className="c-btn ghost" onClick={ask}><BellRing size={15} /> {t('cards.enableNotifications')}</button>}
      </div>
    </div>
  );
}

const LEVEL_TONE: Record<ReportExplanation['level'], string> = { routine: 'ok', follow_up: 'warn', urgent: 'crit' };

export function ReportCard({ report }: { report: ReportExplanation }) {
  const { t, lang } = useT();
  const [open, setOpen] = useState<number | null>(null);
  const tone = LEVEL_TONE[report.level];
  const spec = report.recommendedSpecialtyLabel ?? specialtyLabel(report.recommendedSpecialty, lang);
  return (
    <div className="c-card report">
      <div className="c-head"><FileText size={16} /> {t('cards.reportTitle')}</div>
      <div className={`c-status tone-${tone}`}>{tone === 'ok' ? <CircleCheck size={16} /> : tone === 'crit' ? <AlertOctagon size={16} /> : <TriangleAlert size={16} />}{t(`cards.level_${report.level}`)}{spec && report.level !== 'routine' ? ` · ${spec}` : ''}</div>
      {report.redFlags.length > 0 && <div className="c-chips">{report.redFlags.map(f => <span key={f.id} className={`chip lvl-${f.level}`} title={f.explanation}>«{f.phrase}»</span>)}</div>}
      <ol className="c-sentences">
        {report.sentences.map((s, i) => {
          const flagged = report.redFlags.some(f => f.sentence === s.text);
          return (
            <li key={i} className={flagged ? 'flagged' : s.negated ? 'negated' : ''}>
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} title={s.terms.length > 0 ? t('cards.showTerms') : undefined}>
                <span className="orig">{s.text}</span>
                <span className="plain">{s.plain}</span>
                {s.terms.length > 0 && <ChevronDown size={14} className={open === i ? 'rot' : ''} />}
              </button>
              {open === i && s.terms.length > 0 && <dl>{s.terms.map(term => <div key={term.term}><dt>{term.term}</dt><dd>{term.plain}</dd></div>)}</dl>}
            </li>
          );
        })}
      </ol>
      <div className="c-sub">{t('cards.doctorQuestions')}</div>
      <ul className="c-questions">{report.doctorQuestions.map(q => <li key={q}>{q}</li>)}</ul>
      <p className="c-disclaimer"><Stethoscope size={14} /> {report.disclaimer} {report.summaryBy === 'llm' ? t('cards.byLlm') : t('cards.byRules')}</p>
    </div>
  );
}

export function Slots({ specialty, slots }: { specialty: string; slots: Slot[] }) {
  const { send, busy } = useClarity();
  const { t, lang } = useT();
  return (
    <div className="c-card">
      <div className="c-head"><CalendarDays size={16} /> {t('cards.slotsTitle', { specialty: specialtyLabel(specialty, lang) })}</div>
      <div className="c-slots">
        {slots.map(s => (
          <button key={s.id} disabled={busy} onClick={() => send({ action: { type: 'slot_pick', slotId: s.id } })}>
            <b>{fmtDate(s.startsAt)}</b>
            <span>{fmtTime(s.startsAt)} · {s.format === 'online' ? <><Video size={12} /> {t('cards.online')}</> : <><MapPin size={12} /> {t('cards.inClinic')}</>}</span>
            <small>{s.doctor}</small>
          </button>
        ))}
      </div>
      <p className="c-foot">{t('cards.slotsFoot')}</p>
    </div>
  );
}

export function BookingCard({ booking }: { booking: Booking }) {
  const { t } = useT();
  return (
    <div className="c-card ok">
      <div className="c-head"><CalendarCheck size={16} /> {t('cards.bookedTitle')}</div>
      <div className="c-row"><span>{t('cards.specialist')}</span><b>{booking.doctor}</b></div>
      <div className="c-row"><span>{t('cards.when')}</span><b>{fmtDateTime(booking.startsAt)}</b></div>
      <div className="c-row"><span>{t('cards.format')}</span><b>{booking.format === 'online' ? t('cards.formatOnline') : t('cards.formatClinic')}</b></div>
      <p className="c-foot">{t('cards.bookingFoot')}</p>
    </div>
  );
}

export function VisitCard({ visit }: { visit: Visit }) {
  const { t } = useT();
  return (
    <div className="c-card">
      <div className="c-head"><CalendarDays size={16} /> {visit.procedure}</div>
      <div className="c-row"><span><Clock3 size={13} /> {t('cards.when')}</span><b>{fmtDateTime(visit.startsAt)}</b></div>
      <div className="c-row"><span><MapPin size={13} /> {t('cards.where')}</span><b>{visit.clinic}, {visit.city}</b></div>
      <div className="c-row"><span>{t('cards.status')}</span><b>{t(`cards.visit_${visit.status}`)}</b></div>
    </div>
  );
}

export function Emergency() {
  const { t } = useT();
  return (
    <div className="c-card emergency" role="alert">
      <div className="c-head"><AlertOctagon size={16} /> {t('cards.emergencyTitle')}</div>
      <div className="c-actions">
        <a className="c-btn danger" href="tel:103"><Phone size={15} /> {t('cards.ambulance')}</a>
        <a className="c-btn danger ghost" href="tel:112"><Phone size={15} /> 112</a>
      </div>
    </div>
  );
}

export function CardView({ card }: { card: Card }) {
  switch (card.type) {
    case 'screening_summary': return <ScreeningSummary result={card.result} />;
    case 'prep_plan': return <LivePrep />;
    case 'reminders': return <Reminders reminders={card.reminders} plan={card.plan} />;
    case 'report': return <ReportCard report={card.report} />;
    case 'slots': return <Slots specialty={card.specialty} slots={card.slots} />;
    case 'booking': return <BookingCard booking={card.booking} />;
    case 'visit': return <VisitCard visit={card.visit} />;
    case 'emergency': return <Emergency />;
    case 'sources': return <Sources items={card.items} />;
    case 'lab_report': return <LabReportCard report={card.report} />;
  }
}

/** Анализы в чате: компактно — уровень и показатели вне референса. */
export function LabReportCard({ report }: { report: LabReport }) {
  const { closeAssistant, state } = useClarity();
  const { t } = useT();
  // Берём актуальную версию из состояния (после подтверждения/удаления).
  const r = state?.journey.labReports?.find(x => x.id === report.id) ?? report;
  const off = r.items.filter(i => i.status !== 'normal');
  const shown = off.slice(0, 4);
  const openDocs = () => {
    setDocsIntent(r.confirmed ? { tab: 'labs', viewId: r.id } : { tab: 'labs', draft: r });
    closeAssistant();
    location.hash = '#/documents';
  };
  return (
    <div className="c-card lab-card">
      <div className="c-head"><FlaskConical size={16} /> {t('docs.cardTitle', { date: labDate(r) })} <span className="c-count">{t('docs.itemsCount', { n: r.items.length })}</span></div>
      {!r.confirmed ? <div className="c-status tone-warn"><PencilLine size={16} />{t('docs.cardNeedsReview')}</div>
        : r.analysis ? <LevelBanner level={r.analysis.level} compact /> : null}
      {r.confirmed && off.length === 0 && r.items.length > 0 && <p className="lab-card-ok"><CircleCheck size={15} /> {t('docs.cardAllNormal')}</p>}
      {shown.length > 0 && <ul className="lab-card-list">
        {shown.map(i => <li key={i.id}><span>{i.name}</span><b>{fmtValue(i)}</b><StatusChip status={i.status} short /></li>)}
        {off.length > shown.length && <li className="more">{t('docs.cardMore', { n: off.length - shown.length })}</li>}
      </ul>}
      <div className="c-actions">
        <button className="c-btn" onClick={openDocs}>{r.confirmed ? <FileText size={15} /> : <PencilLine size={15} />} {r.confirmed ? t('docs.cardOpen') : t('docs.cardReview')}</button>
      </div>
    </div>
  );
}

function Sources({ items }: { items: { title: string; version: string }[] }) {
  const { t } = useT();
  return <p className="c-sources">{t('cards.sources')} {items.map(i => `${i.title} (${i.version})`).join('; ')}</p>;
}

/** План подготовки в чате всегда показывает актуальные отметки. */
function LivePrep() {
  const { state } = useClarity();
  if (!state) return null;
  return <PrepPlan items={state.prepPlan} checked={state.journey.prepChecks} compact />;
}
