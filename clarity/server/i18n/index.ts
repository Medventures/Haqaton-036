// Публичное API локализации серверного контента (ru/kk).
// Сигнатуры зафиксированы: их используют диалог (assistant/*) и localize.ts.
// Русские значения берутся из исходных модулей; казахские — из server/i18n/kk/*.
// Если казахского перевода нет — возвращается русский текст (никогда не пустая строка).

import type { Lang } from '../../shared/i18n';
import type { Flag, PrepItem, ReminderPlan, ScreeningOverall } from '../../shared/types';
import { DAY_OF_CHECK, PREP_BANK, PROTOCOL, SCREENING } from '../domain/protocol';
import { OVERALL_TEXT } from '../domain/screening';
import { PHASE_LABEL, REMINDER_PLAN_LABEL } from '../domain/prep';
import {
  DAY_OF_CHECK_KK, LAB_FLAG_KK, OVERALL_TEXT_KK, PHASE_LABEL_KK, PREP_KK, PROCEDURE_KK, REMINDER_PLAN_LABEL_KK, SCREENING_KK,
} from './kk/protocol';

/** Текст вопроса анкеты: text — для экрана, voice — для озвучки, hint — пояснение. */
export function qText(id: string, lang: Lang): { text: string; voice?: string; hint: string } {
  const q = SCREENING.find(x => x.id === id);
  const kk = lang === 'kk' ? SCREENING_KK[id] : undefined;
  if (kk) return { text: kk.text, voice: kk.voice, hint: kk.hint };
  return { text: q?.text ?? id, voice: q?.voice, hint: q?.hint ?? '' };
}

/** Реакция на ответ «да»/«не знаю» (для пациента). null — ответ не требует уточнения. */
export function qRule(id: string, answer: 'yes' | 'unknown', lang: Lang): { title: string; patient: string } | null {
  const q = SCREENING.find(x => x.id === id);
  // «Не знаю» без отдельного правила обрабатывается как «да» (как в evaluateScreening).
  const useYes = answer === 'yes' || !q?.onUnknown;
  const rule = useYes ? q?.onYes : q?.onUnknown;
  if (!rule) return null;
  const kk = lang === 'kk' ? SCREENING_KK[id] : undefined;
  const kkRule = kk ? (useYes ? kk.onYes : kk.onUnknown) : null;
  return kkRule ? { title: kkRule.title, patient: kkRule.patient } : { title: rule.title, patient: rule.patient };
}

/** Ключ и переменные флага; для флагов, сохранённых до v4 (без key), восстанавливаются из id и текста. */
function flagKey(flag: Flag): { key: string; vars: Record<string, number | string> } {
  if (flag.key) return { key: flag.key, vars: flag.vars ?? {} };
  if (flag.id.startsWith('q:')) {
    const q = SCREENING.find(x => x.id === flag.id.slice(2));
    return { key: `${flag.id}:${q?.onUnknown && q.onUnknown.title === flag.title ? 'unknown' : 'yes'}`, vars: {} };
  }
  const n = (re: RegExp, s: string) => { const m = re.exec(s); return m ? Number(m[1]) : undefined; };
  const vars: Record<string, number | string> = { maxAgeDays: PROTOCOL.labs.maxAgeDays };
  const egfr = n(/≈\s*(\d+)/, flag.title);
  const age = n(/(\d+)\s*дн/, flag.patientText);
  if (egfr !== undefined) vars.egfr = egfr;
  if (age !== undefined) vars.labAgeDays = age;
  return { key: flag.id, vars };
}

/** Заголовок и текст флага для пациента на его языке. */
export function flagText(flag: Flag, lang: Lang): { title: string; patientText: string } {
  const ru = { title: flag.title, patientText: flag.patientText };
  if (lang === 'ru') return ru;
  const { key, vars } = flagKey(flag);
  const m = /^q:([^:]+):(yes|unknown)$/.exec(key);
  if (m) {
    const r = qRule(m[1], m[2] as 'yes' | 'unknown', lang);
    return r ? { title: r.title, patientText: r.patient } : ru;
  }
  const lab = LAB_FLAG_KK[key];
  return lab ? lab(vars) : ru;
}

export function prepText(id: string, lang: Lang): { title: string; detail: string } {
  const kk = lang === 'kk' ? PREP_KK[id] : undefined;
  if (kk) return { title: kk.title, detail: kk.detail };
  const p = PREP_BANK[id];
  return { title: p?.title ?? id, detail: p?.detail ?? '' };
}

export function overallText(o: ScreeningOverall, lang: Lang): string {
  return lang === 'kk' ? OVERALL_TEXT_KK[o] ?? OVERALL_TEXT[o] : OVERALL_TEXT[o];
}
export function reminderPlanLabel(p: ReminderPlan, lang: Lang): string {
  return lang === 'kk' ? REMINDER_PLAN_LABEL_KK[p] ?? REMINDER_PLAN_LABEL[p] : REMINDER_PLAN_LABEL[p];
}
export function phaseLabel(p: PrepItem['phase'], lang: Lang): string {
  return lang === 'kk' ? PHASE_LABEL_KK[p] ?? PHASE_LABEL[p] : PHASE_LABEL[p];
}

// ---------- Дополнительные помощники (не входят в зафиксированное API, но удобны диалогу и API) ----------

/** Название процедуры. */
export function procedureText(lang: Lang, ru: string = PROTOCOL.procedure): string {
  return lang === 'kk' && ru === PROTOCOL.procedure ? PROCEDURE_KK : ru;
}

/** Вопросы самопроверки в день визита. violation — текст нарушения для пациента. */
export function dayOfCheckIn(lang: Lang): { id: string; text: string; violation: string }[] {
  return DAY_OF_CHECK.map(q => {
    const kk = lang === 'kk' ? DAY_OF_CHECK_KK[q.id] : undefined;
    return kk ? { id: q.id, ...kk } : q;
  });
}

/** Перевод сохранённого (русского) текста нарушения из самопроверки. */
export function violationText(ru: string, lang: Lang): string {
  if (lang !== 'kk') return ru;
  const q = DAY_OF_CHECK.find(x => x.violation === ru);
  return (q && DAY_OF_CHECK_KK[q.id]?.violation) || ru;
}

export function overallTexts(lang: Lang): Record<ScreeningOverall, string> {
  return { incomplete: overallText('incomplete', lang), ready: overallText('ready', lang), needs_review: overallText('needs_review', lang), hold_for_review: overallText('hold_for_review', lang) };
}
