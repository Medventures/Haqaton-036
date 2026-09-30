// Авторизация: Google OAuth 2.0 / OpenID Connect (Authorization Code + PKCE),
// серверные сессии (непрозрачный токен в httpOnly-cookie), роли patient/staff.
// Без внешних зависимостей: только fetch и node:crypto.

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthMe, Role, User } from '../shared/types';
import { config, googleConfigured } from './config';
import { getDb, newId, now, persist } from './store';
import { createPatient } from './services';
import { DEMO_PATIENT_ID } from './seed';

const SID = 'clarity_sid';
const OAUTH = 'clarity_oauth';

declare module 'fastify' {
  interface FastifyRequest { user: User | null }
}

// ---------- cookie ----------
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name: string, value: string, maxAgeSec: number) {
  const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

// ---------- сессии ----------
function createSession(reply: FastifyReply, user: User) {
  const db = getDb();
  const id = crypto.randomBytes(32).toString('base64url');
  const created = new Date(); // сессии живут по реальному времени, не по демо-часам
  db.sessions = db.sessions.filter(s => new Date(s.expiresAt) > created); // уборка просроченных
  db.sessions.push({ id: hash(id), userId: user.id, createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + config.sessionDays * 86_400_000).toISOString() });
  user.lastLoginAt = created.toISOString();
  persist();
  reply.header('set-cookie', cookie(SID, id, config.sessionDays * 86_400));
}

// В хранилище лежит только хэш токена: утечка файла не даёт войти в чужую сессию.
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('base64url');

function userFromRequest(req: FastifyRequest): User | null {
  const token = parseCookies(req.headers.cookie)[SID];
  if (!token) return null;
  const db = getDb();
  const s = db.sessions.find(x => x.id === hash(token));
  if (!s || new Date(s.expiresAt) < new Date()) return null;
  return db.users.find(u => u.id === s.userId) ?? null;
}

// ---------- guards ----------
export async function requirePatient(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.code(401).send({ error: 'Войдите в аккаунт' });
  if (!req.user.patientId) return reply.code(403).send({ error: 'Доступно только пациентам' });
}

export async function requireStaff(req: FastifyRequest, reply: FastifyReply) {
  const token = process.env.STAFF_TOKEN;
  if (token && req.headers['x-staff-token'] === token) return;
  if (req.user?.role === 'staff') return;
  return reply.code(req.user ? 403 : 401).send({ error: req.user ? 'Доступно только сотрудникам клиники' : 'Войдите как сотрудник клиники' });
}

export function authMe(user: User | null): AuthMe {
  const db = getDb();
  const patient = user?.patientId ? db.patients.find(p => p.id === user.patientId) : undefined;
  return {
    user: user ? { id: user.id, email: user.email, name: user.name, picture: user.picture, role: user.role, provider: user.provider, onboarded: user.role === 'staff' || Boolean(patient?.onboarding), lang: patient?.lang ?? user.lang ?? 'ru', avatar: patient?.avatar ?? 'aruzhan' } : null,
    google: googleConfigured(),
    demo: config.demoLogin,
  };
}

function upsertUser(p: { email: string; name: string; picture?: string; provider: User['provider']; role?: Role }): User {
  const db = getDb();
  const email = p.email.toLowerCase();
  let user = db.users.find(u => u.email === email && u.provider === p.provider);
  const role: Role = p.role ?? (config.staffEmails.includes(email) ? 'staff' : 'patient');
  if (!user) {
    user = { id: newId('u'), email, name: p.name, picture: p.picture, provider: p.provider, role, createdAt: now().toISOString(), lastLoginAt: now().toISOString() };
    db.users.push(user);
  } else {
    Object.assign(user, { name: p.name || user.name, picture: p.picture ?? user.picture, role });
  }
  if (user.role === 'patient' && !user.patientId) user.patientId = createPatient({ name: user.name, email, picture: user.picture }).id;
  persist();
  return user;
}

// ---------- Google OIDC ----------
interface Pending { verifier: string; nonce: string; createdAt: number }
const pending = new Map<string, Pending>();

