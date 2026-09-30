// Казахский диалог: сквозной сценарий через ассистента (режим правил, без LLM)
// и модульные тесты казахского NLU и слоя безопасности.
// Тексты вопросов анкеты и карточек знаний переводит другой модуль (server/i18n/kk/*),
// поэтому здесь проверяются в основном языконезависимые факты и реплики из server/i18n/dialog.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ChatResponse, PatientState, Slot } from '../shared/types';

process.env.NODE_ENV = 'test';
process.env.LLM_API_KEY = '';
process.env.GOOGLE_CLIENT_ID = '';

const { useMemoryStore } = await import('../server/store');
const { buildApp } = await import('../server/app');
const { detectIntent, detectLang, parseAnswer, parseLabDate, isQuestion } = await import('../server/domain/nlu');
const { detectEmergency, isClinicalDecisionRequest, violatesOutputPolicy, emergencyText, clinicalDecisionText, CLINICAL_DECISION_TEXT_KK } = await import('../server/domain/safety');
const { DIALOG } = await import('../server/i18n/dialog');
const { actionLabel } = await import('../server/assistant/dialog');

useMemoryStore();
const app = buildApp();
const H = { 'x-clarity': '1' };
let cookie = '';
const KK = /[әғқңөұүһі]/i;

async function chat(body: object) {
  const res = await app.inject({ method: 'POST', url: '/api/me/chat', headers: { ...H, cookie }, payload: body });
  expect(res.statusCode).toBe(200);
  return res.json() as ChatResponse;
}
const last = (r: ChatResponse) => r.messages.at(-1)!;
const state = async () => (await app.inject({ method: 'GET', url: '/api/me/state', headers: { cookie } })).json() as PatientState;

