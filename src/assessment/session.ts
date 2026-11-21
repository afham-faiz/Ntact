/**
 * From a finished engine run to a stored session, and the questions asked of
 * stored sessions afterwards: what was typical, how repeatable it was, and whether
 * two sessions can fairly be put side by side.
 *
 * Pure functions. No clock, no storage, no screen.
 */
import type { Finger, Hand } from '../domain/types';
import { DIGIT_JOINTS, GRADE_RANK, type Grade, type HandView, type JointId } from '../tracking/geometry';
import { frameObservations, ReplayCursor, type LandmarkRecording } from '../tracking/recording';
import { ENGINE_VERSION, HandTracker, type TrackedFrame, type TrackerConfig } from '../tracking/tracker';
import { median } from '../tracking/vec';
import type { ResolvedAssessment } from './definitions';
import { AssessmentEngine, deviation, type EngineEvent, type EngineState, type EngineTiming } from './engine';
import type {
  AssessmentSession,
  AssessmentSource,
  CaptureInfo,
  JointSummary,
  RepRecord,
  SessionQuality,
  SessionSummary,
  TrackingInfo,
} from './types';

const round = (value: number | null, places = 1): number | null => {
  if (value === null) return null;
  const k = 10 ** places;
  return Math.round(value * k) / k;
};

const GRADES: Grade[] = ['unavailable', 'inferred', 'direct'];

/** The session's figures: medians across VALID repetitions only. Rejected repetitions are counted, never averaged in. */
export function summariseSession(reps: readonly RepRecord[], setup: ResolvedAssessment, view: HandView | null): SessionSummary {
  const valid = reps.filter((rep) => rep.valid);
  const target = Math.round(setup.params.reps ?? 3);
  const opposition = setup.definition.primary === 'opposition';
  const primaries = valid.map((rep) => rep.primary).filter((value): value is number => value !== null);
  const holds = valid.map((rep) => rep.holdMs);

  const joints: SessionSummary['joints'] = {};
  const digits = new Set<Finger>(valid.flatMap((rep) => Object.keys(rep.joints) as Finger[]));
  for (const digit of digits) {
    const entry: Partial<Record<JointId, JointSummary>> = {};
    for (const joint of DIGIT_JOINTS[digit]) {
      const seen = valid.map((rep) => rep.joints[digit]?.[joint]).filter((item): item is NonNullable<typeof item> => item !== undefined);
      if (seen.length === 0) continue;
      const flex = median(seen.map((item) => item.held));
      const starts = seen.map((item) => item.start).filter((value): value is number => value !== null);
      const ext = median(starts);
      entry[joint] = {
        flex: round(flex),
        ext: round(ext),
        arc: flex !== null && ext !== null ? round(flex - ext) : null,
        n: seen.length,
        grade: GRADES[Math.min(...seen.map((item) => GRADE_RANK[item.grade]))],
        sd: round(deviation(seen.map((item) => item.held))),
      };
    }
    if (Object.keys(entry).length > 0) joints[digit] = entry;
  }

  return {
    validReps: valid.length,
    rejectedReps: reps.length - valid.length,
    targetReps: target,
    completed: valid.length >= target,
    primary: {
      metric: setup.definition.primary,
      median: round(median(primaries), opposition ? 3 : 1),
      sd: round(deviation(primaries), opposition ? 3 : 1),
      min: primaries.length > 0 ? round(Math.min(...primaries), opposition ? 3 : 1) : null,
      max: primaries.length > 0 ? round(Math.max(...primaries), opposition ? 3 : 1) : null,
    },
    holdMs: {
      median: holds.length > 0 ? Math.round(median(holds) as number) : null,
      min: holds.length > 0 ? Math.min(...holds) : null,
      max: holds.length > 0 ? Math.max(...holds) : null,
    },
    joints,
    view,
  };
}

export interface SessionInputs {
  id: string;
  patientId: string;
  timestamp: string;
  hand: Hand;
  detectedHand: Hand | null;
  setup: ResolvedAssessment;
  reps: RepRecord[];
  durationMs: number;
  quality: SessionQuality;
  view: HandView | null;
  capture: CaptureInfo;
  tracking: TrackingInfo;
  source: AssessmentSource;
}

