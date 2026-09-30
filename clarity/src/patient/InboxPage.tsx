import { useState } from 'react';
import { AlertOctagon, CheckCircle2, Clock3, Send, UserRound } from 'lucide-react';
import { api, fmtShort } from '../api';
import { useT } from '../i18n';
import { useClarity } from '../state';
import { useNameVars } from './Home';
import type { ModalId } from './Modals';

const KINDS = ['screening_review', 'labs_missing', 'patient_question', 'report_follow_up', 'callback'];

export default function InboxPage({ open }: { open: (m: ModalId) => void }) {
  const { state, run, lang } = useClarity();
  const { t } = useT();
  const nv = useNameVars();
  const [text, setText] = useState('');
  if (!state) return null;
  const p = (k: string, vars?: Record<string, string | number>) => t(`patient.${k}`, { ...nv, ...vars });
  const kindLabel = (k: string) => (KINDS.includes(k) ? p(`kind_${k}`) : k);
  // Тексты задач для персонала хранятся на русском — в казахском интерфейсе показываем понятное пояснение по типу.
  const taskText = (kind: string, title: string, details?: string) =>
    kind === 'patient_question' ? details ?? title : lang === 'kk' && KINDS.includes(kind) ? p(`kindText_${kind}`) : title;
  return (
    <div className="page narrow">
      <div className="page-head"><div><h1>{p('inboxTitle')}</h1><p className="muted">{p('inboxSubtitle')}</p></div></div>

      <section className="card pz-card pz-enter">
        <h2 className="card-title">{p('inboxAsk')}</h2>
        <textarea className="input" rows={3} aria-label={p('inboxAsk')} value={text} onChange={e => setText(e.target.value)} placeholder={p('inboxPlaceholder')} maxLength={1000} />
        <div className="card-actions">
          <button className="btn primary" disabled={!text.trim()} onClick={() => run(() => api.question(text.trim()), p('inboxSent')).then(() => setText(''))}><Send size={17} /> {t('common.send')}</button>
          <span className="muted small">{p('inboxHours')}</span>
        </div>
      </section>

      <h2 className="section-title">{p('inboxInWork', { n: state.openTasks.length })}</h2>
      {state.openTasks.length === 0 ? <div className="notice ok"><CheckCircle2 size={20} /><div><b>{p('inboxEmptyTitle')}</b><p>{p('inboxEmptyText')}</p></div></div> :
        <div className="list">{state.openTasks.map(task => (
          <div key={task.id} className={`list-item ${task.priority}`}>
            <span className="li-ico">{task.priority === 'urgent' ? <AlertOctagon size={20} /> : <Clock3 size={20} />}</span>
            <div><b>{kindLabel(task.kind)}</b><p>{taskText(task.kind, task.title, task.details)}</p><small>{fmtShort(task.createdAt)} · {task.priority === 'urgent' ? p('inboxUrgent') : p('inboxWillContact')}</small></div>
          </div>
        ))}</div>}

      <section className="card row-card">
        <UserRound size={22} />
        <div><b>{p('inboxConsultTitle')}</b><p className="muted">{p('inboxConsultText')}</p></div>
        <button className="btn ghost" onClick={() => open('booking')}>{p('inboxConsultCta')}</button>
      </section>
    </div>
  );
}
