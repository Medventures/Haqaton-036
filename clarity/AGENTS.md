# Instructions for coding agents

## Project boundaries

- This repository is the standalone **Clarity / Diagnostic Companion** hackathon prototype.
- Do not import, copy, merge, or connect TOMO24 code, data, credentials, or infrastructure. TOMO24 is a separate product.
- Current route: contrast-enhanced brain MRI. Keep it a demo unless a clinician and the clinic provide an approved protocol.
- The AI avatar "Клэри" must always be disclosed as AI (not a doctor). Medically significant decisions (flags, eGFR, report urgency, specialty, escalation) live in deterministic rules in `server/domain` — never move them into LLM prompts.
- Do not claim that integrations, AI interpretation, clinical validation, or patient outcome improvements exist unless implemented and evidenced.

## Clinical and privacy boundaries

- This is not a medical device and must not make a diagnosis, prescribe treatment, determine contrast eligibility, or clear/cancel a procedure.
- Answers requiring follow-up should be routed to a human coordinator. Never turn a demo rule into a clinical decision rule.
- Use synthetic examples only. Never commit patient data, real reports, identifiers, credentials, `.env` files, or production configuration.
- Demo state lives in the Clarity backend (JSON file with synthetic data). Be explicit in UI and docs that bookings, reminders and messages are demo-only unless a real integration exists.
- Do not add real report uploads or send health information to a third party without an explicit, reviewed product and privacy design.

## Development workflow

1. Read `README.md` and the relevant files in `docs/` before making broad changes.
2. Keep changes focused and preserve the Russian patient-facing interface.
3. Install with `npm install`; run with `npm run dev` (web :5173 + api :8787).
4. Run `npm run typecheck`, `npm test` and `npm run build` before handing off code changes.
5. Do not claim tests were run unless you ran `npm test` and it passed.
6. Check `git diff` for accidental secrets, generated output, or unrelated files before committing.

## Current architecture

- React + TypeScript + Vite frontend (`src/`), Fastify + zod backend (`server/`), shared types (`shared/types.ts`).
- `server/domain/*` — pure deterministic rules (protocol, screening, prep, report analysis, safety, NLU, metrics). Add tests in `tests/domain.test.ts` for any change.
- `server/services.ts` — the only place that mutates journey state and logs metric events; UI forms and the assistant both use it.
- `server/auth.ts` — Google OIDC (PKCE), server sessions (hashed tokens), roles patient/staff, CSRF header `x-clarity`. Patient routes are `/api/me/*` and must only touch `req.user.patientId`.
- `server/assistant/*` — dialog orchestrator, OpenAI-compatible LLM adapter (optional, `LLM_API_KEY`), knowledge base. `agent.ts` may only trigger whitelisted actions validated by zod.
- Storage: JSON file (`server/data/db.json`, git-ignored, synthetic). Demo endpoints `/api/demo/*` must be disabled for any pilot.
- Run `npm run typecheck`, `npm test` and `npm run build` before handing off.

## Definition of done

- The change builds and type-checks.
- The UI has a clear loading, empty, error, or success state where applicable.
- Patient-facing copy does not imply a real appointment, notification, clinical review, or AI result when the action is local-only.
- README and relevant architecture or handoff docs are updated when behavior changes.
