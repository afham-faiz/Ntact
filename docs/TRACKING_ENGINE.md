# Hand tracking and movement assessment: how it works

For an engineer picking this up, or a clinical research collaborator who wants to know exactly what a number on the screen is. Everything described here is implemented and covered by tests. What has and has not been verified is in the last section, and the plan for validating it is in `VALIDATION_PLAN.md`.

**Status: research prototype. Not a medical device. The angle estimates have not been compared with goniometry.**

## One page summary

```
camera frame ──► MediaPipe Hand Landmarker ──► choose one hand ──► stabilise ──► which hand
                 (on the device, 21 points)                         │             (left / right)
                                                                    ▼
   stored session ◄── summary ◄── assessment engine ◄── frame quality ◄── geometry
   (estimates, grade,           (state machine:                          (palm axes, joint
    capture details)             start ► target ► hold ► return)          angles, view, occlusion)
```

| Folder | What it holds | Depends on |
| --- | --- | --- |
| `src/tracking` | Geometry, filter, stabiliser, frame quality, the tracker, the kinematic hand model, recordings | nothing but itself |
| `src/assessment` | Movement definitions (data), the engine (state machine), session summary and statistics | `src/tracking` |
| `src/camera` | Camera stream, model loading, the frame loop, where landmarks land on screen, drawing | browser APIs, `src/tracking` |
| `src/features/movement` | The live screen, session report, trend chart, instructional figure | all of the above, React |

`src/tracking` and `src/assessment` are pure TypeScript with no browser, camera or clock in them. They are given frames and timestamps and return values, which is why the same code runs on a live camera, on a replayed recording and in the tests.

## 1. The tracking model

MediaPipe Hand Landmarker (`@mediapipe/tasks-vision`, float16 model, version 1), running in the browser through WebAssembly with the graphics processor where available and the main processor otherwise. No model is trained in this project.

Per hand, per frame, it returns:

- **21 picture landmarks**: `x` and `y` as fractions of the camera frame, and `z` as a depth relative to the wrist on the same scale as `x`.
- **21 "world" landmarks**: the same points as a hand-shaped set in metres, centred on the hand, with axes aligned to the camera (x right, y down, z away). This is the model's *estimate* of the 3-D hand from one picture. Its depth is inferred, not measured, and its scale is an assumed hand size.
- **A left/right label with a score.** This is the only confidence value the API exposes. There is no per-landmark confidence.

Up to two hands are requested so that a second hand in the picture is seen and deliberately ignored rather than confused with the first (`chooseObservation` in `tracker.ts`: the hand already being followed wins; otherwise the hand the session expects; otherwise the larger).

**Offline.** The WebAssembly runtime is served by the app (`public/mediapipe/wasm`). The model file is looked for in this app's own `public/mediapipe/models` (put there by `scripts/fetch-model.mjs`, which runs before `dev` and `build`), then in the browser's cache storage (it is stored there after the first download), then on the network.

**Warm-up.** The first run of the model compiles it for the graphics processor and takes one to three seconds. That is spent on a blank picture when the model loads, not on the first frame of a session.

## 2. Stabilising the landmarks (`stabiliser.ts`)

Four jobs, in order, every frame:

1. **Reject implausible jumps.** A frame is discarded when, relative to the last accepted frame, the palm's centre moved more than 34 palm lengths per second, or the hand's size in the picture changed faster than 7× per second, or any single landmark moved more than 18 palm lengths per second after the hand's own travel is taken out. The limits scale with the time since the last accepted frame. If the "jump" persists for three frames it is believed and the track restarts there.
2. **Bridge short gaps.** For 300 ms after the hand is lost, the last good frame is held for drawing. A held frame is marked and is never used for a measurement. After that the track is dropped.
3. **Smooth.** A One Euro filter (Casiez, Roussel and Vogel, 2012) on every coordinate of the picture and world landmarks: minimum cut-off 1.6 Hz, beta 2.4 Hz per palm-length-per-second, derivative cut-off 1.2 Hz. Speed is judged against the palm's size, so the same settings hold near and far from the camera.
4. **Report steadiness.** *Jitter*: the median over the landmarks of the second difference of the raw positions, in palm lengths (zero for steady motion, large for noise). *Palm speed*: how fast the palm's centre is crossing the picture, in palm lengths per second.

**Why One Euro.** It needs two intuitive parameters. A Kalman filter would need a motion model and noise covariances that would have to be invented for a hand; a fixed moving average either lags a fast fist or leaves a held posture jittery. Measured in `tests/trackingPipeline.test.ts` on synthetic landmarks with synthetic noise (0.008 palm lengths, 30 frames a second): a 1 Hz open-and-close keeps its full amplitude with about 17 ms of lag, and the frame-to-frame wobble of a held fist's composite angle falls from 3.2° to 1.2° (63% less). Those figures describe the filter, not a camera.

