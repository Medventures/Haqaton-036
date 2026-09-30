// PCM float32 → WAV (RIFF, PCM 16 бит, моно).

export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);          // размер fmt-чанка
  buf.writeUInt16LE(1, 20);           // PCM
  buf.writeUInt16LE(1, 22);           // моно
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byteRate
  buf.writeUInt16LE(2, 32);           // blockAlign
  buf.writeUInt16LE(16, 34);          // бит на сэмпл
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return buf;
}

/** Разбор заголовка WAV (для тестов и проверки). */
export function parseWavHeader(buf: Buffer): { sampleRate: number; channels: number; bits: number; dataBytes: number; durationSec: number } | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  const sampleRate = buf.readUInt32LE(24), channels = buf.readUInt16LE(22), bits = buf.readUInt16LE(34), dataBytes = buf.readUInt32LE(40);
  return { sampleRate, channels, bits, dataBytes, durationSec: dataBytes / (sampleRate * channels * (bits / 8)) };
}

/**
 * Обрезка тишины по краям (оставляем ~60 мс) и выравнивание громкости по пику:
 * у голосов ISSAI разный уровень (0.12…0.6) — для липсинка и комфорта слушателя
 * приводим к пику ≈ 0.9 (усиление не более ×4).
 */
export function postprocess(samples: Float32Array, sampleRate: number): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 1e-4) return samples;
  const thr = peak * 0.02, pad = Math.round(0.06 * sampleRate);
  let a = 0, b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < thr) a++;
  while (b > a && Math.abs(samples[b]) < thr) b--;
  const out = samples.slice(Math.max(0, a - pad), Math.min(samples.length, b + pad + 1));
  const gain = Math.min(4, 0.9 / peak);
  if (Math.abs(gain - 1) > 0.02) for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}
