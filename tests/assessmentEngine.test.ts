/**
 * The assessment engine, driven end to end by synthetic landmark sequences:
 * kinematic hand -> tracker (stabiliser, quality, geometry) -> state machine.
 *
 * These tests establish that the software does what it is specified to do with
 * landmarks of a known movement. They do not, and cannot, show that a camera's
 * landmarks match a real hand: see docs/VALIDATION_PLAN.md.
 */
import { describe, expect, it } from 'vitest';
import { DEFINITIONS, resolveAssessment, viewAdvice } from '../src/assessment/definitions';
import { replay } from '../src/assessment/session';
import type { Hand } from '../src/domain/types';
import { blendPose, oppositionPose, postureOf, yawForView, type HandPose } from '../src/tracking/handModel';
import { repetitionKeys, synthesise, type SequenceKey, type SequenceOptions } from '../src/tracking/recording';

const view = (kind: 'palmar' | 'radial' | 'ulnar' | 'dorsal', side: Hand, extra: SequenceOptions = {}): SequenceOptions => ({
  ...extra,
  camera: { yaw: yawForView(kind, side), ...extra.camera },
});

const fist = (side: Hand, reps = 3, extra: Partial<Parameters<typeof repetitionKeys>[0]> = {}) =>
  repetitionKeys({ side, from: 'open', to: 'fist', reps, ...extra });

describe('composite fist', () => {
  it('records each repetition of open, fist held, open — for either hand', () => {
    for (const side of ['left', 'right'] as const) {
      const setup = resolveAssessment('composite-fist', 'index');
      const result = replay(synthesise(fist(side), view('palmar', side)), setup, { hand: side });

      expect(result.reps, side).toHaveLength(3);
      for (const rep of result.reps) {
        expect(rep.valid).toBe(true);
        expect(rep.returned).toBe(true);
        expect(rep.holdMs).toBeGreaterThanOrEqual(2000);
        // The kinematic fist is 85 + 100 + 60 at every finger.
        expect(rep.primary).toBeGreaterThan(238);
        expect(rep.primary).toBeLessThan(250);
        expect(rep.joints.index?.mcp?.held).toBeCloseTo(85, 0);
        expect(rep.joints.index?.pip?.held).toBeCloseTo(100, 0);
        expect(rep.joints.index?.dip?.held).toBeCloseTo(60, 0);
        expect(rep.joints.index?.mcp?.start).toBeCloseTo(0, 0);
        expect(rep.digits.sort()).toEqual(['index', 'little', 'middle', 'ring']);
        expect(rep.view).toBe('palmar');
        // Palm-on, the fingers curl along the line of sight.
        expect(rep.joints.index?.pip?.grade).toBe('inferred');
      }
      expect(result.engine.dominantView()).toBe('palmar');
    }
  });

  it('raises its events in order and finishes by itself', () => {
    const setup = resolveAssessment('composite-fist', 'index');
    const { events, states } = replay(synthesise(fist('right'), view('palmar', 'right')), setup);
    const order = events.map((event) => event.type);
    expect(order.slice(0, 5)).toEqual(['tracking-ready', 'start-detected', 'target-detected', 'hold-complete', 'rep-recorded']);
    expect(order.filter((type) => type === 'rep-recorded')).toHaveLength(3);
    expect(order[order.length - 1]).toBe('complete');
    expect(states[states.length - 1].phase).toBe('complete');
    expect(states[states.length - 1].feedback.text).toBe('All repetitions recorded');
  });

  it('stops counting once the target number is reached', () => {
    const setup = resolveAssessment('composite-fist', 'index', { params: { reps: 2 } });
    const { reps } = replay(synthesise(fist('right', 4), view('palmar', 'right')), setup);
    expect(reps).toHaveLength(2);
  });

  it('takes the held value as the middle of the hold, not its noisiest frame', () => {
    const setup = resolveAssessment('composite-fist', 'index');
    const noisy = replay(synthesise(fist('right'), view('palmar', 'right', { noise: 0.012, seed: 7 })), setup);
    expect(noisy.reps.filter((rep) => rep.valid)).toHaveLength(3);
    for (const rep of noisy.reps) {
      expect(Math.abs((rep.primary as number) - 245)).toBeLessThan(12);
      expect(rep.holdSd as number).toBeLessThan(12);
    }
  });
});

