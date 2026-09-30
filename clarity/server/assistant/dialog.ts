// Оркестратор диалога ИИ-ассистента (Аружан / Клэри), русский и казахский.
// Архитектура: детерминированный сценарий маршрута (state machine) + правила NLU
// + LLM только там, где она безопасна: понимание свободной речи, ответы из базы
// знаний с источником и пересказ заключения. Все медицинско-значимые решения
// (флаги, тревожность, эскалации) принимают правила протокола и люди.
// Язык разговора = язык пациента (profile.lang). Реплики — server/i18n/dialog.ts,
// тексты протокола — server/i18n/index.ts, карточки — из локализованного patientView().

import type { Answer, AssistantAction, AssistantMessage, Card, ChatRequest, LabReport, Mood, QuickReply, ReminderPlan, ReportExplanation } from '../../shared/types';
import { specialtyLabel, type Lang } from '../../shared/i18n';
import { PROTOCOL, SCREENING } from '../domain/protocol';
import { labsRequired } from '../domain/screening';
import { REMINDER_PLAN_LABEL } from '../domain/prep';
import { REPORT_SAMPLES, findTerms } from '../domain/report';
import { SPECIALTIES, listSlots } from '../domain/slots';
import { clinicalDecisionText, detectEmergency, emergencyText, isClinicalDecisionRequest } from '../domain/safety';
import { detectIntent, foldKk, isQuestion, parseAnswer, parseCreatinine, parseLabDate, type Intent } from '../domain/nlu';
import { overallText, qRule, qText, reminderPlanLabel } from '../i18n/index';
import { CANCEL_REASONS, almatyDate, assistantName, cancelReasonLabel, doctorLabel, dt, fmtDateTime, fmtDay, fmtDayDat, fmtShort, fmtTime, lcFirst, specDative, specText, type DialogDict } from '../i18n/dialog';
import { classify } from './llm';
import { agentReply } from './agent';
import { retrieve } from './knowledge';
import * as svc from '../services';
import { getDb, logEvent, newId, now, persist } from '../store';

type Out = AssistantMessage[];
type Mode = 'text' | 'voice';

function msg(text: string, extra: Partial<AssistantMessage> = {}): AssistantMessage {
  return { id: newId('m'), role: 'assistant', text, mood: 'neutral', by: 'rules', at: now().toISOString(), ...extra };
}

const qr = (label: string, action: AssistantAction): QuickReply => ({ label, action });

/** Язык разговора и словарь реплик пациента. */
function langOf(patientId: string): Lang {
  return svc.ctx(patientId).profile.lang ?? 'ru';
}
function L(patientId: string): { lang: Lang; D: DialogDict } {
  const lang = langOf(patientId);
  return { lang, D: dt(lang) };
}

const answerQR = (D: DialogDict) => [qr(D.no, { type: 'answer', value: 'no' }), qr(D.yes, { type: 'answer', value: 'yes' }), qr(D.dontKnow, { type: 'answer', value: 'unknown' })];

/** Вопросы анкеты, применимые к пациенту (беременность — только для женщин). */
function applicableQuestions(patientId: string) {
  const { profile } = svc.ctx(patientId);
  return SCREENING.filter(q => !q.femaleOnly || profile.sex === 'female');
}

/** Следующий рекомендуемый шаг маршрута — для меню и «что дальше». */
function nextSteps(patientId: string): QuickReply[] {
  const { journey, visit, db } = svc.ctx(patientId);
  const { D } = L(patientId);
  const out: QuickReply[] = [];
  const s = journey.screening;
  const visitDone = visit.status === 'attended' || new Date(visit.startsAt) < now();
  if (!visitDone) {
    if (!s || s.overall === 'incomplete') out.push(qr(Object.keys(journey.answers).length ? D.continueScreening : D.startScreening, { type: 'screening_start' }));
    out.push(qr(D.stepByStep, { type: 'instruction' }));
    if (!journey.reminderPlan) out.push(qr(D.setReminders, { type: 'reminder_menu' }));
    if (visit.status === 'scheduled') out.push(qr(D.confirmVisit, { type: 'visit_confirm' }));
  }
  out.push(qr(D.explainReport, { type: 'report_start' }));
  if (journey.offeredConsultation && !db.bookings.some(b => b.patientId === patientId && b.status === 'booked')) out.unshift(qr(D.bookSpecialty(journey.offeredConsultation.specialty), { type: 'booking_start', specialty: journey.offeredConsultation.specialty }));
  out.push(qr(D.contactCoordinator, { type: 'human' }));
  return out.slice(0, 5);
}

// ---------------- Основные сценарии ----------------

function greet(patientId: string): Out {
  const { profile, journey } = svc.ctx(patientId);
  const { lang, D } = L(patientId);
  journey.dialog.greeted = true;
  const view = svc.patientView(patientId);
  const name = profile.onboarding?.preferredName ?? profile.displayName.split(' ')[0];
  return [
    msg(D.greet({ name, assistant: assistantName(profile.avatar, lang), worried: (profile.onboarding?.anxiety ?? 0) >= 4, firstMri: !!profile.onboarding?.firstMri }), { mood: 'happy' }),
    msg(D.greetVisit(view.visit.procedure, fmtDateTime(view.visit.startsAt, lang)), { cards: [{ type: 'visit', visit: view.visit }], quickReplies: nextSteps(patientId) }),
  ];
}

function askQuestion(patientId: string, lead?: string): Out {
  const { journey } = svc.ctx(patientId);
  const { lang, D } = L(patientId);
  const qs = applicableQuestions(patientId);
  const idx = qs.findIndex(q => !journey.answers[q.id]);
  if (idx === -1) return afterQuestions(patientId);
  journey.dialog.stage = 'screening';
  journey.dialog.qIndex = idx;
  const q = qText(qs[idx].id, lang);
  const text = `${lead ? `${lead} ` : ''}${D.questionOf(idx + 1, qs.length)} ${q.voice ?? q.text} ${q.hint}`.trim();
  return [msg(text, { mood: 'neutral', quickReplies: answerQR(D) })];
}

function startScreening(patientId: string): Out {
  const { journey } = svc.ctx(patientId);
  const { D } = L(patientId);
  const fresh = Object.keys(journey.answers).length === 0;
  return askQuestion(patientId, fresh ? D.screeningIntro(applicableQuestions(patientId).length) : D.screeningContinue);
}

function onAnswer(patientId: string, value: Answer): Out {
  const { journey } = svc.ctx(patientId);
  const { lang, D } = L(patientId);
  const qs = applicableQuestions(patientId);
  const q = qs[journey.dialog.qIndex] ?? qs.find(x => !journey.answers[x.id]);
  if (!q) return afterQuestions(patientId);
  svc.setAnswer(patientId, q.id, value);
  const rule = value === 'yes' ? q.onYes : value === 'unknown' ? (q.onUnknown ?? q.onYes) : null;
  const text = value === 'no' ? null : qRule(q.id, value, lang);
  const reactions = D.reactions[value];
  const reaction = reactions[Object.keys(journey.answers).length % reactions.length];
  const lead = rule && text ? `${reaction} ${text.patient}` : reaction;
  const out = askQuestion(patientId, lead);
  if (rule && rule.severity === 'critical') out[0].mood = 'concerned';
  return out;
}

