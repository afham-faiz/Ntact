/**
 * The exercise engine: joint-angle maths, framing, rep counting and coaching.
 * Driven by the drawn demonstration hand, so no camera is involved.
 */
import { describe, expect, it } from 'vitest';
import {
  EXERCISES,
  OpenCloseTracker,
  RepTracker,
  READY_MS,
  bendDegrees,
  curlOf,
  fingerFlexion,
  framingOf,
  patientSummaryLine,
  poseOf,
  previousMeasured,
  summariseReps,
  type FingerValues,
} from '../src/domain/exercise';
import type { ExerciseSession } from '../src/domain/types';
import { DemoHandSource, demoClosure, syntheticHand } from '../src/exercise/demoHand';

const all = (value: number): FingerValues => ({ thumb: value, index: value, middle: value, ring: value, little: value });

/** Feed a tracker frames at 30 per second for `seconds`, with a hand whose curl follows `curlAt`. */
function drive(tracker: OpenCloseTracker, seconds: number, curlAt: (t: number) => FingerValues, from = 0) {
  let state = tracker.update(syntheticHand(curlAt(0)), from);
  for (let ms = from + 33; ms <= from + seconds * 1000; ms += 33) {
    state = tracker.update(syntheticHand(curlAt((ms - from) / 1000)), ms);
  }
  return state;
}

const cycle = (t: number) => all(demoClosure(t));

describe('joint angles', () => {
  it('reads a straight joint as 0 and a right angle as 90', () => {
    expect(bendDegrees({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 })).toBeCloseTo(0, 5);
    expect(bendDegrees({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 })).toBeCloseTo(90, 5);
  });

  it('reads an open hand as nearly straight and a fist as fully curled, finger by finger', () => {
    const open = poseOf(syntheticHand(all(0)));
    const fist = poseOf(syntheticHand(all(1)));
    for (const finger of ['index', 'middle', 'ring', 'little'] as const) {
      expect(open.flexion[finger], finger).toBeLessThan(35);
      expect(open.curl[finger], finger).toBeLessThan(0.08);
      expect(fist.flexion[finger], finger).toBeGreaterThan(215);
      expect(fist.curl[finger], finger).toBe(1);
    }
    expect(open.closure).toBeLessThan(0.08);
    expect(fist.closure).toBe(1);
    expect(fist.curl.thumb).toBeGreaterThan(0.9);
  });

  it('rises steadily as a finger curls, so a partial fist reads as partial', () => {
    const readings = [0, 0.25, 0.5, 0.75, 1].map((curl) => fingerFlexion(syntheticHand(all(curl)).world ?? [], 'index'));
    for (let i = 1; i < readings.length; i += 1) expect(readings[i]).toBeGreaterThan(readings[i - 1] + 30);
    expect(poseOf(syntheticHand(all(0.5))).closure).toBeGreaterThan(0.35);
    expect(poseOf(syntheticHand(all(0.5))).closure).toBeLessThan(0.65);
  });

  it('measures each finger on its own', () => {
    const pose = poseOf(syntheticHand({ ...all(1), index: 0.2 }));
    expect(pose.curl.index).toBeLessThan(0.3);
    expect(pose.curl.middle).toBe(1);
  });

  it('does not change when the hand moves across the picture or nearer the camera', () => {
    const here = poseOf(syntheticHand(all(0.6), { wristX: 0.35, wristY: 0.7, zoom: 2.2 }));
    const there = poseOf(syntheticHand(all(0.6), { wristX: 0.6, wristY: 0.85, zoom: 3.4 }));
    expect(here.closure).toBeCloseTo(there.closure, 6);
  });

  it('clamps curl to 0..1', () => {
    expect(curlOf(-40, 'index')).toBe(0);
    expect(curlOf(400, 'index')).toBe(1);
  });
});

describe('framing', () => {
  it('accepts a hand that is comfortably in view', () => {
    expect(framingOf(syntheticHand(all(0)).image)).toBe('ok');
    expect(framingOf(syntheticHand(all(1)).image)).toBe('ok');
  });

  it('notices a hand that is too far, too close or cut off', () => {
    expect(framingOf(syntheticHand(all(0), { zoom: 0.8 }).image)).toBe('too-far');
    expect(framingOf(syntheticHand(all(0), { zoom: 4.5, wristY: 0.94 }).image)).toBe('too-close');
    expect(framingOf(syntheticHand(all(0), { wristX: 0.95 }).image)).toBe('clipped');
  });
});

