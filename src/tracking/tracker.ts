/**
 * The tracking pipeline: model observations in, one fully described hand out.
 *
 *   observations -> choose the hand -> stabilise -> which hand -> palm axes
 *                -> view -> graded joint estimates -> frame quality
 *
 * Pure and clock-free. It knows nothing about the camera, the screen or any
 * exercise: the same class runs on a live camera, on a replayed recording and in
 * the tests.
 */
import type { Finger, Hand } from '../domain/types';
import {
  FINGERS,
  LONG_FINGERS,
  chiralityFromCurl,
  compositeFlexion,
  framingOf,
  handView,
  isHand,
  jointAngles,
  jointEstimates,
  occludedLandmarks,
  oppositionDistance,
  palmFrame,
  tipReach,
  type Framing,
  type JointAngles,
  type JointEstimates,
  type LongFinger,
  type PalmFrame,
  type ViewInfo,
} from './geometry';
import {
  DEFAULT_STABILISER,
  LandmarkStabiliser,
  type HandObservation,
  type StabiliserConfig,
  type TrackStatus,
} from './stabiliser';
import type { Vec3 } from './vec';

export const ENGINE_VERSION = '1.0.0';

// ---------- Frame quality ----------

/**
 * Why a frame cannot be used for a measurement. Each is a plain geometric or
 * timing check on the landmarks; none is a probability.
 */
export type QualityReason =
  | 'no-hand'
  | 'tracking-held'
  | 'clipped'
  | 'too-far'
  | 'too-close'
  | 'device-moving'
  | 'moving-fast'
  | 'unstable'
  | 'settling';

/** Things worth telling the person that do not, on their own, stop a measurement. */
export type QualityAdvisory = 'low-light' | 'low-frame-rate' | 'second-hand';

export interface QualityConfig {
  /** Frames must have been accepted without a break for this long before a measurement is taken. */
  settleMs: number;
  /** Raw landmark wobble above this (palm lengths) is treated as unstable tracking. */
  maxJitter: number;
  /** The palm moving across the picture faster than this (palm lengths per second) pauses measurement. */
  maxPalmSpeed: number;
  /** A phone turning faster than this (degrees per second, from its motion sensor) pauses measurement. */
  maxDeviceRotation: number;
  /** Mean picture brightness (0 to 255) below this raises the low-light advisory. */
  minLuma: number;
  /** Fewer processed frames per second than this raises the low-frame-rate advisory. */
  minFps: number;
}

export const DEFAULT_QUALITY: QualityConfig = {
  settleMs: 350,
  // 0.05 flagged a visibly steady hand in a dim room on a first real recording (measured 0.02 to 0.06).
  maxJitter: 0.07,
  maxPalmSpeed: 1.8,
  maxDeviceRotation: 45,
  minLuma: 40,
  minFps: 12,
};

export interface FrameQuality {
  /** True when this frame may contribute to a measurement. */
  ok: boolean;
  /** Empty when `ok`. Most important first. */
  reasons: QualityReason[];
  advisories: QualityAdvisory[];
  framing: Framing;
  /** Larger side of the hand's bounding box, as a fraction of the picture. */
  size: number;
  /** Heuristics computed here from the landmarks. */
  jitter: number;
  palmSpeed: number;
  stableMs: number;
  /** The model's own score for its left/right label: the one genuine model confidence available. */
  modelScore: number | null;
}

// ---------- The tracked frame ----------

export interface FrameMeasures {
  /** MCP + PIP + DIP per digit (MCP + IP for the thumb), degrees. */
  composite: Record<Finger, number>;
  /** Fingertip-to-knuckle distance as a fraction of the finger's length. */
  reach: Record<Finger, number>;
  /** Thumb tip to each fingertip, in palm lengths. */
  opposition: Record<LongFinger, number>;
}

/** How the left/right decision was reached. */
export type SideSource = 'shape' | 'model' | 'expected' | 'default';

