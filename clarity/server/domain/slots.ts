// Синтетическое расписание специалистов. В пилоте заменяется адаптером к МИС клиники.
import type { Booking, Slot } from '../../shared/types';

const DOCTORS: Record<string, string[]> = {
  'Невролог': ['Невролог (демо) — А. Сапарова', 'Невролог (демо) — Д. Ким'],
  'Нейрохирург': ['Нейрохирург (демо) — Е. Абенов'],
  'Онколог': ['Онколог (демо) — М. Жумабаева'],
  'Эндокринолог': ['Эндокринолог (демо) — Л. Ахметова'],
  'ЛОР-врач': ['ЛОР-врач (демо) — Т. Иванов'],
  'Терапевт': ['Терапевт (демо) — Г. Нурланова', 'Терапевт (демо) — С. Ли'],
  'Нефролог': ['Нефролог (демо) — Р. Касымов'],
};

export const SPECIALTIES = Object.keys(DOCTORS);

/** Детерминированные слоты на ближайшие 10 дней (будни, 09:00–17:00, Алматы). */
export function listSlots(specialty: string, now: Date, taken: Booking[], urgent = false): Slot[] {
  const doctors = DOCTORS[specialty] ?? DOCTORS['Невролог'];
  const slots: Slot[] = [];
  const takenIds = new Set(taken.filter(b => b.status === 'booked').map(b => b.slotId));
  for (let day = urgent ? 0 : 1; day <= 10 && slots.length < 6; day++) {
    const d = new Date(now.getTime() + 5 * 3_600_000 + day * 86_400_000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const date = d.toISOString().slice(0, 10);
    doctors.forEach((doctor, di) => {
      for (const hhmm of ['09:30', '11:00', '15:30']) {
        if ((date.charCodeAt(9) + di + hhmm.charCodeAt(1)) % 3 === 0) continue; // «занятые» слоты
        const startsAt = new Date(`${date}T${hhmm}:00+05:00`).toISOString();
        if (new Date(startsAt).getTime() < now.getTime() + 2 * 3_600_000) continue;
        const id = `slot-${specialty}-${di}-${date}-${hhmm}`;
        if (takenIds.has(id)) continue;
        slots.push({ id, specialty: specialty in DOCTORS ? specialty : 'Невролог', doctor, startsAt, format: hhmm === '15:30' ? 'online' : 'clinic' });
      }
    });
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 6);
}

export function findSlot(slotId: string, now: Date, taken: Booking[]): Slot | undefined {
  const specialty = slotId.split('-')[1];
  for (const urgent of [true, false]) {
    const s = listSlots(specialty, now, taken, urgent).find(x => x.id === slotId);
    if (s) return s;
  }
  return undefined;
}

// ---------- Слоты самого МРТ (выбор времени при регистрации) ----------
const MRI_ROOMS = ['Кабинет МРТ №1 · 1,5 Тл', 'Кабинет МРТ №2 · 3 Тл'];
const MRI_TIMES = ['08:30', '10:00', '11:30', '13:00', '14:30', '16:00', '17:30'];

/** Свободные окна МРТ на 2–12 дней вперёд (демо-расписание, Алматы). */
export function listMriSlots(now: Date): Slot[] {
  const slots: Slot[] = [];
  for (let day = 2; day <= 12; day++) {
    const d = new Date(now.getTime() + 5 * 3_600_000 + day * 86_400_000);
    if (d.getUTCDay() === 0) continue; // воскресенье — выходной
    const date = d.toISOString().slice(0, 10);
    MRI_ROOMS.forEach((room, ri) => {
      for (const hhmm of MRI_TIMES) {
        if ((date.charCodeAt(8) + date.charCodeAt(9) + ri * 3 + hhmm.charCodeAt(1) + hhmm.charCodeAt(3)) % 4 === 0) continue;
        slots.push({ id: `mri-${ri}-${date}-${hhmm}`, specialty: 'МРТ', doctor: room, startsAt: new Date(`${date}T${hhmm}:00+05:00`).toISOString(), format: 'clinic' });
      }
    });
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function findMriSlot(id: string, now: Date): Slot | undefined {
  return listMriSlots(now).find(s => s.id === id);
}