export function buildSession(inputs: SessionInputs): AssessmentSession {
  const { setup } = inputs;
  return {
    id: inputs.id,
    patientId: inputs.patientId,
    timestamp: inputs.timestamp,
    durationMs: Math.round(inputs.durationMs),
    assessmentId: setup.definition.id,
    definitionVersion: setup.definition.version,
    hand: inputs.hand,
    detectedHand: inputs.detectedHand,
    digits: [...setup.digits],
    focus: setup.focus,
    params: { ...setup.params },
    minGrade: setup.minGrade,
    capture: inputs.capture,
    tracking: inputs.tracking,
    reps: inputs.reps,
    summary: summariseSession(inputs.reps, setup, inputs.view),
    quality: {
      ...inputs.quality,
      tracked: round(inputs.quality.tracked, 3) as number,
      usable: round(inputs.quality.usable, 3) as number,
    },
    source: inputs.source,
    // Only a live camera session is an observation of a person.
    synthetic: inputs.source !== 'camera',
    references: [],
  };
}

export const TRACKING_DEFAULTS: Omit<TrackingInfo, 'delegate' | 'labelConvention'> = {
  model: 'MediaPipe Hand Landmarker (float16, v1)',
  runtime: '@mediapipe/tasks-vision',
  filter: 'One Euro (min cut-off 1.6 Hz, beta 2.4 per palm length/s)',
  engine: ENGINE_VERSION,
};

// ---------- Comparing sessions ----------

export interface Comparability {
  comparable: boolean;
  /** Why not, in words a clinician can read. Empty when comparable. */
  differences: string[];
}

/**
 * Whether two sessions' figures can be put on one line.
 * Strict on purpose: a figure that moved because the camera moved is not a change in the hand.
 */
export function comparability(a: AssessmentSession, b: AssessmentSession): Comparability {
  const differences: string[] = [];
  if (a.assessmentId !== b.assessmentId) differences.push('different assessment');
  if (a.definitionVersion !== b.definitionVersion) differences.push('different version of the assessment');
  if (a.hand !== b.hand) differences.push('different hand');
  if (a.focus !== b.focus) differences.push('different finger');
  if (a.summary.view !== b.summary.view) differences.push('different camera view');
  if (a.tracking.engine.split('.')[0] !== b.tracking.engine.split('.')[0]) differences.push('different tracking engine');
  // A camera session, a synthetic replay and illustrative example data are three different things.
  if (a.source !== b.source) differences.push('different kind of data');
  return { comparable: differences.length === 0, differences };
}

/** The most recent earlier session of the same assessment and the same kind of data, for "last time" comparisons. */
export function previousOf(sessions: readonly AssessmentSession[], session: AssessmentSession): AssessmentSession | null {
  const earlier = sessions
    .filter(
      (item) =>
        item.id !== session.id &&
        item.patientId === session.patientId &&
        item.assessmentId === session.assessmentId &&
        item.source === session.source &&
        item.timestamp <= session.timestamp,
    )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return earlier.length > 0 ? earlier[earlier.length - 1] : null;
}