export interface TrackedFrame {
  t: number;
  status: TrackStatus;
  /** How many hands the model reported this frame. */
  handsSeen: number;
  raw: HandObservation | null;
  /** Filtered picture landmarks, for drawing. */
  image: Vec3[] | null;
  /** Filtered 3-D landmarks, which every angle is computed from. */
  world: Vec3[] | null;
  side: Hand | null;
  sideSource: SideSource | null;
  /** What the model's label maps to under the convention in force, and what the hand's shape says. */
  modelSide: Hand | null;
  shapeSide: Hand | null;
  /** True once the hand's shape has confirmed which hand this is. Until then palm and back cannot be told apart for certain. */
  sideConfirmed: boolean;
  frame: PalmFrame | null;
  view: ViewInfo | null;
  angles: JointAngles | null;
  joints: JointEstimates | null;
  measures: FrameMeasures | null;
  hidden: boolean[] | null;
  quality: FrameQuality;
  /** The observation this frame was discarded as an implausible jump. */
  rejected: boolean;
}

export interface TrackerContext {
  /** Picture width divided by height. */
  aspect: number;
  /** The hand the session is set up for, when known. */
  expectedHand?: Hand | null;
  /** Mean picture brightness, 0 to 255, when it has been sampled. */
  luma?: number | null;
  /** Rotation rate of the device from its motion sensor, degrees per second, when available. */
  deviceRotation?: number | null;
  /** Processed frames per second, when measured. */
  fps?: number | null;
}

export interface TrackerConfig {
  stabiliser: StabiliserConfig;
  quality: QualityConfig;
}

export const DEFAULT_TRACKER: TrackerConfig = { stabiliser: DEFAULT_STABILISER, quality: DEFAULT_QUALITY };

// ---------- Choosing one hand ----------

function centre(points: readonly Vec3[]): { x: number; y: number } {
  return { x: (points[0].x + points[9].x) / 2, y: (points[0].y + points[9].y) / 2 };
}

/**
 * Which of the reported hands to follow. The one already being followed wins, so a
 * second hand entering the picture never steals the track; otherwise the hand the
 * session expects, then the larger.
 */
export function chooseObservation(
  observations: readonly HandObservation[],
  following: readonly Vec3[] | null,
  expected: Hand | null,
  mapLabel: (label: HandObservation['label']) => Hand | null,
): HandObservation | null {
  const hands = observations.filter((observation) => isHand(observation.image));
  if (hands.length === 0) return null;
  if (hands.length === 1) return hands[0];
  if (following) {
    const target = centre(following);
    return [...hands].sort((a, b) => {
      const ca = centre(a.image);
      const cb = centre(b.image);
      return Math.hypot(ca.x - target.x, ca.y - target.y) - Math.hypot(cb.x - target.x, cb.y - target.y);
    })[0];
  }
  const sizeOf = (hand: HandObservation) => framingOf(hand.image).size;
  return [...hands].sort((a, b) => {
    const ea = expected && mapLabel(a.label) === expected ? 1 : 0;
    const eb = expected && mapLabel(b.label) === expected ? 1 : 0;
    return eb - ea || sizeOf(b) - sizeOf(a);
  })[0];
}

// ---------- Left or right ----------

/**
 * What the model's "Left"/"Right" label means.
 * subject:  the label names the person's actual hand (what the model's own documentation says for an unmirrored picture).
 * mirrored: the label is the other way round (the behaviour of the model's older releases, which assumed a mirrored selfie picture).
 */
export type LabelConvention = 'subject' | 'mirrored';

/**
 * Finger curl (see `chiralityFromCurl`) that settles left versus right beyond doubt.
 * Set from a first recording of a real hand, where depth errors on a flat palm
 * reached about -0.8 the wrong way: only clearly curled fingers (a hook or a fist) count.
 */
const SHAPE_CERTAIN = 1.5;
const SHAPE_FRAMES = 4;

/**
 * Decides which hand is being tracked.
 *
 * The model's label is the working answer. The hand's own shape is the check:
 * once the fingers are clearly bent, which way they curl settles the question, and
 * from then on the shape's answer is kept for as long as the hand stays in view.
 * If the shape and the label disagree every time, the label convention is taken to
 * be the other one for the rest of the session, so a model release that reports
 * handedness the other way round corrects itself the first time a fist is made.
 */
