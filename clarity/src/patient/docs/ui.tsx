// Общие элементы раздела «Документы»: зона загрузки, «Распознаю…», ошибки, приватность.
import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Camera, ClipboardPaste, FileUp, Keyboard, LockKeyhole, RotateCcw, TriangleAlert, UploadCloud } from 'lucide-react';
import AssistantAvatar from '../../assistant/AssistantAvatar';
import { useClarity } from '../../state';
import { useT } from '../../i18n';
import { ACCEPT_FILES, ACCEPT_PHOTO, type DocError, type DocKind } from './upload';

/** Скрытые поля выбора файла: камера и файл. */
export function useFilePickers(onFile: (f: File) => void) {
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onFile(f);
  };
  const inputs = <>
    <input ref={photoRef} type="file" accept={ACCEPT_PHOTO} capture="environment" hidden onChange={pick} />
    <input ref={fileRef} type="file" accept={ACCEPT_FILES} hidden onChange={pick} />
  </>;
  return { inputs, takePhoto: () => photoRef.current?.click(), chooseFile: () => fileRef.current?.click() };
}

export function UploadZone({ kind, onFile, onManual, busy = false, extra }: { kind: DocKind; onFile: (f: File) => void; onManual: () => void; busy?: boolean; extra?: ReactNode }) {
  const { t } = useT();
  const [drag, setDrag] = useState(false);
  const { inputs, takePhoto, chooseFile } = useFilePickers(onFile);
  return (
    <div
      className={`docs-drop ${drag ? 'drag' : ''}`}
      onDragOver={e => { e.preventDefault(); if (!drag) setDrag(true); }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f && !busy) onFile(f); }}
    >
      {inputs}
      <div className="docs-drop-head">
        <span className="docs-drop-icon" aria-hidden><UploadCloud size={28} /></span>
        <div>
          <b>{t(kind === 'labs' ? 'docs.dropLabsTitle' : 'docs.dropReportTitle')}</b>
          <p>{t('docs.dropHint')}</p>
        </div>
      </div>
      <div className="docs-drop-actions">
        <button className="docs-action primary" onClick={takePhoto} disabled={busy}><Camera size={22} /><span><b>{t('docs.takePhoto')}</b><small>{t('docs.takePhotoHint')}</small></span></button>
        <button className="docs-action" onClick={chooseFile} disabled={busy}><FileUp size={22} /><span><b>{t('docs.chooseFile')}</b><small>{t('docs.chooseFileHint')}</small></span></button>
        <button className="docs-action" onClick={onManual} disabled={busy}>
          {kind === 'labs' ? <Keyboard size={22} /> : <ClipboardPaste size={22} />}
          <span><b>{t(kind === 'labs' ? 'docs.manual' : 'docs.paste')}</b><small>{t(kind === 'labs' ? 'docs.manualHint' : 'docs.pasteHint')}</small></span>
        </button>
      </div>
      {extra}
      <p className="docs-drop-foot">{t('docs.dropFoot')}</p>
    </div>
  );
}

/** «Распознаю…» — скелетон с думающим ассистентом. */
export function Recognizing({ fileName, preview, label }: { fileName?: string; preview?: string; label?: string }) {
  const { avatar, assistantName } = useClarity();
  const { t } = useT();
  return (
    <div className="docs-recognizing" role="status" aria-live="polite">
      <div className="docs-rec-head">
        <AssistantAvatar avatar={avatar} mood="thinking" thinking size={64} framing="head" className="docs-rec-avatar" showBadge={false} />
        <div>
          <b>{label ?? t('docs.recognizing')}</b>
          <p>{t('docs.recognizingHint', { name: assistantName })}</p>
          {fileName && <small className="docs-file-name">{fileName}</small>}
        </div>
      </div>
      <div className="docs-rec-body">
        {preview && <img src={preview} alt="" className="docs-rec-preview" />}
        <div className="docs-skeleton" aria-hidden>{[88, 64, 76, 52, 70].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>
      </div>
    </div>
  );
}

/** Понятная ошибка + что сделать дальше. */
export function DocErrorBox({ err, kind, onPhoto, onManual, onRetry }: { err: DocError; kind: DocKind; onPhoto?: () => void; onManual?: () => void; onRetry?: () => void }) {
  const { t } = useT();
  const title = t(`docs.err.${err.code}`);
  const hint = t(`docs.errHint.${err.code}${err.code === 'llm_unavailable' || err.code === 'not_recognized' ? `_${kind}` : ''}`);
  const detail = err.message && err.message !== err.code && err.message !== title ? err.message : '';
  return (
    <div className="docs-error" role="alert">
      <TriangleAlert size={22} aria-hidden />
      <div>
        <b>{title}</b>
        <p>{hint}</p>
        {detail && <small>{t('docs.errServer')}: {detail}</small>}
        <div className="docs-error-actions">
          {onPhoto && err.code !== 'llm_unavailable' && <button className="btn sm primary" onClick={onPhoto}><Camera size={16} /> {t('docs.takePhoto')}</button>}
          {onManual && <button className={`btn sm ${err.code === 'llm_unavailable' ? 'primary' : 'ghost'}`} onClick={onManual}>{kind === 'labs' ? <Keyboard size={16} /> : <ClipboardPaste size={16} />} {t(kind === 'labs' ? 'docs.manual' : 'docs.paste')}</button>}
          {onRetry && <button className="btn sm link" onClick={onRetry}><RotateCcw size={15} /> {t('docs.retry')}</button>}
        </div>
      </div>
    </div>
  );
}

export function PrivacyNote() {
  const { t } = useT();
  return (
    <div className="docs-privacy">
      <LockKeyhole size={18} aria-hidden />
      <p><b>{t('docs.privacyTitle')}</b> {t('docs.privacyText')}</p>
    </div>
  );
}