function labDateQR(D: DialogDict, full = true): QuickReply[] {
  return full
    ? [qr(D.presetThisWeek, { type: 'lab_date_preset', daysAgo: 3 }), qr(D.preset12, { type: 'lab_date_preset', daysAgo: 10 }), qr(D.preset34, { type: 'lab_date_preset', daysAgo: 25 }), qr(D.presetMonth, { type: 'lab_date_preset', daysAgo: 45 })]
    : [qr(D.presetThisWeek, { type: 'lab_date_preset', daysAgo: 3 }), qr(D.presetMonth, { type: 'lab_date_preset', daysAgo: 45 })];
}

function afterQuestions(patientId: string): Out {
  const { journey } = svc.ctx(patientId);
  const { D } = L(patientId);
  if (labsRequired(journey.answers) && journey.lab.status === 'unknown') {
    journey.dialog.stage = 'lab_has';
    return [msg(D.labAsk(PROTOCOL.labs.maxAgeDays), {
      quickReplies: [qr(D.hasResult, { type: 'lab_has', value: 'yes' }), qr(D.notYet, { type: 'lab_has', value: 'no' }), qr(D.dontKnow, { type: 'lab_has', value: 'unknown' })],
    })];
  }
  return summary(patientId);
}

function onLabHas(patientId: string, value: Answer): Out {
  const { journey } = svc.ctx(patientId);
  const { D } = L(patientId);
  if (value === 'yes') {
    journey.dialog.stage = 'lab_value';
    return [msg(D.labAskValue, { mood: 'listening' })];
  }
  svc.setLab(patientId, { status: 'none' });
  return summary(patientId, value === 'no' ? D.labWillAdd : D.labCoordinator);
}

function onLabValue(patientId: string, text: string): Out {
  const { journey } = svc.ctx(patientId);
  const { D } = L(patientId);
  const v = parseCreatinine(text);
  if (v === null || v < PROTOCOL.labs.creatinineMin || v > PROTOCOL.labs.creatinineMax) {
    return [msg(D.labValueBad, { mood: 'thinking', quickReplies: [qr(D.skip, { type: 'lab_has', value: 'unknown' })] })];
  }
  journey.lab = { status: 'provided', creatinineUmolL: v };
  journey.dialog.stage = 'lab_date';
  persist();
  return [msg(D.labValueOk(v), { quickReplies: labDateQR(D) })];
}

function onLabDate(patientId: string, isoDate: string | null): Out {
  const { journey } = svc.ctx(patientId);
  const { D } = L(patientId);
  if (!isoDate) return [msg(D.labDateBad, { quickReplies: labDateQR(D, false) })];
  svc.setLab(patientId, { ...journey.lab, status: 'provided', takenOn: isoDate });
  return summary(patientId);
}

function summary(patientId: string, lead?: string): Out {
  const { journey } = svc.ctx(patientId);
  const { lang, D } = L(patientId);
  journey.dialog.stage = 'idle';
  svc.recomputeScreening(patientId);
  // Карточка и перечисление флагов — из локализованной копии состояния.
  const s = svc.patientView(patientId).journey.screening!;
  const card: Card = { type: 'screening_summary', result: s };
  const egfr = s.egfr ? D.egfr(s.egfr) : '';
  const titles = (sev: (f: typeof s.flags[number]) => boolean) => s.flags.filter(sev).map(f => (lang === 'ru' ? f.title.toLowerCase() : lcFirst(f.title))).join(', ');
  let text: string;
  let mood: Mood = 'happy';
  if (s.overall === 'ready') text = D.summaryReady(egfr);
  else if (s.overall === 'needs_review') { text = D.summaryReview(titles(f => f.severity !== 'info'), egfr); mood = 'neutral'; }
  else { text = D.summaryHold(titles(f => f.severity === 'critical')); mood = 'concerned'; }
  return [msg(`${lead ? `${lead} ` : ''}${text}`, { mood, cards: [card], quickReplies: [qr(D.stepByStep, { type: 'instruction' }), qr(D.myPrep, { type: 'prep' }), qr(D.contactCoordinator, { type: 'human' })] })];
}

function prep(patientId: string): Out {
  const { D } = L(patientId);
  const state = svc.patientView(patientId);
  logEvent({ type: 'prep_plan_viewed', patientId, visitId: state.visit.id });
  const personal = state.prepPlan.filter(p => p.personal).length;
  const text = D.prepIntro(personal, PROTOCOL.fastingHours, labsRequired(state.journey.answers));
  return [msg(text, {
    cards: [{ type: 'prep_plan', items: state.prepPlan, checked: state.journey.prepChecks, visitStartsAt: state.visit.startsAt }],
    quickReplies: [qr(D.stepByStep, { type: 'instruction' }), ...(!state.journey.reminderPlan ? [qr(D.setReminders, { type: 'reminder_menu' } as AssistantAction)] : []), qr(D.whatsLeft, { type: 'status' }), qr(D.menu, { type: 'menu' })].slice(0, 3),
  })];
}

function reminderMenu(patientId: string): Out {
  const { visit } = svc.ctx(patientId);
  const { lang, D } = L(patientId);
  return [msg(D.reminderAsk(fmtShort(visit.startsAt, lang)), {
    quickReplies: (Object.keys(REMINDER_PLAN_LABEL) as ReminderPlan[]).map(p => qr(reminderPlanLabel(p, lang), { type: 'reminder_set', plan: p })),
  })];
}

function reminderSet(patientId: string, plan: ReminderPlan): Out {
  const { D } = L(patientId);
  const reminders = svc.scheduleReminders(patientId, plan);
  if (plan === 'none') return [msg(D.remindersOff, { quickReplies: nextSteps(patientId) })];
  // Тексты напоминаний — на языке пациента (локализованная копия).
  const localized = svc.patientView(patientId).reminders;
  const ids = new Set(reminders.map(r => r.id));
  const list = localized.filter(r => ids.has(r.id));
  return [msg(D.remindersSet(reminders.length), {
    mood: 'happy', cards: [{ type: 'reminders', reminders: list.length === reminders.length ? list : reminders, plan }], quickReplies: nextSteps(patientId),
  })];
}

function visitConfirm(patientId: string): Out {
  const { lang, D } = L(patientId);
  const visit = svc.confirmVisit(patientId);
  return [msg(D.visitConfirmed(fmtDateTime(visit.startsAt, lang), visit.clinic), { mood: 'happy', quickReplies: nextSteps(patientId) })];
}

