// Общие функции генерации портрета через OpenRouter (image-модели).
// Ключ читается из .env во время выполнения и нигде не печатается.
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT = resolve(ROOT, 'scripts/avatar/out');
mkdirSync(OUT, { recursive: true });

function apiKey(): string {
  const env = readFileSync(resolve(ROOT, '.env'), 'utf8');
  const m = env.match(/^LLM_API_KEY=(.*)$/m);
  if (!m) throw new Error('LLM_API_KEY not found in .env');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

export const PRO = 'google/gemini-3-pro-image';
export const FLASH = 'google/gemini-3.1-flash-image';

/** Одна генерация: текст (+ необязательное исходное изображение). Сохраняет PNG/JPEG в out/<name>.*, возвращает путь. */
export async function generate(name: string, model: string, text: string, inputImage?: string): Promise<string | null> {
  const content: unknown[] = [{ type: 'text', text }];
  if (inputImage) {
    const buf = readFileSync(inputImage);
    const mime = inputImage.endsWith('.png') ? 'image/png' : 'image/jpeg';
    content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } });
  }
  const t0 = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, modalities: ['image', 'text'], max_tokens: Number(process.env.MAX_TOKENS ?? 2400), messages: [{ role: 'user', content }] }),
  });
  const json = (await res.json()) as any;
  appendFileSync(resolve(OUT, 'log.jsonl'), JSON.stringify({ name, model, status: res.status, ms: Date.now() - t0, usage: json?.usage ?? null, err: json?.error ?? null }) + '\n');
  if (!res.ok) { console.error(name, res.status, JSON.stringify(json?.error ?? json).slice(0, 300)); return null; }
  const msg = json?.choices?.[0]?.message;
  const url: string | undefined = msg?.images?.[0]?.image_url?.url ?? msg?.images?.[0]?.url;
  if (!url) { console.error(name, 'no image in response', JSON.stringify(msg ?? json).slice(0, 400)); return null; }
  const m = url.match(/^data:image\/(\w+);base64,(.*)$/s);
  if (!m) { console.error(name, 'unexpected url', url.slice(0, 80)); return null; }
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const file = resolve(OUT, `${name}.${ext}`);
  writeFileSync(file, Buffer.from(m[2], 'base64'));
  console.log(name, model, `${Date.now() - t0}ms`, file, 'cost:', json?.usage?.cost ?? '?');
  return file;
}

export function exists(p: string) { return existsSync(p); }
