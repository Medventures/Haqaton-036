// Общие типы frontend и backend. Все данные в демо — синтетические.

import type { AvatarId, Lang } from './i18n';
export type { AvatarId, Lang } from './i18n';

export type Answer = 'yes' | 'no' | 'unknown';
export type Severity = 'info' | 'review' | 'critical';
export type Sex = 'female' | 'male';

export interface Onboarding {
  completedAt: string;
  preferredName: string;
  firstMri: boolean | null;
  anxiety: number; // 1..5
  concerns: Concern[];
  voice: boolean;
  largeText: boolean;
  consentAt: string;
}

export type Concern = 'contrast' | 'injection' | 'noise' | 'claustrophobia' | 'preparation' | 'result' | 'meds' | 'road';

export interface PatientProfile {
  id: string;
  displayName: string;
  initials: string;
  birthYear: number;
  sex: Sex;
  phoneMasked: string;
  email?: string;
  picture?: string;
  onboarding?: Onboarding;
  createdAt?: string;
  /** Язык интерфейса и разговора (по умолчанию ru). */
  lang?: Lang;
  /** Выбранный ИИ-аватар (по умолчанию aruzhan). */
  avatar?: AvatarId;
}

export type Role = 'patient' | 'staff';

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  provider: 'google' | 'demo';
  role: Role;
  patientId?: string;
  /** Язык интерфейса сотрудника (у пациента — в профиле). */
  lang?: Lang;
  createdAt: string;
  lastLoginAt: string;
}

export interface Session { id: string; userId: string; createdAt: string; expiresAt: string }

export interface AuthMe {
  user: Pick<User, 'id' | 'email' | 'name' | 'picture' | 'role' | 'provider'> & { onboarded: boolean; lang: Lang; avatar: AvatarId } | null;
  google: boolean;
  demo: boolean;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  points: number;
  earned: boolean;
  hint: string;
}

export interface Progress {
  points: number;
  maxPoints: number;
  level: number;
  levelTitle: string;
  nextLevelTitle?: string;
  nextLevelAt?: number;
  levelStartAt: number;
  achievements: Achievement[];
}

export type VisitStatus = 'scheduled' | 'confirmed' | 'attended' | 'cancelled' | 'rescheduled' | 'no_show';

export interface Visit {
  id: string;
  patientId: string;
  procedureId: string;
  procedure: string;
  startsAt: string; // ISO
  clinic: string;
  address: string;
  city: string;
  status: VisitStatus;
  cancelReason?: string;
  prepViolation?: boolean;
  prepViolationNote?: string;
}

export interface LabResult {
  creatinineUmolL?: number;
  takenOn?: string; // YYYY-MM-DD
  status: 'unknown' | 'none' | 'provided';
}

export interface Flag {
  id: string;
  /** Ключ для локализации: q:<questionId>:yes|unknown или lab:<kind>. */
  key?: string;
  /** Числа для шаблонов локализации (рСКФ, давность анализа). */
  vars?: Record<string, number | string>;
  severity: Severity;
  title: string;
  patientText: string;
  staffText: string;
  source: string; // id вопроса/правила протокола
}

export type ScreeningOverall = 'incomplete' | 'ready' | 'needs_review' | 'hold_for_review';

export interface ScreeningResult {
  overall: ScreeningOverall;
  flags: Flag[];
  egfr?: number;
  labAgeDays?: number;
  labsRequired: boolean;
  missing: string[];
  protocolVersion: string;
}

export interface PrepItem {
  id: string;
  phase: 'before_3d' | 'before_1d' | 'day_of' | 'after';
  title: string;
  detail: string;
  personal?: boolean;
  critical?: boolean; // нарушение ведёт к переносу
}

export type ReminderPlan = 'full' | 'day_before' | 'none';

export interface Reminder {
  id: string;
  visitId: string;
  kind: 'labs_docs' | 'prep_day_before' | 'leave_home' | 'confirm_visit';
  dueAt: string;
  title: string;
  body: string;
  channel: 'in_app';
  deliveredAt?: string;
  readAt?: string;
}

export interface RedFlagHit {
  id: string;
  level: 'urgent' | 'significant' | 'minor';
  phrase: string;
  sentence: string;
  specialty: string;
  /** Название специальности на языке пациента (specialty — русский идентификатор). */
  specialtyLabel?: string;
  explanation: string;
}

export interface GlossaryHit {
  term: string;
  plain: string;
}

export interface ReportSentence {
  text: string;
  plain: string;
  terms: GlossaryHit[];
  negated: boolean;
}

