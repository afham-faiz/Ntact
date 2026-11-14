# Design

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

## Not yet checked

Only 390 px (patient) and 1440 px (clinician) have been looked at in screenshots. 375, 430, 768 and 1280 px, keyboard-only use and a contrast audit are still to do.
