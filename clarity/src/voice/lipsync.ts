// Липсинк по звуку: данные AnalyserNode → кадр рта MouthFrame {open, round, wide, closed, level}.
// Все функции чистые (состояние — явный объект), чтобы их можно было тестировать без Web Audio.
//
// Эвристики:
//  • level — RMS, нормированный по «затухающему» пику (автоусиление тихой записи);
//  • open — громкость через кривую (челюсть), чуть меньше для И/Э и У;
//  • round (О/У) — доминирует низкая полоса 150–700 Гц, высокие слабые;
//  • wide (Э/И) — сильна полоса 1600–3500 Гц (второй формант);
//  • closed (М/Б/П) — почти тишина сразу после речи, «гудение» носовых, резкая атака;
//  • сглаживание: быстрая атака (~30 мс), медленнее отпускание (~80 мс), форма губ — ещё
//    медленнее (коартикуляция: соседние звуки перетекают друг в друга).
//
// Основной путь для серверного TTS — офлайн-таймлайн (buildLipTimeline): после декодирования фразы
// весь AudioBuffer разбирается заранее (100 кадров/с, окно ~23 мс, FFT), кадры сглаживаются и
// сдвигаются на ~60 мс вперёд — губы, как у человека, начинают движение чуть раньше звука.
// При воспроизведении кадр берётся по аудиочасам (engine.audioClock) — без задержки и дрожания
// AnalyserNode. Анализатор остаётся запасным путём.

import { SILENT, type MouthFrame } from './types';

export interface AudioFeatures {
  /** RMS временного сигнала (−1..1). */
  rms: number;
  /** Средняя амплитуда спектра в полосах (линейная шкала). */
  low: number;  // 150–700 Гц
  mid: number;  // 700–1600 Гц
  high: number; // 1600–3500 Гц
  sib: number;  // 3500–8000 Гц (шипящие, свистящие)
}

export const BANDS: Record<'low' | 'mid' | 'high' | 'sib', [number, number]> = {
  low: [150, 700], mid: [700, 1600], high: [1600, 3500], sib: [3500, 8000],
};

/** Компенсация спектрального наклона речи (≈ −6 дБ/окт), чтобы полосы были сопоставимы. */
const TILT = { low: 1, mid: 1.6, high: 2.6, sib: 3.5 };

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export function rmsOf(time: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < time.length; i++) s += time[i] * time[i];
  return time.length ? Math.sqrt(s / time.length) : 0;
}

/** Средняя линейная амплитуда спектра (данные getFloatFrequencyData, дБ) в полосе [lo, hi] Гц. */
export function bandLevel(freqDb: ArrayLike<number>, sampleRate: number, fftSize: number, lo: number, hi: number): number {
  const binHz = sampleRate / fftSize;
  const a = Math.max(1, Math.floor(lo / binHz));
  const b = Math.min(freqDb.length - 1, Math.ceil(hi / binHz));
  let s = 0, n = 0;
  for (let i = a; i <= b; i++) {
    const db = freqDb[i];
    s += Number.isFinite(db) ? Math.pow(10, db / 20) : 0;
    n++;
  }
  return n ? s / n : 0;
}

export function extractFeatures(time: ArrayLike<number>, freqDb: ArrayLike<number>, sampleRate: number, fftSize: number): AudioFeatures {
  return {
    rms: rmsOf(time),
    low: bandLevel(freqDb, sampleRate, fftSize, ...BANDS.low),
    mid: bandLevel(freqDb, sampleRate, fftSize, ...BANDS.mid),
    high: bandLevel(freqDb, sampleRate, fftSize, ...BANDS.high),
    sib: bandLevel(freqDb, sampleRate, fftSize, ...BANDS.sib),
  };
}

export interface LipSyncState {
  /** Затухающий пик RMS для автонормировки. */
  peak: number;
  /** Уровень прошлого шага (для детекции атаки). */
  prevLevel: number;
  /** Сколько мс прошло с последнего «звучащего» кадра (Infinity — речи ещё не было). */
  sinceVoiceMs: number;
  frame: MouthFrame;
}

export function createLipSync(): LipSyncState {
  return { peak: 0, prevLevel: 0, sinceVoiceMs: Infinity, frame: { ...SILENT } };
}

