/**
 * Guided hand exercises: the maths and the rep counter, with no camera in sight.
 *
 * Input is 21 hand landmarks per frame (the MediaPipe hand layout). Output is how
 * far each finger is curled, how many repetitions have been completed, and one
 * short coaching cue.
 *
 * Honesty about accuracy, repeated wherever a number reaches a screen: a phone or
 * laptop camera estimates joint angles from a single view. Expect errors of the
 * order of 10 to 20 degrees, more when the hand is turned or partly hidden. The
 * figures are useful for guidance and for a trend over weeks. They are not
 * goniometry and are never presented as a clinical measurement.
 */
import type { ExerciseId, ExerciseSession, Finger } from './types';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** One camera frame's view of the hand. `image` is normalised 0..1; `world` is metres, when available. */
export interface HandFrame {
  image: Point3[];
  world: Point3[] | null;
}

export const FINGERS: readonly Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];

/** Landmark indices along each finger, base to tip. Index 0 is the wrist. */
export const FINGER_CHAIN: Record<Finger, readonly [number, number, number, number]> = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  little: [17, 18, 19, 20],
};

/** Bones to draw, as landmark index pairs. */
export const HAND_BONES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// ---------- The exercise catalogue ----------

export interface ExerciseDefinition {
  id: ExerciseId;
  title: string;
  summary: string;
  targetReps: number;
  /** Rehabilitation phase it belongs to. A clinician unlocks exercises phase by phase. */
  phase: 1 | 2 | 3;
  steps: string[];
}

export const EXERCISES: Record<ExerciseId, ExerciseDefinition> = {
  'open-close': {
    id: 'open-close',
    title: 'Open and close',
    summary: 'Make a gentle fist, then stretch your fingers out wide.',
    targetReps: 10,
    phase: 1,
    steps: [
      'Hold your hand up with your palm facing the camera.',
      'Curl your fingers into a gentle fist. Only go as far as is comfortable.',
      'Open your hand and stretch your fingers out. That is one repetition.',
    ],
  },
};

/** Later phases, named so the plan is visible. The exercises themselves are still to be defined by the team. */
export const UPCOMING_PHASES: { phase: 2 | 3; title: string; note: string }[] = [
  { phase: 2, title: 'Phase 2 exercises', note: 'To be added by your care team.' },
  { phase: 3, title: 'Phase 3 exercises', note: 'To be added by your care team.' },
];

// ---------- Geometry ----------

const sub = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = (v: Point3): number => Math.hypot(v.x, v.y, v.z);

