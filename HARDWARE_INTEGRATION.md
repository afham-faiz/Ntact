# Ntact: connecting the real ESP32 wearable

This is the checklist for the first session with the physical device. It is written for the whole team: you do not need to read the code to follow it.

**Status on 14 November 2026: the app side is built and passes its software tests. Nothing in this document has been run against a physical board yet.** Every "expected" below comes from the V3 handoff (`SenseBridge_V3_BLE_App_Developer_Handoff.pdf`, 11 November 2026). The app side has not seen the firmware source (`SenseBridge_V3_0.ino`). Treat the first hardware session as the test of this document as much as of the app.

Tick each step as you do it and write down anything that differs in the table at the end.

---

## 0. What you need

| Item | Detail |
| --- | --- |
| The wearable | ESP32 with the fingertip sleeve (FSR, test motor) and wristband motor, powered by USB or power bank |
| A Windows laptop with Bluetooth | Chrome or Edge, up to date. Bluetooth switched on in Windows settings |
| The app | https://ntact.vercel.app (once the new build is deployed), or `npm run dev` then http://localhost:5173 on the laptop |
| A phone with nRF Connect | Free, by Nordic Semiconductor. Used to look at the board directly when something does not work |
| The Arduino IDE (optional) | The Serial Monitor at the firmware's baud rate shows what the ESP32 thinks is happening |

Things that will not work, so do not lose time on them:

- **iPhone or iPad, any browser.** Apple does not allow web pages to use Bluetooth.
- **Firefox**, on any device.
- **`npm run dev:lan` on a phone.** That address is `http://192.168…`, and browsers only allow Bluetooth on `https://` or `localhost`. Use the deployed site on a phone.
- **Two things connected at once.** The ESP32 accepts one connection. If nRF Connect (or a second laptop, or a second browser tab) is connected, the app cannot connect, and often cannot even see the device. Disconnect the other one first.

---

## 1. Confirm the firmware

- [ ] Ask Naoki or Bosco which sketch is flashed. It should be **V3.0** (`SenseBridge_V3_0.ino`). Write the version and the date it was flashed in the table at the end.
- [ ] If it is V2 or anything else, stop and re-flash, or tell whoever is running the app: the Rehab timing and levels differ and the results will not mean what the app says they mean.

## 2. Power on and check it is advertising

- [ ] Power the ESP32. Give it five seconds.
- [ ] On the phone, open **nRF Connect → Scanner → Scan**.
- [ ] You should see a device named **`SenseBridge-V2.0`**. (The name was not changed for V3 or for the Ntact rename. That is expected.)
- [ ] If it is not there: check power, press the ESP32's reset button, move the phone closer, and check nothing else is already connected to it.

## 3. Check the service and characteristics (nRF Connect)

