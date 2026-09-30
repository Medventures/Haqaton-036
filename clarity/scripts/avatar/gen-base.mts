// Шаг 1: базовый портрет (2 кандидата, gemini-3-pro-image).
// Запуск: npx tsx scripts/avatar/gen-base.mts
import { generate, PRO } from './lib.mts';

export const BASE_PROMPT = `Photorealistic studio head-and-shoulders portrait photograph of a FICTIONAL young Kazakh woman, about 28 years old, a hospital doctor. Warm, calm, kind and professional expression. Clear Kazakh / Central Asian facial features. Dark hair neatly gathered into a low bun. She wears a crisp white medical coat over a deep emerald-green velvet Kazakh kamzol (traditional sleeveless vest) with fine gold embroidery of the Kazakh "koshkar muiz" (ram's horn) ornament along the collar and neckline; a subtle small gold ornament embroidery on the white coat lapel; small silver traditional Kazakh earrings; a stethoscope around the neck. She faces the camera straight on, head level and upright, both eyes open looking directly at the viewer, lips gently closed with a slight warm smile. Centered symmetric framing, the head in the upper-middle of the frame, shoulders visible, soft even studio lighting, plain soft mint-to-white gradient background. Vertical 4:5 portrait. Sharp focus on the face, natural skin texture, 85mm lens look. No text, no logos, no name badge, no red cross, no watermark. The person must be entirely fictional and must not resemble any real person or celebrity.`;

const names = process.argv.slice(2);
const list = names.length ? names : ['base-1', 'base-2'];
await Promise.all(list.map((n) => generate(n, PRO, BASE_PROMPT)));
