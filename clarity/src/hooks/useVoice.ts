// Голосовой движок Clarity.
// • TTS: серверный синтез Piper (/api/tts) по фразам с предзагрузкой следующей фразы, воспроизведение
//   через общий AudioContext: источник → Gain → Analyser → динамики. Липсинк — по реальному звуку:
//   после декодирования фразы строится офлайн-таймлайн визем (buildLipTimeline, с опережением ~60 мс),
//   при воспроизведении кадр берётся по аудиочасам (audioClock учитывает задержку вывода).
//   AnalyserNode — запасной путь, если таймлайн построить не удалось.
// • preparing — реплика принята, а первая фраза ещё синтезируется: UI показывает «думает…».
//   Первая фраза укорачивается (splitFirstChunk), чтобы звук начинался быстрее.
// • Запасные пути: сервер недоступен (503/401/сеть; помним ~60 с на язык) → Web Speech API браузера
//   с голосом нужного языка; голоса нет (частый случай для казахского) или voice=false → режим
//   субтитров: рот «говорит» синтетически по тексту (~14 символов/с), onEnd всё равно вызывается.
// • onEnd — ровно один раз по завершении всей реплики; при stopSpeaking()/новом speak() НЕ вызывается.
// • STT: SpeechRecognition с языком STT_LANG[lang] (kk-KZ работает в Chrome). В Chrome аудио
//   обрабатывается серверами Google, поэтому микрофон включается только после предупреждения (UI).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STT_LANG, type Lang } from '../../shared/i18n';
import { translate } from '../i18n';
import { SILENT, type ListenOptions, type MouthFrame, type SpeakOptions, type VoiceApi } from '../voice/types';
import { CHARS_PER_SEC, estimateMs, speechParts, type SpeechPart } from '../voice/text';
import { buildLipTimeline, createLipSync, easeTo, lipSyncStep, sampleTimeline, textFrame, type LipTimeline } from '../voice/lipsync';
import {
  audioClock, audioSupported, fetchTts, installAudioUnlock, isAbort, markServerTtsDown, pickVoice, readFeatures,
  RecognitionCtor, resumeAudio, serverTtsDown, speechSynthesisSupported, TtsError, type AudioChain, type Rec,
} from '../voice/engine';

/** Чем сейчас «управляется» рот. */
type Drive =
  | { kind: 'idle' }
  | { kind: 'audio' }
  | { kind: 'timeline'; tl: LipTimeline; ctx: AudioContext; start: number }
  | { kind: 'text'; text: string; start: number; cps: number; bChar: number; bAt: number; bLen: number };

const MOUTH_STATE_MS = 83; // ~12 Гц для простых потребителей
/** Запуск фразы с небольшим запасом: точное время старта известно, губы успевают «подготовиться». */
const START_DELAY_S = 0.06;

/** Декодированная фраза + таймлайн визем (null — считать по анализатору). */
interface Clip { buf: AudioBuffer; tl: LipTimeline | null }

function timelineOf(buf: AudioBuffer): LipTimeline | null {
  try { return buildLipTimeline(buf.getChannelData(0), buf.sampleRate); } catch { return null; }
}

/** Позиция (дробный индекс символа) в тексте для синтетического липсинка. */
function charPos(d: Extract<Drive, { kind: 'text' }>, now: number): number {
  if (d.bAt > 0) {
    // Есть события границ слов (Web Speech): двигаемся внутри текущего слова.
    // После конца слова (пробел) рот смыкается, пока движок не сообщит о следующем слове.
    const sp = d.text.indexOf(' ', d.bChar);
    const wordEnd = d.bLen > 0 ? d.bChar + d.bLen : sp >= 0 ? sp : d.text.length;
    return Math.min(d.bChar + ((now - d.bAt) / 1000) * d.cps, wordEnd);
  }
  const p = ((now - d.start) / 1000) * d.cps;
  // Реплика звучит дольше оценки (голос браузера без событий) — продолжаем «говорить» по кругу.
  return p < d.text.length ? p : p % Math.max(1, d.text.length);
}

