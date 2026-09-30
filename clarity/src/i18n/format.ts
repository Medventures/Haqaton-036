// Форматирование дат и обратного отсчёта на текущем языке интерфейса.
import { LOCALE, type Lang } from '../../shared/i18n';

let current: Lang = 'ru';
export const setFormatLang = (l: Lang) => { current = l; };
export const currentLang = () => current;
const TZ = 'Asia/Almaty';
const loc = () => LOCALE[current];

// Казахский: если в браузере нет данных Intl для kk-KZ (например «M10 4, Sun»), собираем даты вручную.
const KK_MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];
const KK_MONTHS_SHORT = ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'];
const KK_DAYS = ['жексенбі', 'дүйсенбі', 'сейсенбі', 'сәрсенбі', 'бейсенбі', 'жұма', 'сенбі'];
const KK_DAYS_SHORT = ['жс', 'дс', 'сс', 'ср', 'бс', 'жм', 'сб'];
let kkIntlOk: boolean | null = null;
function kkIntl(): boolean {
  if (kkIntlOk === null) {
    try { kkIntlOk = /қазан/.test(new Date('2026-10-15T12:00:00Z').toLocaleDateString('kk-KZ', { month: 'long', timeZone: TZ })); } catch { kkIntlOk = false; }
  }
  return kkIntlOk;
}
function parts(iso: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { d: Number(p.day), m: Number(p.month) - 1, wd, time: `${p.hour}:${p.minute}` };
}
const manualKk = () => current === 'kk' && !kkIntl();

export const fmtDateTime = (iso: string) => { if (manualKk()) { const p = parts(iso); return `${p.d} ${KK_MONTHS[p.m]}, ${KK_DAYS[p.wd]}, ${p.time}`; } return new Date(iso).toLocaleString(loc(), { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); };
export const fmtDate = (iso: string) => { if (manualKk()) { const p = parts(iso); return `${p.d} ${KK_MONTHS[p.m]}, ${KK_DAYS[p.wd]}`; } return new Date(iso).toLocaleDateString(loc(), { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }); };
export const fmtDayShort = (iso: string) => { if (manualKk()) { const p = parts(iso); return `${KK_DAYS_SHORT[p.wd]}, ${p.d} ${KK_MONTHS_SHORT[p.m]}`; } return new Date(iso).toLocaleDateString(loc(), { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }); };
export const fmtTime = (iso: string) => (manualKk() ? parts(iso).time : new Date(iso).toLocaleTimeString(loc(), { timeZone: TZ, hour: '2-digit', minute: '2-digit' }));
export const fmtShort = (iso: string) => { if (manualKk()) { const p = parts(iso); return `${p.d} ${KK_MONTHS_SHORT[p.m]}, ${p.time}`; } return new Date(iso).toLocaleString(loc(), { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
export const fmtMonthShort = (iso: string) => (manualKk() ? KK_MONTHS_SHORT[parts(iso).m] : new Date(iso).toLocaleDateString(loc(), { timeZone: TZ, month: 'short' }).replace('.', ''));
export const fmtDayNum = (iso: string) => (manualKk() ? String(parts(iso).d) : new Date(iso).toLocaleDateString(loc(), { timeZone: TZ, day: 'numeric' }));
export const dayKey = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });

/** «через 3 дня» / «3 күннен кейін», «завтра» / «ертең». */
export function countdown(iso: string, nowIso?: string): string {
  const ms = new Date(iso).getTime() - (nowIso ? new Date(nowIso).getTime() : Date.now());
  const h = ms / 3_600_000;
  const kk = current === 'kk';
  if (h < -1) return kk ? 'өтті' : 'прошёл';
  if (h < 0) return kk ? 'қазір жүріп жатыр' : 'идёт сейчас';
  if (h < 12) { const n = Math.max(1, Math.round(h)); return kk ? `${n} сағаттан кейін` : `через ${n} ч`; }
  const days = Math.round(h / 24);
  if (days <= 1) return kk ? 'ертең' : 'завтра';
  if (kk) return `${days} күннен кейін`;
  const m10 = days % 10, m100 = days % 100;
  const w = m10 === 1 && m100 !== 11 ? 'день' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'дня' : 'дней';
  return `через ${days} ${w}`;
}

/** Только длительность: «4 дня» / «4 күн» (для заголовка «До МРТ — …»). */
export function durationUntil(iso: string, nowIso?: string): string {
  const h = (new Date(iso).getTime() - (nowIso ? new Date(nowIso).getTime() : Date.now())) / 3_600_000;
  const kk = current === 'kk';
  if (h < 24) { const n = Math.max(1, Math.round(h)); return kk ? `${n} сағат` : `${n} ч`; }
  const days = Math.round(h / 24);
  if (kk) return `${days} күн`;
  const m10 = days % 10, m100 = days % 100;
  return `${days} ${m10 === 1 && m100 !== 11 ? 'день' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'дня' : 'дней'}`;
}
