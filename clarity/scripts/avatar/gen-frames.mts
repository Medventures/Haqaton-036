// Шаг 2: кадры липсинка и моргания — правка базового фото (gemini-3.1-flash-image).
// Запуск: npx tsx scripts/avatar/gen-frames.mts [a o e u m blink] [--model=pro]
import { resolve } from 'node:path';
import { generate, FLASH, PRO, OUT } from './lib.mts';

const KEEP = `Edit this exact photograph. Keep the person's identity, face, head position and size, camera framing, crop, lighting, skin tone, clothing, hair, earrings and background exactly identical, pixel-aligned with the original. Output the same image size and aspect ratio.`;

export const FRAME_PROMPTS: Record<string, string> = {
  a: `${KEEP} Change ONLY the mouth: the jaw is naturally open as when clearly saying the vowel "a" (as in "father"), lips parted about one centimetre, upper teeth slightly visible, dark mouth interior, relaxed natural expression. Do not change the eyes, nose or anything else.`,
  o: `${KEEP} Change ONLY the mouth: lips are rounded into an open oval as when saying the vowel "o", mouth moderately open, lips slightly pushed forward. Do not change the eyes, nose or anything else.`,
  e: `${KEEP} Change ONLY the mouth: lips are spread wide horizontally as when saying "ee", mouth slightly open, upper and lower teeth visible, natural. Do not change the eyes, nose or anything else.`,
  u: `${KEEP} Change ONLY the mouth: lips are pursed into a small rounded pucker as when saying "oo", only a small opening in the middle. Do not change the eyes, nose or anything else.`,
  m: `${KEEP} Change ONLY the mouth: lips are pressed firmly together in a neutral line as when saying "m", no smile, mouth closed. Do not change the eyes, nose or anything else.`,
  blink: `${KEEP} Change ONLY the eyes: both eyes are fully closed in a natural relaxed blink, eyelids down, eyelashes visible. The mouth and everything else stay exactly unchanged.`,
};

const args = process.argv.slice(2);
const model = args.includes('--model=pro') ? PRO : FLASH;
const suffix = model === PRO ? '-pro' : '';
const which = args.filter((a) => !a.startsWith('--'));
const list = which.length ? which : Object.keys(FRAME_PROMPTS);
const base = resolve(OUT, 'base-1.png');
// Последовательно, с повторами: у ключа маленький «in-flight» бюджет, параллельные запросы получают 402.
for (const k of list) {
  for (let attempt = 0; attempt < Number(process.env.RETRIES ?? 4); attempt++) {
    if (await generate(`frame-${k}${suffix}`, model, FRAME_PROMPTS[k], base)) break;
    await new Promise((r) => setTimeout(r, 6000));
  }
}
