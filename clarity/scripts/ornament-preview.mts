// Превью орнаментов для самопроверки: рендерит компоненты src/brand/Ornament.tsx в PNG (2×)
// на светлом и тёмном фоне. Запуск: npx tsx scripts/ornament-preview.mts
// Результат: scripts/avatar/out/ornaments/ornaments-{light,dark}.png
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OrnamentBand, OrnamentCorner, OrnamentPattern, OrnamentDivider, Rosette } from '../src/brand/Ornament.tsx';

const out = fileURLToPath(new URL('./avatar/out/ornaments/', import.meta.url));
mkdirSync(out, { recursive: true });

const W = 720, H = 760;
const html = (el: ReactElement) => renderToStaticMarkup(el);
let seq = 0;
/** Вкладывает разметку компонента в окно nested-<svg>; для HTML (div) берёт внутренний <svg>. */
const place = (el: ReactElement, x: number, y: number, w: number, h: number) => {
  // useId в отдельных renderToStaticMarkup повторяется — делаем id уникальными в пределах листа
  const uid = `u${++seq}`;
  let m = html(el).replace(/id="([^"]+)"/g, `id="$1${uid}"`).replace(/url\(#([^)]+)\)/g, `url(#$1${uid})`).replace(/href="#([^"]+)"/g, `href="#$1${uid}"`);
  if (!m.startsWith('<svg')) m = m.match(/<svg[\s\S]*<\/svg>/)?.[0] ?? '';
  // style="" (CSS) → атрибуты, которые понимает librsvg
  m = m.replace(/ style="([^"]*)"/, (_, css: string) => {
    const get = (k: string) => css.match(new RegExp(`(?:^|;)${k}:([^;]+)`))?.[1];
    return `${get('color') ? ` color="${get('color')}"` : ''}${get('opacity') ? ` opacity="${get('opacity')}"` : ''}`;
  });
  if (!/ color="/.test(m.slice(0, 200))) m = m.replace('<svg', `<svg color="${(el.props as { color?: string }).color ?? '#000'}"`);
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" overflow="visible">${m}</svg>`;
};

const themes = [
  { name: 'light', bg: '#f2f6f5', gold: '#C9A23A', line: '#0b7a70', sky: '#00A3C4' },
  { name: 'dark', bg: '#0c4a57', gold: '#E7C86A', line: '#E7C86A', sky: '#7fd6e8' },
];

for (const t of themes) {
  const parts = [
    place(createElement(OrnamentBand, { height: 22, color: t.gold }), 20, 20, 680, 22),
    place(createElement(OrnamentBand, { height: 44, color: t.line, accent: t.sky }), 20, 60, 680, 44),
    ...(['tl', 'tr', 'bl', 'br'] as const).map((c, i) =>
      place(createElement(OrnamentCorner, { corner: c, size: 96, color: t.gold }), 20 + i * 110, 130, 96, 96)),
    place(createElement(Rosette, { size: 180, color: t.gold, accent: t.sky }), 480, 125, 180, 180),
    place(createElement(OrnamentDivider, { color: t.line, accent: t.gold }), 200, 250, 112, 64),
    `<rect x="20" y="330" width="680" height="200" fill="none" stroke="${t.line}" stroke-opacity="0.3"/>`,
    place(createElement(OrnamentPattern, { color: t.line, opacity: 0.45, tile: 64 }), 20, 330, 680, 200),
    `<rect x="20" y="550" width="680" height="190" fill="none" stroke="${t.line}" stroke-opacity="0.3"/>`,
    place(createElement(OrnamentPattern, { color: t.line }), 20, 550, 680, 190),
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${t.bg}"/>${parts.join('')}</svg>`;
  await sharp(Buffer.from(svg), { density: 144 }).png().toFile(`${out}ornaments-${t.name}.png`);
  console.log('written', `${out}ornaments-${t.name}.png`);
}
// Крупный план одного мотива для проверки симметрии
const big = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="100%" height="100%" fill="#f2f6f5"/>${place(createElement(OrnamentBand, { height: 120, color: '#0b7a70', accent: '#C9A23A' }), 0, 40, 400, 120)}</svg>`;
await sharp(Buffer.from(big), { density: 144 }).png().toFile(`${out}band-zoom.png`);
