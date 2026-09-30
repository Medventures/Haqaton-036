// Казахская локализация серверного контента: полнота переводов, localizeState, поиск, разбор заключения.
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthMe, Journey, PatientProfile, PatientState, ReportExplanation, Visit } from '../shared/types';
import { specialtyLabel } from '../shared/i18n';

process.env.NODE_ENV = 'test';
process.env.LLM_API_KEY = '';
process.env.GOOGLE_CLIENT_ID = '';

const { DAY_OF_CHECK, PREP_BANK, SCREENING } = await import('../server/domain/protocol');
const { evaluateScreening } = await import('../server/domain/screening');
const { buildPrepPlan, buildReminders } = await import('../server/domain/prep');
const { analyzeReport, GLOSSARY, RED_FLAGS, REPORT_SAMPLES, reportLang } = await import('../server/domain/report');
const { ACHIEVEMENT_IDS, LEVELS, computeProgress } = await import('../server/domain/gamification');
const { KNOWLEDGE, cardIn, retrieve } = await import('../server/assistant/knowledge');
const { DAY_OF_CHECK_KK, PREP_KK, SCREENING_KK } = await import('../server/i18n/kk/protocol');
const { KNOWLEDGE_KK } = await import('../server/i18n/kk/knowledge');
const { GLOSSARY_KK, RED_FLAG_KK } = await import('../server/i18n/kk/report');
const { ACHIEVEMENT_KK, LEVEL_KK } = await import('../server/i18n/kk/gamification');
const i18n = await import('../server/i18n');
const { localizeReport, localizeState } = await import('../server/i18n/localize');

const KK = /[әғқңөұүі]/i;
const NOW = new Date('2026-09-30T09:00:00+05:00');
const filled = (s: string | undefined) => typeof s === 'string' && s.trim().length > 0;

describe('Полнота казахских переводов', () => {
  it('каждый вопрос анкеты: текст, пояснение и реакции на «да»/«не знаю»', () => {
    for (const q of SCREENING) {
      const kk = SCREENING_KK[q.id];
      expect(kk, q.id).toBeDefined();
      expect(filled(kk.text) && filled(kk.hint), q.id).toBe(true);
      expect(kk.text).toMatch(KK);
      expect(Boolean(kk.onYes), `${q.id} onYes`).toBe(Boolean(q.onYes));
      expect(Boolean(kk.onUnknown), `${q.id} onUnknown`).toBe(Boolean(q.onUnknown));
      for (const r of [kk.onYes, kk.onUnknown]) if (r) expect(filled(r.title) && filled(r.patient), q.id).toBe(true);
      if (q.voice) expect(filled(kk.voice), `${q.id} voice`).toBe(true);
    }
  });
  it('каждый пункт подготовки и самопроверки', () => {
    for (const id of Object.keys(PREP_BANK)) {
      expect(filled(PREP_KK[id]?.title) && filled(PREP_KK[id]?.detail), id).toBe(true);
      expect(PREP_KK[id].title + PREP_KK[id].detail).toMatch(KK);
    }
    for (const q of DAY_OF_CHECK) expect(filled(DAY_OF_CHECK_KK[q.id]?.text) && filled(DAY_OF_CHECK_KK[q.id]?.violation), q.id).toBe(true);
  });
  it('каждая карточка базы знаний', () => {
    for (const c of KNOWLEDGE) {
      const kk = KNOWLEDGE_KK[c.id];
      expect(filled(kk?.title) && filled(kk?.answer), c.id).toBe(true);
      expect(kk.keywords.length, c.id).toBeGreaterThan(3);
      expect(kk.answer).toMatch(KK);
    }
  });
  it('каждый термин глоссария и каждый «красный флаг»', () => {
    for (const g of GLOSSARY) expect(filled(GLOSSARY_KK[g.term]?.term) && filled(GLOSSARY_KK[g.term]?.plain), g.term).toBe(true);
    for (const r of RED_FLAGS) expect(filled(RED_FLAG_KK[r.id]), r.id).toBe(true);
  });
  it('каждое достижение и уровень', () => {
    for (const id of ACHIEVEMENT_IDS) {
      const kk = ACHIEVEMENT_KK[id];
      expect(filled(kk?.title) && filled(kk?.description) && filled(kk?.hint), id).toBe(true);
    }
    for (const l of LEVELS) expect(filled(LEVEL_KK[l.title]), l.title).toBe(true);
  });
  it('метки статуса, плана напоминаний и этапов', () => {
    for (const o of ['incomplete', 'ready', 'needs_review', 'hold_for_review'] as const) expect(i18n.overallText(o, 'kk')).toMatch(KK);
    for (const p of ['full', 'day_before', 'none'] as const) expect(filled(i18n.reminderPlanLabel(p, 'kk'))).toBe(true);
    for (const p of ['before_3d', 'before_1d', 'day_of', 'after'] as const) expect(i18n.phaseLabel(p, 'kk')).toMatch(KK);
    expect(i18n.overallText('ready', 'ru')).toBe('Отмеченных пунктов нет');
  });
});