describe('false repetitions', () => {
  const setup = resolveAssessment('composite-fist', 'index');

  it('does not count a movement that stops short of the configured threshold, and records how far it went', () => {
    // 40% of a fist is about 98 degrees of combined flexion; the threshold is a change of 120.
    const { reps, states, events } = replay(synthesise(fist('right', 3, { amount: 0.4 }), view('palmar', 'right')), setup);
    expect(states.some((state) => state.phase === 'ready')).toBe(true);
    expect(states.some((state) => state.phase === 'holding')).toBe(false);
    expect(reps.filter((rep) => rep.valid)).toHaveLength(0);
    // Each try is kept as a rejected attempt that fell short, with the furthest point it reached.
    expect(reps).toHaveLength(3);
    for (const rep of reps) {
      expect(rep.rejectReason).toBe('target-not-reached');
      expect(rep.primary as number).toBeGreaterThan(90);
      expect(rep.primary as number).toBeLessThan(106);
      expect(rep.joints.index?.pip?.held).toBeCloseTo(40, 0);
    }
    expect(events.filter((event) => event.type === 'attempt-rejected' && event.reason === 'target-not-reached')).toHaveLength(3);
    expect(states[states.length - 1].rejectedBy['target-not-reached']).toBe(3);
  });

  it('does not record a small twitch as an attempt', () => {
    // 12% of a fist: under a third of the way to the threshold.
    const { reps } = replay(synthesise(fist('right', 3, { amount: 0.12 }), view('palmar', 'right')), setup);
    expect(reps).toHaveLength(0);
  });

  it('judges the movement from where the hand started, not from zero', () => {
    // A hand whose landmarks read 30 degrees at the big knuckles when it is flat, as a real one can.
    const offset = (amount: number) => {
      const pose = postureOf('fist', 'right', amount);
      for (const finger of ['index', 'middle', 'ring', 'little'] as const) pose.fingers[finger].mcp += 30;
      return pose;
    };
    const keys = repetitionKeys({ side: 'right', from: offset(0), to: offset(0.4), reps: 2 });
    // In absolute terms 40% of a fist plus the offset is 128 degrees, above the old absolute threshold region;
    // as a change from the start it is 98, short of 120, so it must not count.
    const short = replay(synthesise(keys, view('palmar', 'right')), setup);
    expect(short.reps.filter((rep) => rep.valid)).toHaveLength(0);
    const full = replay(synthesise(repetitionKeys({ side: 'right', from: offset(0), to: offset(1), reps: 2 }), view('palmar', 'right')), resolveAssessment('composite-fist', 'index', { params: { reps: 2 } }));
    expect(full.reps.filter((rep) => rep.valid)).toHaveLength(2);
    // The stored estimates stay absolute: what was seen, start and held.
    expect(full.reps[0].joints.index?.mcp?.start).toBeCloseTo(30, 0);
    expect(full.reps[0].joints.index?.mcp?.held).toBeCloseTo(115, 0);
  });

  it('records a fist that is not held long enough as rejected, never as valid', () => {
    const { reps, events } = replay(synthesise(fist('right', 2, { hold: 0.7 }), view('palmar', 'right')), setup);
    expect(reps.length).toBeGreaterThan(0);
    expect(reps.every((rep) => !rep.valid && rep.rejectReason === 'hold-too-short')).toBe(true);
    expect(events.some((event) => event.type === 'rep-recorded')).toBe(false);
    expect(events.filter((event) => event.type === 'attempt-rejected')).toHaveLength(2);
  });

  it('ignores a flick through the target position', () => {
    const { reps } = replay(synthesise(fist('right', 3, { hold: 0.04, move: 0.2 }), view('palmar', 'right')), setup);
    expect(reps).toHaveLength(0);
  });

  it('counts nothing from a still open hand, however noisy the tracking', () => {
    const open = postureOf('open', 'right');
    const keys: SequenceKey[] = [
      { at: 0, pose: open },
      { at: 12, pose: open },
    ];
    const { reps, states } = replay(synthesise(keys, view('palmar', 'right', { noise: 0.03, seed: 3 })), setup);
    expect(reps).toHaveLength(0);
    expect(states.some((state) => state.phase === 'holding')).toBe(false);
  });

  it('counts nothing from a camera that shakes while the hand stays open', () => {
    const open = postureOf('open', 'right');
    const keys: SequenceKey[] = [
      { at: 0, pose: open },
      { at: 12, pose: open },
    ];
    for (const amplitude of [0.01, 0.04, 0.09]) {
      const { reps } = replay(synthesise(keys, view('palmar', 'right', { shake: { amplitude, hz: 3 }, noise: 0.006, seed: 11 })), setup);
      expect(reps, `shake ${amplitude}`).toHaveLength(0);
    }
  });

  it('needs the hand to open again before another repetition can start', () => {
    // Close, hold for a long time, never open: one hold, and only one.
    const keys: SequenceKey[] = [
      { at: 0, pose: postureOf('open', 'right') },
      { at: 1.5, pose: postureOf('open', 'right') },
      { at: 2.3, pose: postureOf('fist', 'right') },
      { at: 14, pose: postureOf('fist', 'right') },
    ];
    const { reps, events } = replay(synthesise(keys, view('palmar', 'right')), setup);
    expect(events.filter((event) => event.type === 'hold-complete')).toHaveLength(1);
    expect(reps).toHaveLength(1);
    // The measurement was taken, so it is kept; it is marked as not having returned.
    expect(reps[0].valid).toBe(true);
    expect(reps[0].returned).toBe(false);
    expect(reps[0].holdMs).toBeGreaterThan(8000);
  });

  it('does not start from a hand that is already closed', () => {
    const keys: SequenceKey[] = [
      { at: 0, pose: postureOf('fist', 'right') },
      { at: 8, pose: postureOf('fist', 'right') },
    ];
    const { reps, states } = replay(synthesise(keys, view('palmar', 'right')), setup);
    expect(reps).toHaveLength(0);
    expect(states[states.length - 1].phase).toBe('positioning');
    expect(states[states.length - 1].blockers).toContain('not-at-start');
    expect(states[states.length - 1].feedback.text).toBe(DEFINITIONS['composite-fist'].cues.start);
  });
});

