// Бережная геймификация (см. docs/DEVELOPMENT_ROADMAP.md, этап 9):
// звёзды и значки ТОЛЬКО за организационные действия под контролем пациента.
// Никаких очков за медицинские показатели, результат анализа или «хорошее» заключение,
// никаких рейтингов между пациентами, штрафов, таймеров и серий дней.

import type { Achievement, AppEvent, Journey, PatientProfile, PrepItem, Progress, Visit } from '../../shared/types';
import { AVATAR_NAME } from '../../shared/i18n';

interface Ctx { profile: PatientProfile; journey: Journey; visit: Visit; prepPlan: PrepItem[]; events: AppEvent[]; hasBooking: boolean }

interface Def { id: string; title: string; description: string; icon: string; points: number; hint: string; earned: (c: Ctx) => boolean; visible?: (c: Ctx) => boolean }

const DEFS: Def[] = [
  { id: 'welcome', icon: '👋', points: 10, title: 'Знакомство', description: 'Рассказали {name} о себе', hint: 'Расскажите {name} о себе после регистрации', earned: c => Boolean(c.profile.onboarding) },
  { id: 'safety', icon: '🛡️', points: 20, title: 'Безопасность прежде всего', description: 'Ответили на вопросы о противопоказаниях', hint: 'Пройдите проверку перед МРТ', earned: c => Boolean(c.journey.screening && c.journey.screening.overall !== 'incomplete') },
  { id: 'labs', icon: '🧪', points: 15, title: 'Анализ на месте', description: 'Внесли результат креатинина', hint: 'Добавьте результат анализа на креатинин', earned: c => c.journey.lab.status === 'provided' && Boolean(c.journey.lab.takenOn) },
  { id: 'prep', icon: '🎒', points: 20, title: 'Всё собрано', description: 'Отметили все важные пункты подготовки', hint: 'Отметьте пункты «важно» в плане подготовки', earned: c => c.prepPlan.filter(p => p.critical).every(p => c.journey.prepChecks.includes(p.id)) },
  { id: 'reminders', icon: '⏰', points: 10, title: 'Всё под контролем', description: 'Настроили напоминания о визите', hint: 'Выберите, когда напомнить о визите', earned: c => Boolean(c.journey.reminderPlan && c.journey.reminderPlan !== 'none') },
  { id: 'confirmed', icon: '✅', points: 10, title: 'Слово держу', description: 'Подтвердили визит', hint: 'Подтвердите визит — так клиника спокойнее планирует день', earned: c => ['confirmed', 'attended'].includes(c.visit.status) },
  { id: 'curious', icon: '💬', points: 5, title: 'Любознательность', description: 'Задали {name} вопрос', hint: 'Спросите {name} о чём угодно про исследование', earned: c => c.events.some(e => e.type === 'assistant_question' || e.type === 'assistant_escalated') },
  { id: 'dayof', icon: '🚀', points: 15, title: 'Готовность №1', description: 'Прошли самопроверку в день визита', hint: 'В день МРТ пройдите короткую самопроверку', earned: c => Boolean(c.journey.dayOfCheck) },
  { id: 'report', icon: '📖', points: 10, title: 'Разобрались в заключении', description: 'Прочитали объяснение заключения', hint: 'После МРТ попросите {name} объяснить заключение', earned: c => Boolean(c.journey.lastReport) },
  { id: 'followup', icon: '🤝', points: 15, title: 'Забота о себе', description: 'Записались на рекомендованную консультацию', hint: 'Запишитесь к специалисту, которого рекомендовала {name}', earned: c => c.hasBooking, visible: c => Boolean(c.journey.offeredConsultation) || c.hasBooking },
];

export const ACHIEVEMENT_IDS = DEFS.map(d => d.id);

export const LEVELS = [
  { at: 0, title: 'Начало пути' },
  { at: 30, title: 'В пути' },
  { at: 60, title: 'Почти готовы' },
  { at: 95, title: 'Готовы к исследованию' },
  { at: 125, title: 'Путь пройден' },
];

export function computeProgress(c: Ctx): Progress {
  const defs = DEFS.filter(d => !d.visible || d.visible(c));
  // Имя ассистента (Аружан/Клэри) по выбору пациента; в русском оба имени не склоняются.
  const name = AVATAR_NAME[c.profile.avatar ?? 'aruzhan'].ru;
  const fill = (t: string) => t.replace(/\{name\}/g, name);
  const achievements: Achievement[] = defs.map(d => ({ id: d.id, title: d.title, description: fill(d.description), icon: d.icon, points: d.points, hint: fill(d.hint), earned: d.earned(c) }));
  const points = achievements.filter(a => a.earned).reduce((s, a) => s + a.points, 0);
  const maxPoints = achievements.reduce((s, a) => s + a.points, 0);
  let level = 0;
  LEVELS.forEach((l, i) => { if (points >= l.at) level = i; });
  const next = LEVELS[level + 1];
  return { points, maxPoints, level: level + 1, levelTitle: LEVELS[level].title, levelStartAt: LEVELS[level].at, nextLevelTitle: next?.title, nextLevelAt: next?.at, achievements };
}