describe('API локализации', () => {
  it('qText / qRule: казахский и русский', () => {
    expect(i18n.qText('pregnancy', 'kk').voice).toMatch(/құпия/);
    expect(i18n.qText('pacemaker', 'ru').text).toMatch(/кардиостимулятор/);
    expect(i18n.qRule('kidney', 'unknown', 'kk')?.title).toMatch(/Бүйрек/);
    // «не знаю» без отдельного правила → правило «да»
    expect(i18n.qRule('claustrophobia', 'unknown', 'kk')?.title).toBe('Клаустрофобия');
    expect(i18n.qRule('metal_work', 'unknown', 'kk')?.patient).toMatch(KK);
  });
  it('flagText использует key/vars, персоналу текст остаётся русским', () => {
    const r = evaluateScreening({ pacemaker: 'unknown' }, { status: 'provided', creatinineUmolL: 260, takenOn: '2026-08-01' }, { id: 'p', displayName: 'Т', initials: 'Т', birthYear: 1968, sex: 'female', phoneMasked: '' }, NOW);
    const stale = r.flags.find(f => f.id === 'lab:stale')!;
    expect(stale.key).toBe('lab:stale');
    expect(stale.vars?.labAgeDays).toBe(r.labAgeDays);
    expect(i18n.flagText(stale, 'kk').patientText).toContain(String(r.labAgeDays));
    const egfr = r.flags.find(f => f.id === 'lab:egfr_critical')!;
    expect(i18n.flagText(egfr, 'kk').title).toContain(`≈${r.egfr}`);
    const pm = r.flags.find(f => f.id === 'q:pacemaker')!;
    expect(pm.key).toBe('q:pacemaker:unknown');
    expect(i18n.flagText(pm, 'kk').title).toMatch(KK);
    expect(i18n.flagText(pm, 'ru').title).toBe(pm.title);
    expect(pm.staffText).not.toMatch(KK);
    // флаг без key (сохранён до v4) тоже переводится
    const { key: _k, vars: _v, ...legacy } = egfr;
    expect(i18n.flagText(legacy, 'kk').title).toContain(`≈${r.egfr}`);
  });
});

