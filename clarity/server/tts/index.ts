// Синтез речи на сервере: Piper-голоса (VITS) через sherpa-onnx (Apache-2.0).
// Синтез синхронный и тяжёлый для CPU → по одному worker_threads-потоку на язык
// (ленивая загрузка при первом запросе), очередь заданий, перезапуск при падении,
// LRU-кэш готовых WAV и склейка одинаковых одновременных запросов.

import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import type { Lang } from '../../shared/i18n';
import { config } from '../config';
import { normalizeForTts } from './normalize';
import { encodeWav, postprocess } from './wav';

export { normalizeForTts } from './normalize';

export interface TtsStatus { available: boolean; voices: Lang[]; engine: string }

interface VoiceDef { lang: Lang; dir: string; model: string; sid: number; speed: number; noiseScale: number; noiseScaleW: number }

const num = (v: string | undefined, d: number) => (v !== undefined && v.trim() !== '' && Number.isFinite(+v) ? +v : d);

/**
 * Голоса. Казахский: модель ISSAI (6 дикторов), по умолчанию sid 2 = ISSAI_KazakhTTS2_F3 —
 * женский голос (медиана F0 ≈ 216 Гц), см. docs/VOICES.md. Переопределение: TTS_KK_SPEAKER.
 */
export const VOICES: Record<Lang, VoiceDef> = {
  ru: {
    lang: 'ru', dir: 'vits-piper-ru_RU-irina-medium', model: 'ru_RU-irina-medium.onnx', sid: 0,
    speed: num(process.env.TTS_RU_SPEED, 1.0), noiseScale: 0.6, noiseScaleW: 0.7,
  },
  kk: {
    lang: 'kk', dir: 'vits-piper-kk_KZ-issai-high', model: 'kk_KZ-issai-high.onnx', sid: num(process.env.TTS_KK_SPEAKER, 2),
    speed: num(process.env.TTS_KK_SPEED, 1.0), noiseScale: 0.6, noiseScaleW: 0.7,
  },
};

const LANGS = Object.keys(VOICES) as Lang[];
// Сколько запрос ждёт синтеза (включая очередь); дольше — отдаём 503, клиент переходит на запасной голос.
const JOB_TIMEOUT_MS = num(process.env.TTS_TIMEOUT_MS, 45_000);
// 2 потока на голос: на 2–4 ядрах это лучший компромисс (ru и kk могут работать одновременно).
const THREADS = Math.max(1, Math.min(4, num(process.env.TTS_THREADS, Math.floor(os.cpus().length / 2) || 1)));

const voicePaths = (v: VoiceDef) => {
  const dir = path.join(config.voicesDir, v.dir);
  return { model: path.join(dir, v.model), tokens: path.join(dir, 'tokens.txt'), dataDir: path.join(dir, 'espeak-ng-data') };
};
const filesPresent = (v: VoiceDef) => Object.values(voicePaths(v)).every(p => existsSync(p));

let addonOk: boolean | null = null;
function addonAvailable(): boolean {
  if (addonOk === null) {
    // Нативный модуль — optionalDependency под платформу (sherpa-onnx-linux-x64, -darwin-arm64, …).
    const req = createRequire(import.meta.url);
    const plat = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
    try { req.resolve('sherpa-onnx-node'); req.resolve(`sherpa-onnx-${plat}/package.json`); addonOk = true; } catch { addonOk = false; }
  }
  return addonOk;
}

// ---------- Поток синтеза ----------

/**
 * Задание очереди. Ожидающий получает ответ не позже дедлайна (иначе null → клиент
 * перейдёт на запасной голос), но уже начатый синтез не прерываем: terminate() во время
 * нативного вызова роняет весь процесс (Napi::Error). Готовый результат всё равно
 * попадает в кэш через onResult.
 */
interface Job {
  id: number; text: string; waiting: boolean;
  resolve: (b: Buffer | null) => void; reject: (e: Error) => void; onResult?: (b: Buffer) => void;
  timer: NodeJS.Timeout;
}

