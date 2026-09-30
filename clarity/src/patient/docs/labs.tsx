// Общие элементы для анализов: статусы, разбор чисел и референсов, чипы.
import { AlertOctagon, ArrowDown, ArrowUp, Check, CircleCheck, CircleHelp, TriangleAlert } from 'lucide-react';
import type { LabAnalysis, LabItem, LabReport, LabStatus } from '../../../shared/types';
import { fmtDate } from '../../api';
import { useT } from '../../i18n';

const STATUS_ICON: Record<LabStatus, typeof Check> = {
  low: ArrowDown, high: ArrowUp, normal: Check, critical_low: AlertOctagon, critical_high: AlertOctagon, abnormal: TriangleAlert, unknown: CircleHelp,
};
export const STATUS_TONE: Record<LabStatus, 'ok' | 'warn' | 'crit' | 'muted'> = {
  normal: 'ok', low: 'warn', high: 'warn', abnormal: 'warn', critical_low: 'crit', critical_high: 'crit', unknown: 'muted',
};

/** Чип статуса: иконка + текст (не только цвет). */
export function StatusChip({ status, short = false }: { status: LabStatus; short?: boolean }) {
  const { t } = useT();
  const Icon = STATUS_ICON[status];
  return <span className={`lab-chip tone-${STATUS_TONE[status]}`}><Icon size={14} aria-hidden />{t(short ? `docs.statusShort.${status}` : `docs.status.${status}`)}</span>;
}

const LEVEL_ICON: Record<LabAnalysis['level'], typeof Check> = { ok: CircleCheck, attention: TriangleAlert, urgent: AlertOctagon };
export const LEVEL_TONE: Record<LabAnalysis['level'], 'ok' | 'warn' | 'crit'> = { ok: 'ok', attention: 'warn', urgent: 'crit' };

export function LevelBanner({ level, summary, compact = false }: { level: LabAnalysis['level']; summary?: string; compact?: boolean }) {
  const { t } = useT();
  const Icon = LEVEL_ICON[level];
  return (
    <div className={`lab-level tone-${LEVEL_TONE[level]} ${compact ? 'compact' : ''}`} role={level === 'urgent' ? 'alert' : 'status'}>
      <Icon size={compact ? 18 : 24} aria-hidden />
      <div><b>{t(`docs.level.${level}`)}</b>{summary && <p>{summary}</p>}</div>
    </div>
  );
}

export const fmtValue = (i: LabItem) => (i.value !== null && i.value !== undefined ? String(i.value).replace('.', ',') : i.valueText) + (i.unit ? ` ${i.unit}` : '');
export function fmtRef(i: LabItem): string {
  if (i.refText) return i.refText;
  const n = (x: number) => String(x).replace('.', ',');
  if (i.refLow !== undefined && i.refHigh !== undefined) return `${n(i.refLow)}–${n(i.refHigh)}`;
  if (i.refHigh !== undefined) return `< ${n(i.refHigh)}`;
  if (i.refLow !== undefined) return `> ${n(i.refLow)}`;
  return '';
}

export const labDate = (r: LabReport) => fmtDate(r.takenOn ? `${r.takenOn}T12:00:00` : r.uploadedAt);

/** Число из записи бланка: «5,4», «< 0.5», «1 250». Не число → null. */
export function parseNum(s: string): number | null {
  const v = s.trim().replace(/\s+/g, '').replace(',', '.').replace(/^[<>≤≥]=?/, '');
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  return Number(v);
}

/** Референс из записи: «3,5–5,0», «до 5», «< 5», «> 60», «от 60». */
export function parseRef(s: string): { refLow?: number; refHigh?: number } {
  const v = s.trim().replace(/,/g, '.').replace(/\s+/g, ' ');
  if (!v) return {};
  const num = '(-?\\d+(?:\\.\\d+)?)';
  let m = v.match(new RegExp(`^${num}\\s*(?:-|–|—|\\.\\.\\.?|…)\\s*${num}$`));
  if (m) return { refLow: Number(m[1]), refHigh: Number(m[2]) };
  m = v.match(new RegExp(`^(?:<|≤|<=|до|менее|дейін)\\s*${num}$`, 'i'));
  if (m) return { refHigh: Number(m[1]) };
  m = v.match(new RegExp(`^(?:>|≥|>=|от|более|бастап)\\s*${num}$`, 'i'));
  if (m) return { refLow: Number(m[1]) };
  return {};
}

export function computeStatus(value: number | null, refLow?: number, refHigh?: number, labFlag?: string): LabStatus {
  if (value === null) return labFlag ? 'abnormal' : 'unknown';
  if (refLow === undefined && refHigh === undefined) return 'unknown';
  if (refLow !== undefined && value < refLow) return 'low';
  if (refHigh !== undefined && value > refHigh) return 'high';
  return 'normal';
}

// ---------- Строки редактора ----------

export interface Row { key: string; name: string; valueText: string; unit: string; refText: string; orig?: LabItem }

let seq = 0;
export const newRow = (): Row => ({ key: `new-${Date.now()}-${seq++}`, name: '', valueText: '', unit: '', refText: '' });

export const itemToRow = (i: LabItem): Row => ({
  key: i.id, name: i.name, valueText: i.valueText || (i.value !== null ? String(i.value).replace('.', ',') : ''), unit: i.unit ?? '', refText: fmtRef(i), orig: i,
});

export function rowToItem(r: Row, idx: number): LabItem {
  const o = r.orig;
  const unchanged = o && r.name === o.name && r.valueText === itemToRow(o).valueText && r.unit === (o.unit ?? '') && r.refText === fmtRef(o);
  if (o && unchanged) return o;
  const value = parseNum(r.valueText);
  const ref = parseRef(r.refText);
  const refLow = ref.refLow ?? (o && r.refText === fmtRef(o) ? o.refLow : undefined);
  const refHigh = ref.refHigh ?? (o && r.refText === fmtRef(o) ? o.refHigh : undefined);
  return {
    id: o?.id ?? `m${idx + 1}`,
    code: o && r.name === o.name ? o.code : undefined,
    name: r.name.trim(),
    value,
    valueText: r.valueText.trim(),
    unit: r.unit.trim() || undefined,
    refLow, refHigh,
    refText: r.refText.trim() || undefined,
    labFlag: o?.labFlag,
    status: computeStatus(value, refLow, refHigh, o?.labFlag),
  };
}

export const rowFilled = (r: Row) => r.name.trim() !== '' && r.valueText.trim() !== '';
export const rowEmpty = (r: Row) => !r.name.trim() && !r.valueText.trim() && !r.unit.trim() && !r.refText.trim();

/** Текст для создания черновика при ручном вводе. */
export const rowsAsText = (rows: Row[]) => rows.filter(rowFilled).map(r => `${r.name}: ${r.valueText}${r.unit ? ` ${r.unit}` : ''}${r.refText ? ` (${r.refText})` : ''}`).join('\n');

export const today = () => new Date().toISOString().slice(0, 10);
