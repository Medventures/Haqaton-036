// Непрерывная деформация рта по фото (Аружан): чистая геометрия, общая для canvas-рендера
// (RealisticAvatar) и офлайн-проверки (scripts/avatar/warp-preview.mts).
//
// Вместо перекрёстного наложения готовых картинок рта (двойные губы, «диафильм») каждый кадр
// строится из базового фото:
//  1) горизонтальный проход (полосы-строки): О/У сужают рот, Э/И растягивают; эффект гаснет к щекам;
//  2) вертикальный проход (полосы-столбцы, кусочно-линейная карта по узлам): верхняя губа чуть
//     поднимается, нижняя губа и подбородок опускаются вместе с челюстью, ниже подбородка —
//     сжатие до нуля к краю области, поэтому шва нет (смещение на границе бокса = 0);
//  3) полость рта между губами рисуется по пикселям: тёмно-красный градиент, блик верхних зубов,
//     намёк на язык; края сглажены по покрытию.
// Все координаты — в пикселях базового кадра (720×900).

import type { MouthFrame } from './types';

export interface MouthRig {
  /** Центр рта по горизонтали. */
  cx: number;
  /** Линия смыкания губ: точки [x, y] слева направо (первая и последняя — уголки рта). */
  seam: [number, number][];
  /** Верхний край верхней губы и нижний край нижней губы (по центру). */
  upperLipTop: number;
  lowerLipBottom: number;
  /** Нижний край подбородка по центру; к краям поднимается на chinCurve·(dx/100)². */
  chin: number;
  chinCurve: number;
  /** Область деформации; на её границе смещение нулевое. */
  box: { x: number; y: number; w: number; h: number };
}

export interface MouthPose {
  /** Опускание челюсти у линии губ, px. */
  jaw: number;
  /** Подъём верхней губы, px. */
  lift: number;
  /** Горизонтальный масштаб рта (О/У < 1 < Э/И). */
  sx: number;
  /** Сжатие губ (М/Б/П), 0..1. */
  press: number;
  /** Видимость верхних / нижних зубов, 0..1. */
  teeth: number;
  teethLow: number;
  /** Намёк на язык, 0..1. */
  tongue: number;
}