describe('holds and interruptions', () => {
  const setup = resolveAssessment('composite-fist', 'index', { params: { reps: 1 } });

  it('measures the length of the hold', () => {
    for (const hold of [2.2, 3.5]) {
      const { reps } = replay(synthesise(fist('right', 1, { hold }), view('palmar', 'right')), setup);
      expect(reps).toHaveLength(1);
      // The fist is recognised a little before the movement ends and a little after it starts to open.
      expect(reps[0].holdMs).toBeGreaterThan(hold * 1000 - 100);
      expect(reps[0].holdMs).toBeLessThan(hold * 1000 + 1100);
    }
  });

  it('honours a clinician-set hold', () => {
    const long = resolveAssessment('composite-fist', 'index', { params: { reps: 1, holdSeconds: 5 } });
    const short = replay(synthesise(fist('right', 1, { hold: 3 }), view('palmar', 'right')), long);
    expect(short.reps.every((rep) => !rep.valid)).toBe(true);
    const enough = replay(synthesise(fist('right', 1, { hold: 5.5 }), view('palmar', 'right')), long);
    expect(enough.reps.filter((rep) => rep.valid)).toHaveLength(1);
  });

  it('rides out a brief loss of tracking during a hold', () => {
    // Lead 1.6 s, move 0.9 s: the hold runs from 2.5 s. Tracking drops for 0.2 s in the middle of it.
    const { reps } = replay(synthesise(fist('right', 1, { hold: 3 }), view('palmar', 'right', { dropouts: [[3.4, 3.6]] })), setup);
    expect(reps).toHaveLength(1);
    expect(reps[0].valid).toBe(true);
  });

  it('rejects a hold during which tracking was lost for longer', () => {
    const { reps, events, states } = replay(synthesise(fist('right', 1, { hold: 3 }), view('palmar', 'right', { dropouts: [[3.2, 4.6]] })), setup);
    expect(reps.filter((rep) => rep.valid)).toHaveLength(0);
    expect(reps.some((rep) => rep.rejectReason === 'tracking-lost')).toBe(true);
    expect(events.some((event) => event.type === 'attempt-rejected' && event.reason === 'tracking-lost')).toBe(true);
    // Afterwards the hand is still closed, so the engine asks for the start position again.
    expect(states[states.length - 1].phase).not.toBe('complete');
  });

  it('rejects a hold that wanders', () => {
    const open = postureOf('open', 'right');
    const high = postureOf('fist', 'right');
    const low = blendPose(open, high, 0.72);
    const keys: SequenceKey[] = [
      { at: 0, pose: open },
      { at: 1.6, pose: open },
      { at: 2.4, pose: high },
    ];
    for (let t = 2.7; t < 6; t += 0.3) keys.push({ at: t, pose: keys.length % 2 === 0 ? high : low });
    keys.push({ at: 6.8, pose: open }, { at: 8.5, pose: open });
    const { reps } = replay(synthesise(keys, view('palmar', 'right')), setup);
    expect(reps.some((rep) => rep.rejectReason === 'unsteady')).toBe(true);
    expect(reps.filter((rep) => rep.valid)).toHaveLength(0);
  });

  it('discards a single frame in which the hand appears to jump across the picture', () => {
    const clean = replay(synthesise(fist('right', 1), view('palmar', 'right')), setup);
    const glitchy = replay(synthesise(fist('right', 1), view('palmar', 'right', { glitches: [3.0, 3.6] })), setup);
    expect(glitchy.engine.quality().jumps).toBe(2);
    expect(glitchy.reps).toHaveLength(1);
    expect(glitchy.reps[0].valid).toBe(true);
    expect(glitchy.reps[0].primary).toBeCloseTo(clean.reps[0].primary as number, 0);
  });

  it('pauses and resumes through the start position', () => {
    const setupThree = resolveAssessment('composite-fist', 'index');
    const recording = synthesise(fist('right', 3), view('palmar', 'right'));
    const { engine } = replay({ ...recording, frames: [] }, setupThree);
    expect(engine.validReps).toBe(0);
    engine.pause();
    engine.resume();
    expect(engine.records).toHaveLength(0);
  });
});

