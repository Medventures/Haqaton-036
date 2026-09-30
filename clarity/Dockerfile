# syntax=docker/dockerfile:1
#
# Clarity — один контейнер: API (Fastify, запускается через tsx) + собранный фронтенд + голоса Piper.
# Быстрый старт: `docker compose up --build` → http://localhost:8787  (подробно: docs/DOCKER.md)
#
# Базовый образ — Debian bookworm (glibc 2.36), не alpine и не bullseye:
#   готовый нативный модуль sherpa-onnx-linux-x64 требует GLIBC_2.32 / GLIBCXX_3.4.29,
#   sherpa-onnx-linux-arm64 — GLIBC_2.17; под musl (alpine) модуль не загружается.
# Платформы: linux/amd64 и linux/arm64 (Apple Silicon, Graviton) — у sherpa-onnx есть готовые
# сборки для обеих, компилятор не нужен.
#
# Аргументы сборки:
#   RUN_CHECKS=true       — перед сборкой прогнать `npm run typecheck` и `npm test` (как в CI)
#   DOWNLOAD_VOICES=false — не скачивать голоса (~190 МБ); озвучка будет недоступна (/api/tts → 503)

ARG NODE_IMAGE=node:20-bookworm-slim

# ---------- 1. build: зависимости (вкл. dev) + сборка фронтенда в dist/ ----------
# dist/ не зависит от архитектуры → собираем на платформе сборщика (без эмуляции при buildx).
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --include=optional
COPY . .
ARG RUN_CHECKS=false
RUN if [ "$RUN_CHECKS" = "true" ]; then npm run typecheck && npm test; else echo "RUN_CHECKS=false: typecheck/tests skipped (они идут в CI)"; fi
RUN npm run build

# ---------- 2. voices: Piper-модели для sherpa-onnx (не зависят от архитектуры) ----------
# Слой зависит только от scripts/download-voices.mjs → изменения кода не перекачивают голоса.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS voices
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl bzip2 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY scripts/download-voices.mjs ./download-voices.mjs
ARG DOWNLOAD_VOICES=true
# tar под root сохраняет владельца из архива (uid сборщика CI) → нормализуем: root-владелец, чтение для всех
# (в runtime процесс работает от пользователя node).
RUN mkdir -p /voices \
 && if [ "$DOWNLOAD_VOICES" = "true" ]; then VOICES_DIR=/voices node download-voices.mjs; \
    else echo "DOWNLOAD_VOICES=false: голоса не скачиваются, озвучка будет недоступна"; fi \
 && chown -R root:root /voices && chmod -R a+rX /voices

# ---------- 3. runtime ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    PUBLIC_URL=http://localhost:8787 \
    DATA_FILE=/data/db.json \
    VOICES_DIR=/app/server/models/tts \
    TTS_ENABLED=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
WORKDIR /app
RUN mkdir -p /data && chown node:node /data

# Голоса — отдельным слоем до кода: большой слой переиспользуется между сборками.
COPY --from=voices /voices ./server/models/tts

# Только production-зависимости. optionalDependencies не пропускаем: в них нативный
# sherpa-onnx-linux-<arch> (и @esbuild/linux-<arch> для tsx). Проверяем, что аддон грузится.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --include=optional \
 && node -e "const s=require('sherpa-onnx-node'); if(typeof s.OfflineTts!=='function') throw new Error('sherpa-onnx addon not loaded'); console.log('sherpa-onnx-node OK:', process.platform + '-' + process.arch)"

# Код сервера исполняется tsx (TypeScript без отдельной компиляции); tsconfig — те же настройки, что в dev.
COPY tsconfig.json ./
COPY shared ./shared
COPY server ./server
COPY --from=build /app/dist ./dist

USER node
VOLUME ["/data"]
EXPOSE 8787
# В slim-образе нет wget/curl — проверяем через fetch из Node.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# node — PID 1 и сам получает SIGTERM (в server/index.ts есть корректное завершение); без npx/обёрток.
CMD ["node", "--import", "tsx", "server/index.ts"]
