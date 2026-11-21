# Mobile: what is built, what is tested, and the checklist for a real phone

Mobile is a first-class target for the movement assessment. The same tracker, engine and screen run on a phone and on a laptop: there is one implementation, laid out by the space it is given.

**No physical phone has been used in building this.** The list below separates what was checked from what was not, and the checklist at the end is what to run on an iPhone and an Android phone.

## How to get it onto a phone

The camera only works on `https://` or `localhost`. A phone opening `http://192.168.x.x:5173` from `npm run dev:lan` is neither, and the browser will withhold the camera. Two ways round it:

- **Android, by USB (no deploy).** Connect the phone, open `chrome://inspect/#devices` in desktop Chrome, enable port forwarding for `5173 → localhost:5173`, and open `http://localhost:5173` on the phone.
- **Any phone.** Open the deployed `https://` site. Deploying is yours to do (`npm run build`, then the project's usual deploy): nothing has been deployed as part of this work.

## What is built

| Requirement | Implementation |
| --- | --- |
| Front and rear cameras | `CameraStream`: asked for as a preference, read back from what was opened, switchable mid-session. Front is mirrored on screen; rear is not |
| Rear camera preferred when pointing the phone at the hand | "Phone in my other hand" and "Someone is holding it" default to the rear camera |
| Portrait, landscape, rotation | The frame's size is read every frame; the overlay mapping is recomputed from it; the screen lays itself out with container queries, with a compact mode when the screen is short |
| Hands-free once started | A session starts itself when the start position is held, counts by itself, and finishes by itself. Nothing needs touching |
| Usable with one hand | Large targets (44 px or more), controls at the bottom, no gestures |
| Cannot see the screen (rear camera) | Tones for start, target, recorded, rejected and complete; optional spoken instructions |
| Hand-held shake | Joint angles are computed in the hand's own frame; fast movement in the picture, unsteady landmarks and (from the gyroscope) the phone turning each pause measurement |
| View suitability per assessment | Each assessment lists the views it accepts; an unsuitable view shows how to turn the hand and records nothing |
| Stable camera needed? | Stated on the setup screen for the side-on assessments when "Phone in my other hand" is chosen |
| Battery and interruptions | The camera is switched off when the page goes to the background and brought back afterwards; the screen is kept awake during a session; everything is released on leaving |
| Slow devices | Model on the graphics processor where available; every other frame is skipped if the model cannot keep up; the measured frame rate is stored with the session and a low rate is flagged |

## Which assessments suit which setup

A reasoned starting position, not a tested one.

| Assessment | Hand-held, on your own | Propped phone or a helper |
| --- | --- | --- |
| Composite fist (palm-on) | Supported: hand palm-up on a table, phone above | Supported |
| Thumb opposition (palm-on) | Supported, same position | Supported |
| Hook fist, tabletop (side-on) | Can be tried: hand on its little-finger edge, phone above the thumb side. The setup screen warns that the reading is sensitive to the camera moving | Recommended |
| Single finger flexion | As for side-on | Recommended |

The side-on assessments need the camera to stay at a fixed angle to the finger for the "in view" grade to hold, which is harder with a phone in the other hand. Whether that is practical is one of the first things to find out on a real phone.

## What was tested here

- The screens at 375 × 812 (portrait) and 844 × 390 (landscape) in a desktop browser's device emulation, with the synthetic replay: setup card, live screen, summary. Portrait fits without scrolling; landscape uses the two-column layout.
- The overlay mapping for portrait and landscape frames, mirrored and not, `cover` and `contain` (`tests/cameraLayer.test.ts`).
- Front/rear selection, switching, the facing reported back, the retry without constraints, background suspend and resume, and recovery from a camera the system takes away, against a pretend `navigator.mediaDevices` (same file).
- Camera shake, with synthetic sequences: a slow sway does not create or lose repetitions and leaves the figures within a few degrees; violent movement pauses measurement (`tests/assessmentEngine.test.ts`).

## What was not tested

Everything that needs a device: real cameras and their frame sizes and rates; iOS Safari and Android Chrome behaviour; whether the rear camera's wider lens changes anything; rotation mid-session; the gyroscope and its permission prompt on iOS; the wake lock; spoken instructions and tones through a phone speaker; heat and battery over a session; memory; whether the layout clears the notch and the home indicator; tracking a hand lying on a table from above.

Device emulation in a desktop browser changes the window size and nothing else. It says nothing about any of the above.

## Checklist for a real phone

Run on one iPhone (Safari) and one Android phone (Chrome). Note the model and OS version.

**Setup**

- [ ] `/patient/movement` → Composite fist → Set up the camera. The setup card fits the screen
- [ ] Each of the four setup choices changes the instructions; the two phone-pointing ones select "Rear"
- [ ] Start camera: one permission prompt, then a picture within a few seconds
- [ ] iPhone: the picture plays inline, not full-screen

**Front camera, phone propped**

- [ ] The picture is mirrored and the skeleton sits on the hand
- [ ] A whole composite-fist session completes without touching the screen
- [ ] The developer view (`…/live?debug=1`) shows the frame rate. Note it, and the "Model runs on" line

**Rear camera**

- [ ] Switch with the camera button. The picture is **not** mirrored, and the skeleton still sits on the hand
- [ ] Hand palm-up on a table, phone held above in the other hand: does it track? Does a session complete?
- [ ] With sound on, can the session be followed without seeing the screen? Turn on spoken instructions and try again
- [ ] Hand on its little-finger edge, phone above the thumb side: does the hook fist find its start position? How often does "The joints being assessed are hidden" or "Hold the phone as still as you can" appear?

**Rotation**

- [ ] Rotate to landscape mid-session: the layout changes to two columns and the skeleton stays on the hand
- [ ] Rotate back

**Interruptions**

- [ ] Switch to another app for ten seconds and return: "The camera stopped. Bringing it back…", then tracking resumes, and the session asks for the start position again
- [ ] Lock and unlock the phone mid-session: the same
- [ ] Take a phone call or trigger Siri/Assistant mid-session, if convenient
- [ ] Leave the screen with the back button: the camera indicator goes out

**Comfort**

- [ ] Every control can be reached and pressed with the thumb of the hand holding the phone
- [ ] Nothing sits under the notch or the home indicator, in either orientation
- [ ] After three sessions in a row, is the phone warm? Note the battery drop

**Someone else holding the phone**

- [ ] Can a second person follow the on-screen prompts and keep the hand framed, and read them out?
