// Казахский орнамент (ою-өрнек): мотив «қошқар мүйіз» (бараний рог) и производные.
// Вся геометрия строится кодом: один рог — логарифмическая спираль, сглаженная кривыми Безье;
// левый рог — зеркало правого, остальные мотивы — повороты/отражения того же рога.
// Цвета по умолчанию — currentColor, поэтому орнамент наследует цвет текста или класса .kz-gold/.kz-teal/.kz-sky.
import { useId, type CSSProperties } from 'react';

export interface OrnamentProps { className?: string; color?: string; accent?: string; opacity?: number }

type Pt = [number, number];
const n = (v: number) => String(Math.round(v * 100) / 100);

/** Сглаженный путь через точки (Catmull-Rom → кубические Безье). */
function smooth(pts: Pt[]): string {
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} `
      + `${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
}

/**
 * Один рог: стартует в (0,0), уходит вверх и наружу вправо, закручивается по часовой стрелке внутрь.
 * r0 — начальный радиус завитка, turns — число витков, end — во сколько раз сужается спираль.
 */
function hornPts(r0: number, turns = 1.2, end = 0.3, mirror = false): Pt[] {
  const total = turns * 2 * Math.PI, k = Math.log(1 / end) / total, steps = Math.ceil(turns * 12);
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (total * i) / steps, r = r0 * Math.exp(-k * t), a = Math.PI + t;
    const x = r0 + r * Math.cos(a), y = r * Math.sin(a);
    pts.push([mirror ? -x : x, y]);
  }
  return pts;
}

/** Пара рогов со стеблем: стык рогов в (0,0), стебель вниз на длину stem. Левый рог — зеркало правого. */
function ramHorn(r0: number, stem: number, turns = 1.2, end = 0.3) {
  return (stem > 0 ? `M0 ${n(stem)}V0` : '') + smooth(hornPts(r0, turns, end)) + smooth(hornPts(r0, turns, end, true));
}

// Предрасчитанные мотивы (строятся один раз при загрузке модуля).
const BAND = { w: 54, h: 24 };
const BAND_HORN = ramHorn(6, 8.3, 1.4, 0.22);       // стебель от кромки (с учётом круглого конца) до стыка рогов
const SMALL_HORN = ramHorn(4.2, 3, 1.2, 0.3);       // для разделителя
const TILE_HORN = ramHorn(4.6, 8, 1.25, 0.28);      // для фона
const ROSETTE_HORN = ramHorn(8.5, 14, 1.3, 0.26);
const CORNER_HORN = ramHorn(7, 19, 1.25, 0.28);
const CORNER_CURL = smooth(hornPts(4.5, 1.15, 0.3));

const diamond = (x: number, y: number, r: number) => `M${n(x)} ${n(y - r)}L${n(x + r)} ${n(y)}L${n(x)} ${n(y + r)}L${n(x - r)} ${n(y)}Z`;

function cx(...c: (string | false | undefined)[]) { return c.filter(Boolean).join(' '); }
function useSvgId(prefix: string) { return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, ''); }
function baseStyle(p: OrnamentProps, extra?: CSSProperties): CSSProperties {
  return { ...(p.color ? { color: p.color } : null), ...(p.opacity != null ? { opacity: p.opacity } : null), ...extra };
}
const stroke = (w: number) => ({ fill: 'none', stroke: 'currentColor', strokeWidth: w, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });
/** Мотив рисуется один раз в <defs>, повторы — через <use> (компактная разметка). */
const use = (id: string, transform: string, key?: string | number) => <use key={key} href={`#${id}`} transform={transform} />;

/** Горизонтальная бесшовная полоса «қошқар мүйіз»: рога вверх и вниз чередуются. */
export function OrnamentBand(p: OrnamentProps & { height?: number }) {
  const id = useSvgId('kzb'), hid = `${id}h`;
  const h = p.height ?? 22, s = h / BAND.h, accent = p.accent ?? 'currentColor';
  const top = 1.2, bot = BAND.h - 1.2, mid = BAND.h / 2;
  return (
    <svg className={cx('kz-band', p.className)} width="100%" height={h} aria-hidden="true" focusable="false" style={baseStyle(p, { pointerEvents: 'none' })}>
      <defs>
        <path id={hid} d={BAND_HORN} {...stroke(1.35)} />
        <pattern id={id} patternUnits="userSpaceOnUse" x="50%" width={BAND.w * s} height={h}>
          <g transform={`scale(${n(s)})`}>
            <path d={`M-1 ${top}H${BAND.w + 1}M-1 ${bot}H${BAND.w + 1}`} {...stroke(0.9)} />
            {/* стебли не лежат на шве плитки — иначе на дробных масштабах видна двойная линия */}
            {use(hid, `translate(${BAND.w / 4} ${bot - 8.8})`)}
            {use(hid, `translate(${(3 * BAND.w) / 4} ${top + 8.8}) scale(1 -1)`)}
            <path d={[0, BAND.w / 2, BAND.w].map((x) => diamond(x, mid, 1.2)).join('')} fill={accent} />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height={h} fill={`url(#${id})`} />
    </svg>
  );
}

