# Evaluating the movement estimates: a plan

**No validation has been done.** There are no accuracy figures in this document because none exist. This is the method proposed for getting them, written so that hand therapists and clinicians at a collaborating site can criticise it before any data is collected.

The software side of each step already exists: sessions store what is needed, the statistics are implemented (`src/assessment/session.ts`), and the clinician record has a form for reference readings. What is missing is real hands, a reference instrument and a protocol agreed with the people who use goniometers every day.

Anything involving patients, or staff as participants, needs the collaborating organisation's research governance and, where applicable, ethics approval before it starts. Steps 1 to 4 can be done by the team on their own hands first.

## What question each step answers

| # | Question | Needs | Output |
| --- | --- | --- | --- |
| 1 | Does it track at all, reliably, on our devices? | Team's own hands | Share of frames tracked and usable per device and view |
| 2 | Same hand, same sitting: how much do repeated readings vary? | As above | Within-session SD per joint |
| 3 | Same hand, re-positioned: how much then? | As above | Between-session SD with nothing changed in the hand |
| 4 | How sensitive is it to camera position, light and device? | As above | Change in estimate per condition |
| 5 | How far is it from a goniometer? | A therapist, a goniometer, healthy volunteers | Bias and limits of agreement per joint and view |
| 6 | Does that hold in the hands it is meant for? | Patients, under approval | The same, in post-repair hands |
| 7 | Is a change in the estimate a change in the hand? | Longitudinal data with reference | Smallest change that exceeds measurement variation |

Only after step 5 can any figure be described as an estimate *of a known accuracy*. Only after step 7 can a trend be described as meaning anything.

## 1. Tracking failures

For each device (the demo laptop; at least one iPhone and one Android phone), each camera (front, rear) and each view (palm-on, side-on from each side, angled), run each core assessment three times.

Record from the stored session: share of frames tracked, share usable, frames discarded as jumps, the count of each blocker, valid and rejected repetitions, measured frame rate. All of these are already on the session (`quality`, `capture`) and shown in the clinician record.

Note separately, by eye: any moment the skeleton was visibly off the hand while the app reported "Tracking". That is the failure the software cannot see, and the most important one to count.

## 2. Within-session repeatability

One person, one sitting, hand and camera not moved: ten valid repetitions of one assessment (set "Valid repetitions" to 10 in the protocol).

The session's summary gives, per joint, the median held estimate and the SD across repetitions (`JointSummary.sd`); `withinSession()` gives the same for the primary quantity. Report the SD per joint and per view. Note that a person does not make the same fist ten times: this SD is the camera's variation *plus* the hand's, and is an upper bound on the camera's.

To separate the two, repeat with a rigid object in place of a hand's movement where possible: a hand held still in a splint or resting against a block at a fixed posture, sampled as repeated short holds.

## 3. Between-session repeatability

The same person and posture, five sessions in one day, standing up and re-positioning the hand and the camera each time. Nothing about the hand has changed, so all of the spread is measurement.

`betweenSessions()` gives the SD of the session medians across comparable sessions. This is the number that says how big a week-to-week change has to be before it is worth looking at. Until it exists, the trend chart shows shape only, which is how every screen already words it.

## 4. Sensitivity

Hold one posture (a block or splint helps) and change one thing at a time:

| Factor | Levels |
| --- | --- |
| Camera angle | In 15° steps from palm-on to side-on. The session records the view; the developer view shows the "facing" value continuously |
| Distance | Hand filling roughly 25%, 50% and 75% of the picture |
| Lighting | Bright even light; a single side lamp; dim room; backlit by a window |
| Camera | Laptop webcam; phone front; phone rear |
| Hand-held or propped | The same phone, on a stand and in the other hand |
| Hand | Several people: different sizes, skin tones, with and without rings or nail varnish |

For each, record the estimate and its grade. The useful output is a table of "how many degrees does the estimate move when only this changes", per joint. It will also show where "in view" should really begin: the 0.75 threshold in `geometry.ts` is a reasoned starting point, not a measured one.

To keep the landmarks for re-analysis, turn on the developer view (`?debug=1` on a live session, or the bug icon in the demonstration) and use "Save landmark recording". The file holds landmark coordinates only, no picture, and can be replayed through a changed algorithm with `replay()`. Recordings of anyone outside the team need their consent and belong under the collaborating site's governance.

## 5. Agreement with goniometry

This is the step that needs clinical collaborators, and the one we would most like advice on.

**Design.** Healthy adult volunteers first. For each, a hand therapist positions the hand in each assessment's target posture and measures MCP, PIP and DIP of the index and little fingers with a finger goniometer, by their usual method, while the camera session runs or immediately after with the posture held. The same for the start (extended) posture. Two therapists measuring independently would also give the goniometer's own inter-rater variation, without which the camera's disagreement cannot be interpreted.

**Questions for the therapists before starting:**
- Dorsal or lateral goniometer placement? The camera's side-on view is closest to a lateral measurement.
- Is a held active posture, or a passively positioned one, the right comparison?
- Which joints and digits matter most after digital nerve repair, given that isolated nerve injury may leave movement intact?
- What difference from a goniometer would make the estimate unusable for them?

**Entering the data.** In the clinician record, open the session, choose "Reference readings", and enter each goniometer reading against its finger, joint and position. The record shows the difference per reading.

**Analysis.** `referencePairs()` collects every (camera estimate, goniometer reading) pair; `agreement()` returns the mean difference (bias), the 95% limits of agreement (Bland and Altman) and the mean absolute difference. Report these **separately per joint, per view and per grade** ("in view" versus "depth-inferred"). Pooling them would hide exactly the difference this design is built around. Plot difference against mean to look for bias that changes with angle.

**Sample size** is for a statistician at the collaborating site. As a guide for discussion, limits of agreement are poorly estimated from fewer than a few dozen pairs per condition.

**What would count as a result.** Decide before collecting data, with the therapists, what limits of agreement would be acceptable for the intended use (seeing a trend at home between clinic visits, not replacing clinic goniometry). If the limits are wider than that for a joint or view, the honest outcome is to stop reporting that joint from that view.

## 6. In the hands it is meant for

Only with approval, and only after step 5. Post-repair hands differ in ways that may affect the tracking model itself as well as the geometry: swelling, scars, dressings, splints, altered posture, guarding. Repeat steps 1 and 5 in that group. Movements must be ones the treating team has approved for that patient at that stage; the software never selects or unlocks a movement itself.

## 7. What a change means

With between-session variation from step 3 and agreement from step 5, the smallest detectable change can be estimated for each joint and view. Only changes larger than that are worth showing as changes. Until then the patient app's wording stays as it is: what the camera saw, compared with the same person's earlier sessions, with no statement about recovery.

## What will not be claimed without evidence

- That any estimate is accurate to a stated number of degrees.
- That the estimates are equivalent to, or a substitute for, goniometry.
- That a trend in an estimate reflects recovery.
- That movement estimates say anything about sensation. They are shown beside the sensory test, never combined with it.
- That the software is suitable for diagnosis, triage or treatment decisions.