describe('counting repetitions', () => {
  it('waits for a steady hand before it starts counting', () => {
    const tracker = new OpenCloseTracker('index');
    expect(tracker.update(null, 0).cue.phase).toBe('find-hand');
    const early = tracker.update(syntheticHand(all(0)), 100);
    expect(early.ready).toBe(false);
    expect(early.cue.phase).toBe('get-ready');
    const later = drive(tracker, (READY_MS + 200) / 1000, () => all(0), 100);
    expect(later.ready).toBe(true);
    expect(later.cue.phase).toBe('close');
  });

  it('counts one repetition per open, fist, open cycle', () => {
    const tracker = new OpenCloseTracker('index');
    // Three full 3.4 s cycles after the settle time.
    const state = drive(tracker, 1 + 3.4 * 3, (t) => (t < 1 ? all(0) : cycle(t - 1)));
    expect(state.reps).toBe(3);
    expect(state.history).toHaveLength(3);
    expect(state.done).toBe(false);
  });

  it('does not count a hand that only twitches', () => {
    const tracker = new OpenCloseTracker('index');
    const state = drive(tracker, 12, (t) => all(0.1 + 0.08 * Math.sin(t * 6)));
    expect(state.reps).toBe(0);
  });

  it('does not count a fist that is never opened again', () => {
    const tracker = new OpenCloseTracker('index');
    const state = drive(tracker, 8, (t) => all(t < 1.5 ? 0 : 1));
    expect(state.reps).toBe(0);
    expect(state.stage).toBe('closed');
    expect(state.cue.phase).toBe('open');
  });

  it('counts a partial fist, so limited movement is not shut out', () => {
    const tracker = new OpenCloseTracker('index');
    const state = drive(tracker, 1 + 3.4 * 2, (t) => all(t < 1 ? 0 : demoClosure(t - 1) * 0.62));
    expect(state.reps).toBe(2);
  });

  it('stops at the target and says so', () => {
    const tracker = new OpenCloseTracker('index', 3);
    const state = drive(tracker, 1 + 3.4 * 5, (t) => (t < 1 ? all(0) : cycle(t - 1)));
    expect(state.reps).toBe(3);
    expect(state.done).toBe(true);
    expect(state.cue.phase).toBe('done');
    expect(tracker.result().completed).toBe(true);
  });

  it('pauses, without losing the count, when the hand leaves the picture', () => {
    const tracker = new OpenCloseTracker('index');
    drive(tracker, 1 + 3.4 * 2, (t) => (t < 1 ? all(0) : cycle(t - 1)));
    const away = tracker.update(null, 9_000);
    expect(away.handVisible).toBe(false);
    expect(away.reps).toBe(2);
    expect(away.cue.phase).toBe('find-hand');
    const clipped = tracker.update(syntheticHand(all(0), { wristX: 0.96 }), 9_050);
    expect(clipped.cue.text).toBe('Keep your whole hand in view');
    expect(clipped.reps).toBe(2);
  });

  it('completes the built-in demonstration, which has a stiffer injured finger', () => {
    const source = new DemoHandSource('index');
    const tracker = new OpenCloseTracker('index');
    let state = tracker.update(null, 0);
    for (let ms = 0; ms <= 45_000 && !state.done; ms += 33) state = tracker.update(source.read(ms), ms);
    expect(state.done).toBe(true);
    const result = tracker.result();
    expect(result.reps).toBe(EXERCISES['open-close'].targetReps);
    // The demonstration's injured finger reaches about three quarters of a full curl.
    expect(result.flexDeg).toBeGreaterThan(120);
    expect(result.flexDeg).toBeLessThan(200);
    expect(result.rangeDeg).toBeGreaterThan(90);
  });
});

