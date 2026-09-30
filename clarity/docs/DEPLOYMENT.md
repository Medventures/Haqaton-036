# Развёртывание

Clarity — один Node.js-процесс: он отдаёт API и собранный фронтенд. Внешняя зависимость только одна — OpenAI-совместимый LLM API, и она опциональна.

## Docker (рекомендуется)

```bash
docker compose up --build        # или: npm run docker:up
```

Открыть http://localhost:8787. `.env` необязателен (подхватывается, если есть). Проверки типов и тесты в образе включаются аргументом `--build-arg RUN_CHECKS=true`. Полное руководство — [DOCKER.md](DOCKER.md).

## Без Docker

```bash
npm ci
npm run build
HOST=0.0.0.0 PORT=8787 STAFF_TOKEN=... LLM_API_KEY=... npm start
```

Для постоянной работы — systemd или pm2, перед ними reverse-proxy (nginx/Caddy) с HTTPS. HTTPS **обязателен** для микрофона: браузеры дают доступ к нему только на защищённых страницах.

Пример Caddy:

```text
clarity.example.kz {
  reverse_proxy 127.0.0.1:8787
}
```

## Вход через Google

1. [Google Cloud Console](https://console.cloud.google.com/) → создайте проект → **APIs & Services → OAuth consent screen**: тип *External*, название «Clarity», e-mail поддержки. Scopes: `openid`, `email`, `profile`.
2. **Credentials → Create credentials → OAuth client ID** → *Web application*.
3. **Authorized JavaScript origins:** `https://ваш-домен` (для локальной разработки — `http://localhost:5173`).
4. **Authorized redirect URIs:** `https://ваш-домен/api/auth/google/callback` (локально — `http://localhost:5173/api/auth/google/callback`).
5. Скопируйте Client ID и Client secret в `.env`:
   ```
   PUBLIC_URL=https://ваш-домен
   GOOGLE_CLIENT_ID=....apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   STAFF_EMAILS=doctor@clinic.kz,coordinator@clinic.kz
   ```
6. Перезапустите сервер. Кнопка «Войти через Google» станет активной. Аккаунты из `STAFF_EMAILS` попадают в рабочее место клиники, остальные регистрируются как пациенты и проходят знакомство.

Безопасность: Authorization Code + PKCE (S256), `state` и `nonce`, проверка `iss`/`aud`/`exp`/`email_verified`. Сессия хранится в httpOnly-cookie с `SameSite=Lax` (`Secure` на https), в базе лежит только SHA-256 хэш токена. Изменяющие запросы требуют заголовок `x-clarity` (защита от CSRF).

## Переменные окружения

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-совместимый endpoint |
| `LLM_MODEL` | `meta-llama/llama-3.3-70b-instruct` | Открытая модель |
| `LLM_PROVIDER_SORT` | `latency` | OpenRouter: провайдер с минимальной задержкой |
| `PUBLIC_URL` | `http://localhost:5173` | Публичный адрес (redirect URI Google, флаг Secure у cookie) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | OAuth-клиент Google |
| `STAFF_EMAILS` | — | Google-аккаунты сотрудников через запятую |
| `DEMO_LOGIN` | `true` | Демо-вход и перемотка времени. В пилоте — `false` |
| `SESSION_DAYS` | `14` | Срок жизни сессии |
| `LLM_API_KEY` | — | Ключ; пусто — режим правил |
| `LLM_NO_AUTH` | `false` | `true` для своего vLLM/Ollama без ключа |
| `LLM_TIMEOUT_MS` | `30000` | Таймаут запроса к модели |
| `PORT` / `API_PORT` | `8787` | Порт (в dev `API_PORT` фиксирует порт API) |
| `HOST` | `127.0.0.1` | Адрес прослушивания (в Docker `0.0.0.0`) |
| `STAFF_TOKEN` | — | Сервисный доступ к `/api/staff/*` и `/api/metrics` без входа (заголовок `x-staff-token`), например для интеграций |
| `DATA_FILE` | `server/data/db.json` | Путь к файлу данных |

## Чек-лист перед пилотом (не для хакатона)

- [ ] Заменить JSON-хранилище на PostgreSQL (интерфейс в `server/store.ts`), настроить бэкапы.
- [x] Вход через Google, роли «пациент/сотрудник», серверные сессии.
- [ ] Журнал аудита действий сотрудников, SSO клиники при необходимости.
- [ ] `DEMO_LOGIN=false` — выключает демо-вход, перемотку времени и сброс данных.
- [ ] LLM — в согласованной юрисдикции или на собственном GPU-сервере (vLLM + Qwen2.5/Llama 3.x).
- [ ] STT — Whisper/Vosk на сервере вместо браузерного распознавания.
- [ ] Канал SMS/WhatsApp — через адаптер в `services.deliverDue`.
- [ ] Клиническое утверждение протокола, базы знаний и словаря с версиями.

## Демо-стенд

Публичное демо: https://mabida.tj (Docker за nginx с HTTPS от Let’s Encrypt; приложение слушает только 127.0.0.1, nginx проксирует домен на контейнер).
