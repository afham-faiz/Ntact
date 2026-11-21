/**
 * The tracking pipeline below the assessment engine: smoothing, jump rejection,
 * tracking loss, frame quality, choosing a hand, left/right, and recordings.
 *
 * The filter figures printed by this file are measured here, on synthetic
 * landmarks with synthetic noise. They describe the filter, not a camera.
 */
import { describe, expect, it } from 'vitest';
import { DIGIT_JOINTS, jointAngles, palmFrame, compositeFlexion } from '../src/tracking/geometry';
import { blendPose, observePose, postureOf, seededRandom, shifted, withNoise } from '../src/tracking/handModel';
import { OneEuroFilter } from '../src/tracking/oneEuro';
import {
  RecordingBuilder,
  ReplayCursor,
  frameObservations,
  packObservation,
  parseRecording,
  repetitionKeys,
  synthesise,
} from '../src/tracking/recording';
import { DEFAULT_STABILISER, LandmarkStabiliser, type HandObservation } from '../src/tracking/stabiliser';
import { HandTracker, SideResolver, chooseObservation } from '../src/tracking/tracker';
import type { Vec3 } from '../src/tracking/vec';

const ASPECT = 4 / 3;
const FRAME = 1000 / 30;

const compositeOf = (world: Vec3[]): number => compositeFlexion(jointAngles(world, palmFrame(world, 'right')), 'index');

