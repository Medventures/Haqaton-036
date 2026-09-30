import { describe, expect, it } from 'vitest';
import { egfrCkdEpi2021, evaluateScreening } from '../server/domain/screening';
import { analyzeReport, findRedFlags, isNegated, REPORT_SAMPLES } from '../server/domain/report';
import { parseAnswer, parseCreatinine, parseLabDate, detectIntent } from '../server/domain/nlu';
import { detectEmergency, isClinicalDecisionRequest, violatesOutputPolicy } from '../server/domain/safety';
import { buildPrepPlan, buildReminders } from '../server/domain/prep';
import { retrieve } from '../server/assistant/knowledge';
import type { Answer, Journey, PatientProfile, Visit } from '../shared/types';

const NOW = new Date('2026-09-30T09:00:00+05:00');
const woman: PatientProfile = { id: 'p', displayName: 'Тест', initials: 'Т', birthYear: 1968, sex: 'female', phoneMasked: '' };
const man: PatientProfile = { ...woman, sex: 'male' };
const allNo: Record<string, Answer> = { pacemaker: 'no', implants: 'no', metal_work: 'no', kidney: 'no', contrast_reaction: 'no', allergy_asthma: 'no', pregnancy: 'no', breastfeeding: 'no', claustrophobia: 'no' };
const freshLab = { status: 'provided' as const, creatinineUmolL: 70, takenOn: '2026-09-25' };

describe('рСКФ CKD-EPI 2021', () => {
  it('совпадает с опубликованными примерами (±1)', () => {
    // 58 лет, женщина, креатинин 70 мкмоль/л (0.79 мг/дл) ≈ 86
    expect(egfrCkdEpi2021(70, 58, 'female')).toBeGreaterThanOrEqual(84);
    expect(egfrCkdEpi2021(70, 58, 'female')).toBeLessThanOrEqual(88);
    // 70 лет, мужчина, креатинин 200 мкмоль/л ≈ 29
    expect(egfrCkdEpi2021(200, 70, 'male')).toBeGreaterThanOrEqual(27);
    expect(egfrCkdEpi2021(200, 70, 'male')).toBeLessThanOrEqual(31);
  });
});

describe('Проверка противопоказаний и анализов', () => {
  it('без ответов — incomplete', () => {
    expect(evaluateScreening({}, { status: 'unknown' }, woman, NOW).overall).toBe('incomplete');
  });
  it('все «нет» и свежий анализ — ready', () => {
    const r = evaluateScreening(allNo, freshLab, woman, NOW);
    expect(r.overall).toBe('ready');
    expect(r.egfr).toBeGreaterThan(60);
  });
  it('кардиостимулятор — hold_for_review, а не «отмена»', () => {
    const r = evaluateScreening({ ...allNo, pacemaker: 'yes' }, freshLab, woman, NOW);
    expect(r.overall).toBe('hold_for_review');
    expect(r.flags[0].severity).toBe('critical');
  });
  it('«не знаю» уходит координатору', () => {
    expect(evaluateScreening({ ...allNo, implants: 'unknown' }, freshLab, woman, NOW).overall).toBe('needs_review');
  });
  it('устаревший анализ и отсутствие анализа отмечаются', () => {
    expect(evaluateScreening(allNo, { ...freshLab, takenOn: '2026-08-01' }, woman, NOW).flags.map(f => f.id)).toContain('lab:stale');
    expect(evaluateScreening(allNo, { status: 'none' }, woman, NOW).flags.map(f => f.id)).toContain('lab:missing');
  });
  it('низкая рСКФ — critical', () => {
    const r = evaluateScreening(allNo, { ...freshLab, creatinineUmolL: 260 }, woman, NOW);
    expect(r.flags.map(f => f.id)).toContain('lab:egfr_critical');
    expect(r.overall).toBe('hold_for_review');
  });
  it('вопросы о беременности не требуются у мужчин', () => {
    const { pregnancy: _p, breastfeeding: _b, ...rest } = allNo;
    expect(evaluateScreening(rest, freshLab, man, NOW).overall).toBe('ready');
  });
});

