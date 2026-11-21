# Five-minute technical demonstration

Route: **`/present`** (from the demo controls page: "Open the demonstration"). Five sections, about a minute each. Everything on it runs the same tracker and engine as the patient app.

## Before the call

1. `npm run dev`, open `http://localhost:5173/present` in **Chrome or Edge**, in its own window.
2. Press **Run the check** on section 1 (Preflight). All five lines should be green. It reports the camera, where the model loaded from, the measured frame rate and whether tracking will start without a connection. If "Tracking speed" is amber, close other tabs and anything else using the camera or graphics.
3. Do one full run of section 3 with your own hand. Then press **R** to reset, so the results section starts empty.
4. Light your hand from the front: face a window or a lamp. A plain background behind the hand helps.
5. In Teams, share **the browser window**, not the whole screen. Close the Teams camera preview if tracking stutters: both use the same camera and some drivers halve the frame rate when shared. If Teams has the camera and the browser cannot open it, the app says "The camera is in use"; turn your Teams video off for the demonstration.
6. Press **F** for full screen.

| Key | Does |
| --- | --- |
| `1` to `5` | Jump to a section |
| `←` `→` | Previous, next section |
| `F` | Full screen |
| `B` | Switch between the camera and the labelled synthetic replay |
| `N` | Speaker's notes at the bottom of the screen |
| `R` | Reset: removes sessions captured here, keeps the illustrative history |
| Bug icon | Developer view: raw landmarks, every joint, quality reasons, timings |

## The script

### 1. What it measures (about 45 seconds)

> "Ntact has two halves. The wearable measures and assists touch at the fingertip. This is the other half: software that uses an ordinary camera to estimate how the finger joints move.
>
> It finds 21 landmarks on the hand, about thirty times a second, entirely on the device. No video is stored or sent. From those it estimates flexion at the MCP, PIP and DIP joints of each finger.
>
> Three things it does not do. It does not measure sensation: that is what the hardware is for. The angles are estimates from one camera view and have not been compared with goniometry. And nothing here scores recovery or makes a decision.
>
> One design choice matters most: every estimate carries how the joint was seen. 'In view' means the joint bent across the picture, so the angle is visible in the image. 'Depth-inferred' means it bent towards the camera and we are relying on the model's estimate of depth. 'Not seen' means it was hidden, and we give no number."

### 2. Live tracking (about 60 seconds)

Press `2`. Hold your hand up, palm to the camera.

> "These are live landmarks. The numbers are the estimates for the index finger; I can switch finger here."

Slowly make a fist and open it. Then turn the hand side-on, thumb towards the camera.

> "Watch the dials. Palm-on, the arcs are dotted: every joint is 'depth-inferred'. As I turn the hand side-on, like a karate chop, the finger nearest the camera goes solid, 'in view': the software knows the bend now lies across the picture. The fingers behind it go to 'not seen' rather than being guessed."

Optional, if asked how it works: click the bug icon.

> "This is the developer view: the cyan points are what the model reported before smoothing, and this panel shows the frame rate, the model's time per frame, and why a frame is or is not usable."

### 3. Movement assessment (about 90 seconds)

Press `3`. Leave **Composite fist** selected, set the **Hand** switch to the hand you will hold up, press **Begin the assessment**, then **Start camera**.

> "This is a structured assessment, not gesture recognition. It is a state machine. It waits for a start position…"

The drawing beside the picture shows each step as you reach it. Hold your hand open, palm to the camera, until "Starting position found".

> "…then for the target…"

Close into a fist and hold. The ring fills over two seconds.

> "…and it only counts the hold while tracking is usable. When I open my hand again, the repetition is recorded."

Open. Do a second repetition normally. On the third, **close and open again straight away**.

> "That one I let go early. It is recorded as rejected, counted separately, and never averaged into a result."

Do one more full repetition to reach three. The summary appears by itself.

> "The thresholds here are detection thresholds, set per patient by a clinician. They are not targets, and the app never unlocks a movement itself."

