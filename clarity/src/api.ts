import type { AvatarId, Lang } from '../shared/i18n';
import type { ExtractedText, LabItem, LabReport } from '../shared/types';
import type { AppEvent, Answer, AssistantAction, AssistantMessage, AuthMe, Booking, ChatResponse, Concern, HealthInfo, LabResult, MetricsResponse, PatientProfile, PatientState, Reminder, ReminderPlan, ReportExplanation, ScreeningResult, Sex, Slot, StaffTask, Visit } from '../shared/types';

const P = '/api/me';

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { ...(method !== 'GET' ? { 'x-clarity': '1' } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Нет связи с сервером Clarity. Проверьте подключение к интернету.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Ошибка ${res.status}`, res.status);
  return data as T;
}

export interface ProtocolInfo {
  id: string; version: string; procedure: string;
  questions: { id: string; text: string; hint: string; femaleOnly: boolean }[];
  dayOfCheck: { id: string; text: string; violation: string }[];
  overallText: Record<ScreeningResult['overall'], string>;
  labs: { maxAgeDays: number; creatinineMin: number; creatinineMax: number };
}

export interface StaffPatient {
  profile: PatientProfile; visit: Visit; screening?: ScreeningResult; answers: Record<string, Answer>; lab: LabResult;
  prepDone: number; prepTotal: number; reminderPlan?: ReminderPlan; report?: ReportExplanation; reportLevel?: ReportExplanation['level'];
  bookings: Booking[]; dayOfCheck?: { ok: boolean; issues: string[]; completedAt: string }; events: AppEvent[]; labReports?: LabReport[];
}
export interface StaffOverview { patients: StaffPatient[]; tasks: StaffTask[]; protocol: { questions: { id: string; text: string }[] } }

export interface OnboardingPayload {
  preferredName: string; lastName?: string; birthYear: number; sex: Sex; phone?: string; mriSlotId?: string;
  firstMri: boolean | null; anxiety: number; concerns: Concern[]; voice: boolean; largeText: boolean; consentData: true; consentAi: true;
}

export const api = {
  // авторизация
  me: () => req<AuthMe>('GET', '/api/auth/me'),
  demoLogin: (as: 'new_patient' | 'aliya' | 'staff') => req<AuthMe>('POST', '/api/auth/demo', { as }),
  logout: () => req<{ ok: true }>('POST', '/api/auth/logout', {}),
  googleUrl: '/api/auth/google',
  // общее
  health: () => req<HealthInfo>('GET', '/api/health'),
  protocol: (lang?: Lang) => req<ProtocolInfo>('GET', `/api/protocol${lang ? `?lang=${lang}` : ''}`),
  // пациент
  mriSlots: () => req<{ slots: Slot[] }>('GET', '/api/mri-slots'),
  onboarding: (b: OnboardingPayload) => req<PatientState>('POST', `${P}/onboarding`, b),
  state: () => req<PatientState>('GET', `${P}/state`),
  history: () => req<{ messages: AssistantMessage[] }>('GET', `${P}/chat`),
  chat: (body: { text?: string; action?: AssistantAction; mode?: 'text' | 'voice' }) => req<ChatResponse>('POST', `${P}/chat`, body),
  answer: (qid: string, value: Answer) => req<PatientState>('PUT', `${P}/answers/${qid}`, { value }),
  lab: (lab: LabResult) => req<PatientState>('PUT', `${P}/lab`, lab),
  prep: (item: string, checked: boolean) => req<PatientState>('PUT', `${P}/prep/${item}`, { checked }),
  reminders: (plan: ReminderPlan) => req<PatientState>('PUT', `${P}/reminders`, { plan }),
  notifications: () => req<{ notifications: Reminder[] }>('GET', `${P}/notifications`),
  readNotifications: () => req<{ ok: true }>('POST', `${P}/notifications/read`, {}),
  confirmVisit: () => req<PatientState>('POST', `${P}/visit/confirm`, {}),
  reschedule: (reason: string) => req<PatientState>('POST', `${P}/visit/reschedule`, { reason }),
  dayOfCheck: (answers: Record<string, boolean>) => req<PatientState>('POST', `${P}/day-of-check`, { answers }),
  report: (text: string) => req<{ report: ReportExplanation; state: PatientState }>('POST', `${P}/report`, { text }),
  slots: (specialty: string, urgent = false) => req<{ specialties: string[]; slots: Slot[] }>('GET', `/api/slots?specialty=${encodeURIComponent(specialty)}${urgent ? '&urgent=true' : ''}`),
  book: (slotId: string) => req<{ booking: Booking; state: PatientState }>('POST', `${P}/bookings`, { slotId }),
  question: (text: string) => req<PatientState>('POST', `${P}/questions`, { text }),
  resetPatient: () => req<PatientState>('POST', `${P}/reset`, {}),
  icsUrl: `${P}/visit.ics`,
  // персонал
  staff: () => req<StaffOverview>('GET', '/api/staff/overview'),
  resolveTask: (id: string, resolution: string) => req<StaffTask>('POST', `/api/staff/tasks/${id}/resolve`, { resolution }),
  outcome: (visitId: string, outcome: 'attended' | 'no_show' | 'cancelled', prepViolation: boolean, note?: string) => req<Visit>('POST', `/api/staff/visits/${visitId}/outcome`, { outcome, prepViolation, note }),
  logCall: (patientId: string, topic: string) => req<{ ok: true }>('POST', '/api/staff/calls', { patientId, topic }),
  completeBooking: (id: string) => req<Booking>('POST', `/api/staff/bookings/${id}/complete`, {}),
  metrics: () => req<MetricsResponse>('GET', '/api/metrics'),
  // документы: анализы и заключения
  /** Распознать файл: для kind='labs' — черновик LabReport (нужно подтверждение), для 'report' — текст заключения. */
  extractDocument: (b: { kind: 'labs' | 'report'; fileName?: string; mime: string; dataBase64?: string; text?: string }) =>
    req<{ labReport?: LabReport; extracted?: ExtractedText }>('POST', `${P}/documents/extract`, b),
  /** Подтвердить (и при необходимости исправить) значения → анализ. */
  confirmLabs: (id: string, b: { items: LabItem[]; takenOn?: string }) => req<{ labReport: LabReport; state: PatientState }>('PUT', `${P}/labs/${id}`, b),
  deleteLabs: (id: string) => req<PatientState>('DELETE', `${P}/labs/${id}`),
  // язык и аватар
  prefs: (p: { lang?: Lang; avatar?: AvatarId }) => req<AuthMe>('PUT', '/api/prefs', p),
  ttsUrl: '/api/tts',
  // демо
  setTime: (offsetHours: number) => req<{ now: string; offsetHours: number }>('POST', '/api/demo/time', { offsetHours }),
  resetDemo: () => req<{ ok: true }>('POST', '/api/demo/reset', {}),
};

// Форматирование дат — на текущем языке интерфейса.
export { fmtDateTime, fmtDate, fmtDayShort, fmtTime, fmtShort, fmtMonthShort, fmtDayNum, dayKey, countdown, durationUntil } from './i18n/format';
