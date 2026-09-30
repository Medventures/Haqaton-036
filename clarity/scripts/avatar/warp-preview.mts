// Офлайн-проверка непрерывной деформации рта (та же математика, что в RealisticAvatar/canvas):
// рендер кадров open × {нейтр., О/У, Э/И} + «М» и контактный лист scripts/avatar/out/warp-sheet.png.
// Запуск: npx tsx scripts/avatar/warp-preview.mts [--measure]
//   --measure — напечатать линию смыкания губ (для rig.seam в manifest.json).
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { columnMap, interiorRGBA, mapY, mouthPose, srcX, type MouthRig } from '../../src/voice/mouthRig.ts';
import { ROOT } from './lib.mts';

const DIR = resolve(ROOT, 'public/avatars/aruzhan');
const OUTDIR = resolve(ROOT, 'scripts/avatar/out');
mkdirSync(OUTDIR, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(DIR, 'manifest.json'), 'utf8'));
const rig: MouthRig = manifest.rig;
const { data, info } = await sharp(resolve(DIR, manifest.base)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;

if (process.argv.includes('--measure')) {
  const lum = (x: number, y: number) => { const i = (y * W + x) * 3; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  const pts: [number, number][] = [];
  for (let x = rig.seam[0][0]; x <= rig.seam[rig.seam.length - 1][0]; x += 6) {
    let best = 0, bl = 1e9;
    for (let y = 388; y <= 410; y++) { const l = lum(x, y) + lum(x, y + 1); if (l < bl) { bl = l; best = y + 0.5; } }
    pts.push([x, best]);
  }
  console.log(JSON.stringify(pts));
}

function sample(x: number, y: number, out: number[]) {
  x = Math.max(0, Math.min(W - 1.001, x)); y = Math.max(0, Math.min(H - 1.001, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  for (let c = 0; c < 3; c++) {
    const p = (xx: number, yy: number) => data[(yy * W + xx) * 3 + c];
    out[c] = (p(x0, y0) * (1 - fx) + p(x0 + 1, y0) * fx) * (1 - fy) + (p(x0, y0 + 1) * (1 - fx) + p(x0 + 1, y0 + 1) * fx) * fy;
  }
}

function render(frame: { open: number; round: number; wide: number; closed: number }): Buffer {
  const pose = mouthPose({ ...frame, level: frame.open });
  const out = Buffer.from(data);
  const px = [0, 0, 0];
  const B = rig.box;
  for (let x = B.x; x < B.x + B.w; x++) {
    const m = columnMap(rig, pose, x + 0.5);
    for (let y = B.y; y < B.y + B.h; y++) {
      const ys = mapY(m, y + 0.5) - 0.5;
      const xs = srcX(rig, pose, x + 0.5, ys + 0.5) - 0.5;
      sample(xs, ys, px);
      const c = interiorRGBA(rig, pose, m, x + 0.5, y + 0.5);
      if (c) for (let k = 0; k < 3; k++) px[k] = px[k] * (1 - c[3]) + c[k] * c[3];
      const i = (y * W + x) * 3;
      out[i] = px[0]; out[i + 1] = px[1]; out[i + 2] = px[2];
    }
  }
  return out;
}

const cells: { label: string; f: { open: number; round: number; wide: number; closed: number } }[] = [];
for (const open of [0, 0.4, 0.8]) {
  cells.push({ label: `open ${open}`, f: { open, round: 0, wide: 0, closed: 0 } });
  cells.push({ label: `О/У ${open}`, f: { open, round: 0.9, wide: 0, closed: 0 } });
  cells.push({ label: `Э/И ${open}`, f: { open, round: 0, wide: 0.9, closed: 0 } });
}
cells.push({ label: 'М (closed)', f: { open: 0, round: 0, wide: 0, closed: 1 } });
cells.push({ label: 'А 1.0', f: { open: 1, round: 0, wide: 0, closed: 0 } });
cells.push({ label: 'У 0.3', f: { open: 0.3, round: 1, wide: 0, closed: 0 } });

const cw = 300, ch = 280, cols = 3;
const tiles: sharp.OverlayOptions[] = [];
for (let i = 0; i < cells.length; i++) {
  const buf = render(cells[i].f);
  const crop = await sharp(buf, { raw: { width: W, height: H, channels: 3 } })
    .extract({ left: 222, top: 350, width: 220, height: 190 }).resize(cw, ch - 22).png().toBuffer();
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="22"><rect width="100%" height="100%" fill="#fff"/><text x="6" y="16" font-size="15" font-family="sans-serif">${cells[i].label}</text></svg>`);
  const left = (i % cols) * cw, top = Math.floor(i / cols) * ch;
  tiles.push({ input: label, left, top }, { input: crop, left, top: top + 22 });
}
const rows = Math.ceil(cells.length / cols);
await sharp({ create: { width: cw * cols, height: ch * rows, channels: 3, background: '#ffffff' } })
  .composite(tiles).png().toFile(resolve(OUTDIR, 'warp-sheet.png'));
console.log('→', resolve(OUTDIR, 'warp-sheet.png'));
