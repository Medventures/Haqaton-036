// Нормализация текста перед синтезом: Piper/espeak-ng плохо читают аббревиатуры,
// числа с суффиксами, время, единицы измерения, эмодзи и разметку.
// Чистые функции — покрыты тестами в tests/tts.test.ts.

import type { Lang } from '../../shared/i18n';

// ---------- Числа словами ----------

const RU_ONES_M = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const RU_ONES_F = ['ноль', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const RU_TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const RU_TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const RU_HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

/** Русская форма по числу: 1 — one, 2–4 — few, 5+ — many. */
export function ruPlural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function ruBelow1000(n: number, fem: boolean): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) out.push(RU_HUNDREDS[h]);
  if (r >= 10 && r < 20) out.push(RU_TEENS[r - 10]);
  else {
    const t = Math.floor(r / 10), o = r % 10;
    if (t) out.push(RU_TENS[t]);
    if (o) out.push((fem ? RU_ONES_F : RU_ONES_M)[o]);
  }
  return out;
}

/** Целое 0…999 999 словами по-русски (мужской род; fem — женский для единиц). */
export function numberToWordsRu(n: number, fem = false): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return String(n).split('').map(d => RU_ONES_M[+d] ?? d).join(' ');
  if (n === 0) return 'ноль';
  const th = Math.floor(n / 1000), rest = n % 1000;
  const out: string[] = [];
  if (th) out.push(...ruBelow1000(th, true), ruPlural(th, 'тысяча', 'тысячи', 'тысяч'));
  if (rest) out.push(...ruBelow1000(rest, fem));
  return out.join(' ');
}

const KK_ONES = ['нөл', 'бір', 'екі', 'үш', 'төрт', 'бес', 'алты', 'жеті', 'сегіз', 'тоғыз'];
const KK_TENS = ['', 'он', 'жиырма', 'отыз', 'қырық', 'елу', 'алпыс', 'жетпіс', 'сексен', 'тоқсан'];

function kkBelow1000(n: number): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) out.push(...(h > 1 ? [KK_ONES[h]] : []), 'жүз');
  const t = Math.floor(r / 10), o = r % 10;
  if (t) out.push(KK_TENS[t]);
  if (o) out.push(KK_ONES[o]);
  return out;
}

/** Целое 0…999 999 словами по-казахски: 2026 → «екі мың жиырма алты». */
export function numberToWordsKk(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return String(n).split('').map(d => KK_ONES[+d] ?? d).join(' ');
  if (n === 0) return 'нөл';
  const th = Math.floor(n / 1000), rest = n % 1000;
  const out: string[] = [];
  if (th) out.push(...(th > 1 ? kkBelow1000(th) : []), 'мың');
  if (rest) out.push(...kkBelow1000(rest));
  return out.join(' ');
}

export function numberToWords(n: number, lang: Lang): string {
  return lang === 'kk' ? numberToWordsKk(n) : numberToWordsRu(n);
}

const digitWise = (s: string, lang: Lang) =>
  s.split('').map(d => (lang === 'kk' ? KK_ONES : RU_ONES_M)[+d]).join(' ');

// ---------- Словари ----------

const MONTHS: Record<Lang, string[]> = {
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  kk: ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'],
};