class VoiceWorker {
  private worker: Worker | null = null;
  private loaded = false;
  private queue: Job[] = [];
  private current: Job | null = null;
  private seq = 0;
  private crashes: number[] = [];
  /** Модель не загружается (битые файлы и т. п.) — голос недоступен до этого момента. */
  brokenUntil = 0;

  constructor(private readonly voice: VoiceDef) {}

  run(text: string, onResult?: (b: Buffer) => void): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      // Первая загрузка модели занимает секунды — даём таймаут с запасом.
      const ms = JOB_TIMEOUT_MS * (this.loaded ? 1 : 2);
      const job: Job = {
        id: ++this.seq, text, waiting: true, resolve, reject, onResult,
        timer: setTimeout(() => {
          if (!job.waiting) return;
          job.waiting = false;
          console.error(`[tts] ${this.voice.lang}: синтез не уложился в ${ms} мс`);
          resolve(null);
        }, ms),
      };
      this.queue.push(job);
      this.pump();
    });
  }

  private settle(job: Job, fn: () => void) {
    clearTimeout(job.timer);
    if (!job.waiting) return;
    job.waiting = false;
    fn();
  }

  private spawn(): Worker {
    const p = voicePaths(this.voice);
    const w = new Worker(new URL('./worker.mjs', import.meta.url), {
      workerData: {
        config: {
          model: {
            vits: { model: p.model, tokens: p.tokens, dataDir: p.dataDir, noiseScale: this.voice.noiseScale, noiseScaleW: this.voice.noiseScaleW, lengthScale: 1 },
            numThreads: THREADS, provider: 'cpu', debug: 0,
          },
          maxNumSentences: 1,
        },
      },
    });
    this.loaded = false;
    w.on('message', (m: { ready?: boolean; fatal?: string; id?: number; samples?: Float32Array; sampleRate?: number; error?: string }) => {
      if (m.ready) { this.loaded = true; return; }
      if (m.fatal) {
        console.error(`[tts] ${this.voice.lang}: модель не загрузилась: ${m.fatal}`);
        this.brokenUntil = Date.now() + 5 * 60_000;
        return; // дальше придёт exit
      }
      const job = this.current;
      if (!job || m.id !== job.id) return;
      this.current = null;
      if (m.error || !m.samples || !m.sampleRate) {
        const err = new Error(m.error ?? 'пустой ответ синтеза');
        this.settle(job, () => job.reject(err));
      } else if (m.samples.length === 0) {
        this.settle(job, () => job.resolve(null));
      } else {
        const wav = encodeWav(postprocess(m.samples, m.sampleRate), m.sampleRate);
        job.onResult?.(wav);
        this.settle(job, () => job.resolve(wav));
      }
      this.pump();
    });
    w.on('error', e => console.error(`[tts] ${this.voice.lang}: ошибка потока: ${e.message}`));
    w.on('exit', code => {
      if (this.worker !== w) return;
      this.worker = null;
      this.loaded = false;
      const job = this.current;
      this.current = null;
      if (code !== 0) {
        const now = Date.now();
        this.crashes = [...this.crashes.filter(t => now - t < 60_000), now];
        if (this.crashes.length >= 3) this.brokenUntil = Math.max(this.brokenUntil, now + 60_000);
      }
      if (job) this.settle(job, () => job.reject(new Error(`поток синтеза завершился (код ${code})`)));
      if (Date.now() < this.brokenUntil) this.failAll(new Error('голос временно недоступен'));
      else this.pump(); // перезапуск потока при следующем задании
    });
    return w;
  }

  private failAll(e: Error) {
    const q = this.queue;
    this.queue = [];
    for (const j of q) this.settle(j, () => j.reject(e));
  }

  private pump() {
    if (this.current) return;
    // Задания, которых уже никто не ждёт, не синтезируем.
    while (this.queue.length && !this.queue[0].waiting) this.queue.shift();
    if (!this.queue.length) { this.worker?.unref(); return; }
    if (Date.now() < this.brokenUntil) { this.failAll(new Error('голос временно недоступен')); return; }
    if (!this.worker) this.worker = this.spawn();
    this.worker.ref();
    const job = this.queue.shift()!;
    this.current = job;
    this.worker.postMessage({ id: job.id, text: job.text, sid: this.voice.sid, speed: this.voice.speed });
  }

  /** Останавливает поток; идущий нативный синтез дожидаемся (terminate посреди него роняет процесс). */
  async stop() {
    this.failAll(new Error('синтез остановлен'));
    const started = Date.now();
    while (this.current && Date.now() - started < 120_000) await new Promise(r => setTimeout(r, 50));
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }
}

