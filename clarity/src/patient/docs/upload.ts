// Загрузка документов: проверка файла, сжатие фото, base64 и понятные ошибки.
// Используется в разделе «Документы», в чате ассистента и в окне «Заключение».
import type { ExtractedText, LabReport } from '../../../shared/types';
import { api, ApiError } from '../../api';

export const MAX_BYTES = 10 * 1024 * 1024;
/** Исходное фото может быть больше — его всё равно уменьшаем перед отправкой. */
const MAX_RAW_IMAGE = 40 * 1024 * 1024;
const MAX_SIDE = 1600;
const JPEG_Q = 0.85;

export const ACCEPT_FILES = 'image/*,application/pdf,.pdf,.txt,text/plain';
export const ACCEPT_PHOTO = 'image/*';

export type DocKind = 'labs' | 'report';
export type DocErrCode = 'too_large' | 'bad_type' | 'read_failed' | 'pdf_no_text' | 'not_recognized' | 'llm_unavailable' | 'network' | 'empty' | 'other';

export class DocError extends Error {
  constructor(public code: DocErrCode, message = '', public mime?: string) { super(message || code); }
}

export interface UploadPayload { fileName?: string; mime: string; dataBase64?: string; text?: string }

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isText = (f: File) => f.type === 'text/plain' || /\.txt$/i.test(f.name);
const isImage = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name);

export function fileMime(f: File): string {
  if (isPdf(f)) return 'application/pdf';
  if (isText(f)) return 'text/plain';
  return f.type || 'image/jpeg';
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new DocError('read_failed'));
    r.readAsDataURL(blob);
  });
}

function readAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new DocError('read_failed'));
    r.readAsText(blob);
  });
}

const stripPrefix = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new DocError('read_failed')); };
    img.src = url;
  });
}

/** Уменьшает фото до ~1600px по длинной стороне (JPEG 0.85). Если браузер не может декодировать — null. */
async function downscale(file: File): Promise<Blob | null> {
  let img: HTMLImageElement;
  try { img = await loadImage(file); } catch { return null; }
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return null;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  // Небольшое фото в JPEG/PNG до 1.5 МБ отправляем как есть.
  if (k === 1 && file.size <= 1.5 * 1024 * 1024 && /image\/(jpeg|png|webp)/.test(file.type)) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', JPEG_Q));
}

/** Готовит файл к отправке на сервер: проверки, сжатие фото, base64 или текст. */
export async function prepareFile(file: File): Promise<UploadPayload> {
  const fileName = file.name || undefined;
  if (!file.size) throw new DocError('empty');
  if (isText(file)) {
    if (file.size > MAX_BYTES) throw new DocError('too_large');
    const text = (await readAsText(file)).trim();
    if (!text) throw new DocError('empty');
    return { fileName, mime: 'text/plain', text };
  }
  if (isPdf(file)) {
    if (file.size > MAX_BYTES) throw new DocError('too_large');
    return { fileName, mime: 'application/pdf', dataBase64: stripPrefix(await readAsDataUrl(file)) };
  }
  if (isImage(file)) {
    if (file.size > MAX_RAW_IMAGE) throw new DocError('too_large');
    const small = await downscale(file);
    const blob = small ?? file;
    if (blob.size > MAX_BYTES) throw new DocError('too_large');
    const mime = small && small !== file ? 'image/jpeg' : (file.type || 'image/jpeg');
    return { fileName, mime, dataBase64: stripPrefix(await readAsDataUrl(blob)) };
  }
  throw new DocError('bad_type');
}

/** Понятная причина ошибки распознавания. */
export function classifyError(e: unknown, mime?: string): DocError {
  if (e instanceof DocError) return e;
  if (e instanceof ApiError) {
    const m = e.message;
    const pdf = mime === 'application/pdf';
    if (e.status === 0) return new DocError('network', m, mime);
    if (e.status === 413) return new DocError('too_large', m, mime);
    if (e.status === 415) return new DocError('bad_type', m, mime);
    if (e.status === 502 || e.status === 503 || e.status === 504 || /LLM|модел|ИИ недоступ|unavailable/i.test(m)) return new DocError('llm_unavailable', m, mime);
    if (pdf && (e.status === 422 || /текст|text/i.test(m))) return new DocError('pdf_no_text', m, mime);
    if (e.status === 422 || e.status === 400) return new DocError('not_recognized', m, mime);
    return new DocError('other', m, mime);
  }
  return new DocError('other', e instanceof Error ? e.message : '', mime);
}

/** Распознать анализы: файл → черновик LabReport (ещё не подтверждён). */
export async function extractLabs(file: File): Promise<LabReport> {
  const payload = await prepareFile(file);
  try {
    const r = await api.extractDocument({ kind: 'labs', ...payload });
    if (!r.labReport) throw new DocError('not_recognized', '', payload.mime);
    return r.labReport;
  } catch (e) { throw classifyError(e, payload.mime); }
}

/** Распознать заключение: файл → текст для проверки пациентом. */
export async function extractReport(file: File): Promise<ExtractedText> {
  const payload = await prepareFile(file);
  try {
    const r = await api.extractDocument({ kind: 'report', ...payload });
    if (!r.extracted || !r.extracted.text.trim()) throw new DocError(payload.mime === 'application/pdf' ? 'pdf_no_text' : 'not_recognized', '', payload.mime);
    return r.extracted;
  } catch (e) { throw classifyError(e, payload.mime); }
}

/** Превью фото для сверки значений с бланком. */
export const previewUrl = (file: File): string | undefined => (isImage(file) ? URL.createObjectURL(file) : undefined);

// ---------- Передача черновика из чата в раздел «Документы» ----------

export interface DocsIntent { tab: DocKind; draft?: LabReport; preview?: string; viewId?: string; manual?: boolean }
let pending: DocsIntent | null = null;
const listeners = new Set<() => void>();
export function setDocsIntent(i: DocsIntent) { pending = i; listeners.forEach(l => l()); }
export function takeDocsIntent(): DocsIntent | null { const p = pending; pending = null; return p; }
export function onDocsIntent(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