describe('camera shake', () => {
  const setup = resolveAssessment('composite-fist', 'index');

  it('still records repetitions through the shake of a hand-held phone, with the same figures', () => {
    const still = replay(synthesise(fist('right'), view('palmar', 'right')), setup);
    const held = replay(synthesise(fist('right'), view('palmar', 'right', { shake: { amplitude: 0.012, hz: 1.5 }, noise: 0.006, seed: 5 })), setup);
    expect(held.reps.filter((rep) => rep.valid)).toHaveLength(3);
    held.reps.forEach((rep, index) => {
      expect(Math.abs((rep.primary as number) - (still.reps[index].primary as number))).toBeLessThan(8);
    });
  });

  it('pauses measurement, rather than guessing, when the picture is moving too fast', () => {
    const wild = replay(synthesise(fist('right'), view('palmar', 'right', { shake: { amplitude: 0.11, hz: 4 }, seed: 9 })), setup);
    const quality = wild.engine.quality();
    expect(quality.usable).toBeLessThan(0.5);
    expect((quality.reasons['moving-fast'] ?? 0) + (quality.reasons.clipped ?? 0)).toBeGreaterThan(0);
    expect(wild.reps.filter((rep) => rep.valid).length).toBeLessThan(3);
  });
});

describe('hook fist and tabletop', () => {
  it('records a hook fist palm-on, the comfortable view, with every finger seen and labelled depth-inferred', () => {
    for (const side of ['left', 'right'] as const) {
      const setup = resolveAssessment('hook-fist', 'index');
      const keys = repetitionKeys({ side, from: 'open', to: 'hook', reps: 3 });
      const { reps } = replay(synthesise(keys, view('palmar', side)), setup, { hand: side });
      expect(reps.filter((rep) => rep.valid), side).toHaveLength(3);
      expect(reps[0].view).toBe('palmar');
      expect(reps[0].digits.sort()).toEqual(['index', 'little', 'middle', 'ring']);
      expect(reps[0].joints.index?.pip?.held).toBeCloseTo(95, 0);
      expect(reps[0].joints.index?.pip?.grade).toBe('inferred');
    }
  });

  it('records a hook fist seen from the thumb side, reading the finger nearest the camera directly', () => {
    for (const side of ['left', 'right'] as const) {
      const setup = resolveAssessment('hook-fist', 'index');
      const keys = repetitionKeys({ side, from: 'open', to: 'hook', reps: 3 });
      const { reps } = replay(synthesise(keys, view('radial', side)), setup, { hand: side });
      expect(reps.filter((rep) => rep.valid), side).toHaveLength(3);
      for (const rep of reps) {
        expect(rep.view).toBe('radial');
        expect(rep.digits).toContain('index');
        expect(rep.digits).not.toContain('middle');
        expect(rep.joints.index?.pip?.held).toBeCloseTo(95, 0);
        expect(rep.joints.index?.dip?.held).toBeCloseTo(60, 0);
        expect(rep.joints.index?.mcp?.held).toBeCloseTo(0, 0);
        expect(rep.joints.index?.pip?.grade).toBe('direct');
        expect(rep.primary).toBeCloseTo(155, 0);
      }
    }
  });

  it('reads the little finger from the other side', () => {
    const setup = resolveAssessment('hook-fist', 'little');
    const keys = repetitionKeys({ side: 'right', from: 'open', to: 'hook', reps: 2 });
    const { reps } = replay(synthesise(keys, view('ulnar', 'right')), setup);
    expect(reps.filter((rep) => rep.valid).length).toBeGreaterThanOrEqual(2);
    expect(reps[0].digits).toContain('little');
    expect(reps[0].joints.little?.pip?.grade).toBe('direct');
  });

  it('does not accept a full fist as a hook, and says what to change', () => {
    const setup = resolveAssessment('hook-fist', 'index');
    const keys = repetitionKeys({ side: 'right', from: 'open', to: 'fist', reps: 2 });
    // Palm to the camera, the view a hook fist is asked for.
    const { reps, states } = replay(synthesise(keys, view('palmar', 'right')), setup);
    expect(reps).toHaveLength(0);
    expect(states.some((state) => state.feedback.text === 'Keep your knuckles straight and bend only the end joints')).toBe(true);
    // From the thumb side the thumb of a fist rests against the index finger and hides it: still nothing is recorded.
    expect(replay(synthesise(keys, view('radial', 'right')), setup).reps).toHaveLength(0);
  });

  it('records a tabletop seen from the little-finger side, the side-on view that is comfortable to hold', () => {
    for (const side of ['left', 'right'] as const) {
      const setup = resolveAssessment('tabletop', 'index');
      const keys = repetitionKeys({ side, from: 'open', to: 'tabletop', reps: 3 });
      const { reps } = replay(synthesise(keys, view('ulnar', side)), setup, { hand: side });
      expect(reps.filter((rep) => rep.valid), side).toHaveLength(3);
      // The assessed finger is the index, but side-on only the nearest finger can be read, and the record says which.
      expect(reps[0].digits).toContain('little');
      expect(reps[0].digits).not.toContain('index');
      expect(reps[0].joints.little?.mcp?.held).toBeCloseTo(80, 0);
      expect(reps[0].joints.little?.mcp?.grade).toBe('direct');
      expect(reps[0].primary).toBeCloseTo(80, 0);
      expect(reps.every((rep) => rep.returned)).toBe(true);
    }
  });

  it('does not take a hand still in the target position for one that has returned', () => {
    // A tabletop moves one joint, so the bent hand can still satisfy "fingers nearly straight" on the sum of its joints.
    const setup = resolveAssessment('tabletop', 'little', { params: { reps: 2 } });
    const open = postureOf('open', 'right');
    const bent = postureOf('tabletop', 'right', 0.9);
    const keys: SequenceKey[] = [
      { at: 0, pose: open },
      { at: 1.6, pose: open },
      { at: 2.5, pose: bent },
      { at: 9, pose: bent },
    ];
    const { reps, events } = replay(synthesise(keys, view('ulnar', 'right')), setup);
    expect(events.filter((event) => event.type === 'hold-complete')).toHaveLength(1);
    expect(reps).toHaveLength(1);
    expect(reps[0].returned).toBe(false);
  });

  it('does not accept a hook as a tabletop', () => {
    const setup = resolveAssessment('tabletop', 'index');
    const keys = repetitionKeys({ side: 'right', from: 'open', to: 'hook', reps: 2 });
    expect(replay(synthesise(keys, view('ulnar', 'right')), setup).reps.filter((rep) => rep.valid)).toHaveLength(0);
  });

  it('refuses to measure a tabletop palm-on, and asks for the side view instead', () => {
    const setup = resolveAssessment('tabletop', 'index');
    const keys = repetitionKeys({ side: 'right', from: 'open', to: 'tabletop', reps: 2 });
    const { reps, states, engine } = replay(synthesise(keys, view('palmar', 'right')), setup);
    expect(reps).toHaveLength(0);
    expect(states.every((state) => state.phase === 'searching' || state.phase === 'positioning')).toBe(true);
    expect(states[states.length - 1].feedback.text).toBe(viewAdvice(DEFINITIONS.tabletop, 'index'));
    expect(states[states.length - 1].feedback.text).toBe('Turn your hand side-on, little-finger edge towards the camera');
    expect(engine.quality().reasons.view).toBeGreaterThan(0);
    expect(engine.quality().usable).toBe(0);
  });

  it('can be set to accept only joints seen directly', () => {
    const strict = resolveAssessment('composite-fist', 'index', { minGrade: 'direct' });
    const palmOn = replay(synthesise(fist('right'), view('palmar', 'right')), strict);
    expect(palmOn.reps).toHaveLength(0);
    expect(palmOn.engine.quality().reasons.hidden).toBeGreaterThan(0);
    // From the little-finger side nothing lies between the camera and the nearest finger.
    const sideOn = replay(synthesise(fist('right'), view('ulnar', 'right')), strict);
    expect(sideOn.reps.filter((rep) => rep.valid).length).toBe(3);
    // The ring finger is longer than the little finger, so part of it shows past it; the far fingers do not.
    expect(sideOn.reps[0].digits).toContain('little');
    expect(sideOn.reps[0].digits).not.toContain('index');
    expect(sideOn.reps[0].joints.little?.pip?.grade).toBe('direct');
  });
});