const NOISE_GATE = 0.008;   // RMS ниже — тишина
const PEAK_FLOOR = 0.03;    // не усиливать шум
const PEAK_HALF_LIFE = 1500; // мс

/** Целевой (несглаженный) кадр по признакам звука. Обновляет пик/тайминги в st. */
export function targetFrame(f: AudioFeatures, st: LipSyncState, dtMs: number, fixedPeak?: number): MouthFrame {
  st.peak = fixedPeak ?? Math.max(f.rms, st.peak * Math.pow(0.5, dtMs / PEAK_HALF_LIFE), PEAK_FLOOR);
  const level = f.rms < NOISE_GATE ? 0 : clamp01(f.rms / st.peak);

  const low = f.low * TILT.low, mid = f.mid * TILT.mid, high = f.high * TILT.high, sib = f.sib * TILT.sib;
  const tot = low + mid + high + sib;
  const rl = tot > 0 ? low / tot : 0, rh = tot > 0 ? high / tot : 0, rs = tot > 0 ? sib / tot : 0;

  const voiced = smoothstep(0.05, 0.25, level);
  let round = smoothstep(0.45, 0.75, rl) * (1 - smoothstep(0.1, 0.35, rh + rs)) * voiced;
  let wide = smoothstep(0.2, 0.45, rh + 0.4 * rs) * (1 - 0.5 * smoothstep(0.6, 0.85, rl)) * voiced;
  if (round + wide > 1) { const k = 1 / (round + wide); round *= k; wide *= k; }

  let open = Math.pow(clamp01((level - 0.06) / 0.8), 0.8);
  open *= (1 - 0.35 * wide) * (1 - 0.25 * round) * (1 - 0.5 * smoothstep(0.3, 0.6, rs));

  // Сомкнутые губы.
  let closed = 0;
  if (level > 0.12) st.sinceVoiceMs = 0;
  else if (Number.isFinite(st.sinceVoiceMs)) st.sinceVoiceMs += dtMs;
  if (level <= 0.12 && st.sinceVoiceMs < 600) closed = Math.max(closed, 1 - level / 0.12);          // пауза после речи
  if (level > 0.08 && level < 0.5 && rl > 0.8 && rh + rs < 0.06) closed = Math.max(closed, 0.7);     // «м-м» (носовые)
  if (level - st.prevLevel > 0.45 && st.prevLevel < 0.15) closed = Math.max(closed, 0.5);            // взрывные Б/П
  st.prevLevel = level;
  open *= 1 - 0.8 * closed;

  return { open: clamp01(open), round: clamp01(round), wide: clamp01(wide), closed: clamp01(closed), level };
}

const ease = (prev: number, target: number, dtMs: number, attackMs: number, releaseMs: number) => {
  const tau = target > prev ? attackMs : releaseMs;
  return prev + (target - prev) * (1 - Math.exp(-dtMs / tau));
};

/** Сглаживание атака/отпускание по каналам; форма губ — медленнее (коартикуляция). */
export function smoothFrame(prev: MouthFrame, target: MouthFrame, dtMs: number, attackMs = 30, releaseMs = 80): MouthFrame {
  const dt = Math.max(0, dtMs);
  let round = ease(prev.round, target.round, dt, attackMs * 1.5, releaseMs * 1.35);
  let wide = ease(prev.wide, target.wide, dt, attackMs * 1.5, releaseMs * 1.35);
  if (round + wide > 1) { const k = 1 / (round + wide); round *= k; wide *= k; }
  return {
    // Смыкание губ (пауза, М/Б/П) закрывает челюсть быстрее обычного отпускания.
    open: clamp01(ease(prev.open, target.open, dt, attackMs, releaseMs * (1 - 0.4 * clamp01(target.closed)))),
    round: clamp01(round),
    wide: clamp01(wide),
    closed: clamp01(ease(prev.closed, target.closed, dt, attackMs * 0.75, releaseMs * 0.9)),
    level: clamp01(ease(prev.level, target.level, dt, attackMs, releaseMs)),
  };
}

/** Один шаг липсинка по звуку: признаки → сглаженный кадр (сохраняется в st.frame). */
export function lipSyncStep(st: LipSyncState, f: AudioFeatures, dtMs: number): MouthFrame {
  st.frame = smoothFrame(st.frame, targetFrame(f, st, dtMs), dtMs);
  return st.frame;
}

