// Двуязычность Clarity: русский и казахский.
// Казахские медицинские тексты — черновой перевод и требуют проверки
// клиническим редактором, владеющим казахским языком (см. docs/DECISIONS.md).

export type Lang = 'ru' | 'kk';
export const LANGS: Lang[] = ['ru', 'kk'];
export const LANG_LABEL: Record<Lang, string> = { ru: 'Русский', kk: 'Қазақша' };
export const LANG_SHORT: Record<Lang, string> = { ru: 'RU', kk: 'ҚАЗ' };

/** Строка на двух языках. */
export interface L10n { ru: string; kk: string }
export const L = (ru: string, kk: string): L10n => ({ ru, kk });
export const pick = (v: L10n | string, lang: Lang): string => (typeof v === 'string' ? v : v[lang] ?? v.ru);
export const isLang = (v: unknown): v is Lang => v === 'ru' || v === 'kk';

/** Локаль для Intl (даты, числа). */
export const LOCALE: Record<Lang, string> = { ru: 'ru-RU', kk: 'kk-KZ' };
/** Язык распознавания речи браузера. */
export const STT_LANG: Record<Lang, string> = { ru: 'ru-RU', kk: 'kk-KZ' };

export type AvatarId = 'aruzhan' | 'clary';
export const AVATAR_NAME: Record<AvatarId, L10n> = { aruzhan: L('Аружан', 'Аружан'), clary: L('Клэри', 'Клэри') };

/** Отображаемые названия специальностей (внутренние идентификаторы — русские названия). */
export const SPECIALTY_LABEL: Record<string, L10n> = {
  'Невролог': L('Невролог', 'Невролог'),
  'Нейрохирург': L('Нейрохирург', 'Нейрохирург'),
  'Онколог': L('Онколог', 'Онколог'),
  'Эндокринолог': L('Эндокринолог', 'Эндокринолог'),
  'ЛОР-врач': L('ЛОР-врач', 'ЛОР-дәрігер'),
  'МРТ': L('МРТ', 'МРТ'),
  'Терапевт': L('Терапевт', 'Терапевт'),
  'Нефролог': L('Нефролог', 'Нефролог'),
};
export const specialtyLabel = (s: string | undefined, lang: Lang) => (s ? pick(SPECIALTY_LABEL[s] ?? s, lang) : '');