const workers = new Map<Lang, VoiceWorker>();
const workerFor = (lang: Lang) => {
  let w = workers.get(lang);
  if (!w) workers.set(lang, (w = new VoiceWorker(VOICES[lang])));
  return w;
};

// ---------- LRU-кэш ----------

const CACHE_MAX = 300;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const cache = new Map<string, Buffer>();
let cacheBytes = 0;
const inflight = new Map<string, Promise<Buffer | null>>();

function cacheGet(key: string): Buffer | undefined {
  const v = cache.get(key);
  if (v) { cache.delete(key); cache.set(key, v); }
  return v;
}
function cachePut(key: string, buf: Buffer) {
  if (cache.has(key)) { cacheBytes -= cache.get(key)!.length; cache.delete(key); }
  cache.set(key, buf);
  cacheBytes += buf.length;
  while (cache.size > CACHE_MAX || cacheBytes > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next().value as string;
    cacheBytes -= cache.get(oldest)!.length;
    cache.delete(oldest);
  }
}

// ---------- Публичный API ----------

function voiceReady(lang: Lang): boolean {
  const v = VOICES[lang];
  return Boolean(v) && config.ttsEnabled && addonAvailable() && filesPresent(v) && Date.now() >= (workers.get(lang)?.brokenUntil ?? 0);
}

/** WAV (PCM 16 бит, моно) или null, если голос для языка недоступен. */
export async function synthesize(text: string, lang: Lang): Promise<Buffer | null> {
  if (!voiceReady(lang)) return null;
  const clean = normalizeForTts(text.slice(0, 800), lang);
  if (!clean || !/[\p{L}\p{N}]/u.test(clean)) return null;
  const key = `${lang}\u0000${clean}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = workerFor(lang).run(clean, buf => cachePut(key, buf))
    .catch(e => { console.error(`[tts] ${lang}: ${e instanceof Error ? e.message : e}`); return null; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function ttsStatus(): TtsStatus {
  const voices = LANGS.filter(voiceReady);
  return { available: voices.length > 0, voices, engine: 'piper/sherpa-onnx' };
}

/** Останавливает потоки синтеза (тесты, корректное завершение). */
export async function shutdownTts(): Promise<void> {
  await Promise.all([...workers.values()].map(w => w.stop()));
  workers.clear();
}

/** Очистка кэша (для замеров и тестов). */
export function clearTtsCache(): void {
  cache.clear();
  cacheBytes = 0;
}

/**
 * Прогрев: загружает модели заранее (холодный старт kk ≈ 3–28 с в зависимости от нагрузки CPU).
 * Вызывать после старта сервера, не дожидаясь: `void warmupTts()`.
 */
export async function warmupTts(langs: Lang[] = LANGS): Promise<void> {
  const phrase: Record<Lang, string> = { ru: 'Здравствуйте.', kk: 'Сәлеметсіз бе.' };
  await Promise.all(langs.filter(voiceReady).map(l => synthesize(phrase[l], l)));
}

// Автопрогрев при старте сервера (неблокирующий: модели грузятся в потоках-воркерах).
// Выполняется через 2 с после импорта модуля, т. е. уже после app.listen. Не в тестах;
// выключается TTS_PRELOAD=false.
if (process.env.TTS_PRELOAD !== 'false' && !process.env.VITEST && process.env.NODE_ENV !== 'test') {
  setTimeout(() => {
    const t = Date.now();
    void warmupTts().then(() => {
      const ready = LANGS.filter(voiceReady);
      if (ready.length) console.log(`[tts] голоса прогреты (${ready.join(', ')}) за ${Date.now() - t} мс`);
    });
  }, 2000).unref();
}
