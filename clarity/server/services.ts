// Сервисный слой: все изменения состояния маршрута проходят здесь,
// чтобы UI-формы и ИИ-ассистент вели себя одинаково и писали одинаковые события.

import type { Answer, Booking, Concern, ExtractedText, Journey, LabItem, LabReport, LabStatus, Onboarding, PatientProfile, PatientState, ReminderPlan, ReportExplanation, Sex, StaffTask, TaskKind, Visit } from '../shared/types';
import { DAY_OF_CHECK, SCREENING } from './domain/protocol';
import { evaluateScreening } from './domain/screening';
import { buildPrepPlan, buildReminders } from './domain/prep';
import { analyzeReport } from './domain/report';
import { findMriSlot, findSlot } from './domain/slots';
import { computeProgress } from './domain/gamification';
import { KNOWLEDGE } from './assistant/knowledge';
import { PROTOCOL } from './domain/protocol';
import { almatyAt } from './seed';
import { localizeReport, localizeState } from './i18n/localize';
import { analyzeLabs, computeStatus, fmtNum, isCritical, itemTitle, itemValue, mriFromItems, refString, type MriOutcome } from './documents/labAnalysis';
import { DocumentError, llmStructureLabs, readText, REPORT_MAX_CHARS, simplifyLabSummary, visionLabs, visionTranscribe, type DocumentInput } from './documents/extract';
import { parseLabText, parseNumber, parseRef, type ParsedItem } from './documents/labParser';
import { analyteByCode, matchAnalyte } from './documents/labsCatalog';
import { labsTexts } from './documents/labTexts';
import type { AvatarId, Lang } from '../shared/i18n';
import { simplifyReport } from './assistant/llm';
import { getDb, logEvent, newId, now, persist } from './store';

export class NotFound extends Error {}
export class BadRequest extends Error {}
export { DocumentError };

export function ctx(patientId: string) {
  const db = getDb();
  const profile = db.patients.find(p => p.id === patientId);
  if (!profile) throw new NotFound('Пациент не найден');
  const journey = db.journeys.find(j => j.patientId === patientId)!;
  const visit = db.visits.find(v => v.id === journey.visitId)!;
  return { db, profile, journey, visit };
}

export function patientState(patientId: string): PatientState {
  const { db, profile, journey, visit } = ctx(patientId);
  const prepPlan = buildPrepPlan(journey);
  const bookings = db.bookings.filter(b => b.patientId === patientId);
  return {
    profile,
    visit,
    journey,
    prepPlan,
    reminders: db.reminders.filter(r => r.visitId === visit.id),
    bookings,
    openTasks: db.tasks.filter(t => t.patientId === patientId && t.status === 'open'),
    progress: computeProgress({ profile, journey, visit, prepPlan, events: db.events.filter(e => e.patientId === patientId), hasBooking: bookings.some(b => b.status !== 'cancelled') }),
    tips: tipsFor(profile),
  };
}

/** Состояние для показа пациенту — на его языке. */
export function patientView(patientId: string): PatientState {
  const { profile } = ctx(patientId);
  const lang = profile.lang ?? 'ru';
  const st = patientState(patientId);
  const reports = st.journey.labReports;
  // Объяснение анализов строится на языке пациента; после смены языка — пересобираем правилами.
  const view = reports?.some(r => r.analysis && r.lang !== lang) ? { ...st, journey: { ...st.journey, labReports: reports.map(r => labReportView(r, lang)) } } : st;
  return localizeState(view, lang);
}

export function setPrefs(patientId: string, prefs: { lang?: Lang; avatar?: AvatarId }) {
  const { profile } = ctx(patientId);
  if (prefs.lang) profile.lang = prefs.lang;
  if (prefs.avatar) profile.avatar = prefs.avatar;
  persist();
  return profile;
}

function upsertTask(patientId: string, visitId: string | undefined, kind: TaskKind, priority: StaffTask['priority'], title: string, details: string) {
  const db = getDb();
  const existing = db.tasks.find(t => t.patientId === patientId && t.kind === kind && t.status === 'open' && kind !== 'patient_question');
  if (existing) { Object.assign(existing, { priority, title, details }); return existing; }
  const task: StaffTask = { id: newId('t'), patientId, visitId, kind, priority, title, details, createdAt: now().toISOString(), status: 'open' };
  db.tasks.unshift(task);
  return task;
}

