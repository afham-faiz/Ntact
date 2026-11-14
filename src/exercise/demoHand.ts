/**
 * A drawn hand that opens and closes by itself.
 *
 * It exists for two reasons: so the exercise screen can be shown where there is no
 * camera (or the camera is refused), and so the rep counter can be tested without
 * one. Everything it produces is labelled as a demonstration and saved as simulated.
 * It is never used silently in place of the camera.
 */
import {
  FINGERS,
  FINGER_CHAIN,
  type ExerciseMetric,
  type FingerValues,
  type HandFrame,
  type Point3,
} from '../domain/exercise';
import type { Finger } from '../domain/types';

const v = (x: number, y: number, z: number): Point3 => ({ x, y, z });
const add = (a: Point3, b: Point3): Point3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const scale = (a: Point3, k: number): Point3 => v(a.x * k, a.y * k, a.z * k);
const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (a: Point3): Point3 => scale(a, 1 / Math.hypot(a.x, a.y, a.z));

/** A simple adult right hand, palm towards the viewer, in metres. x right, y up, z away from the viewer. */
const BASE: Record<Finger, { root: Point3; aim: Point3; bones: [number, number, number]; bend: [number, number, number] }> = {
  thumb: { root: v(0.028, 0.024, 0), aim: v(0.78, 0.62, 0), bones: [0.038, 0.032, 0.027], bend: [0, 48, 52] },
  index: { root: v(0.024, 0.092, 0), aim: v(0.1, 1, 0), bones: [0.042, 0.026, 0.021], bend: [84, 100, 62] },
  middle: { root: v(0.003, 0.097, 0), aim: v(0.0, 1, 0), bones: [0.046, 0.029, 0.022], bend: [86, 102, 64] },
  ring: { root: v(-0.017, 0.092, 0), aim: v(-0.08, 1, 0), bones: [0.042, 0.027, 0.021], bend: [86, 102, 64] },
  little: { root: v(-0.035, 0.08, 0), aim: v(-0.2, 1, 0), bones: [0.033, 0.021, 0.019], bend: [84, 96, 60] },
};

/**
 * Joint bends for a finger slide: the knuckle stays where it is (it even lifts a
 * touch) while the two end joints fold, drawing the fingertip back towards the palm.
 */
const HOOK_BEND: Record<'finger' | 'thumb', [number, number, number]> = {
  finger: [-8, 96, 44],
  thumb: [0, 8, 10],
};

/** Fingers fold towards the palm; the thumb folds across it. */
const FOLD: Record<'finger' | 'thumb', Point3> = {
  finger: v(0, 0, -1),
  thumb: v(-0.72, 0.18, -0.67),
};

/** `direction` turned by `degrees` towards `towards`, staying in the plane the two define. */
function turn(direction: Point3, towards: Point3, degrees: number): Point3 {
  const d = unit(direction);
  const sideways = unit(add(towards, scale(d, -dot(towards, d))));
  const angle = (degrees * Math.PI) / 180;
  return add(scale(d, Math.cos(angle)), scale(sideways, Math.sin(angle)));
}

export interface SyntheticHandOptions {
  /** Where the wrist sits in the picture, 0..1. */
  wristX?: number;
  wristY?: number;
  /** Picture units per metre. 3 makes the hand fill a little over half the height. */
  zoom?: number;
  /** Which movement the curl values drive. 'fist' unless told otherwise. */
  pattern?: ExerciseMetric;
}

/** A full set of 21 landmarks for a hand with each finger curled by the given amount (0..1). */
export function syntheticHand(curl: FingerValues, options: SyntheticHandOptions = {}): HandFrame {
  const { wristX = 0.5, wristY = 0.8, zoom = 3, pattern = 'fist' } = options;
  const world: Point3[] = new Array<Point3>(21);
  world[0] = v(0, 0, 0);

  for (const finger of FINGERS) {
    const shape = BASE[finger];
    const amount = Math.min(1, Math.max(0, curl[finger]));
    const kind = finger === 'thumb' ? 'thumb' : 'finger';
    const fold = FOLD[kind];
    const bends = pattern === 'hook' ? HOOK_BEND[kind] : shape.bend;
    const chain = FINGER_CHAIN[finger];
    let position = shape.root;
    let turned = 0;
    world[chain[0]] = position;
    for (let joint = 0; joint < 3; joint += 1) {
      turned += bends[joint] * amount;
      position = add(position, scale(turn(shape.aim, fold, turned), shape.bones[joint]));
      world[chain[joint + 1]] = position;
    }
  }

  const image = world.map((point) => v(wristX + point.x * zoom, wristY - point.y * zoom, point.z * zoom));
  return { image, world };
}

/** One smooth step from 0 to 1. */
const ease = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** How closed the demonstration hand is at time `t` seconds: open, curl, hold, uncurl, repeat. */
export function demoClosure(seconds: number): number {
  const cycle = 3.4;
  const t = ((seconds % cycle) + cycle) % cycle;
  if (t < 0.7) return 0;
  if (t < 1.6) return ease((t - 0.7) / 0.9);
  if (t < 2.2) return 1;
  if (t < 3.1) return 1 - ease((t - 2.2) / 0.9);
  return 0;
}

/**
 * The demonstration hand as a frame source. The injured finger is drawn stiffer
 * than the others (it curls less and straightens a little less), so the screen
 * shows what the coaching and the per-finger read-out are for.
 */
export class DemoHandSource {
  readonly kind = 'demo-motion' as const;
  private readonly injured: Finger;
  private readonly pattern: ExerciseMetric;
  /** How far the uninjured fingers go. A squeeze round a ball is a smaller movement than a fist. */
  private readonly reach: number;
  private startedAt: number | null = null;

  constructor(injured: Finger, pattern: ExerciseMetric = 'fist', reach = 1) {
    this.injured = injured;
    this.pattern = pattern;
    this.reach = reach;
  }

  read(now: number): HandFrame {
    if (this.startedAt === null) this.startedAt = now;
    const seconds = (now - this.startedAt) / 1000;
    // A short pause with the hand open before the first repetition.
    const closure = (seconds < 1.2 ? 0 : demoClosure(seconds - 1.2)) * this.reach;
    const curl: FingerValues = { thumb: closure * 0.85, index: closure, middle: closure, ring: closure, little: closure * 0.97 };
    curl[this.injured] = 0.07 + closure * 0.68;
    // A slow drift, so it reads as a hand being held up rather than a diagram.
    const sway = Math.sin(seconds * 0.9) * 0.012;
    const bob = Math.sin(seconds * 1.3 + 1) * 0.008;
    return syntheticHand(curl, { wristX: 0.5 + sway, wristY: 0.75 + bob, zoom: 3.25, pattern: this.pattern });
  }
}
