// Разбор подтверждённых анализов: уровень внимания, показатели, МРТ, рекомендации.
import { useEffect, useState } from 'react';
import { ArrowLeft, Brain, CalendarPlus, Check, ChevronDown, MessageCircle, Phone, Stethoscope, Trash2 } from 'lucide-react';
import type { LabReport } from '../../../shared/types';
import { specialtyLabel } from '../../../shared/i18n';
import { useClarity } from '../../state';
import { useT } from '../../i18n';
import type { ModalId } from '../Modals';
import { LevelBanner, StatusChip, fmtRef, fmtValue, labDate } from './labs';

const doneKey = (id: string) => `clarity-lab-recs-${id}`;
const readDone = (id: string): number[] => { try { return JSON.parse(localStorage.getItem(doneKey(id)) ?? '[]'); } catch { return []; } };

export default function LabAnalysisView({ report, onBack, onDelete, open }: { report: LabReport; onBack: () => void; onDelete: () => void; open: (m: ModalId) => void }) {
  const { openAssistant, openCall, send, assistantName, busy } = useClarity();
  const { t, lang } = useT();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [done, setDone] = useState<number[]>(() => readDone(report.id));
  const [confirmDel, setConfirmDel] = useState(false);
  const [calling, setCalling] = useState(false);
  useEffect(() => { setDone(readDone(report.id)); }, [report.id]);
  const a = report.analysis;
  const toggleDone = (i: number) => {
    const next = done.includes(i) ? done.filter(x => x !== i) : [...done, i];
    setDone(next);
    try { localStorage.setItem(doneKey(report.id), JSON.stringify(next)); } catch { /* ignore */ }
  };
  const voice = async () => {
    setCalling(true);
    await send({ action: { type: 'lab_uploaded', labId: report.id } }, { silent: true });
    setCalling(false);
    openCall();
  };
  const spec = a?.recommendedSpecialtyLabel ?? (a?.recommendedSpecialty ? specialtyLabel(a.recommendedSpecialty, lang) : '');
  const sorted = [...report.items].sort((x, y) => rank(x.status) - rank(y.status));

  return (
    <div className="docs-analysis">
      <div className="docs-step-head">
        <button className="btn sm link" onClick={onBack}><ArrowLeft size={16} /> {t('docs.allLabs')}</button>
        <span className="docs-step-badge">{t('docs.labsFrom', { date: labDate(report) })}</span>
      </div>

      {a ? <LevelBanner level={a.level} summary={a.summary} /> : <div className="notice info"><div><b>{t('docs.noAnalysis')}</b></div></div>}

      <section className="docs-block">
        <h3>{t('docs.itemsTitle', { n: report.items.length })}</h3>
        <ul className="lab-list">
          {sorted.map(item => {
            const ex = a?.items.find(x => x.itemId === item.id);
            const isOpen = expanded === item.id;
            const ref = fmtRef(item);
            return (
              <li key={item.id} className={`lab-row st-${item.status}`}>
                <button className="lab-row-main" onClick={() => setExpanded(isOpen ? null : item.id)} aria-expanded={isOpen} disabled={!ex}>
                  <span className="lab-row-name">
                    <b>{ex?.title ?? item.name}</b>
                    {ex?.title && ex.title !== item.name && <small>{item.name}</small>}
                  </span>
                  <span className="lab-row-val">
                    <b>{fmtValue(item)}</b>
                    <small>{ref ? t('docs.refShort', { ref }) : t('docs.noRef')}</small>
                  </span>
                  <span className="lab-row-status">
                    <StatusChip status={item.status} />
                    {ex?.mriRelevant && <span className="lab-mri-tag"><Brain size={13} /> {t('docs.mriTag')}</span>}
                  </span>
                  {ex && <ChevronDown size={18} className={`lab-row-chev ${isOpen ? 'rot' : ''}`} aria-hidden />}
                </button>
                {isOpen && ex && (
                  <div className="lab-row-more">
                    <p><b>{t('docs.whatIsIt')}</b> {ex.plain}</p>
                    <p><b>{t('docs.yourResult')}</b> {ex.statusText}</p>
                    <p><b>{t('docs.whatToDo')}</b> {ex.advice}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="docs-small muted">{t('docs.tapForMore')}</p>
      </section>

      {a?.mri && (
        <section className={`docs-mri ${a.mri.appliedToScreening ? 'applied' : ''}`}>
          <div className="docs-mri-head"><Brain size={20} aria-hidden /><b>{t('docs.mriTitle')}</b></div>
          <div className="docs-mri-grid">
            {a.mri.creatinineUmolL !== undefined && <div><small>{t('docs.creatinine')}</small><b>{a.mri.creatinineUmolL} {t('docs.umol')}</b></div>}
            {a.mri.egfr !== undefined && <div><small>{t('docs.egfr')}</small><b>≈ {a.mri.egfr}</b></div>}
          </div>
          <p>{a.mri.appliedToScreening ? <><Check size={15} aria-hidden /> {t('docs.mriApplied')}</> : t('docs.mriNotApplied')}</p>
          <button className="btn sm link" onClick={() => open('screening')}>{t('docs.openScreening')}</button>
        </section>
      )}

      {a && a.recommendations.length > 0 && (
        <section className="docs-block">
          <h3>{t('docs.recsTitle')}</h3>
          <ol className="docs-checklist">
            {a.recommendations.map((r, i) => (
              <li key={i}>
                <button className={done.includes(i) ? 'on' : ''} onClick={() => toggleDone(i)} aria-pressed={done.includes(i)}>
                  <span className="docs-check-num">{done.includes(i) ? <Check size={16} /> : i + 1}</span>
                  <span>{r}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {a && a.doctorQuestions.length > 0 && (
        <section className="docs-block">
          <h3>{t('docs.questionsTitle')}</h3>
          <ul className="docs-questions">{a.doctorQuestions.map(q => <li key={q}><MessageCircle size={16} aria-hidden /> <span>{q}</span></li>)}</ul>
        </section>
      )}

      {spec && a?.level !== 'ok' && (
        <div className={`notice ${a?.level === 'urgent' ? 'crit' : 'warn'}`}>
          <Stethoscope size={20} />
          <div><b>{t('docs.specRecommended', { spec })}</b><p>{t('docs.notDiagnosis')}</p></div>
        </div>
      )}

      <div className="docs-cta-grid">
        <button className="btn primary big" onClick={() => openAssistant({ type: 'lab_uploaded', labId: report.id })}><MessageCircle size={19} /> {t('docs.askName', { name: assistantName })}</button>
        <button className="btn voice big" onClick={voice} disabled={calling || busy}><Phone size={19} /> {calling ? t('docs.connecting') : t('docs.discussVoice')}</button>
        {spec && <button className="btn ghost big" onClick={() => open('booking')}><CalendarPlus size={19} /> {t('docs.bookSpec', { spec })}</button>}
      </div>

      {a && <p className="c-disclaimer docs-disclaimer"><Stethoscope size={14} /> {a.disclaimer} {a.summaryBy === 'llm' ? t('docs.byLlm') : t('docs.byRules')}</p>}

      <div className="docs-danger">
        {!confirmDel ? <button className="btn sm link danger" onClick={() => setConfirmDel(true)}><Trash2 size={16} /> {t('docs.delete')}</button> : (
          <div className="docs-confirm-del" role="alertdialog" aria-label={t('docs.deleteAsk')}>
            <span>{t('docs.deleteAsk')}</span>
            <button className="btn sm ghost" onClick={() => setConfirmDel(false)}>{t('docs.cancel')}</button>
            <button className="btn sm danger-solid" onClick={onDelete}><Trash2 size={15} /> {t('docs.deleteYes')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

const ORDER = ['critical_high', 'critical_low', 'high', 'low', 'abnormal', 'unknown', 'normal'];
const rank = (s: string) => { const i = ORDER.indexOf(s); return i < 0 ? 99 : i; };