/** Пересчитать проверку и синхронизировать задачи координатора. */
export function recomputeScreening(patientId: string) {
  const { db, profile, journey, visit } = ctx(patientId);
  const before = journey.screening?.overall;
  journey.screening = evaluateScreening(journey.answers, journey.lab, profile, now());
  const s = journey.screening;
  if (s.overall !== 'incomplete') {
    const qFlags = s.flags.filter(f => f.source !== 'labs' && f.severity !== 'info');
    const infoFlags = s.flags.filter(f => f.severity === 'info');
    const labFlags = s.flags.filter(f => f.source === 'labs');
    const screeningTask = db.tasks.find(t => t.patientId === patientId && t.kind === 'screening_review' && t.status === 'open');
    if (qFlags.length || infoFlags.length) {
      upsertTask(patientId, visit.id, 'screening_review', qFlags.some(f => f.severity === 'critical') ? 'urgent' : qFlags.length ? 'high' : 'normal',
        [...qFlags, ...infoFlags].map(f => f.title).join('; '), [...qFlags, ...infoFlags].map(f => f.staffText).join(' '));
    } else if (screeningTask) {
      Object.assign(screeningTask, { status: 'resolved', resolution: 'Пациент изменил ответы — пунктов нет', resolvedAt: now().toISOString() });
    }
    const labTask = db.tasks.find(t => t.patientId === patientId && t.kind === 'labs_missing' && t.status === 'open');
    if (labFlags.length) {
      upsertTask(patientId, visit.id, 'labs_missing', labFlags.some(f => f.severity === 'critical') ? 'urgent' : 'normal', labFlags.map(f => f.title).join('; '), labFlags.map(f => f.staffText).join(' '));
    } else if (labTask) {
      Object.assign(labTask, { status: 'resolved', resolution: 'Анализ предоставлен и в пределах протокола', resolvedAt: now().toISOString() });
    }
    if (before === undefined || before === 'incomplete') {
      logEvent({ type: 'screening_completed', patientId, visitId: visit.id, meta: { overall: s.overall } });
      if (!db.events.some(e => e.type === 'visit_scheduled' && e.visitId === visit.id)) logEvent({ type: 'visit_scheduled', patientId, visitId: visit.id });
      if (s.flags.length) logEvent({ type: 'screening_flagged', patientId, visitId: visit.id, meta: { flags: s.flags.length } });
    }
    // Если напоминания уже настроены — обновим тексты (например, анализ сдан).
    if (journey.reminderPlan) scheduleReminders(patientId, journey.reminderPlan, false);
  }
  persist();
  return s;
}

export function setAnswer(patientId: string, questionId: string, value: Answer) {
  if (!SCREENING.some(q => q.id === questionId)) throw new BadRequest('Неизвестный вопрос');
  const { journey } = ctx(patientId);
  journey.answers[questionId] = value;
  return recomputeScreening(patientId);
}

export function setLab(patientId: string, lab: Journey['lab']) {
  const { journey } = ctx(patientId);
  journey.lab = lab;
  return recomputeScreening(patientId);
}

export function togglePrep(patientId: string, itemId: string, checked?: boolean) {
  const { journey, visit } = ctx(patientId);
  const has = journey.prepChecks.includes(itemId);
  const want = checked ?? !has;
  if (want && !has) { journey.prepChecks.push(itemId); logEvent({ type: 'prep_item_checked', patientId, visitId: visit.id, meta: { item: itemId } }); }
  if (!want && has) journey.prepChecks = journey.prepChecks.filter(x => x !== itemId);
  persist();
}

export function scheduleReminders(patientId: string, plan: ReminderPlan, log = true) {
  const { db, journey, visit } = ctx(patientId);
  journey.reminderPlan = plan;
  const delivered = new Map(db.reminders.filter(r => r.visitId === visit.id).map(r => [r.id, r]));
  db.reminders = db.reminders.filter(r => r.visitId !== visit.id);
  const fresh = buildReminders(visit, plan, journey).map(r => ({ ...r, deliveredAt: delivered.get(r.id)?.deliveredAt, readAt: delivered.get(r.id)?.readAt }));
  db.reminders.push(...fresh);
  if (log) logEvent({ type: 'reminder_scheduled', patientId, visitId: visit.id, meta: { plan } });
  persist();
  return fresh;
}

/** «Доставка» напоминаний, срок которых наступил (канал in-app + браузерные уведомления). */
export function deliverDue(patientId: string) {
  const { db, visit } = ctx(patientId);
  const t = now();
  const due = db.reminders.filter(r => r.visitId === visit.id && !r.deliveredAt && new Date(r.dueAt) <= t && ['scheduled', 'confirmed'].includes(visit.status));
  for (const r of due) { r.deliveredAt = t.toISOString(); logEvent({ type: 'reminder_delivered', patientId, visitId: visit.id, meta: { kind: r.kind } }); }
  if (due.length) persist();
  return db.reminders.filter(r => r.visitId === visit.id && r.deliveredAt).sort((a, b) => b.dueAt.localeCompare(a.dueAt));
}