function cancelStart(patientId: string): Out {
  const { lang, D } = L(patientId);
  svc.ctx(patientId).journey.dialog.stage = 'cancel_reason';
  // Причина в действии — по-русски (её читает координатор), подпись — на языке пациента.
  return [msg(D.cancelAsk, { quickReplies: CANCEL_REASONS.map(r => qr(r[lang], { type: 'visit_cancel', reason: r.ru })) })];
}

function cancelDo(patientId: string, reason: string): Out {
  const { D } = L(patientId);
  svc.ctx(patientId).journey.dialog.stage = 'idle';
  const known = CANCEL_REASONS.find(r => r.ru === reason || r.kk === reason);
  svc.cancelVisit(patientId, known ? known.ru : reason, true);
  return [msg(D.cancelDone, { quickReplies: [qr(D.menu, { type: 'menu' })] })];
}

function reportSampleQR(D: DialogDict): QuickReply[] {
  return [qr(D.sampleNormal, { type: 'report_sample', sample: 'normal' }), qr(D.sampleFinding, { type: 'report_sample', sample: 'finding' }), qr(D.sampleUrgent, { type: 'report_sample', sample: 'urgent' })];
}

function reportStart(patientId: string): Out {
  const { D } = L(patientId);
  svc.ctx(patientId).journey.dialog.stage = 'report_input';
  return [msg(D.reportAsk, { mood: 'listening', quickReplies: reportSampleQR(D) })];
}

async function reportExplain(patientId: string, text: string, source: 'sample' | 'pasted', mode: Mode = 'text'): Promise<Out> {
  svc.ctx(patientId).journey.dialog.stage = 'idle';
  // explainReport строит объяснение на языке пациента (profile.lang).
  const report = await svc.explainReport(patientId, text, source);
  return reportMessages(patientId, report, mode);
}

/** Первое предложение текста — для голосового режима. */
const firstSentence = (t: string) => (t.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? t).trim();

/**
 * Сообщения по разобранному заключению. Тревожность — из правил (report.level).
 * follow_up / urgent → сразу предлагаем ближайшее время рекомендованного специалиста
 * (запись только после явного «да»).
 */
function reportMessages(patientId: string, report: ReportExplanation, mode: Mode): Out {
  const { lang, D } = L(patientId);
  const out: Out = [];
  const lead = report.level === 'routine' ? D.reportLeadRoutine : report.level === 'urgent' ? D.reportLeadUrgent : D.reportLeadFollow;
  const summary = mode === 'voice' ? firstSentence(report.summary) : report.summary;
  out.push(msg(`${lead} ${summary}`, { mood: report.level === 'routine' ? 'happy' : 'concerned', by: report.summaryBy, cards: [{ type: 'report', report }] }));
  const spec = specText(report.recommendedSpecialty, lang);
  if (report.level === 'urgent') {
    out.push(msg(D.reportUrgent(spec), { mood: 'concerned' }));
    out.push(...proposeBooking(patientId, report.recommendedSpecialty, { urgent: true, mode }));
  } else if (report.level === 'follow_up') {
    out.push(...proposeBooking(patientId, report.recommendedSpecialty, { urgent: false, mode, lead: D.reportFollowLead(spec) }));
  } else {
    out.push(msg(D.reportRoutine, { quickReplies: [qr(D.bookNeurologist, { type: 'booking_start', specialty: 'Невролог' }), qr(D.menu, { type: 'menu' })] }));
  }
  return out;
}

/** Заключение уже разобрано через POST /api/me/report («Документы») — показываем разбор в чате. */
function reportUploaded(patientId: string, mode: Mode): Out {
  const { D } = L(patientId);
  svc.ctx(patientId).journey.dialog.stage = 'idle';
  const report = svc.patientView(patientId).journey.lastReport;
  if (!report) return [msg(D.reportNotFound, { mood: 'thinking', quickReplies: [qr(D.openDocuments, { type: 'open_page', page: 'documents' }), qr(D.explainReport, { type: 'report_start' }), qr(D.menu, { type: 'menu' })] })];
  return reportMessages(patientId, report, mode);
}

// ---------------- Запись к специалисту по тревожным формулировкам ----------------

/** Специальность из id слота «slot-<специальность>-<врач>-<дата>-<время>» (в названии может быть дефис: «ЛОР-врач»). */
function slotSpecialty(slotId: string | undefined): string | undefined {
  if (!slotId) return undefined;
  return [...SPECIALTIES].sort((a, b) => b.length - a.length).find(s => slotId.startsWith(`slot-${s}-`)) ?? slotId.split('-')[1];
}

/**
 * Сразу предлагает ближайший слот рекомендованной специальности: stage=booking_confirm,
 * pendingSlotId. Запись — только после явного «да» (кнопка или голос), молча не записываем.
 * urgent → ищем ближайшее время начиная с сегодняшнего дня.
 */
function proposeBooking(patientId: string, specialty: string | undefined, o: { urgent: boolean; mode: Mode; lead?: string }): Out {
  const { journey, db } = svc.ctx(patientId);
  const { lang, D } = L(patientId);
  const lead = o.lead ? `${o.lead} ` : '';
  if (!specialty || !SPECIALTIES.includes(specialty)) {
    return [msg(`${lead}${D.bookViaCoordinator(specialtyLabel(specialty, lang))}`, { mood: 'neutral', quickReplies: [qr(D.yesSend, { type: 'human' }), qr(D.notNow, { type: 'menu' })] })];
  }
  const slot = listSlots(specialty, now(), db.bookings, o.urgent)[0];
  if (!slot) return [msg(`${lead}${D.noSlots}`, { quickReplies: [qr(D.sendToCoordinator, { type: 'human' })] })];
  journey.dialog.stage = 'booking_confirm';
  journey.dialog.pendingSlotId = slot.id;
  const text = D.proposeBooking(specDative(specialty, lang), fmtDateTime(slot.startsAt, lang), doctorLabel(slot.doctor, lang), slot.format === 'online', o.urgent);
  // В голосе вопрос о записи идёт первым: вводная фраза уже прозвучала в предыдущем сообщении.
  return [msg(o.mode === 'voice' ? text : `${lead}${text}`, {
    mood: o.urgent ? 'concerned' : 'neutral',
    quickReplies: [qr(D.bookYes, { type: 'booking_confirm' }), qr(D.otherTime, { type: 'booking_start', specialty }), qr(D.notNow, { type: 'menu' })],
  })];
}

function bookingDecline(patientId: string, specialty?: string): Out {
  const { journey } = svc.ctx(patientId);
  const { D } = L(patientId);
  journey.dialog.stage = 'idle';
  journey.dialog.pendingSlotId = undefined;
  return [msg(D.bookingDeclined, { quickReplies: [qr(D.otherTime, { type: 'booking_start', specialty }), qr(D.menu, { type: 'menu' })] })];
}

