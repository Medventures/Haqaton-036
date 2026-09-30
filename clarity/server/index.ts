import './env';
import { buildApp } from './app';
import { config, llmConfigured } from './config';
import { getDb } from './store';

getDb();
const app = buildApp();
app.listen({ port: config.port, host: config.host }).then(() => {
  app.log.info(`Clarity API: http://${config.host}:${config.port}`);
  app.log.info(llmConfigured() ? `LLM: ${config.llmModel} @ ${new URL(config.llmBaseUrl).host}` : 'LLM не настроена (LLM_API_KEY пуст) — ассистент работает в режиме правил');
}).catch(err => { app.log.error(err); process.exit(1); });

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { app.close().then(() => process.exit(0)); });
