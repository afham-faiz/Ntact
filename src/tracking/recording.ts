/**
 * Landmark recordings: a session's landmarks, without any video.
 *
 * Two uses. Replay: the tracking pipeline and the assessment engine can be run on
 * a stored sequence exactly as they run on a camera, which is how the engine is
 * tested and how the labelled backup demonstration works. Research: a consented
 * recording of a real hand can be replayed through a changed algorithm to see what
 * the change does to the same movement.
 *
 * A recording holds landmark coordinates only. It never holds a picture.
 * `origin` says whether a person was involved at all, and travels with the data.
 */
import type { Hand } from '../domain/types';
import { isHand } from './geometry';
import {
  blendPose,
  gaussian,
  observePose,
  postureOf,
  seededRandom,
  shifted,
  withNoise,
  type CameraPose,
  type HandPose,
  type Posture,
} from './handModel';
import type { HandObservation } from './stabiliser';
import type { Vec3 } from './vec';

export interface RecordedHand {
  /** 63 numbers: x, y, z for each of the 21 picture landmarks. */
  image: number[];
  world: number[] | null;
  label: 'Left' | 'Right' | null;
  score: number | null;
}

export interface RecordedFrame {
  /** Milliseconds from the start of the recording. */
  t: number;
  hands: RecordedHand[];
}

export interface LandmarkRecording {
  format: 'ntact-landmarks';
  version: 1;
  /**
   * synthetic: produced by the kinematic hand model. No person was involved.
   * recorded:  landmarks of a real hand, captured with that person's consent.
   */
  origin: 'synthetic' | 'recorded';
  label: string;
  note?: string;
  /** Picture width divided by height. */
  aspect: number;
  fps: number;
  createdAt?: string;
  frames: RecordedFrame[];
}

const round = (value: number): number => Math.round(value * 1e5) / 1e5;
const pack = (points: readonly Vec3[]): number[] => points.flatMap((point) => [round(point.x), round(point.y), round(point.z)]);

function unpack(values: readonly number[]): Vec3[] {
  const points: Vec3[] = [];
  for (let index = 0; index + 2 < values.length; index += 3) points.push({ x: values[index], y: values[index + 1], z: values[index + 2] });
  return points;
}

export function packObservation(observation: HandObservation): RecordedHand {
  return {
    image: pack(observation.image),
    world: observation.world ? pack(observation.world) : null,
    label: observation.label,
    score: observation.score === null ? null : round(observation.score),
  };
}

export function frameObservations(frame: RecordedFrame): HandObservation[] {
  return frame.hands.map((hand) => ({
    image: unpack(hand.image),
    world: hand.world ? unpack(hand.world) : null,
    label: hand.label,
    score: hand.score,
  }));
}

/** Collects frames as they are tracked. Landmarks only. */
export class RecordingBuilder {
  private readonly frames: RecordedFrame[] = [];
  private startedAt: number | null = null;

  get length(): number {
    return this.frames.length;
  }

  push(now: number, observations: readonly HandObservation[]): void {
    if (this.startedAt === null) this.startedAt = now;
    this.frames.push({ t: Math.round(now - this.startedAt), hands: observations.filter((item) => isHand(item.image)).map(packObservation) });
  }

  build(meta: Pick<LandmarkRecording, 'origin' | 'label' | 'aspect'> & { note?: string; createdAt?: string }): LandmarkRecording {
    const duration = this.frames.length > 1 ? this.frames[this.frames.length - 1].t / 1000 : 0;
    return {
      format: 'ntact-landmarks',
      version: 1,
      ...meta,
      fps: duration > 0 ? Math.round(((this.frames.length - 1) / duration) * 10) / 10 : 0,
      frames: [...this.frames],
    };
  }
}

/** Checks a value read from a file before it is trusted. Throws with a plain reason. */
export function parseRecording(value: unknown): LandmarkRecording {
  if (typeof value !== 'object' || value === null) throw new Error('Not a landmark recording.');
  const candidate = value as Partial<LandmarkRecording>;
  if (candidate.format !== 'ntact-landmarks') throw new Error('Not a landmark recording.');
  if (candidate.version !== 1) throw new Error('This recording was made by a different version.');
  if (candidate.origin !== 'synthetic' && candidate.origin !== 'recorded') throw new Error('The recording does not say where it came from.');
  if (!Array.isArray(candidate.frames) || typeof candidate.aspect !== 'number' || !(candidate.aspect > 0)) throw new Error('The recording is incomplete.');
  let previous = -1;
  for (const frame of candidate.frames) {
    if (typeof frame?.t !== 'number' || frame.t < previous || !Array.isArray(frame.hands)) throw new Error('The recording has a damaged frame.');
    previous = frame.t;
    for (const hand of frame.hands) {
      const numbers = (list: unknown): list is number[] => Array.isArray(list) && list.length === 63 && list.every((item) => typeof item === 'number' && Number.isFinite(item));
      if (!numbers(hand?.image) || (hand.world !== null && !numbers(hand.world))) throw new Error('The recording has a damaged frame.');
    }
  }
  return {
    format: 'ntact-landmarks',
    version: 1,
    origin: candidate.origin,
    label: typeof candidate.label === 'string' ? candidate.label : 'Untitled recording',
    note: typeof candidate.note === 'string' ? candidate.note : undefined,
    aspect: candidate.aspect,
    fps: typeof candidate.fps === 'number' ? candidate.fps : 0,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : undefined,
    frames: candidate.frames,
  };
}

/** Plays a recording against a clock: which frame is current at a given time since the start. */
export class ReplayCursor {
  private index = -1;

  constructor(
    readonly recording: LandmarkRecording,
    private readonly loop = false,
  ) {}

