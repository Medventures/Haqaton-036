# Technical overview (v2)

## Stack (все компоненты open source)

| Слой | Выбор | Лицензия | Роль |
| --- | --- | --- | --- |
| UI | React 19 + TypeScript | MIT | Экран пациента, аватар, консоль, метрики |
| Сборка | Vite 6 | MIT | Dev-сервер с прокси `/api`, production build |
| Иконки | lucide-react | ISC | Интерфейс |
| API | Fastify 5 | MIT | HTTP API, раздача `dist/` в production |
| Валидация | zod 3 | MIT | Схемы всех входящих запросов |
| Запуск TS | tsx | MIT | Сервер без отдельной компиляции |
| Тесты | Vitest 4 | MIT | Домен + сквозной API (`app.inject`) |
| LLM | Любая открытая модель через OpenAI-совместимый API | зависит от модели (Qwen2.5 — Apache-2.0, Llama 3.3 — Llama Community) | Понимание речи, пересказ, ответы по базе знаний |
| Голос | Web Speech API браузера | — | TTS/STT. Для пилота — Whisper/Vosk |

## Модули сервера

```text
server/
  index.ts          запуск, .env, graceful shutdown
  app.ts            маршруты, zod, ошибки, STAFF_TOKEN, статика
  services.ts       все мутации состояния + события метрик + задачи координатора
  store.ts          JSON-хранилище (атомарная запись tmp→rename), демо-время
  seed.ts           синтетические пациенты и смоделированная история
  domain/           чистые функции без ввода-вывода (100% детерминированы)
    protocol.ts     вопросы, правила, банк подготовки, самопроверка дня визита
    screening.ts    evaluateScreening, egfrCkdEpi2021
    prep.ts         buildPrepPlan, buildReminders
    report.ts       analyzeReport: предложения → термины, отрицания, маркеры
    safety.ts       экстренное, клинические решения, фильтр ответов, PII
    nlu.ts          parseAnswer, parseCreatinine, parseLabDate, detectIntent
    slots.ts        демо-расписание специалистов
    metrics.ts      4 метрики + воронка + причины отмен
    ics.ts          iCalendar с VALARM
  assistant/
    dialog.ts       оркестратор (state machine этапов + интенты + LLM-fallback)
    llm.ts          OpenAI-совместимый клиент, persona, groundedAnswer, classify, simplifyReport
    knowledge.ts    18 карточек FAQ с версиями + ранжирование
```

## Авторизация

- `GET /api/auth/me` — текущий пользователь, доступен ли Google и демо-вход.
- `GET /api/auth/google` → Google → `GET /api/auth/google/callback` (PKCE, state, nonce).
- `POST /api/auth/demo {as: new_patient|aliya|staff}` — демо-вход (`DEMO_LOGIN`).
- `POST /api/auth/logout`.
- Все `/api/me/*` работают только с данными вошедшего пациента; `/api/staff/*` и `/api/metrics` — только для роли staff. Изменяющие запросы требуют `x-clarity: 1`.

## API

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/api/health` | статус, LLM, версия протокола, демо-время |
| GET | `/api/protocol` | вопросы, самопроверка, пороги анализов |
| GET | `/api/me/state` | всё состояние маршрута |
| GET/POST | `/api/me/chat` | история / реплика `{text}` или действие `{action}` |
| PUT | `/api/me/answers/:qid` | ответ анкеты |
| PUT | `/api/me/lab` | креатинин и дата |
| PUT | `/api/me/prep/:item` | отметка подготовки |
| PUT | `/api/me/reminders` | план напоминаний |
| GET | `/api/me/notifications` | доставка наступивших напоминаний |
| GET | `/api/me/visit.ics` | календарь с будильниками |
| POST | `/api/me/visit/confirm` · `/visit/reschedule` | подтверждение / перенос |
| POST | `/api/me/day-of-check` | самопроверка дня визита |
| POST | `/api/me/report` | разбор заключения |
| GET | `/api/slots?specialty=` | слоты специалиста |
| POST | `/api/me/bookings` | запись (идемпотентно по слоту) |
| POST | `/api/me/questions` | вопрос координатору |
| POST | `/api/me/onboarding` | анкета знакомства (zod, два согласия) |
| GET | `/api/mri-slots` | окна МРТ для выбора при регистрации |
| GET | `/api/staff/overview` 🔒 | пациенты + задачи |
| POST | `/api/staff/tasks/:id/resolve` 🔒 | закрыть задачу |
| POST | `/api/staff/visits/:id/outcome` 🔒 | пришёл / неявка / нарушение подготовки |
| POST | `/api/staff/calls` 🔒 | учесть входящий звонок |
| GET | `/api/metrics` 🔒 | метрики |
| POST | `/api/demo/time` · `/api/demo/reset` | демо: перемотка времени, пересоздание данных |

🔒 — требует `x-staff-token`, если задан `STAFF_TOKEN`.

## Модель данных

`PatientProfile`, `Visit` (status: scheduled → confirmed → attended / rescheduled / cancelled / no_show), `Journey` (answers, lab, screening, prepChecks, dayOfCheck, reminderPlan, lastReport, offeredConsultation, dialog), `Reminder`, `Booking`, `StaffTask` (kind, priority, status), `AppEvent` (20 типов, cohort). Полные типы — `shared/types.ts`.

## Ключевые свойства

- **Единый сервисный слой.** Форма и Клэри вызывают одни функции `services.ts`, поэтому события метрик и задачи координатора одинаковы при любом способе взаимодействия.
- **Детерминированное ядро.** Флаги, рСКФ, уровень заключения, специальность и эскалации не зависят от LLM.
- **Graceful degradation.** Нет ключа или API упал → режим правил. Нет сервера → баннер с повтором. Нет голоса → анимация и текст.
- **Идемпотентность.** Повторная запись на тот же слот возвращает существующую запись; задачи одного вида обновляются, а не дублируются.
- **Время.** Все расчёты через `now()` с демо-смещением; часовой пояс визитов — Asia/Almaty.

## Тесты

`npm test` — 38 тестов (в том числе авторизация: 401 без входа, CSRF, изоляция ролей, валидация знакомства, выход).

Ранее: 31 тест: CKD-EPI, статусы проверки, мужчины без вопросов о беременности, персональный план, число напоминаний, отрицания и «не исключается», 3 примера заключений, NLU (да/нет/не знаю, мг/дл → мкмоль/л, даты), экстренное, фильтр ответов, база знаний и сквозной сценарий API из 9 шагов.
