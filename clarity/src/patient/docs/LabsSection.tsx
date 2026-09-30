// Раздел «Анализы»: загрузка → проверка значений → разбор; история загрузок.
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, FileText, FlaskConical, Image as ImageIcon, Keyboard, PencilLine } from 'lucide-react';
import type { LabReport } from '../../../shared/types';
import { api } from '../../api';
import { useClarity } from '../../state';
import { useT } from '../../i18n';
import type { ModalId } from '../Modals';
import LabAnalysisView from './LabAnalysisView';
import LabReview, { type ReviewResult } from './LabReview';
import { LEVEL_TONE, labDate, rowToItem, rowsAsText } from './labs';
import { DocErrorBox, Recognizing, UploadZone, useFilePickers } from './ui';
import { classifyError, extractLabs, previewUrl, type DocError } from './upload';

type Step =
  | { kind: 'idle' }
  | { kind: 'extracting'; fileName?: string; preview?: string }
  | { kind: 'review'; draft: LabReport | null; preview?: string }
  | { kind: 'view'; id: string };

export interface LabIntent { draft?: LabReport; preview?: string; viewId?: string; manual?: boolean }
const fromIntent = (i?: LabIntent | null): Step => (i?.draft || i?.manual ? { kind: 'review', draft: i.draft ?? null, preview: i.preview } : i?.viewId ? { kind: 'view', id: i.viewId } : { kind: 'idle' });

export default function LabsSection({ open, intent }: { open: (m: ModalId) => void; intent?: LabIntent | null }) {
  const { state, setState, showToast } = useClarity();
  const { t } = useT();
  const [step, setStepRaw] = useState<Step>(() => fromIntent(intent));
  const [err, setErr] = useState<DocError | null>(null);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<LabReport | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const lastFile = useRef<File | null>(null);

  const setStep = (s: Step) => { setStepRaw(s); setTimeout(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20); };
  useEffect(() => { if (intent) setStep(fromIntent(intent)); }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (file: File) => {
    lastFile.current = file;
    setErr(null);
    const preview = previewUrl(file);
    setStep({ kind: 'extracting', fileName: file.name, preview });
    try {
      const draft = await extractLabs(file);
      setStep({ kind: 'review', draft, preview });
    } catch (e) {
      setErr(classifyError(e));
      setStepRaw({ kind: 'idle' });
    }
  };
  const pickers = useFilePickers(upload);

  const confirm = async (r: ReviewResult, draft: LabReport | null) => {
    setBusy(true);
    setErr(null);
    try {
      let id = draft?.id;
      // Ручной ввод: сначала создаём черновик на сервере из текста.
      if (!id) {
        const x = await api.extractDocument({ kind: 'labs', mime: 'text/plain', fileName: undefined, text: rowsAsText(r.rows) });
        if (!x.labReport) throw new Error(t('docs.err.other'));
        id = x.labReport.id;
      }
      const res = await api.confirmLabs(id, { items: r.rows.map(rowToItem), takenOn: r.takenOn });
      setState(res.state);
      setLocal(res.labReport);
      setStep({ kind: 'view', id: res.labReport.id });
    } catch (e) {
      const de = classifyError(e);
      showToast(de.message && de.message !== de.code ? de.message : t(`docs.err.${de.code}`));
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    try {
      const s = await api.deleteLabs(id);
      setState(s);
      showToast(t('docs.deleted'));
      setStep({ kind: 'idle' });
    } catch (e) { showToast(e instanceof Error ? e.message : t('docs.err.other')); }
  };

  const reports = [...(state?.journey.labReports ?? [])].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  return (
    <div ref={top} className="docs-section">
      {pickers.inputs}
      {step.kind === 'idle' && <>
        {err && <DocErrorBox err={err} kind="labs" onPhoto={pickers.takePhoto} onManual={() => { setErr(null); setStep({ kind: 'review', draft: null }); }} onRetry={lastFile.current ? () => upload(lastFile.current!) : undefined} />}
        <UploadZone kind="labs" onFile={upload} onManual={() => { setErr(null); setStep({ kind: 'review', draft: null }); }} />
        <History reports={reports} onOpen={r => setStep(r.confirmed ? { kind: 'view', id: r.id } : { kind: 'review', draft: r })} />
      </>}
      {step.kind === 'extracting' && <Recognizing fileName={step.fileName} preview={step.preview} />}
      {step.kind === 'review' && <LabReview key={step.draft?.id ?? 'manual'} draft={step.draft} preview={step.preview} busy={busy} onCancel={() => setStep({ kind: 'idle' })} onConfirm={r => confirm(r, step.draft)} />}
      {step.kind === 'view' && (() => {
        const rep = reports.find(r => r.id === step.id) ?? (local?.id === step.id ? local : null);
        if (!rep) return <p className="muted">{t('docs.notFound')}</p>;
        return <LabAnalysisView report={rep} open={open} onBack={() => setStep({ kind: 'idle' })} onDelete={() => remove(rep.id)} />;
      })()}
    </div>
  );
}

const SRC_ICON = { image: ImageIcon, pdf: FileText, text: FileText, manual: Keyboard } as const;

function History({ reports, onOpen }: { reports: LabReport[]; onOpen: (r: LabReport) => void }) {
  const { t } = useT();
  if (!reports.length) return (
    <div className="docs-empty"><FlaskConical size={22} aria-hidden /><p>{t('docs.historyEmpty')}</p></div>
  );
  return (
    <section className="docs-history">
      <h3>{t('docs.historyTitle')}</h3>
      <ul>
        {reports.map(r => {
          const Icon = SRC_ICON[r.source] ?? FileText;
          const lvl = r.analysis?.level;
          return (
            <li key={r.id}>
              <button onClick={() => onOpen(r)}>
                <span className="docs-h-icon"><Icon size={20} aria-hidden /></span>
                <span className="docs-h-main">
                  <b>{t('docs.labsFrom', { date: labDate(r) })}</b>
                  <small>{t('docs.itemsCount', { n: r.items.length })}{r.fileName ? ` · ${r.fileName}` : ''}</small>
                </span>
                {!r.confirmed ? <span className="lab-chip tone-warn"><PencilLine size={14} aria-hidden /> {t('docs.needsReview')}</span>
                  : lvl ? <span className={`lab-chip tone-${LEVEL_TONE[lvl]}`}>{t(`docs.levelShort.${lvl}`)}</span> : null}
                <ChevronRight size={18} aria-hidden className="docs-h-chev" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