export function markRemindersRead(patientId: string) {
  const { db, visit } = ctx(patientId);
  const t = now().toISOString();
  db.reminders.filter(r => r.visitId === visit.id && r.deliveredAt && !r.readAt).forEach(r => { r.readAt = t; });
  persist();
}

export function confirmVisit(patientId: string) {
  const { visit } = ctx(patientId);
  if (visit.status === 'scheduled') { visit.status = 'confirmed'; logEvent({ type: 'visit_confirmed', patientId, visitId: visit.id }); persist(); }
  return visit;
}

export function cancelVisit(patientId: string, reason: string, reschedule: boolean) {
  const { visit } = ctx(patientId);
  visit.status = reschedule ? 'rescheduled' : 'cancelled';
  visit.cancelReason = reason;
  logEvent({ type: reschedule ? 'visit_rescheduled' : 'visit_cancelled', patientId, visitId: visit.id, meta: { reason } });
  upsertTask(patientId, visit.id, 'callback', 'normal', reschedule ? 'Пациент просит перенести МРТ' : 'Пациент отменил МРТ', `Причина: ${reason}. Связаться, освободить слот${reschedule ? ' и предложить новое время' : ''}.`);
  persist();
  return visit;
}

export function dayOfCheck(patientId: string, answers: Record<string, boolean>) {
  const { journey, visit } = ctx(patientId);
  const issues = DAY_OF_CHECK.filter(q => answers[q.id] === false).map(q => q.violation);
  journey.dayOfCheck = { completedAt: now().toISOString(), ok: issues.length === 0, issues };
  if (issues.length) {
    visit.prepViolation = true;
    visit.prepViolationNote = issues.join('; ');
    logEvent({ type: 'prep_violation', patientId, visitId: visit.id, meta: { items: issues.join('; '), source: 'patient_self_check' } });
    upsertTask(patientId, visit.id, 'callback', 'high', 'Нарушение подготовки в день визита', `Самопроверка пациента: ${issues.join('; ')}. Решить: проводить или перенести.`);
  }
  persist();
  return journey.dayOfCheck;
}

export async function explainReport(patientId: string, text: string, source: ReportExplanation['source']) {
  const clean = text.trim().slice(0, 6000);
  if (clean.length < 10) throw new BadRequest('Текст заключения слишком короткий');
  const { journey, visit, profile } = ctx(patientId);
  // Заключение — на русском; объяснение строится на языке пациента.
  const lang: Lang = profile.lang ?? 'ru';
  const report = analyzeReport(clean, source, newId('rep'), now(), lang);
  const llmText = await simplifyReport(clean, report.sentences.flatMap(s => s.terms.map(t => `${t.term} — ${t.plain}`)), report.level, lang);
  if (llmText) { report.summary = llmText; report.summaryBy = 'llm'; }
  journey.lastReport = report;
  logEvent({ type: 'report_explained', patientId, visitId: visit.id, meta: { level: report.level, flags: report.redFlags.length } });
  if (report.level !== 'routine' && report.recommendedSpecialty) {
    journey.offeredConsultation = { specialty: report.recommendedSpecialty, at: now().toISOString() };
    logEvent({ type: 'consultation_offered', patientId, visitId: visit.id, meta: { specialty: report.recommendedSpecialty, level: report.level } });
    upsertTask(patientId, visit.id, 'report_follow_up', report.level === 'urgent' ? 'urgent' : 'high',
      `${report.level === 'urgent' ? 'Срочно: ' : ''}тревожные формулировки в заключении`,
      `Найдено: ${report.redFlags.map(f => f.phrase).join(', ')}. Рекомендован: ${report.recommendedSpecialty}. ${report.level === 'urgent' ? 'Связаться с пациентом сегодня.' : 'Проконтролировать запись.'}`);
  }
  persist();
  return report;
}

