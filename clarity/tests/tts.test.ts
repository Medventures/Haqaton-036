import { afterAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { normalizeForTts, numberToWordsKk, numberToWordsRu } from '../server/tts/normalize';
import { encodeWav, parseWavHeader } from '../server/tts/wav';
import { shutdownTts, synthesize, ttsStatus, VOICES } from '../server/tts';
import { config } from '../server/config';

describe('числа словами', () => {
  it('русский', () => {
    expect(numberToWordsRu(0)).toBe('ноль');
    expect(numberToWordsRu(21)).toBe('двадцать один');
    expect(numberToWordsRu(112)).toBe('сто двенадцать');
    expect(numberToWordsRu(2026)).toBe('две тысячи двадцать шесть');
    expect(numberToWordsRu(1000)).toBe('одна тысяча');
    expect(numberToWordsRu(9999)).toBe('девять тысяч девятьсот девяносто девять');
  });
  it('казахский', () => {
    expect(numberToWordsKk(0)).toBe('нөл');
    expect(numberToWordsKk(15)).toBe('он бес');
    expect(numberToWordsKk(80)).toBe('сексен');
    expect(numberToWordsKk(100)).toBe('жүз');
    expect(numberToWordsKk(245)).toBe('екі жүз қырық бес');
    expect(numberToWordsKk(2026)).toBe('екі мың жиырма алты');
    expect(numberToWordsKk(1000)).toBe('мың');
  });
});

describe('нормализация текста', () => {
  it('аббревиатуры', () => {
    expect(normalizeForTts('Перед МРТ и КТ проверим СКФ и рСКФ.', 'ru')).toBe('Перед эм-эр-тэ и ка-тэ проверим эс-ка-эф и эс-ка-эф.');
    expect(normalizeForTts('Я ИИ-помощник', 'ru')).toBe('Я и-и-помощник.');
    expect(normalizeForTts('Мен ЖИ көмекшісімін', 'kk')).toBe('Мен жи көмекшісімін.');
    expect(normalizeForTts('МРТ-ға дайындық', 'kk')).toBe('эм-эр-тэ-ға дайындық.');
    // Не трогаем буквы внутри слов.
    expect(normalizeForTts('МРТшка', 'ru')).toBe('МРТшка.');
  });
  it('эмодзи, разметка, кавычки, латиница', () => {
    expect(normalizeForTts('**Готово!** 🎉 «Green Clinic» ждёт вас', 'ru')).toBe('Готово! Грин Клиник ждёт вас.');
  });
  it('экстренные номера — поцифрово, лабораторные значения — числом', () => {
    expect(normalizeForTts('Звоните 103 или 112', 'ru')).toBe('Звоните один ноль три или один один два.');
    expect(normalizeForTts('103 не 112 нөміріне қоңырау шалыңыз', 'kk')).toBe('бір нөл үш не бір бір екі нөміріне қоңырау шалыңыз.');
    expect(normalizeForTts('Креатинин 112 мкмоль/л', 'ru')).toBe('Креатинин сто двенадцать микромоль на литр.');
    expect(normalizeForTts('Креатинин 80 мкмоль/л', 'kk')).toBe('Креатинин сексен микромоль литрге.');
  });
  it('время, даты, проценты, диапазоны, суффиксы', () => {
    expect(normalizeForTts('Приём в 14:30, приходите к 9:05', 'ru')).toBe('Приём в четырнадцать тридцать, приходите к девять ноль пять.');
    expect(normalizeForTts('Сағат 09:00', 'kk')).toBe('Сағат тоғыз нөл-нөл.');
    expect(normalizeForTts('Анализ от 25.09', 'ru')).toBe('Анализ от двадцать пять сентября.');
    expect(normalizeForTts('Готово на 50%', 'ru')).toBe('Готово на пятьдесят процентов.');
    expect(normalizeForTts('2 %', 'kk')).toBe('екі пайыз.');
    expect(normalizeForTts('за 2–3 дня', 'ru')).toBe('за два-три дня.');
    expect(normalizeForTts('80-нен жоғары', 'kk')).toBe('сексеннен жоғары.');
  });
});

describe('WAV', () => {
  it('корректный RIFF-заголовок', () => {
    const wav = encodeWav(new Float32Array(22050).fill(0.5), 22050);
    const h = parseWavHeader(wav)!;
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(h).toMatchObject({ sampleRate: 22050, channels: 1, bits: 16 });
    expect(h.durationSec).toBeCloseTo(1, 5);
  });
});

// Интеграционная часть — только если голоса скачаны (node scripts/download-voices.mjs).
const modelsPresent = (['ru', 'kk'] as const).every(l => existsSync(path.join(config.voicesDir, VOICES[l].dir, VOICES[l].model)));

describe.skipIf(!modelsPresent || !config.ttsEnabled)('синтез Piper (sherpa-onnx)', () => {
  afterAll(async () => { await shutdownTts(); }, 180_000);

  it('статус', () => {
    expect(ttsStatus()).toMatchObject({ available: true, engine: 'piper/sherpa-onnx' });
    expect(ttsStatus().voices).toEqual(expect.arrayContaining(['ru', 'kk']));
  });

  for (const [lang, text] of [['ru', 'Здравствуйте! Я помогу подготовиться к МРТ.'], ['kk', 'Сәлеметсіз бе! МРТ-ға дайындалуға көмектесемін.']] as const) {
    it(`${lang}: WAV, частота, длительность`, async () => {
      const wav = await synthesize(text, lang);
      expect(wav).not.toBeNull();
      const h = parseWavHeader(wav!)!;
      expect(h.sampleRate).toBe(22050);
      expect(h.channels).toBe(1);
      expect(h.durationSec).toBeGreaterThan(0.5);
      // Не тишина.
      let peak = 0;
      for (let i = 44; i < wav!.length; i += 2) peak = Math.max(peak, Math.abs(wav!.readInt16LE(i)));
      expect(peak).toBeGreaterThan(3000);
      // Повтор — из кэша, тот же буфер.
      expect(await synthesize(text, lang)).toBe(wav);
    }, 180_000);
  }
});
