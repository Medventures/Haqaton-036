// Аружан — реалистичный говорящий аватар ИИ-помощника (синтетический портрет, не реальный человек).
// Липсинк: в requestAnimationFrame читаем mouthSource() и НЕПРЕРЫВНО деформируем нижнюю часть лица
// на <canvas> поверх базового фото (src/voice/mouthRig.ts: челюсть, губы, О/У/Э/И, полость рта) —
// без «двойных губ» и эффекта диафильма от перекрёстного наложения картинок. Ориентиры рта — rig
// в manifest.json (проверка: scripts/avatar/warp-preview.mts). Если canvas недоступен — прежний путь:
// патчи рта (визем A/O/E/U/M) с прозрачностями через ref-ы. Моргание — патч глаз.
// Бейдж «ИИ» / «ЖИ» виден всегда: пациент не должен принять аватар за настоящего врача.

import { useEffect, useRef } from 'react';
import type { Mood } from '../../shared/types';
import { useT } from '../i18n';
import type { MouthFrame } from '../voice/types';
import { columnMap, hRows, interiorRGBA, isRest, mouthPose, REST_POSE, srcX, type MouthPose, type MouthRig } from '../voice/mouthRig';

export interface RealisticAvatarProps {
  mood?: Mood;
  speaking?: boolean;
  listening?: boolean;
  thinking?: boolean;
  size?: number;
  framing?: 'bust' | 'head';
  mouth?: number;
  mouthSource?: () => MouthFrame;
  className?: string;
  /** Бейдж «ИИ» в углу (по умолчанию включён). */
  showBadge?: boolean;
}

/** Копия public/avatars/aruzhan/manifest.json (координаты в пикселях базового кадра 720×900). */
const M = {
  width: 720,
  height: 900,
  base: 'base.webp',
  mouth: { x: 246, y: 350, w: 172, h: 124, frames: { A: 'mouth-a.webp', O: 'mouth-o.webp', E: 'mouth-e.webp', U: 'mouth-u.webp', M: 'mouth-m.webp' } },
  eyes: { x: 234, y: 236, w: 192, h: 56, src: 'eyes-closed.webp' },
  face: { cx: 334, cy: 318, size: 400 },
} as const;

/** Копия rig из manifest.json: ориентиры рта для непрерывной деформации. */
const RIG: MouthRig = {
  cx: 332,
  seam: [[280, 395.5], [288, 397.5], [294, 399.5], [300, 400.5], [312, 401.5], [324, 403.5], [336, 402.5], [348, 401.5], [360, 401.5], [372, 399.5], [378, 397.5], [386, 395.5]],
  upperLipTop: 389,
  lowerLipBottom: 428,
  chin: 484,
  chinCurve: 16,
  box: { x: 240, y: 368, w: 184, h: 146 },
};

/** Рендерер деформации рта на canvas (двухпроходная деформация полосами drawImage + полость рта). */
class MouthCanvas {
  private ctx: CanvasRenderingContext2D;
  private tmp: HTMLCanvasElement;
  private tctx: CanvasRenderingContext2D;
  private patch: HTMLCanvasElement;
  private pctx: CanvasRenderingContext2D;
  private k = 1;
  private restDrawn = false;

  constructor(private canvas: HTMLCanvasElement, private img: HTMLImageElement) {
    const ctx = canvas.getContext('2d');
    this.tmp = document.createElement('canvas');
    this.patch = document.createElement('canvas');
    const t = this.tmp.getContext('2d'), p = this.patch.getContext('2d');
    if (!ctx || !t || !p) throw new Error('no 2d');
    this.ctx = ctx; this.tctx = t; this.pctx = p;
    this.tmp.width = RIG.box.w; this.tmp.height = RIG.box.h;
  }

  /** Разрешение canvas: пиксели экрана (devicePixelRatio) на пиксель исходного кадра. */
  resize(stagePx: number) {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const k = Math.max(0.5, Math.min(2, (stagePx * dpr) / M.width));
    const w = Math.round(RIG.box.w * k), h = Math.round(RIG.box.h * k);
    if (w !== this.canvas.width || h !== this.canvas.height) { this.canvas.width = w; this.canvas.height = h; this.restDrawn = false; }
    this.k = w / RIG.box.w;
  }