export interface ReportExplanation {
  id: string;
  createdAt: string;
  source: 'sample' | 'pasted';
  sentences: ReportSentence[];
  summary: string;
  summaryBy: 'llm' | 'rules';
  redFlags: RedFlagHit[];
  level: 'routine' | 'follow_up' | 'urgent';
  recommendedSpecialty?: string;
  /** Название рекомендованной специальности на языке пациента. */
  recommendedSpecialtyLabel?: string;
  doctorQuestions: string[];
  disclaimer: string;
}

export interface Slot {
  id: string;
  specialty: string;
  doctor: string;
  startsAt: string;
  format: 'clinic' | 'online';
}

export interface Booking {
  id: string;
  patientId: string;
  slotId: string;
  specialty: string;
  doctor: string;
  startsAt: string;
  format: 'clinic' | 'online';
  reason: string;
  source: 'report_red_flag' | 'screening' | 'patient_request';
  status: 'booked' | 'completed' | 'cancelled';
  createdAt: string;
}

export type TaskKind = 'screening_review' | 'labs_missing' | 'patient_question' | 'report_follow_up' | 'callback';

export interface StaffTask {
  id: string;
  patientId: string;
  visitId?: string;
  kind: TaskKind;
  priority: 'normal' | 'high' | 'urgent';
  title: string;
  details: string;
  createdAt: string;
  status: 'open' | 'resolved';
  resolution?: string;
  resolvedAt?: string;
}

// ---------- Документы пациента: анализы ----------

export type LabStatus = 'low' | 'normal' | 'high' | 'critical_low' | 'critical_high' | 'abnormal' | 'unknown';

/** Один показатель из бланка анализа. Референс — ТОЛЬКО из бланка лаборатории, не выдумывается. */
export interface LabItem {
  id: string;
  code?: string;          // нормализованный код: creatinine, glucose, hgb…
  name: string;           // как в бланке
  value: number | null;
  valueText: string;      // исходная запись значения
  unit?: string;
  refLow?: number;
  refHigh?: number;
  refText?: string;       // исходная запись референса
  labFlag?: string;       // отметка лаборатории (H, L, ↑, *)
  status: LabStatus;
}

export interface LabExplanationItem {
  itemId: string;
  title: string;          // понятное название
  plain: string;          // что это за показатель
  statusText: string;     // «в пределах референса лаборатории» / «выше референса»…
  advice: string;         // что делать (без диагнозов)
  mriRelevant?: boolean;
}

export interface LabAnalysis {
  level: 'ok' | 'attention' | 'urgent';
  summary: string;
  summaryBy: 'llm' | 'rules';
  items: LabExplanationItem[];
  recommendations: string[];
  doctorQuestions: string[];
  recommendedSpecialty?: string;
  recommendedSpecialtyLabel?: string;
  mri?: { creatinineUmolL?: number; egfr?: number; appliedToScreening: boolean };
  disclaimer: string;
}

export interface LabReport {
  id: string;
  uploadedAt: string;
  takenOn?: string;       // YYYY-MM-DD
  source: 'image' | 'pdf' | 'text' | 'manual';
  fileName?: string;
  extractedBy: 'llm' | 'rules' | 'manual';
  items: LabItem[];
  confirmed: boolean;     // пациент проверил распознанные значения
  analysis?: LabAnalysis;
  lang?: Lang;
  /** Как креатинин из бланка повлиял на проверку перед МРТ (для пересборки анализа на другом языке). */
  mriNote?: 'applied' | 'older' | 'no_date' | 'unit';
  /** Координатору создана срочная задача по этому бланку. */
  notified?: boolean;
}

/** Результат распознавания загруженного файла заключения. */
export interface ExtractedText { text: string; extractedBy: 'llm' | 'pdf' | 'text'; fileName?: string; warning?: string }

export interface Journey {
  patientId: string;
  visitId: string;
  answers: Record<string, Answer>;
  lab: LabResult;
  screening?: ScreeningResult;
  prepChecks: string[];
  dayOfCheck?: { completedAt: string; ok: boolean; issues: string[] };
  reminderPlan?: ReminderPlan;
  lastReport?: ReportExplanation;
  offeredConsultation?: { specialty: string; at: string };
  labReports?: LabReport[];
  dialog: DialogState;
}

export type DialogStage =
  | 'idle'
  | 'screening'
  | 'lab_has'
  | 'lab_value'
  | 'lab_date'
  | 'report_input'
  | 'booking_pick'
  | 'booking_confirm'
  | 'cancel_reason'
  | 'question';

export interface DialogState {
  stage: DialogStage;
  qIndex: number;
  pendingSlotId?: string;
  greeted: boolean;
}

