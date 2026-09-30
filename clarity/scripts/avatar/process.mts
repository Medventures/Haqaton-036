// Шаг 3: обработка → public/avatars/aruzhan/ (base.webp, патчи рта и глаз, manifest.json) + контактный лист.
// Запуск: npx tsx scripts/avatar/process.mts
//
// Для каждого кадра (A, O, E, U, M, BLINK):
//   • если есть сгенерированная правка out/frame-<k>.png — она нормализуется к 720×900 и совмещается с базой
//     (перебор сдвига ±12 px по SAD на области, которая не должна меняться);
//   • иначе кадр синтезируется из базы геометрической деформацией (обратное отображение + билинейная выборка):
//     рот раскрывается по линии смыкания губ (опускание нижней губы/подбородка, внутренняя полость, зубы),
//     сужается/растягивается по горизонтали; моргание — растяжение кожи века вниз до нижнего века.
// Изменения деформации гаснут к краям общих боксов, поэтому патчи с мягкой эллиптической альфой не дают швов.
import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT, ROOT } from './lib.mts';

const W = 720, H = 900;
const DEST = resolve(ROOT, 'public/avatars/aruzhan');
mkdirSync(DEST, { recursive: true });

// Геометрия лица на базе 720×900 (измерена по сетке out/grid.png).
const MOUTH = { cx: 332, seam: 398, hw: 54 };
const MOUTH_BOX = { x: 246, y: 350, w: 172, h: 124 };
const EYES = [{ cx: 270, cy: 269, a: 27, bu: 11, bl: 8 }, { cx: 388, cy: 269, a: 27, bu: 11, bl: 9 }];
const EYES_BOX = { x: 234, y: 236, w: 192, h: 56 };

type Img = { data: Buffer; w: number; h: number };

