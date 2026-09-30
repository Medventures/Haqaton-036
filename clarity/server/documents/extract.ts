// Извлечение текста и показателей из загруженных пациентом файлов.
//   text/plain → текст как есть;
//   PDF        → текстовый слой через pdfjs (до 10 страниц); скан без текста → просим фото;
//   фото       → vision-LLM (OpenRouter, модель config.llmModelKk) — дословная расшифровка
//                заключения или JSON-список показателей бланка.
// Медицинская интерпретация здесь не делается — только распознавание.

import type { LabAnalysis } from '../../shared/types';
import type { Lang } from '../../shared/i18n';
import { config, llmConfigured } from '../config';
import { chat, extractJson, llmAvailable } from '../assistant/llm';
import { redactPII, violatesOutputPolicy } from '../domain/safety';
import { matchAnalyte } from './labsCatalog';
import { parseNumber, parseRef, type ParsedItem } from './labParser';
import { labsTexts } from './labTexts';

export class DocumentError extends Error {
  constructor(message: string, public statusCode: number) { super(message); }
}

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const DOC_MIMES = [...IMAGE_MIMES, 'application/pdf', 'text/plain'];
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const REPORT_MAX_CHARS = 6000;
const VISION_TIMEOUT_MS = 60_000;
const PDF_MAX_PAGES = 10;

export interface DocumentInput { kind: 'labs' | 'report'; fileName?: string; mime: string; dataBase64?: string; text?: string }

export interface RawText { text: string; source: 'pdf' | 'text'; extractedBy: 'pdf' | 'text' }

function decode(input: DocumentInput, lang: Lang): Buffer {
  const T = labsTexts(lang).errors;
  const b64 = (input.dataBase64 ?? '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!b64) throw new DocumentError(T.empty, 400);
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new DocumentError(T.empty, 400);
  if (buf.length > MAX_FILE_BYTES) throw new DocumentError(T.tooBig, 413);
  return buf;
}

/** Текстовый слой PDF: строки собираются по координате y, чтобы строки таблиц не слипались. */
export async function pdfToText(data: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const pages: string[] = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, PDF_MAX_PAGES); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
      for (const it of content.items as { str?: string; transform?: number[] }[]) {
        if (!it.str || !it.transform) continue;
        const x = it.transform[4]; const y = it.transform[5];
        let row = rows.find(r => Math.abs(r.y - y) < 3);
        if (!row) { row = { y, parts: [] }; rows.push(row); }
        row.parts.push({ x, s: it.str });
      }
      rows.sort((a, b) => b.y - a.y);
      pages.push(rows.map(r => r.parts.sort((a, b) => a.x - b.x).map(x => x.s).join('  ').replace(/\s{3,}/g, '  ').trim()).filter(Boolean).join('\n'));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return pages.join('\n').trim();
}

/** Текст документа без LLM (text/plain или PDF). Для фото — null. */
export async function readText(input: DocumentInput, lang: Lang): Promise<RawText | null> {
  const T = labsTexts(lang).errors;
  if (input.text?.trim()) return { text: input.text.trim(), source: 'text', extractedBy: 'text' };
  if (input.mime === 'text/plain') {
    const text = decode(input, lang).toString('utf8').trim();
    if (!text) throw new DocumentError(T.empty, 422);
    return { text, source: 'text', extractedBy: 'text' };
  }
  if (input.mime === 'application/pdf') {
    const buf = decode(input, lang);
    let text = '';
    try { text = await pdfToText(new Uint8Array(buf)); } catch { throw new DocumentError(T.empty, 422); }
    if (text.replace(/\s+/g, '').length < 20) throw new DocumentError(T.pdfNoText, 422);
    return { text, source: 'pdf', extractedBy: 'pdf' };
  }
  if (IMAGE_MIMES.includes(input.mime)) return null;
  throw new DocumentError(T.badMime, 415);
}

