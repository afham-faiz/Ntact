/**
 * Turns the model's frame-by-frame landmarks into a steady track of one hand.
 *
 * Four jobs, in this order every frame:
 *   1. Reject implausible jumps (the model briefly locking on to something else,
 *      or a finger's landmarks teleporting), so one bad frame cannot move a measurement.
 *   2. Bridge short gaps: for a moment after the hand is lost the last good frame
 *      is held, marked as held, and never used for a measurement.
 *   3. Smooth what is accepted with a One Euro filter.
 *   4. Report how steady the track is, in plain geometric terms.
 *
 * Clock-free: the caller passes the time, so the same frames give the same result.
 */
import { imagePalmSize, isHand, LANDMARK_COUNT } from './geometry';
import { OneEuroBank, type OneEuroParams } from './oneEuro';
import { dist, median, type Vec3 } from './vec';

/** One hand as the model reported it, before any processing. */
export interface HandObservation {
  /** Normalised picture coordinates of the unmirrored camera frame: x and y in 0..1, z relative depth on x's scale. */
  image: Vec3[];
  /** The model's 3-D estimate of the hand, in metres, axes aligned with the camera. May be absent. */
  world: Vec3[] | null;
  /** The model's own left/right label, exactly as reported. */
  label: 'Left' | 'Right' | null;
  /** The model's score for that label, 0..1. The only confidence value the model exposes. */
  score: number | null;
}

export interface StabiliserConfig {
  image: OneEuroParams;
  world: OneEuroParams;
  /** The whole hand may not move further than this between frames. Palm lengths per second. */
  maxCentroidSpeed: number;
  /** No single landmark may move further than this relative to the rest of the hand. Palm lengths per second. */
  maxShapeSpeed: number;
  /** The hand's size in the picture may not change faster than this. Fraction per second. */
  maxScaleRate: number;
  /** After this many rejected frames in a row, the new position is believed and tracking restarts there. */
  rejectLimit: number;
  /** How long the last good frame is held after the hand is lost. */
  holdMs: number;
}

/**
 * Filter settings, in palm lengths so they hold at any distance from the camera.
 * Measured on synthetic sequences (tests/trackingFilter.test.ts): at 30 frames a
 * second a 1 Hz finger movement keeps more than 95% of its amplitude and trails by
 * under 40 ms, while frame-to-frame jitter on a still hand falls by more than half.
 */
export const DEFAULT_STABILISER: StabiliserConfig = {
  image: { minCutoff: 1.6, beta: 2.4, derivativeCutoff: 1.2 },
  world: { minCutoff: 1.6, beta: 2.4, derivativeCutoff: 1.2 },
  maxCentroidSpeed: 34,
  maxShapeSpeed: 18,
  maxScaleRate: 7,
  rejectLimit: 3,
  holdMs: 300,
};

/**
 * tracking: this frame was accepted.
 * holding:  nothing usable this frame; the last good frame is shown, briefly.
 * lost:     no hand.
 */
export type TrackStatus = 'tracking' | 'holding' | 'lost';

export interface StabilisedHand {
  status: TrackStatus;
  /** The observation the model gave this frame, accepted or not. */
  raw: HandObservation | null;
  /** Filtered landmarks. Null when lost. */
  image: Vec3[] | null;
  world: Vec3[] | null;
  /** True when this frame's observation was thrown away as an implausible jump. */
  rejected: boolean;
  /** True on the frame tracking restarted after a jump that persisted. */
  reacquired: boolean;
  /** How long frames have been accepted without a break. */
  trackedMs: number;
  /** Frame-to-frame wobble of the raw landmarks, in palm lengths. A heuristic, not a model output. */
  jitter: number;
  /** How fast the palm is moving across the picture, in palm lengths per second. */
  palmSpeed: number;
  /** The palm's size in the picture, in units of picture height. */
  palmSize: number;
}

const PALM = [0, 5, 9, 13, 17] as const;

function centroid(points: readonly Vec3[], aspect: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const index of PALM) {
    x += points[index].x * aspect;
    y += points[index].y;
  }
  return { x: x / PALM.length, y: y / PALM.length };
}

const flatten = (points: readonly Vec3[]): number[] => points.flatMap((point) => [point.x, point.y, point.z]);

function unflatten(values: readonly number[]): Vec3[] {
  const points: Vec3[] = [];
  for (let index = 0; index < values.length; index += 3) points.push({ x: values[index], y: values[index + 1], z: values[index + 2] });
  return points;
}

const LOST: StabilisedHand = {
  status: 'lost',
  raw: null,
  image: null,
  world: null,
  rejected: false,
  reacquired: false,
  trackedMs: 0,
  jitter: 0,
  palmSpeed: 0,
  palmSize: 0,
};

export class LandmarkStabiliser {
  private readonly config: StabiliserConfig;
  private readonly imageBank: OneEuroBank;
  private readonly worldBank: OneEuroBank;
  private lastRaw: Vec3[] | null = null;
  private beforeLastRaw: Vec3[] | null = null;
  private lastImage: Vec3[] | null = null;
  private lastWorld: Vec3[] | null = null;
  private lastAcceptedAt = 0;
  private trackedSince = 0;
  private rejectCount = 0;
  private jitter = 0;
  private palmSpeed = 0;
  private palmSize = 0;
  private worldScale = 0.09;

