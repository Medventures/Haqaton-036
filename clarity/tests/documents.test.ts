// Документы пациента: разбор бланка анализов правилами, статусы по референсу лаборатории,
// подтверждение → анализ → креатинин в проверке перед МРТ, заключение из текста. Режим без LLM.
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthMe, ExtractedText, LabItem, LabReport, PatientState } from '../shared/types';

process.env.NODE_ENV = 'test';
process.env.LLM_API_KEY = '';
process.env.GOOGLE_CLIENT_ID = '';

const { useMemoryStore } = await import('../server/store');
const { buildApp } = await import('../server/app');
const { parseLabText, parseRef } = await import('../server/documents/labParser');
const { analyzeLabs, computeStatus } = await import('../server/documents/labAnalysis');
const svc = await import('../server/services');

useMemoryStore();
const app = buildApp();
const H = { 'x-clarity': '1' };
let cookie = '';
let patientId = '';

const SAMPLE = `Лаборатория «Демо-Лаб» (синтетический пример)
Дата взятия: 12.09.2026
1. Креатинин 84 мкмоль/л 44–80
Гемоглобин (HGB) 128 г/л 120-150
Глюкоза: 5,4 ммоль/л (3,9 – 6,1)
АЛТ 52 ↑ Ед/л < 41
Лейкоциты (WBC)\t6,2\t10^9/л\t4,0 - 9,0
Натрий 140 ммоль/л
Возраст: 58 лет`;

const KK_LETTERS = /[әғқңөұүһі]/i;

