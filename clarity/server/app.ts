import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { z, ZodError } from 'zod';
import type { HealthInfo } from '../shared/types';
import { config, googleConfigured, llmConfigured } from './config';
import { PROTOCOL, SCREENING } from './domain/protocol';
import { visitIcs } from './domain/ics';
import { computeMetrics } from './domain/metrics';
import { listMriSlots, listSlots, SPECIALTIES } from './domain/slots';
import { handleChat } from './assistant/dialog';
import { llmAvailable } from './assistant/llm';
import { authMe, registerAuth, requirePatient, requireStaff } from './auth';
import { synthesize, ttsStatus } from './tts';
import { isLang, type Lang } from '../shared/i18n';
import { dayOfCheckIn, overallTexts, procedureText, qText } from './i18n';
import { localizeReminders, localizeReport } from './i18n/localize';
import { DOC_MIMES } from './documents/extract';
import { labsTexts } from './documents/labTexts';
import * as svc from './services';
import { getDb, now, persist, resetDb } from './store';

const answer = z.enum(['yes', 'no', 'unknown']);
const concern = z.enum(['contrast', 'injection', 'noise', 'claustrophobia', 'preparation', 'result', 'meds', 'road']);
const assistantAction = z.object({ type: z.string() }).passthrough();

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] }, bodyLimit: 64 * 1024, trustProxy: true });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Некорректные данные', details: err.issues.map(i => i.message) });
    if (err instanceof svc.NotFound) return reply.code(404).send({ error: err.message });
    if (err instanceof svc.BadRequest) return reply.code(400).send({ error: err.message });
    if (err instanceof svc.DocumentError) return reply.code(err.statusCode).send({ error: err.message });
    if ((err as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: 'Файл слишком большой (максимум 8 МБ).' });
    app.log.error(err);
    return reply.code(err.statusCode ?? 500).send({ error: err.statusCode && err.statusCode < 500 ? err.message : 'Внутренняя ошибка сервера' });
  });

  registerAuth(app);

  const me = (req: FastifyRequest) => req.user!.patientId!;
  const patient = { preHandler: requirePatient };
  const staff = { preHandler: requireStaff };

  app.get('/api/health', async (): Promise<HealthInfo> => ({
    ok: true,
    llm: { provider: 'openai-compatible', model: config.llmModel, modelKk: config.llmModelKk, configured: llmConfigured(), available: await llmAvailable(), host: new URL(config.llmBaseUrl).host },
    tts: ttsStatus(),
    protocolVersion: PROTOCOL.version,
    now: now().toISOString(),
    timeOffsetHours: getDb().timeOffsetHours,
  }));

  // Протокол на языке интерфейса: /api/protocol?lang=kk (по умолчанию ru).
  app.get('/api/protocol', async req => {
    const q = (req.query ?? {}) as { lang?: string };
    const lang: Lang = isLang(q.lang) ? q.lang : 'ru';
    return {
      id: PROTOCOL.id, version: PROTOCOL.version, procedure: procedureText(lang), lang,
      questions: SCREENING.map(x => { const t = qText(x.id, lang); return { id: x.id, text: t.text, voice: t.voice, hint: t.hint, femaleOnly: Boolean(x.femaleOnly) }; }),
      dayOfCheck: dayOfCheckIn(lang), overallText: overallTexts(lang), labs: PROTOCOL.labs, googleLogin: googleConfigured(),
    };
  });

  // ---------- Настройки языка и аватара ----------
  app.put('/api/prefs', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Войдите в аккаунт' });
    const b = z.object({ lang: z.enum(['ru', 'kk']).optional(), avatar: z.enum(['aruzhan', 'clary']).optional() }).parse(req.body);
    if (req.user.patientId) svc.setPrefs(req.user.patientId, b);
    else if (b.lang) { req.user.lang = b.lang; persist(); }
    return authMe(req.user);
  });

  // ---------- Синтез речи ----------
  const ttsHits = new Map<string, number[]>();
  app.post('/api/tts', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Войдите в аккаунт' });
    const recent = (ttsHits.get(req.user.id) ?? []).filter(t => Date.now() - t < 60_000);
    if (recent.length >= 150) return reply.code(429).send({ error: 'Слишком много запросов озвучки' });
    ttsHits.set(req.user.id, [...recent, Date.now()]);
    const { text, lang } = z.object({ text: z.string().trim().min(1).max(800), lang: z.string().refine(isLang) }).parse(req.body);
    const wav = await synthesize(text, lang as 'ru' | 'kk');
    if (!wav) return reply.code(503).send({ error: 'Голос недоступен' });
    reply.header('content-type', 'audio/wav').header('cache-control', 'private, max-age=86400');
    return reply.send(wav);
  });

  // ---------- Пациент (только свои данные) ----------
  app.get('/api/me/state', patient, async req => svc.patientView(me(req)));

  app.post('/api/me/onboarding', patient, async req => {
    const year = now().getFullYear();
    const b = z.object({
      preferredName: z.string().trim().min(1).max(40),
      lastName: z.string().trim().max(60).optional(),
      birthYear: z.number().int().min(year - 110).max(year - 14),
      sex: z.enum(['female', 'male']),
      phone: z.string().max(24).regex(/^[\d\s()+-]*$/).optional(),
      mriSlotId: z.string().max(80).optional(),
      firstMri: z.boolean().nullable(),
      anxiety: z.number().int().min(1).max(5),
      concerns: z.array(concern).max(8),
      voice: z.boolean(),
      largeText: z.boolean(),
      consentData: z.literal(true, { errorMap: () => ({ message: 'Нужно согласие на обработку данных' }) }),
      consentAi: z.literal(true, { errorMap: () => ({ message: 'Подтвердите, что понимаете роль ИИ-помощника' }) }),
    }).parse(req.body);
    svc.completeOnboarding(me(req), b);
    return svc.patientView(me(req));
  });

  app.get('/api/mri-slots', patient, async () => ({ slots: listMriSlots(now()) }));

  app.get('/api/me/chat', patient, async req => ({ messages: getDb().chats[me(req)] ?? [] }));

  app.post('/api/me/chat', patient, async req => {
    const body = z.object({ text: z.string().max(6000).optional(), action: assistantAction.optional(), mode: z.enum(['text', 'voice']).optional() }).parse(req.body ?? {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = await handleChat(me(req), body as any);
    return { messages, state: svc.patientView(me(req)) };
  });

  app.put('/api/me/answers/:qid', patient, async req => {
    const { qid } = z.object({ qid: z.string().max(40) }).parse(req.params);
    const { value } = z.object({ value: answer }).parse(req.body);
    svc.setAnswer(me(req), qid, value);
    return svc.patientView(me(req));
  });

  app.put('/api/me/lab', patient, async req => {
    const body = z.object({
      status: z.enum(['unknown', 'none', 'provided']),
      creatinineUmolL: z.number().min(PROTOCOL.labs.creatinineMin).max(PROTOCOL.labs.creatinineMax).optional(),
      takenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).refine(b => b.status !== 'provided' || (b.creatinineUmolL && b.takenOn), { message: 'Укажите значение и дату анализа' }).parse(req.body);
    if (body.takenOn && new Date(body.takenOn) > now()) throw new svc.BadRequest('Дата анализа в будущем');
    svc.setLab(me(req), body);
    return svc.patientView(me(req));
  });

  app.put('/api/me/prep/:item', patient, async req => {
    const { item } = z.object({ item: z.string().max(40) }).parse(req.params);
    const { checked } = z.object({ checked: z.boolean() }).parse(req.body);
    svc.togglePrep(me(req), item, checked);
    return svc.patientView(me(req));
  });

  app.put('/api/me/reminders', patient, async req => {
    const { plan } = z.object({ plan: z.enum(['full', 'day_before', 'none']) }).parse(req.body);
    svc.scheduleReminders(me(req), plan);
    return svc.patientView(me(req));
  });

  app.get('/api/me/notifications', patient, async req => {
    const { profile, visit } = svc.ctx(me(req));
    return { notifications: localizeReminders(svc.deliverDue(me(req)), visit, profile.lang ?? 'ru') };
  });
  app.post('/api/me/notifications/read', patient, async req => { svc.markRemindersRead(me(req)); return { ok: true }; });

  app.post('/api/me/visit/confirm', patient, async req => { svc.confirmVisit(me(req)); return svc.patientView(me(req)); });
  app.post('/api/me/visit/reschedule', patient, async req => {
    const { reason } = z.object({ reason: z.string().min(2).max(300) }).parse(req.body);
    svc.cancelVisit(me(req), reason, true);
    return svc.patientView(me(req));
  });

  app.post('/api/me/day-of-check', patient, async req => {
    const { answers } = z.object({ answers: z.record(z.string(), z.boolean()) }).parse(req.body);
    svc.dayOfCheck(me(req), answers);
    return svc.patientView(me(req));
  });

  app.get('/api/me/visit.ics', patient, async (req, reply) => {
    const { visit } = svc.ctx(me(req));
    reply.header('content-type', 'text/calendar; charset=utf-8').header('content-disposition', 'attachment; filename="clarity-mri-visit.ics"');
    return visitIcs(visit, now());
  });

  app.post('/api/me/report', patient, async req => {
    const { text } = z.object({ text: z.string().min(10).max(6000) }).parse(req.body);
    const report = await svc.explainReport(me(req), text, 'pasted');
    return { report, state: svc.patientView(me(req)) };
  });

  // ---------- Документы: анализы и заключения ----------
  app.post('/api/me/documents/extract', { preHandler: requirePatient, bodyLimit: 12 * 1024 * 1024 }, async req => {
    const b = z.object({
      kind: z.enum(['labs', 'report']),
      fileName: z.string().max(200).optional(),
      mime: z.string().max(100).transform(m => m.toLowerCase().split(';')[0].trim().replace('image/jpg', 'image/jpeg')),
      dataBase64: z.string().max(12 * 1024 * 1024).optional(),
      text: z.string().max(20_000).optional(),
    }).refine(x => Boolean(x.dataBase64?.length || x.text?.trim()), { message: 'Нет файла или текста' }).parse(req.body);
    if (!b.text?.trim() && !DOC_MIMES.includes(b.mime)) {
      throw new svc.DocumentError(labsTexts(svc.ctx(me(req)).profile.lang ?? 'ru').errors.badMime, 415);
    }
    return svc.extractDocument(me(req), b);
  });

  const labItem = z.object({
    id: z.string().max(60).optional(),
    code: z.string().max(40).optional().nullable(),
    name: z.string().max(120),
    value: z.number().finite().nullable().optional(),
    valueText: z.string().max(60).nullable().optional(),
    unit: z.string().max(40).nullable().optional(),
    refLow: z.number().finite().nullable().optional(),
    refHigh: z.number().finite().nullable().optional(),
    refText: z.string().max(80).nullable().optional(),
    labFlag: z.string().max(12).nullable().optional(),
  }).passthrough();

  app.put('/api/me/labs/:id', patient, async req => {
    const { id } = z.object({ id: z.string().max(60) }).parse(req.params);
    const b = z.object({ items: z.array(labItem).max(60), takenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(req.body);
    return svc.confirmLabs(me(req), id, { items: b.items.map(i => ({ ...i, code: i.code ?? undefined })), takenOn: b.takenOn });
  });

  app.delete('/api/me/labs/:id', patient, async req => {
    const { id } = z.object({ id: z.string().max(60) }).parse(req.params);
    svc.deleteLabs(me(req), id);
    return svc.patientView(me(req));
  });

  app.get('/api/slots', patient, async req => {
    const { specialty, urgent } = z.object({ specialty: z.string().max(40).default('Невролог'), urgent: z.coerce.boolean().optional() }).parse(req.query);
    return { specialties: SPECIALTIES, slots: listSlots(specialty, now(), getDb().bookings, urgent) };
  });

  app.post('/api/me/bookings', patient, async req => {
    const { slotId, reason } = z.object({ slotId: z.string().max(120), reason: z.string().max(300).default('Консультация по результатам МРТ') }).parse(req.body);
    const { journey } = svc.ctx(me(req));
    const booking = svc.bookSlot(me(req), slotId, reason, journey.lastReport && journey.lastReport.level !== 'routine' ? 'report_red_flag' : 'patient_request');
    return { booking, state: svc.patientView(me(req)) };
  });

  app.post('/api/me/questions', patient, async req => {
    const { text } = z.object({ text: z.string().min(1).max(1000) }).parse(req.body);
    svc.addQuestion(me(req), text);
    return svc.patientView(me(req));
  });

  app.post('/api/me/reset', patient, async req => { svc.resetPatient(me(req)); return svc.patientView(me(req)); });

  // ---------- Персонал ----------
  app.get('/api/staff/overview', staff, async () => {
    const db = getDb();
    return {
      patients: db.patients.map(p => {
        const journey = db.journeys.find(j => j.patientId === p.id)!;
        const visit = db.visits.find(v => v.id === journey.visitId)!;
        return { profile: p, visit, screening: journey.screening, answers: journey.answers, lab: journey.lab, prepDone: journey.prepChecks.length, prepTotal: svc.patientState(p.id).prepPlan.length, reminderPlan: journey.reminderPlan, report: journey.lastReport && localizeReport(journey.lastReport, 'ru'), reportLevel: journey.lastReport?.level, labReports: (journey.labReports ?? []).filter(r => r.confirmed).map(r => svc.labReportView(r, 'ru')), bookings: db.bookings.filter(b => b.patientId === p.id), dayOfCheck: journey.dayOfCheck, events: db.events.filter(e => e.patientId === p.id).slice(-30) };
      }).sort((a, b) => a.visit.startsAt.localeCompare(b.visit.startsAt)),
      tasks: db.tasks.slice().sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved') || ['urgent', 'high', 'normal'].indexOf(a.priority) - ['urgent', 'high', 'normal'].indexOf(b.priority) || b.createdAt.localeCompare(a.createdAt)),
      protocol: { questions: SCREENING.map(q => ({ id: q.id, text: q.text })) },
    };
  });

  app.post('/api/staff/tasks/:id/resolve', staff, async req => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { resolution } = z.object({ resolution: z.string().max(500).default('') }).parse(req.body ?? {});
    return svc.resolveTask(id, resolution);
  });

  app.post('/api/staff/visits/:id/outcome', staff, async req => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z.object({ outcome: z.enum(['attended', 'no_show', 'cancelled']), prepViolation: z.boolean().default(false), note: z.string().max(300).optional() }).parse(req.body);
    return svc.recordVisitOutcome(id, b.outcome, b.prepViolation, b.note);
  });

  app.post('/api/staff/calls', staff, async req => {
    const b = z.object({ patientId: z.string(), topic: z.string().max(80) }).parse(req.body);
    svc.logInboundCall(b.patientId, b.topic);
    return { ok: true };
  });

  app.post('/api/staff/bookings/:id/complete', staff, async req => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return svc.completeBooking(id);
  });

  app.get('/api/metrics', staff, async () => computeMetrics(getDb().events, now()));

  // ---------- Демо-инструменты (выключаются вместе с DEMO_LOGIN=false) ----------
  app.post('/api/demo/time', async (req, reply) => {
    if (!config.demoLogin) return reply.code(403).send({ error: 'Демо-инструменты выключены' });
    if (!req.user) return reply.code(401).send({ error: 'Войдите в аккаунт' });
    const { offsetHours } = z.object({ offsetHours: z.number().min(-24 * 30).max(24 * 30) }).parse(req.body);
    getDb().timeOffsetHours = offsetHours;
    persist();
    return { now: now().toISOString(), offsetHours };
  });
  app.post('/api/demo/reset', staff, async (_req, reply) => {
    if (!config.demoLogin) return reply.code(403).send({ error: 'Демо-инструменты выключены' });
    resetDb();
    return { ok: true };
  });

  // ---------- Статика (production) ----------
  if (fs.existsSync(config.distDir)) {
    app.register(fastifyStatic, { root: config.distDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Не найдено' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
