import type { Journey, PrepItem, Reminder, ReminderPlan, Visit } from '../../shared/types';
import { LOCALE, type Lang } from '../../shared/i18n';
import { ADDRESS_KK, REMINDER_KK } from '../i18n/kk/protocol';
import { BASE_PREP, PREP_BANK, PROTOCOL, SCREENING } from './protocol';
import { labsRequired } from './screening';

const PHASE_ORDER: PrepItem['phase'][] = ['before_3d', 'before_1d', 'day_of', 'after'];

export const PHASE_LABEL: Record<PrepItem['phase'], string> = {
  before_3d: 'За 3 дня',
  before_1d: 'Накануне',
  day_of: 'В день исследования',
  after: 'После исследования',
};

/** Персональный план подготовки: базовые пункты + пункты по ответам анкеты. */
export function buildPrepPlan(journey: Journey): PrepItem[] {
  const ids = new Set(BASE_PREP);
  for (const q of SCREENING) {
    if (journey.answers[q.id] === 'yes' || (journey.answers[q.id] === 'unknown' && q.personalPrep?.includes('implant_card'))) {
      q.personalPrep?.forEach(id => ids.add(id));
    }
  }
  if (!labsRequired(journey.answers)) ids.delete('labs');
  return [...ids]
    .map(id => PREP_BANK[id])
    .filter(Boolean)
    .sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) || Number(Boolean(b.critical)) - Number(Boolean(a.critical)));
}

const HOUR = 3_600_000;

/** За сколько часов до визита приходит напоминание каждого вида. */
export const REMINDER_OFFSET_HOURS: Record<Reminder['kind'], number> = { labs_docs: 72, prep_day_before: 24, leave_home: 3, confirm_visit: 48 };

/** Время визита «ЧЧ:ММ» по Алматы. */
export const visitTime = (iso: string, lang: Lang = 'ru') => new Date(iso).toLocaleTimeString(LOCALE[lang], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Almaty' });

/** Заголовок и текст напоминания на нужном языке (русский — исходный, казахский — перевод). */
export function reminderContent(kind: Reminder['kind'], v: { startsAt: string; clinic: string; address: string }, labsPending: boolean, lang: Lang = 'ru'): { title: string; body: string } {
  const time = visitTime(v.startsAt, lang);
  if (lang === 'kk') {
    switch (kind) {
      case 'labs_docs': return REMINDER_KK.labs_docs(labsPending);
      case 'prep_day_before': return REMINDER_KK.prep_day_before(time);
      case 'leave_home': return REMINDER_KK.leave_home(time, v.clinic, localizeAddress(v.address, lang));
      case 'confirm_visit': return REMINDER_KK.confirm_visit(time);
    }
  }
  switch (kind) {
    case 'labs_docs': return {
      title: 'Через 3 дня — МРТ с контрастом',
      body: labsPending
        ? `Пора сдать анализ на креатинин и найти направление. Прошлые снимки тоже пригодятся.`
        : 'Проверьте направление, документ и прошлые снимки. Если планы изменились — сообщите нам заранее.',
    };
    case 'prep_day_before': return {
      title: `Завтра в ${time} — МРТ с контрастом`,
      body: `Подтвердите визит. Не ешьте за ${PROTOCOL.fastingHours} ч до исследования, воду пить можно. Подготовьте одежду без металла.`,
    };
    case 'leave_home': return {
      title: `Сегодня в ${time} — ${v.clinic}`,
      body: `Приезжайте за ${PROTOCOL.arriveMinutesEarly} минут. ${v.address}. Возьмите направление, документ и результат креатинина.`,
    };
    case 'confirm_visit': return { title: `Подтвердите визит — ${time}`, body: 'Если планы изменились — сообщите нам заранее.' };
  }
}

/** Демо-адрес клиники на языке пациента (имя врача и номер дома не переводятся). */
export function localizeAddress(address: string, lang: Lang): string {
  if (lang !== 'kk') return address;
  return ADDRESS_KK.reduce((a, [ru, kk]) => a.split(ru).join(kk), address);
}

/** Расписание напоминаний относительно времени визита. */
export function buildReminders(visit: Visit, plan: ReminderPlan, journey: Journey): Reminder[] {
  if (plan === 'none') return [];
  const start = new Date(visit.startsAt).getTime();
  const labsPending = labsRequired(journey.answers) && journey.lab.status !== 'provided';
  const make = (kind: Reminder['kind'], suffix: string): Reminder => ({
    id: `${visit.id}-${suffix}`, visitId: visit.id, kind, channel: 'in_app',
    dueAt: new Date(start - REMINDER_OFFSET_HOURS[kind] * HOUR).toISOString(),
    ...reminderContent(kind, visit, labsPending, 'ru'),
  });
  const all: Reminder[] = [make('labs_docs', 'r72'), make('prep_day_before', 'r24'), make('leave_home', 'r3')];
  return plan === 'day_before' ? all.filter(r => r.kind === 'prep_day_before') : all;
}

export const REMINDER_PLAN_LABEL: Record<ReminderPlan, string> = {
  full: 'За 3 дня, за день и за 3 часа',
  day_before: 'Только за день',
  none: 'Без напоминаний',
};
