// Синтетические данные: демо-пациент, несколько пациентов для консоли
// координатора и смоделированная история событий для дашборда метрик.
// НИ ОДНА запись не относится к реальному человеку.

import type { AppEvent, Journey, PatientProfile, StaffTask, User, Visit } from '../shared/types';
import type { Db } from './store';
import { PROTOCOL } from './domain/protocol';
import { evaluateScreening } from './domain/screening';

export const DEMO_PATIENT_ID = 'p-demo';

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ISO-время для даты «через N дней» в часовом поясе Алматы (UTC+5). */
export function almatyAt(base: Date, daysAhead: number, hhmm: string): string {
  const d = new Date(base.getTime() + 5 * 3_600_000 + daysAhead * 86_400_000);
  const date = d.toISOString().slice(0, 10);
  return new Date(`${date}T${hhmm}:00+05:00`).toISOString();
}

const emptyJourney = (patientId: string, visitId: string): Journey => ({
  patientId, visitId, answers: {}, lab: { status: 'unknown' }, prepChecks: [], dialog: { stage: 'idle', qIndex: 0, greeted: false },
});

export function seedDatabase(now: Date): Db {
  const patients: PatientProfile[] = [
    { id: DEMO_PATIENT_ID, displayName: 'Алия К.', initials: 'АК', birthYear: 1968, sex: 'female', phoneMasked: '+7 7•• ••• 12 34' },
    { id: 'p-syn-2', displayName: 'Нурлан Б.', initials: 'НБ', birthYear: 1959, sex: 'male', phoneMasked: '+7 7•• ••• 56 78' },
    { id: 'p-syn-3', displayName: 'Ольга С.', initials: 'ОС', birthYear: 1990, sex: 'female', phoneMasked: '+7 7•• ••• 90 11' },
  ];
  const base = { procedureId: PROTOCOL.id, procedure: PROTOCOL.procedure, clinic: 'Green Clinic', address: 'ул. Демонстрационная, 1 (вымышленный адрес)', city: 'Алматы' };
  const visits: Visit[] = [
    { id: 'v-demo', patientId: DEMO_PATIENT_ID, startsAt: almatyAt(now, 4, '14:30'), status: 'scheduled', ...base },
    { id: 'v-syn-2', patientId: 'p-syn-2', startsAt: almatyAt(now, 2, '10:00'), status: 'scheduled', ...base },
    { id: 'v-syn-3', patientId: 'p-syn-3', startsAt: almatyAt(now, 1, '16:15'), status: 'confirmed', ...base },
  ];
  const journeys: Journey[] = [
    emptyJourney(DEMO_PATIENT_ID, 'v-demo'),
    { ...emptyJourney('p-syn-2', 'v-syn-2'), answers: { pacemaker: 'no', implants: 'yes', metal_work: 'no', kidney: 'yes', contrast_reaction: 'no', allergy_asthma: 'no', pregnancy: 'no', breastfeeding: 'no', claustrophobia: 'no' }, lab: { status: 'none' } },
    { ...emptyJourney('p-syn-3', 'v-syn-3'), answers: { pacemaker: 'no', implants: 'no', metal_work: 'no', kidney: 'no', contrast_reaction: 'no', allergy_asthma: 'no', pregnancy: 'unknown', breastfeeding: 'no', claustrophobia: 'yes' }, lab: { status: 'provided', creatinineUmolL: 64, takenOn: new Date(now.getTime() - 5 * 86_400_000).toISOString().slice(0, 10) } },
  ];
  for (const j of journeys) if (Object.keys(j.answers).length) j.screening = evaluateScreening(j.answers, j.lab, patients.find(p => p.id === j.patientId)!, now);
  const tasks: StaffTask[] = [
    { id: 't-syn-1', patientId: 'p-syn-2', visitId: 'v-syn-2', kind: 'screening_review', priority: 'high', title: 'Имплант / металл в теле; заболевание почек', details: 'Импланты или металл в теле. Проверить МР-совместимость. Заболевание почек — проверить рСКФ.', createdAt: new Date(now.getTime() - 20 * 3_600_000).toISOString(), status: 'open' },
    { id: 't-syn-2', patientId: 'p-syn-2', visitId: 'v-syn-2', kind: 'labs_missing', priority: 'normal', title: 'Нет анализа креатинина', details: 'Анализ креатинина отсутствует. Направить на сдачу.', createdAt: new Date(now.getTime() - 20 * 3_600_000).toISOString(), status: 'open' },
    { id: 't-syn-3', patientId: 'p-syn-3', visitId: 'v-syn-3', kind: 'screening_review', priority: 'high', title: 'Беременность — не исключена', details: 'Пациентка не исключает беременность. Клаустрофобия.', createdAt: new Date(now.getTime() - 6 * 3_600_000).toISOString(), status: 'open' },
  ];

  const createdAt = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  patients[0].onboarding = { completedAt: createdAt, preferredName: 'Алия', firstMri: true, anxiety: 3, concerns: ['claustrophobia', 'contrast'], voice: true, largeText: false, consentAt: createdAt };
  patients[0].createdAt = createdAt;
  const users: User[] = [
    { id: 'u-demo-patient', email: 'aliya.demo@clarity.local', name: 'Алия К.', provider: 'demo', role: 'patient', patientId: DEMO_PATIENT_ID, createdAt, lastLoginAt: createdAt },
    { id: 'u-demo-staff', email: 'coordinator.demo@clarity.local', name: 'Координатор (демо)', provider: 'demo', role: 'staff', createdAt, lastLoginAt: createdAt },
  ];

  return {
    schema: 4,
    timeOffsetHours: 0,
    patients,
    visits,
    journeys,
    reminders: [],
    bookings: [],
    tasks,
    events: syntheticHistory(now),
    chats: {},
    users,
    sessions: [],
  };
}

