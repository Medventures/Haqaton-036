// Минимальная загрузка .env без зависимостей (переменные окружения имеют приоритет).
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(process.cwd(), '.env');
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
