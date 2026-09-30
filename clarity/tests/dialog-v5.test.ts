// Диалог v5: пошаговая инструкция с датами, анализы из «Документов», заключение из «Документов»,
// предложение записи при тревожных формулировках (только после явного «да»), ответы по своим документам.
// Режим правил (без LLM), память вместо файла.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ChatResponse, LabReport, PatientState, Slot } from '../shared/types';

process.env.NODE_ENV = 'test';
process.env.LLM_API_KEY = '';
process.env.GOOGLE_CLIENT_ID = '';

const { useMemoryStore, getDb } = await import('../server/store');
const { buildApp } = await import('../server/app');
const { REPORT_SAMPLES } = await import('../server/domain/report');
const { DIALOG, fmtDay, fmtDayDat, fmtTime } = await import('../server/i18n/dialog');

useMemoryStore();
const app = buildApp();
const H = { 'x-clarity': '1' };
let cookie = '';
const KK = /[әғқңөұүһі]/i;
const DAY = 86_400_000;

async function chat(body: object) {
  const res = await app.inject({ method: 'POST', url: '/api/me/chat', headers: { ...H, cookie }, payload: body });
  expect(res.statusCode).toBe(200);
  return res.json() as ChatResponse;
}
const state = async () => (await app.inject({ method: 'GET', url: '/api/me/state', headers: { cookie } })).json() as PatientState;
const setLang = (lang: 'ru' | 'kk') => app.inject({ method: 'PUT', url: '/api/prefs', headers: { ...H, cookie }, payload: { lang } });
const findMsg = (r: ChatResponse, re: RegExp) => r.messages.find(m => m.role === 'assistant' && re.test(m.text));