// ---------- Vision-LLM ----------

async function visionChat(system: string, prompt: string, mime: string, b64: string, maxTokens: number, lang: Lang): Promise<string> {
  const T = labsTexts(lang).errors;
  if (!llmConfigured() || !(await llmAvailable())) throw new DocumentError(T.visionUnavailable, 503);
  try {
    const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.llmApiKey ? { authorization: `Bearer ${config.llmApiKey}` } : {}),
        'x-title': 'Clarity Diagnostic Companion',
      },
      signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
      body: JSON.stringify({
        model: config.llmModelKk,
        temperature: 0,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] },
        ],
      }),
    });
    if (!res.ok) throw new DocumentError(T.visionUnavailable, 503);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const out = body.choices?.[0]?.message?.content?.trim();
    if (!out) throw new DocumentError(T.empty, 422);
    return out;
  } catch (e) {
    if (e instanceof DocumentError) throw e;
    throw new DocumentError(T.visionUnavailable, 503);
  }
}

const VISION_SYSTEM = 'Ты — модуль распознавания медицинских документов (OCR). Ты не врач и ничего не интерпретируешь: только точно переписываешь то, что видно на изображении.';

const REPORT_PROMPT = `Перепиши дословно текст медицинского заключения с изображения.
- Сохраняй язык оригинала (русский или казахский), порядок фраз и абзацы.
- Ничего не добавляй, не объясняй, не исправляй и не сокращай.
- ФИО, дату рождения, ИИН, телефоны и адрес пациента замени на [скрыто].
- Верни только текст, без markdown и комментариев.
- Если на изображении нет текста заключения — ответь ровно: НЕТ_ТЕКСТА`;

const LABS_PROMPT = `На изображении бланк лабораторного анализа. Верни ТОЛЬКО JSON без пояснений:
{"takenOn":"YYYY-MM-DD или null","items":[{"name":"название показателя как в бланке","valueText":"значение как в бланке","value":число или null,"unit":"единицы или null","refText":"референсные значения как в бланке или null","refLow":число или null,"refHigh":число или null,"labFlag":"отметка лаборатории (H, L, ↑, ↓, *) или null"}]}
Правила: переписывай только то, что видно; референс бери только из бланка и никогда не придумывай; десятичный разделитель в value/refLow/refHigh — точка; не включай ФИО, ИИН, телефоны, адреса. Если это не бланк анализа — верни {"items":[]}.`;

/** Дословная расшифровка заключения с фото. */
export async function visionTranscribe(input: DocumentInput, lang: Lang): Promise<string> {
  const T = labsTexts(lang).errors;
  if (input.mime === 'image/heic' || input.mime === 'image/heif') throw new DocumentError(T.heic, 415);
  const buf = decode(input, lang);
  const out = await visionChat(VISION_SYSTEM, REPORT_PROMPT, input.mime, buf.toString('base64'), 2500, lang);
  const text = out.replace(/^```\w*\s*/, '').replace(/```\s*$/, '').trim();
  if (/НЕТ_ТЕКСТА/.test(text) || text.replace(/\s+/g, '').length < 10) throw new DocumentError(T.empty, 422);
  return redactPII(text);
}

interface LlmLabs { takenOn?: string | null; items?: Record<string, unknown>[] }

const str = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, 120) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? parseNumber(v) ?? undefined : undefined);

