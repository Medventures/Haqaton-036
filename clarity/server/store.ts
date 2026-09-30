// Простое файловое хранилище (JSON) для демо и пилота на одном сервере.
// Интерфейс Store изолирует остальной код — для продакшена заменяется на
// PostgreSQL без изменений в доменной логике.

import fs from 'node:fs';
import path from 'node:path';
import type { AppEvent, AssistantMessage, Booking, Journey, PatientProfile, Reminder, Session, StaffTask, User, Visit } from '../shared/types';
import { config } from './config';
import { seedDatabase } from './seed';

export interface Db {
  schema: 4;
  timeOffsetHours: number;
  patients: PatientProfile[];
  visits: Visit[];
  journeys: Journey[];
  reminders: Reminder[];
  bookings: Booking[];
  tasks: StaffTask[];
  events: AppEvent[];
  chats: Record<string, AssistantMessage[]>;
  users: User[];
  sessions: Session[];
}

let db: Db | null = null;
let writeTimer: NodeJS.Timeout | null = null;
let memoryOnly = false;

export function useMemoryStore(initial?: Db) {
  memoryOnly = true;
  db = initial ?? seedDatabase(new Date());
}

export function getDb(): Db {
  if (db) return db;
  try {
    const parsed = JSON.parse(fs.readFileSync(config.dataFile, 'utf8')) as Db;
    if (parsed.schema === 4) { db = parsed; return db; }
  } catch { /* нет файла или повреждён — создаём заново */ }
  db = seedDatabase(new Date());
  persist();
  return db;
}

/** Отложенная атомарная запись: tmp-файл + rename. */
export function persist() {
  if (memoryOnly) return;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (!db) return;
    fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
    const tmp = `${config.dataFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, config.dataFile);
  }, 150);
}

export function resetDb() {
  db = seedDatabase(new Date());
  persist();
  return db;
}

/** «Текущее время» с учётом демо-перемотки времени. */
export function now(): Date {
  return new Date(Date.now() + getDb().timeOffsetHours * 3_600_000);
}

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`;

export function logEvent(e: Omit<AppEvent, 'id' | 'at' | 'cohort'> & { at?: string }) {
  getDb().events.push({ id: newId('ev'), at: e.at ?? now().toISOString(), cohort: 'clarity', ...e });
  persist();
}
