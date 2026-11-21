/**
 * Domain model for camera-based movement assessments.
 *
 * Vocabulary, used consistently in code, storage and on screen:
 *
 *   estimate     a joint angle computed from tracked landmarks. Never called a measurement
 *                of the joint itself: its agreement with goniometry has not been established.
 *   grade        how the joint was seen when the estimate was taken (see tracking/geometry.ts).
 *   repetition   start position -> target position, held -> back to the start position.
 *   valid        every quality requirement was met for the whole repetition.
 *   rejected     the target was reached but a requirement was not met; kept and counted separately.
 *
 * Nothing in here is a score of recovery. Completion (were the repetitions done)
 * and the estimates themselves are kept apart, and neither is compared with a
 * population norm: there are none in this codebase.
 */
import type { Finger, Hand } from '../domain/types';
import type { Grade, HandView, JointId } from '../tracking/geometry';
import type { Posture } from '../tracking/handModel';
import type { LabelConvention, QualityReason } from '../tracking/tracker';

export type AssessmentId = 'composite-fist' | 'hook-fist' | 'tabletop' | 'thumb-opposition' | 'digit-flexion';

/**
 * A quantity a posture is defined by, taken as the mean over the assessed digits
 * that can be seen well enough.
 *   mcp, pip, dip   one joint's flexion, degrees
 *   ip-sum          PIP + DIP, degrees
 *   composite       MCP + PIP + DIP, degrees
 *   opposition      thumb tip to the chosen fingertip, in palm lengths (smaller is closer)
 */
export type MetricId = 'mcp' | 'pip' | 'dip' | 'ip-sum' | 'composite' | 'opposition';

/**
 * One condition of a position.
 *
 * Start criteria are compared with the estimate itself. Target criteria on joint
 * angles are compared with the CHANGE from the start position, digit by digit:
 * a real hand's landmarks put a flat finger anywhere from about -30 to +30 degrees
 * at a joint depending on the view, and judging the movement from where that
 * hand started takes that offset out. Distances (thumb opposition) are compared
 * as they are.
 */
export interface Criterion {
  metric: MetricId;
  cmp: 'at-least' | 'at-most';
  /** Key of the parameter that holds the threshold. */
  param: string;
  /** Said only when this is the single thing keeping the position from being recognised. */
  hint?: string;
}

export interface ParamSpec {
  key: string;
  label: string;
  help: string;
  unit: 'deg' | 's' | 'reps' | 'palm';
  default: number;
  min: number;
  max: number;
  step: number;
}

/** How the camera is being used. Sets which camera is asked for first and how the setup is explained. */
export type CameraSetup = 'laptop' | 'phone-propped' | 'phone-held' | 'phone-assisted';

export interface AssessmentDefinition {
  id: AssessmentId;
  /** Bumped whenever the criteria or the way a value is taken changes, so old and new sessions are not silently compared. */
  version: number;
  title: string;
  /** The anatomical description a clinician would recognise. */
  clinical: string;
  /** core: one of the three the prototype is built around. exploratory: implemented, less settled. */
  maturity: 'core' | 'exploratory';
  /** One sentence for the patient. */
  summary: string;
  /** What is recorded, in plain words. */
  records: string;
  /** fingers: the four fingers together. one-finger: a single chosen finger. */
  digits: 'fingers' | 'one-finger';
  /** Joints shown in the live read-out, in order. */
  joints: JointId[];
  /**
   * facing:     the view to ask for when the hand is held up in front of a camera (a laptop, a propped phone).
   * overhead:   the view to ask for when the hand rests on a table and a phone looks down at it.
   * acceptable: every view a session may be recorded from. Outside these, nothing is recorded.
   * The recommended views are ones a person can hold comfortably, which matters as much as what they show.
   */
  views: { facing: HandView; overhead: HandView; acceptable: HandView[] };
  /** Why this view: one sentence for the setup screen. */
  viewReason: string;
  /**
   * handheld-ok: can be attempted with the phone in the other hand.
   * steady-preferred: a propped or held-by-someone-else camera is recommended, and the setup screen says so.
   * A reasoned starting position, to be replaced by testing with real devices.
   */
  steadiness: 'handheld-ok' | 'steady-preferred';
  params: ParamSpec[];
  start: Criterion[];
  target: Criterion[];
  /** The quantity that drives the progress arc and is reported first. */
  primary: MetricId;
  cues: { start: string; move: string; hold: string; release: string };
  steps: string[];
  /** Postures for the instructional figure. Drawn from the kinematic model, never from a person. */
  figure: { start: Posture | 'opposition-open'; target: Posture | 'opposition-touch' };
}

/** What a clinician has set for one patient. Absent keys fall back to the definition's defaults. */
export interface ProtocolOverride {
  params?: Record<string, number>;
  minGrade?: Exclude<Grade, 'unavailable'>;
  /** For `one-finger` assessments: which finger. */
  finger?: Finger;
}

export interface AssessmentProtocol {
  enabled: AssessmentId[];
  overrides: Partial<Record<AssessmentId, ProtocolOverride>>;
}

// ---------- What a repetition leaves behind ----------