function bookingStart(patientId: string, specialty?: string): Out {
  const { journey, db } = svc.ctx(patientId);
  const { lang, D } = L(patientId);
  const spec = specialty ?? journey.offeredConsultation?.specialty ?? 'Невролог';
  const urgent = journey.lastReport?.level === 'urgent' || latestLab(patientId)?.analysis?.level === 'urgent';
  const slots = listSlots(spec, now(), db.bookings, urgent);
  journey.dialog.stage = 'booking_pick';
  if (!slots.length) return [msg(D.noSlots, { quickReplies: [qr(D.sendToCoordinator, { type: 'human' })] })];
  return [msg(D.slotsIntro(lang === 'ru' ? spec : specText(spec, lang)), { cards: [{ type: 'slots', specialty: spec, slots }] })];
}

function slotPick(patientId: string, slotId: string): Out {
  const { journey, db } = svc.ctx(patientId);
  const { lang, D } = L(patientId);
  const spec = slotSpecialty(slotId) ?? 'Невролог';
  const slot = [...listSlots(spec, now(), db.bookings, true), ...listSlots(spec, now(), db.bookings)].find(s => s.id === slotId);
  if (!slot) return [msg(D.slotTaken), ...bookingStart(patientId, spec)];
  journey.dialog.stage = 'booking_confirm';
  journey.dialog.pendingSlotId = slotId;
  return [msg(D.slotConfirmAsk(doctorLabel(slot.doctor, lang), fmtDateTime(slot.startsAt, lang), slot.format === 'online'), {
    quickReplies: [qr(D.bookYes, { type: 'booking_confirm' }), qr(D.otherTime, { type: 'booking_start', specialty: spec })],
  })];
}

function bookingConfirm(patientId: string): Out {
  const { journey } = svc.ctx(patientId);
  const { lang, D } = L(patientId);
  const slotId = journey.dialog.pendingSlotId;
  if (!slotId) return bookingStart(patientId);
  // Причина записи — для врача и координатора, по-русски.
  const { reason, source } = bookingReason(patientId, slotSpecialty(slotId));
  const booking = svc.bookSlot(patientId, slotId, reason, source);
  journey.dialog.stage = 'idle';
  journey.dialog.pendingSlotId = undefined;
  const bookedText = reason.startsWith('Обсуждение результатов анализов') ? D.bookedLabs : D.booked;
  return [msg(bookedText(specText(booking.specialty, lang), fmtDateTime(booking.startsAt, lang)), {
    mood: 'happy', cards: [{ type: 'booking', booking }], quickReplies: [qr(D.menu, { type: 'menu' })],
  })];
}

/** Почему пациент записывается: свежий анализ вне референса или заключение (для координатора, по-русски). */
function bookingReason(patientId: string, spec?: string): { reason: string; source: 'report_red_flag' | 'patient_request' } {
  const { journey } = svc.ctx(patientId);
  const rep = journey.lastReport;
  const lab = latestLab(patientId);
  const labFlagged = lab?.analysis && lab.analysis.level !== 'ok' && (!rep || rep.level === 'routine' || lab.uploadedAt > rep.createdAt || lab.analysis.recommendedSpecialty === spec);
  if (labFlagged && (!rep || lab!.analysis!.recommendedSpecialty === spec || rep.recommendedSpecialty !== spec)) {
    return { reason: `Обсуждение результатов анализов (${lab!.analysis!.level === 'urgent' ? 'срочно' : 'вне референса'})`, source: 'patient_request' };
  }
  if (rep) return { reason: 'Обсуждение заключения МРТ', source: rep.level !== 'routine' ? 'report_red_flag' : 'patient_request' };
  return { reason: 'Консультация по запросу пациента', source: 'patient_request' };
}

function human(patientId: string, text?: string): Out {
  const { journey } = svc.ctx(patientId);
  const { D } = L(patientId);
  svc.addQuestion(patientId, text || 'Пациент просит связаться с ним');
  journey.dialog.stage = 'idle';
  return [msg(D.humanDone, { quickReplies: [qr(D.menu, { type: 'menu' })] })];
}

function status(patientId: string): Out {
  const { lang, D } = L(patientId);
  const st = svc.patientView(patientId);
  const s = st.journey.screening;
  const vs = st.visit.status === 'confirmed' ? 'confirmed' : st.visit.status === 'rescheduled' ? 'rescheduled' : 'pending';
  const parts = [
    D.statusVisit(fmtDateTime(st.visit.startsAt, lang), vs),
    D.statusScreening(s ? overallText(s.overall, lang) : null),
    D.statusPrep(st.journey.prepChecks.filter(id => st.prepPlan.some(p => p.id === id)).length, st.prepPlan.length),
    D.statusReminders(st.journey.reminderPlan ? reminderPlanLabel(st.journey.reminderPlan, lang) : null),
  ];
  if (st.bookings.length) parts.push(D.statusConsult(specText(st.bookings[0].specialty, lang), fmtShort(st.bookings[0].startsAt, lang)));
  return [msg(parts.join(' '), { quickReplies: nextSteps(patientId) })];
}

// ---------------- v5: пошаговая инструкция с датами ----------------

const DAY = 86_400_000;

/**
 * Понятный план «что и когда сделать»: фазы подготовки → конкретные даты относительно визита,
 * плюс блок «Сейчас» (анкета, креатинин, координатор, подтверждение) и статус напоминаний.
 */