/** Sessions of one assessment for one patient, oldest first. */
export function sessionsOf(sessions: readonly AssessmentSession[], patientId: string, assessmentId?: string): AssessmentSession[] {
  return sessions
    .filter((session) => session.patientId === patientId && (assessmentId === undefined || session.assessmentId === assessmentId))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Whether a session's figures deserve a caution mark when they are shown. */
export function qualityConcerns(session: AssessmentSession): string[] {
  const concerns: string[] = [];
  if (session.summary.validReps === 0) concerns.push('No valid repetition was recorded');
  if (session.summary.rejectedReps > session.summary.validReps) concerns.push('More repetitions were rejected than recorded');
  if (session.quality.usable < 0.6) concerns.push(`Tracking was usable for ${Math.round(session.quality.usable * 100)}% of the session`);
  if (session.summary.validReps === 1) concerns.push('Based on a single repetition');
  if (session.capture.fps !== null && session.capture.fps < 15) concerns.push(`Low frame rate (${Math.round(session.capture.fps)} per second)`);
  return concerns;
}

// ---------- Repeatability ----------

export interface Spread {
  n: number;
  mean: number | null;
  sd: number | null;
  /** Standard deviation as a share of the mean. Null when the mean is near zero. */
  cv: number | null;
  min: number | null;
  max: number | null;
}

export function spreadOf(values: readonly number[]): Spread {
  if (values.length === 0) return { n: 0, mean: null, sd: null, cv: null, min: null, max: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = deviation(values);
  return {
    n: values.length,
    mean,
    sd,
    cv: sd !== null && Math.abs(mean) > 1e-6 ? sd / Math.abs(mean) : null,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/** Within-session repeatability: the spread of the primary quantity across one session's valid repetitions. */
export function withinSession(session: AssessmentSession): Spread {
  return spreadOf(session.reps.filter((rep) => rep.valid && rep.primary !== null).map((rep) => rep.primary as number));
}

/**
 * Between-session repeatability: the spread of session medians across sessions
 * that are comparable with the most recent one. Meaningful as "repeatability"
 * only when the hand itself is not expected to have changed, for example
 * repeated sessions on the same day.
 */
export function betweenSessions(sessions: readonly AssessmentSession[]): Spread {
  if (sessions.length === 0) return spreadOf([]);
  const latest = sessions[sessions.length - 1];
  return spreadOf(
    sessions
      .filter((session) => comparability(session, latest).comparable && session.summary.primary.median !== null)
      .map((session) => session.summary.primary.median as number),
  );
}

export interface Agreement {
  n: number;
  /** Mean of (camera estimate minus reference). */
  bias: number | null;
  /** Bias plus and minus 1.96 standard deviations of the differences (Bland and Altman limits of agreement). */
  lower: number | null;
  upper: number | null;
  /** Mean absolute difference. */
  mae: number | null;
}

/** Agreement between camera estimates and reference readings, for however many pairs there are. Nothing is reported from fewer than two. */
export function agreement(pairs: readonly { estimate: number; reference: number }[]): Agreement {
  if (pairs.length === 0) return { n: 0, bias: null, lower: null, upper: null, mae: null };
  const differences = pairs.map((pair) => pair.estimate - pair.reference);
  const bias = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const sd = deviation(differences);
  return {
    n: pairs.length,
    bias,
    lower: sd === null ? null : bias - 1.96 * sd,
    upper: sd === null ? null : bias + 1.96 * sd,
    mae: differences.reduce((sum, value) => sum + Math.abs(value), 0) / differences.length,
  };
}

/** Every (camera estimate, reference reading) pair in a set of sessions. */
export function referencePairs(sessions: readonly AssessmentSession[]): { session: AssessmentSession; finger: Finger; joint: JointId; kind: 'flex' | 'ext'; estimate: number; reference: number }[] {
  const pairs: ReturnType<typeof referencePairs> = [];
  for (const session of sessions) {
    for (const reading of session.references ?? []) {
      const summary = session.summary.joints[reading.finger]?.[reading.joint];
      const estimate = reading.kind === 'flex' ? summary?.flex : summary?.ext;
      if (estimate === null || estimate === undefined) continue;
      pairs.push({ session, finger: reading.finger, joint: reading.joint, kind: reading.kind, estimate, reference: reading.deg });
    }
  }
  return pairs;
}

// ---------- Replay ----------

export interface ReplayResult {
  reps: RepRecord[];
  events: EngineEvent[];
  states: EngineState[];
  frames: TrackedFrame[];
  engine: AssessmentEngine;
  tracker: HandTracker;
}

/**
 * Runs a recording through the tracker and the engine exactly as a camera session
 * runs, frame by frame, with the recording's own timestamps. The same recording
 * always gives the same result.
 */
export function replay(
  recording: LandmarkRecording,
  setup: ResolvedAssessment,
  options: { hand?: Hand | null; timing?: Partial<EngineTiming>; tracker?: Partial<TrackerConfig>; keepFrames?: boolean } = {},
): ReplayResult {
  const tracker = new HandTracker(options.tracker);
  const engine = new AssessmentEngine(setup, options.timing);
  const cursor = new ReplayCursor(recording);
  const events: EngineEvent[] = [];
  const states: EngineState[] = [];
  const frames: TrackedFrame[] = [];
  for (const recorded of recording.frames) {
    const current = cursor.advance(recorded.t);
    if (!current) continue;
    const frame = tracker.update(frameObservations(current), current.t, { aspect: recording.aspect, expectedHand: options.hand ?? null });
    const state = engine.update(frame);
    events.push(...state.events);
    states.push(state);
    if (options.keepFrames) frames.push(frame);
  }
  return { reps: engine.finish(), events, states, frames, engine, tracker };
}
