# Running it on Windows and testing it with your own hand

The development environment this was built in has no camera access. Every screen and the whole engine have been exercised with synthetic landmark sequences, and the tracking model was run on sample photographs. A first video of the live tracking screen on your laptop showed that tracking works, and led to several changes (see "What changed after the first recording" below). **Those changes have not been tried on a real hand yet.** This page is the checklist for doing that. It takes about twenty minutes.

## What changed after the first recording

- **The hook fist is now done palm-on**, not thumb side to the camera. The tabletop is done from the little-finger edge, like a karate chop.
- **A movement is judged from where your hand started**, so a hand whose joints do not read zero when flat no longer throws it.
- **Each step is shown as a moving drawing**, before the camera starts and beside the picture during the session.
- **Tries that fall short are recorded** as "did not reach the set position", and after two the app offers help.
- **The hand should no longer flip to "left"** on a flat palm, and "Tracking is unsteady" should appear less in a dim room.

The most useful thing to check first: does a hook fist, palm to the camera, now record?

Please note what you see against each step. The outcomes are the first real data this system has.

## Run it

Needs Node.js 20 or later.

```powershell
npm install
```

```powershell
npm run dev
```

The first `npm run dev` copies the tracking runtime into `public/` and downloads the hand-tracking model (about 8 MB, once, from Google's public model storage) so the app can serve it itself. If that download fails, the app still works: the browser fetches the model the first time instead.

Open `http://localhost:5173/present` in **Chrome or Edge**. Allow the camera when asked.

Other commands:

```powershell
npm test
```

```powershell
npm run build
```

## 1. Preflight (2 minutes)

On section 1 of `/present`, press **Run the check**.

- [ ] Camera: green, with your webcam's name and frame size
- [ ] Hand-tracking model: green, "running on the graphics processor". Amber and "main processor" means no graphics acceleration: it will work, slowly
- [ ] Tracking speed: note the frames per second and the model's milliseconds per frame. **This is the first real frame-rate measurement.** Around 30 is the aim; under 20 will feel laggy
- [ ] Lighting: green
- [ ] Works without a connection: green. Then turn Wi-Fi off, reload the page, run the check again: it should still pass

## 2. Free tracking (5 minutes)

Press `2`. Click the bug icon to open the developer view.

**Which hand.** This is the most important check.

- [ ] Hold up your **right** hand, open, palm to the camera. The developer view's "Hand" line should say `right (by model)`
- [ ] Make a fist. It should change to `right (by shape)` and stay `right`
- [ ] Repeat with your **left** hand: `left`
- [ ] "Model label / shape" should show the same side twice. If the model label is the opposite of your actual hand every time, tell me: the app corrects for it from the hand's shape, but the default assumption would be wrong

**Overlay.**

- [ ] The skeleton sits on your hand, not beside it, and moves the way a mirror would (move right, it moves right)
- [ ] Fingertip dots sit on your fingertips when the hand is near each edge of the picture
- [ ] It keeps up with a quick open-and-close without visibly trailing
- [ ] Held still, the skeleton does not shimmer

**Estimates.** Use the index finger read-out.

- [ ] Open hand, palm-on: all three joints near 0°, tagged "Depth-inferred". Note the actual values
- [ ] Full fist, palm-on: roughly MCP 70 to 90, PIP 80 to 110, DIP 40 to 80. Note the actual values. They will not be exact, and palm-on they may be badly off joint by joint while their sum is reasonable
- [ ] Turn side-on, like a karate chop (little-finger edge to the camera). Select "Little". Its dials go from dotted to solid and say "In view". The "View" line reads `ulnar`
- [ ] Side-on, bend only the big knuckle to about a right angle: does the little finger's MCP rise towards 90 while PIP and DIP stay low?
- [ ] Palm-on, hook (knuckles straight, end joints bent): MCP stays low, PIP and DIP rise
- [ ] Bend a finger back slightly past straight: the reading goes negative

**Quality.**

- [ ] Move the hand half out of the picture: "Keep your whole hand in view"; the developer view shows `clipped`
- [ ] Move far away: "Bring your hand a little closer". Move very close: "Move your hand slightly farther away"
- [ ] Wave the hand quickly across: `moving-fast`
- [ ] Take the hand away: "Show your hand to the camera"; the skeleton lingers for a moment (a held frame) and goes
- [ ] Bring in a second hand: the tracker stays on the first, and "A second hand is in view" appears
- [ ] Dim the room: does tracking degrade, and does the low-light notice appear?

## 3. An assessment (5 minutes)

Press `3`, **Composite fist**, your hand, **Begin the assessment**, **Start camera**.

- [ ] Open hand, held still: "Starting position found. Hold it", then "Close your hand into a comfortable fist"
- [ ] Fist: "Hold it there", and the ring fills over two seconds
- [ ] Open: "Recorded…" then a tone, a ring from the palm, and the count goes to 1
- [ ] **A half-closed hand does not count as valid.** Close about halfway and open again: the count stays where it was, and the line under it says the try did not reach the set position
- [ ] Do that twice: "Finding the movement difficult?" appears. Open it, read it, press "Carry on"
- [ ] **A quick fist does not count.** Close and open inside a second: nothing recorded, or "1 not recorded"
- [ ] **Waving an open hand does not count.**
- [ ] Take your hand out of view mid-hold for a couple of seconds: that attempt is rejected, and the app asks for the start position again
- [ ] **Pause** stops everything; **Resume** asks for the start position again
- [ ] After three valid repetitions the summary appears by itself
- [ ] The summary's figures look like what you did, every joint says "Depth-inferred", and the tag at the top says "Camera"

Then the other two, which are the ones most likely to need adjusting:

- [ ] **Hook fist**, palm to the camera. Does it find the start position? Does it record? Note the "Progress to target" figure in the developer view at the top of your hook
- [ ] **Tabletop**, side-on from the little-finger edge. Does it track at all in that position? Does it record? This is the least certain of the three
- [ ] Try the tabletop palm-on as well: it should refuse and ask for the side view

If a movement is not recognised when you clearly made it, open the developer view and note the "Primary quantity" value at the top of your movement. The detection thresholds are in `src/assessment/definitions.ts` and in the clinician record's protocol settings.

## 4. The record (3 minutes)

- [ ] Press `4`: the session you recorded
- [ ] Press `5`: your session is a filled point; the illustrative history is hollow on a dashed line, and the two are not joined
- [ ] "Open the full record" → Movement and check-ins. Change "Hold" to 3 seconds in the protocol, run the assessment again, and check the hold now takes three seconds
- [ ] Under "Reference readings", enter a made-up goniometer reading and check the difference is shown
- [ ] Press `R` on `/present`: your sessions go; the illustrative history stays

## 5. The backup

- [ ] Press `B`. Sections 2 and 3 run on a drawn hand, labelled "Synthetic replay" in the header, on the stage, in the summary and in the clinician record

## 6. Things that can only be judged by eye

The app cannot tell when the skeleton is confidently wrong. Please watch for, and note:

- The skeleton drawn on the wrong hand, on a face, or on something that is not a hand
- A finger's skeleton drawn on the neighbouring finger
- Left and right swapping while the hand is still
- "In view" shown for a joint you can see is hidden, or "Not seen" for one that is plainly visible

## What to send back

The filled-in list, the preflight's frame rate and model time, and for anything odd a landmark recording: developer view → **Save landmark recording**. It contains landmark coordinates only, no picture, and lets the same movement be replayed through the engine exactly as you made it.
