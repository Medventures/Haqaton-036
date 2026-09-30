// Липсинк по звуку и текстовые помощники голосового модуля (чистые функции, без Web Audio).
import { describe, expect, it } from 'vitest';
import {
  bandLevel, buildLipTimeline, charViseme, createLipSync, extractFeatures, lipSyncStep, rmsOf, sampleTimeline, smoothFrame,
  targetFrame, textFrame, type AudioFeatures,
} from '../src/voice/lipsync';
import { SILENT } from '../src/voice/types';
import { estimateMs, sentences, speakable, speechParts, splitFirstChunk } from '../src/voice/text';

const silence: AudioFeatures = { rms: 0, low: 0, mid: 0, high: 0, sib: 0 };
const lowLoud: AudioFeatures = { rms: 0.3, low: 1, mid: 0.2, high: 0.05, sib: 0.01 };   // «О/У»
const wideLoud: AudioFeatures = { rms: 0.3, low: 0.3, mid: 0.5, high: 0.8, sib: 0.2 };  // «Э/И»
const run = (f: AudioFeatures, steps: number, st = createLipSync(), dt = 16) => {
  let fr = st.frame;
  for (let i = 0; i < steps; i++) fr = lipSyncStep(st, f, dt);
  return { st, fr };
};

describe('lipsync: звук → кадр рта', () => {
  it('тишина с самого начала → рот в покое', () => {
    const { fr } = run(silence, 30);
    expect(fr.open).toBe(0);
    expect(fr.level).toBe(0);
    expect(fr.round).toBe(0);
    expect(fr.wide).toBe(0);
    expect(fr.closed).toBe(0);
  });

  it('громкая низкая полоса → рот открыт и округлён (О/У)', () => {
    const { fr } = run(lowLoud, 40);
    expect(fr.open).toBeGreaterThan(0.5);
    expect(fr.round).toBeGreaterThan(0.5);
    expect(fr.wide).toBeLessThan(0.2);
    expect(fr.closed).toBeLessThan(0.1);
  });

  it('доминирует средне-высокая полоса → растянутые губы (Э/И)', () => {
    const { fr } = run(wideLoud, 40);
    expect(fr.wide).toBeGreaterThan(0.5);
    expect(fr.round).toBeLessThan(0.2);
    expect(fr.open).toBeGreaterThan(0.3);
  });

  it('тишина сразу после речи → губы смыкаются, рот закрывается', () => {
    const { st } = run(lowLoud, 30);
    const { fr } = run(silence, 20, st);
    expect(fr.closed).toBeGreaterThan(0.5);
    expect(fr.open).toBeLessThan(0.05);
  });

  it('носовой «м-м» (только низкие, негромко) → сомкнутые губы', () => {
    const st = createLipSync();
    run({ ...lowLoud, rms: 0.4 }, 10, st); // пик громкости
    const t = targetFrame({ rms: 0.1, low: 1, mid: 0.02, high: 0.005, sib: 0.001 }, st, 16);
    expect(t.closed).toBeGreaterThanOrEqual(0.7);
  });

  it('сглаживание монотонно: при постоянном звуке открытие растёт, в тишине — падает', () => {
    const st = createLipSync();
    let prev = 0;
    for (let i = 0; i < 25; i++) {
      const fr = lipSyncStep(st, lowLoud, 16);
      expect(fr.open).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = fr.open;
    }
    for (let i = 0; i < 25; i++) {
      const fr = lipSyncStep(st, silence, 16);
      expect(fr.open).toBeLessThanOrEqual(prev + 1e-9);
      prev = fr.open;
    }
    expect(prev).toBeLessThan(0.05);
  });

  it('атака быстрее отпускания', () => {
    const up = smoothFrame(SILENT, { ...SILENT, open: 1 }, 40);
    const down = smoothFrame({ ...SILENT, open: 1 }, SILENT, 40);
    expect(up.open).toBeGreaterThan(1 - down.open);
  });

  it('автонормировка: тихая запись открывает рот так же, как громкая', () => {
    const quiet = run({ ...lowLoud, rms: 0.05 }, 40).fr;
    const loud = run(lowLoud, 40).fr;
    expect(Math.abs(quiet.open - loud.open)).toBeLessThan(0.05);
  });

  it('признаки из спектра: полосы и RMS', () => {
    const sr = 48000, fft = 1024, bins = fft / 2;
    const freq = new Float32Array(bins).fill(-100);
    const binHz = sr / fft;
    for (let i = Math.floor(200 / binHz); i < Math.floor(600 / binHz); i++) freq[i] = -20;
    const time = new Float32Array(fft).map((_, i) => 0.5 * Math.sin(i / 5));
    const f = extractFeatures(time, freq, sr, fft);
    expect(f.low).toBeGreaterThan(f.high * 10);
    expect(rmsOf(time)).toBeCloseTo(0.5 / Math.SQRT2, 1);
    expect(bandLevel(freq, sr, fft, 3500, 8000)).toBeLessThan(0.001);
  });
});