/** Angle in degrees between two directions. 0 means the joint is straight. */
export function bendDegrees(from: Point3, joint: Point3, to: Point3): number {
  const a = sub(joint, from);
  const b = sub(to, joint);
  const la = length(a);
  const lb = length(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/**
 * Total bend along a finger, in degrees: the three finger joints added together
 * (two for the thumb). A straight finger reads roughly 15 to 30 because the line
 * from the wrist to the knuckle is not quite the line of the finger; a full fist
 * reads roughly 200 to 260. Approximate by nature.
 */
export function fingerFlexion(points: Point3[], finger: Finger): number {
  const [a, b, c, d] = FINGER_CHAIN[finger];
  if (finger === 'thumb') {
    return bendDegrees(points[a], points[b], points[c]) + bendDegrees(points[b], points[c], points[d]);
  }
  return (
    bendDegrees(points[0], points[a], points[b]) +
    bendDegrees(points[a], points[b], points[c]) +
    bendDegrees(points[b], points[c], points[d])
  );
}

/** Flexion that counts as "straight" and as "fully curled" when turning degrees into a 0..1 curl. */
const CURL_RANGE: Record<'thumb' | 'finger', { straight: number; full: number }> = {
  thumb: { straight: 15, full: 95 },
  finger: { straight: 25, full: 215 },
};

export function curlOf(flexionDeg: number, finger: Finger): number {
  const range = CURL_RANGE[finger === 'thumb' ? 'thumb' : 'finger'];
  return Math.min(1, Math.max(0, (flexionDeg - range.straight) / (range.full - range.straight)));
}

export type FingerValues = Record<Finger, number>;

const zeroFingers = (): FingerValues => ({ thumb: 0, index: 0, middle: 0, ring: 0, little: 0 });

export interface HandPose {
  /** Total bend per finger, degrees. */
  flexion: FingerValues;
  /** 0 = straight, 1 = fully curled. */
  curl: FingerValues;
  /** How closed the hand is overall, 0..1. The four fingers; the thumb is not counted. */
  closure: number;
}

/** Prefers the metric 3-D landmarks: they do not distort when the hand moves across the frame. */
export function poseOf(frame: HandFrame): HandPose {
  const points = frame.world && frame.world.length === 21 ? frame.world : frame.image;
  const flexion = zeroFingers();
  const curl = zeroFingers();
  for (const finger of FINGERS) {
    flexion[finger] = fingerFlexion(points, finger);
    curl[finger] = curlOf(flexion[finger], finger);
  }
  const closure = (curl.index + curl.middle + curl.ring + curl.little) / 4;
  return { flexion, curl, closure };
}

export type Framing = 'ok' | 'too-far' | 'too-close' | 'clipped';

/** Whether the whole hand is comfortably inside the picture. Uses the normalised image landmarks. */
export function framingOf(image: Point3[]): Framing {
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const point of image) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (minX < 0.015 || maxX > 0.985 || minY < 0.015 || maxY > 0.985) return 'clipped';
  const size = Math.max(maxX - minX, maxY - minY);
  if (size < 0.2) return 'too-far';
  if (size > 0.82) return 'too-close';
  return 'ok';
}

// ---------- Counting repetitions ----------

/**
 * How far the hand must close, and then re-open, for a repetition to count.
 * Deliberately relative: someone who cannot yet make a full fist still gets their
 * repetitions counted, and the coaching asks for a little more rather than refusing.
 */
export const REP_SWING = 0.3;
/** The hand must reach at least this closure to be "closed", however small the swing. */
export const MIN_CLOSED = 0.42;
/** ...and come back below this to be "open" again. */
export const MAX_OPEN = 0.45;
/** Smoothing applied to every finger, per frame. Higher follows the hand faster. */
const SMOOTHING = 0.45;
/** The hand has to be seen steadily for this long before counting starts. */
export const READY_MS = 700;
/** How far the injured finger may trail the others before the coach mentions it. */
const LAG_NOTICE = 0.22;

export type CuePhase = 'find-hand' | 'framing' | 'get-ready' | 'close' | 'closing' | 'open' | 'opening' | 'done';

export interface Cue {
  phase: CuePhase;
  /** The one line shown to the person. Encouraging, never a verdict. */
  text: string;
}

export interface RepRecord {
  /** Peak bend of the injured finger in this repetition, degrees. */
  flexDeg: number;
  /** Bend left in the injured finger when the hand was opened again, degrees. */
  extDeg: number;
}

export interface ExerciseState {
  /** False until a hand has been seen steadily. */
  ready: boolean;
  handVisible: boolean;
  framing: Framing;
  pose: HandPose | null;
  /** 'open' waits for a fist; 'closed' waits for the hand to open again. */
  stage: 'open' | 'closed';
  reps: number;
  targetReps: number;
  done: boolean;
  cue: Cue;
  /** Timestamp of the most recent completed repetition, for a moment of celebration. */
  lastRepAt: number | null;
  history: RepRecord[];
}

const FINGER_WORD: Record<Finger, string> = {
  thumb: 'thumb',
  index: 'index finger',
  middle: 'middle finger',
  ring: 'ring finger',
  little: 'little finger',
};

/**
 * Follows one exercise session frame by frame. Pure and clock-free: the caller
 * passes the time, so the same frames always give the same result.
 */
export class OpenCloseTracker {
  private readonly injured: Finger;
  private readonly targetReps: number;
  private smooth: FingerValues | null = null;
  private smoothFlexion: FingerValues | null = null;
  private seenSince: number | null = null;
  private ready = false;
  private stage: 'open' | 'closed' = 'open';
  /** Lowest closure seen since the hand last opened. */
  private low = 1;
  /** Highest closure seen since the hand last closed. */
  private high = 0;
  private peakFlex = 0;
  private restFlex = Number.POSITIVE_INFINITY;
  private reps = 0;
  private lastRepAt: number | null = null;
  private readonly history: RepRecord[] = [];
  private startedAt: number | null = null;
  private lastAt = 0;

  constructor(injured: Finger, targetReps: number = EXERCISES['open-close'].targetReps) {
    this.injured = injured;
    this.targetReps = targetReps;
  }

  update(frame: HandFrame | null, now: number): ExerciseState {
    this.lastAt = now;
    if (!frame || frame.image.length !== 21) {
      this.seenSince = null;
      return this.snapshot(false, 'ok', null);
    }

    const framing = framingOf(frame.image);
    const raw = poseOf(frame);
    this.smooth = this.blend(this.smooth, raw.curl);
    this.smoothFlexion = this.blend(this.smoothFlexion, raw.flexion);
    const curl = this.smooth;
    const pose: HandPose = {
      flexion: this.smoothFlexion,
      curl,
      closure: (curl.index + curl.middle + curl.ring + curl.little) / 4,
    };

    if (framing !== 'ok') {
      this.seenSince = null;
      return this.snapshot(true, framing, pose);
    }

    if (this.seenSince === null) this.seenSince = now;
    if (!this.ready && now - this.seenSince >= READY_MS) {
      this.ready = true;
      this.startedAt = now;
      this.stage = pose.closure > MIN_CLOSED ? 'closed' : 'open';
      this.low = pose.closure;
      this.high = pose.closure;
    }
    if (this.ready && this.reps < this.targetReps) this.count(pose, now);
    return this.snapshot(true, framing, pose);
  }

  private blend(previous: FingerValues | null, next: FingerValues): FingerValues {
    if (!previous) return { ...next };
    const out = zeroFingers();
    for (const finger of FINGERS) out[finger] = previous[finger] + (next[finger] - previous[finger]) * SMOOTHING;
    return out;
  }

  private count(pose: HandPose, now: number): void {
    const closure = pose.closure;
    const injuredFlex = pose.flexion[this.injured];
    if (this.stage === 'open') {
      this.low = Math.min(this.low, closure);
      this.restFlex = Math.min(this.restFlex, injuredFlex);
      if (closure >= MIN_CLOSED && closure - this.low >= REP_SWING) {
        this.stage = 'closed';
        this.high = closure;
        this.peakFlex = injuredFlex;
      }
      return;
    }
    this.high = Math.max(this.high, closure);
    this.peakFlex = Math.max(this.peakFlex, injuredFlex);
    if (closure <= MAX_OPEN && this.high - closure >= REP_SWING) {
      this.stage = 'open';
      this.reps += 1;
      this.lastRepAt = now;
      this.history.push({
        flexDeg: this.peakFlex,
        extDeg: Number.isFinite(this.restFlex) ? Math.min(this.restFlex, injuredFlex) : injuredFlex,
      });
      this.low = closure;
      this.restFlex = injuredFlex;
      this.peakFlex = 0;
    }
  }

  private cue(handVisible: boolean, framing: Framing, pose: HandPose | null): Cue {
    if (this.reps >= this.targetReps) return { phase: 'done', text: 'All done. Well done.' };
    if (!handVisible || !pose) return { phase: 'find-hand', text: 'Hold your hand up to the camera' };
    if (framing === 'too-far') return { phase: 'framing', text: 'Bring your hand a little closer' };
    if (framing === 'too-close') return { phase: 'framing', text: 'Move your hand back a little' };
    if (framing === 'clipped') return { phase: 'framing', text: 'Keep your whole hand in view' };
    if (!this.ready) return { phase: 'get-ready', text: 'Hold it there' };

    const others =
      (['index', 'middle', 'ring', 'little'] as Finger[]).filter((finger) => finger !== this.injured);
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const othersCurl = mean(others.map((finger) => pose.curl[finger]));
    const injuredCurl = pose.curl[this.injured];
    const word = FINGER_WORD[this.injured];

    if (this.stage === 'open') {
      // Moving towards a fist.
      if (pose.closure - this.low > 0.1) {
        if (this.injured !== 'thumb' && othersCurl - injuredCurl > LAG_NOTICE) {
          return { phase: 'closing', text: `Bring your ${word} in with the others, as far as is comfortable` };
        }
        return { phase: 'closing', text: 'Keep curling, gently' };
      }
      return { phase: 'close', text: this.reps === 0 ? 'Make a gentle fist' : 'And again: a gentle fist' };
    }
    // In a fist, waiting for the hand to open.
    if (this.high - pose.closure > 0.1) {
      if (this.injured !== 'thumb' && injuredCurl - othersCurl > LAG_NOTICE) {
        return { phase: 'opening', text: `Straighten your ${word} as far as is comfortable` };
      }
      return { phase: 'opening', text: 'Stretch your fingers out' };
    }
    return { phase: 'open', text: 'Now open your hand wide' };
  }

  private snapshot(handVisible: boolean, framing: Framing, pose: HandPose | null): ExerciseState {
    return {
      ready: this.ready,
      handVisible,
      framing,
      pose,
      stage: this.stage,
      reps: this.reps,
      targetReps: this.targetReps,
      done: this.reps >= this.targetReps,
      cue: this.cue(handVisible, framing, pose),
      lastRepAt: this.lastRepAt,
      history: this.history,
    };
  }

  /** Time spent exercising so far, from the moment counting began. */
  elapsedMs(): number {
    return this.startedAt === null ? 0 : Math.max(0, this.lastAt - this.startedAt);
  }

  result(): SessionResult {
    return summariseReps(this.history, this.targetReps, this.elapsedMs());
  }
}

// ---------- Summaries ----------

export interface SessionResult {
  reps: number;
  targetReps: number;
  completed: boolean;
  durationMs: number;
  /** Typical peak bend of the injured finger, degrees. null when no repetition was completed. */
  flexDeg: number | null;
  /** Typical bend left when the hand was open, degrees. */
  extDeg: number | null;
  /** flexDeg minus extDeg: the arc the finger moved through. */
  rangeDeg: number | null;
}

function middle(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The median across repetitions, so one awkward repetition does not set the figure. */
export function summariseReps(history: RepRecord[], targetReps: number, durationMs: number): SessionResult {
  const flex = middle(history.map((rep) => rep.flexDeg));
  const ext = middle(history.map((rep) => rep.extDeg));
  const round = (value: number | null) => (value === null ? null : Math.round(value));
  return {
    reps: history.length,
    targetReps,
    completed: history.length >= targetReps,
    durationMs: Math.round(durationMs),
    flexDeg: round(flex),
    extDeg: round(ext),
    rangeDeg: flex !== null && ext !== null ? Math.max(0, Math.round(flex - ext)) : null,
  };
}

// ---------- Reading stored sessions ----------

export function sessionsForPatient(sessions: ExerciseSession[], patientId: string): ExerciseSession[] {
  return sessions.filter((session) => session.patientId === patientId).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** The most recent session with a movement figure, before `beforeIso` when given. */
export function previousMeasured(sessions: ExerciseSession[], beforeIso?: string): ExerciseSession | null {
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const session = sessions[index];
    if (session.rangeDeg === null) continue;
    if (beforeIso && session.timestamp >= beforeIso) continue;
    return session;
  }
  return null;
}

/** What a patient reads after a session. Always encouraging; a clinician delivers anything else. */
export function patientSummaryLine(result: SessionResult, previous: ExerciseSession | null): string {
  if (result.reps === 0) return 'No repetitions were counted this time. You can try again whenever you are ready.';
  if (!previous || previous.rangeDeg === null || result.rangeDeg === null) {
    return 'That is your starting point. Doing this most days is what counts.';
  }
  const change = result.rangeDeg - previous.rangeDeg;
  if (change >= 8) return 'Your finger moved a little further than last time.';
  if (change <= -8) return 'A bit less movement than last time. That is normal from day to day: keep to a comfortable range.';
  return 'About the same movement as last time. Steady practice is what counts.';
}
