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

## Deliberately out of scope

Backend, accounts, cross-device sync, real alerts or messaging, live pressure readings, wear time from the device, heat and pressure alarms, monofilament equivalence, any diagnosis or percentage-recovered figure, patient messaging.