## 3. Which hand (`SideResolver` in `tracker.ts`)

The sign of every flexion angle depends on which side of the hand is the palm, so left and right matter.

- The **model's label** is the working answer, as a running tally so one mislabelled frame does not flip it. The model's own documentation says the label names the person's actual hand for an unmirrored picture, which is what the app gives it: the mirror view on screen is a display choice only.
- The **hand's shape** is the check. Fingers only curl towards the palm, so once they are clearly bent the curl direction settles left versus right independently of the label (`chiralityFromCurl`: the mean over the fingers of sin(MCP) + sin(PIP) + sin(DIP), signed as if for a right hand; a value beyond ±1.5 for four frames is taken as certain, which only a hook or a fist reaches). From then on the shape's answer is kept while the hand stays in view. The threshold was 0.8 until the first recording of a real hand: depth errors on a flat palm made it read as bent back far enough to cross that, and the hand briefly flipped to "left".
- If the shape and the label disagree twice running and never agree, the label is read the other way round for the rest of the session. A model release that reported handedness the opposite way would correct itself the first time a fist is made.

Until the shape has confirmed the hand, palm and back cannot be told apart for certain from a flat hand, so the engine treats "palm view" and "back-of-hand view" as interchangeable until then.

## 4. Geometry (`geometry.ts`)

All angles come from the **world** landmarks.

**Palm axes.** From the wrist (0) and the index and little knuckles (5, 17): `palmar` is the normal of that plane (pointing out of the palm, using left/right), `distal` runs from the wrist to the mean of the four knuckles within the plane, and `radial` points to the thumb side. Palm length (wrist to middle knuckle) is the unit for every relative distance.

**Joint angles**, flexion positive, in degrees:

| Joint | Definition |
| --- | --- |
| Finger MCP | How far the proximal phalanx is raised towards the palm **relative to the finger's own metacarpal line** (wrist to knuckle), both measured in the finger's sagittal plane. Spreading the fingers does not change it. Negative is hyperextension. The palm plane as a whole was the reference at first; on a real hand the knuckles do not lie in one plane with the wrist, and a flat hand then read 15 to 30 degrees away from zero. |
| Finger PIP, DIP | The 3-D angle between the two bones that meet at the joint, signed by the direction it folds about the finger's hinge axis (`metacarpal × palmar`). |
| Thumb MCP, IP | The unsigned 3-D angle between the two bones. The thumb's hinge is not fixed relative to the palm, so no sign is attached. |

Derived from those: **composite flexion** (MCP + PIP + DIP), **fingertip reach** (tip-to-knuckle distance over finger length; about 1 straight, about 0.3 in a fist) and **thumb-to-fingertip distance** in palm lengths.

**View.** From the palm axes against the camera's line of sight: `palmar`, `dorsal`, `radial` (thumb side towards the camera), `ulnar`, `oblique`, or `end-on` (fingers pointing along the line of sight).

**How each joint was seen: the grade.** This is the core of the measurement-quality design.

- `inPlane` is how closely the joint's hinge axis lines up with the camera's line of sight (0 to 1). Looking straight down the hinge, a side view of the finger, the whole bend lies across the picture. Palm-on, the bend is along the line of sight and the angle rests entirely on the model's inferred depth.
- **direct**: `inPlane` ≥ 0.75 (the bend lies within about 41° of the picture plane) and the joint is not hidden.
- **inferred**: visible, but the bend is mostly along the line of sight.
- **unavailable**: the occlusion check marks one of the joint's landmarks as hidden.

`inPlane` is a geometric fact about the view. It is not a probability and is never presented as one.

**Occlusion (a heuristic, and labelled as one).** In the picture, a landmark is marked hidden when another finger's bone passes within 0.17 palm widths of it and is nearer the camera by at least 0.1 palm widths, or when it lies inside the palm's outline and behind it. Which of two overlapping parts is in front comes from the model's relative depth, which is itself an estimate; the check errs towards marking a joint hidden.

## 5. Frame quality (`tracker.ts`)

A frame may contribute to a measurement only when none of these applies:

