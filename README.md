# Ntact prototype

A clickable prototype of the Ntact patient app and clinician portal, for the National MedTech Hackathon. It runs in two modes, chosen deliberately:

- **Demonstration** (the default): a built-in stand-in for the wearable. No hardware needed.
- **Physical device**: the real ESP32 wearable over Bluetooth, using the V3 firmware protocol.

**Interactive concept. Demonstration data, not a medical device.** There is no backend, no login and no real patient data. Every person in it is fictional.

**The Bluetooth integration passes its software tests but has not yet been run against a physical board.** See `HARDWARE_INTEGRATION.md` for the hardware checklist and for exactly what is and is not verified.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. It starts on the demo controls page.

To try the patient app on a real phone on the same Wi-Fi, run `npm run dev:lan` and open the network address it prints. That works for demonstration mode only: browsers allow Bluetooth on `https://` or `localhost`, not on a plain network address.

Other commands: `npm test` (all tests), `npm run build` (type-check and production build), `npm run preview` (serve the build).

## Deploy

The live site is https://ntact.vercel.app, on the Vercel project `ntact`. This folder is linked to it (`.vercel/`, not committed). The repository is `afham-faiz/Ntact`.

```bash
npm run build
```

```bash
npx vercel --prod
```

Bluetooth needs the `https://` address, so the deployed site (or `localhost` on the demo laptop) is what the wearable is tested against. Do not deploy from, or to, the older `sensebridge` project: it is a separate folder and a separate Vercel project.

## Using the real wearable

1. Use Chrome or Edge on Windows (or Chrome on Android). iPhone, iPad and Firefox cannot use Bluetooth from a web page.
2. Open `/demo`, and under **Which device** choose **Physical device**. The same switch is on the patient app's Device tab.
3. Press **Connect Ntact device** and pick **SenseBridge-V2.0** from the browser's list. (The firmware still advertises its old name.)
4. Use Touch Assist and the sensation test as normal. Results the device reports are saved with **Source: Wearable** in the clinician record.
5. The **Developer panel** at the bottom of `/demo` shows every command, notification and connection event.

If the connection fails, the app says why and stays in physical-device mode. It never switches to the demonstration by itself. To carry on without hardware, choose **Demonstration**.

Full step-by-step hardware checklist, troubleshooting and nRF Connect instructions: `HARDWARE_INTEGRATION.md`.

## Routes

| Route | What it is |
| --- | --- |
| `/demo` | Launchers, the five-scene judge demo, the device switch, every simulation control, developer panel |
| `/onboarding` | Optional three-step introduction: Touch Assist, the daily test, finger and surgery date |
| `/patient` | Home: the three things to do today (test, exercise, check-in) and Touch Assist |
| `/patient/assist` | Touch Assist explanation and enable/pause |
| `/patient/test` | Pre-test, blinded test, results, connection-lost and device-error states |
| `/patient/exercise` | Physio: the day's three exercises (one locked until a clinician unlocks it) and the movement trend |
| `/patient/exercise/:id` | Get ready: the three steps for one exercise, then Start |
| `/patient/exercise/:id/live` | Live session: camera hand tracking, rep counting, real-time coaching. Add `?mode=demo` for the drawn demonstration hand |
| `/patient/check-in` | Four-question daily check-in, editable the same day |
| `/patient/check-in/weekly` | Three weekly questions: cold sensitivity, tingling, everyday function |
| `/patient/progress` | Recovery curve, reported pain, day-by-day history |
| `/patient/settings` | Settings: connect and disconnect the wearable, device switch, your details, links to Help and the other views |
| `/patient/help` | Where everything is, how to do the test, and troubleshooting. Reached from the "?" on every screen |
| `/clinician` | Triage worklist: summary filters and a table ordered by review status |
| `/clinician/patients/:id` | Clinical record: why it is flagged, recovery curve, return window, adherence, results, check-ins, notes |
| `/clinician/reviews` | Every review flag, with record-review and reopen |
| `/clinician/rules` | Editable provisional triage rules and return-window assumptions |
| `/clinician/help` | Where things are in the dashboard, what the colours mean, who each flag goes to |

## Six-scene demo

