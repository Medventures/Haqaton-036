// Клэри — 2D-аватар ИИ-помощника (SVG, без внешних ассетов).
// Намеренно стилизован как робот: пациент не должен принять ИИ за настоящего врача.
// Крест — зелёный (цвет клиники): красный крест на белом — охраняемая эмблема.

import { useEffect, useId, useRef, useState } from 'react';
import type { Mood } from '../../shared/types';
import type { MouthFrame } from '../voice/types';

interface Props {
  mood?: Mood;
  speaking?: boolean;
  mouth?: number; // 0..1
  listening?: boolean;
  thinking?: boolean;
  size?: number;
  framing?: 'bust' | 'head';
  /** Источник кадров липсинка (VoiceApi.getMouthFrame): читается в requestAnimationFrame. */
  mouthSource?: () => MouthFrame;
  className?: string;
}

const c01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Рот робота по кадру липсинка: смешение форм «улыбка в покое», «челюсть» (А), «округление» (О/У),
 * «растяжение» (Э/И) и «сомкнутые губы» (М). Две кубические кривые — верхняя и нижняя губа.
 */
export function robotMouthPath(f: MouthFrame): string {
  const round = c01(f.round), wide = c01(f.wide), closed = c01(f.closed);
  const o = c01(f.open) * (1 - 0.85 * closed);
  const hw = 20 + 7 * wide - 8 * round * (1 - 0.3 * wide);           // полуширина 12..27
  const cy = 203 - 1.5 * wide + round;                                 // уголки рта
  const smile = 2.2 * (1 - o) * (1 - round);                           // лёгкая улыбка, пока рот почти закрыт
  const top = cy - smile - 1 - o * 4 - round * o * 3;                  // верхняя губа
  const bot = cy + 2.5 + o * 17 + round * o * 4 - wide * o * 5;        // нижняя губа (челюсть)
  const cx = hw * (0.35 + 0.6 * round);                                // О/У — ближе к овалу, А/Э — «миндаль»
  const L = 200 - hw, R = 200 + hw;
  const y = (v: number) => v.toFixed(1);
  const ty = cy + (top - cy) / 0.75, by = cy + (bot - cy) / 0.75;
  return `M${y(L)} ${y(cy)} C${y(L + hw - cx)} ${y(ty)} ${y(R - hw + cx)} ${y(ty)} ${y(R)} ${y(cy)} C${y(R - hw + cx)} ${y(by)} ${y(L + hw - cx)} ${y(by)} ${y(L)} ${y(cy)} Z`;
}
/** Подпись для скринридеров на языке документа (аватар может рендериться вне провайдеров). */
function ariaLabel(speaking: boolean, listening: boolean, thinking: boolean): string {
  const kk = typeof document !== 'undefined' && document.documentElement.lang === 'kk';
  const st = speaking ? (kk ? ' — сөйлеп тұр' : ' — говорит') : listening ? (kk ? ' — тыңдап тұр' : ' — слушает') : thinking ? (kk ? ' — ойланып тұр' : ' — думает') : '';
  return `${kk ? 'Клэри, ЖИ-көмекші' : 'Клэри, ИИ-помощник'}${st}`;
}
const REST_TALK = robotMouthPath({ open: 0.1, round: 0, wide: 0, closed: 0, level: 0 });