const b64url = (buf: Buffer) => buf.toString('base64url');

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1];
  if (!part) throw new Error('bad id_token');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    req.user = userFromRequest(req);
    // CSRF: изменяющие запросы должны нести заголовок, который нельзя выставить из чужой формы.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-clarity'] !== '1') {
      return reply.code(403).send({ error: 'Запрос отклонён (CSRF)' });
    }
  });

  app.get('/api/auth/me', async req => authMe(req.user));

  app.get('/api/auth/google', async (_req, reply) => {
    if (!googleConfigured()) return reply.code(503).send({ error: 'Вход через Google не настроен: задайте GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET' });
    for (const [k, v] of pending) if (Date.now() - v.createdAt > 10 * 60_000) pending.delete(k);
    const state = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(48));
    const nonce = b64url(crypto.randomBytes(24));
    pending.set(state, { verifier, nonce, createdAt: Date.now() });
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: `${config.publicUrl}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state, nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    reply.header('set-cookie', cookie(OAUTH, state, 600));
    return reply.redirect(url.toString());
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const fail = (why: string) => reply.redirect(`/?auth_error=${encodeURIComponent(why)}`);
    const q = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(req.query);
    if (q.error) return fail(q.error === 'access_denied' ? 'Вход отменён' : 'Google отклонил вход');
    const cookieState = parseCookies(req.headers.cookie)[OAUTH];
    const p = q.state ? pending.get(q.state) : undefined;
    if (!q.code || !q.state || !p || cookieState !== q.state) return fail('Сессия входа устарела, попробуйте ещё раз');
    pending.delete(q.state);
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: q.code, client_id: config.googleClientId, client_secret: config.googleClientSecret, redirect_uri: `${config.publicUrl}/api/auth/google/callback`, grant_type: 'authorization_code', code_verifier: p.verifier }),
        signal: AbortSignal.timeout(10_000),
      });
      const tok = (await res.json()) as { id_token?: string };
      if (!res.ok || !tok.id_token) return fail('Не удалось получить токен Google');
      // id_token получен напрямую от Google по TLS (OIDC Core §3.1.3.7), проверяем claims.
      const c = decodeJwtPayload(tok.id_token);
      const ok = ['https://accounts.google.com', 'accounts.google.com'].includes(String(c.iss)) && c.aud === config.googleClientId && Number(c.exp) * 1000 > Date.now() && c.nonce === p.nonce && c.email_verified === true && typeof c.email === 'string';
      if (!ok) return fail('Проверка токена Google не пройдена');
      const user = upsertUser({ email: String(c.email), name: String(c.name ?? c.given_name ?? c.email), picture: typeof c.picture === 'string' ? c.picture : undefined, provider: 'google' });
      createSession(reply, user);
      reply.header('set-cookie', [reply.getHeader('set-cookie') as string, cookie(OAUTH, '', 0)]);
      return reply.redirect(user.role === 'staff' ? '/#/staff' : '/');
    } catch {
      return fail('Google недоступен, попробуйте позже');
    }
  });

  app.post('/api/auth/demo', async (req, reply) => {
    if (!config.demoLogin) return reply.code(403).send({ error: 'Демо-вход выключен' });
    const { as } = z.object({ as: z.enum(['new_patient', 'aliya', 'staff']) }).parse(req.body);
    const db = getDb();
    let user: User;
    if (as === 'staff') user = db.users.find(u => u.id === 'u-demo-staff')!;
    else if (as === 'aliya') user = db.users.find(u => u.patientId === DEMO_PATIENT_ID)!;
    else {
      const n = db.users.filter(u => u.provider === 'demo' && u.role === 'patient').length;
      user = upsertUser({ email: `guest${n}-${Date.now().toString(36)}@clarity.local`, name: 'Гость', provider: 'demo' });
    }
    createSession(reply, user);
    return authMe(user);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = parseCookies(req.headers.cookie)[SID];
    if (token) { const db = getDb(); db.sessions = db.sessions.filter(s => s.id !== hash(token)); persist(); }
    reply.header('set-cookie', cookie(SID, '', 0));
    return { ok: true };
  });
}