| Reason | Check |
| --- | --- |
| `no-hand`, `tracking-held` | No hand, or the frame is a held copy of the last one |
| `clipped`, `too-far`, `too-close` | A landmark within 2% of the picture's edge; the hand smaller than 16% or larger than 86% of the picture |
| `device-moving` | The phone's gyroscope reports more than 45° per second (where the device has one) |
| `moving-fast` | The palm crossing the picture faster than 1.8 palm lengths per second |
| `unstable` | Jitter above 0.07 palm lengths (0.05 flagged a visibly steady hand in a dim room on the first real recording, where jitter ran from 0.02 to 0.06) |
| `settling` | Fewer than 350 ms of unbroken tracking |

Advisories that do not block: `low-light` (mean picture brightness under 40 of 255, sampled twice a second from a 32 × 24 copy of the frame), `low-frame-rate` (under 12 a second), `second-hand`.

The engine adds two of its own: `view` (the hand is not in a view the assessment accepts) and `hidden` (no assessed digit has all the needed joints at the required grade).

**Camera movement and hand movement.** From one hand alone the camera cannot tell whether it moved or the hand did. Joint angles are computed in the hand's own frame, so rigid movement of either does not change them directly; what it does is blur the picture and unsettle the landmarks. So rigid movement is not corrected for, it is detected and the measurement is paused: by palm speed in the picture, by jitter, and on a phone by the gyroscope, which does know when the phone itself is turning.

## 6. The assessment engine (`engine.ts`)

A movement is described as data (`definitions.ts`): start criteria, target criteria, the joints that matter, the views it accepts, and clinician-configurable parameters. The engine that runs it knows nothing about any particular movement.

```
searching ─► positioning ─► settling ─► ready ─► holding ─► release ─► ready … ─► complete
```

| State | Meaning | Leaves when |
| --- | --- | --- |
| searching | no hand | a hand is tracked |
| positioning | a hand, but a blocker: quality, view, hidden joints, or not at the start | usable frame and start criteria met |
| settling | at the start position | held for 600 ms; start values are captured |
| ready | waiting for the movement | target criteria met |
| holding | at the target; usable time accumulates towards the hold | hold complete, or the target is left, or tracking is lost |
| release | hold complete; waiting for the hand to return | start criteria met for 250 ms: the repetition is recorded |
| complete | the configured number of valid repetitions is recorded | |

Rules that make the count trustworthy:

- **A repetition is start → target held → start.** A hand that starts closed is asked to open first. A hand that stays closed records one hold, not several.
- **The hold counts only usable frames.** Tracking gaps shorter than 500 ms are ridden out but not counted; longer ones abandon the attempt.
- **Target positions are judged as a change from the start position**, digit by digit, not as absolute angles. On the first real recording a flat finger read anywhere from about −30° to +33° at a joint depending on the view. Measuring the movement from where that hand started takes the offset out. The values that are *stored* stay absolute: start, held and the arc between them.
- **Back at the start means the start position and no longer the target.** A tabletop moves one joint, so the bent hand can still satisfy "fingers nearly straight" on the sum of its joints.
- **A try that falls short is kept.** If the hand moves at least 35% of the way to the target, stays away from the start for half a second and comes back without reaching it, a rejected repetition is recorded as `target-not-reached` with the furthest point reached. It is never counted as valid, and it is what tells a clinician that the movement was attempted and how far it went.
- **Hysteresis** of 10° (0.06 palm lengths for distances) stops flicker at a threshold.
- **Rejected is not valid.** Falling short (`target-not-reached`), reaching the target and then leaving early (`hold-too-short`), losing tracking (`tracking-lost`) or wandering by more than the configured amount (`unsteady`, judged by 1.4826 × the median absolute deviation so the tail of the movement into the hold does not count against it) leaves a *rejected* repetition. Rejected repetitions are stored and counted, and are never averaged into a figure.
- **A quantity is the mean over the assessed digits that can be seen.** A digit whose joints are not at the required grade is left out. It is never filled in. If none can be seen the quantity is "not evaluable" and the state is `hidden`.
- **What is recorded per repetition:** for each joint of each digit seen, the *held* value (median over the hold), the *peak*, the *start* value (median over the rest before the movement) and the weakest grade it was seen at; the hold's length and steadiness; time to target; the view; the share of usable frames.
- **Feedback** is chosen from the state and the first blocker. A specific correction ("keep your knuckles straight") is given only when it is the single criterion not met and the data for it is usable.

The engine is deterministic: the same frames always give the same repetitions.

### The movements

Standard tendon-gliding positions (Wehbé and Hunter, 1985) and thumb opposition. The thresholds below are **detection thresholds**: how far a joint must move for the software to recognise the position. They are not therapeutic targets or normal ranges, they have not been tuned on patients, and a clinician can change each one per patient.