- [ ] Tap **Connect** on `SenseBridge-V2.0`.
- [ ] You should see one unknown service:
  `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- [ ] Inside it, two characteristics:
  - `6E400002-…` with property **WRITE** (this is RX: app to device)
  - `6E400003-…` with properties **NOTIFY, READ** (this is TX: device to app)
- [ ] Tap the triple-arrow icon on `6E400003` to enable notifications.
- [ ] Tap the up-arrow on `6E400002`, choose **Text (UTF-8)**, type `STATUS`, send. A notification `STATUS,NORMAL,0` should appear on `6E400003`.
- [ ] **Disconnect nRF Connect** before moving on. This matters: see "two things connected at once" above.

If the UUIDs or properties are different, the app will connect and then report "That device isn't answering as an Ntact wearable". Record the real values in the table at the end.

## 4. Connect from the app (Windows, Chrome or Edge)

- [ ] Open the app. Go to **Demo controls** (`/demo`).
- [ ] Under **Which device**, choose **Physical device**. The line beside it now reads "Connect your Ntact device".
- [ ] Press **Connect Ntact device**. The browser opens its own list.
- [ ] Pick **SenseBridge-V2.0** and press **Pair**.
- [ ] Within a few seconds the status should read **Connected, mode NORMAL**.
- [ ] Scroll to the **Developer panel** at the bottom of the page. You should see, newest first, lines marked `BLE`:
  - `link  Searching for nearby devices`
  - `link  Chosen: SenseBridge-V2.0`
  - `link  Connected to SenseBridge-V2.0. Listening for notifications.`
  - `app →  STATUS`
  - `← device  STATUS,NORMAL,0`

That last pair is the handoff's first acceptance test: connect, subscribe, send `STATUS`, receive `STATUS,NORMAL,0` after a normal power-on.

Keep the Developer panel open in a second tab of the same browser while you do the rest. It updates live, and it is the fastest way to see what was actually sent and received.

## 5. Touch Assist (NORMAL mode)

- [ ] Open the patient app (`/patient`), then **Touch Assist**.
- [ ] It should say **Touch feedback enabled**. Press the fingertip sensor: the **wrist** motor should respond. Light touch gives an occasional tap, firmer gives quicker taps, hard gives a steady buzz.
- [ ] Press **Pause Touch Assist**. Developer panel: `STOP` then `STOPPED`. Pressing the sensor should now do nothing.
- [ ] Press **Enable Touch Assist**. Developer panel: `NORMAL` then `NORMAL_READY`. Feedback returns.

The app shows no pressure reading and no live graph here, on purpose: V3 does not send pressure over Bluetooth. If you want to see the raw sensor values, use the Arduino Serial Monitor.

## 6. The sensation test (REHAB mode)

Put the sleeve on a finger and rest it the way a patient would.

- [ ] Open **Test** and press **Start test**.
- [ ] Developer panel should show, in this order: `REHAB` → `REHAB_READY` → `START` → `LEVEL,0,0`, then `LEVEL,1,1`, `LEVEL,2,12`, `LEVEL,3,24` and so on, one every 3 seconds.
- [ ] The patient screen must show **no level, no countdown and no progress**: only "Tap as soon as you feel a vibration", the big button and Stop. If you ever see a number there during a test, that is a bug: report it.
- [ ] When you feel the **fingertip** motor, press **I Feel It**.
- [ ] Developer panel: `FELT` then something like `FELT,3,24,8500`. The motor should stop.
- [ ] The result screen should say "You felt a vibration at level 3 of 10" (matching the middle number of what the device sent).

Check the stimulus is in the right place:

- [ ] **The test vibration is at the fingertip sleeve, not at the wrist.** If the wrist motor runs during the test, or both do, note it: it changes what the test measures.
- [ ] Note the lowest level at which the motor visibly or audibly spins. The handoff warns that low levels (1, 12) may not physically move the motor. Record it.

## 7. Check the result reached the right patient

- [ ] Open **Demo controls → View clinician portal**, then the patient the app was showing (Maya Okafor unless you changed it).
- [ ] Under **Daily results**, the top row should be today's test, with the level, `RTP` value and time the device reported, and **Source: Wearable**.
- [ ] Every older row should say **Source: Demonstration**. Only results the device itself reported are ever labelled Wearable.
- [ ] The recovery curve on that record and on the patient's **Recovery** tab should have today's point.

Then check attribution deliberately:

- [ ] Start a test as Maya. While it is running, switch **Fictional patient** to someone else in the Demo controls tab. Press I Feel It. The result must be saved to **Maya**, not to the newly selected patient.

## 8. Not felt, and Stop

- [ ] Start a test and do not press anything. After about 31 seconds: `COMPLETE,NO_FELT`. The app says "You didn't report feeling a vibration this time" and the record shows "Completed, not felt" with no level.
- [ ] Start a test and press **Stop test**. Developer panel: `STOP` then `STOPPED`. The motor stops. The record shows "Cancelled" with no level.
- [ ] Start a test and press **I Feel It** immediately, inside the first second. Record exactly what the device sends back. The app expects `FELT,0,0,<ms>` and treats it as a cancelled test, not a detection. **This is an assumption that only hardware can confirm.**

## 9. Disconnect and reconnect

- [ ] Start a test. Part-way through, pull the ESP32's power (or walk away with the laptop).
- [ ] The app should say **Connection lost** within a few seconds, and state that nothing was saved. Check the clinician record: no new row.
- [ ] Restore power. Wait five seconds. Press **Reconnect Ntact device**. It should reconnect **without** showing the browser's list again.
- [ ] Developer panel: `STATUS` then `STATUS,IDLE,0` (the firmware goes idle on disconnect). The app must **not** send `REHAB` or `START` by itself, and the test must **not** resume.
- [ ] Choose "Set up the test again" and confirm a fresh test runs normally.
- [ ] Also try: **Disconnect** from the Device screen, then reconnect. And: close the laptop lid for a minute, reopen, reconnect.

---

## When something does not work

Always look at the **Developer panel** first. It shows the exact failure in the top `link` line.

| What you see in the app | Likely cause | What to do |
| --- | --- | --- |
| The browser's list is empty | Board not advertising, out of range, or already connected to something else | Check power, press reset, close nRF Connect and other tabs, turn the laptop's Bluetooth off and on |
| "No device was chosen" | The list was closed, or the device was not in it | As above, then connect again |
| "This browser can't connect to the wearable" | Not Chrome or Edge, or an iPhone | Use Chrome or Edge on Windows or Android |
| "Bluetooth needs the secure address" | Opened over plain `http://` on a network address | Use the `https://` site, or `localhost` on the laptop |
| "Bluetooth is switched off" | Windows Bluetooth is off, or the laptop has no adapter | Windows Settings → Bluetooth & devices |
| "Couldn't reach the wearable" | Chosen, but the connection could not be opened | Move closer, power-cycle the board, make sure nothing else is connected |
| "The wearable didn't answer in time" | Connection opened, then stalled | Power-cycle the board. On Windows, remove the device under Bluetooth & devices and try again |
| "That device isn't answering as an Ntact wearable" | Service or characteristic UUIDs differ from the handoff, or it is the wrong device | Compare with step 3 in nRF Connect. Record the real UUIDs |
| Connected, but mode stays "Checking" | `STATUS` was written but no notification came back | In nRF Connect, do step 3 by hand. If that also gets no reply, it is firmware. If it replies there but not in the app, send a screenshot of the Developer panel |
| "The Ntact device didn't answer" during a test | A command got no reply within 5 seconds | Read the Developer panel: which command has no `← device` line after it? |
| "The wearable couldn't start the test" | Device sent `ERR,DRIVER`: the DRV2605L haptic driver was not detected | Hardware: check the I²C wiring and power to the driver board |
| Test result looks wrong | | Compare the `FELT,…` line in the Developer panel with the result screen. If they match, the app is doing its job and the question is for the firmware |
| Connection drops repeatedly | Range, power supply, or Windows power saving | Shorter distance, a better power source, and in Device Manager untick "Allow the computer to turn off this device" for the Bluetooth adapter |

