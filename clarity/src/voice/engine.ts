// Низкоуровневая часть голосового движка: общий AudioContext, загрузка серверного синтеза
// (Piper через /api/tts), отрицательный кэш недоступности, помощники Web Speech API.

import { STT_LANG, type Lang } from '../../shared/i18n';
import { api } from '../api';
import { extractFeatures, type AudioFeatures } from './lipsync';

// ——— AudioContext: один на приложение, создаётся лениво ———

export interface AudioChain {
  ctx: AudioContext;
  gain: GainNode;
  analyser: AnalyserNode;
  time: Float32Array<ArrayBuffer>;
  freq: Float32Array<ArrayBuffer>;
}

let chain: AudioChain | null = null;

type CtxCtor = new () => AudioContext;
function ctxCtor(): CtxCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: CtxCtor; webkitAudioContext?: CtxCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export const audioSupported = () => Boolean(ctxCtor());

/** Источник → Gain → Analyser → динамики. Анализатор читает липсинк. */
export function audioChain(): AudioChain | null {
  if (chain) return chain;
  const Ctor = ctxCtor();
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.25;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -10;
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    chain = {
      ctx, gain, analyser,
      time: new Float32Array(new ArrayBuffer(analyser.fftSize * 4)),
      freq: new Float32Array(new ArrayBuffer(analyser.frequencyBinCount * 4)),
    };
    return chain;
  } catch {
    return null;
  }
}

/** Признаки звука для липсинка из текущего кадра анализатора. */
export function readFeatures(): AudioFeatures | null {
  if (!chain) return null;
  const { analyser, time, freq, ctx } = chain;
  analyser.getFloatTimeDomainData(time);
  analyser.getFloatFrequencyData(freq);
  return extractFeatures(time, freq, ctx.sampleRate, analyser.fftSize);
}

/**
 * Время звука, который СЕЙЧАС слышен из динамиков (с, в шкале ctx.currentTime).
 * getOutputTimestamp() учитывает задержку вывода и позволяет экстраполировать между
 * «ступеньками» currentTime (аудиопоток обновляет его блоками); запасной путь — currentTime
 * минус outputLatency/baseLatency.
 */
export function audioClock(ctx: AudioContext, nowMs = performance.now()): number {
  const cur = ctx.currentTime;
  try {
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime && ts.performanceTime) {
      const t = ts.contextTime + (nowMs - ts.performanceTime) / 1000;
      if (t <= cur + 0.05 && t > cur - 0.5) return t;
    }
  } catch { /* старые браузеры */ }
  const lat = (ctx as AudioContext & { outputLatency?: number }).outputLatency || ctx.baseLatency || 0;
  return cur - lat;
}

/** Возобновить контекст (политики автозапуска; iOS Safari). Ждём не дольше timeoutMs. */
export async function resumeAudio(timeoutMs = 500): Promise<AudioChain | null> {
  const c = audioChain();
  if (!c) return null;
  if (c.ctx.state !== 'running') {
    try {
      await Promise.race([c.ctx.resume(), new Promise(r => setTimeout(r, timeoutMs))]);
    } catch { /* ignore */ }
  }
  return c.ctx.state === 'running' ? c : null;
}

let unlockInstalled = false;
/** Разблокировать звук при первом жесте пользователя (Safari/iOS требуют жест). */
export function installAudioUnlock() {
  if (unlockInstalled || typeof window === 'undefined' || !audioSupported()) return;
  unlockInstalled = true;
  const unlock = () => {
    const c = audioChain();
    if (!c) return;
    void c.ctx.resume().catch(() => undefined);
    try { // короткий беззвучный буфер «прогревает» вывод на iOS
      const src = c.ctx.createBufferSource();
      src.buffer = c.ctx.createBuffer(1, 1, 22050);
      src.connect(c.ctx.destination);
      src.start(0);
    } catch { /* ignore */ }
    if (c.ctx.state === 'running') {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchend', unlock, true);
    }
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('touchend', unlock, true);
}

// ——— Серверный синтез ———

export class TtsError extends Error {
  constructor(message: string, public status = 0, public cacheable = true) { super(message); }
}

const downUntil: Partial<Record<Lang, number>> = {};
const DOWN_MS = 60_000;

export const serverTtsDown = (lang: Lang) => (downUntil[lang] ?? 0) > Date.now();
export const markServerTtsDown = (lang: Lang, ms = DOWN_MS) => { downUntil[lang] = Date.now() + ms; };

export const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';

function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    // Старый Safari поддерживает только колбэки, новые браузеры — промис; берём первое.
    const p = ctx.decodeAudioData(data, resolve, err => reject(err ?? new Error('decode')));
    if (p && typeof (p as Promise<AudioBuffer>).then === 'function') (p as Promise<AudioBuffer>).then(resolve, reject);
  });
}

/**
 * Синтезировать фразу на сервере и декодировать. Ошибки:
 *  • 503/401/403/404/5xx/сеть/декодирование → TtsError (cacheable: язык временно «недоступен»);
 *  • 400/413/429/таймаут → TtsError (cacheable=false: только эта реплика уходит в запасной режим).
 */
export async function fetchTts(text: string, lang: Lang, signal: AbortSignal, ctx: AudioContext, timeoutMs = 15000): Promise<AudioBuffer> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new TtsError('timeout', 0, false)), timeoutMs); });
  const work = (async () => {
    let r: Response;
    try {
      r = await fetch(api.ttsUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-clarity': '1' },
        credentials: 'same-origin',
        body: JSON.stringify({ text, lang }),
        signal,
      });
    } catch (e) {
      if (isAbort(e)) throw e;
      throw new TtsError('network', 0, true);
    }
    if (!r.ok) throw new TtsError(`http ${r.status}`, r.status, ![400, 413, 429].includes(r.status));
    const type = r.headers.get('content-type') ?? '';
    if (type && !/audio|octet-stream/.test(type)) throw new TtsError(`bad content-type ${type}`, r.status, true);
    const data = await r.arrayBuffer();
    try { return await decode(ctx, data); } catch { throw new TtsError('decode', r.status, true); }
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

// ——— Web Speech API (запасной путь) ———

const PREFER: Record<Lang, string[]> = {
  ru: ['Milena (Enhanced)', 'Milena (Premium)', 'Google русский', 'Microsoft Svetlana Online', 'Microsoft Dariya Online', 'Milena', 'Katya', 'Microsoft Irina', 'Alena'],
  kk: ['Microsoft Aigul Online', 'Aigul', 'Microsoft Daulet Online', 'Daulet', 'Google қазақ', 'Kazakh'],
};

export const speechSynthesisSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Лучший голос браузера для языка; null — голоса нет (частый случай для казахского). */
export function pickVoice(lang: Lang): SpeechSynthesisVoice | null {
  if (!speechSynthesisSupported()) return null;
  const code = STT_LANG[lang].toLowerCase();
  const prefix = code.slice(0, 2);
  const voices = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().replace('_', '-').startsWith(prefix));
  for (const name of PREFER[lang]) { const v = voices.find(x => x.name.includes(name)); if (v) return v; }
  return voices.find(v => v.lang.toLowerCase().replace('_', '-') === code) ?? voices[0] ?? null;
}

export type Rec = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
};

export const RecognitionCtor = (): (new () => Rec) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