async function load(file: string): Promise<Img> {
  const { data, info } = await sharp(file).resize(W, H, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const lum = (im: Img, x: number, y: number) => { const i = (y * im.w + x) * 3; return 0.299 * im.data[i] + 0.587 * im.data[i + 1] + 0.114 * im.data[i + 2]; };

function sample(im: Img, x: number, y: number, out: number[]) {
  x = clamp(x, 0, im.w - 1.001); y = clamp(y, 0, im.h - 1.001);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  for (let c = 0; c < 3; c++) {
    const p = (xx: number, yy: number) => im.data[(yy * im.w + xx) * 3 + c];
    out[c] = (p(x0, y0) * (1 - fx) + p(x0 + 1, y0) * fx) * (1 - fy) + (p(x0, y0 + 1) * (1 - fx) + p(x0 + 1, y0 + 1) * fx) * fy;
  }
}

/** Линия смыкания губ: самый тёмный пиксель в столбце около MOUTH.seam, сглаженный. */
function lipSeam(base: Img): (x: number) => number {
  const xs: number[] = [];
  for (let x = MOUTH.cx - MOUTH.hw - 4; x <= MOUTH.cx + MOUTH.hw + 4; x++) {
    let best = MOUTH.seam, bl = 1e9;
    for (let y = MOUTH.seam - 8; y <= MOUTH.seam + 8; y++) { const l = lum(base, x, y) + lum(base, x, y + 1); if (l < bl) { bl = l; best = y + 0.5; } }
    xs.push(best);
  }
  const sm = xs.map((_, i) => { let s = 0, n = 0; for (let k = -4; k <= 4; k++) { const v = xs[i + k]; if (v !== undefined) { s += v; n++; } } return s / n; });
  const x0 = MOUTH.cx - MOUTH.hw - 4;
  return (x: number) => { const i = clamp(Math.round(x - x0), 0, sm.length - 1); return sm[i]; };
}

interface Viseme { d: number; u: number; s: number; teethTop: number; teethBottom: number; press: number; shape: number }
const VISEMES: Record<string, Viseme> = {
  a: { d: 13, u: 2, s: 0.95, teethTop: 0.42, teethBottom: 0, press: 0, shape: 0.75 },
  o: { d: 11, u: 3, s: 0.8, teethTop: 0.18, teethBottom: 0, press: 0, shape: 0.5 },
  e: { d: 5, u: 1.2, s: 1.07, teethTop: 0.55, teethBottom: 0.3, press: 0, shape: 0.9 },
  u: { d: 4, u: 1.2, s: 0.72, teethTop: 0, teethBottom: 0, press: 0, shape: 0.45 },
  m: { d: 0, u: 0, s: 0.97, teethTop: 0, teethBottom: 0, press: 0.14, shape: 0.8 },
};

function synthMouth(base: Img, v: Viseme): Img {
  const seam = lipSeam(base);
  const out = Buffer.from(base.data);
  const px = [0, 0, 0];
  const { cx, hw } = MOUTH;
  const B = MOUTH_BOX;
  for (let y = B.y; y < B.y + B.h; y++) {
    for (let x = B.x; x < B.x + B.w; x++) {
      // 1) горизонтальное сужение/растяжение с мягким спадом
      const ex = (x - cx) / (hw * 1.5), ey = (y - MOUTH.seam) / 42;
      const wgt = 1 - smooth(0.35, 1, Math.hypot(ex, ey));
      const xs = cx + (x - cx) / (1 + (v.s - 1) * wgt);
      // 2) вертикаль относительно линии губ
      const t = (xs - cx) / hw;
      const prof = Math.abs(t) < 1 ? Math.pow(1 - t * t, v.shape) : 0;
      const sy = seam(xs);
      const T = sy - v.u * prof, Bt = sy + v.d * prof;
      let ys: number;
      let interior = 0; // 0..1 — доля полости рта (сглаживание краёв)
      if (y < T) ys = y + v.u * prof * clamp(1 - (T - y) / 26);
      else if (y > Bt) ys = y - v.d * prof * clamp(1 - (y - Bt) / 56);
      else { ys = sy; interior = 1; }
      if (v.press > 0) { const band = clamp(1 - Math.abs(y - sy) / 26); ys = sy + (ys - sy) * (1 + v.press * prof * band); }
      sample(base, xs, ys, px);
      if (Bt - T > 0.6) {
        // антиалиасинг границ полости
        const a = clamp(Math.min(y - T + 0.5, Bt - y + 0.5));
        interior = Math.max(interior * a, 0);
        if (y >= T - 0.5 && y <= Bt + 0.5) interior = a;
      }
      if (interior > 0) {
        const gap = Bt - T;
        const depth = 1 - 0.5 * prof; // темнее в центре
        let r = 96 * depth, g = 44 * depth, b = 46 * depth;
        const topH = v.teethTop * Math.min(gap * 1.1, 9), botH = v.teethBottom * Math.min(gap * 1.2, 7);
        const shade = 0.72 + 0.28 * prof;
        if (topH > 0 && y - T < topH) { const k = clamp((y - T) / 1.4) * clamp((topH - (y - T)) / 1.6) * shade * 0.8; r = r * (1 - k) + 204 * k; g = g * (1 - k) + 194 * k; b = b * (1 - k) + 186 * k; }
        else if (botH > 0 && Bt - y < botH) { const k = clamp((Bt - y) / 1.4) * clamp((botH - (Bt - y)) / 1.6) * shade * 0.7; r = r * (1 - k) + 196 * k; g = g * (1 - k) + 186 * k; b = b * (1 - k) + 178 * k; }
        px[0] = px[0] * (1 - interior) + r * interior; px[1] = px[1] * (1 - interior) + g * interior; px[2] = px[2] * (1 - interior) + b * interior;
      }
      const i = (y * W + x) * 3;
      out[i] = px[0]; out[i + 1] = px[1]; out[i + 2] = px[2];
    }
  }
  return { data: out, w: W, h: H };
}

function synthBlink(base: Img): Img {
  const out = Buffer.from(base.data);
  const px = [0, 0, 0];
  const B = EYES_BOX;
  for (const e of EYES) {
    for (let y = B.y; y < B.y + B.h; y++) {
      for (let x = e.cx - e.a - 8; x <= e.cx + e.a + 8; x++) {
        const t = (x - e.cx) / e.a;
        const prof = Math.abs(t) < 1 ? Math.sqrt(1 - t * t) : 0;
        const hfade = 1 - smooth(0.82, 1.25, Math.abs(t)); // гасим к уголкам глаза
        const top = e.cy - e.bu * prof, bot = e.cy + e.bl * prof;
        const close = bot - 1.5 * prof; // линия сомкнутых ресниц
        const R0 = e.cy - e.bu - 15;
        let ys = y;
        if (y >= R0 && y <= close) ys = R0 + (y - R0) * (top - R0) / Math.max(close - R0, 1);
        else if (y > close && y < bot + 5) ys = y + (bot + 5 - y) / (bot + 5 - close) * (top - close) * 0; // ниже — без изменений
        ys = y + (ys - y) * hfade;
        sample(base, x, ys, px);
        // лёгкая тень по линии ресниц
        const dl = Math.abs(y - close);
        if (prof > 0 && dl < 2) { const k = (1 - dl / 2) * 0.25 * prof * hfade; px[0] *= 1 - k; px[1] *= 1 - k; px[2] *= 1 - k; }
        const i = (y * W + x) * 3;
        out[i] = px[0]; out[i + 1] = px[1]; out[i + 2] = px[2];
      }
    }
  }
  return { data: out, w: W, h: H };
}

/** Совмещение сгенерированного кадра с базой: перебор сдвига по SAD в области ref. */
function register(base: Img, im: Img, ref: { x: number; y: number; w: number; h: number }): Img {
  let best = { dx: 0, dy: 0, sad: Infinity };
  for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
    let sad = 0;
    for (let y = ref.y; y < ref.y + ref.h; y += 2) for (let x = ref.x; x < ref.x + ref.w; x += 2) sad += Math.abs(lum(base, x, y) - lum(im, clamp(x + dx, 0, W - 1), clamp(y + dy, 0, H - 1)));
    if (sad < best.sad) best = { dx, dy, sad };
  }
  console.log('  registration shift', best.dx, best.dy);
  const out = Buffer.alloc(W * H * 3);
  const px = [0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { sample(im, x + best.dx, y + best.dy, px); const i = (y * W + x) * 3; out[i] = px[0]; out[i + 1] = px[1]; out[i + 2] = px[2]; }
  return { data: out, w: W, h: H };
}

/** Патч бокса с мягкой эллиптической альфой → WebP. */
async function exportPatch(im: Img, box: { x: number; y: number; w: number; h: number }, file: string, feather = 0.3) {
  const rgba = Buffer.alloc(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
    const ex = (x + 0.5 - box.w / 2) / (box.w / 2), ey = (y + 0.5 - box.h / 2) / (box.h / 2);
    const a = 1 - smooth(1 - feather, 1, Math.hypot(ex, ey));
    const si = ((box.y + y) * W + box.x + x) * 3, di = (y * box.w + x) * 4;
    rgba[di] = im.data[si]; rgba[di + 1] = im.data[si + 1]; rgba[di + 2] = im.data[si + 2]; rgba[di + 3] = Math.round(a * 255);
  }
  await sharp(rgba, { raw: { width: box.w, height: box.h, channels: 4 } }).webp({ quality: 86, alphaQuality: 90 }).toFile(resolve(DEST, file));
  return rgba;
}

const base = await load(resolve(OUT, 'base-1.png'));
await sharp(base.data, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 82 }).toFile(resolve(DEST, 'base.webp'));
await sharp(base.data, { raw: { width: W, height: H, channels: 3 } }).resize(360, 450).webp({ quality: 80 }).toFile(resolve(DEST, 'base-sm.webp'));

const frames: Record<string, string> = {};
const composites: { label: string; buf: Buffer }[] = [{ label: 'base', buf: await sharp(base.data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer() }];
const baseSharp = () => sharp(base.data, { raw: { width: W, height: H, channels: 3 } });

for (const k of ['a', 'o', 'e', 'u', 'm']) {
  const gen = resolve(OUT, `frame-${k}.png`);
  let im: Img;
  if (existsSync(gen)) { console.log(`frame ${k}: generated edit`); im = register(base, await load(gen), { x: 230, y: 230, w: 200, h: 110 }); }
  else { console.log(`frame ${k}: synthesized`); im = synthMouth(base, VISEMES[k]); }
  const file = `mouth-${k}.webp`;
  await exportPatch(im, MOUTH_BOX, file);
  frames[k.toUpperCase()] = file;
  const buf = await baseSharp().composite([{ input: resolve(DEST, file), left: MOUTH_BOX.x, top: MOUTH_BOX.y }]).png().toBuffer();
  composites.push({ label: k.toUpperCase(), buf });
}
{
  const gen = resolve(OUT, 'frame-blink.png');
  const im = existsSync(gen) ? register(base, await load(gen), { x: 250, y: 380, w: 170, h: 90 }) : synthBlink(base);
  console.log(`frame blink: ${existsSync(gen) ? 'generated edit' : 'synthesized'}`);
  await exportPatch(im, EYES_BOX, 'eyes-closed.webp', 0.35);
  composites.push({ label: 'BLINK', buf: await baseSharp().composite([{ input: resolve(DEST, 'eyes-closed.webp'), left: EYES_BOX.x, top: EYES_BOX.y }]).png().toBuffer() });
}

const manifest = {
  width: W, height: H,
  base: 'base.webp', baseSmall: 'base-sm.webp',
  mouth: { ...MOUTH_BOX, frames },
  eyes: { ...EYES_BOX, src: 'eyes-closed.webp' },
  face: { cx: 334, cy: 318, size: 400 },
};
writeFileSync(resolve(DEST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// Контактный лист: полные кадры (уменьшенные) + увеличенные фрагменты лица.
const cellW = 240, cellH = 300, zoomH = 240;
const tiles: sharp.OverlayOptions[] = [];
for (let i = 0; i < composites.length; i++) {
  const full = await sharp(composites[i].buf).resize(cellW, cellH).png().toBuffer();
  const zoom = await sharp(composites[i].buf).extract({ left: 212, top: 226, width: 240, height: 260 }).resize(cellW, zoomH + 20).png().toBuffer();
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cellW}" height="24"><rect width="100%" height="100%" fill="#fff"/><text x="6" y="17" font-size="16" font-family="sans-serif">${composites[i].label}</text></svg>`);
  tiles.push({ input: label, left: i * cellW, top: 0 }, { input: full, left: i * cellW, top: 24 }, { input: zoom, left: i * cellW, top: 24 + cellH });
}
await sharp({ create: { width: cellW * composites.length, height: 24 + cellH + zoomH + 20, channels: 3, background: '#ffffff' } }).composite(tiles).png().toFile(resolve(OUT, 'contact.png'));

let total = 0;
for (const f of readdirSync(DEST)) { const s = statSync(resolve(DEST, f)).size; total += s; console.log(f.padEnd(20), (s / 1024).toFixed(1), 'KB'); }
console.log('total', (total / 1024).toFixed(1), 'KB');
