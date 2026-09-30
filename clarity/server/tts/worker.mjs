// Поток синтеза (worker_threads): один на язык. Чистый JS (.mjs), чтобы одинаково
// работать под tsx (dev/prod) и в vitest без TS-загрузчика внутри воркера.
// Протокол: workerData = { config } (OfflineTtsConfig sherpa-onnx);
//   вход  { id, text, sid, speed }
//   выход { id, samples: Float32Array, sampleRate } | { id, error } | { ready, sampleRate, numSpeakers } | { fatal }
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let tts;
try {
  const sherpa = require('sherpa-onnx-node');
  tts = new sherpa.OfflineTts(workerData.config);
  parentPort.postMessage({ ready: true, sampleRate: tts.sampleRate, numSpeakers: tts.numSpeakers });
} catch (e) {
  parentPort.postMessage({ fatal: String(e && e.message ? e.message : e) });
  process.exit(1);
}

parentPort.on('message', msg => {
  const { id, text, sid, speed } = msg;
  try {
    const audio = tts.generate({ text, sid: sid ?? 0, speed: speed ?? 1, enableExternalBuffer: false });
    // Копия, чтобы передать без копирования (transfer) и не зависеть от внешнего буфера.
    const samples = new Float32Array(audio.samples);
    parentPort.postMessage({ id, samples, sampleRate: audio.sampleRate }, [samples.buffer]);
  } catch (e) {
    parentPort.postMessage({ id, error: String(e && e.message ? e.message : e) });
  }
});