function makePdf(lines: string[]): string {
  const content = lines.map((l, i) => `BT /F1 12 Tf 50 ${750 - i * 20} Td (${l}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1').toString('base64');
}

const item = (p: Partial<LabItem>): LabItem => {
  const base = { id: p.id ?? 'x', name: p.name ?? 'X', value: p.value ?? null, valueText: p.valueText ?? String(p.value ?? ''), ...p } as LabItem;
  return { ...base, status: computeStatus(base) };
};

describe('Разбор бланка анализов правилами', () => {
  it('находит показатели, единицы, референсы и дату взятия', () => {
    const { items, takenOn } = parseLabText(SAMPLE);
    expect(takenOn).toBe('2026-09-12');
    const by = Object.fromEntries(items.map(i => [i.code ?? i.name, i]));
    expect(by.creatinine).toMatchObject({ value: 84, unit: 'мкмоль/л', refLow: 44, refHigh: 80 });
    expect(by.hgb).toMatchObject({ name: 'Гемоглобин (HGB)', value: 128, refLow: 120, refHigh: 150 });
    expect(by.glucose).toMatchObject({ value: 5.4, refLow: 3.9, refHigh: 6.1 });
    expect(by.alt).toMatchObject({ value: 52, refHigh: 41, labFlag: '↑' });
    expect(by.wbc).toMatchObject({ value: 6.2, unit: '10^9/л', refLow: 4, refHigh: 9 });
    expect(by.sodium?.refText).toBeUndefined();
    // «Возраст: 58 лет» — не показатель
    expect(items.some(i => /возраст/i.test(i.name))).toBe(false);
  });

  it('разные записи референса', () => {
    expect(parseRef('3,9 – 6,1')).toEqual({ refLow: 3.9, refHigh: 6.1 });
    expect(parseRef('< 5,0')).toEqual({ refHigh: 5 });
    expect(parseRef('до 41')).toEqual({ refHigh: 41 });
    expect(parseRef('> 60')).toEqual({ refLow: 60 });
    expect(parseRef('')).toEqual({});
  });
});

describe('Статусы только по референсу лаборатории', () => {
  it('выше/в пределах/ниже', () => {
    expect(item({ code: 'creatinine', value: 84, refLow: 44, refHigh: 80 }).status).toBe('high');
    expect(item({ code: 'glucose', value: 5.4, refLow: 3.9, refHigh: 6.1 }).status).toBe('normal');
    expect(item({ code: 'hgb', value: 110, refLow: 120, refHigh: 150, unit: 'г/л' }).status).toBe('low');
  });

  it('нет референса → unknown и честная фраза; отметка лаборатории учитывается', () => {
    const it1 = item({ code: 'sodium', value: 140, unit: 'ммоль/л' });
    expect(it1.status).toBe('unknown');
    const a = analyzeLabs([it1], { lang: 'ru' });
    expect(a.items[0].statusText).toContain('Референс не указан — сравнивать не будем');
    expect(a.level).toBe('ok');
    expect(item({ code: 'crp', value: 12, labFlag: 'H' }).status).toBe('high');
  });

  it('калий 6,8 ммоль/л → критично, уровень urgent, совет 103', () => {
    const k = item({ code: 'potassium', name: 'Калий', value: 6.8, unit: 'ммоль/л', refLow: 3.5, refHigh: 5.1 });
    expect(k.status).toBe('critical_high');
    const a = analyzeLabs([k], { lang: 'ru' });
    expect(a.level).toBe('urgent');
    expect(a.recommendations.join(' ')).toMatch(/сегодня/);
    expect(a.recommendations.join(' ')).toMatch(/103/);
    expect(a.recommendedSpecialty).toBeTruthy();
    expect(a.summary).not.toMatch(/у вас (?:болезнь|диагноз)/i);
  });

  it('креатинин в мг/дл пересчитывается для МРТ', async () => {
    const { mriFromItems } = await import('../server/documents/labAnalysis');
    const m = mriFromItems([item({ code: 'creatinine', value: 1.1, unit: 'мг/дл' })], { birthYear: 1968, sex: 'female' }, new Date('2026-09-30'));
    expect(m?.creatinineUmolL).toBe(97);
    expect(m?.egfr).toBeGreaterThan(30);
  });

  it('анализ на казахском — казахские тексты', () => {
    const items = [item({ code: 'creatinine', name: 'Креатинин', value: 84, refLow: 44, refHigh: 80 }), item({ code: 'sodium', name: 'Натрий', value: 140 })];
    const a = analyzeLabs(items, { lang: 'kk' });
    expect(a.summary).toMatch(KK_LETTERS);
    expect(a.disclaimer).toMatch(KK_LETTERS);
    expect(a.items[0].title).toBe('Креатинин');
    expect(a.items[0].plain).toMatch(KK_LETTERS);
    expect(a.items[1].statusText).toMatch(/салыстырмаймыз/);
    expect(a.recommendations.every(r => KK_LETTERS.test(r))).toBe(true);
    expect(a.recommendedSpecialtyLabel).toBeTruthy();
  });
});

describe('API: загрузка, подтверждение, анализ', () => {
  beforeAll(async () => {
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/auth/demo', headers: H, payload: { as: 'aliya' } });
    expect(res.statusCode).toBe(200);
    cookie = String(res.headers['set-cookie']).split(';')[0];
    const st = (await app.inject({ method: 'GET', url: '/api/me/state', headers: { cookie } })).json() as PatientState;
    patientId = st.profile.id;
  });

  const post = (payload: object) => app.inject({ method: 'POST', url: '/api/me/documents/extract', headers: { ...H, cookie }, payload });

  it('текст заключения возвращается как есть', async () => {
    const text = 'Заключение: МР-картина без очаговых изменений вещества головного мозга. Срединные структуры не смещены.';
    const res = await post({ kind: 'report', mime: 'text/plain', text, fileName: 'report.txt' });
    expect(res.statusCode).toBe(200);
    const { extracted } = res.json() as { extracted: ExtractedText };
    expect(extracted.text).toBe(text);
    expect(extracted.extractedBy).toBe('text');
    // тот же текст из base64-файла
    const res2 = await post({ kind: 'report', mime: 'text/plain', dataBase64: Buffer.from(text).toString('base64') });
    expect((res2.json() as { extracted: ExtractedText }).extracted.text).toBe(text);
  });

  it('без CSRF-заголовка и без входа — отказ; неподдерживаемый тип — 415', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/me/documents/extract', headers: { cookie }, payload: { kind: 'labs', mime: 'text/plain', text: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/me/documents/extract', headers: H, payload: { kind: 'labs', mime: 'text/plain', text: 'x' } })).statusCode).toBe(401);
    expect((await post({ kind: 'labs', mime: 'application/zip', dataBase64: 'UEsDBA==' })).statusCode).toBe(415);
  });

  it('фото без LLM → 503 с понятным сообщением', async () => {
    const res = await post({ kind: 'labs', mime: 'image/png', dataBase64: Buffer.from('fakepng').toString('base64') });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: string }).error).toMatch(/вручную/);
  });

  it('PDF с текстовым слоем разбирается, без текста — просим фото', async () => {
    const res = await post({ kind: 'labs', mime: 'application/pdf', fileName: 'labs.pdf', dataBase64: makePdf(['Creatinine 84 umol/L 44-80', 'Glucose 5.4 mmol/L 3.9-6.1']) });
    expect(res.statusCode).toBe(200);
    const { labReport } = res.json() as { labReport: LabReport };
    expect(labReport.source).toBe('pdf');
    expect(labReport.items.find(i => i.code === 'creatinine')?.status).toBe('high');
    const empty = await post({ kind: 'report', mime: 'application/pdf', dataBase64: makePdf([]) });
    expect(empty.statusCode).toBe(422);
    expect((empty.json() as { error: string }).error).toMatch(/фото/);
  }, 30_000);

  it('ручной ввод строками и пустой черновик (без LLM)', async () => {
    const res = await post({ kind: 'labs', mime: 'text/plain', text: 'Креатинин: 84 мкмоль/л (44–80)\nСОЭ: 12 мм/ч' });
    const { labReport } = res.json() as { labReport: LabReport };
    expect(labReport.items[0]).toMatchObject({ code: 'creatinine', value: 84, refLow: 44, refHigh: 80, status: 'high' });
    expect(labReport.items[1]).toMatchObject({ code: 'esr', value: 12, status: 'unknown' });
    const empty = await post({ kind: 'labs', mime: 'text/plain', text: 'просто текст без показателей' });
    expect(empty.statusCode).toBe(200);
    const body = empty.json() as { labReport: LabReport; extracted?: ExtractedText };
    expect(body.labReport.id).toBeTruthy();
    expect(body.labReport.items).toHaveLength(0);
    expect(body.extracted?.warning).toBeTruthy();
    // статус из браузера игнорируется — сервер пересчитывает
    const put = await app.inject({ method: 'PUT', url: `/api/me/labs/${body.labReport.id}`, headers: { ...H, cookie }, payload: { items: [{ name: 'Калий', valueText: '6,9', unit: 'ммоль/л', refText: '3,5–5,1', status: 'normal' }] } });
    expect((put.json() as { labReport: LabReport }).labReport.items[0].status).toBe('critical_high');
    await app.inject({ method: 'DELETE', url: `/api/me/labs/${body.labReport.id}`, headers: { ...H, cookie } });
    await app.inject({ method: 'DELETE', url: `/api/me/labs/${labReport.id}`, headers: { ...H, cookie } });
  });

  it('черновик → подтверждение: статусы, анализ, креатинин в проверке МРТ (рСКФ)', async () => {
    const res = await post({ kind: 'labs', mime: 'text/plain', text: SAMPLE });
    expect(res.statusCode).toBe(200);
    const draft = (res.json() as { labReport: LabReport }).labReport;
    expect(draft.confirmed).toBe(false);
    expect(draft.extractedBy).toBe('rules');
    expect(draft.takenOn).toBe('2026-09-12');
    const st0 = (await app.inject({ method: 'GET', url: '/api/me/state', headers: { cookie } })).json() as PatientState;
    expect(st0.journey.labReports?.some(r => r.id === draft.id && !r.confirmed)).toBe(true);

    // пациент исправил гемоглобин и подтвердил
    const items = draft.items.map(i => (i.code === 'hgb' ? { ...i, valueText: '118' } : i));
    const put = await app.inject({ method: 'PUT', url: `/api/me/labs/${draft.id}`, headers: { ...H, cookie }, payload: { items, takenOn: '2026-09-25' } });
    expect(put.statusCode).toBe(200);
    const { labReport, state } = put.json() as { labReport: LabReport; state: PatientState };
    expect(labReport.confirmed).toBe(true);
    expect(labReport.items.find(i => i.code === 'hgb')).toMatchObject({ value: 118, status: 'low' });
    expect(labReport.items.find(i => i.code === 'sodium')?.status).toBe('unknown');
    const a = labReport.analysis!;
    expect(a.level).toBe('attention');
    expect(a.summaryBy).toBe('rules');
    expect(a.recommendations.join(' ')).toMatch(/врачу, который назначил анализ/);
    expect(a.recommendedSpecialty).toBe('Терапевт');
    expect(a.disclaimer).toMatch(/не диагноз/);
    expect(a.mri).toMatchObject({ creatinineUmolL: 84, appliedToScreening: true });
    expect(a.mri?.egfr).toBeGreaterThan(0);
    expect(state.journey.lab).toMatchObject({ status: 'provided', creatinineUmolL: 84, takenOn: '2026-09-25' });
    expect(state.journey.screening?.egfr).toBe(a.mri?.egfr);

    // контекст для ассистента
    const ctx = svc.labsSummaryForAgent(patientId, 'ru');
    expect(ctx).toMatch(/Креатинин: 84 мкмоль\/л \(реф\. 44–80\) — выше референса/);
    expect(svc.latestLabReport(patientId)?.id).toBe(draft.id);
  });

  it('критический калий → urgent и срочная задача координатору', async () => {
    const res = await post({ kind: 'labs', mime: 'text/plain', text: 'Калий (K+) 6,8 ммоль/л 3,5-5,1\nГлюкоза 5,0 ммоль/л 3,9-6,1' });
    const draft = (res.json() as { labReport: LabReport }).labReport;
    const put = await app.inject({ method: 'PUT', url: `/api/me/labs/${draft.id}`, headers: { ...H, cookie }, payload: { items: draft.items, takenOn: '2026-09-28' } });
    const { labReport, state } = put.json() as { labReport: LabReport; state: PatientState };
    expect(labReport.analysis?.level).toBe('urgent');
    expect(state.openTasks.some(t => t.kind === 'callback' && t.priority === 'urgent')).toBe(true);
  });

  it('смена языка на казахский — анализ пересобирается на казахском', async () => {
    const prefs = await app.inject({ method: 'PUT', url: '/api/prefs', headers: { ...H, cookie }, payload: { lang: 'kk' } });
    expect((prefs.json() as AuthMe).user?.lang).toBe('kk');
    const st = (await app.inject({ method: 'GET', url: '/api/me/state', headers: { cookie } })).json() as PatientState;
    const confirmed = st.journey.labReports!.filter(r => r.confirmed);
    expect(confirmed.length).toBeGreaterThan(0);
    for (const r of confirmed) {
      expect(r.analysis!.summary).toMatch(KK_LETTERS);
      expect(r.analysis!.recommendations.join(' ')).toMatch(KK_LETTERS);
    }
    expect(svc.labsSummaryForAgent(patientId, 'kk')).toMatch(/Калий|Креатинин/);
    await app.inject({ method: 'PUT', url: '/api/prefs', headers: { ...H, cookie }, payload: { lang: 'ru' } });
  });

  it('заключение: сводка для ассистента', async () => {
    await app.inject({ method: 'POST', url: '/api/me/report', headers: { ...H, cookie }, payload: { text: 'Заключение: МР-картина без очаговых изменений вещества головного мозга.' } });
    const s = svc.reportSummaryForAgent(patientId, 'ru');
    expect(s).toMatch(/Уровень по правилам: routine/);
    expect(s).toMatch(/без очаговых изменений/);
  });

  it('удаление бланка', async () => {
    const st = (await app.inject({ method: 'GET', url: '/api/me/state', headers: { cookie } })).json() as PatientState;
    const id = st.journey.labReports!.find(r => r.analysis?.mri?.appliedToScreening)!.id;
    expect(st.journey.lab.status).toBe('provided');
    const del = await app.inject({ method: 'DELETE', url: `/api/me/labs/${id}`, headers: { ...H, cookie } });
    expect(del.statusCode).toBe(200);
    const after = del.json() as PatientState;
    expect(after.journey.labReports?.some(r => r.id === id)).toBe(false);
    // креатинин пришёл из этого бланка — убран и из проверки перед МРТ
    expect(after.journey.lab.status).toBe('unknown');
    expect((await app.inject({ method: 'DELETE', url: `/api/me/labs/${id}`, headers: { ...H, cookie } })).statusCode).toBe(404);
  });
});
