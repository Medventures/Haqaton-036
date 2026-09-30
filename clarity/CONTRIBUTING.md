# Contributing

Thanks for helping improve Clarity. This repository is a hackathon prototype for a patient-facing diagnostic journey, so correctness and honest product boundaries matter as much as UI polish.

## Before you start

- Read [AGENTS.md](AGENTS.md), [the product brief](docs/PRODUCT_BRIEF.md), and [the technical overview](docs/TECHNICAL_OVERVIEW.md).
- Check existing issues or agree on scope with the project owner before broad changes.
- Keep TOMO24 separate. Do not bring its code, data, credentials, or systems into this repository.

## Local setup

```bash
npm install
npm run dev
```

## Before opening a pull request

```bash
npm run typecheck
npm run build
```

Describe the user-visible change, the screens or flows affected, checks actually run, and any known limitation. Do not include patient-identifiable information in screenshots or examples.

## Clinical content changes

Do not invent or infer clinic preparation rules, contraindications, laboratory requirements, urgency thresholds, or referral criteria. Changes to these require a named clinical owner and a clinic-approved source. The app must route uncertain answers to people, not make eligibility decisions.

## Pull requests

- Keep PRs focused and use descriptive titles.
- Update the README or relevant docs when behavior, architecture, or setup changes.
- Do not commit `dist/`, `node_modules/`, `.env`, secrets, real patient documents, or local `work/` and `outputs/` files.
- Include responsive screenshots at relevant viewport sizes for UI changes, using synthetic data only.

## Licensing

No repository-wide license has been selected yet. Do not assume the source is open for redistribution until the owner adds a license.