export class SideResolver {
  private convention: LabelConvention = 'subject';
  private latched: Hand | null = null;
  private shapeRun: { side: Hand; frames: number } | null = null;
  private votes = { left: 0, right: 0 };
  private agreements = 0;
  private disagreements = 0;

  get labelConvention(): LabelConvention {
    return this.convention;
  }

  mapLabel = (label: HandObservation['label']): Hand | null => {
    if (label === null) return null;
    const named: Hand = label === 'Left' ? 'left' : 'right';
    return this.convention === 'subject' ? named : named === 'left' ? 'right' : 'left';
  };

  /** Call when the hand leaves the picture. What was learned about the label convention is kept. */
  trackLost(): void {
    this.latched = null;
    this.shapeRun = null;
    this.votes = { left: 0, right: 0 };
  }

  resolve(
    points: readonly Vec3[],
    label: HandObservation['label'],
    score: number | null,
    expected: Hand | null,
  ): { side: Hand; source: SideSource; modelSide: Hand | null; shapeSide: Hand | null; confirmed: boolean } {
    const { side: shapeSide, curl } = chiralityFromCurl(points);
    const certain: Hand | null = curl >= SHAPE_CERTAIN ? 'right' : curl <= -SHAPE_CERTAIN ? 'left' : null;

    const modelNow = this.mapLabel(label);
    if (modelNow) {
      // A running tally, so one mislabelled frame does not flip the hand.
      this.votes[modelNow] += score ?? 0.5;
      this.votes.left *= 0.98;
      this.votes.right *= 0.98;
    }
    const modelSide: Hand | null = this.votes.left === this.votes.right ? modelNow : this.votes.left > this.votes.right ? 'left' : 'right';

    if (certain) {
      this.shapeRun = this.shapeRun?.side === certain ? { side: certain, frames: this.shapeRun.frames + 1 } : { side: certain, frames: 1 };
      if (this.shapeRun.frames === SHAPE_FRAMES && this.latched !== certain) {
        if (this.latched === null && modelSide) {
          if (modelSide === certain) this.agreements += 1;
          else this.disagreements += 1;
          // Never right, repeatedly wrong: the label means the opposite of what was assumed.
          if (this.disagreements >= 2 && this.agreements === 0) {
            this.convention = this.convention === 'subject' ? 'mirrored' : 'subject';
            this.votes = { left: this.votes.right, right: this.votes.left };
            this.agreements = 0;
            this.disagreements = 0;
          }
        }
        this.latched = certain;
      }
    } else {
      this.shapeRun = null;
    }

    if (this.latched) return { side: this.latched, source: 'shape', modelSide, shapeSide, confirmed: true };
    if (modelSide) return { side: modelSide, source: 'model', modelSide, shapeSide, confirmed: false };
    if (expected) return { side: expected, source: 'expected', modelSide, shapeSide, confirmed: false };
    return { side: 'right', source: 'default', modelSide, shapeSide, confirmed: false };
  }
}

// ---------- The pipeline ----------

const EMPTY_QUALITY: FrameQuality = {
  ok: false,
  reasons: ['no-hand'],
  advisories: [],
  framing: 'ok',
  size: 0,
  jitter: 0,
  palmSpeed: 0,
  stableMs: 0,
  modelScore: null,
};

export class HandTracker {
  readonly config: TrackerConfig;
  private readonly stabiliser: LandmarkStabiliser;
  private readonly sides = new SideResolver();

  constructor(config: Partial<TrackerConfig> = {}) {
    this.config = { ...DEFAULT_TRACKER, ...config };
    this.stabiliser = new LandmarkStabiliser(this.config.stabiliser);
  }

  get labelConvention(): LabelConvention {
    return this.sides.labelConvention;
  }

  reset(): void {
    this.stabiliser.reset();
    this.sides.trackLost();
    this.following = null;
  }

  private following: Vec3[] | null = null;