export default function Avatar({ mood = 'neutral', speaking = false, mouth = 0, listening = false, thinking = false, size = 260, framing = 'bust', mouthSource, className = '' }: Props) {
  const uid = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);
  const mouthRef = useRef<SVGPathElement>(null);
  const live = speaking && Boolean(mouthSource);

  // Липсинк: кадр рта из mouthSource пишется прямо в атрибут d (без перерисовки React на каждый кадр).
  useEffect(() => {
    if (!live || !mouthSource) return;
    let raf = 0, prev = '';
    const tick = () => {
      const d = robotMouthPath(mouthSource());
      if (d !== prev) { prev = d; mouthRef.current?.setAttribute('d', d); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, mouthSource]);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);

  // Глаза следят за курсором.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const cx = r.left + r.width / 2, cy = r.top + r.height * 0.35;
      const dx = (e.clientX - cx) / window.innerWidth, dy = (e.clientY - cy) / window.innerHeight;
      setLook({ x: Math.max(-1, Math.min(1, dx * 2.4)), y: Math.max(-1, Math.min(1, dy * 2.4)) });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Случайное моргание.
  useEffect(() => {
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => { setBlink(true); window.setTimeout(() => setBlink(false), 130); loop(); }, 2200 + Math.random() * 3200);
    };
    loop();
    return () => window.clearTimeout(t);
  }, []);

  const state: Mood = thinking ? 'thinking' : listening ? 'listening' : mood;
  const gaze = state === 'thinking' ? { x: 0.7, y: -0.8 } : look;
  const gx = gaze.x * 6, gy = gaze.y * 5;

  // Брови по настроению: [внешний y, внутренний y]
  const brows: Record<Mood, [number, number]> = { neutral: [106, 104], happy: [104, 101], thinking: [100, 106], concerned: [108, 98], listening: [101, 99] };
  const [bo, bi] = brows[state];
  const eyeScaleY = blink ? 0.08 : state === 'listening' ? 1.06 : 1;

  const open = speaking ? Math.max(0.08, mouth) : 0;
  const mouthPath = live
    ? REST_TALK
    : speaking
    ? `M180 203 Q200 ${207 + open * 16} 220 203 Q200 ${203 + open * 4} 180 203 Z`
    : state === 'concerned'
      ? 'M186 209 Q200 203 214 209'
      : state === 'thinking'
        ? 'M190 207 Q202 209 212 204'
        : state === 'happy'
          ? 'M176 199 Q200 222 224 199'
          : 'M180 202 Q200 216 220 202';

  const viewBox = framing === 'head' ? '60 18 280 270' : '40 14 320 426';
  const height = framing === 'head' ? size * (270 / 280) : size * (426 / 320);

  const eye = (cx: number) => (
    <g key={cx} style={{ transform: `scaleY(${eyeScaleY})`, transformOrigin: `${cx}px 150px`, transition: 'transform 90ms ease' }}>
      <ellipse cx={cx} cy={150} rx={25} ry={29} fill="#0b1630" stroke="#8fdcff" strokeWidth={2.5} filter={`url(#glow-${uid})`} />
      <g style={{ transform: `translate(${gx}px, ${gy}px)`, transition: 'transform 180ms ease-out' }}>
        <circle cx={cx} cy={152} r={17} fill={`url(#iris-${uid})`} />
        <circle cx={cx} cy={153} r={7.5} fill="#050d22" />
        <circle cx={cx - 7} cy={144} r={5} fill="#fff" />
        <circle cx={cx + 6} cy={158} r={2.4} fill="#fff" opacity={0.9} />
      </g>
      {state === 'happy' && !blink && <path d={`M${cx - 27} 176 Q${cx} 158 ${cx + 27} 176 L${cx + 27} 182 L${cx - 27} 182 Z`} fill="#070a12" />}
      <path d={cx < 200 ? `M${cx - 24} 132 l-6 -5 M${cx - 18} 126 l-4 -6` : `M${cx + 24} 132 l6 -5 M${cx + 18} 126 l4 -6`} stroke="#8fdcff" strokeWidth={2.2} strokeLinecap="round" />
    </g>
  );

  return (
    <svg ref={ref} className={`clary-avatar mood-${state} ${speaking ? 'is-speaking' : ''} ${listening ? 'is-listening' : ''} ${className}`} width={size} height={height} viewBox={viewBox} role="img" aria-label={ariaLabel(speaking, listening, thinking)}>
      <defs>
        <filter id={`glow-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id={`soft-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#1d4f6b" floodOpacity="0.18" />
        </filter>
        <radialGradient id={`iris-${uid}`} cx="45%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#8fd3ff" />
          <stop offset="55%" stopColor="#2d7cf0" />
          <stop offset="100%" stopColor="#123a9c" />
        </radialGradient>
        <radialGradient id={`visor-${uid}`} cx="40%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#252e3f" />
          <stop offset="60%" stopColor="#0a0e17" />
          <stop offset="100%" stopColor="#03050a" />
        </radialGradient>
        <linearGradient id={`shell-${uid}`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dfe8ef" />
        </linearGradient>
        <linearGradient id={`coat-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e3eaf0" />
        </linearGradient>
        <radialGradient id={`halo-${uid}`} cx="50%" cy="45%" r="50%">
          <stop offset="0%" stopColor="#bfeaff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#bfeaff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="200" cy="175" r="170" fill={`url(#halo-${uid})`} className="clary-halo" />

      <g className="clary-float">
        {framing === 'bust' && (
          <g className="clary-body" filter={`url(#soft-${uid})`}>
            {/* халат */}
            <path d="M58 440 C60 350 108 306 200 298 C292 306 340 350 342 440 Z" fill={`url(#coat-${uid})`} stroke="#d3dde6" strokeWidth="1.5" />
            {/* голубая форма */}
            <path d="M158 302 L200 372 L242 302 C230 298 170 298 158 302 Z" fill="#7e9cc6" />
            <path d="M172 304 L200 350 L228 304 Z" fill="#6c89b3" />
            {/* лацканы */}
            <path d="M150 304 L196 392 L178 440 L128 440 C136 380 142 330 150 304 Z" fill="#f3f7fa" stroke="#d3dde6" strokeWidth="1.5" />
            <path d="M250 304 L204 392 L222 440 L272 440 C264 380 258 330 250 304 Z" fill="#f3f7fa" stroke="#d3dde6" strokeWidth="1.5" />
            {/* светящийся модуль на груди */}
            <circle cx="200" cy="322" r="8" fill="#0b1630" stroke="#6fd0ff" strokeWidth="2.5" filter={`url(#glow-${uid})`} className="clary-core" />
            {/* стетоскоп */}
            <path d="M168 300 C132 322 132 372 162 392" fill="none" stroke="#1a1f29" strokeWidth="6" strokeLinecap="round" />
            <path d="M232 300 C266 322 270 364 252 392 C244 404 232 408 226 402" fill="none" stroke="#1a1f29" strokeWidth="6" strokeLinecap="round" />
            <circle cx="222" cy="404" r="12" fill="#c9d3dc" stroke="#8e9aa6" strokeWidth="3" />
            <circle cx="222" cy="404" r="5" fill="#eef3f7" />
            {/* бейдж с зелёным крестом */}
            <rect x="262" y="346" width="34" height="22" rx="4" fill="#fff" stroke="#cfd9e2" />
            <path d="M276 351 h6 v5 h5 v6 h-5 v5 h-6 v-5 h-5 v-6 h5 Z" fill="#1f9d76" transform="translate(0,-2) scale(1)" />
            {/* нашивка на рукаве */}
            <circle cx="88" cy="372" r="12" fill="#e9f3fb" stroke="#4d86d6" strokeWidth="3" />
          </g>
        )}

        {/* шея */}
        <rect x="182" y="246" width="36" height="58" rx="10" fill="#161b24" />
        <path d="M184 266 h32 M184 282 h32" stroke="#3a4352" strokeWidth="2" />

        <g className="clary-head">
          {/* «наушники» */}
          {[86, 314].map(x => (
            <g key={x}>
              <circle cx={x} cy={162} r={31} fill={`url(#shell-${uid})`} stroke="#cdd8e1" strokeWidth="1.5" />
              <circle cx={x} cy={162} r={21} fill="#10151f" />
              <circle cx={x} cy={162} r={14} fill="none" stroke="#56c6ff" strokeWidth="5" filter={`url(#glow-${uid})`} className="clary-ear" />
            </g>
          ))}
          {/* шлем */}
          <ellipse cx="200" cy="158" rx="116" ry="110" fill={`url(#shell-${uid})`} stroke="#cfd9e2" strokeWidth="1.5" />
          {/* медицинский чепчик */}
          <path d="M112 96 C112 34 288 34 288 96 C250 80 150 80 112 96 Z" fill="#fff" stroke="#d3dde6" strokeWidth="1.5" />
          <path d="M112 96 C150 80 250 80 288 96 L284 110 C246 96 154 96 116 110 Z" fill="#eef3f7" stroke="#d3dde6" strokeWidth="1.2" />
          <path d="M193 46 h14 v12 h12 v14 h-12 v12 h-14 v-12 h-12 v-14 h12 Z" fill="#1f9d76" />
          <path d="M126 86 C132 74 142 64 156 58" stroke="#6fd0ff" strokeWidth="4" strokeLinecap="round" fill="none" filter={`url(#glow-${uid})`} opacity="0.85" />
          {/* визор */}
          <ellipse cx="200" cy="164" rx="94" ry="84" fill={`url(#visor-${uid})`} stroke="#2a3342" strokeWidth="3" />
          <path d="M128 128 C140 100 170 86 206 86" stroke="#fff" strokeOpacity="0.22" strokeWidth="7" strokeLinecap="round" fill="none" />
          <path d="M262 214 C252 230 238 240 222 244" stroke="#fff" strokeOpacity="0.08" strokeWidth="5" strokeLinecap="round" fill="none" />

          {/* лицо */}
          <g className="clary-face">
            <path d={`M140 ${bo} Q158 ${Math.min(bo, bi) - 7} 176 ${bi}`} stroke="#8fdcff" strokeWidth="3" strokeLinecap="round" fill="none" filter={`url(#glow-${uid})`} style={{ transition: 'd 200ms ease' }} />
            <path d={`M224 ${bi} Q242 ${Math.min(bo, bi) - 7} 260 ${bo}`} stroke="#8fdcff" strokeWidth="3" strokeLinecap="round" fill="none" filter={`url(#glow-${uid})`} style={{ transition: 'd 200ms ease' }} />
            {eye(158)}
            {eye(242)}
            <path ref={mouthRef} d={mouthPath} stroke="#a8e8ff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" fill={speaking ? '#0e3b5c' : 'none'} filter={`url(#glow-${uid})`} />
            {(state === 'happy' || speaking) && <>
              <ellipse cx="136" cy="190" rx="10" ry="5" fill="#4fb6ff" opacity="0.18" />
              <ellipse cx="264" cy="190" rx="10" ry="5" fill="#4fb6ff" opacity="0.18" />
            </>}
            {thinking && (
              <g className="clary-dots">
                {[0, 1, 2].map(i => <circle key={i} cx={186 + i * 14} cy={228} r={3.4} fill="#8fdcff" style={{ animationDelay: `${i * 0.18}s` }} />)}
              </g>
            )}
          </g>
        </g>
      </g>
    </svg>
  );
}
