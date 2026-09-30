# Clarity — product brief

## One-line description

Clarity is a patient journey companion prototype for diagnostic imaging. It helps a patient organize the steps around a contrast-enhanced brain MRI and gives clinic staff a clear follow-up queue for answers that need human review.

## Hackathon challenge

Diagnostic Companion: patients may be unsure about screening questions, requested lab work, preparation, and what a report says. Missed preparation can contribute to rescheduling and repeat calls. The challenge asks for one procedure journey that connects pre-visit screening, preparation, reminders, post-study report explanation, and specialist consultation when appropriate.

## Current chosen route

**Demonstration route:** brain MRI with contrast.

This is a product-scope choice for the prototype, not a clinical recommendation. The questions and reminders are illustrative. The clinic and a named clinician must approve the exact procedure protocol before any pilot.

## Intended users

- **Patient:** reviews the visit, completes an informational questionnaire, checks off organizational steps, sets a simulated reminder, and prepares questions for the clinic.
- **Coordinator (conceptual):** reviews answers marked for follow-up and helps the patient obtain an authoritative answer.
- **Clinician (clinical decision maker):** assesses the patient's situation, determines protocol-specific eligibility, interprets reports in context, and decides consultation urgency.

## Future concept: AI patient guide and gamified journey

The product direction may include a clearly disclosed **AI guide** represented by a friendly medical avatar. It can search clinic-approved information, show the user's own visit details, help complete administrative tasks, and explain reviewed educational content. It is not presented as a human doctor and does not diagnose, prescribe, decide contrast eligibility, or autonomously interpret a real lab result.

Any lab explanation needs a separately approved scope, structured source data (including units and the reporting lab's own reference interval), clinical review, uncertainty handling, and a human support path. The current app does not contain this functionality.

Gamification is a design hypothesis for helping patients finish optional organizational steps: journey milestones, progress, and small badges for actions the patient controls. Do not score health status, test results, or compliance; do not use public comparisons, punishment, streak pressure, or rewards tied to medical decisions. The current app's progress indicator is a demo UI only.

The detailed feature scope, release gates, and evaluation plan are in [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md).

## Patient journey represented in the demo

1. Review a sample appointment.
2. Answer five pre-visit questions covering MRI devices/implants, kidney history, prior contrast reaction, possible pregnancy, and a clinic-requested lab.
3. Display positive, uncertain, or missing-requested-lab answers as a human follow-up task. The app never grants clearance or automatically cancels the visit.
4. Use a non-clinical organizational checklist and clinic-contact reminder.
5. Configure a simulated reminder. No notification is sent.
6. View a static explanation of a wholly synthetic sample report and prepare a question for a clinician.
7. Add local demo notes to a follow-up queue. Nothing is sent to a clinic.

## Success measures proposed by the challenge

- Cancellation or rescheduling rate.
- Preparation non-compliance rate.
- Repeat calls per scheduled study.
- Conversion from an indicated follow-up to a completed specialist consultation.

The prototype does not collect these real-world outcomes. A pilot would need baseline definitions, clinic data access, consent/privacy controls, and clinician-approved measurement before making impact claims.

## Non-goals for the current prototype

- Diagnosis, treatment advice, medical triage, or contrast eligibility decisions.
- Clinical interpretation of real reports or imaging.
- Production reminders, appointment booking, EHR/MIS integration, or staff accounts.
- Real patient-data collection, backend storage, or use of a cloud model.
- Integration with TOMO24. TOMO24 is a separate product and must remain separate.

## Product principles

1. **Human decision making:** clinical decisions belong to qualified care teams.
2. **Transparent demo behavior:** every simulated action is labeled and not presented as sent or booked.
3. **Data minimization:** current examples are synthetic; no server receives user data.
4. **Clinic-owned protocols:** instructions come from an approved, versioned clinic source.
5. **Escalate uncertainty:** uncertain or flagged responses go to a human for clarification.

## Open questions for the clinic / organizers

- Confirm the procedure route and obtain the clinic's patient instructions and screening form.
- Identify the clinical owner who approves wording and escalation handling.
- Confirm what report content can be used in a demo and supply only synthetic or properly de-identified examples.
- Clarify whether the expected hackathon demo may simulate reminders and booking or must connect to a system.
- Confirm required deployment, language, data-location, and open-source constraints.
