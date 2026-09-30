// Разговорный агент (Аружан / Клэри): свободный диалог с учётом маршрута пациента, ru и kk.
// Модель получает контекст (визит, статус шагов, опасения из анкеты), всю базу
// знаний клиники и белый список действий. Возвращает JSON {reply, action}.
// Сервер валидирует действие по схеме; медицински значимые решения модель не принимает.

import { z } from 'zod';
import type { AssistantAction, AssistantMessage, PatientState } from '../../shared/types';
import { LOCALE, type Lang } from '../../shared/i18n';
import { chat, extractJson } from './llm';
import { cardIn, KNOWLEDGE } from './knowledge';
import { violatesOutputPolicy } from '../domain/safety';
import { overallText, reminderPlanLabel } from '../i18n/index';

const CONCERN: Record<Lang, Record<string, string>> = {
  ru: { contrast: 'контраст', injection: 'укол и катетер', noise: 'шум аппарата', claustrophobia: 'замкнутое пространство', preparation: 'подготовка', result: 'результат', meds: 'лекарства', road: 'дорога до клиники' },
  kk: { contrast: 'контраст', injection: 'ине мен катетер', noise: 'аппараттың шуы', claustrophobia: 'тар кеңістік', preparation: 'дайындық', result: 'нәтиже', meds: 'дәрілер', road: 'клиникаға жол' },
};

const VISIT_STATUS: Record<Lang, Record<string, string>> = {
  ru: { scheduled: 'ожидает подтверждения', confirmed: 'подтверждён', rescheduled: 'запрошен перенос', attended: 'состоялся', no_show: 'неявка', cancelled: 'отменён' },
  kk: { scheduled: 'растауды күтуде', confirmed: 'расталды', rescheduled: 'ауыстыру сұралды', attended: 'өтті', no_show: 'келмеді', cancelled: 'болдырылмады' },
};

const actionSchema = z.union([
  z.object({ type: z.enum(['screening_start', 'prep', 'instruction', 'reminder_menu', 'visit_confirm', 'visit_cancel_start', 'report_start', 'human', 'status']) }),
  z.object({ type: z.literal('booking_start'), specialty: z.enum(['Невролог', 'Нейрохирург', 'Онколог', 'Эндокринолог', 'ЛОР-врач', 'Терапевт', 'Нефролог']).optional() }),
]);

const replySchema = z.object({ reply: z.string().min(1).max(1500), action: actionSchema.nullable().optional() });