/** Шаг к произвольной цели (синтетический липсинк без звука). */
export function easeTo(st: LipSyncState, target: MouthFrame, dtMs: number): MouthFrame {
  st.frame = smoothFrame(st.frame, target, dtMs);
  return st.frame;
}

// ——— Синтетический липсинк по тексту (Web Speech без доступа к звуку, режим субтитров) ———

const V = (open: number, round = 0, wide = 0, closed = 0): MouthFrame => ({ open, round, wide, closed, level: Math.max(open, 0.25) });
const VISEME: Record<string, MouthFrame> = {};
const put = (chars: string, f: MouthFrame) => { for (const c of chars) VISEME[c] = f; };
put('аяәa', V(0.9));
put('оөёo', V(0.6, 0.8));
put('уұүюu', V(0.3, 1));
put('эеeэ', V(0.55, 0, 0.7));
put('иіийi', V(0.4, 0, 0.9));
put('ыy', V(0.4, 0, 0.45));
put('мбпmbp', V(0, 0, 0, 1));
put('вфvfw', V(0.1, 0, 0.2, 0.45));
put('шжщчsz', V(0.2, 0.35, 0.3));

/** Целевой кадр для символа текста. Пробел/знаки — пауза, прочие согласные — полуоткрытый рот. */
export function charViseme(ch: string | undefined): MouthFrame {
  if (!ch) return SILENT;
  const c = ch.toLowerCase();
  const v = VISEME[c];
  if (v) return v;
  if (/[\p{L}\p{N}]/u.test(c)) return V(0.22, 0, 0.1);
  return SILENT;
}

/**
 * Кадр по позиции в тексте (дробный индекс символа): смешение соседних визем + лёгкое
 * «дрожание» челюсти, чтобы движение не было механическим. t — время, мс.
 */
export function textFrame(text: string, charPos: number, t: number): MouthFrame {
  if (charPos < 0 || charPos >= text.length) return SILENT;
  const i = Math.floor(charPos), k = charPos - i;
  const a = charViseme(text[i]), b = charViseme(text[i + 1]);
  const mix = (x: number, y: number) => x + (y - x) * k;
  const jitter = 0.88 + 0.12 * Math.sin(t / 47) * Math.sin(t / 131);
  return {
    open: clamp01(mix(a.open, b.open) * jitter),
    round: mix(a.round, b.round),
    wide: mix(a.wide, b.wide),
    closed: mix(a.closed, b.closed),
    level: clamp01(mix(a.level, b.level) * jitter),
  };
}

// ——— Офлайн-таймлайн визем по декодированному звуку ———

/** Каналы кадра в таймлайне (порядок в Float32Array). */
const CH = 5; // open, round, wide, closed, level

export interface LipTimeline {
  /** Кадров в секунду. */
  fps: number;
  /** Время (с, от начала звука) первого кадра; отрицательное — губы готовятся до звука. */
  t0: number;
  /** Число кадров. */
  length: number;
  /** Кадры подряд: [open, round, wide, closed, level] × length. */
  data: Float32Array;
}

export interface TimelineOptions {
  /** Кадров в секунду (по умолчанию 100). */
  fps?: number;
  /** Опережение губ относительно звука, мс (по умолчанию 60). */
  leadMs?: number;
  /** Атака / отпускание сглаживания, мс. */
  attackMs?: number;
  releaseMs?: number;
}

interface FftPlan { n: number; rev: Uint32Array; cos: Float64Array; sin: Float64Array; win: Float64Array }
const plans = new Map<number, FftPlan>();
function fftPlan(n: number): FftPlan {
  let p = plans.get(n);
  if (p) return p;
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), win = new Float64Array(n);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)); // Ханн
  p = { n, rev, cos, sin, win };
  plans.set(n, p);
  return p;
}