describe('thumb opposition and single finger', () => {
  it('records the thumb tip meeting a fingertip', () => {
    for (const toward of ['index', 'middle', 'little'] as const) {
      const setup = resolveAssessment('thumb-opposition', toward);
      const keys = repetitionKeys({ side: 'right', from: oppositionPose('right', toward, 0), to: oppositionPose('right', toward, 1), reps: 3 });
      const { reps } = replay(synthesise(keys, view('palmar', 'right')), setup);
      expect(reps.filter((rep) => rep.valid), toward).toHaveLength(3);
      expect(reps[0].primary as number).toBeLessThan(0.3);
      expect(reps[0].digits).toEqual(['thumb', toward]);
    }
  });

  it('does not count the thumb reaching for a different finger', () => {
    const setup = resolveAssessment('thumb-opposition', 'little');
    const keys = repetitionKeys({ side: 'right', from: oppositionPose('right', 'index', 0), to: oppositionPose('right', 'index', 1), reps: 2 });
    expect(replay(synthesise(keys, view('palmar', 'right')), setup).reps).toHaveLength(0);
  });

  it('follows one chosen finger and ignores the others', () => {
    const setup = resolveAssessment('digit-flexion', 'little');
    const bent: HandPose = postureOf('open', 'right');
    bent.fingers.little = { mcp: 70, pip: 90, dip: 45 };
    const keys = repetitionKeys({ side: 'right', from: 'open', to: bent, reps: 3, hold: 1.4 });
    const { reps } = replay(synthesise(keys, view('ulnar', 'right')), setup);
    expect(reps.filter((rep) => rep.valid)).toHaveLength(3);
    expect(reps[0].digits).toEqual(['little']);
    expect(reps[0].joints.little?.mcp?.held).toBeCloseTo(70, 0);
    expect(reps[0].joints.little?.pip?.held).toBeCloseTo(90, 0);
    expect(reps[0].joints.little?.dip?.held).toBeCloseTo(45, 0);
    expect(reps[0].joints.little?.pip?.start).toBeCloseTo(0, 0);
    expect(reps[0].joints.little?.pip?.grade).toBe('direct');

    // The same movement with a different finger chosen records nothing: that finger never moved.
    const other = resolveAssessment('digit-flexion', 'index');
    expect(replay(synthesise(keys, view('radial', 'right')), other).reps).toHaveLength(0);
  });

  it('reports an index fingertip that curls under the thumb as hidden, instead of guessing its angle', () => {
    const setup = resolveAssessment('digit-flexion', 'index');
    const bent: HandPose = postureOf('open', 'right');
    bent.fingers.index = { mcp: 70, pip: 90, dip: 45 };
    const keys = repetitionKeys({ side: 'right', from: 'open', to: bent, reps: 2, hold: 1.4 });
    const { reps, engine, states } = replay(synthesise(keys, view('radial', 'right')), setup);
    expect(reps.filter((rep) => rep.valid)).toHaveLength(0);
    expect(engine.quality().reasons.hidden).toBeGreaterThan(0);
    expect(states.some((state) => state.feedback.text.startsWith('The joints being assessed are hidden'))).toBe(true);
  });

  it('uses the index finger as the read-out when the injured digit is the thumb', () => {
    const setup = resolveAssessment('composite-fist', 'thumb');
    expect(setup.focus).toBe('index');
    expect(setup.digits).toEqual(['index', 'middle', 'ring', 'little']);
  });
});