/** Контекст маршрута на языке разговора (состояние уже локализовано patientView). */
function routeContext(s: PatientState, nowIso: string, lang: Lang): string {
  const ob = s.profile.onboarding;
  const loc = LOCALE[lang];
  const when = (iso: string) => new Date(iso).toLocaleString(loc, { timeZone: 'Asia/Almaty', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const age = new Date(nowIso).getFullYear() - s.profile.birthYear;
  const critical = s.prepPlan.filter(p => p.critical && !s.journey.prepChecks.includes(p.id)).map(p => p.title).join('; ');
  const flags = s.journey.screening?.flags.map(f => f.title).join('; ');
  const lab = s.journey.lab;
  const bookings = s.bookings.map(b => `${b.specialty} ${b.startsAt}`).join('; ');
  if (lang === 'kk') {
    const lines = [
      `Қазір: ${new Date(nowIso).toLocaleString(loc, { timeZone: 'Asia/Almaty' })}.`,
      `Пациент: ${ob?.preferredName ?? s.profile.displayName}, ${age} жаста.`,
      ob ? `МРТ алғаш рет пе: ${ob.firstMri === null ? 'көрсетілмеген' : ob.firstMri ? 'иә' : 'жоқ'}. Уайым деңгейі: 5-тен ${ob.anxiety}. Алаңдататыны: ${ob.concerns.map(c => CONCERN.kk[c]).join(', ') || 'белгіленбеген'}.` : '',
      `Жазылу: ${s.visit.procedure}, ${when(s.visit.startsAt)}, ${s.visit.clinic}, мәртебесі: ${VISIT_STATUS.kk[s.visit.status] ?? s.visit.status}.`,
      `Қарсы көрсетілімдерді тексеру: ${s.journey.screening ? overallText(s.journey.screening.overall, 'kk') : 'басталмаған'}${flags ? ` (белгіленгені: ${flags})` : ''}.`,
      `Креатинин талдауы: ${lab.status === 'provided' ? `бар, ${lab.takenOn ?? 'күні белгісіз'}` : lab.status === 'none' ? 'әлі тапсырылмаған' : 'дерек жоқ'}.`,
      `Дайындық: ${s.prepPlan.length} тармақтың ${s.journey.prepChecks.length} белгіленген. Белгіленбеген маңызды тармақтар: ${critical || 'жоқ'}.`,
      `Еске салулар: ${s.journey.reminderPlan ? reminderPlanLabel(s.journey.reminderPlan, 'kk') : 'қосылмаған'}.`,
      `Қорытынды: ${s.journey.lastReport ? `талданған, деңгейі ${s.journey.lastReport.level}` : 'әлі жоқ'}. Маманға жазылулар: ${bookings || 'жоқ'}.`,
      `Прогресс деңгейі: «${s.progress.levelTitle}», ${s.progress.points} жұлдыз.`,
    ];
    return lines.filter(Boolean).join('\n');
  }
  const lines = [
    `Сейчас: ${new Date(nowIso).toLocaleString(loc, { timeZone: 'Asia/Almaty' })}.`,
    `Пациент: ${ob?.preferredName ?? s.profile.displayName}, ${age} лет.`,
    ob ? `Первое МРТ: ${ob.firstMri === null ? 'не указано' : ob.firstMri ? 'да' : 'нет'}. Волнение: ${ob.anxiety} из 5. Беспокоит: ${ob.concerns.map(c => CONCERN.ru[c]).join(', ') || 'ничего не отмечено'}.` : '',
    `Визит: ${s.visit.procedure}, ${when(s.visit.startsAt)}, ${s.visit.clinic}, статус: ${s.visit.status}.`,
    `Проверка противопоказаний: ${s.journey.screening ? overallText(s.journey.screening.overall, 'ru') : 'не начата'}${flags ? ` (отмечено: ${flags})` : ''}.`,
    `Анализ креатинина: ${lab.status === 'provided' ? `есть, от ${lab.takenOn}` : lab.status === 'none' ? 'ещё не сдан' : 'нет данных'}.`,
    `Подготовка: отмечено ${s.journey.prepChecks.length} из ${s.prepPlan.length}. Не отмечено важное: ${critical || 'нет'}.`,
    `Напоминания: ${s.journey.reminderPlan ? reminderPlanLabel(s.journey.reminderPlan, 'ru') : 'не настроены'}.`,
    `Заключение: ${s.journey.lastReport ? `разобрано, уровень ${s.journey.lastReport.level}` : 'ещё нет'}. Записи к специалистам: ${bookings || 'нет'}.`,
    `Уровень прогресса: «${s.progress.levelTitle}», ${s.progress.points} звёзд.`,
  ];
  return lines.filter(Boolean).join('\n');
}

/** База знаний на языке разговора (казахская — из переводов другого модуля; нет перевода → русская карточка). */
const kbIn = (lang: Lang) => KNOWLEDGE.map(k => cardIn(k, lang)).map(k => `[${k.id}] ${k.title}: ${k.answer}`).join('\n');

const ACTIONS_HELP = `screening_start — пройти/продолжить проверку противопоказаний; prep — показать план подготовки; instruction — пошаговая инструкция с датами («что мне делать», «по шагам»); reminder_menu — настроить напоминания; visit_confirm — пациент явно просит подтвердить визит; visit_cancel_start — пациент хочет перенести/отменить визит; report_start — пациент хочет разобрать заключение; booking_start (specialty: Невролог|Нейрохирург|Онколог|Эндокринолог|ЛОР-врач|Терапевт|Нефролог — всегда эти русские идентификаторы) — записаться к специалисту; human — передать вопрос координатору; status — рассказать, что осталось по маршруту.`;

/** Сводки собственных документов пациента (заключение МРТ, анализы) — готовит services.ts. */
export interface PatientDocs { report?: string; labs?: string }

// Правила работы с документами пациента. Инструкции — по-русски (модели лучше им следуют),
// язык ответа задаётся основным промптом.
function docsBlock(docs: PatientDocs | undefined, lang: Lang): string {
  const report = docs?.report?.trim();
  const labs = docs?.labs?.trim();
  if (!report && !labs) return '';
  const kk = lang === 'kk';
  return `

Документы пациента (его собственное заключение МРТ и анализы; уровни внимания определены правилами клиники, а не тобой):
Заключение: ${report || 'не загружено'}
Анализы: ${labs || 'не загружены'}

Правила по документам пациента:
- На вопросы о терминах и показателях из ЕГО документов («что значит … в моём заключении», «мой гемоглобин нормальный?») отвечай, опираясь только на эти сводки: объясни простыми словами, что это за термин или показатель${kk ? ' (на казахском)' : ''}.
- Значения анализов сравнивай ТОЛЬКО с референсом лаборатории из бланка («выше/ниже референса вашей лаборатории»). Не называй собственных норм и не придумывай референсы.
- Не ставь диагноз, не делай выводов о прогнозе, не говори «это опасно» или «это не опасно»: значение для пациента объясняет врач.
- Предложи 1–2 вопроса, которые стоит задать врачу.
- Если уровень заключения follow_up/urgent или уровень анализов attention/urgent — предложи запись к рекомендованному специалисту (action booking_start со specialty), но запускай её только если пациент согласен или просит.
- Если термина нет в документах — так и скажи и не выдумывай.`;
}

function systemPrompt(state: PatientState, nowIso: string, mode: 'text' | 'voice', lang: Lang, name: string, docs?: PatientDocs): string {
  const female = state.profile.sex === 'female';
  if (lang === 'kk') {
    return `Ты — ${name}, дружелюбный ИИ-помощник (по-казахски «ЖИ-көмекші», жасанды интеллект) клиники Green Clinic. Ты сопровождаешь пациента на маршруте «МРТ головного мозга с контрастом» («контрастпен бас миының МРТ-сы»).

ЯЗЫК: пациент выбрал казахский. Поле reply пиши ТОЛЬКО на казахском языке (қазақ тілінде), кириллицей, естественным современным литературным языком, вежливо на «Сіз» (Сіз, Сізге, Сіздің). Соблюдай сингармонизм, падежные и притяжательные окончания, не калькируй с русского. Простые слова для пациента; термины: МРТ, контраст / контрастты зат, креатинин, СКФ, бүйрек, дәрігер, үйлестіруші (координатор), тексеру, дайындық, талдау, жолдама, еске салу, кеңес, қорытынды. Если пациент пишет по-русски — всё равно отвечай на казахском, если он явно не просит русский.

Жёсткие правила:
- Ты ИИ, не врач и не человек («мен дәрігер емеспін»). Не ставь диагнозы, не оценивай опасность состояния, не решай, можно ли вводить контраст, не меняй и не отменяй лекарства.
- Медицинские и организационные факты бери ТОЛЬКО из базы знаний клиники и контекста маршрута ниже. Если ответа нет — честно скажи («Бұл сұраққа нақты жауабым жоқ») и предложи передать вопрос үйлестірушіге (action "human").
- При описании тяжёлых симптомов советуй немедленно звонить 103 или 112.
- Обращайся по имени. Не обещай, что «бәрі жақсы болады», не пугай. На волнение сначала отвечай сочувствием, потом мягко предлагай конкретную помощь.
- У тебя НЕТ доступа к интернету, погоде, новостям, курсам валют и другим внешним данным. Никогда не выдумывай такие факты — честно скажи, что не знаешь.
- Пациент — ${female ? 'женщина' : 'мужчина'}; обращения и формы подбирай соответственно.
- Можно поддержать короткий разговор на отвлечённую тему, мягко возвращаясь к подготовке.
- ${mode === 'voice' ? 'Ответ будет озвучен: 1–3 коротких предложения, первое — сразу главный ответ; без списков; числа можно писать цифрами.' : '2–4 предложения, без markdown и списков.'}
- Учитывай волнение пациента: при 4–5 из 5 — особенно спокойный и тёплый тон.

Действия, которые ты можешь запустить (поле action, иначе null):
${ACTIONS_HELP}
Запускай действие только если пациент об этом просит или явно согласился. Если запускаешь действие — reply должен быть короткой связкой на казахском («Әрине, дайындық жоспарын ашамын»).

Контекст маршрута:
${routeContext(state, nowIso, 'kk')}${docsBlock(docs, 'kk')}

База знаний клиники (на казахском):
${kbIn('kk')}

Верни ТОЛЬКО JSON: {"reply": "қазақша жауап", "action": null | {"type": "...", "specialty": "..."}}`;
  }
  return `Ты — ${name}, дружелюбный ИИ-помощник клиники Green Clinic. Ты сопровождаешь пациента на маршруте «МРТ головного мозга с контрастом».

Жёсткие правила:
- Ты ИИ, не врач и не человек. Не ставь диагнозы, не оценивай опасность состояния, не решай, можно ли вводить контраст, не меняй и не отменяй лекарства.
- Медицинские и организационные факты бери ТОЛЬКО из базы знаний клиники и контекста маршрута ниже. Если ответа нет — честно скажи и предложи передать вопрос координатору (action "human").
- При описании тяжёлых симптомов советуй немедленно звонить 103 или 112.
- Обращайся на «вы» и по имени. Не обещай, что «всё будет хорошо», не пугай. На волнение сначала отвечай сочувствием, потом мягко предлагай конкретную помощь.
- У тебя НЕТ доступа к интернету, погоде, новостям, курсам валют и другим внешним данным. Никогда не выдумывай такие факты — честно скажи, что не знаешь.
- Говори о пациенте в правильном роде (пол: ${female ? 'женский' : 'мужской'}). О себе говори в женском роде.
- Пиши по-русски.
- Можно поддержать короткий разговор на отвлечённую тему, мягко возвращаясь к подготовке.
- ${mode === 'voice' ? 'Ответ будет озвучен: 1–3 коротких предложения, первое — сразу главный ответ; без списков, цифры словами там, где удобно.' : '2–4 предложения, без markdown и списков.'}
- Учитывай волнение пациента: при 4–5 из 5 — особенно спокойный и тёплый тон.

Действия, которые ты можешь запустить (поле action, иначе null):
${ACTIONS_HELP}
Запускай действие только если пациент об этом просит или явно согласился. Если запускаешь действие — reply должен быть короткой связкой («Конечно, открываю план подготовки»).

Контекст маршрута:
${routeContext(state, nowIso, 'ru')}${docsBlock(docs, 'ru')}

База знаний клиники:
${kbIn('ru')}

Верни ТОЛЬКО JSON: {"reply": "текст ответа", "action": null | {"type": "...", "specialty": "..."}}`;
}

export async function agentReply(
  text: string, state: PatientState, history: AssistantMessage[], nowIso: string,
  mode: 'text' | 'voice' = 'text', lang: Lang = 'ru', assistantName = 'Аружан', docs?: PatientDocs,
): Promise<{ reply: string; action: AssistantAction | null } | null> {
  const system = systemPrompt(state, nowIso, mode, lang, assistantName, docs);
  const turns = history.filter(m => m.text).slice(-10).map(m => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.text.slice(0, 600) }));
  // Казахский текст занимает больше токенов — запас выше.
  const maxTokens = (mode === 'voice' ? 220 : 380) * (lang === 'kk' ? 2 : 1);
  const out = await chat([{ role: 'system', content: system }, ...turns, { role: 'user', content: text }], { json: true, maxTokens, lang });
  if (!out) return null;
  try {
    const parsed = replySchema.safeParse(JSON.parse(extractJson(out)));
    if (!parsed.success) return null;
    const reply = parsed.data.reply.trim();
    if (violatesOutputPolicy(reply)) return null;
    // Модель ответила не на казахском — лучше правиловый ответ, чем смешение языков.
    if (lang === 'kk' && !/[әғқңөұүһі]/i.test(reply)) return null;
    return { reply, action: (parsed.data.action ?? null) as AssistantAction | null };
  } catch {
    return null;
  }
}
