// Раздел «Заключение врача»: файл/фото/текст → проверка текста → объяснение простыми словами.
import { useRef, useState } from 'react';
import { ArrowLeft, CalendarPlus, FilePlus2, MessageCircle, Phone, Sparkles, TriangleAlert } from 'lucide-react';
import type { AssistantAction } from '../../../shared/types';
import { specialtyLabel } from '../../../shared/i18n';
import { api, fmtDateTime } from '../../api';
import { ReportCard } from '../../assistant/Cards';
import { useClarity } from '../../state';
import { useT } from '../../i18n';
import type { ModalId } from '../Modals';
import { DocErrorBox, Recognizing, UploadZone, useFilePickers } from './ui';
import { classifyError, extractReport, previewUrl, type DocError } from './upload';

type Step =
  | { kind: 'idle' }
  | { kind: 'extracting'; fileName?: string; preview?: string }
  | { kind: 'confirm'; text: string; warning?: string; fileName?: string; preview?: string }
  | { kind: 'result' };

type Sample = Extract<AssistantAction, { type: 'report_sample' }>['sample'];
const SAMPLES: Sample[] = ['normal', 'finding', 'urgent'];

export default function ReportSection({ open }: { open: (m: ModalId) => void }) {
  const { state, run, send, openAssistant, openCall, assistantName, busy: chatBusy } = useClarity();
  const { t, lang } = useT();
  const report = state?.journey.lastReport;
  const [step, setStepRaw] = useState<Step>(() => (report ? { kind: 'result' } : { kind: 'idle' }));
  const [err, setErr] = useState<DocError | null>(null);
  const [busy, setBusy] = useState(false);
  const [calling, setCalling] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const lastFile = useRef<File | null>(null);
  const setStep = (s: Step) => { setStepRaw(s); setTimeout(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20); };

  const upload = async (file: File) => {
    lastFile.current = file;
    setErr(null);
    const preview = previewUrl(file);
    setStep({ kind: 'extracting', fileName: file.name, preview });
    try {
      const x = await extractReport(file);
      setStep({ kind: 'confirm', text: x.text, warning: x.warning, fileName: x.fileName ?? file.name, preview });
    } catch (e) {
      setErr(classifyError(e));
      setStepRaw({ kind: 'idle' });
    }
  };
  const pickers = useFilePickers(upload);

  const explain = async (text: string) => {
    setBusy(true);
    const r = await run(() => api.report(text).then(x => x.state));
    setBusy(false);
    if (r) setStep({ kind: 'result' });
  };
  const sample = async (s: Sample) => {
    setBusy(true);
    await send({ action: { type: 'report_sample', sample: s } }, { silent: true });
    setBusy(false);
    setStep({ kind: 'result' });
  };
  const voice = async () => {
    setCalling(true);
    await send({ action: { type: 'report_uploaded' } }, { silent: true });
    setCalling(false);
    openCall();
  };

  const samples = (
    <div className="docs-samples">
      <span>{t('docs.samplesLabel')}</span>
      {SAMPLES.map(s => <button key={s} className="btn sm ghost" disabled={busy || chatBusy} onClick={() => sample(s)}>{t(`docs.sample.${s}`)}</button>)}
    </div>
  );

  return (
    <div ref={top} className="docs-section">
      {pickers.inputs}
      {step.kind === 'idle' && <>
        {err && <DocErrorBox err={err} kind="report" onPhoto={pickers.takePhoto} onManual={() => { setErr(null); setStep({ kind: 'confirm', text: '' }); }} onRetry={lastFile.current ? () => upload(lastFile.current!) : undefined} />}
        <UploadZone kind="report" onFile={upload} onManual={() => { setErr(null); setStep({ kind: 'confirm', text: '' }); }} busy={busy} extra={samples} />
        {report && <button className="btn link" onClick={() => setStep({ kind: 'result' })}>{t('docs.showLastReport')}</button>}
      </>}

      {step.kind === 'extracting' && <Recognizing fileName={step.fileName} preview={step.preview} label={t('docs.readingText')} />}

      {step.kind === 'confirm' && <ConfirmText step={step} busy={busy} onBack={() => setStep({ kind: 'idle' })} onExplain={explain} />}

      {step.kind === 'result' && report && <>
        <div className="docs-step-head">
          <button className="btn sm link" onClick={() => setStep({ kind: 'idle' })}><FilePlus2 size={16} /> {t('docs.newReport')}</button>
          <span className="docs-step-badge">{fmtDateTime(report.createdAt)}</span>
        </div>
        {report.level !== 'routine' && (
          <div className={`notice ${report.level === 'urgent' ? 'crit' : 'warn'}`} role={report.level === 'urgent' ? 'alert' : undefined}>
            <TriangleAlert size={20} />
            <div>
              <b>{report.level === 'urgent' ? t('docs.repUrgent') : t('docs.repConsult', { spec: report.recommendedSpecialtyLabel ?? specialtyLabel(report.recommendedSpecialty, lang) })}</b>
              <p>{t('docs.notDiagnosis')}</p>
              <button className="btn primary docs-notice-btn" onClick={() => open('booking')}><CalendarPlus size={18} /> {t('docs.bookNow')}</button>
            </div>
          </div>
        )}
        <ReportCard report={report} />
        <div className="docs-cta-grid">
          <button className="btn primary big" onClick={() => openAssistant({ type: 'report_uploaded' })}><MessageCircle size={19} /> {t('docs.askReport')}</button>
          <button className="btn voice big" onClick={voice} disabled={calling || chatBusy}><Phone size={19} /> {calling ? t('docs.connecting') : t('docs.discussVoice')}</button>
        </div>
        <p className="docs-small muted">{t('docs.askHint', { name: assistantName })}</p>
      </>}
      {step.kind === 'result' && !report && <p className="muted">{t('docs.notFound')} <button className="btn link" onClick={() => setStep({ kind: 'idle' })}>{t('docs.back')}</button></p>}
    </div>
  );
}