const c01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);
const sstep = (a: number, b: number, x: number) => { const t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export const REST_POSE: MouthPose = { jaw: 0, lift: 0, sx: 1, press: 0, teeth: 0, teethLow: 0, tongue: 0 };

/** Кадр липсинка → параметры деформации. */
export function mouthPose(f: MouthFrame): MouthPose {
  const round = c01(f.round), wide = c01(f.wide), closed = c01(f.closed);
  const o = c01(f.open) * (1 - 0.9 * closed);
  return {
    jaw: 16 * o + 1.5 * round * o,
    lift: 1.6 * o + 1.4 * round * o + 0.8 * wide * o,
    sx: 1 + 0.1 * wide - 0.2 * round,
    press: closed * (1 - o),
    teeth: c01((o * 1.4) * (1 - 0.7 * round) + 0.5 * wide * o * 2),
    teethLow: c01(wide * o * 1.6),
    tongue: c01(o * (1 - 0.5 * wide)),
  };
}

export function isRest(p: MouthPose): boolean {
  return p.jaw < 0.05 && p.lift < 0.05 && Math.abs(p.sx - 1) < 0.003 && p.press < 0.01;
}

/** Полуширина рта (по уголкам). */
export const halfWidth = (r: MouthRig) => (r.seam[r.seam.length - 1][0] - r.seam[0][0]) / 2;

/** Линия губ в исходных координатах (линейная интерполяция по точкам seam). */
export function seamY(r: MouthRig, x: number): number {
  const s = r.seam;
  if (x <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (x <= s[i][0]) { const [x0, y0] = s[i - 1], [x1, y1] = s[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  }
  return s[s.length - 1][1];
}

const chinY = (r: MouthRig, x: number) => r.chin - r.chinCurve * ((x - r.cx) / 100) ** 2;

/** Вес горизонтального масштаба по строке y (0 — вне губ). */
function rowWeight(r: MouthRig, y: number): number {
  const s = seamY(r, r.cx);
  const d = y < s ? (s - y) / (s - r.upperLipTop + 14) : (y - s) / (r.lowerLipBottom - s + 22);
  return 1 - sstep(0.35, 1, d);
}

/** Горизонтальный проход: целевой x → исходный x в строке y. */
export function srcX(r: MouthRig, p: MouthPose, x: number, y: number): number {
  if (p.sx === 1) return x;
  const hw = halfWidth(r), dx = x - r.cx;
  const w = rowWeight(r, y) * (1 - sstep(hw * 0.95, hw * 1.75, Math.abs(dx)));
  return r.cx + dx / (1 + (p.sx - 1) * w);
}

/** Строки, которые затрагивает горизонтальный проход. */
export function hRows(r: MouthRig): [number, number] {
  const s = seamY(r, r.cx);
  return [Math.floor(s - (s - r.upperLipTop + 14)), Math.ceil(s + (r.lowerLipBottom - s + 22))];
}

/** Профиль раскрытия по ширине рта в столбце (исходный x): 1 в центре, 0 в уголках. */
export function mouthProfile(r: MouthRig, xs: number): number {
  const t = (xs - r.cx) / halfWidth(r);
  return Math.abs(t) < 1 ? Math.pow(1 - t * t, 0.75) : 0;
}

/** Вес движения челюсти по горизонтали. */
const jawWeight = (r: MouthRig, x: number) => 1 - sstep(halfWidth(r) * 0.55, halfWidth(r) * 1.6, Math.abs(x - r.cx));

export interface ColumnMap {
  /** Узлы [целевой y, исходный y] по возрастанию. */
  knots: [number, number][];
  /** Полость рта в целевых координатах [верх, низ] или null. */
  gap: [number, number] | null;
}

/**
 * Вертикальный проход для столбца x (целевые координаты после горизонтального прохода):
 * кусочно-линейная карта целевой y → исходный y.
 */
export function columnMap(r: MouthRig, p: MouthPose, x: number): ColumnMap {
  const s = seamY(r, r.cx);
  const xs = srcX(r, p, x, s); // столбец в исходных координатах на линии губ
  const sy = seamY(r, xs);
  const prof = mouthProfile(r, xs), jw = jawWeight(r, xs);
  const top = r.box.y, bottom = r.box.y + r.box.h;
  const ut = r.upperLipTop - 3, lb = r.lowerLipBottom + 2, cy = chinY(r, xs);
  const lift = p.lift * prof, drop = p.jaw * prof;
  const pressU = 1.2 * p.press * prof, pressL = 1.8 * p.press * prof;
  const jawDrop = p.jaw * jw;
  const knots: [number, number][] = [
    [top, top],
    [ut - lift * 0.55 + pressU, ut],
    [sy - lift, sy - 0.5],
  ];
  let gap: [number, number] | null = null;
  if (drop + lift > 0.05) {
    gap = [sy - lift, sy + drop];
    knots.push([sy + drop, sy + 0.5]);
  } else knots[2] = [sy, sy];
  knots.push([Math.max(lb + jawDrop * 0.96 - pressL, sy + drop + 1), lb]);
  knots.push([Math.max(cy + jawDrop * 0.9, lb + jawDrop + 2), cy]);
  knots.push([bottom, bottom]);
  // Монотонность (на всякий случай).
  for (let i = 1; i < knots.length; i++) if (knots[i][0] < knots[i - 1][0] + 0.01) knots[i][0] = knots[i - 1][0] + 0.01;
  return { knots, gap };
}

/** Исходный y для целевого y по карте столбца. */
export function mapY(m: ColumnMap, y: number): number {
  const k = m.knots;
  if (y <= k[0][0]) return y;
  for (let i = 1; i < k.length; i++) {
    if (y <= k[i][0]) { const [d0, s0] = k[i - 1], [d1, s1] = k[i]; return s0 + ((s1 - s0) * (y - d0)) / (d1 - d0); }
  }
  return y;
}

/**
 * Цвет полости рта в точке (целевые координаты) или null. Покрытие по краям — альфа (сглаживание).
 * m — карта столбца x (columnMap), чтобы не считать её дважды.
 */
export function interiorRGBA(r: MouthRig, p: MouthPose, m: ColumnMap, x: number, y: number): [number, number, number, number] | null {
  const g = m.gap;
  if (!g) return null;
  const [t, b] = g, h = b - t;
  if (h < 0.15) return null;
  const cov = c01(Math.min(y - t + 0.5, b - y + 0.5)) * c01(h / 1.2);
  if (cov <= 0) return null;
  const hw = halfWidth(r) * p.sx;
  const u = Math.min(1, Math.abs(x - r.cx) / hw); // 0 центр → 1 уголки
  const v = (y - t) / Math.max(h, 1e-3);          // 0 верх → 1 низ
  // Глубина: темнее в центре и вверху (тень верхней губы).
  const depth = 0.55 + 0.45 * u;
  let R = 70 * depth + 20, G = 22 * depth + 8, B = 26 * depth + 10;
  // Язык — у нижней губы, по центру.
  const tg = p.tongue * c01((v - 0.45) / 0.4) * (1 - u * u) * 0.8;
  R += (168 - R) * tg; G += (78 - G) * tg; B += (84 - B) * tg;
  // Верхние зубы: полоса под верхней губой (не выше ~5,5 px), к уголкам уходят в тень.
  const th = Math.min(h * 0.36, 4.5) * p.teeth * c01((h - 2) / 4);
  if (th > 0.3) {
    const k = c01((th - (y - t)) / 1.6) * c01((y - t + 0.2) / 1.2) * (1 - sstep(0.25, 0.75, u)) * 0.72;
    R += (212 - R) * k; G += (202 - G) * k; B += (192 - B) * k;
  }
  const bh = Math.min(h * 0.2, 2.5) * p.teethLow * c01((h - 3) / 4);
  if (bh > 0.3) {
    const k = c01((bh - (b - y)) / 1.4) * (1 - sstep(0.2, 0.6, u)) * 0.5;
    R += (196 - R) * k; G += (186 - G) * k; B += (178 - B) * k;
  }
  // Тень под верхней губой.
  const sh = c01(1 - (y - t) / 1.6) * 0.35;
  R *= 1 - sh; G *= 1 - sh; B *= 1 - sh;
  return [R, G, B, cov];
}