describe('lipsync: офлайн-таймлайн по сэмплам', () => {
  const SR = 24000;
  /** Тишина с тональными всплесками [начало, конец, частота, амплитуда] (с, Гц). */
  const signal = (dur: number, bursts: [number, number, number, number][]) => {
    const x = new Float32Array(Math.round(dur * SR));
    for (const [a, b, hz, amp] of bursts) {
      for (let i = Math.round(a * SR); i < Math.round(b * SR) && i < x.length; i++) {
        const t = i / SR, env = Math.min(1, (t - a) / 0.005, (b - t) / 0.005); // мягкие края 5 мс
        x[i] += amp * env * Math.sin(2 * Math.PI * hz * t);
      }
    }
    return x;
  };

  it('тишина → рот закрыт весь таймлайн', () => {
    const tl = buildLipTimeline(new Float32Array(SR), SR);
    expect(tl.length).toBeGreaterThan(100);
    for (let t = -0.05; t < 1.2; t += 0.05) {
      const f = sampleTimeline(tl, t);
      expect(f.open).toBe(0);
      expect(f.level).toBe(0);
    }
  });

  it('300 Гц → рот открыт и округлён (О/У)', () => {
    const tl = buildLipTimeline(signal(1, [[0.2, 0.8, 300, 0.3]]), SR);
    const f = sampleTimeline(tl, 0.5);
    expect(f.open).toBeGreaterThan(0.5);
    expect(f.round).toBeGreaterThan(0.7);
    expect(f.wide).toBeLessThan(0.15);
    expect(f.closed).toBeLessThan(0.1);
  });

  it('2,5 кГц → растянутые губы (Э/И)', () => {
    const tl = buildLipTimeline(signal(1, [[0.2, 0.8, 2500, 0.3]]), SR);
    const f = sampleTimeline(tl, 0.5);
    expect(f.wide).toBeGreaterThan(0.7);
    expect(f.round).toBeLessThan(0.15);
    expect(f.open).toBeGreaterThan(0.3);
  });

  it('губы опережают звук (~60 мс) и смыкаются в паузе между словами и после фразы', () => {
    const tl = buildLipTimeline(signal(1.4, [[0.3, 0.6, 300, 0.3], [0.78, 1.0, 300, 0.3]]), SR);
    expect(sampleTimeline(tl, 0.15).open).toBeLessThan(0.02);       // задолго до звука — покой
    expect(sampleTimeline(tl, 0.28).open).toBeGreaterThan(0.3);     // за 20 мс до звука рот уже открывается
    const noLead = buildLipTimeline(signal(1.4, [[0.3, 0.6, 300, 0.3]]), SR, { leadMs: 0 });
    expect(sampleTimeline(noLead, 0.28).open).toBeLessThan(0.02);   // без опережения — ещё закрыт
    expect(sampleTimeline(tl, 0.7).open).toBeLessThan(0.1);         // пауза 180 мс — рот закрывается
    expect(sampleTimeline(tl, 0.7).closed).toBeGreaterThan(0.5);
    expect(sampleTimeline(tl, 1.25).open).toBeLessThan(0.02);       // после фразы — закрыт
    expect(sampleTimeline(tl, 5).open).toBe(0);                     // за пределами таймлайна — покой
  });

  it('громкость нормируется по фразе: тихая запись открывает рот почти как громкая', () => {
    const q = sampleTimeline(buildLipTimeline(signal(1, [[0.2, 0.8, 300, 0.06]]), SR), 0.5);
    const l = sampleTimeline(buildLipTimeline(signal(1, [[0.2, 0.8, 300, 0.4]]), SR), 0.5);
    expect(Math.abs(q.open - l.open)).toBeLessThan(0.05);
  });

  it('разные частоты дискретизации дают согласованный результат', () => {
    const a = sampleTimeline(buildLipTimeline(signal(1, [[0.2, 0.8, 300, 0.3]]), SR), 0.5);
    const x48 = new Float32Array(48000);
    for (let i = 0; i < x48.length; i++) { const t = i / 48000; if (t > 0.2 && t < 0.8) x48[i] = 0.3 * Math.sin(2 * Math.PI * 300 * t); }
    const b = sampleTimeline(buildLipTimeline(x48, 48000), 0.5);
    expect(Math.abs(a.open - b.open)).toBeLessThan(0.05);
    expect(Math.abs(a.round - b.round)).toBeLessThan(0.1);
  });
});