function instruction(patientId: string, mode: Mode): Out {
  const { lang, D } = L(patientId);
  const st = svc.patientView(patientId);
  logEvent({ type: 'prep_plan_viewed', patientId, visitId: st.visit.id, meta: { source: 'instruction' } });
  const start = new Date(st.visit.startsAt);
  const t = now();
  const card: Card = { type: 'prep_plan', items: st.prepPlan, checked: st.journey.prepChecks, visitStartsAt: st.visit.startsAt };
  const menuQR = qr(D.menu, { type: 'menu' });
  if (st.visit.status === 'attended' || start < t) {
    return [msg(D.instrDone, { cards: [card], quickReplies: [qr(D.openDocuments, { type: 'open_page', page: 'documents' }), qr(D.explainReport, { type: 'report_start' }), menuQR] })];
  }
  const j = st.journey;
  const s = j.screening;
  const left = applicableQuestions(patientId).filter(q => !j.answers[q.id]).length;
  const labMissing = labsRequired(j.answers) && j.lab.status !== 'provided';
  const labStale = !labMissing && !!s?.flags.some(f => f.id === 'lab:stale');
  const coordinatorPending = !!s && (s.overall === 'needs_review' || s.overall === 'hold_for_review')
    || st.openTasks.some(x => x.kind === 'screening_review' || x.kind === 'labs_missing');

  // «Сейчас»: то, что блокирует визит или ждёт действия пациента.
  const nowItems: string[] = [];
  if (left > 0) nowItems.push(D.instrScreening(left));
  if (labMissing) nowItems.push(D.instrLabMissing);
  if (labStale) nowItems.push(D.instrLabStale(PROTOCOL.labs.maxAgeDays));
  if (coordinatorPending) nowItems.push(D.instrCoordinator);
  if (st.visit.status === 'rescheduled') nowItems.push(D.instrRescheduled);
  if (st.visit.status === 'scheduled') nowItems.push(D.instrConfirm);

  // Фазы подготовки → даты. Креатинин вынесен в «Сейчас», в фазах его не повторяем.
  const todo = (phase: string) => st.prepPlan.filter(p => p.phase === phase && p.id !== 'labs' && !j.prepChecks.includes(p.id))
    .map(p => lcFirst(p.title.replace(/^(?:после исследования|тексеруден кейін),?\s+/i, '')));
  const today = almatyDate(t);
  const by3 = new Date(start.getTime() - 3 * DAY);
  const eve = new Date(start.getTime() - DAY);
  const lines: { label: string; items: string[] }[] = [];
  const asap: string[] = [];
  if (by3 > t) lines.push({ label: D.instrBy(lang === 'kk' ? fmtDayDat(by3) : fmtDay(by3, lang)), items: todo('before_3d') });
  else asap.push(...todo('before_3d'));
  if (almatyDate(eve) >= today) lines.push({ label: D.instrEve(fmtDay(eve, lang)), items: todo('before_1d') });
  else asap.push(...todo('before_1d'));
  const dayItems = todo('day_of');
  if (!labMissing && j.lab.status === 'provided' && !labStale) dayItems.push(D.instrBringLab);
  lines.push({ label: D.instrDay(fmtDay(start, lang), fmtTime(start)), items: dayItems });
  lines.push({ label: D.instrAfter, items: todo('after') });
  if (asap.length) lines.unshift({ label: D.instrAsap, items: asap });
  if (nowItems.length) lines.unshift({ label: D.instrNow, items: nowItems });
  const filled = lines.filter(l => l.items.length);

  const reminders = D.instrReminders(j.reminderPlan && j.reminderPlan !== 'none' ? reminderPlanLabel(j.reminderPlan, lang) : null);
  const when = fmtDateTime(st.visit.startsAt, lang);
  let text: string;
  if (mode === 'voice') {
    // Голос: первое предложение — дата визита, второе — самое важное сейчас.
    const first = filled[0];
    const main = first ? `${first.label === D.instrNow || first.label === D.instrAsap ? '' : `${lcFirst(first.label)} — `}${first.items.slice(0, 2).join('; ')}` : D.instrAllDone;
    text = `${D.instrVoice(when, main)} ${reminders}`;
  } else {
    const body = filled.length ? filled.map(l => `• ${l.label}: ${l.items.join('; ')}.`) : [`• ${D.instrAllDone}.`];
    text = [D.instrHead(when), ...body, reminders].join('\n');
  }
  const replies: QuickReply[] = [];
  if (!j.reminderPlan) replies.push(qr(D.setReminders, { type: 'reminder_menu' }));
  if (st.visit.status === 'scheduled') replies.push(qr(D.confirmVisit, { type: 'visit_confirm' }));
  if (left > 0) replies.push(qr(Object.keys(j.answers).length ? D.continueScreening : D.startScreening, { type: 'screening_start' }));
  if (labMissing || labStale) replies.push(qr(D.uploadLabs, { type: 'open_page', page: 'documents' }));
  replies.push(menuQR);
  return [msg(text, { mood: nowItems.length ? 'neutral' : 'happy', cards: [card], quickReplies: replies.slice(0, 4) })];
}

// ---------------- v5: анализы из «Документов» ----------------

function latestLab(patientId: string): LabReport | undefined {
  return svc.latestLabReport(patientId);
}

/** Анализ по id: сначала локализованная копия из patientView, затем сырая, затем последний. */
function labById(patientId: string, labId?: string): LabReport | undefined {
  const view = svc.patientView(patientId).journey.labReports ?? [];
  const raw = svc.ctx(patientId).journey.labReports ?? [];
  return (labId ? view.find(r => r.id === labId) ?? raw.find(r => r.id === labId) : undefined) ?? latestLab(patientId);
}

/** Без финальной точки — для вставки внутрь фразы. */
const clip = (t: string) => t.trim().replace(/[.\s]+$/, '');
/** Отдельное предложение: заглавная буква и точка в конце. */
const asSentence = (t: string) => { const c = clip(t); return c ? `${c.charAt(0).toUpperCase()}${c.slice(1)}.` : ''; };

const OUT_OF_RANGE = new Set(['low', 'high', 'critical_low', 'critical_high', 'abnormal']);

/** Показатели вне референса лаборатории — понятными словами. */
function flaggedLabItems(report: LabReport) {
  const expl = new Map((report.analysis?.items ?? []).map(e => [e.itemId, e]));
  return report.items
    .filter(i => OUT_OF_RANGE.has(i.status))
    .sort((a, b) => Number(b.status.startsWith('critical')) - Number(a.status.startsWith('critical')))
    .map(i => {
      const e = expl.get(i.id);
      return { item: i, e, phrase: `${e?.title ?? i.name} ${i.valueText}${i.unit ? ` ${i.unit}` : ''} — ${lcFirst(clip(e?.statusText ?? i.labFlag ?? i.status))}` };
    });
}

function labsHowTo(patientId: string): Out {
  const { D } = L(patientId);
  return [msg(D.labsHowTo, { quickReplies: [qr(D.uploadLabs, { type: 'open_page', page: 'documents' }), qr(D.stepByStep, { type: 'instruction' }), qr(D.menu, { type: 'menu' })] })];
}

/** Пациент загрузил и подтвердил анализ → итог, влияние на МРТ, рекомендации, при необходимости — запись. */
function labUploaded(patientId: string, labId: string | undefined, mode: Mode): Out {
  const { journey } = svc.ctx(patientId);
  const { D } = L(patientId);
  journey.dialog.stage = 'idle';
  const docsQR = qr(D.openDocuments, { type: 'open_page', page: 'documents' });
  const report = labById(patientId, labId);
  if (!report) return [msg(D.labNotFound, { mood: 'thinking', quickReplies: [docsQR, qr(D.menu, { type: 'menu' })] })];
  const card: Card = { type: 'lab_report', report };
  const a = report.analysis;
  if (!report.confirmed || !a) return [msg(D.labNotConfirmed, { cards: [card], quickReplies: [docsQR] })];

  const flagged = flaggedLabItems(report);
  const list = flagged.slice(0, mode === 'voice' ? 2 : 3).map(f => f.phrase).join('; ');
  // Уровень — из правил анализа; если показателей вне референса не нашли, берём сводку анализа.
  const lead = !flagged.length ? (a.level === 'ok' ? D.labLeadOk : a.summary)
    : a.level === 'urgent' ? D.labLeadUrgent(list) : a.level === 'attention' ? D.labLeadAttention(list) : a.summary;
  // Влияние на МРТ: креатинин → рСКФ считают правила screening.ts, решение — за врачом.
  const view = svc.patientView(patientId);
  const needCreatinine = labsRequired(view.journey.answers) && view.journey.lab.status !== 'provided';
  const mri = a.mri?.appliedToScreening ? D.labMriApplied(a.mri.egfr ?? view.journey.screening?.egfr)
    : a.mri?.creatinineUmolL ? D.labMriNotApplied(PROTOCOL.labs.maxAgeDays)
    : needCreatinine ? D.labMriMissing : '';
  const recs = lcFirst(a.recommendations.slice(0, 2).join(' '));
  const parts = mode === 'voice'
    ? [lead, mri]
    : [lead, mri, recs ? D.labRecs(recs) : '', a.level === 'urgent' ? D.labUrgentSafety : '', D.labDisclaimer];
  const out: Out = [msg(parts.filter(Boolean).join(' '), {
    mood: a.level === 'ok' ? 'happy' : 'concerned',
    cards: [card],
    quickReplies: a.level === 'ok' ? [qr(D.stepByStep, { type: 'instruction' }), qr(D.menu, { type: 'menu' })] : undefined,
  })];
  if (a.level !== 'ok') {
    out.push(...proposeBooking(patientId, a.recommendedSpecialty, { urgent: a.level === 'urgent', mode, lead: mode === 'voice' && a.level === 'urgent' ? D.labUrgentSafety : undefined }));
  }
  return out;
}