| Assessment | Start (absolute) | Target (change from the start) | View asked for in front of a camera | Under a hand-held phone | Status |
| --- | --- | --- | --- | --- | --- |
| Composite fist | composite ≤ 75° | composite +120° | palm-on | palm up on a table | core |
| Hook fist | composite ≤ 75° | PIP + DIP +85°, MCP no more than +45° | palm-on | palm up on a table | core |
| Tabletop | composite ≤ 75° | MCP +45°, PIP + DIP no more than +45° | side-on, little-finger edge | side-on, thumb side up | core |
| Thumb opposition | tip gap ≥ 0.6 palm | tip gap ≤ 0.3 palm (absolute) | palm-on | palm up on a table | exploratory |
| Single finger flexion | composite ≤ 75° | composite +100° (one finger) | palm-on (little finger: its own side) | palm up | exploratory |

Default: three valid repetitions, each held for two seconds.

**Which view for which movement.** Side-on, the finger's bend lies across the picture and the angles are read directly, but only the finger nearest the camera is fully visible: the little finger from its own side, the index from the thumb side. Palm-on, all four fingers are visible but they curl towards the lens, so every angle is depth-inferred.

The views asked for have to be ones a person can hold. The first version asked for the thumb side of a raised hand to be turned to the camera for the hook and the tabletop. The first real recording showed two things: that position is awkward (the natural side-on position in front of a camera presents the little-finger edge, like a karate chop), and edge-on the model's landmarks for the stacked fingers did not follow a hook at all. So the hook is now asked for palm-on, where it is comfortable and the model tracks well, at the price of depth-inferred angles; and the tabletop, which cannot be read palm-on because the fingers would point at the lens, is asked for from the little-finger edge. Each definition carries two recommended views (`views.facing` for a hand held up to a camera, `views.overhead` for a hand resting on a table under a phone) and a list of every view it will accept. No camera-angle correction is attempted for joints that cannot be seen.

## 7. Sessions (`session.ts`)

A stored session holds the repetitions (valid and rejected), a summary (medians across valid repetitions only), capture quality (share of frames tracked and usable, frames discarded as jumps, how long each blocker was present), and what is needed to reproduce or compare it: the assessment's version, the parameters and minimum grade in force, hand and digits, the dominant view, camera setup, frame size and measured frame rate, model, filter and engine version.

