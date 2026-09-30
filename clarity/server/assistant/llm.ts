// Адаптер LLM через OpenAI-совместимый API (POST {base}/chat/completions).
// Подходит для облачных провайдеров открытых моделей (OpenRouter, Together,
// Groq, DeepInfra) и для собственного сервера (vLLM, llama.cpp, Ollama /v1).
// Если ключ не задан или API недоступен — ассистент работает на правилах.

import { config, llmConfigured } from '../config';
import type { Lang } from '../../shared/i18n';
import { redactPII, violatesOutputPolicy } from '../domain/safety';

export interface ChatTurn { role: 'system' | 'user' | 'assistant'; content: string }

let health: { at: number; ok: boolean } = { at: 0, ok: false };

export async function llmAvailable(): Promise<boolean> {
  if (!llmConfigured()) return false;
  if (Date.now() - health.at < 60_000) return health.ok;
  const out = await rawChat([{ role: 'user', content: 'ping' }], { maxTokens: 1, timeoutMs: 8000, skipHealth: true });
  health = { at: Date.now(), ok: out !== null };
  return health.ok;
}

export interface ChatOptions { json?: boolean; maxTokens?: number; timeoutMs?: number; skipHealth?: boolean; lang?: Lang }

async function rawChat(messages: ChatTurn[], opts: ChatOptions): Promise<string | null> {
  try {
    const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.llmApiKey ? { authorization: `Bearer ${config.llmApiKey}` } : {}),
        'x-title': 'Clarity Diagnostic Companion',
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? config.llmTimeoutMs),
      body: JSON.stringify({
        model: opts.lang === 'kk' ? config.llmModelKk : config.llmModel,
        temperature: 0.2,
        max_tokens: opts.maxTokens ?? 350,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        // OpenRouter: выбирать провайдера с минимальной задержкой (важно для голосового режима).
        ...(config.llmBaseUrl.includes('openrouter.ai') ? { provider: { sort: config.llmProviderSort } } : {}),
        messages: messages.map(m => ({ ...m, content: m.role === 'user' ? redactPII(m.content) : m.content })),
      }),
    });
    if (!res.ok) {
      if (!opts.skipHealth) health = { at: Date.now(), ok: res.status !== 401 && res.status !== 403 };
      return null;
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    if (!opts.skipHealth) health = { at: Date.now(), ok: false };
    return null;
  }
}

export async function chat(messages: ChatTurn[], opts: Omit<ChatOptions, 'skipHealth' | 'timeoutMs'> = {}): Promise<string | null> {
  if (!(await llmAvailable())) return null;
  return rawChat(messages, opts);
}

const PERSONA_RU = (name: string) => `Ты — ${name}, ИИ-помощник клиники Green Clinic для пациентов, которые готовятся к МРТ головного мозга с контрастом.
Правила, которые нельзя нарушать:
- Ты не врач. Не ставь диагнозы, не оценивай, опасно ли состояние, не меняй и не отменяй лекарства, не решай, можно ли вводить контраст.
- Отвечай ТОЛЬКО на основе предоставленных фрагментов базы знаний. Если ответа во фрагментах нет — скажи, что не знаешь, и предложи передать вопрос координатору.
- Пиши по-русски, тепло и просто, 2–4 коротких предложения, без markdown, списков и эмодзи.
- Не обещай, что всё будет хорошо. Не называй себя человеком.
- Если человек описывает тяжёлые симптомы — советуй звонить 103 или 112.`;

// Инструкции модели по-русски (модели лучше следуют правилам), но ответ — строго на казахском.
const PERSONA_KK = (name: string) => `Ты — ${name}, ИИ-помощник (по-казахски «ЖИ-көмекші») клиники Green Clinic для пациентов, которые готовятся к МРТ головного мозга с контрастом.
Правила, которые нельзя нарушать:
- Ты не врач («мен дәрігер емеспін»). Не ставь диагнозы, не оценивай, опасно ли состояние, не меняй и не отменяй лекарства, не решай, можно ли вводить контраст.
- Отвечай ТОЛЬКО на основе предоставленных фрагментов базы знаний. Если ответа во фрагментах нет — скажи, что не знаешь, и предложи передать вопрос үйлестірушіге (координатору).
- ОТВЕЧАЙ ТОЛЬКО НА КАЗАХСКОМ ЯЗЫКЕ (қазақ тілінде), кириллицей, современным литературным языком, вежливо на «Сіз». Даже если фрагменты или вопрос на русском — ответ на казахском. Термины: МРТ, контраст, креатинин, бүйрек, дәрігер, үйлестіруші, талдау, жолдама, дайындық, қорытынды.
- Пиши тепло и просто, 2–4 коротких предложения, без markdown, списков и эмодзи. Соблюдай сингармонизм и правильные падежные окончания, не калькируй с русского.
- Не обещай, что всё будет хорошо. Не называй себя человеком.
- Если человек описывает тяжёлые симптомы — советуй звонить 103 или 112.`;