export type EventType =
  | 'visit_scheduled'
  | 'screening_completed'
  | 'screening_flagged'
  | 'prep_plan_viewed'
  | 'prep_item_checked'
  | 'reminder_scheduled'
  | 'reminder_delivered'
  | 'visit_confirmed'
  | 'visit_cancelled'
  | 'visit_rescheduled'
  | 'visit_attended'
  | 'prep_violation'
  | 'inbound_call'
  | 'assistant_question'
  | 'assistant_escalated'
  | 'report_explained'
  | 'consultation_offered'
  | 'consultation_booked'
  | 'consultation_completed'
  | 'emergency_detected'
  | 'patient_registered'
  | 'onboarding_completed'
  | 'labs_uploaded'
  | 'labs_analyzed';

export interface AppEvent {
  id: string;
  at: string;
  type: EventType;
  patientId: string;
  visitId?: string;
  cohort: 'baseline' | 'clarity';
  meta?: Record<string, string | number | boolean>;
}

// ---------- Ассистент ----------

export type Mood = 'neutral' | 'happy' | 'thinking' | 'concerned' | 'listening';

export type Card =
  | { type: 'screening_summary'; result: ScreeningResult }
  | { type: 'prep_plan'; items: PrepItem[]; checked: string[]; visitStartsAt: string }
  | { type: 'reminders'; reminders: Reminder[]; plan: ReminderPlan }
  | { type: 'report'; report: ReportExplanation }
  | { type: 'slots'; specialty: string; slots: Slot[] }
  | { type: 'booking'; booking: Booking }
  | { type: 'visit'; visit: Visit }
  | { type: 'emergency' }
  | { type: 'sources'; items: { id: string; title: string; version: string }[] }
  | { type: 'lab_report'; report: LabReport };

export interface QuickReply {
  label: string;
  action: AssistantAction;
}

export type AssistantAction =
  | { type: 'start' }
  | { type: 'menu' }
  | { type: 'screening_start' }
  | { type: 'answer'; value: Answer }
  | { type: 'lab_has'; value: Answer }
  | { type: 'lab_date_preset'; daysAgo: number }
  | { type: 'show_screening' }
  | { type: 'prep' }
  | { type: 'reminder_set'; plan: ReminderPlan }
  | { type: 'reminder_menu' }
  | { type: 'visit_confirm' }
  | { type: 'visit_cancel_start' }
  | { type: 'visit_cancel'; reason: string }
  | { type: 'report_start' }
  | { type: 'report_sample'; sample: 'normal' | 'finding' | 'urgent' }
  | { type: 'booking_start'; specialty?: string }
  | { type: 'slot_pick'; slotId: string }
  | { type: 'booking_confirm' }
  | { type: 'human' }
  | { type: 'status' }
  /** Обрабатывается на клиенте: открыть раздел приложения. */
  | { type: 'open_page'; page: 'documents' | 'prep' | 'progress' | 'inbox' }
  | { type: 'lab_uploaded'; labId: string }
  | { type: 'report_uploaded' }
  | { type: 'instruction' };

export interface AssistantMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  mood?: Mood;
  cards?: Card[];
  quickReplies?: QuickReply[];
  by?: 'llm' | 'rules';
  at: string;
}

export interface ChatRequest {
  text?: string;
  action?: AssistantAction;
  mode?: 'text' | 'voice';
}

export interface ChatResponse {
  messages: AssistantMessage[];
  state: PatientState;
}

export interface PatientState {
  profile: PatientProfile;
  visit: Visit;
  journey: Journey;
  prepPlan: PrepItem[];
  reminders: Reminder[];
  bookings: Booking[];
  openTasks: StaffTask[];
  progress: Progress;
  tips: { id: string; title: string; answer: string }[];
}

export interface HealthInfo {
  ok: boolean;
  llm: { provider: 'openai-compatible'; model: string; modelKk: string; configured: boolean; available: boolean; host: string };
  tts: { available: boolean; voices: Lang[]; engine: string };
  protocolVersion: string;
  now: string;
  timeOffsetHours: number;
}

export interface MetricValue {
  key: 'cancellations' | 'prep_violations' | 'repeat_calls' | 'consult_conversion';
  label: string;
  unit: '%' | 'на визит';
  baseline: number;
  current: number;
  better: 'lower' | 'higher';
  numerator: number;
  denominator: number;
  baselineN: number;
  definition: string;
}

export interface MetricsResponse {
  metrics: MetricValue[];
  funnel: { label: string; value: number }[];
  cancelReasons: { reason: string; count: number }[];
  generatedAt: string;
  disclaimer: string;
}