describe('Диалог v5', () => {
  let visitStart = '';

  beforeAll(async () => {
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/api/auth/demo', headers: H, payload: { as: 'new_patient' } });
    cookie = String(login.headers['set-cookie']).split(';')[0];
    const { slots } = (await app.inject({ method: 'GET', url: '/api/mri-slots', headers: { cookie } })).json() as { slots: Slot[] };
    // Визит не раньше чем через 5 дней — чтобы в плане была дата «до … (за 3 дня)».
    const slot = slots.find(s => new Date(s.startsAt).getTime() > Date.now() + 5 * DAY) ?? slots.at(-1)!;
    const ob = await app.inject({
      method: 'POST', url: '/api/me/onboarding', headers: { ...H, cookie },
      payload: { preferredName: 'Дана', lastName: 'Омарова', birthYear: 1988, sex: 'female', phone: '+7 701 555 44 33', mriSlotId: slot.id, firstMri: true, anxiety: 3, concerns: ['preparation'], voice: true, largeText: false, consentData: true, consentAi: true },
    });
    expect(ob.statusCode).toBe(200);
    visitStart = (await state()).visit.startsAt;
  });

  it('инструкция (ru): план по датам, «Сейчас», напоминания, карточка и кнопки', async () => {
    const r = await chat({ action: { type: 'instruction' } });
    expect(r.messages[0].text).toBe(DIALOG.ru.echoInstruction);
    const m = r.messages.at(-1)!;
    const by3 = new Date(new Date(visitStart).getTime() - 3 * DAY);
    const eve = new Date(new Date(visitStart).getTime() - DAY);
    expect(m.text).toMatch(/Вот что сделать и когда/);
    expect(m.text).toContain(`• Сейчас: пройдите проверку противопоказаний (осталось вопросов: 9)`);
    expect(m.text).toContain('сдайте анализ крови на креатинин');
    expect(m.text).toContain('подтвердите визит');
    expect(m.text).toContain(`• До ${fmtDay(by3, 'ru')} (за 3 дня):`);
    expect(m.text).toContain(`• Накануне, ${fmtDay(eve, 'ru')}:`);
    expect(m.text).toContain(`• В день визита, ${fmtDay(visitStart, 'ru')} в ${fmtTime(visitStart)}:`);
    expect(m.text).toMatch(/Напоминания пока не настроены/);
    expect(m.cards?.[0].type).toBe('prep_plan');
    const labels = m.quickReplies?.map(q => q.label) ?? [];
    expect(labels).toEqual(expect.arrayContaining([DIALOG.ru.setReminders, DIALOG.ru.confirmVisit]));
    expect(m.quickReplies?.some(q => q.action.type === 'open_page')).toBe(true);
  });

  it('инструкция по тексту: «что мне делать?» и «как подготовиться по шагам»', async () => {
    for (const t of ['что мне делать?', 'как подготовиться по шагам', 'дайте инструкцию']) {
      const r = await chat({ text: t });
      expect(r.messages.at(-1)!.text, t).toMatch(/Вот что сделать и когда/);
    }
    // После настройки напоминаний инструкция сообщает, что они включены.
    await chat({ action: { type: 'reminder_set', plan: 'full' } });
    const r = await chat({ action: { type: 'instruction' } });
    expect(r.messages.at(-1)!.text).toMatch(/Напоминания включены/);
    expect(r.messages.at(-1)!.quickReplies?.some(q => q.label === DIALOG.ru.setReminders)).toBe(false);
  });

  it('инструкция в голосе — коротко, первое предложение с датой визита', async () => {
    const r = await chat({ action: { type: 'instruction' }, mode: 'voice' });
    const t = r.messages.at(-1)!.text;
    expect(t.startsWith('МРТ — ')).toBe(true);
    expect(t).not.toContain('\n');
    expect(t).toMatch(/Главное сейчас:/);
  });

  it('инструкция (kk): даты по-казахски, «Сіз», кнопки на казахском', async () => {
    await setLang('kk');
    const r = await chat({ action: { type: 'instruction' } });
    const m = r.messages.at(-1)!;
    const by3 = new Date(new Date(visitStart).getTime() - 3 * DAY);
    expect(m.text).toMatch(/Не істеу керек және қашан/);
    expect(m.text).toContain(`• ${fmtDayDat(by3)} дейін (3 күн бұрын):`);
    expect(m.text).toContain(`• МРТ күні, ${fmtDay(visitStart, 'kk')}, сағат ${fmtTime(visitStart)}:`);
    expect(m.text).toContain('Қазір:');
    expect(m.text).toMatch(/Сізбен хабарласады|растаңыз|тексеруден өтіңіз/);
    expect(m.text).toMatch(KK);
    expect(m.quickReplies?.some(q => q.label === DIALOG.kk.confirmVisit)).toBe(true);
    const t = await chat({ text: 'не істеуім керек' });
    expect(t.messages.at(-1)!.text).toMatch(/Не істеу керек және қашан/);
    const n = await chat({ text: 'нұсқаулық' });
    expect(n.messages.at(-1)!.text).toMatch(/Не істеу керек және қашан/);
    await setLang('ru');
  });

  it('«загрузить анализ» → как загрузить + кнопка открыть «Документы»', async () => {
    for (const t of ['анализы', 'хочу загрузить анализ']) {
      const r = await chat({ text: t });
      const m = r.messages.at(-1)!;
      expect(m.text, t).toMatch(/«Документы»/);
      const open = m.quickReplies?.find(q => q.action.type === 'open_page');
      expect(open?.action).toEqual({ type: 'open_page', page: 'documents' });
    }
    await setLang('kk');
    const r = await chat({ text: 'нәтижелер' });
    expect(r.messages.at(-1)!.text).toMatch(/«Құжаттар»/);
    await setLang('ru');
  });

  it('тревожное заключение → сразу предложение ближайшего слота; «да» записывает', async () => {
    let r = await chat({ action: { type: 'report_sample', sample: 'urgent' } });
    const proposal = findMsg(r, /Записать вас к нейрохирургу на/);
    expect(proposal).toBeTruthy();
    expect(proposal!.quickReplies?.map(q => q.action.type)).toEqual(['booking_confirm', 'booking_start', 'menu']);
    expect(r.state.journey.dialog.stage).toBe('booking_confirm');
    const pending = r.state.journey.dialog.pendingSlotId!;
    expect(pending).toMatch(/^slot-Нейрохирург-/);
    expect(r.state.bookings).toHaveLength(0); // без согласия не записываем
    r = await chat({ text: 'да', mode: 'voice' });
    expect(r.state.bookings).toHaveLength(1);
    expect(r.state.bookings[0].slotId).toBe(pending);
    expect(r.state.bookings[0].source).toBe('report_red_flag');
    expect(r.state.journey.dialog.stage).toBe('idle');
  });

  it('заключение из «Документов» (report_uploaded): предложение, «нет» — не записываем', async () => {
    const up = await app.inject({ method: 'POST', url: '/api/me/report', headers: { ...H, cookie }, payload: { text: REPORT_SAMPLES.finding } });
    expect(up.statusCode).toBe(200);
    let r = await chat({ action: { type: 'report_uploaded' } });
    expect(r.messages[0].text).toBe(DIALOG.ru.echoReportUploaded);
    expect(r.messages.some(m => m.cards?.[0]?.type === 'report')).toBe(true);
    expect(findMsg(r, /Записать вас к неврологу на/)).toBeTruthy();
    expect(r.state.journey.dialog.stage).toBe('booking_confirm');
    r = await chat({ text: 'нет' });
    expect(r.messages.at(-1)!.text).toBe(DIALOG.ru.bookingDeclined);
    expect(r.state.journey.dialog.stage).toBe('idle');
    expect(r.state.journey.dialog.pendingSlotId).toBeUndefined();
    expect(r.state.bookings).toHaveLength(1);
  });

  it('другая тема после предложения: последующее «да» не записывает молча', async () => {
    let r = await chat({ action: { type: 'report_uploaded' } });
    expect(r.state.journey.dialog.stage).toBe('booking_confirm');
    await chat({ text: 'Можно ли пить воду перед МРТ?' });
    r = await chat({ text: 'да' });
    expect(r.state.bookings).toHaveLength(1);
  });

  it('вопрос о термине из своего заключения — ответ из словаря и текста заключения', async () => {
    const r = await chat({ text: 'что значит глиоз в моём заключении?' });
    const t = r.messages.at(-1)!.text;
    expect(t).toMatch(/В вашем заключении есть «глиоз»/);
    expect(t).toMatch(/не диагноз/);
    expect(r.messages.at(-1)!.quickReplies?.some(q => q.action.type === 'booking_start')).toBe(true);
  });

  it('анализ из «Документов» (lab_uploaded): итог, влияние на МРТ, предложение записи', async () => {
    const st = await state();
    const pid = st.profile.id;
    const takenOn = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
    // Если API документов готов — проверяем сквозной путь; иначе (или дополнительно) — синтетический отчёт в хранилище.
    const extract = await app.inject({
      method: 'POST', url: '/api/me/documents/extract', headers: { ...H, cookie },
      payload: { kind: 'labs', mime: 'text/plain', fileName: 'labs.txt', text: `Дата: ${takenOn}\nКреатинин 84 мкмоль/л (44-97)\nГемоглобин 98 г/л (120-150) L\nГлюкоза 5,1 ммоль/л (3,9-6,1)` },
    });
    if (extract.statusCode === 200 && extract.json().labReport) {
      const draft = extract.json().labReport as LabReport;
      const conf = await app.inject({ method: 'PUT', url: `/api/me/labs/${draft.id}`, headers: { ...H, cookie }, payload: { items: draft.items, takenOn } });
      expect(conf.statusCode).toBe(200);
      const r = await chat({ action: { type: 'lab_uploaded', labId: draft.id } });
      expect(r.messages.some(m => m.cards?.some(c => c.type === 'lab_report'))).toBe(true);
    }

    // Детерминированный синтетический анализ: гемоглобин ниже референса → attention → терапевт.
    const lab: LabReport = {
      id: 'lab-v5-test', uploadedAt: new Date(Date.now() + 1000).toISOString(), takenOn, source: 'text', extractedBy: 'manual', confirmed: true, lang: 'ru',
      items: [
        { id: 'i1', code: 'creatinine', name: 'Креатинин', value: 84, valueText: '84', unit: 'мкмоль/л', refLow: 44, refHigh: 97, refText: '44–97', status: 'normal' },
        { id: 'i2', code: 'hgb', name: 'Гемоглобин (HGB)', value: 98, valueText: '98', unit: 'г/л', refLow: 120, refHigh: 150, refText: '120–150', labFlag: 'L', status: 'low' },
      ],
      analysis: {
        level: 'attention', summary: 'Один показатель ниже референса лаборатории.', summaryBy: 'rules',
        items: [
          { itemId: 'i1', title: 'Креатинин', plain: 'показывает, как работают почки', statusText: 'в пределах референса лаборатории', advice: '', mriRelevant: true },
          { itemId: 'i2', title: 'Гемоглобин', plain: 'белок, который переносит кислород', statusText: 'ниже референса лаборатории', advice: 'Покажите результат терапевту.' },
        ],
        recommendations: ['Обсудите гемоглобин с терапевтом.'], doctorQuestions: ['С чем может быть связан низкий гемоглобин?'],
        recommendedSpecialty: 'Терапевт', recommendedSpecialtyLabel: 'Терапевт',
        mri: { creatinineUmolL: 84, egfr: 78, appliedToScreening: true },
        disclaimer: 'Демо. Не диагноз.',
      },
    };
    const journey = getDb().journeys.find(j => j.patientId === pid)!;
    journey.labReports = [lab, ...(journey.labReports ?? [])]; // новые — первыми (как в services)

    let r = await chat({ action: { type: 'lab_uploaded', labId: lab.id } });
    expect(r.messages[0].text).toBe(DIALOG.ru.echoLabUploaded);
    const summary = r.messages.find(m => m.cards?.[0]?.type === 'lab_report')!;
    expect(summary.text).toMatch(/вне референса лаборатории: Гемоглобин 98 г\/л — ниже референса лаборатории/);
    expect(summary.text).toMatch(/креатинин учтён, рСКФ ≈ 78 — координатор проверит/);
    expect(summary.text).toMatch(/не ставлю диагноз/);
    expect(findMsg(r, /Записать вас к терапевту на/)).toBeTruthy();
    expect(r.state.journey.dialog.pendingSlotId).toMatch(/^slot-Терапевт-/);
    r = await chat({ action: { type: 'booking_confirm' } });
    const b = r.state.bookings.find(x => x.specialty === 'Терапевт');
    expect(b?.reason).toMatch(/анализов/);
    expect(r.messages.at(-1)!.text).toMatch(/Возьмите бланк анализов/);

    // Вопрос о своём показателе — ответ из бланка, сравнение только с референсом лаборатории.
    r = await chat({ text: 'мой гемоглобин нормальный?' });
    const t = r.messages.at(-1)!.text;
    expect(t).toMatch(/Гемоглобин в вашем анализе: 98 г\/л — ниже референса лаборатории \(референс лаборатории: 120–150\)/);
    expect(t).toMatch(/не ставлю диагноз/);
  });

  it('kk: тревожное заключение → «жазайын ба?», «иә» записывает', async () => {
    await setLang('kk');
    const before = (await state()).bookings.length;
    let r = await chat({ action: { type: 'report_sample', sample: 'urgent' } });
    const p = findMsg(r, /жазайын ба\?/);
    expect(p).toBeTruthy();
    expect(p!.text).toMatch(/Сіз «иә» десеңіз ғана жазамын/);
    // Слот к нейрохирургу уже занят в этом тесте — предлагается следующий свободный.
    r = await chat({ text: 'иә' });
    expect(r.state.bookings.length).toBe(before + 1);
    await setLang('ru');
  });
});
