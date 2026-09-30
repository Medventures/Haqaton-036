// Сквозной тест: регистрация → знакомство → вся цепочка через ассистента (режим правил, без LLM).
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthMe, ChatResponse, MetricsResponse, PatientState, Slot } from '../shared/types';

process.env.NODE_ENV = 'test';
process.env.LLM_API_KEY = '';
process.env.GOOGLE_CLIENT_ID = '';

const { useMemoryStore } = await import('../server/store');
const { buildApp } = await import('../server/app');

useMemoryStore();
const app = buildApp();
const H = { 'x-clarity': '1' };
let patientCookie = '';
let staffCookie = '';

async function login(as: 'new_patient' | 'aliya' | 'staff') {
  const res = await app.inject({ method: 'POST', url: '/api/auth/demo', headers: H, payload: { as } });
  expect(res.statusCode).toBe(200);
  return String(res.headers['set-cookie']).split(';')[0];
}

async function chat(body: object) {
  const res = await app.inject({ method: 'POST', url: '/api/me/chat', headers: { ...H, cookie: patientCookie }, payload: body });
  expect(res.statusCode).toBe(200);
  return res.json() as ChatResponse;
}

const get = (url: string, cookie = patientCookie) => app.inject({ method: 'GET', url, headers: { cookie } });

describe('Авторизация и безопасность', () => {
  beforeAll(async () => { await app.ready(); });

  it('без входа данные недоступны', async () => {
    expect((await get('/api/me/state', '')).statusCode).toBe(401);
    expect((await get('/api/metrics', '')).statusCode).toBe(401);
  });

  it('изменяющий запрос без заголовка x-clarity отклоняется (CSRF)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/demo', payload: { as: 'new_patient' } });
    expect(res.statusCode).toBe(403);
  });

  it('Google-вход без настройки честно сообщает об этом', async () => {
    expect((await get('/api/auth/google', '')).statusCode).toBe(503);
    const me = (await get('/api/auth/me', '')).json() as AuthMe;
    expect(me.google).toBe(false);
    expect(me.demo).toBe(true);
  });

  it('новый пациент регистрируется и не прошёл знакомство', async () => {
    patientCookie = await login('new_patient');
    const me = (await get('/api/auth/me')).json() as AuthMe;
    expect(me.user?.role).toBe('patient');
    expect(me.user?.onboarded).toBe(false);
  });

  it('пациент не видит консоль и метрики клиники', async () => {
    expect((await get('/api/staff/overview')).statusCode).toBe(403);
    expect((await get('/api/metrics')).statusCode).toBe(403);
  });

  it('знакомство: без согласия — 400, с согласием — сохраняется и выбирается время МРТ', async () => {
    const slots = (await get('/api/mri-slots')).json() as { slots: Slot[] };
    expect(slots.slots.length).toBeGreaterThan(10);
    const base = { preferredName: 'Мадина', lastName: 'Серикова', birthYear: 1975, sex: 'female', phone: '+7 701 123 45 67', mriSlotId: slots.slots[3].id, firstMri: true, anxiety: 4, concerns: ['claustrophobia', 'noise'], voice: true, largeText: true };
    const bad = await app.inject({ method: 'POST', url: '/api/me/onboarding', headers: { ...H, cookie: patientCookie }, payload: base });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/me/onboarding', headers: { ...H, cookie: patientCookie }, payload: { ...base, consentData: true, consentAi: true } });
    expect(ok.statusCode).toBe(200);
    const s = ok.json() as PatientState;
    expect(s.profile.displayName).toBe('Мадина С.');
    expect(s.profile.phoneMasked).toMatch(/45 67$/);
    expect(s.visit.startsAt).toBe(slots.slots[3].startsAt);
    expect(s.tips.map(t => t.id)).toContain('faq-claustro');
    expect(s.progress.achievements.find(a => a.id === 'welcome')?.earned).toBe(true);
    expect(((await get('/api/auth/me')).json() as AuthMe).user?.onboarded).toBe(true);
  });
});