function ConfirmText({ step, busy, onBack, onExplain }: { step: Extract<Step, { kind: 'confirm' }>; busy: boolean; onBack: () => void; onExplain: (text: string) => void }) {
  const { t } = useT();
  const [text, setText] = useState(step.text);
  const [showPhoto, setShowPhoto] = useState(false);
  const recognized = step.text.trim().length > 0;
  return (
    <div className="docs-review">
      <div className="docs-step-head">
        <button className="btn sm link" onClick={onBack}><ArrowLeft size={16} /> {t('docs.back')}</button>
        <span className="docs-step-badge">{t('docs.reviewStep')}</span>
      </div>
      <h2>{t(recognized ? 'docs.textReviewTitle' : 'docs.pasteTitle')}</h2>
      <p className="muted">{t(recognized ? 'docs.textReviewLead' : 'docs.pasteLead')}</p>
      {step.warning && <div className="notice warn"><TriangleAlert size={20} /><div><p>{step.warning}</p></div></div>}
      {step.preview && <div className="docs-photo-toggle">
        <button className="btn sm ghost" onClick={() => setShowPhoto(v => !v)} aria-expanded={showPhoto}>{t(showPhoto ? 'docs.hidePhoto' : 'docs.showPhoto')}</button>
        {showPhoto && <img src={step.preview} alt={t('docs.photoAlt')} className="docs-photo" />}
      </div>}
      <textarea className="input docs-textarea" rows={10} value={text} onChange={e => setText(e.target.value)} placeholder={t('docs.pastePh')} maxLength={6000} autoFocus={!recognized} aria-label={t('docs.textAria')} />
      <p className="docs-small muted">{t('docs.chars', { n: text.length })}</p>
      <div className="docs-sticky-cta">
        <button className="btn primary big block" disabled={text.trim().length < 10 || busy} onClick={() => onExplain(text.trim())}><Sparkles size={19} /> {busy ? t('docs.explaining') : t('docs.explain')}</button>
      </div>
    </div>
  );
}
