// Тексты объяснения анализов (ru) и их тип; казахские — server/i18n/kk/labs.ts.

import type { Lang } from '../../shared/i18n';
import { ANALYTES_KK, LABS_KK } from '../i18n/kk/labs';
import { analyteByCode } from './labsCatalog';

export interface LabsTexts {
  genericPlain: string;
  status: {
    normal: (ref: string) => string;
    high: (ref?: string) => string;
    low: (ref?: string) => string;
    critical_high: string;
    critical_low: string;
    abnormal: string;
    unknown: string;
  };
  advice: { normal: string; out: (may?: string) => string; critical: string; unknown: string; mri: string };
  summary: { ok: (n: number, u: number) => string; noRefs: string; empty: string; attention: (names: string) => string; urgent: (names: string) => string };
  rec: {
    show: string; keep: string; retest: string; urgent: string; coordinator: string; mriBring: string;
    mriApplied: (cr: number, egfr?: number) => string; mriNoDate: string; mriUnit: string; mriOlder: string; unknownRefs: string;
    specialty: (label: string) => string;
  };
  questions: { item: (title: string, value: string) => string; retest: string; more: string; mri: string };
  disclaimer: string;
  errors: { pdfNoText: string; visionUnavailable: string; heic: string; tooBig: string; badMime: string; empty: string; noItems: string; checkLlm: string; checkItems: string; truncated: string; notFound: string };
}

export const LABS_RU: LabsTexts = {
  genericPlain: 'Показатель из вашего бланка. Его значение объяснит врач.',
  status: {
    normal: ref => `В пределах референса лаборатории (${ref}).`,
    high: ref => (ref ? `Выше референса лаборатории (${ref}).` : 'Лаборатория отметила значение как повышенное.'),
    low: ref => (ref ? `Ниже референса лаборатории (${ref}).` : 'Лаборатория отметила значение как пониженное.'),
    critical_high: 'Значительно выше обычных значений — нужно связаться с врачом сегодня.',
    critical_low: 'Значительно ниже обычных значений — нужно связаться с врачом сегодня.',
    abnormal: 'Лаборатория отметила значение как отклоняющееся.',
    unknown: 'Референс не указан — сравнивать не будем.',
  },
  advice: {
    normal: 'Ничего делать не нужно — покажите бланк врачу на плановом приёме.',
    out: may => `${may ? `${may} ` : ''}Покажите результат врачу, который назначил анализ.`,
    critical: 'Свяжитесь с врачом сегодня. При плохом самочувствии звоните 103.',
    unknown: 'Уточните у врача, который назначил анализ, как оценивать это значение.',
    mri: ' Этот показатель важен для МРТ с контрастом — возьмите бланк с собой.',
  },
  summary: {
    ok: (n, u) => `Показатели, для которых в бланке указан референс (${n}), в его пределах.${u ? ` Для ${u} показателей референс не указан — их мы не сравнивали.` : ''} Это не диагноз: результат оценивает врач.`,
    noRefs: 'В бланке не указаны референсные значения, поэтому мы не сравнивали показатели. Покажите бланк врачу.',
    empty: 'Показатели не введены.',
    attention: names => `Вне референса лаборатории: ${names}. Небольшие отклонения встречаются часто и не являются диагнозом — их значение оценивает врач, который назначил анализ.`,
    urgent: names => `Есть значения, которые лучше обсудить с врачом сегодня: ${names}. Это не диагноз, но откладывать не стоит.`,
  },
  rec: {
    show: 'Покажите результат врачу, который назначил анализ.',
    keep: 'Сохраните бланк и покажите его врачу на ближайшем приёме.',
    retest: 'Если врач предложит пересдать анализ — сдавайте утром натощак и по возможности в той же лаборатории, чтобы результаты можно было сравнить.',
    urgent: 'Свяжитесь с врачом сегодня. При плохом самочувствии (сильная слабость, перебои в сердце, спутанность сознания) звоните 103.',
    coordinator: 'Мы передали информацию координатору клиники — с вами свяжутся.',
    mriBring: 'Возьмите бланк анализа с собой на МРТ.',
    mriApplied: (cr, egfr) => `Креатинин (${cr} мкмоль/л) добавлен в вашу проверку перед МРТ${egfr ? `, расчётная СКФ ≈ ${egfr}` : ''}. Решение о контрасте принимает врач.`,
    mriNoDate: 'Укажите дату сдачи анализа — без неё мы не можем учесть креатинин в проверке перед МРТ.',
    mriUnit: 'Не удалось надёжно определить единицы креатинина — покажите бланк координатору.',
    mriOlder: 'В проверке уже есть более свежий креатинин, поэтому значение из этого бланка его не заменило.',
    unknownRefs: 'Для части показателей в бланке нет референса — спросите у врача, как их оценивать.',
    specialty: label => `Если врача, который назначил анализ, нет — можно записаться к специалисту: ${label}.`,
  },
  questions: {
    item: (title, value) => `Что означает мой результат «${title}: ${value}»?`,
    retest: 'Нужно ли пересдать анализ и когда?',
    more: 'Нужны ли дополнительные обследования?',
    mri: 'Влияет ли мой креатинин на МРТ с контрастом?',
  },
  disclaimer: 'Это пояснение к бланку анализа, а не диагноз. Значения сравниваются только с референсом вашей лаборатории; результат оценивает врач с учётом самочувствия и истории болезни.',
  errors: {
    pdfNoText: 'В этом PDF нет текстового слоя (похоже, это скан). Загрузите фото или скриншот страницы — мы распознаем его.',
    visionUnavailable: 'Распознавание фото сейчас недоступно. Введите значения вручную или вставьте текст.',
    heic: 'Формат HEIC пока не поддерживается. Сохраните фото как JPEG или сделайте скриншот.',
    tooBig: 'Файл слишком большой (максимум 8 МБ).',
    badMime: 'Поддерживаются фото (JPEG, PNG, WebP), PDF и текст.',
    empty: 'Не удалось прочитать текст. Попробуйте более чёткое фото или введите данные вручную.',
    noItems: 'Мы не нашли показателей в документе. Проверьте, что это бланк анализа, или добавьте значения вручную.',
    checkLlm: 'Текст распознан ИИ — проверьте его и исправьте ошибки перед отправкой.',
    checkItems: 'Значения распознаны ИИ — сверьте их с бланком и исправьте ошибки.',
    truncated: 'Текст длинный — мы взяли первые 6000 символов.',
    notFound: 'Анализ не найден.',
  },
};

export const labsTexts = (lang: Lang): LabsTexts => (lang === 'kk' ? LABS_KK : LABS_RU);

/** Название и пояснения показателя на языке пациента. */
export function analyteText(code: string | undefined, lang: Lang) {
  const a = analyteByCode(code);
  if (!a) return undefined;
  return lang === 'kk' ? ANALYTES_KK[a.code] ?? a.ru : a.ru;
}
