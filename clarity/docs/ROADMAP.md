# Roadmap

This roadmap separates a convincing hackathon prototype from work that requires clinic ownership. It is not a promise of release dates.

## P0 — make the demo reliable

- [x] Responsive patient journey for desktop, tablet, and mobile.
- [x] Local questionnaire, follow-up flags, preparation checklist, reminder simulation, and question list.
- [x] Synthetic report explanation with a clear clinician disclaimer.
- [x] Browser-local state and visible demo boundary.
- [ ] Add interaction-level accessibility review (keyboard, screen reader, contrast).
- [ ] Add screenshots/GIF from synthetic data after the final visual review.

## P0.5 — v2 prototype (done)

- [x] Backend with deterministic screening rules, CKD-EPI 2021, lab freshness.
- [x] Personalised prep plan, reminder schedule, in-app + browser notifications, .ics.
- [x] Day-of self-check that records preparation violations before arrival.
- [x] Report explanation: glossary, negation handling, 3-level red flags, doctor questions.
- [x] Specialist booking from red flags (demo schedule, idempotent).
- [x] AI avatar Клэри: SVG, facial states, lip-sync, voice in/out, hybrid dialog, knowledge base with sources.
- [x] Coordinator console and metrics dashboard (4 case metrics).
- [x] 31 automated tests, Docker deployment, CI with tests.

## P1 — confirm the clinical workflow

- [ ] Confirm selected procedure with organizers and Green Clinic.
- [ ] Name a clinician accountable for approving the questionnaire, instructions, and escalation copy.
- [ ] Receive a versioned, clinic-approved patient preparation guide and screening form.
- [ ] Define what staff do for “yes”, “no”, “unknown”, missing test, unreachable patient, and changed appointment.
- [ ] Confirm report explanation scope and synthetic/de-identified examples.
- [ ] Define baseline metric formulas and minimum sample period.

## P2 — pilot foundation (requires privacy/security review)

- [ ] Agree on data controller, consent, legal basis, region, retention, deletion, and incident procedures.
- [ ] Design authenticated patient and coordinator roles, least-privilege rules, and audit events.
- [ ] Integrate a test appointment source and idempotent notification provider.
- [ ] Add delivery/failure states and human support fallback.
- [ ] Threat-model data flows and review dependencies.

## P3 — controlled evaluation

- [ ] Usability test with patients and clinic coordinators using synthetic cases first.
- [ ] Clinician review of edge cases and translations.
- [ ] Run a limited pilot with explicit oversight and a rollback path.
- [ ] Measure cancellations, preparation misses, repeat calls, and completed consultations against an agreed baseline.
- [ ] Publish results only with methods, denominator, period, and limitations.

## Not scheduled

Production deployment, real patient-data processing, real report interpretation, and clinical decision support remain out of scope until explicit clinical, privacy, regulatory, and operational approval exists.