  draw(pose: MouthPose) {
    if (!this.img.complete || !this.img.naturalWidth) return;
    const rest = isRest(pose);
    if (rest && this.restDrawn) return;
    this.restDrawn = rest;
    const B = RIG.box, k = this.k, ctx = this.ctx;
    // В покое canvas прозрачен — виден исходный <img> без малейшей разницы в пересэмплинге.
    if (rest) { ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); return; }
    const iw = this.img.naturalWidth / M.width; // base.webp может быть в другом разрешении
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Подложка без деформации (на случай субпиксельных щелей между полосами).
    ctx.drawImage(this.img, B.x * iw, B.y * iw, B.w * iw, B.h * iw, 0, 0, this.canvas.width, this.canvas.height);

    // 1) Горизонтальный проход (О/У, Э/И) во временный canvas 1:1 с исходником.
    let src: CanvasImageSource = this.img, sx0 = 0, sy0 = 0, ss = iw;
    if (Math.abs(pose.sx - 1) > 0.003) {
      const t = this.tctx;
      t.imageSmoothingEnabled = true;
      t.drawImage(this.img, B.x * iw, B.y * iw, B.w * iw, B.h * iw, 0, 0, B.w, B.h);
      const [r0, r1] = hRows(RIG);
      const RH = 2, XS = 8;
      for (let y = Math.max(r0, B.y); y < Math.min(r1, B.y + B.h); y += RH) {
        const yc = y + RH / 2;
        let px = B.x, ps = srcX(RIG, pose, B.x, yc);
        for (let x = B.x + XS; x <= B.x + B.w; x += XS) {
          const s = srcX(RIG, pose, x, yc);
          if (s > ps) t.drawImage(this.img, ps * iw, y * iw, (s - ps) * iw, RH * iw, px - B.x, y - B.y, x - px, RH);
          px = x; ps = s;
        }
      }
      src = this.tmp; sx0 = B.x; sy0 = B.y; ss = 1;
    }

    // 2) Вертикальный проход: столбцы шириной CW пикселей canvas, кусочно-линейная карта по узлам.
    const CW = 2, gaps: [number, number, number][] = [];
    for (let c = 0; c < this.canvas.width; c += CW) {
      const cw = Math.min(CW, this.canvas.width - c);
      const x0 = B.x + c / k, x1 = B.x + (c + cw) / k;
      const m = columnMap(RIG, pose, (x0 + x1) / 2);
      if (m.gap) gaps.push([(x0 + x1) / 2, m.gap[0], m.gap[1]]);
      const kn = m.knots;
      for (let i = 1; i < kn.length; i++) {
        const [d0, s0] = kn[i - 1], [d1, s1] = kn[i];
        if (s1 <= s0 || d1 <= d0) continue;
        const dy = (d0 - B.y) * k, dh = (d1 - d0) * k;
        // Лёгкий нахлёст вниз прячет субпиксельные швы между кусками столбца.
        const ov = i < kn.length - 1 ? 0.75 : 0, sov = (ov / dh) * (s1 - s0);
        ctx.drawImage(src, (x0 - sx0) * ss, (s0 - sy0) * ss, (x1 - x0) * ss, (s1 - s0 + sov) * ss, c, dy, cw, dh + ov);
      }
    }

    // 3) Полость рта — попиксельно в маленький canvas (та же функция, что в офлайн-проверке).
    if (!gaps.length) return;
    let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
    for (const [x, a, b] of gaps) {
      if (b - a < 0.15) continue;
      gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); gy0 = Math.min(gy0, a); gy1 = Math.max(gy1, b);
    }
    if (!(gx1 > gx0)) return;
    gx0 = Math.floor(gx0 - 2); gx1 = Math.ceil(gx1 + 2); gy0 = Math.floor(gy0 - 1); gy1 = Math.ceil(gy1 + 1);
    const pw = Math.max(1, Math.round((gx1 - gx0) * k)), ph = Math.max(1, Math.round((gy1 - gy0) * k));
    if (this.patch.width !== pw || this.patch.height !== ph) { this.patch.width = pw; this.patch.height = ph; }
    const im = this.pctx.createImageData(pw, ph), d = im.data;
    for (let i = 0; i < pw; i++) {
      const x = gx0 + (i + 0.5) / k;
      const m = columnMap(RIG, pose, x);
      if (!m.gap) continue;
      for (let j = 0; j < ph; j++) {
        const c = interiorRGBA(RIG, pose, m, x, gy0 + (j + 0.5) / k);
        if (!c) continue;
        const o = (j * pw + i) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3] * 255;
      }
    }
    this.pctx.putImageData(im, 0, 0);
    ctx.drawImage(this.patch, (gx0 - B.x) * k, (gy0 - B.y) * k, pw, ph);
  }
}