describe('coaching', () => {
  it('mentions the injured finger when it trails the others into the fist', () => {
    const tracker = new OpenCloseTracker('index');
    drive(tracker, 1, () => all(0));
    const state = drive(tracker, 0.5, () => ({ ...all(0.4), index: 0.05 }), 1_100);
    expect(state.cue.phase).toBe('closing');
    expect(state.cue.text).toMatch(/index finger/);
    expect(state.cue.text).toMatch(/comfortable/);
  });

  it('gives the plain cue when the fingers move together', () => {
    const tracker = new OpenCloseTracker('index');
    drive(tracker, 1, () => all(0));
    const state = drive(tracker, 0.5, () => all(0.3), 1_100);
    expect(state.cue.text).toBe('Keep curling, gently');
  });

  it('never uses discouraging words', () => {
    const tracker = new OpenCloseTracker('ring');
    const seen = new Set<string>();
    let ms = 0;
    for (const curl of [all(0), { ...all(0.5), ring: 0.1 }, all(1), { ...all(0.3), ring: 0.9 }, all(0)]) {
      for (let i = 0; i < 40; i += 1, ms += 33) seen.add(tracker.update(syntheticHand(curl), ms).cue.text);
    }
    seen.add(tracker.update(null, ms).cue.text);
    for (const text of seen) expect(text).not.toMatch(/fail|wrong|bad|poor|cannot|weak/i);
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe('session summary', () => {
  const session = (rangeDeg: number | null, timestamp: string): ExerciseSession => ({
    id: timestamp,
    patientId: 'p',
    timestamp,
    exerciseId: 'open-close',
    reps: 10,
    targetReps: 10,
    completed: true,
    durationMs: 40_000,
    site: { hand: 'right', finger: 'index' },
    flexDeg: rangeDeg === null ? null : rangeDeg + 30,
    extDeg: rangeDeg === null ? null : 30,
    rangeDeg,
    source: 'seed',
    simulated: true,
  });

  it('uses the middle repetition, so one awkward repetition does not set the figure', () => {
    const result = summariseReps(
      [
        { flexDeg: 150, extDeg: 30 },
        { flexDeg: 60, extDeg: 28 },
        { flexDeg: 154, extDeg: 34 },
      ],
      10,
      20_000,
    );
    expect(result).toMatchObject({ reps: 3, completed: false, flexDeg: 150, extDeg: 30, rangeDeg: 120 });
  });

  it('has no movement figure when nothing was counted', () => {
    expect(summariseReps([], 10, 5_000)).toMatchObject({ reps: 0, flexDeg: null, extDeg: null, rangeDeg: null });
  });

  it('finds the previous session that has a figure', () => {
    const sessions = [session(100, '2026-11-10T10:00:00.000Z'), session(null, '2026-11-11T10:00:00.000Z')];
    expect(previousMeasured(sessions)?.rangeDeg).toBe(100);
    expect(previousMeasured(sessions, '2026-11-10T10:00:00.000Z')).toBeNull();
  });

  it('words every outcome encouragingly for the patient', () => {
    const previous = session(120, '2026-11-10T10:00:00.000Z');
    const lines = [
      patientSummaryLine(summariseReps([], 10, 0), previous),
      patientSummaryLine(summariseReps([{ flexDeg: 150, extDeg: 30 }], 10, 0), null),
      patientSummaryLine(summariseReps([{ flexDeg: 170, extDeg: 30 }], 10, 0), previous),
      patientSummaryLine(summariseReps([{ flexDeg: 120, extDeg: 30 }], 10, 0), previous),
      patientSummaryLine(summariseReps([{ flexDeg: 152, extDeg: 30 }], 10, 0), previous),
    ];
    expect(new Set(lines).size).toBe(5);
    for (const line of lines) expect(line).not.toMatch(/fail|worse|wrong|bad|declin|stall/i);
  });
});

describe('the other exercises', () => {
  const slides = EXERCISES['finger-slides'];
  const putty = EXERCISES['putty-squeeze'];
  const hook = (value: number) => syntheticHand(all(value), { pattern: 'hook' });

  function run(tracker: RepTracker, seconds: number, frameAt: (t: number) => ReturnType<typeof syntheticHand>) {
    let state = tracker.update(frameAt(0), 0);
    for (let ms = 33; ms <= seconds * 1000; ms += 33) state = tracker.update(frameAt(ms / 1000), ms);
    return state;
  }

  it('reads a finger slide from the end joints: flat is near 0, fingertips drawn back is near 1', () => {
    expect(poseOf(hook(0)).hookAmount).toBeLessThan(0.08);
    expect(poseOf(hook(1)).hookAmount).toBeGreaterThan(0.9);
    // The knuckle barely moves in a slide, so the fist measure stays well short of a fist.
    expect(poseOf(hook(1)).closure).toBeLessThan(0.75);
  });

  it('counts finger slides, with its own coaching words', () => {
    const tracker = new RepTracker(slides, 'index');
    const state = run(tracker, 1 + 3.4 * 3, (t) => hook(t < 1 ? 0 : demoClosure(t - 1)));
    expect(state.reps).toBe(3);

    const fresh = new RepTracker(slides, 'index');
    const waiting = run(fresh, 1.2, () => hook(0));
    expect(waiting.cue.text).toBe(slides.cues.start);
    expect(waiting.cue.text).toMatch(/slide/i);
  });

  it('counts a putty squeeze, which is a smaller movement than a fist', () => {
    const squeeze = (t: number) => syntheticHand(all((t < 1 ? 0 : demoClosure(t - 1)) * 0.55));
    expect(run(new RepTracker(putty, 'index'), 1 + 3.4 * 3, squeeze).reps).toBe(3);
    // The same small movement is not enough to count as opening and closing the hand fully... 
    expect(run(new OpenCloseTracker('index'), 1 + 3.4 * 3, (t) => syntheticHand(all((t < 1 ? 0 : demoClosure(t - 1)) * 0.3))).reps).toBe(0);
  });

  it('runs each built-in demonstration to the end', () => {
    for (const [exercise, reach] of [[slides, 1], [putty, 0.62]] as const) {
      const source = new DemoHandSource('index', exercise.metric, reach);
      const tracker = new RepTracker(exercise, 'index');
      let state = tracker.update(null, 0);
      for (let ms = 0; ms <= 50_000 && !state.done; ms += 33) state = tracker.update(source.read(ms), ms);
      expect(state.done, exercise.id).toBe(true);
      expect(tracker.result().reps, exercise.id).toBe(exercise.targetReps);
    }
  });

  it('gives every exercise three steps, five coaching lines and ten repetitions, with no discouraging words', () => {
    for (const exercise of Object.values(EXERCISES)) {
      expect(exercise.steps, exercise.id).toHaveLength(3);
      expect(exercise.targetReps, exercise.id).toBe(10);
      for (const text of [...Object.values(exercise.cues), ...exercise.steps, exercise.summary]) {
        expect(text, exercise.id).not.toMatch(/fail|wrong|bad|poor|cannot|weak/i);
      }
    }
  });
});
