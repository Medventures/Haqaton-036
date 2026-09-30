# Clarity в Docker

Одна команда — и у вас полное приложение: API, собранный фронтенд и серверные голоса Piper (ru, kk).

```bash
docker compose up --build        # или: npm run docker:up
```

Откройте **http://localhost:8787** и войдите через демо-вход (без аккаунта). Остановить: `Ctrl+C` или `docker compose down` (`npm run docker:down`).

`.env` не нужен: без него ассистент работает в режиме правил (все сценарии доступны), демо-вход включён.
Если `.env` есть — он подхватывается автоматически (см. «Настройка»).

## Требования

| | |
|---|---|
| Docker | Docker Desktop (macOS/Windows) или Docker Engine ≥ 23 (Linux) — BuildKit включён по умолчанию |
| Docker Compose | **≥ 2.24** (`docker compose version`) — нужен необязательный `env_file` (`required: false`) |
| Память | **≥ 2 ГБ** для контейнера (рекомендуется 4 ГБ): модели синтеза речи грузятся в память |
| Диск | ≈ 0.7–1 ГБ под образ (≈ 220 МБ — голоса, ≈ 280 МБ — node_modules) + кэш сборки |
| Сеть при сборке | npm registry и GitHub (голоса ≈ 190 МБ из релиза `tts-models` k2-fsa/sherpa-onnx) |

Архитектуры: **linux/amd64** и **linux/arm64**. На Apple Silicon образ собирается нативно под arm64 —
Rosetta и `platform: linux/amd64` не нужны (под эмуляцией синтез речи будет очень медленным).

## Что происходит при сборке

Многоэтапный `Dockerfile` на `node:20-bookworm-slim`:

1. **build** — `npm ci` (со всеми зависимостями) → `npm run build` (фронтенд в `dist/`).
   Typecheck и тесты по умолчанию не запускаются (они идут в CI), включить: `RUN_CHECKS=true` (ниже).
2. **voices** — `scripts/download-voices.mjs` скачивает и распаковывает голоса. Слой зависит только
   от этого скрипта, поэтому правки кода голоса **не перекачивают**.
3. **runtime** — `npm ci --omit=dev --include=optional` (в optional-зависимостях нативный
   `sherpa-onnx-linux-<arch>`; сборка проверяет, что он загружается), код `server/` + `shared/`,
   `dist/`, голоса. Процесс — `node --import tsx server/index.ts` от пользователя `node` (не root),
   данные — в томе `/data`, `HEALTHCHECK` опрашивает `/api/health`.

Первая сборка занимает несколько минут (в основном — скачивание голосов и `npm ci`). Повторные
быстрее: пересобираются только слои с изменившимся кодом (`npm ci` — только при смене
`package*.json`, голоса — только при смене скрипта).

## Настройка (.env)

Все переменные приложения описаны в [`.env.example`](../.env.example) и [DEPLOYMENT.md](DEPLOYMENT.md).
Для Docker обычно нужны только эти:

| Переменная | Зачем |
|---|---|
| `LLM_API_KEY` (+ `LLM_BASE_URL`, `LLM_MODEL`) | живые ответы модели; пусто — режим правил |
| `STAFF_TOKEN` | защита консоли координатора и `/api/metrics` (заголовок `x-staff-token`) |
| `DEMO_LOGIN` | `false` — выключить демо-вход, перемотку времени и сброс данных |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `STAFF_EMAILS` | вход через Google |
| `TTS_ENABLED`, `TTS_KK_SPEAKER`, `TTS_THREADS` … | озвучка, см. [VOICES.md](VOICES.md) |

```bash
cp .env.example .env    # заполните нужное
docker compose up -d --build --force-recreate
```

После правки `.env` достаточно `docker compose up -d --force-recreate` (без пересборки).

**Эти значения задаёт `docker-compose.yml`, из `.env` они не берутся** (в `.env` лежат настройки
локальной разработки — например, `HOST=127.0.0.1` сделал бы контейнер недоступным):
`HOST=0.0.0.0`, `PORT=8787`, `API_PORT=8787`, `DATA_FILE=/data/db.json`,
`VOICES_DIR=/app/server/models/tts`, `PUBLIC_URL` (из `CLARITY_PUBLIC_URL`, см. ниже).

Переменные только для Docker (в `.env` или в оболочке перед командой):

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `CLARITY_PORT` | `8787` | порт на хосте |
| `CLARITY_BIND` | `127.0.0.1` | адрес на хосте; `0.0.0.0` — открыть в локальную сеть |
| `CLARITY_PUBLIC_URL` | `http://localhost:8787` | публичный адрес → `PUBLIC_URL` в контейнере (redirect URI Google, флаг `Secure` у cookie). `PUBLIC_URL` из `.env` не используется: там адрес dev-сервера vite (`:5173`) |

Вход через Google в Docker: в Google Cloud Console добавьте redirect URI
`http://localhost:8787/api/auth/google/callback` (или `${CLARITY_PUBLIC_URL}/api/auth/google/callback`).