describe('localizeState', () => {
  const profile: PatientProfile = { id: 'p', displayName: 'Алия К.', initials: 'АК', birthYear: 1968, sex: 'female', phoneMasked: '', avatar: 'aruzhan', lang: 'kk',
    onboarding: { completedAt: NOW.toISOString(), preferredName: 'Алия', firstMri: true, anxiety: 3, concerns: ['claustrophobia'], voice: true, largeText: false, consentAt: NOW.toISOString() } };
  const visit: Visit = { id: 'v', patientId: 'p', procedureId: 'mri-brain-contrast', procedure: 'МРТ головного мозга с контрастом', startsAt: '2026-10-04T09:30:00.000Z', clinic: 'Green Clinic', address: 'ул. Демонстрационная, 1 (вымышленный адрес)', city: 'Алматы', status: 'scheduled' };
  const journey: Journey = { patientId: 'p', visitId: 'v', answers: { pacemaker: 'no', implants: 'yes', metal_work: 'no', kidney: 'unknown', contrast_reaction: 'no', allergy_asthma: 'no', pregnancy: 'no', breastfeeding: 'no', claustrophobia: 'yes' }, lab: { status: 'none' }, prepChecks: [], dialog: { stage: 'idle', qIndex: 0, greeted: true },
    dayOfCheck: { completedAt: NOW.toISOString(), ok: false, issues: ['Нет направления/документа'] } };
  journey.screening = evaluateScreening(journey.answers, journey.lab, profile, NOW);
  journey.lastReport = analyzeReport(REPORT_SAMPLES.finding, 'sample', 'r1', NOW, 'ru');
  const prepPlan = buildPrepPlan(journey);
  const state: PatientState = {
    profile, visit, journey, prepPlan,
    reminders: buildReminders(visit, 'full', journey),
    bookings: [{ id: 'b', patientId: 'p', slotId: 's', specialty: 'Невролог', doctor: 'Д-р', startsAt: NOW.toISOString(), format: 'clinic', reason: 'Обсуждение заключения МРТ', source: 'report_red_flag', status: 'booked', createdAt: NOW.toISOString() }],
    openTasks: [],
    progress: computeProgress({ profile, journey, visit, prepPlan, events: [], hasBooking: true }),
    tips: [{ id: 'faq-claustro', title: 'Клаустрофобия', answer: 'ru' }],
  };

  it('казахская копия: флаги, подготовка, напоминания, прогресс, советы, визит, заключение', () => {
    const snapshot = structuredClone(state);
    const kk = localizeState(state, 'kk');
    expect(state).toEqual(snapshot); // исходное состояние не изменилось
    expect(kk.journey.screening!.flags.length).toBeGreaterThan(0);
    for (const f of kk.journey.screening!.flags) { expect(f.title + f.patientText).toMatch(KK); expect(f.staffText).not.toMatch(KK); }
    for (const p of kk.prepPlan) expect(p.title).toMatch(KK);
    expect(kk.reminders).toHaveLength(3);
    for (const r of kk.reminders) expect(r.title + r.body).toMatch(KK);
    expect(kk.reminders.find(r => r.kind === 'labs_docs')!.body).toMatch(/Креатининге талдау/);
    expect(kk.reminders.find(r => r.kind === 'prep_day_before')!.title).toContain('14:30');
    expect(kk.reminders.find(r => r.kind === 'leave_home')!.body).toMatch(/Демонстрациялық/);
    for (const a of kk.progress.achievements) expect(a.title + a.description + a.hint).toMatch(KK);
    expect(kk.progress.achievements.find(a => a.id === 'welcome')!.description).toMatch(/Аружанға/);
    expect(kk.progress.levelTitle).toMatch(KK);
    expect(kk.tips[0].answer).toMatch(KK);
    expect(kk.visit.procedure).toMatch(KK);
    expect(kk.journey.dayOfCheck!.issues[0]).toMatch(KK);
    expect(kk.bookings[0].reason).toMatch(KK);
    expect(kk.bookings[0].specialty).toBe('Невролог');
    const rep = kk.journey.lastReport!;
    expect(reportLang(rep)).toBe('kk');
    expect(rep.level).toBe(state.journey.lastReport!.level);
    expect(rep.summary).toMatch(KK);
  });

  it('русский — без изменений', () => {
    expect(localizeState(state, 'ru')).toBe(state);
  });

  it('заключение, объяснённое на казахском, показывается на русском после смены языка', () => {
    const kkReport = analyzeReport(REPORT_SAMPLES.finding, 'sample', 'r2', NOW, 'kk');
    const ru = localizeReport(kkReport, 'ru');
    expect(ru).toEqual(analyzeReport(REPORT_SAMPLES.finding, 'sample', 'r2', NOW, 'ru'));
    const st = localizeState({ ...state, journey: { ...state.journey, lastReport: kkReport } }, 'ru');
    expect(reportLang(st.journey.lastReport!)).toBe('ru');
  });
});

describe('База знаний на казахском', () => {
  it('находит ответ по казахскому вопросу и возвращает карточку на нужном языке', () => {
    expect(retrieve('МРТ алдында су ішуге бола ма?', 2, 'kk')[0].card.id).toBe('faq-food');
    expect(retrieve('креатинин не үшін керек?', 2, 'kk')[0].card.id).toBe('faq-creatinine');
    expect(retrieve('тар жерден қорқамын', 2, 'kk')[0].card.id).toBe('faq-claustro');
    // упрощённое написание без казахских букв
    expect(retrieve('МРТ алдында су ишуге бола ма', 2, 'kk')[0].card.id).toBe('faq-food');
    const hit = retrieve('тар жерден қорқамын', 2, 'kk')[0].card;
    expect(hit.answer).toMatch(KK);
    expect(hit.version).toBe(KNOWLEDGE.find(k => k.id === hit.id)!.version);
    // русский вопрос → русская карточка, казахский вопрос с lang=ru → русская карточка
    expect(retrieve('зачем креатинин', 2, 'ru')[0].card.answer).not.toMatch(KK);
    expect(retrieve('креатинин не үшін керек?')[0].card.title).toBe('Зачем анализ на креатинин');
    expect(retrieve('ауа райы қандай', 2, 'kk')).toHaveLength(0);
  });
  it('cardIn сохраняет id и версию', () => {
    const c = cardIn(KNOWLEDGE[0], 'kk');
    expect(c.id).toBe(KNOWLEDGE[0].id);
    expect(c.version).toBe(KNOWLEDGE[0].version);
    expect(cardIn(c, 'ru')).toEqual(KNOWLEDGE[0]);
  });
});