/** Персона ассистента на языке пациента. */
export const persona = (lang: Lang = 'ru', name = 'Аружан') => (lang === 'kk' ? PERSONA_KK(name) : PERSONA_RU(name));

/** Совместимость: русская персона по умолчанию. */
export const PERSONA = persona('ru');

/** Ответ на свободный вопрос, основанный на найденных карточках. */
export async function groundedAnswer(question: string, snippets: { title: string; answer: string }[], lang: Lang = 'ru', name?: string): Promise<string | null> {
  const context = snippets.map((s, i) => `[${i + 1}] ${s.title}: ${s.answer}`).join('\n');
  const tail = lang === 'kk' ? 'Ответь, опираясь только на фрагменты. Ответ — только на казахском языке.' : 'Ответь, опираясь только на фрагменты.';
  const out = await chat([
    { role: 'system', content: persona(lang, name) },
    { role: 'user', content: `Фрагменты базы знаний клиники:\n${context}\n\nВопрос пациента: ${question}\n\n${tail}` },
  ], { lang, maxTokens: lang === 'kk' ? 550 : 350 });
  if (!out || violatesOutputPolicy(out)) return null;
  return out;
}

/** Убирает обёртку ```json ... ``` и лишний текст вокруг JSON-объекта. */
export function extractJson(out: string): string {
  const s = out.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}

/** Классификация свободной реплики, когда правила не справились. */
export async function classify(text: string, stage: string, lang: Lang = 'ru'): Promise<{ intent: string; answer?: string } | null> {
  const kkHint = lang === 'kk' ? '\nРеплика может быть на казахском: «иә/ия/бар/болған» — yes; «жоқ/болған жоқ/ешқашан» — no; «білмеймін/есімде жоқ/сенімді емеспін» — unknown.' : '';
  const out = await chat([
    { role: 'system', content: `Ты классификатор реплик пациента. Верни только JSON вида {"intent": "...", "answer": "..."}.\nintent: одно из screening, prep, reminder, report, booking, human, cancel, confirm, status, question, other.\nanswer: если реплика отвечает на вопрос анкеты — yes, no или unknown; иначе пустая строка.${kkHint}` },
    { role: 'user', content: `Этап диалога: ${stage}\nРеплика: ${text}` },
  ], { json: true, maxTokens: 60, lang });
  if (!out) return null;
  try { return JSON.parse(extractJson(out)) as { intent: string; answer?: string }; } catch { return null; }
}

/** Пересказ заключения простыми словами. Тревожность определяют правила, не модель. */
export async function simplifyReport(text: string, terms: string[], level: string, lang: Lang = 'ru', name?: string): Promise<string | null> {
  const kk = lang === 'kk';
  const out = await chat([
    { role: 'system', content: `${persona(lang, name)}\nСейчас ты объясняешь пациенту текст заключения МРТ простыми словами. Заключение написано по-русски${kk ? ', но объяснение пиши ТОЛЬКО на казахском языке' : ''}. Не делай выводов о диагнозе и прогнозе, не добавляй фактов, которых нет в тексте. Уровень внимания, определённый правилами клиники: ${level}. Закончи фразой, что результат интерпретирует лечащий врач${kk ? ' («Нәтижені емдеуші дәрігер түсіндіреді.»)' : ''}.` },
    { role: 'user', content: `Текст заключения:\n${text}\n\nТермины из словаря клиники: ${terms.join('; ') || 'нет'}\n\n${kk ? 'Қазақ тілінде 3–5 сөйлеммен түсіндіріңіз.' : 'Объясни в 3–5 предложениях.'}` },
  ], { maxTokens: kk ? 600 : 400, lang });
  if (!out || violatesOutputPolicy(out)) return null;
  // Модель ответила не на том языке — лучше показать правиловое объяснение.
  if (kk && !/[әғқңөұүһі]/i.test(out)) return null;
  return out;
}