/** Аббревиатуры и слова латиницей → как их произносят. Порядок важен (длинные раньше). */
const ABBR: Record<Lang, [RegExp, string][]> = {
  ru: [
    [/\bрСКФ\b/g, 'эс-ка-эф'], [/\bСКФ\b/g, 'эс-ка-эф'], [/\bМРТ\b/g, 'эм-эр-тэ'], [/\bКТ\b/g, 'ка-тэ'],
    [/\bЭКГ\b/g, 'э-ка-гэ'], [/\bУЗИ\b/g, 'узи'], [/\bИИ\b/g, 'и-и'], [/\bЖИ\b/g, 'и-и'], [/\bSMS\b|\bСМС\b/gi, 'эс-эм-эс'],
    [/\bт\.\s?е\./g, 'то есть'], [/\bт\.\s?д\./g, 'так далее'], [/\bт\.\s?п\./g, 'тому подобное'], [/\bт\.\s?к\./g, 'так как'],
    [/мкмоль\s*\/\s*л\b/g, 'микромоль на литр'], [/ммоль\s*\/\s*л\b/g, 'миллимоль на литр'],
    [/мл\s*\/\s*мин(?:\s*\/\s*1[,.]73\s*м²?)?/g, 'миллилитров в минуту'], [/\bмг\b/g, 'миллиграмм'], [/\bмл\b/g, 'миллилитров'],
    [/\bмин\.?(?=\s|$|[,;!?])/g, 'минут'], [/№\s*/g, 'номер '],
  ],
  kk: [
    [/\bрСКФ\b/g, 'эс-ка-эф'], [/\bСКФ\b/g, 'эс-ка-эф'], [/\bМРТ\b/g, 'эм-эр-тэ'], [/\bКТ\b/g, 'ка-тэ'],
    [/\bЭКГ\b/g, 'э-ка-гэ'], [/\bУЗИ\b/g, 'узи'], [/\bЖИ\b/g, 'жи'], [/\bИИ\b/g, 'и-и'], [/\bSMS\b|\bСМС\b/gi, 'эс-эм-эс'],
    [/\bт\.\s?б\./g, 'тағы басқа'], [/\bт\.\s?с\./g, 'тағы сол сияқты'],
    [/мкмоль\s*\/\s*л\b/g, 'микромоль литрге'], [/ммоль\s*\/\s*л\b/g, 'миллимоль литрге'],
    [/мл\s*\/\s*мин(?:\s*\/\s*1[,.]73\s*м²?)?/g, 'минутына миллилитр'], [/\bмг\b/g, 'миллиграмм'], [/\bмл\b/g, 'миллилитр'],
    [/\bмин\.?(?=\s|$|[,;!?])/g, 'минут'], [/№\s*/g, 'нөмір '],
  ],
};
const LATIN: [RegExp, string][] = [
  [/\bGreen\s+Clinic\b/gi, 'Грин Клиник'], [/\bClarity\b/gi, 'Клэрити'], [/\bOK\b/g, 'окей'], [/\bPDF\b/g, 'пэ-дэ-эф'],
  [/\bWhatsApp\b/gi, 'вотсап'], [/\bTelegram\b/gi, 'телеграм'], [/\bQR\b/g, 'кью-ар'],
];

// \b в JS не работает с кириллицей — делаем собственные границы слова.
const L = 'A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүІіҺһ';
function bounded(re: RegExp): RegExp {
  // \b в начале альтернативы → lookbehind, иначе (после буквы) → lookahead.
  const src = re.source.replace(/\\b/g, (_m, off: number, all: string) =>
    off === 0 || all[off - 1] === '|' || all[off - 1] === '(' ? `(?<![${L}0-9])` : `(?![${L}0-9])`);
  return new RegExp(src, re.flags);
}
const ABBR_B: Record<Lang, [RegExp, string][]> = {
  ru: ABBR.ru.map(([re, s]) => [bounded(re), s]),
  kk: ABBR.kk.map(([re, s]) => [bounded(re), s]),
};
const LATIN_B = LATIN.map(([re, s]) => [bounded(re), s] as [RegExp, string]);

const PHONE_CONTEXT = /(звон|позвон|скор|номер|телефон|набер|наберите|экстренн|қоңырау|нөмір|шақыр|жедел|телефон)[^.!?]{0,30}$/i;
const UNIT_AFTER = /^\s*(мкмоль|ммоль|мг|мл|г\b|кг|%|мм|см|лет|год|жас|мин|минут|дн|день|дня|күн|раз|рет|мл\/)/i;

// ---------- Основная функция ----------