/** JSON ответа модели → показатели; референс перепроверяется по refText из бланка. */
export function itemsFromLlmJson(out: string): { items: ParsedItem[]; takenOn?: string } {
  let parsed: LlmLabs;
  try { parsed = JSON.parse(extractJson(out)) as LlmLabs; } catch { return { items: [] }; }
  const items: ParsedItem[] = [];
  for (const r of Array.isArray(parsed.items) ? parsed.items.slice(0, 60) : []) {
    const name = str(r.name);
    let valueText = str(r.valueText) ?? (num(r.value) !== undefined ? String(num(r.value)).replace('.', ',') : undefined);
    // Модель иногда склеивает значение с отметкой: «96 H», «52↑».
    let flag = str(r.labFlag);
    const glued = valueText?.match(/^(.*?\d)\s*(↑↑?|↓↓?|H|L|\*)$/u);
    if (glued) { valueText = glued[1].trim(); flag = flag ?? glued[2]; }
    if (!name || !valueText) continue;
    const refText = str(r.refText);
    const fromText = parseRef(refText);
    const refLow = fromText.refLow ?? (fromText.refHigh === undefined ? num(r.refLow) : undefined);
    const refHigh = fromText.refHigh ?? (fromText.refLow === undefined ? num(r.refHigh) : undefined);
    items.push({
      code: matchAnalyte(name)?.code,
      name,
      valueText,
      value: /\d/.test(valueText) ? (num(r.value) ?? parseNumber(valueText)) : null,
      unit: str(r.unit),
      refText,
      refLow: refText || refLow !== undefined ? refLow : undefined,
      refHigh: refText || refHigh !== undefined ? refHigh : undefined,
      labFlag: flag,
    });
  }
  const t = str(parsed.takenOn);
  return { items, takenOn: t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : undefined };
}

export async function visionLabs(input: DocumentInput, lang: Lang): Promise<{ items: ParsedItem[]; takenOn?: string }> {
  const T = labsTexts(lang).errors;
  if (input.mime === 'image/heic' || input.mime === 'image/heif') throw new DocumentError(T.heic, 415);
  const buf = decode(input, lang);
  const out = await visionChat(VISION_SYSTEM, LABS_PROMPT, input.mime, buf.toString('base64'), 3000, lang);
  return itemsFromLlmJson(out);
}

/** Структурирование текста бланка моделью, если правила ничего не нашли. */
export async function llmStructureLabs(text: string): Promise<{ items: ParsedItem[]; takenOn?: string } | null> {
  const out = await chat([
    { role: 'system', content: `${VISION_SYSTEM}\n${LABS_PROMPT.replace('На изображении бланк', 'Ниже текст бланка')}` },
    { role: 'user', content: text.slice(0, 6000) },
  ], { json: true, maxTokens: 2500 });
  if (!out) return null;
  return itemsFromLlmJson(out);
}

/**
 * Пересказ итогов простым языком. Уровень, статусы и рекомендации определены правилами;
 * модель только переформулирует summary. Нарушение политики или не тот язык — null.
 */
export async function simplifyLabSummary(analysis: LabAnalysis, lang: Lang): Promise<string | null> {
  const kk = lang === 'kk';
  const facts = analysis.items.map(i => `${i.title}: ${i.statusText}`).join('\n');
  const out = await chat([
    { role: 'system', content: `Ты — ИИ-помощник клиники (не врач). Перескажи итог анализа крови пациенту простыми словами в 2–3 предложениях${kk ? ' ТОЛЬКО на казахском языке, вежливо на «Сіз»' : ''}. Строго: не ставь диагнозы, не называй болезни как вывод, не назначай лечение и лекарства, не оценивай, опасно ли это, не добавляй фактов и чисел, которых нет в данных. Уровень внимания определён правилами клиники: ${analysis.level}. Закончи фразой, что результат оценивает врач. Без markdown и эмодзи.` },
    { role: 'user', content: `Итог по правилам: ${analysis.summary}\nПоказатели:\n${facts}` },
  ], { lang, maxTokens: kk ? 450 : 300 });
  if (!out || violatesOutputPolicy(out)) return null;
  if (/диагноз(?!ом не|\s+не|\s+емес)|diagnos/i.test(out.replace(/это не диагноз|не является диагнозом|диагноз емес/gi, ''))) return null;
  if (kk && !/[әғқңөұүһі]/i.test(out)) return null;
  return out.trim();
}