// ---------------- v5: вопросы о своих документах без LLM ----------------

const normQ = (t: string) => foldKk(t.toLowerCase().replace(/ё/g, 'е'));
const LAB_STOP = new Set(['анализ', 'общий', 'крови', 'кровь', 'сыворотке', 'сыворотка', 'уровень', 'показатель', 'количество', 'талдау', 'жалпы', 'кан', 'деңгейі']);

/** Совпадает ли показатель анализа с вопросом («мой гемоглобин», «гемоглобинім», «HGB»). */
function mentionsLabItem(q: string, names: (string | undefined)[]): boolean {
  for (const name of names) {
    if (!name) continue;
    for (const raw of normQ(name).split(/[^a-zа-я0-9]+/i)) {
      if (raw.length < 3 || LAB_STOP.has(raw)) continue;
      if (raw.length >= 6 ? q.includes(raw.slice(0, Math.min(8, raw.length - 2))) : new RegExp(`(?:^|[^a-zа-я])${raw}(?:[^a-zа-я]|$)`, 'i').test(q)) return true;
    }
  }
  return false;
}

/**
 * Ответ из собственных документов пациента, если в вопросе есть термин из его заключения
 * или показатель из его анализа. Ничего не придумываем: только словарь клиники и бланк.
 */
function docsAnswer(patientId: string, text: string): Out | null {
  const { lang, D } = L(patientId);
  const view = svc.patientView(patientId);
  const q = normQ(text);
  const report = view.journey.lastReport;
  if (report) {
    const asked = findTerms(text, lang).map(h => h.term);
    for (const term of asked) {
      const sentence = report.sentences.find(x => x.terms.some(h => h.term === term));
      const hit = sentence?.terms.find(h => h.term === term);
      if (sentence && hit) {
        const spec = report.recommendedSpecialty ?? 'Невролог';
        return [msg(D.docTermAnswer(term, hit.plain.replace(/[.\s]+$/, ''), sentence.plain), {
          cards: [{ type: 'report', report }],
          quickReplies: [qr(D.bookSpecialty(spec), { type: 'booking_start', specialty: spec }), qr(D.askCoordinator, { type: 'human' })],
        })];
      }
    }
  }
  const lab = view.journey.labReports?.find(r => r.id === latestLab(patientId)?.id) ?? latestLab(patientId);
  if (lab?.analysis) {
    const expl = new Map(lab.analysis.items.map(e => [e.itemId, e]));
    const item = lab.items.find(i => mentionsLabItem(q, [expl.get(i.id)?.title, i.name, i.code]));
    if (item) {
      const e = expl.get(item.id);
      const status = clip(e?.statusText ?? item.status);
      // Референс — только из бланка; если он уже есть в statusText, не повторяем.
      const ref = /\d/.test(status) ? '' : item.refText ?? (item.refLow !== undefined || item.refHigh !== undefined ? `${item.refLow ?? '…'}–${item.refHigh ?? '…'}` : '');
      const spec = lab.analysis.recommendedSpecialty && SPECIALTIES.includes(lab.analysis.recommendedSpecialty) ? lab.analysis.recommendedSpecialty : undefined;
      return [msg(D.labItemAnswer(e?.title ?? item.name, `${item.valueText}${item.unit ? ` ${item.unit}` : ''}`, lcFirst(status), ref, asSentence(e?.plain ?? ''), asSentence(e?.advice ?? '')), {
        cards: [{ type: 'lab_report', report: lab }],
        quickReplies: [...(spec ? [qr(D.bookSpecialty(spec), { type: 'booking_start', specialty: spec } as AssistantAction)] : []), qr(D.askCoordinator, { type: 'human' })],
      })];
    }
  }
  // Общий вопрос о своих документах без конкретного термина — краткий итог из них же.
  if (OWN_DOCS.test(q)) {
    if (report && /заключени|корытынды/.test(q)) {
      const lead = report.level === 'routine' ? D.reportLeadRoutine : report.level === 'urgent' ? D.reportLeadUrgent : D.reportLeadFollow;
      return [msg(`${lead} ${report.summary}`, { by: report.summaryBy, cards: [{ type: 'report', report }], quickReplies: [qr(D.askCoordinator, { type: 'human' }), qr(D.menu, { type: 'menu' })] })];
    }
    if (lab?.analysis) {
      const flagged = flaggedLabItems(lab);
      const lead = !flagged.length ? (lab.analysis.level === 'ok' ? D.labLeadOk : lab.analysis.summary) : lab.analysis.level === 'urgent' ? D.labLeadUrgent(flagged.slice(0, 3).map(f => f.phrase).join('; ')) : D.labLeadAttention(flagged.slice(0, 3).map(f => f.phrase).join('; '));
      return [msg(`${lead} ${D.labDisclaimer}`, { cards: [{ type: 'lab_report', report: lab }], quickReplies: [qr(D.askCoordinator, { type: 'human' }), qr(D.menu, { type: 'menu' })] })];
    }
  }
  return null;
}

// Вопрос о собственных документах: «в моём заключении», «мои анализы», «қорытындымда», «талдауым».
const OWN_DOCS = /мо(?:й|е|ем|его|ей|и|их|им)\s+(?:\S+\s+)?(?:заключени|анализ|результат|показател|бланк)|(?:заключени|анализ)\S*\s+(?:у меня|мо(?:е|и|ем|их))|корытындым|корытындыда|талдау(?:ым|ларым|ымда|ымдагы|ымды)|натижелерим|натижем/;

/** Сводки документов для разговорного агента (готовит services.ts; при ошибке — без них). */
function docsForAgent(patientId: string, lang: Lang): { report?: string; labs?: string } {
  const safe = (f: () => string) => { try { return f() || undefined; } catch { return undefined; } };
  return { report: safe(() => svc.reportSummaryForAgent(patientId, lang)), labs: safe(() => svc.labsSummaryForAgent(patientId, lang)) };
}