export function bookSlot(patientId: string, slotId: string, reason: string, source: Booking['source']) {
  const { db, journey, visit } = ctx(patientId);
  const dup = db.bookings.find(b => b.patientId === patientId && b.slotId === slotId && b.status === 'booked');
  if (dup) return dup; // идемпотентность
  const slot = findSlot(slotId, now(), db.bookings);
  if (!slot) throw new BadRequest('Слот уже занят или недоступен. Выберите другое время.');
  const booking: Booking = { id: newId('b'), patientId, slotId, specialty: slot.specialty, doctor: slot.doctor, startsAt: slot.startsAt, format: slot.format, reason, source, status: 'booked', createdAt: now().toISOString() };
  db.bookings.push(booking);
  if (!journey.offeredConsultation) {
    journey.offeredConsultation = { specialty: slot.specialty, at: now().toISOString() };
    logEvent({ type: 'consultation_offered', patientId, visitId: visit.id, meta: { specialty: slot.specialty, level: 'patient_request' } });
  }
  logEvent({ type: 'consultation_booked', patientId, visitId: visit.id, meta: { specialty: slot.specialty } });
  const followUp = db.tasks.find(t => t.patientId === patientId && t.kind === 'report_follow_up' && t.status === 'open');
  if (followUp) followUp.details += ` Пациент записался: ${slot.specialty}, ${new Date(slot.startsAt).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}.`;
  persist();
  return booking;
}

export function addQuestion(patientId: string, text: string) {
  const { visit } = ctx(patientId);
  const clean = text.trim().slice(0, 1000);
  if (!clean) throw new BadRequest('Пустой вопрос');
  const task = upsertTask(patientId, visit.id, 'patient_question', 'normal', 'Вопрос пациента', clean);
  logEvent({ type: 'assistant_escalated', patientId, visitId: visit.id });
  persist();
  return task;
}

export function resolveTask(taskId: string, resolution: string) {
  const task = getDb().tasks.find(t => t.id === taskId);
  if (!task) throw new NotFound('Задача не найдена');
  Object.assign(task, { status: 'resolved', resolution: resolution.trim() || 'Решено', resolvedAt: now().toISOString() });
  persist();
  return task;
}

export function recordVisitOutcome(visitId: string, outcome: 'attended' | 'no_show' | 'cancelled', prepViolation: boolean, note?: string) {
  const db = getDb();
  const visit = db.visits.find(v => v.id === visitId);
  if (!visit) throw new NotFound('Визит не найден');
  visit.status = outcome;
  if (outcome === 'attended') logEvent({ type: 'visit_attended', patientId: visit.patientId, visitId });
  else logEvent({ type: 'visit_cancelled', patientId: visit.patientId, visitId, meta: { reason: outcome === 'no_show' ? 'Неявка' : note || 'Отмена клиникой' } });
  if (prepViolation && !visit.prepViolation) {
    visit.prepViolation = true; visit.prepViolationNote = note;
    logEvent({ type: 'prep_violation', patientId: visit.patientId, visitId, meta: { source: 'staff', note: note ?? '' } });
  }
  persist();
  return visit;
}

export function logInboundCall(patientId: string, topic: string) {
  const { visit } = ctx(patientId);
  logEvent({ type: 'inbound_call', patientId, visitId: visit.id, meta: { topic } });
}

export function completeBooking(bookingId: string) {
  const b = getDb().bookings.find(x => x.id === bookingId);
  if (!b) throw new NotFound('Запись не найдена');
  b.status = 'completed';
  logEvent({ type: 'consultation_completed', patientId: b.patientId });
  persist();
  return b;
}

export function resetPatient(patientId: string) {
  const { db, journey, visit } = ctx(patientId);
  Object.assign(journey, { answers: {}, lab: { status: 'unknown' }, screening: undefined, prepChecks: [], dayOfCheck: undefined, reminderPlan: undefined, lastReport: undefined, offeredConsultation: undefined, labReports: undefined, dialog: { stage: 'idle', qIndex: 0, greeted: false } });
  Object.assign(visit, { status: 'scheduled', cancelReason: undefined, prepViolation: undefined, prepViolationNote: undefined });
  db.reminders = db.reminders.filter(r => r.visitId !== visit.id);
  db.bookings = db.bookings.filter(b => b.patientId !== patientId);
  db.tasks = db.tasks.filter(t => t.patientId !== patientId);
  db.events = db.events.filter(e => e.patientId !== patientId || ['patient_registered', 'onboarding_completed', 'visit_scheduled'].includes(e.type));
  db.chats[patientId] = [];
  persist();
}

// ---------- Регистрация и знакомство ----------

const CONCERN_CARD: Record<Concern, string> = {
  contrast: 'faq-contrast-safety', injection: 'faq-contrast-what', noise: 'faq-noise', claustrophobia: 'faq-claustro',
  preparation: 'faq-food', result: 'faq-results', meds: 'faq-meds', road: 'faq-address',
};

