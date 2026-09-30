// Детерминированный анализ подтверждённых пациентом значений.
// Статус — ТОЛЬКО по референсу из бланка лаборатории (или по отметке лаборатории H/L/↑/↓).
// Справочные «критические» значения используются лишь для совета связаться с врачом сегодня.
// Никаких диагнозов: тексты — «может встречаться при…, оценивает врач».

import type { LabAnalysis, LabExplanationItem, LabItem, LabStatus, PatientProfile } from '../../shared/types';
import { specialtyLabel, type Lang } from '../../shared/i18n';
import { PROTOCOL } from '../domain/protocol';
import { egfrCkdEpi2021 } from '../domain/screening';
import { analyteByCode, canonicalValue } from './labsCatalog';
import { normalizeFlag } from './labParser';
import { analyteText, labsTexts } from './labTexts';

const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export const fmtNum = (n: number) => String(n).replace('.', ',');

export const OUT_OF_RANGE: LabStatus[] = ['low', 'high', 'abnormal'];
export const isCritical = (s: LabStatus) => s === 'critical_low' || s === 'critical_high';

export function computeStatus(item: Pick<LabItem, 'code' | 'value' | 'valueText' | 'unit' | 'refLow' | 'refHigh' | 'refText' | 'labFlag'>): LabStatus {
  const v = item.value;
  const hasRange = item.refLow !== undefined || item.refHigh !== undefined;
  let status: LabStatus = 'unknown';
  if (v !== null && v !== undefined && hasRange) {
    if (item.refLow !== undefined && v < item.refLow) status = 'low';
    else if (item.refHigh !== undefined && v > item.refHigh) status = 'high';
    else status = 'normal';
  } else if ((v === null || v === undefined) && item.refText && norm(item.valueText) && norm(item.valueText) === norm(item.refText)) {
    status = 'normal';
  }
  // Отметка лаборатории имеет приоритет: она учитывает их собственные правила.
  const flag = normalizeFlag(item.labFlag);
  if (flag === 'H') status = 'high';
  else if (flag === 'L') status = 'low';
  else if (flag === '*' && (status === 'normal' || status === 'unknown')) status = 'abnormal';
  // Общепринятые «панические» значения — повод связаться с врачом сегодня.
  const a = analyteByCode(item.code);
  if (a?.critical) {
    const c = canonicalValue(a.code, v, item.unit);
    if (c !== undefined) {
      if (a.critical.high !== undefined && c > a.critical.high) status = 'critical_high';
      else if (a.critical.low !== undefined && c < a.critical.low) status = 'critical_low';
    }
  }
  return status;
}

export function refString(item: Pick<LabItem, 'refLow' | 'refHigh' | 'refText'>): string | undefined {
  if (item.refText?.trim()) return item.refText.trim();
  if (item.refLow !== undefined && item.refHigh !== undefined) return `${fmtNum(item.refLow)}–${fmtNum(item.refHigh)}`;
  if (item.refHigh !== undefined) return `< ${fmtNum(item.refHigh)}`;
  if (item.refLow !== undefined) return `> ${fmtNum(item.refLow)}`;
  return undefined;
}

export const itemTitle = (item: Pick<LabItem, 'code' | 'name'>, lang: Lang) => analyteText(item.code, lang)?.title ?? item.name;
export const itemValue = (item: Pick<LabItem, 'valueText' | 'unit'>) => `${item.valueText}${item.unit ? ` ${item.unit}` : ''}`;

export function explainItem(item: LabItem, lang: Lang): LabExplanationItem {
  const T = labsTexts(lang);
  const a = analyteByCode(item.code);
  const txt = analyteText(item.code, lang);
  const ref = refString(item);
  const s = item.status;
  const statusText = s === 'normal' ? T.status.normal(ref ?? '') : s === 'high' ? T.status.high(ref) : s === 'low' ? T.status.low(ref) : s === 'critical_high' ? T.status.critical_high : s === 'critical_low' ? T.status.critical_low : s === 'abnormal' ? T.status.abnormal : T.status.unknown;
  let advice = s === 'normal' ? T.advice.normal
    : isCritical(s) ? T.advice.critical
      : s === 'unknown' ? T.advice.unknown
        : T.advice.out(s === 'high' ? txt?.high : s === 'low' ? txt?.low : undefined);
  if (a?.mri && (a.code === 'creatinine' || a.code === 'egfr')) advice += T.advice.mri;
  return { itemId: item.id, title: itemTitle(item, lang), plain: txt?.plain ?? T.genericPlain, statusText, advice, mriRelevant: a?.mri || undefined };
}

export interface MriOutcome {
  creatinineUmolL?: number;
  egfr?: number;
  /** applied — перенесено в проверку; older — в проверке более свежий анализ; no_date — нет даты; unit — единицы непонятны. */
  note?: 'applied' | 'older' | 'no_date' | 'unit';
}