async function freeQuestion(patientId: string, text: string, mode: 'text' | 'voice' = 'text', history: AssistantMessage[] = []): Promise<Out> {
  const { profile, visit } = svc.ctx(patientId);
  const { lang, D } = L(patientId);
  logEvent({ type: 'assistant_question', patientId, visitId: visit.id });
  if (isClinicalDecisionRequest(text)) {
    return [msg(clinicalDecisionText(lang), { mood: 'neutral', quickReplies: [qr(D.askCoordinator, { type: 'human' }), qr(D.bookDoctor, { type: 'booking_start' })] })];
  }
  // Поиск по ru и kk ключевым словам; карточки возвращаются на языке пациента.
  const hits = retrieve(text, 2, lang);
  const sources: Card[] = hits.length ? [{ type: 'sources', items: hits.map(h => ({ id: h.card.id, title: h.card.title, version: h.card.version })) }] : [];
  // 1) Разговорный агент: контекст маршрута + вся база знаний + белый список действий.
  const agent = await agentReply(text, svc.patientView(patientId), history, now().toISOString(), mode, lang, assistantName(profile.avatar, lang), docsForAgent(patientId, lang));
  if (agent) {
    const lead = msg(agent.reply, { by: 'llm', mood: agent.action ? 'happy' : 'neutral', cards: agent.action ? undefined : sources, quickReplies: agent.action ? undefined : nextSteps(patientId).slice(0, 3) });
    if (agent.action) return [lead, ...(await handleAction(patientId, agent.action, mode))];
    return [lead];
  }
  // 2) Без LLM: вопрос о термине/показателе из своих документов — ответ из этих данных.
  const fromDocs = docsAnswer(patientId, text);
  if (fromDocs) return fromDocs;
  // 3) Ответ из карточки знаний как есть — ничего не придумываем.
  if (!hits.length) {
    return [msg(D.noVerifiedAnswer, { mood: 'thinking', quickReplies: [qr(D.yesSend, { type: 'human' }), qr(D.menu, { type: 'menu' })] })];
  }
  return [msg(hits[0].card.answer, { by: 'rules', cards: sources })];
}

// ---------------- Роутинг ----------------

async function handleAction(patientId: string, a: AssistantAction, mode: Mode = 'text'): Promise<Out> {
  const dialog = svc.ctx(patientId).journey.dialog;
  // Предложенная запись ждёт явного «да». Если пациент ушёл в другую тему — «да» позже не должно записывать молча.
  if (dialog.stage === 'booking_confirm' && !['booking_confirm', 'slot_pick', 'booking_start'].includes(a.type)) dialog.stage = 'idle';
  switch (a.type) {
    case 'start': return greet(patientId);
    case 'menu': dialog.stage = 'idle'; dialog.pendingSlotId = undefined; return [msg(L(patientId).D.menuPrompt, { quickReplies: nextSteps(patientId) })];
    case 'screening_start': return startScreening(patientId);
    case 'answer': return onAnswer(patientId, a.value);
    case 'lab_has': return onLabHas(patientId, a.value);
    case 'lab_date_preset': { const d = new Date(now()); d.setDate(d.getDate() - a.daysAgo); return onLabDate(patientId, d.toISOString().slice(0, 10)); }
    // Анкета не заполнена — итог показывать рано, продолжаем вопросы.
    case 'show_screening': return applicableQuestions(patientId).some(q => !svc.ctx(patientId).journey.answers[q.id]) ? startScreening(patientId) : summary(patientId);
    case 'prep': return prep(patientId);
    case 'reminder_menu': return reminderMenu(patientId);
    case 'reminder_set': return reminderSet(patientId, a.plan);
    case 'visit_confirm': return visitConfirm(patientId);
    case 'visit_cancel_start': return cancelStart(patientId);
    case 'visit_cancel': return cancelDo(patientId, a.reason);
    case 'report_start': return reportStart(patientId);
    case 'report_sample': return reportExplain(patientId, REPORT_SAMPLES[a.sample], 'sample', mode);
    case 'booking_start': return bookingStart(patientId, a.specialty);
    case 'slot_pick': return slotPick(patientId, a.slotId);
    case 'booking_confirm': return bookingConfirm(patientId);
    case 'human': return human(patientId);
    case 'status': return status(patientId);
    // open_page обрабатывается на клиенте (открыть раздел приложения).
    case 'open_page': return [];
    case 'instruction': return instruction(patientId, mode);
    case 'lab_uploaded': return labUploaded(patientId, a.labId, mode);
    case 'report_uploaded': return reportUploaded(patientId, mode);
  }
}

