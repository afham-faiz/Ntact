# Ntact prototype

A simulated, clickable prototype of the Ntact patient app and clinician portal. It is a design rehearsal for Saturday's hackathon build.

**Interactive concept. Demonstration data, not a medical device.** There is no Bluetooth, no backend, no login and no real patient data. Every person in it is fictional.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. It starts on the demo controls page.

To try the patient app on a real phone on the same Wi-Fi, run `npm run dev:lan` and open the network address it prints.

Other commands: `npm test` (unit tests), `npm run build` (type-check and production build), `npm run preview` (serve the build).

## Routes

| Route | What it is |
| --- | --- |
| `/demo` | Launchers, the five-scene judge demo, every simulation control, protocol monitor |
| `/onboarding` | Optional three-step introduction: Touch Assist, the daily test, finger and surgery date |
| `/patient` | Home: today's test, Touch Assist, recent tests, daily check-in |
| `/patient/assist` | Touch Assist explanation and enable/pause |
| `/patient/test` | Pre-test, blinded test, results, connection-lost and device-error states |
| `/patient/check-in` | Four-question daily check-in, editable the same day |
| `/patient/progress` | Recovery curve, reported pain, day-by-day history |
| `/patient/device` | Simulated connection, details, troubleshooting |
| `/clinician` | Triage worklist: summary filters and a table ordered by review status |
| `/clinician/patients/:id` | Clinical record: why it is flagged, recovery curve, return window, adherence, results, check-ins, notes |
| `/clinician/reviews` | Every review flag, with record-review and reopen |
| `/clinician/rules` | Editable provisional triage rules and return-window assumptions |

## Five-scene demo

On `/demo`, press **Load judge-demo preset** (resets the data; the next test reports step 4 after yesterday's step 5). Then:

1. **Touch Assist** (`/patient/assist`): pressure at the fingertip becomes feedback at the wrist.
2. **Blinded test** (`/patient/test`): start, wait a few seconds, tap "I Feel It". The screen never shows the level.
3. **Recovery curve** (`/patient/progress`): the new point is there; gaps and not-felt days are shown honestly.
4. **Check-in** (`/patient/check-in`): answer "Yes" to new skin issues.
5. **Clinician** (`/clinician`): Maya now appears under "Review suggested". Open her record, read the exact condition, record a review.

Use one browser for the whole demo (separate tabs or windows are fine).

## What is simulated, and what is not shown

- **Simulated:** the device link, the Normal/Rehab modes and the test. `MockDeviceAdapter` answers the six V3 commands (`STATUS`, `NORMAL`, `REHAB`, `START`, `FELT`, `STOP`) with the V3 notification strings and timing: 1 s of silence, then ten levels of 3 s (about 31 s). The link is always labelled "Demo device".
- **Never shown:** pressure, temperature, battery or measured vibration. V3 does not send them.
- **Wear time** on the clinician record is an invented placeholder, hatched and labelled "Simulated placeholder".
- **Data:** kept in this browser's `localStorage`. Tabs of one browser stay in step. **A phone and a laptop do not share data**; there is no sync.
- **Triage rules and the return window** are provisional. See `QUESTIONS_FOR_TEAM.md`.

Behaviour worth knowing:

- The patient screen is blinded by construction: the test state machine discards `LEVEL` messages, so no screen can display them. The step appears only after the device reports `FELT`.
- `NO_FELT` and `STOPPED` are separate record types and are never stored as a number.
- A tap during the silent first second is recorded as a cancelled test, not a detection. (Assumes the firmware answers `FELT,0,0,ms`; to confirm.)
- Disconnecting cancels a running test, saves nothing, and never resumes it. After reconnecting the person chooses the mode again.
- Reloading the page is not treated as a disconnect. Use Demo controls to simulate one.
- This deliberately departs from the handoff's suggestion to show "current level n/10" during a test.

## Code map

```
src/domain/     types, firmware contract, test state machine, triage rules, return-window estimate,
                check-in schema, adherence, patient messaging, selectors
src/devices/    DeviceAdapter (the seam), MockDeviceAdapter, BleDeviceAdapter (stub, not imported)
src/demo/       seed data (nine fictional patients) and the localStorage store
src/app/        React providers: device status, test session
src/components/ shared UI and charts
src/features/   patient, clinician, demo screens
tests/          273 unit tests for domain, device and store
```

Tests cover the logic layer only. There are no component or navigation tests yet.

## Adding real Bluetooth later

Screens depend only on `DeviceAdapter` and the notification strings. To integrate, implement `BleDeviceAdapter` and return it from `src/devices/index.ts`. Notes are in that file's header:

- Advertised name `SenseBridge-V2.0`; service `6E400001-…`, RX write `6E400002-…`, TX notify `6E400003-…`; UTF-8 comma-separated text.
- Subscribe to TX before sending `STATUS`. Send `REHAB`, wait for `REHAB_READY`, then `START`. Send `FELT` before saving anything. Never drive GPIO.
- Web Bluetooth works in Chrome on Android and desktop. iOS Safari does not support it, so the demo phone needs deciding.

## Documents

- `docs/PRODUCT.md`: what the product is and the decisions taken.
- `docs/DESIGN.md`: the visual system.
- `QUESTIONS_FOR_TEAM.md`: open clinical and technical questions.
- `SenseBridge_Prototype_Spec.md`: original spec, with an update section at the end.
