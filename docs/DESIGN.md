# Design

## Current direction: the pitch-deck palette, on glass (14 November 2026)

This replaces the flat direction described further down, which is kept for history.

- **Colour from the team's slides.** Deep navy `#14213D` (`ink`), gold `#ECB424` (`mint`), a mid blue for data `#2E4A7D` (`teal-600`), red `#B8413C` (`wine-600`), on white. The token names are unchanged so every screen re-skinned at once.
- **Red means a problem.** Same-day flags and errors only. Decoration (underlines, the active tab, highlights) is gold; step numbers and links are blue.
- **Frosted glass over a lit ground.** Cards, bars and the tab bar are translucent white with a blur (`.glass`, `.glass-bar`); on navy they are `.glass-dark`. The ground (`.ground`, `.ground-wide`) is white with soft gold and blue light for the glass to catch. Shadows are back.
- **Icons are Phosphor** (`@phosphor-icons/react`, MIT): outline at rest, filled when active. Used in the tab bar, the Today list, Help and the clinician menu.
- **Less on each screen.** Today is a three-item to-do list. Charts live on Recovery. Troubleshooting lives on Help, reached from the "?" at the top right of every screen. The clinician record is three tabs instead of eleven panels.
- **One accent per surface.** On navy the primary action is gold. On white it is navy.

---

## Earlier direction (superseded)

This is the fourth visual direction. The first three were rejected in review (flat editorial with a serif; a rounded-card "dashboard kit" look; a version too close to the UKMLA site). What survived is recorded here.

## Principles

- **Colour from the UKMLA reference, nothing else.** Only its palette is borrowed, not its layout or type.
- **Flat.** No shadows, no gradients, no glass.
- **Few icons.** Hierarchy comes from type size, weight and spacing. Icons stay only where they carry meaning (outcome marks in charts, the back arrow).
- **Quiet metadata.** Status is plain text, not a pill.
- **Cards used selectively.** Patient home is sections divided by rules. Clinician pages use bordered panels where a table or a group of controls needs a container.
- **Burgundy is rare.** On the patient side it is an accent (one underline in the headline, link underlines, the active tab). On the clinician side it also means priority review.

## Colour

Sampled from `UKMLA_Colour_Reference.png`:

| Token | Value | Use |
| --- | --- | --- |
| `ink` | `#223641` | Text, navy header and sidebar, primary buttons, chart marks |
| `mint` | `#C4F1C9` | Primary action on navy, "today" highlight |
| `wine-600` | `#992335` | Accent; priority review |
| `floor` | `#F4F2EE` | Page background |
| `paper` | `#FFFFFF` | Panels |
| `rule` | `#DBDAD8` | Hairlines and borders |

Derived (not in the screenshot): `ink-soft #5A6A72` for secondary text, `mist #B6CBD3` for text on navy, `wine-500 #B93349` for burgundy on navy, `amber-500/700` for "review suggested".

Older teal and violet tokens still exist in `src/index.css` but the chart palette (`src/components/palette.ts`) maps them to ink, and screens no longer use them for emphasis.

## Type

Manrope (variable, bundled, no CDN) for everything. Headings use the `.serif` class name for historical reasons; it now means weight 500 with tight tracking, not a serif face.

- Patient: body 15 to 16 px, headline 35 px, section titles 22 px.
- Clinician: body 14 to 15 px, page title 34 px, table text 13 to 15.5 px, summary numerals 44 px.

## Layout

- **Patient:** 390 px reference. A navy header with a rounded lower edge on the home screen only; other screens sit on the off-white floor. Text-only tab bar. The primary action on a screen floats above the tab bar with no background strip. Above 640 px the app sits in a phone mock-up with demo links outside it.
- **Clinician:** navy sidebar (232 px), off-white work surface, max width 1360 px. Collapses to a top bar under 1024 px.

Radii: 14 to 16 px for panels and large buttons, 10 to 12 px for inputs and small buttons, 2 px for triage markers.

## Charts

- **Recovery curve:** ink dots joined by a line only between felt results on consecutive days. Not-felt and cancelled tests sit in a lane under the scale, never on it. No smoothing.
- Clinician extras: hatched columns for days with no test, an optional shaded band for the illustrative return window, an optional dotted least-squares line labelled as a statistical illustration.
- **Pain:** bars on a separate 0 to 10 axis.
- **Triage markers:** small squares, burgundy, amber or outlined, always with wording.

## Accessibility