/**
 * hold-too-short       the target position was reached and let go before the hold was complete
 * tracking-lost        tracking stopped being usable during the hold
 * unsteady             the hold wandered by more than the configured amount
 * target-not-reached   the hand moved clearly towards the target and came back without reaching it.
 *                      Kept because it is worth a clinician knowing: the estimates are the furthest point reached.
 */
export type RejectReason = 'hold-too-short' | 'tracking-lost' | 'unsteady' | 'target-not-reached';

export interface RepJoint {
  /** Median estimate while the target position was held, degrees. */
  held: number;
  /** Largest estimate at any usable moment of the repetition, degrees. */
  peak: number;
  /** Estimate in the starting position, degrees. */
  start: number | null;
  /** The weakest grade the joint was seen at while it was held. */
  grade: Grade;
}

export interface RepRecord {
  /** Order in which the target position was reached, counting rejected attempts. */
  attempt: number;
  valid: boolean;
  rejectReason: RejectReason | null;
  /** Milliseconds from the start of the session. */
  startedAt: number;
  endedAt: number;
  /** How long the target position was held with usable tracking. */
  holdMs: number;
  /** From leaving the start position to reaching the target. */
  timeToTargetMs: number | null;
  /** Median of the primary quantity while held. */
  primary: number | null;
  /** How much the primary quantity wandered while held (a robust standard deviation: 1.4826 x the median absolute deviation). */
  holdSd: number | null;
  joints: Partial<Record<Finger, Partial<Record<JointId, RepJoint>>>>;
  /** The digits that could be seen well enough to contribute. */
  digits: Finger[];
  /** Whether the hand came back to the start position afterwards. */
  returned: boolean;
  view: HandView | null;
  /** Share of this repetition's frames that were usable, 0 to 1. */
  usable: number;
}

export interface JointSummary {
  /** Median held estimate across valid repetitions, degrees. */
  flex: number | null;
  /** Median start-position estimate, degrees. */
  ext: number | null;
  /** flex minus ext. */
  arc: number | null;
  /** Number of valid repetitions that contributed. */
  n: number;
  /** Weakest grade among them. */
  grade: Grade;
  /** Spread across repetitions (standard deviation), degrees. Null with fewer than two. */
  sd: number | null;
}

export interface SessionSummary {
  validReps: number;
  rejectedReps: number;
  targetReps: number;
  /** The target number of valid repetitions was reached. Says nothing about how the hand is doing. */
  completed: boolean;
  primary: { metric: MetricId; median: number | null; sd: number | null; min: number | null; max: number | null };
  holdMs: { median: number | null; min: number | null; max: number | null };
  joints: Partial<Record<Finger, Partial<Record<JointId, JointSummary>>>>;
  view: HandView | null;
}

export interface SessionQuality {
  frames: number;
  /** Share of frames with a hand being tracked. */
  tracked: number;
  /** Share of frames usable for this assessment. */
  usable: number;
  /** Frames the stabiliser discarded as implausible jumps. */
  jumps: number;
  /** How many frames each problem was present for. */
  reasons: Partial<Record<QualityReason | 'view' | 'hidden', number>>;
}

/** Enough about how a session was captured to judge whether two sessions can be compared. */
export interface CaptureInfo {
  setup: CameraSetup;
  facing: 'user' | 'environment' | 'unknown';
  width: number;
  height: number;
  /** Measured processed frames per second, when available. */
  fps: number | null;
  /** Mean model time per frame, milliseconds, when available. */
  inferenceMs: number | null;
}

export interface TrackingInfo {
  model: string;
  runtime: string;
  delegate: 'GPU' | 'CPU' | 'none';
  filter: string;
  engine: string;
  labelConvention: LabelConvention;
}

/** A reading taken with a reference instrument, entered by a clinician for comparison. */
export interface ReferenceReading {
  id: string;
  finger: Finger;
  joint: JointId;
  kind: 'flex' | 'ext';
  deg: number;
  instrument: string;
  enteredAt: string;
}

/**
 * camera:           a person's hand, tracked live on this device.
 * synthetic-replay: the kinematic hand model replayed through the same pipeline. Not a person.
 * seed:             illustrative history written by the demonstration data. Not a person.
 */
export type AssessmentSource = 'camera' | 'synthetic-replay' | 'seed';

export interface AssessmentSession {
  id: string;
  patientId: string;
  /** ISO timestamp of the end of the session. */
  timestamp: string;
  durationMs: number;
  assessmentId: AssessmentId;
  definitionVersion: number;
  /** The hand the session was set up for. */
  hand: Hand;
  /** The hand the tracker settled on, once its shape confirmed it. */
  detectedHand: Hand | null;
  digits: Finger[];
  /** The digit the read-out is centred on (the injured finger where it is one of those assessed). */
  focus: Finger;
  params: Record<string, number>;
  minGrade: Exclude<Grade, 'unavailable'>;
  capture: CaptureInfo;
  tracking: TrackingInfo;
  reps: RepRecord[];
  summary: SessionSummary;
  quality: SessionQuality;
  source: AssessmentSource;
  /** false only for `source: 'camera'`. */
  synthetic: boolean;
  references: ReferenceReading[];
}