describe('Сквозной маршрут через ассистента', () => {
  it('приветствие по имени и раскрытие, что это ИИ', async () => {
    const r = await chat({ action: { type: 'start' } });
    expect(r.messages[0].text).toMatch(/Мадина/);
    expect(r.messages[0].text).toMatch(/не врач/);
    expect(r.messages[0].text).toMatch(/волнуетесь/);
  });

  it('анкета: свободный текст и кнопки, затем анализ', async () => {
    let r = await chat({ action: { type: 'screening_start' } });
    expect(r.messages.at(-1)!.text).toMatch(/Вопрос 1 из 9/);
    r = await chat({ text: 'нет' });
    r = await chat({ text: 'Не помню точно' });
    for (let i = 0; i < 7; i++) r = await chat({ action: { type: 'answer', value: 'no' } });
    expect(r.messages.at(-1)!.text).toMatch(/креатинин/);
    r = await chat({ action: { type: 'lab_has', value: 'yes' } });
    r = await chat({ text: '72' });
    r = await chat({ text: 'неделю назад' });
    expect(r.messages.at(-1)!.cards?.[0].type).toBe('screening_summary');
    expect(r.state.journey.screening?.overall).toBe('needs_review');
    expect(r.state.openTasks.some(t => t.kind === 'screening_review')).toBe(true);
    expect(r.state.progress.achievements.filter(a => a.earned).map(a => a.id)).toEqual(expect.arrayContaining(['welcome', 'safety', 'labs']));
  });

  it('подготовка, напоминания и календарь', async () => {
    let r = await chat({ action: { type: 'prep' } });
    expect(r.messages[1].cards?.[0].type).toBe('prep_plan');
    r = await chat({ action: { type: 'reminder_set', plan: 'full' } });
    expect(r.state.reminders).toHaveLength(3);
    const ics = await get('/api/me/visit.ics');
    expect(ics.body).toContain('BEGIN:VEVENT');
  });

  it('напоминание доставляется, когда наступает срок (перемотка времени)', async () => {
    const state = (await get('/api/me/state')).json() as PatientState;
    const hoursToVisit = (new Date(state.visit.startsAt).getTime() - Date.now()) / 3_600_000;
    await app.inject({ method: 'POST', url: '/api/demo/time', headers: { ...H, cookie: patientCookie }, payload: { offsetHours: Math.ceil(hoursToVisit - 20) } });
    const n = (await get('/api/me/notifications')).json() as { notifications: unknown[] };
    expect(n.notifications.length).toBeGreaterThanOrEqual(2);
    await app.inject({ method: 'POST', url: '/api/demo/time', headers: { ...H, cookie: patientCookie }, payload: { offsetHours: 0 } });
  });

  it('вопрос из базы знаний и отказ от клинического решения', async () => {
    let r = await chat({ text: 'Можно ли пить воду перед МРТ?' });
    expect(r.messages.at(-1)!.text).toMatch(/[Вв]оду/);
    expect(r.messages.at(-1)!.cards?.[0].type).toBe('sources');
    r = await chat({ text: 'можно ли мне не пить таблетки от давления' });
    expect(r.messages.at(-1)!.text).toMatch(/только врач/);
  });

  it('экстренные симптомы → 103/112 и срочная задача', async () => {
    const r = await chat({ text: 'мне трудно дышать и отекает горло' });
    expect(r.messages.at(-1)!.text).toMatch(/103/);
    expect(r.state.openTasks.some(t => t.details.startsWith('СРОЧНО'))).toBe(true);
  });

  it('тревожное заключение → запись к специалисту', async () => {
    let r = await chat({ action: { type: 'report_sample', sample: 'urgent' } });
    const report = r.messages.find(m => m.cards?.[0]?.type === 'report')!.cards![0];
    expect(report.type === 'report' && report.report.level).toBe('urgent');
    r = await chat({ action: { type: 'booking_start', specialty: 'Нейрохирург' } });
    const slots = r.messages.at(-1)!.cards![0];
    const slotId = slots.type === 'slots' ? slots.slots[0].id : '';
    r = await chat({ action: { type: 'slot_pick', slotId } });
    r = await chat({ text: 'да' });
    expect(r.state.bookings).toHaveLength(1);
    expect(r.state.progress.achievements.find(a => a.id === 'followup')?.earned).toBe(true);
    const again = await app.inject({ method: 'POST', url: '/api/me/bookings', headers: { ...H, cookie: patientCookie }, payload: { slotId } });
    expect(again.json().state.bookings).toHaveLength(1);
  });

  it('валидация входных данных', async () => {
    const bad = await app.inject({ method: 'PUT', url: '/api/me/answers/pacemaker', headers: { ...H, cookie: patientCookie }, payload: { value: 'maybe' } });
    expect(bad.statusCode).toBe(400);
  });
});

describe('Клиника', () => {
  it('сотрудник видит нового пациента и метрики', async () => {
    staffCookie = await login('staff');
    const o = await get('/api/staff/overview', staffCookie);
    expect(o.statusCode).toBe(200);
    expect(o.json().patients.some((p: { profile: { displayName: string } }) => p.profile.displayName === 'Мадина С.')).toBe(true);
    const m = (await get('/api/metrics', staffCookie)).json() as MetricsResponse;
    expect(m.metrics.map(x => x.key)).toEqual(['cancellations', 'prep_violations', 'repeat_calls', 'consult_conversion']);
  });

  it('выход завершает сессию', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...H, cookie: staffCookie } });
    expect((await get('/api/staff/overview', staffCookie)).statusCode).toBe(401);
  });
});