  constructor(config: Partial<StabiliserConfig> = {}) {
    this.config = { ...DEFAULT_STABILISER, ...config };
    this.imageBank = new OneEuroBank(LANDMARK_COUNT * 3, this.config.image);
    this.worldBank = new OneEuroBank(LANDMARK_COUNT * 3, this.config.world);
  }

  reset(): void {
    this.imageBank.reset();
    this.worldBank.reset();
    this.lastRaw = null;
    this.beforeLastRaw = null;
    this.lastImage = null;
    this.lastWorld = null;
    this.rejectCount = 0;
    this.jitter = 0;
    this.palmSpeed = 0;
  }

  /** `aspect` is picture width divided by height. */
  update(observation: HandObservation | null, now: number, aspect: number): StabilisedHand {
    const usable = observation !== null && isHand(observation.image);
    if (!usable) return this.missed(observation, now, false);

    const raw = observation.image;
    const size = imagePalmSize(raw, aspect);
    const dt = Math.min(0.25, Math.max(1 / 240, (now - this.lastAcceptedAt) / 1000));
    let reacquired = false;

    if (this.lastRaw) {
      if (this.isJump(raw, this.lastRaw, size, dt, aspect)) {
        this.rejectCount += 1;
        if (this.rejectCount < this.config.rejectLimit) return this.missed(observation, now, true);
        // It has stayed there: believe it, and start the track again from here.
        this.reset();
        reacquired = true;
      }
    }
    this.rejectCount = 0;

    if (!this.lastRaw) {
      this.trackedSince = now;
      this.palmSize = size;
    } else {
      // Steadiness figures come from the raw landmarks, before smoothing hides them.
      const reference = Math.max(this.palmSize, 1e-6);
      const before = centroid(this.lastRaw, aspect);
      const after = centroid(raw, aspect);
      const speed = Math.hypot(after.x - before.x, after.y - before.y) / reference / dt;
      this.palmSpeed += 0.5 * (speed - this.palmSpeed);
      if (this.beforeLastRaw) {
        const wobble: number[] = [];
        for (let index = 0; index < LANDMARK_COUNT; index += 1) {
          const ax = (raw[index].x - 2 * this.lastRaw[index].x + this.beforeLastRaw[index].x) * aspect;
          const ay = raw[index].y - 2 * this.lastRaw[index].y + this.beforeLastRaw[index].y;
          wobble.push(Math.hypot(ax, ay) / reference);
        }
        this.jitter += 0.25 * ((median(wobble) ?? 0) - this.jitter);
      }
      this.palmSize += 0.3 * (size - this.palmSize);
    }

    // z shares x's scale in the model's output, so the palm's size in x units is the reference for all three.
    const imageScale = Math.max(this.palmSize / aspect, 1e-6);
    this.lastImage = unflatten(this.imageBank.filter(flatten(raw), dt, imageScale));
    if (isHand(observation.world)) {
      const palm = dist(observation.world[0], observation.world[9]);
      if (palm > 0.02) this.worldScale += 0.2 * (palm - this.worldScale);
      this.lastWorld = unflatten(this.worldBank.filter(flatten(observation.world), dt, this.worldScale));
    } else {
      this.lastWorld = null;
    }

    this.beforeLastRaw = this.lastRaw;
    this.lastRaw = raw;
    this.lastAcceptedAt = now;

    return {
      status: 'tracking',
      raw: observation,
      image: this.lastImage,
      world: this.lastWorld,
      rejected: false,
      reacquired,
      trackedMs: now - this.trackedSince,
      jitter: this.jitter,
      palmSpeed: this.palmSpeed,
      palmSize: this.palmSize,
    };
  }

  private missed(observation: HandObservation | null, now: number, rejected: boolean): StabilisedHand {
    if (this.lastImage && now - this.lastAcceptedAt <= this.config.holdMs) {
      return {
        status: 'holding',
        raw: observation,
        image: this.lastImage,
        world: this.lastWorld,
        rejected,
        reacquired: false,
        trackedMs: 0,
        jitter: this.jitter,
        palmSpeed: this.palmSpeed,
        palmSize: this.palmSize,
      };
    }
    this.reset();
    return { ...LOST, raw: observation, rejected };
  }

  private isJump(raw: readonly Vec3[], previous: readonly Vec3[], size: number, dt: number, aspect: number): boolean {
    const reference = Math.max(this.palmSize, 1e-6);
    const { maxCentroidSpeed, maxShapeSpeed, maxScaleRate } = this.config;

    const before = centroid(previous, aspect);
    const after = centroid(raw, aspect);
    const shiftX = after.x - before.x;
    const shiftY = after.y - before.y;
    if (Math.hypot(shiftX, shiftY) / reference > maxCentroidSpeed * dt) return true;

    if (Math.abs(Math.log(size / reference)) > Math.log(1 + maxScaleRate * dt)) return true;

    // With the hand's own travel taken out, no landmark should leap.
    let worst = 0;
    for (let index = 0; index < LANDMARK_COUNT; index += 1) {
      const dx = (raw[index].x - previous[index].x) * aspect - shiftX;
      const dy = raw[index].y - previous[index].y - shiftY;
      worst = Math.max(worst, Math.hypot(dx, dy));
    }
    return worst / reference > maxShapeSpeed * dt;
  }
}