function sd(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

describe('One Euro filter', () => {
  it('passes the first sample through and settles on a constant', () => {
    const filter = new OneEuroFilter(DEFAULT_STABILISER.world);
    expect(filter.filter(5, 1 / 30)).toBe(5);
    let value = 0;
    for (let index = 0; index < 120; index += 1) value = filter.filter(8, 1 / 30);
    expect(value).toBeCloseTo(8, 3);
  });

  it('follows a moving hand closely and steadies a still one (measured)', () => {
    const open = postureOf('open', 'right');
    const fist = postureOf('fist', 'right');
    const noise = 0.008;

    // A hand opening and closing once a second.
    const random = seededRandom(21);
    const stabiliser = new LandmarkStabiliser();
    const truth: number[] = [];
    const filtered: number[] = [];
    const raw: number[] = [];
    for (let index = 0; index < 300; index += 1) {
      const t = index / 30;
      const amount = 0.5 - 0.5 * Math.cos(2 * Math.PI * 1 * t);
      const clean = observePose(blendPose(open, fist, amount));
      const noisy = withNoise(clean, noise, random);
      const out = stabiliser.update(noisy, index * FRAME, ASPECT);
      truth.push(compositeOf(clean.world as Vec3[]));
      raw.push(compositeOf(noisy.world as Vec3[]));
      filtered.push(compositeOf(out.world as Vec3[]));
    }
    // Skip the first second while the filter starts.
    const from = 30;
    const amplitude = (values: number[]) => (Math.max(...values.slice(from)) - Math.min(...values.slice(from))) / 2;
    const kept = amplitude(filtered) / amplitude(truth);

    // Lag: the shift, in frames, that best lines the filtered signal up with the truth.
    let bestShift = 0;
    let bestError = Infinity;
    for (let shift = 0; shift <= 6; shift += 0.25) {
      let error = 0;
      let count = 0;
      for (let index = from; index < truth.length - 8; index += 1) {
        const position = index - shift;
        const low = Math.floor(position);
        const delayed = truth[low] + (truth[low + 1] - truth[low]) * (position - low);
        error += (filtered[index] - delayed) ** 2;
        count += 1;
      }
      if (error / count < bestError) {
        bestError = error / count;
        bestShift = shift;
      }
    }
    const lagMs = bestShift * FRAME;

    // A still fist: how much frame-to-frame wobble is left.
    const still = new LandmarkStabiliser();
    const stillRaw: number[] = [];
    const stillFiltered: number[] = [];
    const steady = observePose(fist);
    for (let index = 0; index < 240; index += 1) {
      const noisy = withNoise(steady, noise, random);
      const out = still.update(noisy, index * FRAME, ASPECT);
      if (index >= 30) {
        stillRaw.push(compositeOf(noisy.world as Vec3[]));
        stillFiltered.push(compositeOf(out.world as Vec3[]));
      }
    }
    const reduction = 1 - sd(stillFiltered) / sd(stillRaw);

    console.info(
      `[filter, synthetic] 1 Hz open-close at 30 fps, landmark noise ${noise} palm lengths: ` +
        `amplitude kept ${(kept * 100).toFixed(1)}%, lag ${lagMs.toFixed(0)} ms; ` +
        `still hand: angle wobble ${sd(stillRaw).toFixed(1)} -> ${sd(stillFiltered).toFixed(1)} degrees (${(reduction * 100).toFixed(0)}% less)`,
    );
    expect(kept).toBeGreaterThan(0.95);
    expect(kept).toBeLessThan(1.05);
    expect(lagMs).toBeLessThan(45);
    expect(reduction).toBeGreaterThan(0.5);
  });
});

describe('stabiliser', () => {
  const open = observePose(postureOf('open', 'right'));

  it('reports lost until a hand appears, then tracks', () => {
    const stabiliser = new LandmarkStabiliser();
    expect(stabiliser.update(null, 0, ASPECT).status).toBe('lost');
    const first = stabiliser.update(open, FRAME, ASPECT);
    expect(first.status).toBe('tracking');
    expect(first.image).toHaveLength(21);
    expect(first.trackedMs).toBe(0);
    expect(stabiliser.update(open, 10 * FRAME, ASPECT).trackedMs).toBeCloseTo(9 * FRAME, 3);
  });

  it('holds the last good frame through a short gap, then lets go', () => {
    const stabiliser = new LandmarkStabiliser();
    for (let index = 0; index < 20; index += 1) stabiliser.update(open, index * FRAME, ASPECT);
    const gap = stabiliser.update(null, 20 * FRAME + 100, ASPECT);
    expect(gap.status).toBe('holding');
    expect(gap.image).not.toBeNull();
    const gone = stabiliser.update(null, 20 * FRAME + 400, ASPECT);
    expect(gone.status).toBe('lost');
    expect(gone.image).toBeNull();
    // Back again: a new track, timed from now.
    expect(stabiliser.update(open, 20 * FRAME + 433, ASPECT).trackedMs).toBe(0);
  });

  it('throws away a frame in which the hand leaps, and keeps its place', () => {
    const stabiliser = new LandmarkStabiliser();
    let last = stabiliser.update(open, 0, ASPECT);
    for (let index = 1; index < 20; index += 1) last = stabiliser.update(open, index * FRAME, ASPECT);
    const before = last.image as Vec3[];
    const leap = stabiliser.update(shifted(open, 0.3, -0.2), 20 * FRAME, ASPECT);
    expect(leap.rejected).toBe(true);
    expect(leap.status).toBe('holding');
    expect((leap.image as Vec3[])[8].x).toBeCloseTo(before[8].x, 6);
    const after = stabiliser.update(open, 21 * FRAME, ASPECT);
    expect(after.rejected).toBe(false);
    expect(after.status).toBe('tracking');
  });

  it('throws away a frame in which one finger teleports while the hand stays put', () => {
    const stabiliser = new LandmarkStabiliser();
    for (let index = 0; index < 20; index += 1) stabiliser.update(open, index * FRAME, ASPECT);
    const broken: HandObservation = { ...open, image: open.image.map((point, index) => (index === 8 ? { ...point, x: point.x + 0.25, y: point.y + 0.2 } : point)) };
    expect(stabiliser.update(broken, 20 * FRAME, ASPECT).rejected).toBe(true);
  });

  it('accepts that the hand really has moved once it stays there', () => {
    const stabiliser = new LandmarkStabiliser();
    for (let index = 0; index < 20; index += 1) stabiliser.update(open, index * FRAME, ASPECT);
    const moved = shifted(open, 0.25, 0);
    expect(stabiliser.update(moved, 20 * FRAME, ASPECT).rejected).toBe(true);
    // The longer it has been since the last accepted frame, the further a real hand could have travelled.
    let latest = stabiliser.update(moved, 21 * FRAME, ASPECT);
    if (latest.rejected) latest = stabiliser.update(moved, 22 * FRAME, ASPECT);
    expect(latest.rejected).toBe(false);
    expect(latest.status).toBe('tracking');
    for (let index = 23; index < 40; index += 1) latest = stabiliser.update(moved, index * FRAME, ASPECT);
    expect((latest.image as Vec3[])[0].x).toBeCloseTo(moved.image[0].x, 3);
  });

  it('restarts the track where the hand now is when a leap persists', () => {
    const stabiliser = new LandmarkStabiliser({ rejectLimit: 2, maxCentroidSpeed: 2 });
    for (let index = 0; index < 20; index += 1) stabiliser.update(open, index * FRAME, ASPECT);
    const moved = shifted(open, 0.3, 0);
    expect(stabiliser.update(moved, 20 * FRAME, ASPECT).rejected).toBe(true);
    const second = stabiliser.update(moved, 21 * FRAME, ASPECT);
    expect(second.rejected).toBe(false);
    expect(second.reacquired).toBe(true);
    expect((second.image as Vec3[])[0].x).toBeCloseTo(moved.image[0].x, 6);
  });

  it('lets a fast but real movement through', () => {
    const stabiliser = new LandmarkStabiliser();
    const fist = postureOf('fist', 'right');
    const from = postureOf('open', 'right');
    // A full fist in a fifth of a second, while the hand also drifts across the picture.
    for (let index = 0; index < 30; index += 1) {
      const amount = Math.min(1, Math.max(0, (index - 10) / 6));
      const observation = shifted(observePose(blendPose(from, fist, amount)), index * 0.004, 0);
      expect(stabiliser.update(observation, index * FRAME, ASPECT).rejected, `frame ${index}`).toBe(false);
    }
  });

  it('measures wobble and travel in palm lengths', () => {
    const random = seededRandom(4);
    const quiet = new LandmarkStabiliser();
    const shaky = new LandmarkStabiliser();
    let calm = quiet.update(open, 0, ASPECT);
    let rough = shaky.update(open, 0, ASPECT);
    for (let index = 1; index < 60; index += 1) {
      calm = quiet.update(withNoise(open, 0.004, random), index * FRAME, ASPECT);
      rough = shaky.update(withNoise(open, 0.06, random), index * FRAME, ASPECT);
    }
    expect(calm.jitter).toBeLessThan(0.02);
    expect(rough.jitter).toBeGreaterThan(0.05);

    const travelling = new LandmarkStabiliser();
    let moving = travelling.update(open, 0, ASPECT);
    // 0.012 of the picture per frame is about 1.6 palm lengths a second for this hand.
    for (let index = 1; index < 30; index += 1) moving = travelling.update(shifted(open, index * 0.012, 0), index * FRAME, ASPECT);
    expect(moving.palmSpeed).toBeGreaterThan(1.5);
    expect(calm.palmSpeed).toBeLessThan(0.6);
  });
});

describe('frame quality', () => {
  const run = (observation: HandObservation | null, frames = 30, context: Partial<Parameters<HandTracker['update']>[2]> = {}) => {
    const tracker = new HandTracker();
    let frame = tracker.update(observation ? [observation] : [], 0, { aspect: ASPECT, ...context });
    for (let index = 1; index < frames; index += 1) frame = tracker.update(observation ? [observation] : [], index * FRAME, { aspect: ASPECT, ...context });
    return frame;
  };

  it('accepts a steady hand in the middle of the picture once it has settled', () => {
    const open = observePose(postureOf('open', 'right'));
    expect(run(open, 3).quality.reasons).toEqual(['settling']);
    const settled = run(open, 30);
    expect(settled.quality.ok).toBe(true);
    expect(settled.quality.reasons).toEqual([]);
    expect(settled.quality.modelScore).toBe(0.98);
    expect(settled.view?.kind).toBe('palmar');
    expect(settled.side).toBe('right');
  });

  it('says why a frame cannot be used', () => {
    const open = postureOf('open', 'right');
    expect(run(null).quality.reasons).toEqual(['no-hand']);
    expect(run(observePose(open, { centreX: 0.93 })).quality.reasons).toContain('clipped');
    expect(run(observePose(open, { distance: 2.4 })).quality.reasons).toContain('too-far');
    expect(run(observePose(open, { distance: 0.2, centreY: 0.5 })).quality.ok).toBe(false);
    expect(run(observePose(open), 30, { deviceRotation: 80 }).quality.reasons).toContain('device-moving');
  });

  it('pauses on a hand moving quickly across the picture, and on unstable landmarks', () => {
    const open = observePose(postureOf('open', 'right'));
    const tracker = new HandTracker();
    let frame = tracker.update([open], 0, { aspect: ASPECT });
    for (let index = 1; index < 30; index += 1) frame = tracker.update([shifted(open, index * 0.016, 0)], index * FRAME, { aspect: ASPECT });
    expect(frame.quality.reasons).toContain('moving-fast');

    const random = seededRandom(8);
    const noisy = new HandTracker();
    let wobbly = noisy.update([open], 0, { aspect: ASPECT });
    for (let index = 1; index < 60; index += 1) wobbly = noisy.update([withNoise(open, 0.07, random)], index * FRAME, { aspect: ASPECT });
    expect(wobbly.quality.reasons).toContain('unstable');
  });

  it('marks a held frame as not usable', () => {
    const open = observePose(postureOf('open', 'right'));
    const tracker = new HandTracker();
    for (let index = 0; index < 30; index += 1) tracker.update([open], index * FRAME, { aspect: ASPECT });
    const held = tracker.update([], 30 * FRAME, { aspect: ASPECT });
    expect(held.status).toBe('holding');
    expect(held.quality.ok).toBe(false);
    expect(held.quality.reasons).toContain('tracking-held');
    expect(held.image).not.toBeNull();
  });

  it('raises advisories without blocking', () => {
    const open = observePose(postureOf('open', 'right'));
    const dim = run(open, 30, { luma: 18, fps: 9 });
    expect(dim.quality.ok).toBe(true);
    expect(dim.quality.advisories).toEqual(['low-light', 'low-frame-rate']);
  });

  it('gives every joint an estimate and a grade, and no numbers when there is no hand', () => {
    const frame = run(observePose(postureOf('hook', 'right'), { yaw: 90 }));
    for (const finger of ['thumb', 'index', 'middle', 'ring', 'little'] as const) {
      for (const joint of DIGIT_JOINTS[finger]) expect(frame.joints?.[finger][joint], `${finger} ${joint}`).toBeDefined();
    }
    expect(frame.joints?.index.pip?.grade).toBe('direct');
    expect(frame.joints?.middle.pip?.grade).toBe('unavailable');
    const none = run(null);
    expect(none.joints).toBeNull();
    expect(none.angles).toBeNull();
    expect(none.measures).toBeNull();
  });
});

describe('choosing which hand to follow', () => {
  const map = new SideResolver().mapLabel;
  const right = observePose(postureOf('open', 'right'), { centreX: 0.3, distance: 0.6 });
  const left = observePose(postureOf('open', 'left'), { centreX: 0.7 });

  it('takes the only hand, and nothing when there is none', () => {
    expect(chooseObservation([], null, null, map)).toBeNull();
    expect(chooseObservation([right], null, null, map)).toBe(right);
  });

  it('prefers the hand the session is set up for, then the larger', () => {
    expect(chooseObservation([right, left], null, 'right', map)).toBe(right);
    expect(chooseObservation([right, left], null, 'left', map)).toBe(left);
    expect(chooseObservation([right, left], null, null, map)).toBe(left);
  });

  it('keeps following the same hand when a second one comes into view', () => {
    expect(chooseObservation([left, right], right.image, 'left', map)).toBe(right);
  });

  it('does not let a second hand steal the track, and mentions it', () => {
    const tracker = new HandTracker();
    for (let index = 0; index < 20; index += 1) tracker.update([right], index * FRAME, { aspect: ASPECT });
    const both = tracker.update([left, right], 20 * FRAME, { aspect: ASPECT });
    expect(both.rejected).toBe(false);
    expect(both.side).toBe('right');
    expect(both.handsSeen).toBe(2);
    expect(both.quality.advisories).toContain('second-hand');
  });
});

describe('left or right', () => {
  it('goes by the model label for a flat hand, and by the hand’s shape once it is bent', () => {
    const resolver = new SideResolver();
    const flat = observePose(postureOf('open', 'left')).world as Vec3[];
    const first = resolver.resolve(flat, 'Left', 0.9, null);
    expect(first).toMatchObject({ side: 'left', source: 'model', confirmed: false });

    const bent = observePose(postureOf('fist', 'left')).world as Vec3[];
    let resolved = first;
    for (let index = 0; index < 6; index += 1) resolved = resolver.resolve(bent, 'Left', 0.9, null);
    expect(resolved).toMatchObject({ side: 'left', source: 'shape', confirmed: true });
    // Opening the hand again does not undo it.
    expect(resolver.resolve(flat, 'Left', 0.9, null)).toMatchObject({ side: 'left', source: 'shape' });
  });

  it('is not flipped by one mislabelled frame', () => {
    const resolver = new SideResolver();
    const flat = observePose(postureOf('open', 'right')).world as Vec3[];
    for (let index = 0; index < 10; index += 1) resolver.resolve(flat, 'Right', 0.95, null);
    expect(resolver.resolve(flat, 'Left', 0.6, null).side).toBe('right');
  });

  it('believes the shape over a wrong label, and learns the label convention after two disagreements', () => {
    const resolver = new SideResolver();
    const flat = observePose(postureOf('open', 'right')).world as Vec3[];
    const bent = observePose(postureOf('fist', 'right')).world as Vec3[];
    for (let round = 0; round < 2; round += 1) {
      expect(resolver.labelConvention).toBe('subject');
      expect(resolver.resolve(flat, 'Left', 0.9, null).side).toBe('left');
      let resolved = resolver.resolve(bent, 'Left', 0.9, null);
      for (let index = 0; index < 5; index += 1) resolved = resolver.resolve(bent, 'Left', 0.9, null);
      expect(resolved).toMatchObject({ side: 'right', source: 'shape' });
      resolver.trackLost();
    }
    expect(resolver.labelConvention).toBe('mirrored');
    expect(resolver.resolve(flat, 'Left', 0.9, null)).toMatchObject({ side: 'right', source: 'model' });
  });

  it('falls back to the expected hand when the model gives no label', () => {
    const resolver = new SideResolver();
    const flat = observePose(postureOf('open', 'left')).world as Vec3[];
    expect(resolver.resolve(flat, null, null, 'left')).toMatchObject({ side: 'left', source: 'expected' });
    expect(new SideResolver().resolve(flat, null, null, null).source).toBe('default');
  });
});

describe('recordings', () => {
  const keys = repetitionKeys({ side: 'right', from: 'open', to: 'fist', reps: 1 });

  it('are marked synthetic when they come from the kinematic model', () => {
    const recording = synthesise(keys);
    expect(recording.origin).toBe('synthetic');
    expect(recording.note).toMatch(/No person/);
    expect(recording.frames.length).toBeGreaterThan(100);
    expect(recording.frames[0].hands[0].image).toHaveLength(63);
  });

  it('are the same every time for the same seed', () => {
    const a = synthesise(keys, { noise: 0.01, seed: 4 });
    const b = synthesise(keys, { noise: 0.01, seed: 4 });
    const c = synthesise(keys, { noise: 0.01, seed: 5 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('survive being saved and read back', () => {
    const recording = synthesise(keys, { noise: 0.005 });
    const restored = parseRecording(JSON.parse(JSON.stringify(recording)));
    expect(restored.frames).toHaveLength(recording.frames.length);
    const original = frameObservations(recording.frames[40])[0];
    const again = frameObservations(restored.frames[40])[0];
    expect(again.image[8].x).toBeCloseTo(original.image[8].x, 5);
    expect(again.label).toBe('Right');
  });

  it('refuse a file that is not a recording, or does not say where it came from', () => {
    expect(() => parseRecording(null)).toThrow(/Not a landmark recording/);
    expect(() => parseRecording({ format: 'something-else' })).toThrow(/Not a landmark recording/);
    const good = synthesise(keys);
    expect(() => parseRecording({ ...good, origin: undefined })).toThrow(/where it came from/);
    expect(() => parseRecording({ ...good, version: 2 })).toThrow(/different version/);
    expect(() => parseRecording({ ...good, frames: [{ t: 0, hands: [{ image: [1, 2, 3], world: null, label: null, score: null }] }] })).toThrow(/damaged/);
  });

  it('can be built up frame by frame from live tracking, landmarks only', () => {
    const builder = new RecordingBuilder();
    const observation = observePose(postureOf('open', 'right'));
    for (let index = 0; index < 31; index += 1) builder.push(5000 + index * FRAME, [observation]);
    const recording = builder.build({ origin: 'recorded', label: 'Test', aspect: ASPECT });
    expect(recording.frames).toHaveLength(31);
    expect(recording.frames[0].t).toBe(0);
    expect(recording.fps).toBeCloseTo(30, 0);
    expect(Object.keys(recording.frames[0].hands[0]).sort()).toEqual(['image', 'label', 'score', 'world']);
    expect(packObservation(observation).image).toHaveLength(63);
  });

  it('play back against a clock, one new frame at a time', () => {
    const recording = synthesise(keys);
    const cursor = new ReplayCursor(recording);
    expect(cursor.advance(0)?.t).toBe(0);
    expect(cursor.advance(0)).toBeNull();
    expect(cursor.advance(10)).toBeNull();
    expect(cursor.advance(34)?.t).toBe(33);
    // A slow screen skips frames rather than falling behind.
    expect(cursor.advance(500)?.t).toBe(500);
    expect(cursor.finished).toBe(false);
    cursor.advance(1e9);
    expect(cursor.finished).toBe(true);
  });

  it('can loop', () => {
    const recording = synthesise(keys);
    const cursor = new ReplayCursor(recording, true);
    cursor.advance(cursor.durationMs);
    expect(cursor.finished).toBe(false);
    expect(cursor.advance(cursor.durationMs + 200)?.t).toBeLessThan(400);
  });
});
