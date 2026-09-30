#!/usr/bin/env node
// Скачивает Piper-голоса (VITS, sherpa-onnx) в server/models/tts/ (или VOICES_DIR).
// Идемпотентно: если каталог модели уже есть и в нём есть .onnx — пропускаем.
// Использование: node scripts/download-voices.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(process.env.VOICES_DIR || join(root, 'server/models/tts'));
const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

// Только эти два голоса одобрены к загрузке.
const VOICES = ['vits-piper-ru_RU-irina-medium', 'vits-piper-kk_KZ-issai-high'];

function duSize(p) {
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  return readdirSync(p).reduce((s, f) => s + duSize(join(p, f)), 0);
}
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

mkdirSync(dir, { recursive: true });
let failed = false;
for (const name of VOICES) {
  const target = join(dir, name);
  const ready = existsSync(target) && readdirSync(target).some((f) => f.endsWith('.onnx'));
  if (ready) {
    console.log(`✓ ${name} уже есть (${mb(duSize(target))})`);
    continue;
  }
  const archive = join(dir, `${name}.tar.bz2`);
  try {
    console.log(`↓ ${name} …`);
    execFileSync('curl', ['-fL', '--retry', '3', '-o', archive, `${BASE}/${name}.tar.bz2`], { stdio: 'inherit' });
    console.log(`  архив ${mb(statSync(archive).size)}, распаковка…`);
    execFileSync('tar', ['-xjf', archive, '-C', dir], { stdio: 'inherit' });
    rmSync(archive, { force: true });
    console.log(`✓ ${name} (${mb(duSize(target))})`);
  } catch (e) {
    failed = true;
    rmSync(archive, { force: true });
    console.error(`✗ ${name}: ${e instanceof Error ? e.message : e}`);
  }
}
console.log(`Каталог голосов: ${dir}`);
process.exit(failed ? 1 : 0);