export function normalizeForTts(input: string, lang: Lang): string {
  let t = input.normalize('NFC');

  // Разметка, ссылки, эмодзи.
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_~#>|]+/g, ' ')
    .replace(/^\s*[-•·]\s+/gm, '')
    .replace(/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}‍️⃣]/gu, ' ');
  // Кавычки (апостроф внутри слова оставляем).
  t = t.replace(/[«»"“”„]/g, '').replace(/(^|[^\p{L}])['‘’]|['‘’](?=$|[^\p{L}])/gu, '$1');

  // Латиница и аббревиатуры.
  for (const [re, s] of LATIN_B) t = t.replace(re, s);
  for (const [re, s] of ABBR_B[lang]) t = t.replace(re, s);

  // Время 14:30 → слова.
  t = t.replace(/(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g, (_m, h: string, mm: string) => {
    const hw = numberToWords(+h, lang);
    const m = +mm;
    const zero = lang === 'kk' ? 'нөл' : 'ноль';
    const mw = m === 0 ? `${zero}-${zero}` : m < 10 ? `${zero} ${numberToWords(m, lang)}` : numberToWords(m, lang);
    return `${hw} ${mw}`;
  });

  // Даты дд.мм(.гггг) → «25 сентября» / «25 қыркүйек».
  t = t.replace(/(?<![\d.,])(0?[1-9]|[12]\d|3[01])\.(0?[1-9]|1[0-2])(?:\.((?:19|20)\d\d))?(?![\d,]|\.\d)/g, (_m, d: string, mo: string, y?: string) => {
    const day = numberToWords(+d, lang), month = MONTHS[lang][+mo - 1];
    const year = y ? ` ${numberToWords(+y, lang)} ${lang === 'kk' ? 'жыл' : 'года'}` : '';
    return lang === 'kk' ? `${day} ${month}${year}` : `${day} ${month}${year}`;
  });

  // Телефоны экстренных служб 103/112/911 — поцифрово, если это не лабораторное значение.
  t = t.replace(/(?<![\d.,])(103|112|101|102|104)(?![\d]|[.,]\d)/g, (m, num: string, off: number, all: string) => {
    const before = all.slice(Math.max(0, off - 40), off);
    const after = all.slice(off + m.length);
    const phoneLike = PHONE_CONTEXT.test(before) || /(^|[\s,])(или|немесе|не)\s*$/.test(before) || /^\s*(или|немесе|не)\s*1\d\d/.test(after);
    if (!phoneLike && (UNIT_AFTER.test(after) || /(креатинин|скф|эс-ка-эф)[^.!?]{0,15}$/i.test(before))) return m;
    if (!phoneLike) return m;
    return digitWise(num, lang);
  });

  // Проценты.
  t = t.replace(/(\d+)\s*%/g, (_m, n: string) => {
    const v = +n;
    return lang === 'kk' ? `${numberToWordsKk(v)} пайыз` : `${numberToWordsRu(v)} ${ruPlural(v, 'процент', 'процента', 'процентов')}`;
  });

  // Диапазоны 2–3 → «два-три».
  t = t.replace(/(\d+)\s*[–—-]\s*(\d+)/g, (_m, a: string, b: string) => `${numberToWords(+a, lang)}-${numberToWords(+b, lang)}`);

  // Десятичные 1,5 / 1.5.
  t = t.replace(/(\d+)[.,](\d+)/g, (_m, a: string, b: string) =>
    `${numberToWords(+a, lang)} ${lang === 'kk' ? 'бүтін' : 'и'} ${b.length <= 3 && !b.startsWith('0') ? numberToWords(+b, lang) : digitWise(b, lang)}`);

  // Числа с дефисным суффиксом: kk «80-нен» → «сексеннен», ru «5-ти» → «пять».
  t = t.replace(/(\d+)-([А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүІіҺһ]{1,5})(?![А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүІіҺһ])/g, (_m, n: string, suf: string) =>
    lang === 'kk' ? `${numberToWordsKk(+n)}${suf}` : numberToWordsRu(+n));

  // Остальные целые (разделители тысяч «10 000» склеиваем).
  t = t.replace(/(\d{1,3})(?:[   ](\d{3}))+(?!\d)/g, m => m.replace(/[   ]/g, ''));
  t = t.replace(/\d+/g, m => (m.length > 1 && m.startsWith('0')) || m.length > 6 ? digitWise(m, lang) : numberToWords(+m, lang));

  // Символы, которые espeak читает странно.
  t = t.replace(/\s*[/\\]\s*/g, ' ').replace(/\s*&\s*/g, lang === 'kk' ? ' және ' : ' и ').replace(/[+=<>^{}[\]]/g, ' ')
    .replace(/\s*[—–]\s*/g, ', ').replace(/…/g, '.').replace(/\.{2,}/g, '.')
    .replace(/\s*\n+\s*/g, '. ').replace(/([.!?,;:])\s*\.(?!\.)/g, '$1')
    .replace(/\s{2,}/g, ' ').trim();

  if (t && !/[.!?]$/.test(t)) t += '.';
  return t;
}
