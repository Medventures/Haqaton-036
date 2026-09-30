// Движок правил проверки противопоказаний и анализов.
// Результат — ОРГАНИЗАЦИОННЫЙ статус для координатора, а не медицинский допуск:
//   ready            — нет отмеченных пунктов, анализ в порядке (окончательно решает персонал)
//   needs_review     — есть пункты для уточнения координатором
//   hold_for_review  — есть критичные пункты; визит нельзя подтверждать без решения врача

import type { Answer, Flag, Journey, LabResult, PatientProfile, ScreeningResult } from '../../shared/types';
import { PROTOCOL, SCREENING } from './protocol';

/** рСКФ по CKD-EPI 2021 (без расового коэффициента), мл/мин/1,73 м². */
export function egfrCkdEpi2021(creatinineUmolL: number, age: number, sex: 'female' | 'male'): number {
  const scr = creatinineUmolL / 88.4; // мкмоль/л → мг/дл
  const kappa = sex === 'female' ? 0.7 : 0.9;
  const alpha = sex === 'female' ? -0.241 : -0.302;
  const ratio = scr / kappa;
  const value = 142 * Math.pow(Math.min(ratio, 1), alpha) * Math.pow(Math.max(ratio, 1), -1.2) * Math.pow(0.9938, age) * (sex === 'female' ? 1.012 : 1);
  return Math.round(value);
}

export function daysBetween(fromIsoDate: string, now: Date): number {
  const from = new Date(`${fromIsoDate}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - from.getTime()) / 86_400_000);
}

export function labsRequired(answers: Record<string, Answer>): boolean {
  if (PROTOCOL.labs.requiredFor === 'all') return true;
  return SCREENING.some(q => q.triggersLabs && answers[q.id] && answers[q.id] !== 'no');
}

export function evaluateScreening(answers: Record<string, Answer>, lab: LabResult, profile: PatientProfile, now: Date): ScreeningResult {
  const flags: Flag[] = [];
  const missing: string[] = [];

  for (const q of SCREENING) {
    if (q.femaleOnly && profile.sex !== 'female') continue;
    const a = answers[q.id];
    if (!a) { missing.push(q.id); continue; }
    const rule = a === 'yes' ? q.onYes : a === 'unknown' ? (q.onUnknown ?? q.onYes) : null;
    if (rule) flags.push({ id: `q:${q.id}`, key: `q:${q.id}:${a === 'yes' ? 'yes' : 'unknown'}`, severity: rule.severity, title: rule.title, patientText: rule.patient, staffText: rule.staff, source: q.id });
  }

  const required = labsRequired(answers);
  let egfr: number | undefined;
  let labAgeDays: number | undefined;
  if (required) {
    if (lab.status === 'provided' && lab.creatinineUmolL && lab.takenOn) {
      const age = now.getFullYear() - profile.birthYear;
      egfr = egfrCkdEpi2021(lab.creatinineUmolL, age, profile.sex);
      labAgeDays = daysBetween(lab.takenOn, now);
      if (labAgeDays > PROTOCOL.labs.maxAgeDays) {
        flags.push({ id: 'lab:stale', key: 'lab:stale', vars: { labAgeDays, maxAgeDays: PROTOCOL.labs.maxAgeDays, takenOn: lab.takenOn }, severity: 'review', title: 'Анализ устарел', patientText: `Анализу ${labAgeDays} дн., а нужен не старше ${PROTOCOL.labs.maxAgeDays} дн. Пожалуйста, пересдайте креатинин до визита.`, staffText: `Креатинин от ${lab.takenOn} (${labAgeDays} дн.) — старше лимита ${PROTOCOL.labs.maxAgeDays} дн.`, source: 'labs' });
      }
      if (egfr < PROTOCOL.labs.egfrCriticalBelow) {
        flags.push({ id: 'lab:egfr_critical', key: 'lab:egfr_critical', vars: { egfr, threshold: PROTOCOL.labs.egfrCriticalBelow }, severity: 'critical', title: `Сниженная рСКФ (≈${egfr})`, patientText: 'Результат анализа нужно посмотреть врачу до введения контраста. Координатор свяжется с вами.', staffText: `рСКФ ≈ ${egfr} мл/мин/1,73м² (< ${PROTOCOL.labs.egfrCriticalBelow}). Требуется решение рентгенолога.`, source: 'labs' });
      } else if (egfr < PROTOCOL.labs.egfrReviewBelow) {
        flags.push({ id: 'lab:egfr_review', key: 'lab:egfr_review', vars: { egfr, threshold: PROTOCOL.labs.egfrReviewBelow }, severity: 'review', title: `рСКФ требует внимания (≈${egfr})`, patientText: 'Врач посмотрит результат анализа. Ничего менять самостоятельно не нужно.', staffText: `рСКФ ≈ ${egfr} (< ${PROTOCOL.labs.egfrReviewBelow}). Проверить по протоколу.`, source: 'labs' });
      }
    } else if (lab.status === 'none') {
      flags.push({ id: 'lab:missing', key: 'lab:missing', vars: { maxAgeDays: PROTOCOL.labs.maxAgeDays }, severity: 'review', title: 'Нет анализа креатинина', patientText: `Сдайте анализ на креатинин до визита (результат не старше ${PROTOCOL.labs.maxAgeDays} дней).`, staffText: 'Анализ креатинина отсутствует. Направить на сдачу.', source: 'labs' });
    } else {
      missing.push('labs');
    }
  }

  const overall = missing.length
    ? 'incomplete'
    : flags.some(f => f.severity === 'critical')
      ? 'hold_for_review'
      : flags.some(f => f.severity === 'review')
        ? 'needs_review'
        : 'ready';

  return { overall, flags, egfr, labAgeDays, labsRequired: required, missing, protocolVersion: PROTOCOL.version };
}

export function screeningFor(journey: Journey, profile: PatientProfile, now: Date) {
  return evaluateScreening(journey.answers, journey.lab, profile, now);
}

export const OVERALL_TEXT: Record<ScreeningResult['overall'], string> = {
  incomplete: 'Проверка не завершена',
  ready: 'Отмеченных пунктов нет',
  needs_review: 'Координатор уточнит детали',
  hold_for_review: 'Нужно решение врача до визита',
};
