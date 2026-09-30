// Локализация серверного контента для пациента (ru/kk).
// Данные в хранилище и тексты для персонала остаются на русском;
// перевод применяется на выходе к КОПИИ состояния пациента (хранимые объекты не меняются).

import type { Lang } from '../../shared/i18n';
import type { Achievement, Booking, PatientState, Progress, Reminder, ReportExplanation, StaffTask, Visit } from '../../shared/types';
import { flagText, prepText, procedureText, violationText } from './index';
import { ACHIEVEMENT_KK, ASSISTANT_CASES_KK, LEVEL_KK } from './kk/gamification';
import { KNOWLEDGE_KK } from './kk/knowledge';
import { BOOKING_REASON_KK, TASK_TITLE_KK } from './kk/protocol';
import { localizeAddress, REMINDER_OFFSET_HOURS, reminderContent } from '../domain/prep';
import { analyzeReport, reportLang } from '../domain/report';

const HOUR = 3_600_000;

/**
 * Объяснение заключения на нужном языке. Если оно было построено на другом языке,
 * разбор повторяется по исходным предложениям (детекция детерминирована, результат тот же);
 * пересказ LLM был на прежнем языке, поэтому вместо него — пересказ по правилам.
 */
export function localizeReport(report: ReportExplanation, lang: Lang): ReportExplanation {
  if (reportLang(report) === lang) return report;
  const text = report.sentences.map(s => s.text).join('\n');
  return analyzeReport(text, report.source, report.id, new Date(report.createdAt), lang);
}

/** Напоминание на языке пациента: текст строится заново по виду напоминания. */
export function localizeReminder(r: Reminder, visit: Pick<Visit, 'clinic' | 'address'>, lang: Lang): Reminder {
  if (lang === 'ru') return r;
  const offset = REMINDER_OFFSET_HOURS[r.kind];
  if (offset === undefined) return r;
  // Время визита — то, с которым напоминание было создано.
  const startsAt = new Date(new Date(r.dueAt).getTime() + offset * HOUR).toISOString();
  const v = { startsAt, clinic: visit.clinic, address: visit.address };
  const labsPending = r.kind === 'labs_docs' && r.body === reminderContent('labs_docs', v, true, 'ru').body;
  return { ...r, ...reminderContent(r.kind, v, labsPending, lang) };
}

export function localizeReminders(list: Reminder[], visit: Pick<Visit, 'clinic' | 'address'>, lang: Lang): Reminder[] {
  return lang === 'ru' ? list : list.map(r => localizeReminder(r, visit, lang));
}

function localizeProgress(p: Progress, state: PatientState): Progress {
  const cases = ASSISTANT_CASES_KK[state.profile.avatar ?? 'aruzhan'] ?? ASSISTANT_CASES_KK.aruzhan;
  const fill = (t: string) => t.replace(/\{(name|dat|abl)\}/g, (_, k: 'name' | 'dat' | 'abl') => cases[k]);
  const achievements: Achievement[] = p.achievements.map(a => {
    const kk = ACHIEVEMENT_KK[a.id];
    return kk ? { ...a, title: kk.title, description: fill(kk.description), hint: fill(kk.hint) } : { ...a };
  });
  return {
    ...p,
    levelTitle: LEVEL_KK[p.levelTitle] ?? p.levelTitle,
    nextLevelTitle: p.nextLevelTitle && (LEVEL_KK[p.nextLevelTitle] ?? p.nextLevelTitle),
    achievements,
  };
}

/** Обращения, которые видит пациент: заголовок (и текст системных вопросов) на его языке. */
function localizeTask(t: StaffTask, state: PatientState, lang: Lang): StaffTask {
  let title = TASK_TITLE_KK[t.title];
  if (!title && (t.kind === 'screening_review' || t.kind === 'labs_missing')) {
    const flags = state.journey.screening?.flags ?? [];
    title = t.title.split('; ').map(part => { const f = flags.find(x => x.title === part); return f ? flagText(f, lang).title : part; }).join('; ');
  }
  let details = t.details;
  if (t.kind === 'patient_question') {
    details = TASK_TITLE_KK[details] ?? details.replace(/^СРОЧНО: пациент сообщил о симптомах в чате:/, 'ШҰҒЫЛ: пациент чатта белгілер туралы хабарлады:');
  }
  return { ...t, title: title ?? t.title, details };
}

const localizeBooking = (b: Booking): Booking => ({ ...b, reason: BOOKING_REASON_KK[b.reason] ?? b.reason });

export function localizeState(state: PatientState, lang: Lang): PatientState {
  const report = state.journey.lastReport;
  if (lang === 'ru') {
    // Заключение могло быть объяснено на казахском до смены языка.
    return report && reportLang(report) !== 'ru' ? { ...state, journey: { ...state.journey, lastReport: localizeReport(report, 'ru') } } : state;
  }
  const { journey, visit } = state;
  return {
    ...state,
    visit: { ...visit, procedure: procedureText(lang, visit.procedure), address: localizeAddress(visit.address, lang) },
    journey: {
      ...journey,
      screening: journey.screening && { ...journey.screening, flags: journey.screening.flags.map(f => ({ ...f, ...flagText(f, lang) })) },
      dayOfCheck: journey.dayOfCheck && { ...journey.dayOfCheck, issues: journey.dayOfCheck.issues.map(i => violationText(i, lang)) },
      lastReport: report && localizeReport(report, lang),
    },
    prepPlan: state.prepPlan.map(p => ({ ...p, ...prepText(p.id, lang) })),
    reminders: localizeReminders(state.reminders, visit, lang),
    bookings: state.bookings.map(localizeBooking),
    openTasks: state.openTasks.map(t => localizeTask(t, state, lang)),
    progress: localizeProgress(state.progress, state),
    tips: state.tips.map(t => { const kk = KNOWLEDGE_KK[t.id]; return kk ? { id: t.id, title: kk.title, answer: kk.answer } : { ...t }; }),
  };
}