**Using nRF Connect to split app problems from firmware problems.** Disconnect the app, connect with nRF Connect, enable notifications on `6E400003`, and write the commands by hand to `6E400002` as UTF-8 text: `STATUS`, `REHAB`, `START`, then `FELT` or `STOP`. If the board behaves correctly there and not through the app, the fault is in the app. If it misbehaves there too, it is in the firmware or hardware. Remember to disconnect nRF Connect afterwards.

**If Bluetooth will not work on the day,** choose **Demonstration** under "Which device". The whole patient-to-clinician journey runs exactly as before, and everything it saves is labelled as demonstration data. The app never switches to it by itself.

---

## What the app assumes about the firmware

These are the points where the app depends on behaviour the handoff describes but nobody on the app side has observed. If any is wrong, tell whoever maintains the app before the demo.

1. The device is found by its name `SenseBridge-V2.0`, or by any name starting `SenseBridge` or `Ntact`, or by advertising the service UUID. If the name is changed in firmware to something else, the app's list will not show it.
2. Each notification is one complete message of at most 20 bytes. The longest documented message (`FELT,10,105,31000`) is 17. A longer message would be cut off by the default Bluetooth packet size and the app would ignore it as unreadable.
3. `STATUS` is always answered, in every mode.
4. `REHAB` is answered with `REHAB_READY` before `START` is accepted. The app sends `START` once, only after `REHAB_READY`.
5. `START` is answered with `LEVEL,0,0` straight away. The app waits up to 5 seconds for it.
6. `FELT` is answered with `FELT,<level>,<drive>,<elapsed_ms>` within 5 seconds, with `<level>` from 1 to 10. A level of 0 is treated as a tap before any vibration, and saved as cancelled.
7. If all ten levels finish, the device sends `COMPLETE,NO_FELT` by itself.
8. `STOP` is answered with `STOPPED` and leaves the device idle.
9. On disconnect the device stops the motor and goes idle, and reports `STATUS,IDLE,0` after a reconnect.