## Порты и данные

- Порт: `127.0.0.1:8787` на хосте → `8787` в контейнере. По умолчанию доступен только с этой машины.
- Данные: именованный том `clarity-data` → `/data/db.json` (переживает пересборки и `docker compose down`).
- Резервная копия: `docker compose cp clarity:/data/db.json ./db-backup.json`.
- Логи: `docker compose logs -f clarity`. Состояние: `docker compose ps` (колонка `STATUS` → `healthy`).
- Проверка: `curl http://localhost:8787/api/health` — `tts.voices` должно быть `["ru","kk"]`,
  `llm.configured` — `true`, только если задан ключ.

## Обновление

```bash
git pull
docker compose up -d --build
```

Данные в томе сохраняются. Голоса перекачиваются, только если изменился `scripts/download-voices.mjs`.

## Сброс

```bash
docker compose down -v     # удаляет контейнер И том clarity-data — все данные будут потеряны
docker compose up --build  # чистая демо-база создаётся заново
```

## Параметры сборки

```bash
# Строгая сборка, как в CI: typecheck + тесты перед build (тесты синтеза без голосов пропускаются)
docker compose build --build-arg RUN_CHECKS=true && docker compose up -d

# Без голосов (нет доступа к GitHub, экономия ≈ 190 МБ): /api/tts → 503, клиент перейдёт
# на голос браузера или субтитры
docker compose build --build-arg DOWNLOAD_VOICES=false && docker compose up -d

# За корпоративным прокси
docker compose build --build-arg HTTPS_PROXY=http://proxy:3128 --build-arg HTTP_PROXY=http://proxy:3128
```

Образ под несколько архитектур (например, для реестра):

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t registry.example.kz/clarity:2.0.0 --push .
```

Этапы `build` и `voices` выполняются на платформе сборщика (результат не зависит от архитектуры),
под эмуляцией собирается только `runtime`.

## Без Compose

```bash
docker build -t clarity .
docker run --rm -p 127.0.0.1:8787:8787 -v clarity-data:/data clarity
# с .env: добавьте --env-file .env и те же переопределения, что делает compose (-e важнее --env-file):
#   -e HOST=0.0.0.0 -e PORT=8787 -e API_PORT=8787 -e PUBLIC_URL=http://localhost:8787 \
#   -e DATA_FILE=/data/db.json -e VOICES_DIR=/app/server/models/tts
```

## Решение проблем

| Симптом | Причина и решение |
|---|---|
| Ошибка разбора `env_file` (например, `services.clarity.env_file.0 must be a string`) | Compose старее 2.24. Обновите Docker Desktop / плагин compose. Временно: `touch .env` и замените блок `env_file:` на `env_file: .env` |
| `the --mount option requires BuildKit` или ошибка про `--platform=` | Старый сборщик без BuildKit. Обновите Docker или соберите с `DOCKER_BUILDKIT=1` |
| `port is already allocated` | Порт 8787 занят (например, `npm run dev`). `CLARITY_PORT=8788 docker compose up --build` (для входа через Google — ещё `CLARITY_PUBLIC_URL=http://localhost:8788`) |
| Сборка падает на `download-voices` (`curl: (6)`/`(28)`) | Нет доступа к github.com. Повторите, задайте прокси (выше) или `--build-arg DOWNLOAD_VOICES=false` |
| Контейнер перезапускается, `exit code 137`, в логах тишина на синтезе | Не хватает памяти. Docker Desktop → Settings → Resources → Memory ≥ 2 ГБ (лучше 4). Или `TTS_ENABLED=false` в `.env` |
| Первая фраза озвучивается долго | Модели прогреваются ≈ через 2 с после старта (`TTS_PRELOAD`); первая казахская фраза на медленном CPU — до десятков секунд, дальше быстрее и из кэша. Первые ~30 с статус может быть `health: starting` |
| `tts.available: false` в `/api/health` | Образ собран с `DOWNLOAD_VOICES=false` (пересоберите без него: `docker compose up -d --build`) или в `.env` стоит `TTS_ENABLED=false` |
| Сайт не открывается с телефона/другого ПК | По умолчанию порт слушает только `127.0.0.1`. `CLARITY_BIND=0.0.0.0` — но только в доверенной сети и с `STAFF_TOKEN`, `DEMO_LOGIN=false`. Микрофон браузеры дают только на `localhost` или по HTTPS — используйте reverse-proxy с TLS ([DEPLOYMENT.md](DEPLOYMENT.md)) |
| Значение из `.env` с символом `$` искажено | Compose подставляет `$VAR` в `env_file`. Возьмите значение в одинарные кавычки: `KEY='a$b'` |
| `EACCES` на `/data` при bind-mount папки хоста вместо тома | Процесс работает под uid 1000: `sudo chown -R 1000:1000 ./data` |
| Ошибка `sherpa-onnx addon not loaded` при сборке | Неподдерживаемая платформа (не amd64/arm64) или базовый образ сменён на alpine/bullseye: нужен glibc ≥ 2.32 (bookworm) |