describe('left and right', () => {
  it('gives the same figures whichever hand does the movement', () => {
    const setup = resolveAssessment('composite-fist', 'index');
    const right = replay(synthesise(fist('right'), view('palmar', 'right')), setup).reps;
    const left = replay(synthesise(fist('left'), view('palmar', 'left')), setup).reps;
    expect(left).toHaveLength(right.length);
    left.forEach((rep, index) => expect(rep.primary).toBeCloseTo(right[index].primary as number, 0));
  });

  it('corrects itself when the model labels hands the other way round', () => {
    const setup = resolveAssessment('composite-fist', 'index', { params: { reps: 4 } });
    // Each repetition takes 0.9 + 2.4 + 0.9 s and is followed by 3 s of rest, starting at 1.6 s.
    const recording = synthesise(fist('left', 5, { rest: 3 }), {
      ...view('palmar', 'left'),
      // The hand goes out of view during each rest, so each repetition starts a fresh track.
      dropouts: [
        [6.2, 6.8],
        [13.4, 14.0],
        [20.6, 21.2],
      ],
    });
    // Every label is swapped: a model that calls this left hand "Right".
    const swapped = {
      ...recording,
      frames: recording.frames.map((frame) => ({ ...frame, hands: frame.hands.map((hand) => ({ ...hand, label: 'Right' as const })) })),
    };
    const result = replay(swapped, setup, { keepFrames: true });
    // The first fists settle it from the hand's shape; after two disagreements the label is read the other way.
    expect(result.tracker.labelConvention).toBe('mirrored');
    const last = result.frames.filter((frame) => frame.side !== null).pop();
    expect(last?.side).toBe('left');
    expect(result.reps.filter((rep) => rep.valid).length).toBeGreaterThanOrEqual(3);
    for (const rep of result.reps.filter((item) => item.valid)) expect(rep.primary as number).toBeGreaterThan(200);
  });
});