## Firmware changes that would help (none are required for the demo)

- **Advertise the service UUID** in the advertising packet as well as the name, if it is not already. It makes discovery more reliable.
- **Rename the device to `Ntact-V3`** when convenient. The app already accepts any name beginning `Ntact`, so this needs no app change, but tell the app side so the on-screen instructions can be updated.
- **A firmware version in the `STATUS` reply or a separate command**, so the app can show which firmware it is talking to instead of relying on someone remembering.
- **Confirm the reply to an early `FELT`** (inside the first silent second).
- Later, if live pressure is wanted in the app, it needs a new notification. The app deliberately shows no pressure today because V3 sends none.

## What is and is not verified

| | Software tests | Physical hardware |
| --- | --- | --- |
| Connection order (subscribe, then `STATUS`) | Passing | **Not yet tested** |
| Command order `REHAB` → `REHAB_READY` → `START` | Passing | **Not yet tested** |
| One write at a time; `FELT` and `STOP` jump the queue | Passing | **Not yet tested** |
| Parsing every documented notification | Passing | **Not yet tested** |
| Felt, not felt, cancelled, early tap | Passing | **Not yet tested** |
| Driver error, no reply, lost connection, reconnect without resuming | Passing | **Not yet tested** |
| Result saved to the patient and finger captured at Start | Passing | **Not yet tested** |
| Clinician record and review flags update | Passing | **Not yet tested** |
| Real Chrome opens the Bluetooth device list from the Connect button | Checked on the development machine (no device present) | **Not yet tested with a device** |
| Device advertises `SenseBridge-V2.0` with the documented UUIDs | n/a | **Not yet tested** |
| Motor actually runs, at the fingertip, at each level | n/a | **Not yet tested** |

The software tests run against a pretend ESP32 written from the handoff (`tests/fakeBle.ts`). They prove the app does what the handoff asks. They cannot prove the board does.

## Sharing results between devices (not built)

Results are stored in the browser that ran the test (`localStorage`). A test run on the laptop that is connected to the wearable appears in the clinician portal **in that same browser only**. A second laptop or a phone will not see it. For the demo, run the patient app and the clinician portal in two tabs of the same browser on the same laptop.

Real sharing would need, at minimum: a small hosted database and API; sign-in for patients and clinicians, with each record tied to an account; every test given a permanent id and sent to the server once the device reports it, with a queue for when the laptop is offline; the clinician portal reading from the server instead of the browser; and, before any real patient data, encryption, access control and an information-governance review. None of that is in this build and none of it is pretended.

---

## Discrepancy log

Fill this in during the hardware session.

| Step | Expected | What actually happened | Who / when |
| --- | --- | --- | --- |
| Firmware version flashed | V3.0 | | |
| Advertised name | `SenseBridge-V2.0` | | |
| Service / RX / TX UUIDs | as in step 3 | | |
| Reply to `STATUS` after power-on | `STATUS,NORMAL,0` | | |
| Reply to `FELT` in the first second | `FELT,0,0,<ms>` (assumed) | | |
| Lowest level the motor physically runs | unknown | | |
| Test stimulus location | fingertip sleeve only | | |
| Time from pulling power to "Connection lost" | a few seconds | | |
| | | | |