/** Персональные советы из базы знаний по опасениям, отмеченным при знакомстве. */
export function tipsFor(profile: PatientProfile) {
  const concerns = profile.onboarding?.concerns ?? [];
  return concerns.map(c => KNOWLEDGE.find(k => k.id === CONCERN_CARD[c])).filter((k): k is NonNullable<typeof k> => Boolean(k)).slice(0, 4).map(k => ({ id: k.id, title: k.title, answer: k.answer }));
}

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || 'П';

/** Новый пациент после первого входа: профиль, маршрут и предварительный слот МРТ. */
export function createPatient(p: { name: string; email: string; picture?: string }): PatientProfile {
  const db = getDb();
  const id = newId('p');
  const profile: PatientProfile = { id, displayName: p.name, initials: initialsOf(p.name), birthYear: 1985, sex: 'female', phoneMasked: '', email: p.email, picture: p.picture, createdAt: now().toISOString() };
  const visit: Visit = { id: newId('v'), patientId: id, procedureId: PROTOCOL.id, procedure: PROTOCOL.procedure, startsAt: almatyAt(now(), 5, '11:30'), clinic: 'Green Clinic', address: 'ул. Демонстрационная, 1 (вымышленный адрес)', city: 'Алматы', status: 'scheduled' };
  db.patients.push(profile);
  db.visits.push(visit);
  db.journeys.push({ patientId: id, visitId: visit.id, answers: {}, lab: { status: 'unknown' }, prepChecks: [], dialog: { stage: 'idle', qIndex: 0, greeted: false } });
  db.chats[id] = [];
  logEvent({ type: 'patient_registered', patientId: id, visitId: visit.id });
  persist();
  return profile;
}

export interface OnboardingInput {
  preferredName: string;
  lastName?: string;
  birthYear: number;
  sex: Sex;
  phone?: string;
  mriSlotId?: string;
  firstMri: boolean | null;
  anxiety: number;
  concerns: Concern[];
  voice: boolean;
  largeText: boolean;
}

const maskPhone = (raw: string) => {
  const d = raw.replace(/\D/g, '');
  return d.length >= 10 ? `+${d.slice(0, d.length - 10) || '7'} ${d.slice(-10, -7)} ••• ${d.slice(-4, -2)} ${d.slice(-2)}` : '';
};

export function completeOnboarding(patientId: string, input: OnboardingInput) {
  const { profile, visit, db } = ctx(patientId);
  const t = now().toISOString();
  const onboarding: Onboarding = { completedAt: t, preferredName: input.preferredName.trim(), firstMri: input.firstMri, anxiety: input.anxiety, concerns: input.concerns, voice: input.voice, largeText: input.largeText, consentAt: t };
  const full = [input.preferredName.trim(), input.lastName?.trim() ? `${input.lastName.trim()[0]!.toUpperCase()}.` : ''].filter(Boolean).join(' ');
  Object.assign(profile, { displayName: full, initials: initialsOf(`${input.preferredName} ${input.lastName ?? ''}`), birthYear: input.birthYear, sex: input.sex, phoneMasked: input.phone ? maskPhone(input.phone) : profile.phoneMasked, onboarding });
  const user = db.users.find(u => u.patientId === patientId);
  if (user) user.name = full;
  if (input.mriSlotId) {
    const slot = findMriSlot(input.mriSlotId, now());
    if (!slot) throw new BadRequest('Это время МРТ уже недоступно, выберите другое');
    visit.startsAt = slot.startsAt;
    visit.address = `ул. Демонстрационная, 1 (вымышленный адрес) · ${slot.doctor}`;
  }
  if (!db.events.some(e => e.type === 'visit_scheduled' && e.visitId === visit.id)) logEvent({ type: 'visit_scheduled', patientId, visitId: visit.id });
  logEvent({ type: 'onboarding_completed', patientId, visitId: visit.id, meta: { anxiety: input.anxiety, concerns: input.concerns.length } });
  if (Object.keys(ctx(patientId).journey.answers).length) recomputeScreening(patientId);
  persist();
  return profile;
}

// ---------- Документы пациента: анализы и заключения ----------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validTakenOn = (d: string | undefined | null) => (d && ISO_DATE.test(d) && !Number.isNaN(new Date(d).getTime()) && new Date(`${d}T00:00:00`) <= now() ? d : undefined);

function toLabItem(p: ParsedItem, id?: string): LabItem {
  const base = { ...p, id: id ?? newId('li'), value: p.value ?? null };
  return { ...base, status: computeStatus(base) };
}