/**
 * Смоделированная история для демонстрации расчёта метрик.
 * baseline — «до внедрения» (звонки и памятки), clarity — условная группа.
 * Параметры подобраны вручную и НЕ являются результатами исследования.
 */
function syntheticHistory(now: Date): AppEvent[] {
  const rnd = mulberry32(20260930);
  const events: AppEvent[] = [];
  let n = 0;
  const cohorts = [
    { cohort: 'baseline' as const, count: 140, fromDay: 150, toDay: 70, cancel: 0.17, noShow: 0.05, prepViol: 0.13, callsMean: 1.7, flagged: 0.3, convert: 0.41 },
    { cohort: 'clarity' as const, count: 70, fromDay: 60, toDay: 6, cancel: 0.1, noShow: 0.03, prepViol: 0.06, callsMean: 0.8, flagged: 0.3, convert: 0.63 },
  ];
  const reasons = ['Не готов анализ', 'Нарушена подготовка', 'Изменились планы', 'Не дозвонились для подтверждения', 'Сомнения по импланту'];
  for (const c of cohorts) {
    for (let i = 0; i < c.count; i++) {
      const patientId = `syn-${c.cohort}-${i}`;
      const visitId = `sv-${c.cohort}-${i}`;
      const day = c.fromDay - (i / c.count) * (c.fromDay - c.toDay);
      const at = (offsetDays: number) => new Date(now.getTime() - (day - offsetDays) * 86_400_000).toISOString();
      const ev = (type: AppEvent['type'], offsetDays = 0, meta?: AppEvent['meta']) => events.push({ id: `sev-${n++}`, at: at(offsetDays), type, patientId, visitId, cohort: c.cohort, meta });
      ev('visit_scheduled', -7);
      if (c.cohort === 'clarity' && rnd() < 0.92) ev('screening_completed', -5);
      const calls = Math.max(0, Math.round(c.callsMean + (rnd() - 0.5) * 2));
      for (let k = 0; k < calls; k++) ev('inbound_call', -5 + k, { topic: ['подготовка', 'анализы', 'адрес', 'перенос'][Math.floor(rnd() * 4)] });
      const r = rnd();
      if (r < c.cancel) { ev('visit_cancelled', -1, { reason: reasons[Math.floor(rnd() * reasons.length)] }); continue; }
      if (r < c.cancel + c.noShow) { ev('visit_cancelled', 0, { reason: 'Неявка' }); continue; }
      ev('visit_attended', 0);
      if (rnd() < c.prepViol) ev('prep_violation', 0, { item: ['fasting', 'labs', 'referral', 'metal_off'][Math.floor(rnd() * 4)] });
      if (rnd() < c.flagged) {
        ev('consultation_offered', 2);
        if (rnd() < c.convert) { ev('consultation_booked', 2.2); if (rnd() < 0.85) ev('consultation_completed', 6); }
      }
    }
  }
  return events;
}
