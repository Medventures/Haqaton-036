// Разбор текста бланка анализов правилами (строки вида «Название значение единицы референс»).
// Примеры: «Креатинин 84 мкмоль/л 44–80», «Гемоглобин (HGB) 128 г/л 120-150»,
// «Глюкоза: 5,4 ммоль/л (3,9 – 6,1)», «АЛТ 52 ↑ Ед/л < 41», «СРБ 12 H мг/л 0-5».
// Референс берётся только из бланка; если его нет — статус считается «unknown».

import type { LabItem } from '../../shared/types';
import { matchAnalyte } from './labsCatalog';

export type ParsedItem = Omit<LabItem, 'id' | 'status'>;

const NUM = String.raw`\d+(?:[.,]\d+)?`;

export function parseNumber(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = String(s).replace(/\s(?=\d{3}\b)/g, '').match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const v = Number(m[0].replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/** Референс из записи бланка: «44–80», «(3,9 - 6,1)», «< 5», «до 5,0», «> 60», «более 90». */
export function parseRef(refText: string | undefined | null): { refLow?: number; refHigh?: number } {
  if (!refText) return {};
  const t = refText.replace(/\s+/g, ' ').trim();
  const range = t.match(new RegExp(`(${NUM})\\s*(?:[-–—]|\\.\\.\\.?|…|до)\\s*(${NUM})`, 'i'));
  if (range) {
    const a = parseNumber(range[1])!;
    const b = parseNumber(range[2])!;
    if (a <= b) return { refLow: a, refHigh: b };
  }
  const upper = t.match(new RegExp(`(?:<=?|≤|до|менее|не более|less than|up to|дейін|кем)\\s*(${NUM})`, 'i')) ?? t.match(new RegExp(`(${NUM})\\s*(?:дейін|-?ге дейін)`, 'i'));
  if (upper) return { refHigh: parseNumber(upper[1])! };
  const lower = t.match(new RegExp(`(?:>=?|≥|более|от|не менее|свыше|above|over|жоғары|астам)\\s*(${NUM})`, 'i')) ?? t.match(new RegExp(`(${NUM})\\s*(?:и более|и выше|жоғары|астам)`, 'i'));
  if (lower) return { refLow: parseNumber(lower[1])! };
  return {};
}

const FLAG_RE = /(↑↑?|↓↓?|(?<![\p{L}])(?:H|L|HH|LL|В|Н|ВЫШЕ|НИЖЕ|ПОВЫШ\S*|ПОНИЖ\S*)(?![\p{L}])|\*|!)/u;

/** Нормализованная отметка лаборатории: 'H' | 'L' | '*'. */
export function normalizeFlag(f: string | undefined | null): 'H' | 'L' | '*' | undefined {
  if (!f) return undefined;
  const s = f.trim().toUpperCase();
  if (!s) return undefined;
  if (/^(↑|H|HH|В|ВЫШЕ|ПОВЫШ|HIGH|\+)/.test(s)) return 'H';
  if (/^(↓|L|LL|Н|НИЖЕ|ПОНИЖ|LOW|-)/.test(s)) return 'L';
  if (/^[*!]/.test(s)) return '*';
  return undefined;
}

// Единицы: «мкмоль/л», «г/л», «×10^9/л», «10*9/л», «мл/мин/1,73м²», «%», «Ед/л», «мм/ч», «мг/дл».
const UNIT_RE = new RegExp(String.raw`^(?:[x×]\s*)?(?:10\s*[\^*]?\s*\d{1,2}\s*\/\s*[лl]|10[⁰¹²³⁴⁵⁶⁷⁸⁹]+\s*\/\s*[лl]|мл\s*\/\s*мин(?:\s*\/\s*1[,.]73\s*(?:м2|м²|m2|m²|кв\.?\s*м))?|ml\s*\/\s*min(?:\s*\/\s*1[,.]73\s*m[2²])?|%|[\p{L}µμ][\p{L}µμ.]*(?:\s*\/\s*[\p{L}µμ.]+)*)`, 'iu');

const NOISE_NAME = /^(?:пациент|ф\.?и\.?о|фио|возраст|пол|дата|врач|телефон|тел\.?|иин|жсн|номер|№|страница|адрес|лаборатория|отделение|направление|биоматериал|исследование|показатель|результат|единиц|референс|норма|жасы|жынысы|күні|тегі|аты|page|patient|age|sex|date|doctor)/iu;

const TAKEN_RE = /(?:дата\s*(?:взятия|забора|сдачи|исследования|анализа|выдачи)?|взят\S*|забор\S*|алынған\s*күні|тапсырылған\s*күні|алу\s*күні|collected|sample date|date)\D{0,25}?(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/i;

export function parseTakenOn(text: string): string | undefined {
  const m = text.match(TAKEN_RE);
  if (!m) return undefined;
  const d = Number(m[1]); const mo = Number(m[2]); let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000 || y > 2100) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Одна строка бланка → показатель (или null). */
export function parseLabLine(raw: string): ParsedItem | null {
  let line = raw.replace(/[\t|;]+/g, '  ').replace(/ /g, ' ').replace(/[ ]+/g, ' ').trim();
  line = line.replace(/^\d{1,2}[.)]\s+/, '').replace(/^[-•·*]\s+/, '');
  if (line.length < 4 || line.length > 220) return null;
  // Название — до первого числа, отделённого пробелом или двоеточием.
  const m = line.match(new RegExp(String.raw`^(.+?)(?:\s*[:=]\s*|\s+)([<>≤≥]\s*)?(${NUM})(?![.,]?\d)(?!\s*[./]\s*\d{1,2}[./]\d)`, 'u'));
  let name: string; let valueText: string; let rest: string;
  if (m) {
    name = m[1].trim();
    valueText = `${m[2] ? m[2].replace(/\s+/g, '') : ''}${m[3]}`;
    rest = line.slice(m[0].length).trim();
  } else {
    // Качественные результаты: «отрицательно», «не обнаружено».
    const q = line.match(/^(.+?)(?:\s*[:=]\s*|\s+)(отрицат\S*|положит\S*|не обнаружен\S*|обнаружен\S*|теріс|оң|negative|positive)(.*)$/iu);
    if (!q) return null;
    name = q[1].trim(); valueText = q[2]; rest = q[3].trim();
  }
  name = name.replace(/[:=.\s]+$/, '').trim();
  if (!/\p{L}{2,}/u.test(name) || name.length > 70 || NOISE_NAME.test(name)) return null;
  const analyte = matchAnalyte(name);

  let labFlag: string | undefined;
  let unit: string | undefined;
  let refText: string | undefined;

  const takeFlag = () => {
    const f = rest.match(new RegExp(`^(?:${FLAG_RE.source})`, 'u'));
    if (f) { labFlag = f[0]; rest = rest.slice(f[0].length).trim(); return true; }
    return false;
  };
  takeFlag();
  const u = rest.match(UNIT_RE);
  if (u && !/^(?:до|от|менее|более|норма|реф)/i.test(u[0])) { unit = u[0].trim(); rest = rest.slice(u[0].length).trim(); }
  takeFlag();
  // Остаток — референс (и, возможно, флаг/единицы в табличном порядке).
  if (rest) {
    const flagAnywhere = rest.match(FLAG_RE);
    if (!labFlag && flagAnywhere && !/\d/.test(flagAnywhere[0])) {
      // Не путаем «Н» в «Норма» — FLAG_RE требует отдельного слова.
      labFlag = flagAnywhere[0];
      rest = rest.replace(flagAnywhere[0], ' ').trim();
    }
    const ref = rest.match(new RegExp(String.raw`(?:(?:<=?|>=?|≤|≥|до|от|менее|более|не более|не менее)\s*)?${NUM}(?:\s*(?:[-–—]|\.\.\.?|…|до)\s*${NUM})?(?:\s*(?:дейін|и более|и выше))?`, 'iu'));
    if (ref) {
      refText = ref[0].trim();
      if (!unit) {
        const after = rest.slice((ref.index ?? 0) + ref[0].length).replace(/^[\s)\]]+/, '');
        const u2 = after.match(UNIT_RE);
        if (u2) unit = u2[0].trim();
      }
    } else if (/отрицат|не обнаруж|теріс|negative/i.test(rest)) {
      refText = rest.replace(/[()]/g, '').trim();
    }
  }
  const { refLow, refHigh } = parseRef(refText);
  const hasRef = refLow !== undefined || refHigh !== undefined || Boolean(refText);
  // Незнакомые показатели принимаем только если строка похожа на строку бланка.
  if (!analyte && !(unit && (hasRef || labFlag))) return null;
  const value = /^[<>≤≥]/.test(valueText) ? parseNumber(valueText) : parseNumber(valueText);
  return {
    code: analyte?.code,
    name,
    value: /\d/.test(valueText) ? value : null,
    valueText,
    unit,
    refLow,
    refHigh,
    refText,
    labFlag: labFlag?.trim(),
  };
}

/** Весь текст бланка → список показателей (без дублей) и дата взятия, если найдена. */
export function parseLabText(text: string): { items: ParsedItem[]; takenOn?: string } {
  const items: ParsedItem[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const it = parseLabLine(raw);
    if (!it) continue;
    const key = it.code ?? it.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(it);
    if (items.length >= 60) break;
  }
  return { items, takenOn: parseTakenOn(text) };
}
