// Генерация файла календаря (RFC 5545) с встроенными напоминаниями.
import type { Visit } from '../../shared/types';
import { PROTOCOL } from './protocol';

const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, m => `\\${m}`).replace(/\n/g, '\\n');

export function visitIcs(visit: Visit, stamp: Date): string {
  const end = new Date(new Date(visit.startsAt).getTime() + 60 * 60_000).toISOString();
  const description = `Не ешьте за ${PROTOCOL.fastingHours} ч до исследования, воду пить можно.\nВозьмите направление, документ, результат креатинина и прошлые снимки.\nПриезжайте за ${PROTOCOL.arriveMinutesEarly} минут.\nДемо Clarity — синтетическая запись.`;
  const alarm = (trigger: string, text: string) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${trigger}`, `DESCRIPTION:${esc(text)}`, 'END:VALARM'];
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Clarity//Diagnostic Companion//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${visit.id}@clarity.demo`,
    `DTSTAMP:${fmt(stamp.toISOString())}`,
    `DTSTART:${fmt(visit.startsAt)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(`${visit.procedure} — ${visit.clinic}`)}`,
    `LOCATION:${esc(`${visit.address}, ${visit.city}`)}`,
    `DESCRIPTION:${esc(description)}`,
    ...alarm('-P3D', 'Через 3 дня МРТ: сдайте креатинин, найдите направление'),
    ...alarm('-P1D', 'Завтра МРТ с контрастом: подготовка'),
    ...alarm('-PT3H', 'Сегодня МРТ: не ешьте, возьмите документы'),
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