/** Итеративное БПФ радикс-2 на месте. */
function fft(re: Float64Array, im: Float64Array, p: FftPlan) {
  const n = p.n;
  for (let i = 0; i < n; i++) {
    const j = p.rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size) {
      for (let k = 0; k < half; k++) {
        const wr = p.cos[k * step], wi = p.sin[k * step];
        const a = s + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

/** Признаки звука для окна с центром в сэмпле c (как у анализатора, но без его задержки). */
function windowFeatures(x: Float32Array, c: number, sr: number, p: FftPlan, re: Float64Array, im: Float64Array): AudioFeatures {
  const n = p.n, start = Math.round(c - n / 2);
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const j = start + i;
    const v = j >= 0 && j < x.length ? x[j] : 0;
    s2 += v * v;
    re[i] = v * p.win[i];
    im[i] = 0;
  }
  const rms = Math.sqrt(s2 / n);
  if (rms < 1e-5) return { rms: 0, low: 0, mid: 0, high: 0, sib: 0 };
  fft(re, im, p);
  const binHz = sr / n;
  const band = ([lo, hi]: [number, number]) => {
    const a = Math.max(1, Math.floor(lo / binHz)), b = Math.min(n / 2 - 1, Math.ceil(hi / binHz));
    let s = 0;
    for (let k = a; k <= b; k++) s += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    return b >= a ? s / (b - a + 1) : 0;
  };
  return { rms, low: band(BANDS.low), mid: band(BANDS.mid), high: band(BANDS.high), sib: band(BANDS.sib) };
}

/**
 * Построить таймлайн визем по сэмплам (моно, −1..1) — чистая функция.
 * Громкость нормируется по 90-му перцентилю RMS звучащих окон всей фразы (стабильнее «плавающего» пика),
 * затем — те же эвристики формы губ, что и в реальном времени, сглаживание атака/отпускание
 * и опережение leadMs: кадр в момент t показывает звук в момент t + lead.
 */
export function buildLipTimeline(input: Float32Array, rate: number, opts: TimelineOptions = {}): LipTimeline {
  // 44,1/48 кГц → вдвое реже (полосы липсинка — до 8 кГц): вдвое меньше работы БПФ.
  let samples = input, sampleRate = rate;
  if (rate >= 32000) {
    samples = new Float32Array(input.length >> 1);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.5 * (input[2 * i] + input[2 * i + 1]);
    sampleRate = rate / 2;
  }
  const fps = opts.fps ?? 100, lead = (opts.leadMs ?? 60) / 1000;
  const attack = opts.attackMs ?? 30, release = opts.releaseMs ?? 80;
  let n = 256;
  while (n < sampleRate * 0.023) n <<= 1; // ~23 мс: 512 при 22 кГц, 1024 при 44,1/48 кГц
  const p = fftPlan(n);
  const re = new Float64Array(n), im = new Float64Array(n);
  const dur = samples.length / sampleRate;
  const t0 = -lead;
  // Хвост после конца звука — чтобы рот успел закрыться по таймлайну.
  const length = Math.max(1, Math.ceil((dur + lead + 0.25) * fps));
  const feats: AudioFeatures[] = new Array(length);
  for (let k = 0; k < length; k++) feats[k] = windowFeatures(samples, (t0 + k / fps + lead) * sampleRate, sampleRate, p, re, im);

  const voiced = feats.map(f => f.rms).filter(r => r >= NOISE_GATE).sort((a, b) => a - b);
  const peak = Math.max(PEAK_FLOOR, voiced.length ? voiced[Math.min(voiced.length - 1, Math.floor(voiced.length * 0.9))] : 0);

  const dt = 1000 / fps;
  const st = createLipSync();
  const data = new Float32Array(length * CH);
  let prev: MouthFrame = { ...SILENT };
  for (let k = 0; k < length; k++) {
    const target = targetFrame(feats[k], st, dt, peak);
    prev = smoothFrame(prev, target, dt, attack, release);
    const o = k * CH;
    data[o] = prev.open; data[o + 1] = prev.round; data[o + 2] = prev.wide; data[o + 3] = prev.closed; data[o + 4] = prev.level;
  }
  return { fps, t0, length, data };
}

/** Кадр таймлайна в момент t (с, по часам звука; 0 — начало буфера), линейная интерполяция. */
export function sampleTimeline(tl: LipTimeline, t: number): MouthFrame {
  const x = (t - tl.t0) * tl.fps;
  if (!(x >= 0) || x > tl.length - 1) return { ...SILENT };
  const i = Math.floor(x), k = x - i, j = Math.min(tl.length - 1, i + 1);
  const a = i * CH, b = j * CH, d = tl.data;
  const m = (c: number) => d[a + c] + (d[b + c] - d[a + c]) * k;
  return { open: m(0), round: m(1), wide: m(2), closed: m(3), level: m(4) };
}