/** Анализ на нужном языке: если построен на другом — пересобирается правилами (без LLM). */
export function labReportView(r: LabReport, lang: Lang): LabReport {
  if (!r.analysis || r.lang === lang) return r;
  const m = r.analysis.mri;
  const mri: MriOutcome | undefined = m || r.mriNote ? { creatinineUmolL: m?.creatinineUmolL, egfr: m?.egfr, note: r.mriNote } : undefined;
  return { ...r, lang, analysis: analyzeLabs(r.items, { lang, mri, coordinatorNotified: r.notified }) };
}

/**
 * Распознать загруженный документ.
 *  kind='report' → текст заключения (дальше фронтенд вызывает POST /api/me/report);
 *  kind='labs'   → черновик LabReport (confirmed: false), который пациент проверяет и подтверждает.
 */
export async function extractDocument(patientId: string, input: DocumentInput): Promise<{ labReport?: LabReport; extracted?: ExtractedText }> {
  const { journey, visit, profile } = ctx(patientId);
  const lang: Lang = profile.lang ?? 'ru';
  const T = labsTexts(lang).errors;
  const fileName = input.fileName?.replace(/[\\/]/g, '_').slice(0, 120);

  if (input.kind === 'report') {
    const raw = await readText(input, lang);
    let text: string;
    let extractedBy: ExtractedText['extractedBy'];
    const warnings: string[] = [];
    if (raw) { text = raw.text; extractedBy = raw.extractedBy; } else { text = await visionTranscribe(input, lang); extractedBy = 'llm'; warnings.push(T.checkLlm); }
    text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.replace(/\s+/g, '').length < 10) throw new DocumentError(T.empty, 422);
    if (text.length > REPORT_MAX_CHARS) { text = text.slice(0, REPORT_MAX_CHARS); warnings.push(T.truncated); }
    return { extracted: { text, extractedBy, fileName, warning: warnings.join(' ') || undefined } };
  }

  const raw = await readText(input, lang);
  let parsed: { items: ParsedItem[]; takenOn?: string };
  let extractedBy: LabReport['extractedBy'];
  let source: LabReport['source'];
  if (raw) {
    parsed = parseLabText(raw.text);
    extractedBy = 'rules';
    source = raw.source;
    if (!parsed.items.length) {
      const llm = await llmStructureLabs(raw.text);
      if (llm?.items.length) { parsed = { items: llm.items, takenOn: parsed.takenOn ?? llm.takenOn }; extractedBy = 'llm'; }
    }
  } else {
    parsed = await visionLabs(input, lang);
    extractedBy = 'llm';
    source = 'image';
  }
  const report: LabReport = {
    id: newId('lab'),
    uploadedAt: now().toISOString(),
    takenOn: validTakenOn(parsed.takenOn),
    source,
    fileName,
    extractedBy,
    items: parsed.items.map(p => toLabItem(p)),
    confirmed: false,
    lang,
  };
  journey.labReports = [report, ...(journey.labReports ?? [])].slice(0, 10);
  logEvent({ type: 'labs_uploaded', patientId, visitId: visit.id, meta: { source, extractedBy, items: report.items.length } });
  persist();
  const warning = !report.items.length ? T.noItems : extractedBy === 'llm' ? T.checkItems : undefined;
  return { labReport: report, extracted: warning ? { text: raw?.text.slice(0, 3000) ?? '', extractedBy: raw?.extractedBy ?? 'llm', fileName, warning } : undefined };
}