  update(observations: readonly HandObservation[], now: number, context: TrackerContext): TrackedFrame {
    const expected = context.expectedHand ?? null;
    const chosen = chooseObservation(observations, this.following, expected, this.sides.mapLabel);
    const hand = this.stabiliser.update(chosen, now, context.aspect);
    const advisories = this.advisories(observations.length, context);

    if (hand.status === 'lost' || !hand.image) {
      this.sides.trackLost();
      this.following = null;
      return {
        t: now,
        status: 'lost',
        handsSeen: observations.length,
        raw: hand.raw,
        image: null,
        world: null,
        side: null,
        sideSource: null,
        modelSide: null,
        shapeSide: null,
        sideConfirmed: false,
        frame: null,
        view: null,
        angles: null,
        joints: null,
        measures: null,
        hidden: null,
        quality: { ...EMPTY_QUALITY, advisories },
        rejected: hand.rejected,
      };
    }
    this.following = hand.image;

    // Angles come from the 3-D landmarks. Without them, the picture landmarks with their relative depth stand in.
    const points = hand.world ?? hand.image.map((point) => ({ x: point.x * context.aspect, y: point.y, z: point.z * context.aspect }));
    const label = hand.status === 'tracking' ? (hand.raw?.label ?? null) : null;
    const resolved = this.sides.resolve(points, label, hand.raw?.score ?? null, expected);
    const frame = palmFrame(points, resolved.side);
    const hidden = occludedLandmarks(hand.image, context.aspect);
    const joints = jointEstimates(points, frame, hidden);
    const angles = jointAngles(points, frame);

    const composite = {} as Record<Finger, number>;
    const reach = {} as Record<Finger, number>;
    for (const finger of FINGERS) {
      composite[finger] = compositeFlexion(angles, finger);
      reach[finger] = tipReach(points, finger);
    }
    const opposition = {} as Record<LongFinger, number>;
    for (const finger of LONG_FINGERS) opposition[finger] = oppositionDistance(points, frame, finger);

    const { framing, size } = framingOf(hand.image);
    const reasons: QualityReason[] = [];
    const limits = this.config.quality;
    if (hand.status === 'holding') reasons.push('tracking-held');
    if (framing === 'clipped') reasons.push('clipped');
    else if (framing === 'too-far') reasons.push('too-far');
    else if (framing === 'too-close') reasons.push('too-close');
    if ((context.deviceRotation ?? 0) > limits.maxDeviceRotation) reasons.push('device-moving');
    if (hand.palmSpeed > limits.maxPalmSpeed) reasons.push('moving-fast');
    if (hand.jitter > limits.maxJitter) reasons.push('unstable');
    if (hand.status === 'tracking' && hand.trackedMs < limits.settleMs) reasons.push('settling');

    return {
      t: now,
      status: hand.status,
      handsSeen: observations.length,
      raw: hand.raw,
      image: hand.image,
      world: hand.world,
      side: resolved.side,
      sideSource: resolved.source,
      modelSide: resolved.modelSide,
      shapeSide: resolved.shapeSide,
      sideConfirmed: resolved.confirmed,
      frame,
      view: handView(frame),
      angles,
      joints,
      measures: { composite, reach, opposition },
      hidden,
      quality: {
        ok: reasons.length === 0,
        reasons,
        advisories,
        framing,
        size,
        jitter: hand.jitter,
        palmSpeed: hand.palmSpeed,
        stableMs: hand.trackedMs,
        modelScore: hand.raw?.score ?? null,
      },
      rejected: hand.rejected,
    };
  }

  private advisories(handsSeen: number, context: TrackerContext): QualityAdvisory[] {
    const advisories: QualityAdvisory[] = [];
    if (context.luma !== null && context.luma !== undefined && context.luma < this.config.quality.minLuma) advisories.push('low-light');
    if (context.fps !== null && context.fps !== undefined && context.fps > 0 && context.fps < this.config.quality.minFps) advisories.push('low-frame-rate');
    if (handsSeen > 1) advisories.push('second-hand');
    return advisories;
  }
}