On `/demo`, press **Load judge-demo preset** (resets the data; the next test reports step 4 after yesterday's step 5). Then:

1. **Touch Assist** (`/patient/assist`): pressure at the fingertip becomes feedback at the wrist.
2. **Blinded test** (`/patient/test`): start, wait a few seconds, tap "I Feel It". The screen never shows the level.
3. **Recovery curve** (`/patient/progress`): the new point is there; gaps and not-felt days are shown honestly.
4. **Guided exercise** (`/patient/exercise`): start with the camera and open and close your hand ten times.
5. **Check-in** (`/patient/check-in`): answer "Yes" to new skin issues.
6. **Clinician** (`/clinician`): Maya now appears under "Same-day review", routed to the same-day clinic. Open her record, read the exact condition, see her movement trend, record a review.

Use one browser for the whole demo (separate tabs or windows are fine).

## Guided exercises (camera)

The patient's "Physio" tab. The app tracks 21 points on the hand through the camera, counts repetitions, and coaches in real time ("Keep curling, gently", "Bring your index finger in with the others"). There are three exercises, ten repetitions each, defined in `src/domain/exercise.ts`:

| Exercise | What it is | Unlocked |
| --- | --- | --- |
| Finger slides | Hand flat on the table; slide the fingertips back towards the palm so the knuckles lift | By default |
| Open and close | A gentle fist, then fingers stretched wide. The movement trend is read from this one | By default |
| Putty squeeze | Squeeze therapy putty or a soft ball, then let go | Only when a clinician unlocks it, on the patient record |

The day's physio counts as done when every unlocked exercise has been done.

- **Finger slides needs the camera pointed at the table.** A hand lying flat is a harder view for hand tracking than a raised palm, and none of the three has been tried with a real hand yet.

- **Tracking:** MediaPipe Hand Landmarker, running in the browser (`src/exercise/cameraHand.ts`). The WebAssembly runtime is served by this app from `/mediapipe/wasm` (copied out of `node_modules` by `scripts/copy-mediapipe.mjs` before `dev` and `build`). The hand model, about 8 MB, is fetched from Google's public model storage the first time and then cached, so the first session needs a connection.
- **Privacy:** video never leaves the device. Nothing is recorded or uploaded; only repetitions and estimated angles are saved.
- **Where it works:** Chrome, Edge and Safari, including iPhone, on `https://` or `localhost`. (Unlike Bluetooth, the camera does work on iPhone.)
- **Accuracy:** angles come from one camera view and are typically within 10 to 20 degrees, worse if the hand is turned. They are shown as estimates ("about 140°", "≈140°") for guidance and trend. They are not goniometry, and the clinician record says so.
- **Limited movement still counts:** a repetition needs the hand to close and re-open by a relative amount, not to reach a full fist.
- **Demonstration hand:** `?mode=demo` plays a drawn hand through the same counter, for showing the screen without a camera. It is labelled "Demonstration" and saved as simulated. The app never switches to it by itself.
- **Not yet verified with a real hand on camera:** the engine is tested against the drawn hand and the model was confirmed to load and run in a browser, but the development browser blocks camera access. Try it on a laptop or phone before relying on it.

## Priority levels, routing and follow-up

All from plain, readable rules (`src/domain/triage.ts`). There is no score and no model.

| Level | Meaning | Rules |
| --- | --- | --- |
| Red | Same-day review | New skin issue; pain 8/10 or higher, or 3+ points above the week's median |
| Amber | Review soon | Sensation flat for four weeks; level rising; recent test not felt; missed tests; missed exercise days; finger movement falling |
| Green | No current review trigger | A clinician may move the patient to patient-initiated follow-up |

- **Routing:** each flag names who it is for. Sensation results go to the surgical team, movement and adherence to hand therapy, skin and pain to the same-day clinic.
- **Clinician control:** only a clinician unlocks an exercise, and only a clinician moves a patient to (or back from) patient-initiated follow-up. Both are on the patient record.
- **Patient wording:** patients see encouraging summaries only. Flags, levels and routing are never shown in the patient app.
- **No alert is sent anywhere.** A red flag appears in the clinician portal of the same browser. There is no messaging, paging or backend.
- **Not built, because the hardware cannot report it:** a pressure check during the sensation test, and wear time. V3 firmware sends neither. Wear time remains a labelled placeholder.

## What is simulated, and what is not shown

- **In demonstration mode:** the device link, the Normal/Rehab modes and the test are simulated. `MockDeviceAdapter` answers the six V3 commands (`STATUS`, `NORMAL`, `REHAB`, `START`, `FELT`, `STOP`) with the V3 notification strings and timing: 1 s of silence, then ten levels of 3 s (about 31 s). The link is always labelled "Demo device", and every record it produces is stored with `simulated: true`.
- **In physical-device mode:** `BleDeviceAdapter` sends the same six commands to the ESP32 and the firmware decides every outcome and all the timing. The app runs no timer of its own for the vibration sequence. Records are stored with `source: 'ble'`, `simulated: false`, and shown as "Wearable".
- **Seeded history and results logged from the demo controls** are always demonstration data, in either mode.
- **Never shown:** pressure, temperature, battery or measured vibration. V3 does not send them.
- **Wear time** on the clinician record is an invented placeholder, hatched and labelled "Simulated placeholder".
- **Data:** kept in this browser's `localStorage`. Tabs of one browser stay in step. **A phone and a laptop do not share data**; there is no sync.
- **Triage rules and the return window** are provisional. See `QUESTIONS_FOR_TEAM.md`.

Behaviour worth knowing:

- **How the test is done physically.** The prototype has one vibration motor, on the wrist strap. Touch Assist uses it on the wrist. For the sensation test the strap is taken off and laid flat, and the fingertip rests on the motor disc. The app's pictures and steps show this.

- The patient screen is blinded by construction: the test state machine discards `LEVEL` messages, so no screen can display them. The step appears only after the device reports `FELT`.
- `NO_FELT` and `STOPPED` are separate record types and are never stored as a number.
- A tap during the silent first second is recorded as a cancelled test, not a detection. (Assumes the firmware answers `FELT,0,0,ms`; to confirm.)
- Disconnecting cancels a running test, saves nothing, and never resumes it. After reconnecting the person chooses the mode again.
- Reloading the page is not treated as a disconnect. Use Demo controls to simulate one.
- This deliberately departs from the handoff's suggestion to show "current level n/10" during a test.
- A result is saved against the patient and finger captured when the test started. Switching the active patient mid-test does not move it.
- "Start test" sends `REHAB`, waits for `REHAB_READY`, then sends `START` once. There is no separate arming step on screen, so Touch Assist keeps working until the moment the test begins.
- The choice between demonstration and physical device is kept per browser tab. A Bluetooth link belongs to the tab that opened it and does not survive a reload: reconnect by hand.

## Code map

```
src/domain/     types, firmware contract, test state machine, triage rules, return-window estimate,
                check-in schema, adherence, patient messaging, selectors
src/devices/    DeviceAdapter (the seam), MockDeviceAdapter (demonstration), BleDeviceAdapter (Web Bluetooth),
                source (which of the two this tab uses)
src/exercise/   camera hand tracking (MediaPipe), the drawn demonstration hand, canvas drawing
src/demo/       seed data (nine fictional patients) and the localStorage store
src/app/        React providers: device status, test session
src/components/ shared UI and charts
src/features/   patient, clinician, demo screens
tests/          382 tests: domain, store, simulated device, Bluetooth adapter, device and test-session
                providers end to end, the exercise engine, and the care model (routing, follow-up, weekly)
```

The Bluetooth tests run against a pretend ESP32 (`tests/fakeBle.ts`) written from the handoff. They show the app keeps its side of the protocol. They do not show that a board works. There are no screen-level component or navigation tests yet.

## How the Bluetooth link works

Screens depend only on `DeviceAdapter` and the notification strings, so the demonstration and the wearable are interchangeable. `src/devices/index.ts` returns one or the other.

- Advertised name `SenseBridge-V2.0`; service `6E400001-…`, RX write `6E400002-…`, TX notify `6E400003-…`; UTF-8 comma-separated text. The name is unchanged in firmware: do not edit `BLE_PROFILE` without a matching firmware change.
- Connect: the browser's device list (from a tap) → GATT connect → find the service, RX and TX → subscribe to TX → only then report "connected", which makes the app write `STATUS`.
- Writes use write-with-response, one at a time. `FELT` and `STOP` go to the front of the queue.
- A dropped link is reported as disconnected. Nothing is retried, resumed or switched to the demonstration. Reconnect goes straight back to the remembered device.
- Cross-device sync does not exist. `HARDWARE_INTEGRATION.md` lists what it would take.

## Documents

- `HARDWARE_INTEGRATION.md`: testing against the physical ESP32, troubleshooting, and what is verified.
- `docs/PRODUCT.md`: what the product is and the decisions taken.
- `docs/DESIGN.md`: the visual system.
- `QUESTIONS_FOR_TEAM.md`: open clinical and technical questions.
- `SenseBridge_Prototype_Spec.md`: original spec, with an update section at the end.