export interface LabItemInput {
  id?: string; code?: string; name: string; value?: number | null; valueText?: string | null; unit?: string | null;
  refLow?: number | null; refHigh?: number | null; refText?: string | null; labFlag?: string | null;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const optStr = (v: string | null | undefined, max: number) => { const t = v?.trim(); return t ? t.slice(0, max) : undefined; };

/** Правка пациента поверх распознанного: что изменилось (текст или число) — то и источник истины. */
function mergeLabItem(prev: LabItem | undefined, inc: LabItemInput): LabItem | null {
  const name = inc.name.trim().slice(0, 80);
  if (!name) return null;
  let valueText = optStr(inc.valueText, 40) ?? '';
  let gluedFlag: string | undefined;
  const glued = valueText.match(/^(.*?\d)\s*(↑↑?|↓↓?|H|L|\*)$/u); // «96 H» → 96 и отметка H
  if (glued) { valueText = glued[1].trim(); gluedFlag = glued[2]; }
  let value: number | null;
  const incValue = opt(inc.value);
  if (prev && !gluedFlag && valueText === prev.valueText && incValue !== undefined && incValue !== prev.value) {
    value = incValue; valueText = fmtNum(incValue);
  } else if (valueText) {
    value = /\d/.test(valueText) ? parseNumber(valueText) : null;
  } else if (incValue !== undefined) {
    value = incValue; valueText = fmtNum(incValue);
  } else return null;

  let refText = optStr(inc.refText, 60);
  let refLow = opt(inc.refLow);
  let refHigh = opt(inc.refHigh);
  const numsChanged = prev ? refLow !== prev.refLow || refHigh !== prev.refHigh : false;
  const textChanged = prev ? refText !== prev.refText : true;
  if (refText && (textChanged || !numsChanged)) {
    const r = parseRef(refText);
    if (r.refLow !== undefined || r.refHigh !== undefined) { refLow = r.refLow; refHigh = r.refHigh; } else if (textChanged) { refLow = undefined; refHigh = undefined; }
  } else if (numsChanged) {
    refText = undefined; // показываем по числам
  }
  if (refLow !== undefined && refHigh !== undefined && refLow > refHigh) [refLow, refHigh] = [refHigh, refLow];
  const code = matchAnalyte(name)?.code ?? analyteByCode(inc.code)?.code;
  const base = { id: prev?.id ?? newId('li'), code, name, value, valueText, unit: optStr(inc.unit, 30), refLow, refHigh, refText, labFlag: optStr(inc.labFlag, 8) ?? gluedFlag };
  return { ...base, status: computeStatus(base) };
}

function upsertLabUrgentTask(patientId: string, visitId: string, report: LabReport, critical: LabItem[]) {
  const db = getDb();
  const title = 'Срочно: критическое значение в анализах пациента';
  const details = `Пациент загрузил и подтвердил анализы${report.takenOn ? ` от ${report.takenOn}` : ''}: ${critical.map(i => `${i.name} ${itemValue(i)}${refString(i) ? ` (реф. ${refString(i)})` : ''}`).join(', ')}. Связаться с пациентом сегодня и рекомендовать обратиться к лечащему врачу; ассистент посоветовал при плохом самочувствии звонить 103.`;
  const existing = db.tasks.find(t => t.patientId === patientId && t.kind === 'callback' && t.status === 'open' && t.title === title);
  if (existing) { Object.assign(existing, { priority: 'urgent', details }); return existing; }
  const task: StaffTask = { id: newId('t'), patientId, visitId, kind: 'callback', priority: 'urgent', title, details, createdAt: now().toISOString(), status: 'open' };
  db.tasks.unshift(task);
  return task;
}

/** Пациент проверил значения → статусы, анализ на его языке, креатинин → проверка перед МРТ. */
export async function confirmLabs(patientId: string, labId: string, input: { items: LabItemInput[]; takenOn?: string | null }) {
  const { journey, visit, profile } = ctx(patientId);
  const lang: Lang = profile.lang ?? 'ru';
  const report = journey.labReports?.find(r => r.id === labId);
  if (!report) throw new NotFound(labsTexts(lang).errors.notFound);
  if (input.takenOn && !validTakenOn(input.takenOn)) throw new BadRequest(lang === 'kk' ? 'Талдау күні дұрыс емес немесе болашақта' : 'Дата анализа некорректна или в будущем');
  const prev = new Map(report.items.map(i => [i.id, i]));
  report.items = input.items.slice(0, 60).map(inc => mergeLabItem(inc.id ? prev.get(inc.id) : undefined, inc)).filter((x): x is LabItem => Boolean(x));
  if (input.takenOn !== undefined) report.takenOn = validTakenOn(input.takenOn);
  report.confirmed = true;
  report.lang = lang;

  // МРТ: креатинин из бланка — в проверку (пересчёт рСКФ и флагов — детерминированные правила screening.ts).
  const mri = mriFromItems(report.items, profile, now());
  if (mri && mri.note !== 'unit') {
    const lab = journey.lab;
    if (!report.takenOn) mri.note = 'no_date';
    else if (lab.status === 'provided' && lab.takenOn && lab.takenOn > report.takenOn) mri.note = 'older';
    else { setLab(patientId, { status: 'provided', creatinineUmolL: mri.creatinineUmolL, takenOn: report.takenOn }); mri.note = 'applied'; }
  }
  report.mriNote = mri?.note;

  const critical = report.items.filter(i => isCritical(i.status));
  if (critical.length) { upsertLabUrgentTask(patientId, visit.id, report, critical); report.notified = true; }

  const analysis = analyzeLabs(report.items, { lang, mri, coordinatorNotified: report.notified });
  const llmText = report.items.length ? await simplifyLabSummary(analysis, lang) : null;
  if (llmText) { analysis.summary = llmText; analysis.summaryBy = 'llm'; }
  report.analysis = analysis;
  logEvent({ type: 'labs_analyzed', patientId, visitId: visit.id, meta: { level: analysis.level, items: report.items.length, critical: critical.length, mri: mri?.note ?? 'none' } });
  persist();
  return { labReport: report, state: patientView(patientId) };
}

export function deleteLabs(patientId: string, labId: string) {
  const { journey, profile } = ctx(patientId);
  const report = journey.labReports?.find(r => r.id === labId);
  if (!report) throw new NotFound(labsTexts(profile.lang ?? 'ru').errors.notFound);
  journey.labReports = journey.labReports!.filter(r => r.id !== labId);
  // Значение креатинина пришло из этого бланка — убираем и его из проверки.
  const m = report.analysis?.mri;
  if (report.mriNote === 'applied' && m?.creatinineUmolL && journey.lab.status === 'provided' && journey.lab.creatinineUmolL === m.creatinineUmolL && journey.lab.takenOn === report.takenOn) {
    setLab(patientId, { status: 'unknown' });
  }
  persist();
}

// ---------- Контекст для ассистента (dialog/agent) ----------

/** Последний подтверждённый анализ (или последний черновик) — на языке пациента. */
export function latestLabReport(patientId: string): LabReport | undefined {
  const { journey, profile } = ctx(patientId);
  const list = journey.labReports ?? [];
  const r = list.find(x => x.confirmed && x.analysis) ?? list[0];
  return r && labReportView(r, profile.lang ?? 'ru');
}

const STATUS_WORD: Record<LabStatus, string> = {
  normal: 'в пределах референса', high: 'выше референса', low: 'ниже референса',
  critical_high: 'критически высокое — связаться с врачом сегодня', critical_low: 'критически низкое — связаться с врачом сегодня',
  abnormal: 'отмечено лабораторией как отклонение', unknown: 'референс не указан, не сравнивали',
};

/** Компактный текст подтверждённых анализов для контекста LLM. Пусто — анализов нет. */
export function labsSummaryForAgent(patientId: string, lang: Lang): string {
  const { journey } = ctx(patientId);
  const r = journey.labReports?.find(x => x.confirmed && x.analysis);
  if (!r) return '';
  const a = labReportView(r, lang).analysis!;
  const lines = [`Анализы пациента${r.takenOn ? ` от ${r.takenOn}` : ''} (значения подтверждены пациентом; статус — только по референсу бланка). Уровень по правилам: ${a.level}.`];
  for (const i of r.items.slice(0, 30)) {
    const ref = refString(i);
    lines.push(`- ${itemTitle(i, lang)}: ${itemValue(i)}${ref ? ` (реф. ${ref})` : ''} — ${STATUS_WORD[i.status]}`);
  }
  if (a.mri) lines.push(`МРТ: креатинин ${a.mri.creatinineUmolL ?? '—'} мкмоль/л, рСКФ ≈ ${a.mri.egfr ?? '—'}${a.mri.appliedToScreening ? ' (учтено в проверке перед МРТ)' : ''}. Решение о контрасте — за врачом.`);
  if (a.recommendedSpecialty) lines.push(`Рекомендованный специалист (правила): ${a.recommendedSpecialty}.`);
  lines.push(`Итог для пациента: ${a.summary}`);
  return lines.join('\n');
}

/** Исходные предложения заключения МРТ + уровень и флаги правил. Пусто — заключения нет. */
export function reportSummaryForAgent(patientId: string, lang: Lang): string {
  const { journey } = ctx(patientId);
  if (!journey.lastReport) return '';
  const r = localizeReport(journey.lastReport, lang);
  const text = r.sentences.map(s => s.text).join(' ').slice(0, 2500);
  const lines = [
    `Заключение МРТ (${r.source === 'sample' ? 'демо-пример' : 'текст пациента'}, ${r.createdAt.slice(0, 10)}). Уровень по правилам: ${r.level}.`,
    `Текст заключения: ${text}`,
  ];
  if (r.redFlags.length) lines.push(`Формулировки, отмеченные правилами: ${r.redFlags.map(f => `«${f.phrase}» (${f.level}, ${f.specialty})`).join('; ')}.`);
  if (r.recommendedSpecialty) lines.push(`Рекомендованный специалист (правила): ${r.recommendedSpecialty}.`);
  lines.push(`Пояснение для пациента: ${r.summary}`);
  return lines.join('\n');
}