describe('Подготовка и напоминания', () => {
  const journey: Journey = { patientId: 'p', visitId: 'v', answers: { ...allNo, claustrophobia: 'yes', implants: 'yes' }, lab: { status: 'none' }, prepChecks: [], dialog: { stage: 'idle', qIndex: 0, greeted: true } };
  const visit: Visit = { id: 'v', patientId: 'p', procedureId: 'x', procedure: 'МРТ', startsAt: '2026-10-04T09:30:00.000Z', clinic: 'GC', address: 'адрес', city: 'Алматы', status: 'scheduled' };
  it('персональные пункты добавляются по ответам', () => {
    const ids = buildPrepPlan(journey).map(p => p.id);
    expect(ids).toContain('claustrophobia');
    expect(ids).toContain('implant_card');
    expect(ids).toContain('labs');
  });
  it('три напоминания по плану full, одно — по day_before', () => {
    expect(buildReminders(visit, 'full', journey)).toHaveLength(3);
    expect(buildReminders(visit, 'day_before', journey)).toHaveLength(1);
    expect(buildReminders(visit, 'full', journey)[0].body).toMatch(/креатинин/);
  });
});

describe('Разбор заключения', () => {
  it('отрицания снимают находку', () => {
    expect(isNegated('Очаговых изменений вещества головного мозга не выявлено')).toBe(true);
    expect(isNegated('без патологического накопления контраста')).toBe(true);
    expect(isNegated('объёмное образование не исключается')).toBe(false);
    expect(findRedFlags('Признаков объёмного образования не выявлено.')).toHaveLength(0);
  });
  it('«не исключается» — это подозрение, а не отрицание', () => {
    expect(findRedFlags('Нельзя исключить объёмное образование.').length).toBeGreaterThan(0);
  });
  it('норма → routine без флагов', () => {
    const r = analyzeReport(REPORT_SAMPLES.normal, 'sample', 'r', NOW);
    expect(r.level).toBe('routine');
    expect(r.redFlags).toHaveLength(0);
  });
  it('находки → follow_up и невролог', () => {
    const r = analyzeReport(REPORT_SAMPLES.finding, 'sample', 'r', NOW);
    expect(r.level).toBe('follow_up');
    expect(r.recommendedSpecialty).toBe('Невролог');
    expect(r.redFlags.map(f => f.id)).toContain('demyelination');
  });
  it('тревожный → urgent и нейрохирург', () => {
    const r = analyzeReport(REPORT_SAMPLES.urgent, 'sample', 'r', NOW);
    expect(r.level).toBe('urgent');
    expect(r.recommendedSpecialty).toBe('Нейрохирург');
    expect(r.doctorQuestions.length).toBeGreaterThan(1);
  });
});

describe('NLU', () => {
  it('ответы да/нет/не знаю', () => {
    expect(parseAnswer('Нет, не было')).toBe('no');
    expect(parseAnswer('да, есть кардиостимулятор')).toBe('yes');
    expect(parseAnswer('честно не помню')).toBe('unknown');
    expect(parseAnswer('у меня нет')).toBe('no');
    expect(parseAnswer('как дела')).toBeNull();
  });
  it('креатинин и даты', () => {
    expect(parseCreatinine('78')).toBe(78);
    expect(parseCreatinine('0,9 мг/дл')).toBe(80);
    expect(parseLabDate('вчера', NOW)).toBe('2026-09-29');
    expect(parseLabDate('2 недели назад', NOW)).toBe('2026-09-16');
    expect(parseLabDate('12.09', NOW)).toBe('2026-09-12');
  });
  it('намерения', () => {
    expect(detectIntent('Хочу перенести визит')).toBe('cancel');
    expect(detectIntent('объясни заключение')).toBe('report');
    expect(detectIntent('можно ли пить воду?')).toBe('question');
  });
});

describe('Безопасность', () => {
  it('экстренные симптомы', () => {
    expect(detectEmergency('после укола не могу дышать')).toBe(true);
    expect(detectEmergency('у меня отекает горло')).toBe(true);
    expect(detectEmergency('можно ли пить воду')).toBe(false);
  });
  it('клинические решения не принимаются', () => {
    expect(isClinicalDecisionRequest('можно ли мне не пить таблетки перед МРТ')).toBe(true);
    expect(isClinicalDecisionRequest('у меня рак?')).toBe(true);
  });
  it('фильтр ответа модели', () => {
    expect(violatesOutputPolicy('У вас опухоль мозга')).toBe(true);
    expect(violatesOutputPolicy('Вы можете отменить лекарства')).toBe(true);
    expect(violatesOutputPolicy('Воду пить можно, еду — нет.')).toBe(false);
  });
  it('база знаний находит ответ', () => {
    expect(retrieve('можно ли пить воду перед мрт')[0].card.id).toBe('faq-food');
    expect(retrieve('зачем креатинин')[0].card.id).toBe('faq-creatinine');
    expect(retrieve('какая погода в Париже')).toHaveLength(0);
  });
});
