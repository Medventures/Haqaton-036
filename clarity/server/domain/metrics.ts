// Расчёт метрик кейса по журналу событий. Формулы — из docs/DEVELOPMENT_ROADMAP.md.
import type { AppEvent, MetricValue, MetricsResponse } from '../../shared/types';

function cohortStats(events: AppEvent[]) {
  const visits = new Set(events.filter(e => e.type === 'visit_scheduled').map(e => e.visitId));
  const cancelled = new Set(events.filter(e => e.type === 'visit_cancelled').map(e => e.visitId));
  const attended = new Set(events.filter(e => e.type === 'visit_attended').map(e => e.visitId));
  const violations = new Set(events.filter(e => e.type === 'prep_violation').map(e => e.visitId));
  const calls = events.filter(e => e.type === 'inbound_call').length;
  const offered = new Set(events.filter(e => e.type === 'consultation_offered').map(e => e.patientId));
  const booked = new Set(events.filter(e => e.type === 'consultation_booked' && offered.has(e.patientId)).map(e => e.patientId));
  const completed = new Set(events.filter(e => e.type === 'consultation_completed').map(e => e.patientId));
  return { visits: visits.size, cancelled: cancelled.size, attended: attended.size, violations: violations.size, calls, offered: offered.size, booked: booked.size, completed: completed.size };
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 100) / 100 : 0);

export function computeMetrics(events: AppEvent[], now: Date): MetricsResponse {
  const b = cohortStats(events.filter(e => e.cohort === 'baseline'));
  const c = cohortStats(events.filter(e => e.cohort === 'clarity'));
  const metrics: MetricValue[] = [
    { key: 'cancellations', label: 'Отмены и неявки', unit: '%', better: 'lower', baseline: pct(b.cancelled, b.visits), current: pct(c.cancelled, c.visits), numerator: c.cancelled, denominator: c.visits, baselineN: b.visits, definition: 'Отменённые/перенесённые визиты и неявки ÷ все записанные визиты' },
    { key: 'prep_violations', label: 'Нарушения подготовки', unit: '%', better: 'lower', baseline: pct(b.violations, b.attended), current: pct(c.violations, c.attended), numerator: c.violations, denominator: c.attended, baselineN: b.attended, definition: 'Визиты с зафиксированным нарушением ÷ состоявшиеся визиты' },
    { key: 'repeat_calls', label: 'Повторные звонки', unit: 'на визит', better: 'lower', baseline: ratio(b.calls, b.visits), current: ratio(c.calls, c.visits), numerator: c.calls, denominator: c.visits, baselineN: b.visits, definition: 'Входящие звонки пациентов по визиту ÷ записанные визиты' },
    { key: 'consult_conversion', label: 'Конверсия в консультацию', unit: '%', better: 'higher', baseline: pct(b.booked, b.offered), current: pct(c.booked, c.offered), numerator: c.booked, denominator: c.offered, baselineN: b.offered, definition: 'Записавшиеся на консультацию ÷ получившие рекомендацию из-за тревожной формулировки' },
  ];
  const all = events.filter(e => e.cohort === 'clarity');
  const count = (t: AppEvent['type']) => new Set(all.filter(e => e.type === t).map(e => e.visitId ?? e.patientId)).size;
  const reasons = new Map<string, number>();
  for (const e of all.filter(e => e.type === 'visit_cancelled')) {
    const r = String(e.meta?.reason ?? 'Не указана');
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  return {
    metrics,
    funnel: [
      { label: 'Записаны', value: c.visits },
      { label: 'Прошли проверку', value: Math.max(count('screening_completed'), 0) },
      { label: 'Пришли на МРТ', value: c.attended },
      { label: 'Рекомендована консультация', value: c.offered },
      { label: 'Записались', value: c.booked },
      { label: 'Консультация состоялась', value: c.completed },
    ],
    cancelReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    generatedAt: now.toISOString(),
    disclaimer: 'Данные смоделированы для демонстрации расчёта и дополняются событиями из демо. Это не результаты пилота; эффект можно заявлять только после измерения на реальной выборке с согласованной базовой линией.',
  };
}