  get durationMs(): number {
    const frames = this.recording.frames;
    return frames.length === 0 ? 0 : frames[frames.length - 1].t;
  }

  /** The frame that became current since the last call, or null when there is no new one yet. */
  advance(elapsedMs: number): RecordedFrame | null {
    const frames = this.recording.frames;
    if (frames.length === 0) return null;
    const time = this.loop && this.durationMs > 0 ? elapsedMs % (this.durationMs + 1000 / Math.max(1, this.recording.fps)) : elapsedMs;
    if (this.loop && this.index >= 0 && frames[this.index].t > time) this.index = -1;
    let next = this.index;
    while (next + 1 < frames.length && frames[next + 1].t <= time) next += 1;
    if (next === this.index) return null;
    this.index = next;
    return frames[next];
  }

  get finished(): boolean {
    return !this.loop && this.index >= this.recording.frames.length - 1;
  }
}

// ---------- Synthetic sequences ----------

export interface SequenceKey {
  /** Seconds from the start. */
  at: number;
  pose: HandPose;
}

export interface SequenceOptions {
  camera?: Partial<CameraPose>;
  fps?: number;
  /** Landmark noise, in palm lengths (0.01 is about a millimetre on an adult hand). */
  noise?: number;
  seed?: number;
  /**
   * A handheld camera: the whole hand wanders in the picture. `amplitude` is a fraction of the
   * picture, `hz` its main frequency. A slow sway with a faster component and a little tremor.
   */
  shake?: { amplitude: number; hz: number };
  /** Stretches of seconds in which the model reports no hand. */
  dropouts?: [number, number][];
  /** Moments (seconds) at which the model reports the hand somewhere else for one frame. */
  glitches?: number[];
  label?: string;
}

const ease = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

function poseAt(keys: readonly SequenceKey[], seconds: number): HandPose {
  if (seconds <= keys[0].at) return keys[0].pose;
  for (let index = 1; index < keys.length; index += 1) {
    if (seconds <= keys[index].at) {
      const span = keys[index].at - keys[index - 1].at;
      return blendPose(keys[index - 1].pose, keys[index].pose, span <= 0 ? 1 : ease((seconds - keys[index - 1].at) / span));
    }
  }
  return keys[keys.length - 1].pose;
}

/** Renders a keyframed movement of the kinematic hand as a recording. Everything it returns is synthetic. */
export function synthesise(keys: readonly SequenceKey[], options: SequenceOptions = {}): LandmarkRecording {
  const fps = options.fps ?? 30;
  const random = seededRandom(options.seed ?? 1);
  const aspect = options.camera?.aspect ?? 4 / 3;
  const duration = keys[keys.length - 1].at;
  const frames: RecordedFrame[] = [];
  const phase = random() * Math.PI * 2;

  for (let index = 0; index <= Math.round(duration * fps); index += 1) {
    const seconds = index / fps;
    const t = Math.round(seconds * 1000);
    if (options.dropouts?.some(([from, to]) => seconds >= from && seconds < to)) {
      frames.push({ t, hands: [] });
      continue;
    }
    let observation = observePose(poseAt(keys, seconds), { ...options.camera, aspect });
    if (options.shake) {
      const { amplitude, hz } = options.shake;
      const wave = 2 * Math.PI * hz * seconds + phase;
      observation = shifted(
        observation,
        amplitude * (Math.sin(wave) + 0.3 * Math.sin(wave * 2.7 + 1) + 0.06 * gaussian(random)),
        amplitude * (Math.cos(wave * 0.8) + 0.3 * Math.sin(wave * 3.1) + 0.06 * gaussian(random)),
      );
    }
    if (options.glitches?.some((at) => Math.abs(at - seconds) < 0.5 / fps)) observation = shifted(observation, 0.3, -0.2);
    observation = withNoise(observation, options.noise ?? 0, random);
    frames.push({ t, hands: [packObservation(observation)] });
  }

  return {
    format: 'ntact-landmarks',
    version: 1,
    origin: 'synthetic',
    label: options.label ?? 'Synthetic sequence',
    note: 'Generated by the kinematic hand model. No person was involved.',
    aspect,
    fps,
    frames,
  };
}

export interface RepScript {
  side: Hand;
  from: Posture | HandPose;
  to: Posture | HandPose;
  reps: number;
  /** How far towards `to` each repetition goes, 0 to 1. One value, or one per repetition. */
  amount?: number | number[];
  /** Seconds before the first movement, spent in the starting position. */
  lead?: number;
  move?: number;
  /** Seconds the target is held. One value, or one per repetition. */
  hold?: number | number[];
  rest?: number;
}

/** Keyframes for a number of repetitions: start, move to the target, hold, move back, rest. */
export function repetitionKeys(script: RepScript): SequenceKey[] {
  const { side, reps, lead = 1.6, move = 0.9, rest = 1.4 } = script;
  const start = typeof script.from === 'string' ? postureOf(script.from, side) : script.from;
  const full = typeof script.to === 'string' ? postureOf(script.to, side) : script.to;
  const keys: SequenceKey[] = [{ at: 0, pose: start }];
  let clock = lead;
  keys.push({ at: clock, pose: start });
  for (let rep = 0; rep < reps; rep += 1) {
    const amount = Array.isArray(script.amount) ? (script.amount[rep] ?? 1) : (script.amount ?? 1);
    const target = blendPose(start, full, amount);
    clock += move;
    keys.push({ at: clock, pose: target });
    clock += Array.isArray(script.hold) ? (script.hold[rep] ?? 2.4) : (script.hold ?? 2.4);
    keys.push({ at: clock, pose: target });
    clock += move;
    keys.push({ at: clock, pose: start });
    clock += rest;
    keys.push({ at: clock, pose: start });
  }
  return keys;
}
