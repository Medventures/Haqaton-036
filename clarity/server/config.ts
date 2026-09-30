import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  dataFile: process.env.DATA_FILE ?? path.join(root, 'server', 'data', 'db.json'),
  distDir: path.join(root, 'dist'),
  // Любой OpenAI-совместимый API: OpenRouter, Together, Groq, DeepInfra,
  // собственный vLLM / llama.cpp server / Ollama (/v1). Модель — открытая.
  llmBaseUrl: (process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
  llmApiKey: process.env.LLM_API_KEY ?? '',
  llmModel: process.env.LLM_MODEL ?? 'meta-llama/llama-3.3-70b-instruct',
  // Для казахского: Llama 4 Maverick заметно грамотнее (проверено на тестовых репликах).
  llmModelKk: process.env.LLM_MODEL_KK ?? 'meta-llama/llama-4-maverick',
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 30_000),
  llmProviderSort: (process.env.LLM_PROVIDER_SORT ?? 'latency') as 'latency' | 'throughput' | 'price',
  timezone: 'Asia/Almaty',
  // Авторизация
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  staffEmails: (process.env.STAFF_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  // Демо-вход без аккаунта (для хакатона). В пилоте выключить: DEMO_LOGIN=false
  demoLogin: (process.env.DEMO_LOGIN ?? 'true') !== 'false',
  sessionDays: Number(process.env.SESSION_DAYS ?? 14),
  // Синтез речи (Piper-голоса через sherpa-onnx). Модели скачивает scripts/download-voices.mjs
  voicesDir: process.env.VOICES_DIR ?? path.join(root, 'server', 'models', 'tts'),
  ttsEnabled: (process.env.TTS_ENABLED ?? 'true') !== 'false',
};

export const googleConfigured = () => Boolean(config.googleClientId && config.googleClientSecret);

/** LLM включена, если задан ключ (или явно указан локальный сервер без ключа). */
export const llmConfigured = () => Boolean(config.llmApiKey) || process.env.LLM_NO_AUTH === 'true';
