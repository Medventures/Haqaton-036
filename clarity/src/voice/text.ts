// Текстовые помощники голосового модуля: чистка текста для синтеза и разбиение на фразы.
// Чистые функции — покрыты тестами (tests/lipsync.test.ts).
import type { Lang } from '../../shared/i18n';

/** Скорость «субтитрового» режима и оценки длительности речи, символов в секунду. */
export const CHARS_PER_SEC = 14;

const NOT_CYR = '(^|[^А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі])';
const NOT_CYR_AHEAD = '(?![А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі])';
const abbr = (s: string) => new RegExp(`${NOT_CYR}${s}${NOT_CYR_AHEAD}`, 'g');

/** Текст → удобочитаемый для синтеза (сервер нормализует числа сам; здесь — разметка и аббревиатуры). */
export function speakable(text: string, lang: Lang = 'ru'): string {
  let s = text
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/[«»"“”„*_#`~]/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/мл\/мин\/1,73\s?м²/g, '')
    .replace(/МРТ/g, 'эм-эр-тэ')
    .replace(abbr('КТ'), '$1ка-тэ')
    .replace(/р?СКФ/g, 'эс-ка-эф')
    .replace(/\.ics/g, lang === 'kk' ? ' күнтізбе' : ' календарь');
  if (lang === 'kk') {
    s = s
      .replace(/(\d)–(\d)/g, '$1-$2')
      .replace(/мкмоль\/л/g, 'микромоль литрге')
      .replace(abbr('ЖИ'), '$1жи');
  } else {
    s = s
      .replace(/(\d)–(\d)/g, '$1 до $2')
      .replace(/мкмоль\/л/g, 'микромоль на литр')
      .replace(abbr('ИИ'), '$1И-И');
  }
  return s.replace(/[ \t]+/g, ' ').trim();
}

/** Разбить длинный кусок по запятым/точкам с запятой, чтобы фраза была не длиннее max. */
function splitLong(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let cur = '';
  for (const piece of s.replace(/([,;:])\s+/g, '$1\u0000').split('\u0000')) {
    if (cur && (cur.length + piece.length + 1) > max) { out.push(cur); cur = piece; }
    else cur = cur ? `${cur} ${piece}` : piece;
  }
  if (cur) out.push(cur);
  // Кусок без запятых всё ещё длинный — режем по словам.
  return out.flatMap(p => {
    if (p.length <= max) return [p];
    const words = p.split(/\s+/);
    const res: string[] = [];
    let c = '';
    for (const w of words) {
      if (c && c.length + w.length + 1 > max) { res.push(c); c = w; } else c = c ? `${c} ${w}` : w;
    }
    if (c) res.push(c);
    return res;
  });
}

/**
 * Разбить текст на фразы для очереди синтеза. Граница — [.!?…] + пробел или перевод строки
 * (десятичные «3.5» и «1,73» не рвутся). Короткие фразы склеиваются до ~160 символов;
 * первая — до ~90, чтобы звук начинался быстрее.
 */
export function sentences(text: string, opts: { firstMax?: number; max?: number; hardMax?: number } = {}): string[] {
  const firstMax = opts.firstMax ?? 90, max = opts.max ?? 160, hardMax = opts.hardMax ?? 280;
  const raw = text
    .replace(/([.!?…]+)[ \t]+/g, '$1\u0000')
    .replace(/\s*\n+\s*/g, '\u0000')
    .split('\u0000')
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => /[\p{L}\p{N}]/u.test(s))
    .flatMap(s => splitLong(s, hardMax));
  const out: string[] = [];
  for (const p of raw) {
    const limit = out.length === 1 ? firstMax : max;
    if (out.length && (out[out.length - 1].length + p.length + 1) <= limit) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out;
}

export interface SpeechPart { caption: string; say: string }

/**
 * Отделить короткое начало первой фразы, чтобы синтез первого куска был быстрым (казахский Piper
 * тратит ~2–3 с на фразу): режем по запятой/точке с запятой/двоеточию ближе к ~50 символам,
 * а если знаков нет и фраза длинная — по слову около ~60 символов. Короткие фразы не трогаем.
 */
export function splitFirstChunk(s: string, target = 50, min = 18, max = 80): string[] {
  if (s.length <= max) return [s];
  let best = -1;
  const re = /[,;:](?=\s)/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const at = m.index + 1;
    if (at < min || at > max) continue;
    if (best < 0 || Math.abs(at - target) < Math.abs(best - target)) best = at;
  }
  if (best < 0) {
    if (s.length < max + 30) return [s];
    for (let i = Math.min(s.length - 1, target + 10); i >= min; i--) if (s[i] === ' ') { best = i; break; }
  }
  if (best < 0) return [s];
  const head = s.slice(0, best).trim(), tail = s.slice(best).trim();
  return tail && /[\p{L}\p{N}]/u.test(tail) ? [head, tail] : [s];
}

/** Фразы для озвучки: caption — исходный текст (субтитры), say — подготовленный для синтеза. */
export function speechParts(text: string, lang: Lang): SpeechPart[] {
  const list = sentences(text);
  if (list.length) list.splice(0, 1, ...splitFirstChunk(list[0]));
  return list
    .map(caption => ({ caption, say: speakable(caption, lang) }))
    .filter(p => /[\p{L}\p{N}]/u.test(p.say));
}

/** Оценка длительности речи для режима субтитров, мс. */
export function estimateMs(text: string, cps = CHARS_PER_SEC): number {
  return Math.max(700, Math.round((text.length / cps) * 1000));
}