/** Угловой элемент: диагональный рог + рамочные линии с завитками. Остальные углы — отражением. */
export function OrnamentCorner(p: OrnamentProps & { size?: number; corner?: 'tl' | 'tr' | 'bl' | 'br' }) {
  const hid = useSvgId('kzc');
  const size = p.size ?? 72, c = p.corner ?? 'tl', accent = p.accent ?? 'currentColor';
  const flip = { tl: '', tr: 'translate(64 0) scale(-1 1)', bl: 'translate(0 64) scale(1 -1)', br: 'translate(64 64) scale(-1 -1)' }[c];
  return (
    <svg className={cx('kz-corner', `kz-corner-${c}`, p.className)} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" style={baseStyle(p, { pointerEvents: 'none' })}>
      <defs><path id={hid} d={CORNER_CURL} {...stroke(1)} /></defs>
      <g transform={flip || undefined}>
        <path d="M3 58V3H58M8 46V8H46" {...stroke(1)} />
        <path d={CORNER_HORN} transform="translate(21.5 21.5) rotate(135)" {...stroke(1.3)} />
        {use(hid, 'translate(58 3) rotate(90)')}
        {use(hid, 'translate(3 58) scale(1 -1)')}
        <path d={`${diamond(46, 8, 1.6)}${diamond(8, 46, 1.6)}`} fill={accent} />
      </g>
    </svg>
  );
}

/** Едва заметный бесшовный фон (прозрачность по умолчанию 0.1 — из .kz-pattern в ornaments.css): рога «қошқар мүйіз» в шахматном (half-drop) порядке + ромбы, ничего не лежит на швах плитки. Заполняет позиционированного родителя. */
export function OrnamentPattern(p: OrnamentProps & { tile?: number }) {
  const id = useSvgId('kzp'), hid = `${id}h`;
  const t = p.tile ?? 64, s = t / 40, accent = p.accent ?? 'currentColor';
  return (
    <svg className={cx('kz-pattern', p.className)} aria-hidden="true" focusable="false"
      style={baseStyle(p, { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' })}>
      <defs>
        <path id={hid} d={TILE_HORN} {...stroke(1.1)} />
        <pattern id={id} patternUnits="userSpaceOnUse" width={t} height={t}>
          <g transform={`scale(${n(s)})`}>
            {use(hid, 'translate(10 12)')}
            {use(hid, 'translate(30 31)')}
            <path d={diamond(30, 15, 1.6) + diamond(10, 34, 1.6)} fill={accent} />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** Разделитель: тонкие линии с затуханием и маленький медальон по центру. */
export function OrnamentDivider(p: OrnamentProps) {
  const hid = useSvgId('kzd');
  const accent = p.accent ?? 'currentColor';
  return (
    <div className={cx('kz-divider', p.className)} aria-hidden="true" style={baseStyle(p, { pointerEvents: 'none' })}>
      <span className="kz-divider-line" />
      <svg width="56" height="32" viewBox="-24 -14 48 28" focusable="false">
        <defs><path id={hid} d={SMALL_HORN} {...stroke(1.2)} /></defs>
        {use(hid, 'translate(0 -2.5)')}
        {use(hid, 'translate(0 2.5) scale(1 -1)')}
        <path d={`${diamond(-17, 0, 1.6)}${diamond(17, 0, 1.6)}`} fill={accent} />
      </svg>
      <span className="kz-divider-line" />
    </div>
  );
}

/** Круглый медальон «күн»: четыре пары рогов из центра, ромбы между ними, двойное кольцо. */
export function Rosette(p: OrnamentProps & { size?: number }) {
  const hid = useSvgId('kzr');
  const size = p.size ?? 96, accent = p.accent ?? 'currentColor';
  const dots = Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8);
  return (
    <svg className={cx('kz-rosette', p.className)} width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true" focusable="false" style={baseStyle(p, { pointerEvents: 'none' })}>
      <defs><path id={hid} d={ROSETTE_HORN} {...stroke(1.5)} /></defs>
      <circle r="47.5" {...stroke(0.8)} />
      <circle r="43.5" {...stroke(1.2)} />
      {[0, 90, 180, 270].map((a) => use(hid, `rotate(${a}) translate(0 -22)`, a))}
      {[45, 135, 225, 315].map((a) => <path key={a} d={`M0 -24L3.2 -30L0 -36L-3.2 -30Z`} transform={`rotate(${a})`} fill={accent} />)}
      <circle r="4.5" {...stroke(1.2)} />
      <circle r="1.6" fill={accent} />
      <path d={dots.map((a) => `M${n(45.5 * Math.sin(a))} ${n(-45.5 * Math.cos(a))}h0`).join('')} {...stroke(1.6)} stroke={accent} />
    </svg>
  );
}