- **Three kinds of data, never mixed.** `camera` (a person's hand), `synthetic-replay` (the kinematic model replayed through the engine) and `seed` (illustrative history). `synthetic` is false only for `camera`.
- **Comparability** (`comparability`): two sessions are put on one line only if the assessment, its version, the hand, the finger, the camera view, the engine's major version and the kind of data all match. The clinician chart draws non-comparable sessions in grey and leaves them off the line.
- **No score.** Completion (repetitions done) and the estimates are separate fields and separate parts of every screen. There is no combined percentage, and no normal range anywhere in the codebase. Comparison is with the same person's earlier sessions only.
- **Repeatability** (`withinSession`, `betweenSessions`) and **agreement with a reference instrument** (`agreement`: bias and Bland–Altman limits; `referencePairs`) are implemented as plain statistics over stored sessions. The clinician record has a form for entering goniometer readings against a session.

## 8. Synthetic data and replay

`handModel.ts` is a kinematic hand: joint angles in, 21 landmarks out, from any viewing direction, for either hand, with seeded noise, camera shake, drop-outs and glitches (`recording.ts`). It exists so that the geometry and the engine can be tested against hands whose angles are known exactly. Its proportions are those of the app's hand illustration (a broad palm, a level row of knuckles, a short thumb), because the same model draws the instructional figures; they are not measurements of anyone's hand, and the joint-angle tests do not depend on them. **Nothing it produces was observed from a person**, and everything built from it is marked synthetic in storage and on screen.

A **landmark recording** (`ntact-landmarks`, version 1) holds landmark coordinates only, never a picture, and says whether it is `synthetic` or `recorded`. `replay()` runs one through the tracker and the engine exactly as a camera session runs. In the developer view of a live session, "Save landmark recording" exports the session's landmarks as a file, so a consented recording of a real hand can be replayed through a changed algorithm.

## 9. The camera layer (`src/camera`)

- **`cameraStream.ts`**: asks for the front or rear camera as a preference, reads back what was actually opened, mirrors the display for a front camera only, retries without size preferences if the camera refuses them, switches the camera off when the page goes to the background and brings it back afterwards, tries once to recover a camera that the system took away, and always releases it on leaving.
- **`viewport.ts`**: where a landmark lands on screen for any frame shape, box shape, `cover` or `contain`, mirrored or not. The frame's size is read every frame, so turning a phone mid-session is followed.
- **`trackingLoop.ts`**: polls the source once per display frame, runs the model once per new camera frame, measures frames per second and model time, and switches to every other frame if the model's time stays above 42 ms (back when it stays under 24 ms).
- **Main thread, not a worker.** The model's runtime loads its WebAssembly in a way module workers do not support in every targeted browser, and with graphics acceleration its time per frame is small next to the frame interval. The pipeline after the model costs about 0.03 ms a frame.
- **`sensors.ts`**: picture brightness, the phone's gyroscope (with the permission request iOS requires), and a screen wake lock for the length of a session.

## 10. What has been verified, and what has not

**Verified by automated tests (synthetic inputs):** joint-angle geometry recovers the angles a hand was posed with, for both hands, from every viewing direction, with spread and hyperextension; left/right from shape; view classification; the occlusion check on canonical views; the filter's lag and smoothing; jump rejection, gap bridging and re-acquisition; every quality reason; every engine state transition, false-repetition case, hold and interruption; session summary, comparability and statistics; recordings; where landmarks land on screen; the camera stream's life cycle against a pretend camera; and one whole session played through the real screen. See `npm test`.

**Verified in a browser on the development machine:** the model loads from the device's cache and runs on the graphics processor; on four public sample photographs it found the hands, its left/right label agreed with the shape check in all four and with what two unambiguous photographs show; the model took a median of 13 to 19 ms a frame on those stills; every screen was exercised with the labelled synthetic replay at desktop, phone-portrait and phone-landscape sizes; the camera-refused path shows its message and the fallback.

**Observed on those photographs, and worth knowing:** for a straight index finger seen palm-on, the three joint estimates were about −15°, −17° and +42°: wrong at each joint by tens of degrees, in opposite directions, while their sum was close to the true zero. That is three photographs, not a study, but it is exactly what the "depth-inferred" grade is there to warn of. Palm-on, treat single-joint figures with particular caution; the composite is steadier.

**Seen on one real recording (a phone video of the developer view on the team's laptop, right hand, dim warm room, 21 November 2026):** live tracking works and the skeleton sits on the hand, palm-on and side-on. The model ran on the graphics processor at 20 to 63 ms a frame, giving 21 to 36 frames a second with a video playing in another tab. The model's left/right label matched the real hand. It also showed the four problems recorded above: the thumb-side view is awkward and the natural side-on view is the little-finger edge; edge-on, the model did not follow a hook; a flat finger's joints read up to 30° from zero and differently in each view; and the hand briefly flipped to "left" on a flat palm. The fixes for all four are in place but **have not themselves been re-tested on a real hand yet.** One recording, one hand, one room: an observation, not an evaluation.

**Not verified, because the development browser has no camera access:** any of this at first hand; the changes made in response to that recording; lighting and motion-blur behaviour; any phone (iOS Safari, Android Chrome), the rear camera, rotation, the gyroscope, spoken instructions on a device. `TESTING_WITH_YOUR_HAND.md` and `MOBILE_TESTING.md` are the checklists for those.

**Not established at all:** how close any estimate is to a goniometer reading. See `VALIDATION_PLAN.md`.

## Known limitations

- One camera cannot measure depth. Every angle that bends along the line of sight is an inference by the model, and is labelled so.
- Landmarks are where the model learned joint centres to be, not the bony landmarks a goniometer is aligned to. A systematic offset from goniometry is likely and unmeasured.
- Side-on, only the finger nearest the camera is seen. The middle and ring fingers have no view in which their joints are read directly while the hand is closed.
- Edge-on, with the fingers stacked behind one another, the tracking model itself is at its weakest: on the one real recording its landmarks did not follow a hook from the little-finger edge. The tabletop is still asked for from that side because it cannot be read palm-on; whether it is reliable there is the first thing to find out.
- From the thumb side, a resting thumb covers the index finger's knuckle and a curled fingertip goes under it. The instructions ask for the thumb to be held back; the occlusion check reports the joint as not seen otherwise.
- The occlusion check and the steadiness measures are heuristics with hand-set thresholds. They have not been tuned on real recordings.
- The thumb's angles are unsigned and the simplest part of the geometry. Thumb opposition is reported as a distance relative to the palm, not as an angle, and not in millimetres: the camera has no scale.
- The detection thresholds are untested on patients, including on hands with swelling, scarring, dressings, splints or a different shape after injury, any of which may also affect the tracking model itself.
- Skin tone, hand size, jewellery, nail varnish and lighting may all affect the tracking model. None has been evaluated here.