- Touch targets 44 px or more on the patient side; the "I Feel It" button is 212 px.
- Visible focus outline everywhere.
- Status never relies on colour alone.
- `prefers-reduced-motion` removes the ambient animation and transitions.
- The ambient rings on the test screen run on a fixed 5.3 s loop unrelated to the firmware's timing, so they cannot hint at the level.

## Movement assessment and demonstration screens (21 November 2026, third pass)

These screens have been through three looks. The first was navy with translucent blue panels throughout, rejected in review as "all blue". The second was white with hairline rules and no cards, rejected as "too minimalist". They now look like the rest of the patient app, which is the look that was asked for.

- **Same surfaces as the patient app.** The softly lit ground (`ground`, `ground-wide`), frosted white cards (`glass`, 22 to 26 px corners, soft shadow), navy `ink` text, `ink-soft` secondary text, the navy primary button. No separate palette: the neutral `graphite` and `stone` tokens of the second pass have been removed.
- **One dark surface.** The camera picture (`navy-950`). Everything laid over it is a white chip with ink text, so it reads in any room.
- **Gold is the accent.** `mint #ECB424`, for the thing to look at: the assessed digit on the skeleton, the needle on a dial, the hold ring, the active step, the "hold it there" banner. Blue (`teal-600` on `teal-50`) numbers the steps of a sequence and tags the camera view.
- **Protractor dials.** Each joint's estimate is drawn on a half-circle scale from 20° of extension to 120° of flexion, the arc filled from zero to the estimate. A solid arc is a joint seen across the picture, a dotted arc is depth-inferred, no arc is not seen. The same three states are used in the overlay on the hand and in every table.
- **The hand is the app's hand.** Instructional figures are drawn in the style of `components/HandIllustration.tsx`: white with a navy line, a broad square palm with rounded corners, chunky fingers that nearly touch, a short thick thumb leaving the palm low on its side at about fifty degrees, a forearm open at the bottom, two faint palm creases, one continuous outline. An assessed digit wears a gold fingertip sleeve, as it does there. Two earlier attempts at the thumb (a long thin one, then one joined to the palm by a web of skin) were both rejected; the answer was to copy the illustration's proportions rather than adjust an anatomical hand, and then to give the thumb visible joints. Because the figure has to move and be seen side-on, it is built from landmarks rather than fixed shapes:
  - the kinematic model (`tracking/handModel.ts`) now has the illustration's proportions, at 0.705 mm to one of its units: knuckles in a level row 29 units apart, fingers 100, 120, 108 and 76 units long, the thumb's two visible bones 57 units;
  - `features/movement/handArt.ts` paints the whole hand as one silhouette (every outline, then every fill), so there are no seams between fingers, thumb, palm and forearm;
  - only a fingertip that has folded back over its own finger, or a thumb that has crossed in front of the palm, is drawn on top with a line of its own;
  - palm-on views are drawn square to the viewer with no perspective; side views are turned 85°, the nearest finger in front of the other three;
  - every digit is drawn bone by bone through the landmarks the tracker reports, the thumb included (base, knuckle, last joint, tip), with a faint crease at each joint, so the drawing bends exactly where the tracked skeleton bends. An earlier version drew the thumb as one smooth capsule and was rejected: "the thumb has no joints and is not moving according to the way we are hand tracking";
  - in a fist the thumb folds at its knuckle and last joint across the front of the palm, just below the curled fingertips. Below them, not over them: a thumb laid across the fingers would hide, in the synthetic replay, the joints it is demonstrating.
- **The movement is animated** (start, move, hold, return) wherever it is explained: the patient's intro, the camera setup card, beside the live picture following the stage the session has reached, and in the help sheet. With reduced motion on, the start and target are shown side by side instead.
- **One screen, three shapes.** The live screen lays itself out from its own width (container queries): picture above read-out on a phone, picture beside read-out when wide, and a compact read-out when the screen is short (the `short:` variant).
- **`frame:` replaces `sm:` in the patient app.** The phone mock-up appears only when the window is at least 640 px wide *and* 608 px tall, so a phone turned on its side keeps the full-screen app.
- **Three kinds of data, three marks.** Camera: filled point, solid line, solid tag. Illustrative: hollow point, dashed line, dashed tag. Synthetic replay: hollow square, gold tag.
- **Feedback banner tones.** Dark: guidance. White: do this now. Gold: good, or hold. Amber: caution.
- **Checked at:** 375 × 812 and 1366 × 768, as still screens. The animated replay could not be watched at full speed in the development browser on this pass. Not checked on a physical phone.

## Not yet checked

Only 390 px (patient) and 1440 px (clinician) have been looked at in screenshots. 375, 430, 768 and 1280 px, keyboard-only use and a contrast audit are still to do.