const DIR = `${import.meta.env.BASE_URL}avatars/aruzhan/`;
const VISEMES = ['M', 'U', 'E', 'O', 'A'] as const; // порядок слоёв снизу вверх
type Viseme = (typeof VISEMES)[number];

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const boxStyle = (b: { x: number; y: number; w: number; h: number }) => ({
  left: pct(b.x, M.width), top: pct(b.y, M.height), width: pct(b.w, M.width), height: pct(b.h, M.height),
});

// Предзагрузка всех кадров, чтобы при первой фразе не было «мигания».
let preloaded = false;
function preload() {
  if (preloaded || typeof Image === 'undefined') return;
  preloaded = true;
  for (const f of [M.base, ...Object.values(M.mouth.frames), M.eyes.src]) { const i = new Image(); i.decoding = 'async'; i.src = DIR + f; }
}

/** Целевые веса визем из кадра рта; сумма ≤ 1. */
function weights(f: MouthFrame): Record<Viseme, number> {
  const c = (v: number) => Math.max(0, Math.min(1, v || 0));
  const open = c(f.open), round = c(f.round), wide = c(f.wide), closed = c(f.closed);
  const w: Record<Viseme, number> = {
    A: open * (1 - round) * (1 - wide),
    O: open * round,
    U: round * (1 - open),
    E: wide,
    M: closed,
  };
  const sum = w.A + w.O + w.U + w.E + w.M;
  if (sum > 1) for (const k of VISEMES) w[k] /= sum;
  return w;
}

function useLangSafe(): 'ru' | 'kk' {
  try { return useT().lang; } catch { return 'ru'; } // вне LangProvider — русский
}