// «Инструкция», «что мне делать», «по шагам»; «нұсқаулық», «не істеуім керек» (в свёрнутом виде, см. foldKk).
const INSTRUCTION_RE = /инструкц|что (?:же )?(?:мне )?(?:теперь )?(?:делать|нужно сделать|надо сделать)|по шагам|пошагов|план действий|нускаулы[кг]|не истеуим керек|не истеу керек|не истеуим|не истеймин|кадам(?:-| )кадам|кадамдап/;
const INSTRUCTION_EXCLUDE = /если|егер/;
// «Загрузить анализ», «анализы», «нәтижелер», «талдау», «талдауды жүктеу».
const LABS_UPLOAD_RE = /(?:загруз|прикреп|отправ|скин|сфотограф|добав)\S*\s+(?:\S+\s+)?(?:анализ|бланк)|(?:жукте|жибер|сурет)\S*\s+(?:\S+\s+)?талдау|талдау\S*\s+(?:\S+\s+)?(?:жукте|жибер|косу|салу)/;
const LABS_SHORT_RE = /^(?:мои |мой )?(?:анализы?|результаты анализов|бланк анализов?)$|^(?:менин )?(?:талдау\S*|натижелер\S*)$/;
const normText = (t: string) => normQ(t).replace(/[!?.,;:()«»"]/g, ' ').replace(/\s+/g, ' ').trim();

const INTENT_ACTION: Partial<Record<Intent, AssistantAction>> = {
  screening: { type: 'screening_start' }, prep: { type: 'prep' }, reminder: { type: 'reminder_menu' }, report: { type: 'report_start' },
  booking: { type: 'booking_start' }, cancel: { type: 'visit_cancel_start' }, confirm: { type: 'visit_confirm' }, status: { type: 'status' }, menu: { type: 'menu' },
};

// «Как дела?» / «Қалыңыз қалай?» в приветствии.
const HOW_ARE_YOU = /как (?:дела|ты|поживаешь)|қалыңыз қалай|қалайсыз|жағдайыңыз қалай|халіңіз қалай|калыныз калай|калайсыз/i;

async function handleText(patientId: string, raw: string, mode: 'text' | 'voice', history: AssistantMessage[]): Promise<Out> {
  const text = raw.trim().slice(0, 6000);
  const { journey, visit, profile } = svc.ctx(patientId);
  const { lang, D } = L(patientId);
  const stage = journey.dialog.stage;

  if (detectEmergency(text)) {
    logEvent({ type: 'emergency_detected', patientId, visitId: visit.id });
    svc.addQuestion(patientId, `СРОЧНО: пациент сообщил о симптомах в чате: «${text.slice(0, 200)}»`);
    return [msg(emergencyText(lang), { mood: 'concerned', cards: [{ type: 'emergency' }] })];
  }

  // Длинный текст с терминами МРТ — это заключение, даже вне этапа report_input.
  const looksLikeReport = text.length > 80 && /(мр|томограм|срединн|желудоч|очаг|вещества мозга|заключени)/i.test(text);
  if (stage === 'report_input' || looksLikeReport) {
    if (text.length >= 40) return reportExplain(patientId, text, 'pasted');
    if (stage === 'report_input' && detectIntent(text) === 'unknown') return [msg(D.reportTooShort, { quickReplies: reportSampleQR(D) })];
  }

  if (stage === 'screening') {
    const a = parseAnswer(text);
    if (a) return onAnswer(patientId, a);
    const intent = detectIntent(text);
    if (intent === 'question' || intent === 'unknown') {
      const current = applicableQuestions(patientId)[journey.dialog.qIndex];
      const llm = intent === 'unknown' ? await classify(text, D.classifyStage(current ? qText(current.id, lang).text : ''), lang) : null;
      if (llm?.answer && ['yes', 'no', 'unknown'].includes(llm.answer)) return onAnswer(patientId, llm.answer as Answer);
      const answer = await freeQuestion(patientId, text, mode, history);
      return [...answer, ...askQuestion(patientId, D.backToScreening)];
    }
  }
  if (stage === 'lab_has') { const a = parseAnswer(text); if (a) return onLabHas(patientId, a); if (/\d/.test(text)) { onLabHas(patientId, 'yes'); return onLabValue(patientId, text); } }
  if (stage === 'lab_value') return onLabValue(patientId, text);
  if (stage === 'lab_date') return onLabDate(patientId, parseLabDate(text, now()));
  if (stage === 'booking_confirm') {
    const spec = slotSpecialty(journey.dialog.pendingSlotId);
    const n = normText(text);
    if (/друго[ей] (?:время|день|дату)|баска (?:уакыт|кун)/.test(n)) return bookingStart(patientId, spec);
    if (/не сейчас|потом|не надо|не нужно|казир емес|кейин|керек емес/.test(n)) return bookingDecline(patientId, spec);
    const a = parseAnswer(text);
    if (a === 'yes') return bookingConfirm(patientId);
    if (a === 'no') return bookingDecline(patientId, spec);
    // Другая тема: «да» позже не должно записывать молча.
    journey.dialog.stage = 'idle';
  }
  if (stage === 'cancel_reason' && text.length > 2) return cancelDo(patientId, text.slice(0, 200));

  // v5: пошаговая инструкция, загрузка анализов, вопросы о своих документах.
  const n = normText(text);
  if (INSTRUCTION_RE.test(n) && !INSTRUCTION_EXCLUDE.test(n)) return instruction(patientId, mode);
  if (LABS_UPLOAD_RE.test(n) || (text.length <= 40 && LABS_SHORT_RE.test(n))) return labsHowTo(patientId);
  if (isQuestion(text) && (OWN_DOCS.test(n) || docsAnswer(patientId, text))) return freeQuestion(patientId, text, mode, history);

  const intent = detectIntent(text);
  if (intent === 'greeting' && text.length < 30) return [msg(D.greetShort(profile.onboarding?.preferredName ?? '', HOW_ARE_YOU.test(text)), { mood: 'happy', quickReplies: nextSteps(patientId) })];
  if (intent === 'thanks' && text.length < 25) return [msg(D.thanksReply, { mood: 'happy', quickReplies: nextSteps(patientId) })];
  if (intent === 'human') return human(patientId, text);
  const act = INTENT_ACTION[intent];
  // «Можно ли есть перед МРТ?» содержит слово «подготов» редко — вопросы идут в базу знаний.
  if (act && !(intent === 'prep' && /\?$/.test(text))) return handleAction(patientId, act, mode);
  return freeQuestion(patientId, text, mode, history);
}

export async function handleChat(patientId: string, req: ChatRequest): Promise<AssistantMessage[]> {
  const db = getDb();
  const history = (db.chats[patientId] ??= []);
  const incoming: AssistantMessage[] = [];
  let out: Out;
  if (req.text && req.text.trim()) {
    incoming.push({ id: newId('m'), role: 'user', text: req.text.trim().slice(0, 6000), at: now().toISOString() });
    out = await handleText(patientId, req.text, req.mode ?? 'text', history.slice(-12));
  } else if (req.action) {
    const label = actionLabel(req.action, langOf(patientId));
    if (label) incoming.push({ id: newId('m'), role: 'user', text: label, at: now().toISOString() });
    out = await handleAction(patientId, req.action, req.mode ?? 'text');
  } else {
    out = [];
  }
  history.push(...incoming, ...out);
  if (history.length > 200) history.splice(0, history.length - 200);
  persist();
  return [...incoming, ...out];
}

/** Эхо нажатой кнопки в ленте чата — на языке пациента. */
export function actionLabel(a: AssistantAction, lang: Lang = 'ru'): string | null {
  const D = dt(lang);
  switch (a.type) {
    case 'answer': return a.value === 'yes' ? D.yes : a.value === 'no' ? D.no : D.dontKnow;
    case 'lab_has': return a.value === 'yes' ? D.hasResult : a.value === 'no' ? D.notYet : D.dontKnow;
    case 'lab_date_preset': return a.daysAgo <= 3 ? D.presetThisWeek : a.daysAgo <= 14 ? D.preset12 : a.daysAgo <= 30 ? D.preset34 : D.presetMonthEcho;
    case 'reminder_set': return reminderPlanLabel(a.plan, lang);
    case 'visit_cancel': return cancelReasonLabel(a.reason, lang);
    case 'report_sample': return a.sample === 'normal' ? D.sampleNormal : a.sample === 'finding' ? D.sampleFinding : D.sampleUrgent;
    case 'screening_start': return D.echoScreening;
    case 'prep': return D.echoPrep;
    case 'reminder_menu': return D.echoReminders;
    case 'visit_confirm': return D.echoConfirm;
    case 'visit_cancel_start': return D.echoCancel;
    case 'report_start': return D.echoReport;
    case 'booking_start': return D.echoBooking;
    case 'slot_pick': return D.echoSlot;
    case 'booking_confirm': return D.bookYes;
    case 'human': return D.contactCoordinator;
    case 'status': return D.whatsLeft;
    case 'instruction': return D.echoInstruction;
    case 'lab_uploaded': return D.echoLabUploaded;
    case 'report_uploaded': return D.echoReportUploaded;
    default: return null;
  }
}
