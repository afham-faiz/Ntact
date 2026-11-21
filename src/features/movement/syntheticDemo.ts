/**
 * The backup demonstration: a synthetic landmark sequence for an assessment.
 *
 * It is the kinematic hand model performing the movement, with a little noise,
 * rendered as landmarks and replayed through the real tracker and engine. It
 * exists so the engine can be shown working when a camera cannot be used. It is
 * never a stand-in for a person: the screen says "Synthetic replay" while it
 * plays, and anything saved from it is stored as synthetic.
 */
import { recommendedView, type ResolvedAssessment } from '../../assessment/definitions';
import type { Hand } from '../../domain/types';
import { blendPose, oppositionPose, postureOf, yawForView, type HandPose } from '../../tracking/handModel';
import { synthesise, type LandmarkRecording, type SequenceKey } from '../../tracking/recording';

export function syntheticRecordingFor(setup: ResolvedAssessment, hand: Hand): LandmarkRecording {
  const { definition, focus, params } = setup;
  // The view a person in front of a laptop is asked for. A single bending finger is always shown palm-on.
  const view = recommendedView(definition, focus, 'laptop');
  const drawn = definition.id === 'digit-flexion' || view === 'oblique' ? 'palmar' : view;
  const yaw = drawn === 'palmar' || drawn === 'radial' || drawn === 'ulnar' ? yawForView(drawn, hand) : 0;

  let from: HandPose = postureOf('open', hand);
  let to: HandPose;
  if (definition.id === 'thumb-opposition') {
    from = oppositionPose(hand, focus, 0);
    to = oppositionPose(hand, focus, 1);
  } else if (definition.id === 'digit-flexion') {
    to = postureOf('open', hand);
    to.fingers[focus] = { mcp: 68, pip: 88, dip: 44 };
  } else {
    to = postureOf(definition.id === 'hook-fist' ? 'hook' : definition.id === 'tabletop' ? 'tabletop' : 'fist', hand);
  }

  // One more repetition than is asked for: the second is quick and let go early, so a rejected attempt is shown.
  const reps = Math.round(params.reps);
  const keys: SequenceKey[] = [
    { at: 0, pose: from },
    { at: 2.2, pose: from },
  ];
  let clock = 2.2;
  for (let rep = 0; rep <= reps; rep += 1) {
    const brief = rep === 1;
    const target = blendPose(from, to, rep === 0 ? 1 : rep === 2 ? 0.95 : 0.98);
    const move = brief ? 0.35 : 1;
    clock += move;
    keys.push({ at: clock, pose: target });
    clock += brief ? 0.35 : params.holdSeconds + 0.5;
    keys.push({ at: clock, pose: target });
    clock += move;
    keys.push({ at: clock, pose: from });
    clock += 1.6;
    keys.push({ at: clock, pose: from });
  }
  return synthesise(keys, {
    // Nearer than a real session would be, so the drawn hand fills the stage.
    camera: { yaw, pitch: 6, roll: -4, distance: 0.34 },
    noise: 0.006,
    seed: 17,
    label: `${definition.title}: synthetic replay`,
  });
}

/** A slow open-and-close with the wrist turning, for showing free tracking without a camera. */
export function syntheticFreeTracking(hand: Hand): LandmarkRecording {
  const open = postureOf('open', hand);
  const keys = [
    { at: 0, pose: open },
    { at: 1.5, pose: open },
    { at: 3, pose: postureOf('hook', hand) },
    { at: 4.5, pose: open },
    { at: 6, pose: postureOf('tabletop', hand) },
    { at: 7.5, pose: open },
    { at: 9, pose: postureOf('fist', hand) },
    { at: 10.5, pose: open },
    { at: 12, pose: open },
  ];
  return synthesise(keys, { camera: { yaw: yawForView('ulnar', hand) * 0.45, pitch: 4, distance: 0.34 }, noise: 0.006, seed: 23, label: 'Free tracking: synthetic replay' });
}
