# Product

**One line:** Ntact uses wearable feedback to help people with fingertip sensory loss perceive touch and track changes in sensation while they recover.

**Users:** adults recovering from digital nerve repair; hand therapists and clinicians; hackathon judges.

This prototype is a simulated design rehearsal. It is not a clinical specification.

## Two experiences

| | Patient | Clinician |
| --- | --- | --- |
| Device | Phone | Desktop |
| Tone | Calm, plain, never alarming, never falsely reassuring | Precise, dense, explicit about what is provisional |
| Core job | Do today's test and check-in; see the recovery curve | Decide who to look at first, and why |

## Patient flows

1. **Touch Assist** (firmware Normal mode): on, paused, or unavailable. The app shows the mode only; it has no pressure reading to show.
2. **Daily sensation test** (firmware Rehab mode): blinded. One instruction, one large button, a stop button. The step is shown only afterwards.
3. **Recovery curve:** detected step over 2 weeks, 1 month or 3 months, with reported pain beneath and a day-by-day history.
4. **Daily check-in:** pain 0 to 10, new skin issues, cold sensitivity, optional note. One question per step; "No" and the cold options advance on tap.
5. **Onboarding:** optional, three steps. Asks only for hand, finger and surgery date.

### What the patient app may say

Kept in `src/domain/patientMessages.ts`.

- A change is described only when the data supports it: the last fortnight's median step is at least 1 lower than the fortnight before, with 6 or more felt results in each. It is worded as what was recorded ("You've been noticing gentler vibrations lately"), not as nerve recovery.
- If a clinician flag about results is pending, the only message is "Your therapist will review your recent results."
- Missed days are acknowledged without blame.
- Nothing says "normal", "progressing well", "failing" or anything about surgery.

## Clinician flows

1. **Worklist:** five summary cells (priority review, review suggested, no current review trigger, missed-test follow-up, tests completed in 7 days). The first four filter the table. Rows show status, patient, days since repair, last test, 14-day adherence and review reasons.
2. **Clinical record:** the exact provisional condition and recorded evidence for each flag; recovery curve with day inspection; return window; adherence; daily results; check-ins; notes; clinical setup.
3. **Review flags:** every flag, with record-review and reopen.
4. **Provisional rules:** every threshold, editable, with reset.

### Triage

- **Red, priority review.** **Amber, review suggested.** **Green, no current review trigger** (never "recovering").
- Rules are provisional and listed in `QUESTIONS_FOR_TEAM.md`.
- Recording a review saves a note locally. Nothing is sent to anyone.

### Return window

Clinician-only, labelled "Illustrative estimate — not clinically validated". A date range from the repair date, an assumed delay, an assumed rate and the repair-to-fingertip distance. It does not predict the detection step and feeds no rule.

## Fictional cohort

Nine people, built so every triage outcome appears:

- **Red:** Tomás Reyes (fluctuating, no change in four weeks, plus a pain increase); Daniel Whitlock (flat at step 6 to 7, plus a skin issue).
- **Amber:** Priya Nair (four missed tests); Aiko Tanaka (yesterday's test not felt); Leon Fischer (two rising readings).
- **Green:** Maya Okafor (default patient, gradual downward pattern); Samuel Adeyemi; Noor Haddad; Elin Marsh (enrolled three days ago).

History is deterministic and anchored on the day the data was last reset.

## Movement assessment (added November 2026)

The software half of the product, beside the wearable. A camera estimates finger-joint movement through clinician-selected, structured movements and records it for review over time. It complements the sensory test and never stands in for it: movement is not sensation.

- **Patient:** Physio → Movement assessment. Choose an assessment the clinician has switched on, set up the camera (laptop, propped phone, phone in the other hand, or held by someone else), follow the prompts, read the summary. Hands-free once started.
- **Clinician:** the record's "Movement and check-ins" tab. Protocol per patient; trend per joint; session detail with capture quality; comparison between like-for-like sessions; movement beside the sensory test; goniometer readings for comparison.
- **What may be said.** Estimates are called estimates. Each one says how the joint was seen. Completion is separate from estimates. There is no recovery score, no normal range and no comparison with other people: only with the same person's earlier sessions. Nothing is called validated. Illustrative and synthetic data are labelled wherever they appear.
- **What the app never does.** Choose or unlock a movement for a patient, encourage forcing a movement, raise a flag from an assessment, or fill in a value it could not see.
- **Technical demonstration:** `/present`.

Detail: `docs/TRACKING_ENGINE.md`, `docs/VALIDATION_PLAN.md`.

## Deliberately out of scope

Backend, accounts, cross-device sync, real alerts or messaging, live pressure readings, wear time from the device, heat and pressure alarms, monofilament equivalence, any diagnosis or percentage-recovered figure, patient messaging.