/** Креатинин из бланка → мкмоль/л и рСКФ (для МРТ). Без побочных эффектов. */
export function mriFromItems(items: LabItem[], profile: Pick<PatientProfile, 'birthYear' | 'sex'>, now: Date): MriOutcome | undefined {
  const cr = items.find(i => i.code === 'creatinine' && i.value !== null);
  if (!cr) return undefined;
  const umol = canonicalValue('creatinine', cr.value, cr.unit);
  if (umol === undefined || umol < PROTOCOL.labs.creatinineMin || umol > PROTOCOL.labs.creatinineMax) return { note: 'unit' };
  const rounded = Math.round(umol);
  return { creatinineUmolL: rounded, egfr: egfrCkdEpi2021(rounded, now.getFullYear() - profile.birthYear, profile.sex) };
}

export interface AnalyzeOptions {
  lang: Lang;
  mri?: MriOutcome;
  /** Координатору создана срочная задача. */
  coordinatorNotified?: boolean;
}

function pickSpecialty(flagged: LabItem[]): string {
  const groups = flagged.map(i => analyteByCode(i.code)?.group ?? 'general');
  const kidney = flagged.filter(i => analyteByCode(i.code)?.group === 'kidney');
  if (kidney.length && (kidney.length >= 2 || kidney.some(i => isCritical(i.status))) && groups.every(g => g === 'kidney')) return 'Нефролог';
  if (groups.length && groups.every(g => g === 'endocrine')) return 'Эндокринолог';
  return 'Терапевт';
}

export function analyzeLabs(items: LabItem[], opts: AnalyzeOptions): LabAnalysis {
  const { lang } = opts;
  const T = labsTexts(lang);
  const critical = items.filter(i => isCritical(i.status));
  const out = items.filter(i => OUT_OF_RANGE.includes(i.status));
  const unknown = items.filter(i => i.status === 'unknown');
  const normal = items.filter(i => i.status === 'normal');
  const level: LabAnalysis['level'] = critical.length ? 'urgent' : out.length ? 'attention' : 'ok';
  const names = (list: LabItem[]) => list.slice(0, 6).map(i => `${itemTitle(i, lang)} (${itemValue(i)})`).join(', ');

  const summary = !items.length ? T.summary.empty
    : level === 'urgent' ? T.summary.urgent(names(critical))
      : level === 'attention' ? T.summary.attention(names(out))
        : normal.length ? T.summary.ok(normal.length, unknown.length) : T.summary.noRefs;

  const recommendations: string[] = [];
  if (level === 'urgent') {
    recommendations.push(T.rec.urgent);
    if (opts.coordinatorNotified) recommendations.push(T.rec.coordinator);
    recommendations.push(T.rec.show);
  } else if (level === 'attention') {
    recommendations.push(T.rec.show, T.rec.retest);
  } else {
    recommendations.push(T.rec.keep);
  }
  if (unknown.length) recommendations.push(T.rec.unknownRefs);

  const mri = opts.mri;
  if (mri) {
    if (mri.note === 'unit') recommendations.push(T.rec.mriUnit);
    else if (mri.note === 'applied' && mri.creatinineUmolL) recommendations.push(T.rec.mriApplied(mri.creatinineUmolL, mri.egfr));
    else if (mri.note === 'older') recommendations.push(T.rec.mriOlder);
    else if (mri.note === 'no_date') recommendations.push(T.rec.mriNoDate);
  }
  if (items.some(i => analyteByCode(i.code)?.mri)) recommendations.push(T.rec.mriBring);

  let recommendedSpecialty: string | undefined;
  if (level !== 'ok') {
    recommendedSpecialty = pickSpecialty([...critical, ...out]);
    recommendations.push(T.rec.specialty(specialtyLabel(recommendedSpecialty, lang)));
  }

  const doctorQuestions = [...critical, ...out].slice(0, 3).map(i => T.questions.item(itemTitle(i, lang), itemValue(i)));
  if (level !== 'ok') doctorQuestions.push(T.questions.retest, T.questions.more);
  if (items.some(i => i.code === 'creatinine' || i.code === 'egfr')) doctorQuestions.push(T.questions.mri);

  return {
    level,
    summary,
    summaryBy: 'rules',
    items: items.map(i => explainItem(i, lang)),
    recommendations,
    doctorQuestions,
    recommendedSpecialty,
    recommendedSpecialtyLabel: recommendedSpecialty && specialtyLabel(recommendedSpecialty, lang),
    mri: mri && (mri.creatinineUmolL || mri.egfr) ? { creatinineUmolL: mri.creatinineUmolL, egfr: mri.egfr, appliedToScreening: mri.note === 'applied' } : undefined,
    disclaimer: T.disclaimer,
  };
}
