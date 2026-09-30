// Проверка распознанных значений: пациент сверяет с бланком и подтверждает.
import { useState } from 'react';
import { ArrowLeft, CheckCheck, Image as ImageIcon, Plus, Trash2, TriangleAlert } from 'lucide-react';
import type { LabReport } from '../../../shared/types';
import { useT } from '../../i18n';
import { StatusChip, itemToRow, newRow, rowEmpty, rowFilled, rowToItem, today, type Row } from './labs';

export interface ReviewResult { rows: Row[]; takenOn?: string }

export default function LabReview({ draft, preview, busy, onCancel, onConfirm }: {
  draft: LabReport | null; preview?: string; busy: boolean; onCancel: () => void; onConfirm: (r: ReviewResult) => void;
}) {
  const { t } = useT();
  const [rows, setRows] = useState<Row[]>(() => (draft?.items.length ? draft.items.map(itemToRow) : [newRow(), newRow(), newRow()]));
  const [takenOn, setTakenOn] = useState(draft?.takenOn ?? '');
  const [showPhoto, setShowPhoto] = useState(false);
  const [tried, setTried] = useState(false);

  const set = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => setRows(rs => (rs.length > 1 ? rs.filter(r => r.key !== key) : [newRow()]));
  const add = () => {
    const r = newRow();
    setRows(rs => [...rs, r]);
    setTimeout(() => document.getElementById(`lab-name-${r.key}`)?.focus(), 30);
  };
  const filled = rows.filter(rowFilled);
  const incomplete = rows.filter(r => !rowEmpty(r) && !rowFilled(r));
  const canConfirm = filled.length > 0 && incomplete.length === 0 && !busy;
  const submit = () => {
    setTried(true);
    if (!canConfirm) return;
    onConfirm({ rows: rows.filter(rowFilled), takenOn: takenOn || undefined });
  };

  const manual = !draft || draft.extractedBy === 'manual';
  return (
    <div className="docs-review">
      <div className="docs-step-head">
        <button className="btn sm link" onClick={onCancel}><ArrowLeft size={16} /> {t('docs.back')}</button>
        <span className="docs-step-badge">{t('docs.reviewStep')}</span>
      </div>
      <h2>{t(manual ? 'docs.manualTitle' : 'docs.reviewTitle')}</h2>
      <p className="muted">{t(manual ? 'docs.manualLead' : 'docs.reviewLead')}</p>
      {!manual && <div className="notice warn"><TriangleAlert size={20} /><div><b>{t('docs.reviewWarnTitle')}</b><p>{t('docs.reviewWarnText')}</p></div></div>}

      {preview && <div className="docs-photo-toggle">
        <button className="btn sm ghost" onClick={() => setShowPhoto(v => !v)} aria-expanded={showPhoto}><ImageIcon size={16} /> {t(showPhoto ? 'docs.hidePhoto' : 'docs.showPhoto')}</button>
        {showPhoto && <img src={preview} alt={t('docs.photoAlt')} className="docs-photo" />}
      </div>}

      <label className="docs-date">
        <span>{t('docs.takenOn')}</span>
        <input type="date" className="input" value={takenOn} max={today()} onChange={e => setTakenOn(e.target.value)} />
        <small>{t('docs.takenOnHint')}</small>
      </label>

      <div className="lab-edit" role="list">
        <div className="lab-edit-head" aria-hidden><span>{t('docs.colName')}</span><span>{t('docs.colValue')}</span><span>{t('docs.colUnit')}</span><span>{t('docs.colRef')}</span><span /></div>
        {rows.map((r, i) => {
          const bad = tried && !rowEmpty(r) && !rowFilled(r);
          const item = rowFilled(r) ? rowToItem(r, i) : null;
          return (
            <div key={r.key} className={`lab-edit-row ${bad ? 'bad' : ''}`} role="listitem">
              <label className="f-name"><span>{t('docs.colName')}</span><input id={`lab-name-${r.key}`} className="input" value={r.name} onChange={e => set(r.key, { name: e.target.value })} placeholder={i === 0 ? t('docs.phName') : undefined} /></label>
              <label className="f-value"><span>{t('docs.colValue')}</span><input className="input" inputMode="decimal" value={r.valueText} onChange={e => set(r.key, { valueText: e.target.value })} placeholder={i === 0 ? t('docs.phValue') : undefined} /></label>
              <label className="f-unit"><span>{t('docs.colUnit')}</span><input className="input" value={r.unit} onChange={e => set(r.key, { unit: e.target.value })} placeholder={i === 0 ? t('docs.phUnit') : undefined} /></label>
              <label className="f-ref"><span>{t('docs.colRef')}</span><input className="input" value={r.refText} onChange={e => set(r.key, { refText: e.target.value })} placeholder={i === 0 ? t('docs.phRef') : undefined} /></label>
              <div className="f-tools">
                {item && <StatusChip status={item.status} short />}
                <button className="lab-remove" onClick={() => remove(r.key)} aria-label={t('docs.removeRow', { name: r.name || String(i + 1) })} title={t('docs.removeRowShort')}><Trash2 size={18} /></button>
              </div>
              {bad && <p className="lab-row-err">{t('docs.rowIncomplete')}</p>}
            </div>
          );
        })}
      </div>
      <button className="btn ghost block docs-add" onClick={add}><Plus size={18} /> {t('docs.addRow')}</button>
      <p className="docs-small muted">{t('docs.refNote')}</p>

      <div className="docs-sticky-cta">
        {tried && filled.length === 0 && <p className="lab-row-err">{t('docs.needOneRow')}</p>}
        <button className="btn primary big block" onClick={submit} disabled={busy}>
          <CheckCheck size={20} /> {busy ? t('docs.analyzing') : t('docs.confirmAnalyze')}
        </button>
      </div>
    </div>
  );
}