export function useVoice(): VoiceApi {
  const [speaking, setSpeaking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [caption, setCaption] = useState('');
  const [mouth, setMouth] = useState(0);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');

  const token = useRef(0);                              // отменяет устаревшие реплики
  const abortRef = useRef<AbortController | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const wakeRef = useRef<(() => void) | null>(null);   // «разбудить» текущее ожидание при остановке
  const usedWebSpeech = useRef(false);
  const drive = useRef<Drive>({ kind: 'idle' });
  const lip = useRef(createLipSync());
  const frame = useRef<MouthFrame>(SILENT);
  const recRef = useRef<Rec | null>(null);

  const ttsSupported = audioSupported() || speechSynthesisSupported();
  const sttSupported = Boolean(RecognitionCtor());

  useEffect(() => {
    installAudioUnlock();
    if (!speechSynthesisSupported()) return;
    speechSynthesis.getVoices();
    const h = () => speechSynthesis.getVoices();
    speechSynthesis.addEventListener?.('voiceschanged', h);
    return () => speechSynthesis.removeEventListener?.('voiceschanged', h);
  }, []);

  // Единый цикл requestAnimationFrame, пока идёт речь: кадр рта пишется в ref (без React-состояния
  // на каждый кадр), упрощённое «mouth» — в состояние с частотой ~12 Гц.
  useEffect(() => {
    if (!speaking) {
      frame.current = SILENT;
      lip.current = createLipSync();
      setMouth(0);
      return;
    }
    let raf = 0, last = performance.now(), lastPush = 0, lastVal = -1;
    const tick = (now: number) => {
      const dt = Math.min(100, Math.max(1, now - last));
      last = now;
      const d = drive.current;
      let f: MouthFrame;
      if (d.kind === 'timeline') {
        // Кадр по аудиочасам: без задержки анализатора, губы чуть опережают звук.
        f = sampleTimeline(d.tl, audioClock(d.ctx) - d.start);
        lip.current.frame = f;
      } else if (d.kind === 'audio') {
        const feats = readFeatures();
        f = feats ? lipSyncStep(lip.current, feats, dt) : easeTo(lip.current, SILENT, dt);
      } else if (d.kind === 'text') {
        f = easeTo(lip.current, textFrame(d.text, charPos(d, now), now), dt);
      } else {
        f = easeTo(lip.current, SILENT, dt);
      }
      frame.current = f;
      if (now - lastPush >= MOUTH_STATE_MS) {
        lastPush = now;
        const v = Math.round(f.open * 50) / 50;
        if (v !== lastVal) { lastVal = v; setMouth(v); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speaking]);

  /** Прервать всё текущее воспроизведение (без onEnd). */
  const halt = useCallback(() => {
    token.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    const src = sourceRef.current;
    sourceRef.current = null;
    if (src) { src.onended = null; try { src.stop(); } catch { /* уже остановлен */ } }
    if (usedWebSpeech.current && speechSynthesisSupported()) { speechSynthesis.cancel(); usedWebSpeech.current = false; }
    const wake = wakeRef.current;
    wakeRef.current = null;
    wake?.();
    drive.current = { kind: 'idle' };
  }, []);

  const stopSpeaking = useCallback(() => {
    halt();
    setSpeaking(false);
    setPreparing(false);
    setCaption('');
  }, [halt]);

  /** Ожидание, которое можно прервать через halt(). */
  const sleep = useCallback((ms: number) => new Promise<void>(resolve => {
    const t = window.setTimeout(() => { if (wakeRef.current === done) wakeRef.current = null; resolve(); }, ms);
    const done = () => { window.clearTimeout(t); resolve(); };
    wakeRef.current = done;
  }), []);

  /** Проиграть декодированный буфер; промис завершается по окончании (или по страховочному таймеру). */
  const playBuffer = useCallback((c: AudioChain, clip: Clip) => new Promise<void>(resolve => {
    const { buf, tl } = clip;
    const src = c.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(c.gain);
    const when = c.ctx.currentTime + START_DELAY_S;
    drive.current = tl ? { kind: 'timeline', tl, ctx: c.ctx, start: when } : { kind: 'audio' };
    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(watchdog);
      if (sourceRef.current === src) sourceRef.current = null;
      if (wakeRef.current === end) wakeRef.current = null;
      resolve();
    };
    const watchdog = window.setTimeout(end, (buf.duration + START_DELAY_S) * 1000 + 2000);
    src.onended = end;
    sourceRef.current = src;
    wakeRef.current = end;
    src.start(when);
  }), []);

  /**
   * Серверный синтез: фраза i играет, фраза i+1 уже загружается (конвейер без пауз).
   * Возвращает индекс первой непрозвучавшей фразы (parts.length — всё прозвучало) или −1 при отмене.
   */
  const playServer = useCallback(async (parts: SpeechPart[], lang: Lang, my: number): Promise<number> => {
    const c = await resumeAudio();
    if (my !== token.current) return -1;
    if (!c) return 0; // автозапуск звука заблокирован — запасной путь (без отметки «сервер недоступен»)
    const ac = new AbortController();
    abortRef.current = ac;
    // Таймлайн визем строится сразу после декодирования — пока играет предыдущая фраза.
    const load = (i: number): Promise<Clip> => {
      const p = fetchTts(parts[i].say, lang, ac.signal, c.ctx, i === 0 ? 20000 : 15000)
        .then(buf => ({ buf, tl: timelineOf(buf) }));
      p.catch(() => undefined); // ошибку обработаем, когда дойдём до этой фразы
      return p;
    };
    let next = load(0);
    for (let i = 0; i < parts.length; i++) {
      let clip: Clip;
      try {
        clip = await next;
      } catch (e) {
        if (my !== token.current || isAbort(e)) return -1;
        if (!(e instanceof TtsError) || e.cacheable) markServerTtsDown(lang);
        return i;
      }
      if (my !== token.current) return -1;
      if (i + 1 < parts.length) next = load(i + 1);
      setCaption(parts[i].caption);
      setPreparing(false);
      await playBuffer(c, clip);
      if (my !== token.current) return -1;
      drive.current = { kind: 'idle' };
    }
    if (abortRef.current === ac) abortRef.current = null;
    return parts.length;
  }, [playBuffer]);

  /** Web Speech API: по фразе на utterance (Chrome обрывает длинные реплики ~15 с). */
  const playBrowser = useCallback(async (parts: SpeechPart[], lang: Lang, voice: SpeechSynthesisVoice, rate: number, my: number) => {
    usedWebSpeech.current = true;
    for (const part of parts) {
      if (my !== token.current) return;
      await new Promise<void>(resolve => {
        const u = new SpeechSynthesisUtterance(part.say);
        u.lang = STT_LANG[lang];
        u.voice = voice;
        u.rate = rate;
        u.pitch = 1.05;
        let finished = false;
        const end = () => {
          if (finished) return;
          finished = true;
          window.clearTimeout(watchdog);
          if (wakeRef.current === end) wakeRef.current = null;
          resolve();
        };
        u.onstart = () => {
          if (my !== token.current) return;
          setCaption(part.caption);
          drive.current = { kind: 'text', text: part.say, start: performance.now(), cps: CHARS_PER_SEC * rate, bChar: 0, bAt: 0, bLen: 0 };
        };
        u.onboundary = (e: SpeechSynthesisEvent) => {
          const d = drive.current;
          if (d.kind !== 'text' || e.name === 'sentence') return;
          d.bChar = e.charIndex;
          d.bAt = performance.now();
          d.bLen = e.charLength ?? 0;
        };
        u.onend = end;
        u.onerror = end;
        // Страховка от «зависшего» onend.
        const watchdog = window.setTimeout(end, 3000 + part.say.length * 110);
        wakeRef.current = end;
        speechSynthesis.speak(u);
      });
      drive.current = { kind: 'idle' };
    }
  }, []);

  /** Режим субтитров: без звука, рот анимируется по тексту. */
  const playCaptions = useCallback(async (parts: SpeechPart[], my: number) => {
    for (const part of parts) {
      if (my !== token.current) return;
      setCaption(part.caption);
      drive.current = { kind: 'text', text: part.say, start: performance.now(), cps: CHARS_PER_SEC, bChar: 0, bAt: 0, bLen: 0 };
      await sleep(estimateMs(part.say) + 250);
      drive.current = { kind: 'idle' };
    }
  }, [sleep]);

  const speak = useCallback((text: string, opts: SpeakOptions) => {
    halt();
    const my = token.current;
    const lang = opts.lang;
    const parts = speechParts(text, lang);
    if (!parts.length) { setSpeaking(false); setPreparing(false); setCaption(''); opts.onEnd?.(); return; }
    const server = opts.voice && !serverTtsDown(lang) && audioSupported();
    setSpeaking(true);
    setPreparing(server);
    let ended = false;
    const finish = () => {
      if (ended || my !== token.current) return;
      ended = true;
      drive.current = { kind: 'idle' };
      setSpeaking(false);
      setPreparing(false);
      setCaption('');
      opts.onEnd?.();
    };
    const run = async () => {
      let from = 0;
      if (server) {
        from = await playServer(parts, lang, my);
        if (from < 0 || my !== token.current) return;
        setPreparing(false);
      }
      if (from < parts.length) {
        const rest = parts.slice(from);
        const voice = opts.voice ? pickVoice(lang) : null;
        if (voice) await playBrowser(rest, lang, voice, opts.rate ?? 1.02, my);
        else await playCaptions(rest, my);
      }
      finish();
    };
    run().catch(() => finish());
  }, [halt, playServer, playBrowser, playCaptions]);

  const getMouthFrame = useCallback((): MouthFrame => frame.current, []);

  /** Слушать одну фразу. onNoSpeech — пользователь промолчал. */
  const listen = useCallback((onFinal: (text: string) => void, opts: ListenOptions) => {
    const lang = opts.lang;
    const Ctor = RecognitionCtor();
    if (!Ctor) { opts.onError?.(translate(lang, 'voice.sttUnsupported')); return; }
    stopSpeaking();
    const prev = recRef.current;
    recRef.current = null;
    if (prev) { prev.onend = null; prev.onerror = null; prev.onresult = null; prev.abort(); }
    const rec = new Ctor();
    rec.lang = STT_LANG[lang];
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    let heard = false;
    let errored = false;
    rec.onspeechstart = () => { heard = true; };
    rec.onresult = e => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) {
        t += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = t;
      }
      heard = true;
      setInterim(t);
    };
    rec.onerror = e => {
      errored = true;
      if (e.error === 'no-speech') { opts.onNoSpeech?.(); return; }
      if (e.error === 'aborted') return;
      const key = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'micDenied'
        : e.error === 'network' ? 'network'
          : e.error === 'audio-capture' ? 'noMic'
            : e.error === 'language-not-supported' ? 'sttLangUnsupported'
              : 'failed';
      opts.onError?.(translate(lang, `voice.${key}`));
    };
    rec.onend = () => {
      if (recRef.current !== rec) return; // распознавание уже заменено новым
      recRef.current = null;
      setListening(false);
      setInterim('');
      const t = finalText.trim();
      if (t) onFinal(t);
      else if (!errored && !heard) opts.onNoSpeech?.();
    };
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { recRef.current = null; setListening(false); opts.onError?.(translate(lang, 'voice.micBusy')); }
  }, [stopSpeaking]);

  const stopListening = useCallback(() => { recRef.current?.stop(); }, []);
  const abortListening = useCallback(() => {
    const r = recRef.current;
    recRef.current = null;
    if (r) { r.onend = null; r.onerror = null; r.onresult = null; r.abort(); }
    setListening(false);
    setInterim('');
  }, []);

  useEffect(() => () => { halt(); recRef.current?.abort(); }, [halt]);

  return useMemo<VoiceApi>(() => ({
    speak, stopSpeaking, speaking, preparing, caption, mouth, getMouthFrame,
    listen, stopListening, abortListening, listening, interim, ttsSupported, sttSupported,
  }), [speak, stopSpeaking, speaking, preparing, caption, mouth, getMouthFrame, listen, stopListening, abortListening, listening, interim, ttsSupported, sttSupported]);
}