export default function RealisticAvatar({
  mood = 'neutral', speaking = false, listening = false, thinking = false, size = 260, framing = 'bust',
  mouth = 0, mouthSource, className = '', showBadge = true,
}: RealisticAvatarProps) {
  const lang = useLangSafe();
  const patchRefs = useRef<Partial<Record<Viseme, HTMLImageElement | null>>>({});
  const eyesRef = useRef<HTMLImageElement>(null);
  const baseRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MouthCanvas | null | undefined>(undefined); // undefined — ещё не пробовали
  const pose = useRef<MouthPose>({ ...REST_POSE });
  const cur = useRef<Record<Viseme, number>>({ A: 0, O: 0, U: 0, E: 0, M: 0 });
  // Актуальные значения для rAF-цикла без перезапуска эффекта.
  const live = useRef({ speaking, mouth, mouthSource });
  live.current = { speaking, mouth, mouthSource };

  useEffect(preload, []);

  /** Непрерывная деформация на canvas; null — не поддерживается (запасной путь — патчи). */
  const renderer = (): MouthCanvas | null => {
    if (rendererRef.current !== undefined) return rendererRef.current;
    const cv = canvasRef.current, img = baseRef.current;
    if (!cv || !img) return null;
    try { rendererRef.current = new MouthCanvas(cv, img); } catch { rendererRef.current = null; }
    return rendererRef.current;
  };

  // Липсинк: цикл работает, пока говорит, и ещё немного — чтобы плавно закрыть рот.
  useEffect(() => {
    const r = renderer();
    const cv = canvasRef.current;
    if (r && cv) {
      const fit = () => { const w = baseRef.current?.getBoundingClientRect().width; if (w) r.resize(w); };
      fit();
      let raf = 0, last = performance.now(), closing = false;
      cv.style.opacity = '1';
      const tick = (now: number) => {
        const dt = Math.min(100, now - last); last = now;
        const { speaking: sp, mouth: m, mouthSource: src } = live.current;
        const frame: MouthFrame = sp ? (src ? src() : { open: m, round: 0, wide: 0, closed: 0, level: m }) : { open: 0, round: 0, wide: 0, closed: 0, level: 0 };
        // Кадр уже сглажен (таймлайн/липсинк); здесь — лишь ~15 мс, чтобы не было скачков на стыках фраз.
        const target = mouthPose(frame), p = pose.current, a = 1 - Math.exp(-dt / 15);
        for (const key of Object.keys(target) as (keyof MouthPose)[]) p[key] += (target[key] - p[key]) * a;
        r.draw(p);
        if (!sp && isRest(p)) { closing = true; return; } // рот закрыт — цикл можно остановить
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      window.addEventListener('resize', fit);
      return () => { if (!closing) cancelAnimationFrame(raf); window.removeEventListener('resize', fit); };
    }
    if (!speaking) {
      // Плавное закрытие без rAF: сброс через CSS-переход.
      for (const k of VISEMES) { cur.current[k] = 0; const el = patchRefs.current[k]; if (el) el.style.opacity = '0'; }
      return;
    }
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, now - last); last = now;
      const { mouth: m, mouthSource: src } = live.current;
      const frame: MouthFrame = src ? src() : { open: m, round: 0, wide: 0, closed: 0, level: m };
      const target = weights(frame);
      const k = 1 - Math.exp(-dt / 45); // сглаживание ~45 мс
      const c = cur.current;
      for (const v of VISEMES) c[v] += (target[v] - c[v]) * k;
      // Веса → прозрачности слоёв с учётом порядка наложения: o_i = w_i / (1 − Σ w_j выше).
      let above = 0;
      for (let i = VISEMES.length - 1; i >= 0; i--) {
        const v = VISEMES[i];
        const o = above < 0.999 ? Math.min(1, c[v] / (1 - above)) : 0;
        above += c[v];
        const el = patchRefs.current[v];
        if (el) el.style.opacity = o < 0.01 ? '0' : o.toFixed(3);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speaking]);

  // Случайное моргание каждые 2,5–6 с (~120 мс).
  useEffect(() => {
    let t = 0, t2 = 0;
    const schedule = () => {
      t = window.setTimeout(() => {
        const el = eyesRef.current;
        if (el) { el.style.opacity = '1'; t2 = window.setTimeout(() => { el.style.opacity = '0'; }, 120); }
        schedule();
      }, 2500 + Math.random() * 3500);
    };
    schedule();
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, []);

  const head = framing === 'head';
  const stageStyle = head
    ? {
        width: pct(M.width, M.face.size),
        left: `-${((M.face.cx - M.face.size / 2) / M.face.size) * 100}%`,
        top: `-${((M.face.cy - M.face.size / 2) / M.face.size) * 100}%`,
      }
    : undefined;
  const badge = lang === 'kk' ? 'ЖИ' : 'ИИ';
  const label = lang === 'kk'
    ? 'Аружан — жасанды интеллект көмекшісі (дәрігер емес)'
    : 'Аружан — ИИ-помощник (не врач)';

  const cls = [
    'ra', `ra-${framing}`, `ra-mood-${mood}`,
    speaking && 'is-speaking', listening && 'is-listening', thinking && 'is-thinking', className,
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} style={{ width: size }} role="img" aria-label={label} title={label}>
      <div className="ra-frame">
        <div className="ra-stage" style={stageStyle}>
          <div className="ra-life">
            <img ref={baseRef} className="ra-base" src={DIR + M.base} alt="" draggable={false} decoding="async" fetchPriority="high" />
            <canvas ref={canvasRef} className="ra-patch ra-warp" aria-hidden="true" style={{ ...boxStyle(RIG.box), opacity: 0 }} />
            {VISEMES.map((v) => (
              <img
                key={v}
                ref={(el) => { patchRefs.current[v] = el; }}
                className="ra-patch ra-mouth"
                src={DIR + M.mouth.frames[v]}
                alt=""
                draggable={false}
                style={{ ...boxStyle(M.mouth), opacity: 0 }}
              />
            ))}
            <img ref={eyesRef} className="ra-patch ra-eyes" src={DIR + M.eyes.src} alt="" draggable={false} style={{ ...boxStyle(M.eyes), opacity: 0 }} />
          </div>
        </div>
      </div>
      {thinking && <div className="ra-think" aria-hidden="true"><i /><i /><i /></div>}
      {showBadge && <span className="ra-badge" aria-hidden="true">{badge}</span>}
    </div>
  );
}