describe('Разбор заключения на казахском', () => {
  it('тревожное заключение → urgent, нейрохирург с казахской подписью', () => {
    const r: ReportExplanation = analyzeReport(REPORT_SAMPLES.urgent, 'sample', 'r', NOW, 'kk');
    const ru = analyzeReport(REPORT_SAMPLES.urgent, 'sample', 'r', NOW, 'ru');
    expect(r.level).toBe('urgent');
    expect(r.recommendedSpecialty).toBe('Нейрохирург');
    expect(r.recommendedSpecialtyLabel).toBe(specialtyLabel('Нейрохирург', 'kk'));
    expect(r.summary).toMatch(KK);
    expect(r.summary).toMatch(/шұғыл/);
    expect(r.disclaimer).toMatch(KK);
    expect(r.disclaimer).toMatch(/диагноз емес/);
    expect(r.redFlags.map(f => f.id)).toEqual(ru.redFlags.map(f => f.id));
    for (const f of r.redFlags) { expect(f.explanation).toMatch(KK); expect(f.specialtyLabel).toBeTruthy(); }
    for (const s of r.sentences) { expect(s.plain).toMatch(KK); for (const t of s.terms) expect(t.plain).toMatch(KK); }
    for (const q of r.doctorQuestions) expect(q).toMatch(KK);
    // исходные предложения заключения остаются на русском
    expect(r.sentences.map(s => s.text)).toEqual(ru.sentences.map(s => s.text));
  });
  it('ЛОР-врач получает казахскую подпись', () => {
    const r = analyzeReport(REPORT_SAMPLES.finding, 'sample', 'r', NOW, 'kk');
    expect(r.redFlags.find(f => f.id === 'sinus')?.specialtyLabel).toBe('ЛОР-дәрігер');
    expect(r.recommendedSpecialty).toBe('Невролог');
  });
});

const { useMemoryStore } = await import('../server/store');
const { buildApp } = await import('../server/app');

describe('HTTP: язык пациента', () => {
  useMemoryStore();
  const app = buildApp();
  const H = { 'x-clarity': '1' };
  let cookie = '';
  beforeAll(async () => {
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/auth/demo', headers: H, payload: { as: 'aliya' } });
    cookie = String(res.headers['set-cookie']).split(';')[0];
  });

  it('/api/protocol?lang=kk — казахский, по умолчанию — русский', async () => {
    const kk = (await app.inject({ method: 'GET', url: '/api/protocol?lang=kk' })).json();
    expect(kk.questions).toHaveLength(SCREENING.length);
    expect(kk.questions[0].text).toMatch(KK);
    expect(kk.dayOfCheck[0].text).toMatch(KK);
    expect(kk.overallText.ready).toMatch(KK);
    expect(kk.procedure).toMatch(KK);
    const ru = (await app.inject({ method: 'GET', url: '/api/protocol' })).json();
    expect(ru.questions[0].text).toBe(SCREENING[0].text);
    expect(ru.overallText.ready).toBe('Отмеченных пунктов нет');
  });

  it('после выбора казахского состояние и объяснение заключения приходят на казахском, персонал видит русский', async () => {
    const prefs = await app.inject({ method: 'PUT', url: '/api/prefs', headers: { ...H, cookie }, payload: { lang: 'kk' } });
    expect((prefs.json() as AuthMe).user?.lang).toBe('kk');
    await app.inject({ method: 'PUT', url: '/api/me/answers/implants', headers: { ...H, cookie }, payload: { value: 'yes' } });
    await app.inject({ method: 'PUT', url: '/api/me/reminders', headers: { ...H, cookie }, payload: { plan: 'full' } });
    const st = (await app.inject({ method: 'GET', url: '/api/me/state', headers: { cookie } })).json() as PatientState;
    expect(st.visit.procedure).toMatch(KK);
    expect(st.prepPlan[0].title).toMatch(KK);
    expect(st.reminders[0].title).toMatch(KK);
    expect(st.tips.every(t => KK.test(t.answer))).toBe(true);
    const rep = await app.inject({ method: 'POST', url: '/api/me/report', headers: { ...H, cookie }, payload: { text: REPORT_SAMPLES.urgent } });
    const report = rep.json().report as ReportExplanation;
    expect(report.level).toBe('urgent');
    expect(report.disclaimer).toMatch(KK);
    expect(report.recommendedSpecialty).toBe('Нейрохирург');
    const staffCookie = String((await app.inject({ method: 'POST', url: '/api/auth/demo', headers: H, payload: { as: 'staff' } })).headers['set-cookie']).split(';')[0];
    const o = (await app.inject({ method: 'GET', url: '/api/staff/overview', headers: { cookie: staffCookie } })).json();
    const mine = o.patients.find((p: { profile: { id: string } }) => p.profile.id === 'p-demo');
    expect(mine.report.disclaimer).not.toMatch(KK);
    expect(mine.report.level).toBe('urgent');
  });
});