describe('lipsync: синтетический по тексту', () => {
  it('гласные дают свои формы, пауза — покой', () => {
    expect(charViseme('а').open).toBeGreaterThan(0.8);
    expect(charViseme('у').round).toBe(1);
    expect(charViseme('ү').round).toBe(1);
    expect(charViseme('и').wide).toBeGreaterThan(0.8);
    expect(charViseme('м').closed).toBe(1);
    expect(charViseme(' ')).toEqual(SILENT);
    expect(textFrame('ма', 5, 0)).toEqual(SILENT);
    expect(textFrame('ма', 1, 0).open).toBeGreaterThan(0.6);
  });
});

describe('текст для синтеза', () => {
  it('разбиение на фразы не рвёт десятичные числа и склеивает короткие', () => {
    expect(sentences('Креатинин 3.5 в норме. Хорошо!')).toEqual(['Креатинин 3.5 в норме. Хорошо!']);
    const long = 'Первое предложение довольно длинное, чтобы не склеиваться с другими фразами никак. Второе предложение тоже достаточно длинное для проверки разбиения текста. Третье.';
    const parts = sentences(long);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long);
    expect(parts[0].length).toBeLessThanOrEqual(90);
  });

  it('перевод строки — граница фразы, пустые куски выбрасываются', () => {
    expect(sentences('Привет\n\nКак дела?  \n …')).toEqual(['Привет Как дела?']);
    expect(sentences('')).toEqual([]);
  });

  it('очень длинная фраза режется по запятым', () => {
    const s = Array.from({ length: 30 }, (_, i) => `часть номер ${i}`).join(', ') + '.';
    const parts = sentences(s);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(280);
  });

  it('speakable: аббревиатуры, разметка, эмодзи — по языку', () => {
    expect(speakable('«МРТ» и КТ — **скоро** 🙂', 'ru')).toBe('эм-эр-тэ и ка-тэ, скоро');
    expect(speakable('ИИ-помощник: 80 мкмоль/л, 2–3 дня', 'ru')).toBe('И-И-помощник: 80 микромоль на литр, 2 до 3 дня');
    expect(speakable('ЖИ-көмекші: рСКФ 80 мкмоль/л', 'kk')).toBe('жи-көмекші: эс-ка-эф 80 микромоль литрге');
    expect(speakable('КТАЛОГ', 'ru')).toBe('КТАЛОГ');
  });

  it('speechParts: субтитры — исходный текст, озвучка — подготовленный', () => {
    const p = speechParts('Запись на МРТ подтверждена. 🙂', 'ru');
    expect(p).toEqual([{ caption: 'Запись на МРТ подтверждена.', say: 'Запись на эм-эр-тэ подтверждена.' }]);
    expect(speechParts('🙂 ***', 'kk')).toEqual([]);
  });

  it('первая фраза укорачивается для быстрого старта синтеза', () => {
    const long = 'Здравствуйте, я Аружан, ваш ИИ-помощник клиники, и сегодня я помогу вам записаться к врачу и подготовиться к визиту.';
    const [head, tail] = splitFirstChunk(long);
    expect(head.length).toBeLessThanOrEqual(80);
    expect(head.endsWith(',')).toBe(true);
    expect(`${head} ${tail}`).toBe(long);
    expect(splitFirstChunk('Коротко и ясно.')).toEqual(['Коротко и ясно.']);
    const parts = speechParts(`${long} Второе предложение.`, 'ru');
    expect(parts[0].caption.length).toBeLessThanOrEqual(80);
    expect(parts.map(p => p.caption).join(' ')).toBe(`${long} Второе предложение.`);
  });

  it('оценка длительности ~14 символов/с', () => {
    expect(estimateMs('а'.repeat(140))).toBe(10000);
    expect(estimateMs('да')).toBe(700);
  });
});