describe('Казахский диалог (сквозной)', () => {
  beforeAll(async () => {
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/api/auth/demo', headers: H, payload: { as: 'new_patient' } });
    cookie = String(login.headers['set-cookie']).split(';')[0];
    const slots = (await app.inject({ method: 'GET', url: '/api/mri-slots', headers: { cookie } })).json() as { slots: Slot[] };
    const ob = await app.inject({
      method: 'POST', url: '/api/me/onboarding', headers: { ...H, cookie },
      payload: { preferredName: 'Айгерім', lastName: 'Серікова', birthYear: 1985, sex: 'female', phone: '+7 701 123 45 67', mriSlotId: slots.slots[3].id, firstMri: true, anxiety: 4, concerns: ['claustrophobia'], voice: true, largeText: false, consentData: true, consentAi: true },
    });
    expect(ob.statusCode).toBe(200);
    const prefs = await app.inject({ method: 'PUT', url: '/api/prefs', headers: { ...H, cookie }, payload: { lang: 'kk' } });
    expect(prefs.statusCode).toBe(200);
  });

  it('приветствие на казахском: имя ассистента, раскрытие ИИ, «дәрігер емеспін»', async () => {
    const r = await chat({ action: { type: 'start' } });
    const t = r.messages[0].text;
    expect(t).toMatch(/Айгерім/);
    expect(t).toMatch(/Аружан/);
    expect(t).toMatch(/ЖИ/);
    expect(t).toMatch(/дәрігер емеспін/);
    expect(t).toMatch(/уайымдайтыныңызды/);
    expect(r.messages[1].cards?.[0].type).toBe('visit');
    // Кнопки — на казахском
    expect(r.messages[1].quickReplies?.some(q => q.label === DIALOG.kk.startScreening)).toBe(true);
  });

  it('смена аватара меняет имя в приветствии', async () => {
    await app.inject({ method: 'PUT', url: '/api/prefs', headers: { ...H, cookie }, payload: { avatar: 'clary' } });
    const r = await chat({ action: { type: 'start' } });
    expect(r.messages[0].text).toMatch(/Мен — Клэри/);
    await app.inject({ method: 'PUT', url: '/api/prefs', headers: { ...H, cookie }, payload: { avatar: 'aruzhan' } });
  });

  it('анкета свободным текстом на казахском, затем анализ и итог', async () => {
    let r = await chat({ action: { type: 'screening_start' } });
    expect(r.messages[0].text).toBe(DIALOG.kk.echoScreening); // эхо кнопки на казахском
    expect(last(r).text).toMatch(/1-сұрақ \(барлығы 9\)/);
    expect(last(r).quickReplies?.map(q => q.label)).toEqual(['Жоқ', 'Иә', 'Білмеймін']);
    r = await chat({ text: 'жоқ' }); // кардиостимулятор
    r = await chat({ text: 'есімде жоқ' }); // импланты → «не знаю»
    r = await chat({ text: 'жоқ' });
    r = await chat({ text: 'болған жоқ' });
    r = await chat({ text: 'ешқашан' });
    r = await chat({ text: 'иә, демікпе бар' }); // аллергия/астма → «да»
    for (let i = 0; i < 3; i++) r = await chat({ action: { type: 'answer', value: 'no' } });
    expect(r.messages[0].text).toBe('Жоқ');
    const s = await state();
    expect(s.journey.answers.pacemaker).toBe('no');
    expect(s.journey.answers.implants).toBe('unknown');
    expect(s.journey.answers.allergy_asthma).toBe('yes');
    expect(Object.keys(s.journey.answers)).toHaveLength(9);
    expect(last(r).text).toMatch(/креатинин/);
    expect(last(r).text).toMatch(KK);
    r = await chat({ text: 'креатинин 80' });
    expect(last(r).text).toMatch(/80 мкмоль\/л/);
    r = await chat({ text: 'бір апта бұрын' });
    expect(last(r).cards?.[0].type).toBe('screening_summary');
    expect(last(r).text).toMatch(/Тексеру аяқталды/);
    const lab = (await state()).journey.lab;
    expect(lab.creatinineUmolL).toBe(80);
    expect(lab.takenOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('подготовка, напоминания и статус — на казахском', async () => {
    let r = await chat({ action: { type: 'prep' } });
    expect(last(r).text).toMatch(/дайындық жоспарыңыз/);
    expect(last(r).cards?.[0].type).toBe('prep_plan');
    r = await chat({ action: { type: 'reminder_set', plan: 'full' } });
    expect(last(r).text).toMatch(/еске салу қосылды/);
    r = await chat({ action: { type: 'status' } });
    expect(last(r).text).toMatch(/Дайындық:/);
  });

  it('экстренные симптомы по-казахски → 103', async () => {
    const r = await chat({ text: 'дем ала алмаймын' });
    expect(last(r).text).toMatch(/103/);
    expect(last(r).text).toMatch(KK);
    expect(last(r).cards?.[0].type).toBe('emergency');
  });

  it('клиническое решение по-казахски → отказ и предложение координатора', async () => {
    const r = await chat({ text: 'дәріні ішпесем бола ма' });
    expect(last(r).text).toBe(CLINICAL_DECISION_TEXT_KK);
    expect(last(r).quickReplies?.[0].action.type).toBe('human');
  });

  it('вопрос по-казахски находит карточку знаний (источник)', async () => {
    const r = await chat({ text: 'МРТ алдында су ішуге бола ма?' });
    const src = last(r).cards?.find(c => c.type === 'sources');
    expect(src && src.type === 'sources' ? src.items.map(i => i.id) : []).toContain('faq-food');
  });

  it('перенос визита: подпись причины на казахском, для координатора — по-русски', async () => {
    let r = await chat({ text: 'МРТ уақытын басқа күнге ауыстыру керек' });
    const btn = last(r).quickReplies?.[1];
    expect(btn?.label).toBe('Жоспарым өзгерді');
    r = await chat({ action: btn!.action });
    expect(r.messages[0].text).toBe('Жоспарым өзгерді');
    expect(btn!.action.type === 'visit_cancel' && btn!.action.reason).toBe('Изменились планы');
  });
});

describe('Казахский NLU', () => {
  it('parseAnswer', () => {
    for (const t of ['иә', 'ия', 'әрине', 'иә бар', 'бар', 'болған', 'болды', 'Иә, демікпе бар']) expect(parseAnswer(t), t).toBe('yes');
    for (const t of ['жоқ', 'жоқ болған', 'болған жоқ', 'ешқашан', 'болмаған', 'жок']) expect(parseAnswer(t), t).toBe('no');
    for (const t of ['білмеймін', 'есімде жоқ', 'сенімді емеспін', 'мүмкін', 'шамасы', 'білмеймін ғой', 'бiлмеймiн']) expect(parseAnswer(t), t).toBe('unknown');
    // русский — без изменений
    expect(parseAnswer('да')).toBe('yes');
    expect(parseAnswer('нет, не было')).toBe('no');
    expect(parseAnswer('не помню')).toBe('unknown');
  });

  it('detectIntent', () => {
    const cases: [string, string][] = [
      ['сауалнаманы бастайық', 'screening'], ['қарсы көрсетілімдерді тексеру', 'screening'],
      ['не алып келу керек', 'prep'], ['дайындық нұсқаулығы', 'prep'],
      ['еске салыңызшы', 'reminder'], ['ескертулерді қосу', 'reminder'],
      ['қорытындыны түсіндіріңіз', 'report'], ['нәтижені түсіндіріп беріңіз', 'report'],
      ['неврологқа жазылғым келеді', 'booking'], ['дәрігерге жазылу', 'booking'],
      ['үйлестірушімен сөйлескім келеді', 'human'], ['адаммен сөйлескім келеді', 'human'], ['оператор', 'human'],
      ['келе алмаймын', 'cancel'], ['кейінге қалдыру керек', 'cancel'],
      ['растаймын', 'confirm'], ['келемін', 'confirm'],
      ['сәлем', 'greeting'], ['сәлеметсіз бе', 'greeting'], ['қайырлы күн', 'greeting'],
      ['рақмет', 'thanks'], ['рахмет', 'thanks'], ['мәзір', 'menu'],
      ['қашан тамақ ішуге болады', 'question'], ['су ішуге бола ма', 'question'], ['ауырмай ма?', 'question'],
    ];
    for (const [t, intent] of cases) expect(detectIntent(t), t).toBe(intent);
    expect(isQuestion('контраст қауіпті ме')).toBe(true);
    expect(detectIntent('Можно ли пить воду?')).toBe('question');
  });

  it('parseLabDate', () => {
    const now = new Date(2026, 8, 30, 12);
    expect(parseLabDate('бүгін', now)).toBe('2026-09-30');
    expect(parseLabDate('кеше', now)).toBe('2026-09-29');
    expect(parseLabDate('алдыңғы күні', now)).toBe('2026-09-28');
    expect(parseLabDate('5 күн бұрын', now)).toBe('2026-09-25');
    expect(parseLabDate('бір апта бұрын', now)).toBe('2026-09-23');
    expect(parseLabDate('2 апта бұрын', now)).toBe('2026-09-16');
    expect(parseLabDate('бір ай бұрын', now)).toBe('2026-08-31');
    expect(parseLabDate('12.09', now)).toBe('2026-09-12');
    expect(parseLabDate('вчера', now)).toBe('2026-09-29');
  });

  it('detectLang', () => {
    expect(detectLang('Сәлеметсіз бе')).toBe('kk');
    expect(detectLang('жок, болган жок')).toBe('kk');
    expect(detectLang('Здравствуйте, как у вас дела?')).toBe('ru');
    expect(detectLang('78')).toBeNull();
  });

  it('эхо действий есть на обоих языках', () => {
    expect(actionLabel({ type: 'answer', value: 'unknown' }, 'kk')).toBe('Білмеймін');
    expect(actionLabel({ type: 'answer', value: 'unknown' }, 'ru')).toBe('Не знаю');
    expect(actionLabel({ type: 'human' }, 'kk')).toMatch(KK);
  });
});

describe('Казахский слой безопасности', () => {
  it('экстренные состояния', () => {
    for (const t of ['дем ала алмаймын', 'тыныс алу қиын', 'тұншығып барамын', 'кеудем ауырады', 'кеудем қысып тұр', 'есімнен танып қалдым', 'талып қалдым', 'құрысып жатыр', 'тамағым ісіп кетті', 'тілім ісіп барады', 'сөйлей алмаймын', 'бетім ұйып қалды', 'кенет қатты бас ауруы басталды', 'өзімді өлтіргім келеді', 'өмір сүргім келмейді'])
      expect(detectEmergency(t), t).toBe(true);
    for (const t of ['МРТ алдында су ішуге бола ма?', 'басым ауырмайды', 'рақмет']) expect(detectEmergency(t), t).toBe(false);
    expect(emergencyText('kk')).toMatch(/103/);
    expect(emergencyText('ru')).toMatch(/скорая/);
  });

  it('запросы клинических решений', () => {
    for (const t of ['дәріні ішпесем бола ма', 'дәріні тоқтатуға бола ма', 'диагнозым қандай', 'бұл қатерлі ісік пе', 'қанша мг ішу керек'])
      expect(isClinicalDecisionRequest(t), t).toBe(true);
    expect(isClinicalDecisionRequest('МРТ қанша уақыт алады?')).toBe(false);
    expect(clinicalDecisionText('kk')).toMatch(/дәрігер/);
  });

  it('фильтр ответа модели', () => {
    for (const t of ['Сізде ісік бар.', 'Дәріні тоқтата аласыз.', 'Сізге контраст салуға болады.', 'Мен дәрігермін.', 'Уайымдамаңыз, бәрі жақсы болады.'])
      expect(violatesOutputPolicy(t), t).toBe(true);
    expect(violatesOutputPolicy('Мен дәрігер емеспін, бірақ дайындалуға көмектесемін.')).toBe(false);
  });
});