### 4. Results (about 45 seconds)

Press `4` (or stay on the summary).

> "This is what was just captured. Completion, three of three valid and one rejected, is kept apart from the estimates. Each joint has its held value, its start value, the arc between them, and how it was seen. This was palm-on, so every joint says 'depth-inferred'.
>
> Below that is the capture quality: how much of the session had usable tracking, the view, the frame rate. That travels with the session, so a clinician can tell a change in the hand from a change in the camera."

### 5. Clinician view (about 60 seconds)

Press `5`.

> "In the clinician record. The dashed line is illustrative example data, marked as such; the session I just recorded is the solid point. The software will not join the two, and it will not join sessions taken from different views.
>
> Below it is the sensory test from the wearable on the same dates. Movement and sensation are different things, so they sit side by side and are never merged into a score.
>
> A clinician can also set the protocol per patient, and enter goniometer readings against a session. That last part is why we are here: we have built this so it can be validated, and we would like to do that properly, with you."

## If something goes wrong

| What you see | Do this |
| --- | --- |
| "The camera was blocked" | Click the camera icon in the address bar, allow, then **Try again** |
| "The camera is in use" | Turn off your Teams video (or close the other app), then **Try again** |
| "Hand tracking couldn't load" | The model is not on this machine and there is no connection. Run `npm run fetch-model` beforehand, or press `B` |
| Skeleton jitters or drops out | More light on the hand; move the hand so it fills about half the picture; plain background |
| "Tracking is unsteady" keeps appearing | Same as above. It means the app is refusing to measure, which is the behaviour to point out |
| A repetition will not record | Check the phase strip: the start position has to be found first (open hand, held still). Hold the fist until the ring is full |
| "Finding the movement difficult?" appears | It is the app noticing tries that fell short. Either ignore it, or open it and show it: it says to go only as far as is comfortable, and that the tries are saved for the therapist. It is a good thing to demonstrate |
| Nothing works | Press **`B`**. The header changes to "Backup: synthetic replay" and every section still runs, on a drawn hand that is labelled as synthetic on screen and in what it saves. Say so: "This is a synthetic sequence replayed through the same engine, because my camera is not cooperating" |

Never present the synthetic replay as a live measurement. The screen will not let you: it is labelled in the header, on the stage, in the summary and in the clinician record.

## If someone asks "what happens when a patient can't do the movement?"

Show it. In section 3, close your hand only halfway, twice. Each try is recorded as "did not reach the set position" with how far it went, the count of valid repetitions does not move, and after the second one the app offers help. The help sheet tells the patient to go only as far as is comfortable, never to force it, and that what they managed is saved for their therapist, who can change the setting. The clinician record then shows those tries, separately from valid repetitions.

> "The app never pushes a patient to reach a position, and a movement that falls short is information for the clinician, not a failed test."

## Questions to expect

- **"How accurate is it?"** "We do not know yet, and we are not going to quote a number we have not measured. What we have seen ourselves is limited: on a handful of sample photographs, single joints seen palm-on were off by tens of degrees while their sum was close. That is why each estimate carries how it was seen, and why we would like to run an agreement study against goniometry with you."
- **"Why would a nerve-injury patient need movement tracking?"** "They may not: isolated digital nerve injury can leave movement intact, and what is appropriate depends on the injury and the repair. It is offered as a clinician-configured assessment, switched on per patient, for the cases where movement is being followed, such as combined nerve and tendon injuries."
- **"Is this a medical device?"** "No. It is a research prototype with fictional data. Nothing in it is diagnostic."
- **"Where does the video go?"** "Nowhere. The model runs in the browser on the device. Only the session's figures are stored, and in this prototype they stay in the browser."
- **"Does it work on a phone?"** "It is built for it: front and rear cameras, portrait and landscape, hands-free once started, with spoken prompts. We have tested the layouts and the engine; we have not yet done structured testing on physical phones, and we say so in the documentation."
