/**
 * The assessment engine: an explicit state machine that turns tracked frames into
 * recorded repetitions.
 *
 *   searching -> positioning -> settling -> ready -> holding -> release -> ready ... -> complete
 *
 *   searching    no hand in the picture
 *   positioning  a hand, but something stops a measurement: framing, steadiness,
 *                the view, hidden joints, or not yet in the start position
 *   settling     in the start position; it must be kept for a moment
 *   ready        start position confirmed; waiting for the movement
 *   holding      target position reached; counting usable time towards the hold
 *   release      hold complete; waiting for the hand to come back to the start
 *   complete     the target number of valid repetitions has been recorded
 *
 * A repetition is recorded only for start -> target (held) -> start, with usable
 * tracking throughout. Reaching the target and then failing a requirement leaves a
 * REJECTED repetition, counted separately and never mixed into the results.
 *
 * Deterministic: it is given frames and their timestamps and nothing else. The
 * same frames always produce the same repetitions, which is what makes it testable
 * with replayed sequences. No model decides whether a movement was done; every
 * decision is a comparison of joint-angle estimates with configured thresholds.
 */
import type { Finger } from '../domain/types';
import {
  DIGIT_JOINTS,
  GRADE_RANK,
  type Grade,
  type HandView,
  type JointId,
  type LongFinger,
} from '../tracking/geometry';
import type { QualityReason, TrackedFrame } from '../tracking/tracker';
import { median } from '../tracking/vec';
import { viewAdvice, type ResolvedAssessment } from './definitions';
import type { Criterion, MetricId, RejectReason, RepJoint, RepRecord, SessionQuality } from './types';

export type EnginePhase = 'searching' | 'positioning' | 'settling' | 'ready' | 'holding' | 'release' | 'complete';

export interface EngineTiming {
  /** The start position must be kept this long before it is accepted. */
  settleMs: number;
  /** After a hold, the start position must be kept this long for the repetition to close. */
  returnMs: number;
  /** Unusable tracking shorter than this is ridden out; longer abandons what was in progress. */
  graceMs: number;
  /** A hold shorter than this that then breaks is ignored rather than recorded as a rejected attempt. */
  minAttemptMs: number;
}

export const DEFAULT_TIMING: EngineTiming = { settleMs: 600, returnMs: 250, graceMs: 500, minAttemptMs: 300 };

/** How far past a threshold a position must fall back before it is treated as left. Stops flicker at the boundary. */
const HYSTERESIS: Record<'deg' | 'palm', number> = { deg: 10, palm: 0.06 };

export type EngineEventType =
  | 'tracking-ready'
  | 'tracking-lost'
  | 'start-detected'
  | 'target-detected'
  | 'hold-complete'
  | 'rep-recorded'
  | 'attempt-rejected'
  | 'complete';

export interface EngineEvent {
  type: EngineEventType;
  /** Milliseconds from the start of the session. */
  at: number;
  rep?: RepRecord;
  reason?: RejectReason;
}

/** What is stopping a measurement right now. Quality reasons come from the tracker; the last three are the engine's own. */
export type Blocker = QualityReason | 'view' | 'hidden' | 'not-at-start';

export type FeedbackTone = 'guide' | 'active' | 'good' | 'caution';

export interface Feedback {
  tone: FeedbackTone;
  text: string;
}

export interface EngineState {
  phase: EnginePhase;
  paused: boolean;
  validReps: number;
  rejectedReps: number;
  targetReps: number;
  /** 0 to 1: usable time held so far, as a share of the hold required. */
  holdProgress: number;
  /** 0 to 1: how far the primary quantity has moved from the start position towards the target threshold. */
  progress: number;
  /** How many attempts have been rejected so far, by reason. */
  rejectedBy: Partial<Record<RejectReason, number>>;
  /** The primary quantity right now, or null when it cannot be evaluated. */
  primary: number | null;
  /** Digits contributing to the primary quantity in this frame. */
  digits: Finger[];
  blockers: Blocker[];
  feedback: Feedback;
  /** Events raised by this frame. */
  events: EngineEvent[];
  /** The most recent event, kept so the screen can acknowledge it for a moment. */
  lastEvent: EngineEvent | null;
  elapsedMs: number;
}

// ---------- Evaluating a quantity ----------

const usableGrade = (grade: Grade | undefined, minimum: Grade): boolean => grade !== undefined && GRADE_RANK[grade] >= GRADE_RANK[minimum] && grade !== 'unavailable';

const METRIC_JOINTS: Record<Exclude<MetricId, 'opposition'>, JointId[]> = {
  mcp: ['mcp'],
  pip: ['pip'],
  dip: ['dip'],
  'ip-sum': ['pip', 'dip'],
  composite: ['mcp', 'pip', 'dip'],
};

export interface MetricValue {
  /** Null when no assessed digit can be seen well enough. */
  value: number | null;
  digits: Finger[];
}

/**
 * One quantity for this frame: the mean over the assessed digits whose joints are
 * all seen at the required grade. A digit that cannot be seen is left out; it is
 * never filled in.
 */
export function evaluateMetric(
  frame: TrackedFrame,
  metric: MetricId,
  digits: readonly Finger[],
  focus: LongFinger,
  minGrade: Grade,
  /** When given, the result is the change from these start-position values, for the digits that have them. */
  baseline: Baseline | null = null,
): MetricValue {
  if (!frame.joints || !frame.measures) return { value: null, digits: [] };
  if (metric === 'opposition') {
    const hidden = frame.hidden;
    // Thumb tip is landmark 4; the fingertip is the last landmark of the finger's chain.
    const tip = { index: 8, middle: 12, ring: 16, little: 20 }[focus];
    if (hidden && (hidden[4] || hidden[tip])) return { value: null, digits: [] };
    return { value: frame.measures.opposition[focus], digits: ['thumb', focus] };
  }
  const joints = METRIC_JOINTS[metric];
  const used: Finger[] = [];
  let sum = 0;
  for (const digit of digits) {
    if (digit === 'thumb') continue;
    const estimates = frame.joints[digit];
    if (!joints.every((joint) => usableGrade(estimates[joint]?.grade, minGrade))) continue;
    if (baseline && !joints.every((joint) => baseline[digit]?.[joint] !== undefined)) continue;
    sum += joints.reduce((total, joint) => total + (estimates[joint]?.deg ?? 0) - (baseline?.[digit]?.[joint]?.deg ?? 0), 0);
    used.push(digit);
  }
  return used.length === 0 ? { value: null, digits: [] } : { value: sum / used.length, digits: used };
}

/** Start-position values, joint by joint. */
export type Baseline = Partial<Record<Finger, Partial<Record<JointId, { deg: number }>>>>;

type Posture = 'met' | 'unmet' | 'unknown';

interface PostureCheck {
  state: Posture;
  /** Criteria that are evaluable and not satisfied. */
  failing: Criterion[];
}

/** How many recent start-position samples the start values are taken from (about a second and a half at 30 frames a second). */
const REST_WINDOW = 45;
const MIN_REST_SAMPLES = 6;

const UNKNOWN: PostureCheck = { state: 'unknown', failing: [] };

/** Whether a view is one the definition accepts. Until the hand's shape has confirmed left or right, palm and back cannot be told apart, so either stands for the other. */
export function viewAccepted(acceptable: readonly HandView[], frame: TrackedFrame): boolean {
  const view = frame.view?.kind;
  if (!view) return false;
  if (acceptable.includes(view)) return true;
  if (!frame.sideConfirmed && (view === 'palmar' || view === 'dorsal')) return acceptable.includes('palmar') || acceptable.includes('dorsal');
  return false;
}

// ---------- The engine ----------

interface Sample {
  primary: number;
  joints: Partial<Record<Finger, Partial<Record<JointId, { deg: number; grade: Grade }>>>>;
}

interface Attempt {
  startedAt: number;
  leftStartAt: number | null;
  reachedAt: number | null;
  frames: number;
  usableFrames: number;
  holdMs: number;
  samples: Sample[];
  peak: Partial<Record<Finger, Partial<Record<JointId, number>>>>;
  digits: Set<Finger>;
  view: HandView | null;
  /** The furthest point reached towards the target, and the sample taken there. */
  bestProgress: number;
  best: Sample | null;
  /** True when this movement has already been recorded (as a hold that was let go), so coming back is not recorded again. */
  counted: boolean;
}

/** A movement counts as an attempt that fell short once it has gone at least this far towards the target... */
const SHORTFALL_PROGRESS = 0.35;
/** ...and has been away from the start position for at least this long. */
const SHORTFALL_MS = 500;

/** What to say for each thing that stops a frame being used. Instructions, not diagnoses. */
export const QUALITY_GUIDANCE: Record<Exclude<Blocker, 'view' | 'hidden' | 'not-at-start'>, string> = {
  'no-hand': 'Show your hand to the camera',
  'tracking-held': 'Hold still, finding your hand again',
  clipped: 'Keep your whole hand in view',
  'too-far': 'Bring your hand a little closer',
  'too-close': 'Move your hand slightly farther away',
  'device-moving': 'Hold the phone as still as you can',
  'moving-fast': 'Keep your hand in one place',
  unstable: 'Tracking is unsteady. Try brighter, even light',
  settling: 'Hold still for a moment',
};

export class AssessmentEngine {
  readonly setup: ResolvedAssessment;
  readonly timing: EngineTiming;
  /** How to turn the hand, said when the view is not one this assessment accepts. Depends on how the camera is being used. */
  viewAdvice: string;
  private phase: EnginePhase = 'searching';
  private paused = false;
  private startedAt: number | null = null;
  private lastAt = 0;
  private lastUsableAt: number | null = null;
  private settleSince: number | null = null;
  private settleSamples: Sample[] = [];
  private returnSince: number | null = null;
  private returnSamples: Sample[] = [];
  /** Recent samples taken in the start position, from which the start values of the next repetition are read. */
  private restSamples: Sample[] = [];
  private interruptedSince: number | null = null;
  private startValues: Sample | null = null;
  private attempt: Attempt | null = null;
  private pending: RepRecord | null = null;
  private attempts = 0;
  private wasTracking = false;
  private lastEvent: EngineEvent | null = null;
  private pausedSince: number | null = null;
  private pausedMs = 0;
  private readonly reps: RepRecord[] = [];
  private readonly counts = { frames: 0, tracked: 0, usable: 0, jumps: 0 };
  private readonly reasonCounts: Partial<Record<QualityReason | 'view' | 'hidden', number>> = {};
  private readonly views: Partial<Record<HandView, number>> = {};

  constructor(setup: ResolvedAssessment, timing: Partial<EngineTiming> = {}) {
    this.viewAdvice = viewAdvice(setup.definition, setup.focus, 'laptop');
    this.setup = setup;
    this.timing = { ...DEFAULT_TIMING, ...timing };
  }

  get targetReps(): number {
    return Math.round(this.setup.params.reps ?? 3);
  }

  get holdMs(): number {
    return (this.setup.params.holdSeconds ?? 2) * 1000;
  }

  get records(): readonly RepRecord[] {
    return this.reps;
  }

  get validReps(): number {
    return this.reps.filter((rep) => rep.valid).length;
  }

  pause(): void {
    this.paused = true;
  }

  /** Resuming always goes back through the start position: nothing is carried across a pause. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.phase !== 'complete') this.abandon('searching');
  }

  /** Session-level quality: how much of the session was tracked and usable, and what got in the way. */
  quality(): SessionQuality {
    const { frames, tracked, usable, jumps } = this.counts;
    return {
      frames,
      tracked: frames === 0 ? 0 : tracked / frames,
      usable: frames === 0 ? 0 : usable / frames,
      jumps,
      reasons: { ...this.reasonCounts },
    };
  }

  /** The view the hand was in for most of the usable frames. */
  dominantView(): HandView | null {
    let best: HandView | null = null;
    let most = 0;
    for (const [view, count] of Object.entries(this.views) as [HandView, number][]) {
      if (count > most) {
        most = count;
        best = view;
      }
    }
    return best;
  }

  elapsedMs(): number {
    return this.startedAt === null ? 0 : Math.max(0, this.lastAt - this.startedAt - this.pausedMs);
  }

  /**
   * Closes the session. A repetition whose hold was completed but whose return was
   * not seen is kept: the measurement was taken. A hold still in progress is not.
   */
  finish(): RepRecord[] {
    if (this.pending) {
      this.reps.push({ ...this.pending, endedAt: this.relative(this.lastAt) });
      this.pending = null;
    }
    this.attempt = null;
    return [...this.reps];
  }

  update(frame: TrackedFrame): EngineState {
    const now = frame.t;
    if (this.startedAt === null) this.startedAt = now;
    const events: EngineEvent[] = [];
    const emit = (type: EngineEventType, extra: Partial<EngineEvent> = {}) => {
      const event: EngineEvent = { type, at: this.relative(now), ...extra };
      events.push(event);
      this.lastEvent = event;
    };

    if (this.paused) {
      // Time spent paused is not part of the session.
      if (this.pausedSince === null) this.pausedSince = now;
      return this.snapshot(frame, [], events, null, []);
    }
    if (this.pausedSince !== null) {
      this.pausedMs += now - this.pausedSince;
      this.pausedSince = null;
    }
    if (this.phase === 'complete') return this.snapshot(frame, [], events, null, []);
    this.lastAt = now;

    const { definition, params, digits, focus, minGrade } = this.setup;
    const tracking = frame.status !== 'lost';
    this.counts.frames += 1;
    if (tracking) this.counts.tracked += 1;
    if (frame.rejected) this.counts.jumps += 1;
    if (tracking && !this.wasTracking) emit('tracking-ready');
    if (!tracking && this.wasTracking) emit('tracking-lost');
    this.wasTracking = tracking;

    // What stops this frame from being used, most important first.
    const blockers: Blocker[] = [...frame.quality.reasons];
    const primary = evaluateMetric(frame, definition.primary, digits, focus, minGrade);
    if (tracking && blockers.length === 0) {
      if (!viewAccepted(definition.views.acceptable, frame)) blockers.push('view');
      else if (primary.value === null) blockers.push('hidden');
    }
    for (const blocker of blockers) {
      if (blocker !== 'not-at-start') this.reasonCounts[blocker] = (this.reasonCounts[blocker] ?? 0) + 1;
    }
    const usable = blockers.length === 0;
    if (usable) {
      this.counts.usable += 1;
      const view = frame.view?.kind;
      if (view) this.views[view] = (this.views[view] ?? 0) + 1;
    }

    const start = usable ? this.check(frame, definition.start, this.phase === 'settling' || this.phase === 'ready', false) : UNKNOWN;
    const target = usable ? this.check(frame, definition.target, this.phase === 'holding' || this.phase === 'release', true) : UNKNOWN;
    const sample = usable && primary.value !== null ? this.sample(frame, primary.value) : null;
    const step = this.lastUsableAt === null ? 0 : Math.min(120, now - this.lastUsableAt);

    if (this.attempt) {
      this.attempt.frames += 1;
      if (usable) this.attempt.usableFrames += 1;
    }

    // A break in usable tracking: ridden out if short, otherwise whatever was in progress is abandoned.
    if (!usable && this.phase !== 'searching' && this.phase !== 'positioning') {
      if (this.interruptedSince === null) this.interruptedSince = now;
      if (now - this.interruptedSince > this.timing.graceMs || this.phase === 'settling') {
        if (this.phase === 'holding' && this.attempt && this.attempt.holdMs >= this.timing.minAttemptMs) {
          const rejected = this.close(this.attempt, false, 'tracking-lost', now);
          this.reps.push(rejected);
          emit('attempt-rejected', { rep: rejected, reason: 'tracking-lost' });
        } else if (this.phase === 'release' && this.pending) {
          // The hold was complete and the measurement taken; only the return was not seen.
          const kept = { ...this.pending, endedAt: this.relative(now) };
          this.reps.push(kept);
          this.pending = null;
          emit('rep-recorded', { rep: kept });
        }
        this.abandon(tracking ? 'positioning' : 'searching');
        if (this.validReps >= this.targetReps) {
          this.phase = 'complete';
          emit('complete');
        }
      }
      return this.snapshot(frame, blockers, events, primary.value, primary.digits);
    }
    this.interruptedSince = null;

    switch (this.phase) {
      case 'searching':
      case 'positioning': {
        if (!tracking) {
          this.phase = 'searching';
          break;
        }
        this.phase = 'positioning';
        if (usable && start.state === 'met' && sample) {
          this.phase = 'settling';
          this.settleSince = now;
          this.settleSamples = [sample];
        } else if (usable && start.state !== 'met') {
          blockers.push('not-at-start');
        }
        break;
      }

      case 'settling': {
        if (start.state !== 'met' || !sample) {
          this.phase = 'positioning';
          this.settleSince = null;
          blockers.push('not-at-start');
          break;
        }
        this.settleSamples.push(sample);
        if (now - (this.settleSince ?? now) >= this.timing.settleMs) {
          this.startValues = combine(this.settleSamples);
          this.restSamples = [...this.settleSamples];
          this.phase = 'ready';
          this.attempt = this.open(now);
          emit('start-detected');
        }
        break;
      }

      case 'ready': {
        let attempt = this.attempt ?? (this.attempt = this.open(now));
        if (sample) {
          this.track(attempt, sample, frame);
          const reached = this.progressOf(frame, sample.primary);
          if (reached > attempt.bestProgress) {
            attempt.bestProgress = reached;
            attempt.best = sample;
          }
        }
        if (start.state === 'met' && target.state !== 'met') {
          // Back at the start without having reached the target: a movement that fell short is recorded as that.
          if (
            attempt.leftStartAt !== null &&
            !attempt.counted &&
            attempt.best &&
            attempt.bestProgress >= SHORTFALL_PROGRESS &&
            now - attempt.leftStartAt >= SHORTFALL_MS
          ) {
            attempt.samples = [attempt.best];
            const shortfall = this.close(attempt, false, 'target-not-reached', now);
            this.reps.push(shortfall);
            emit('attempt-rejected', { rep: shortfall, reason: 'target-not-reached' });
            attempt = this.attempt = this.open(now);
          }
          // Resting in the start position: its values are read from here, not from the moment it was reached.
          attempt.leftStartAt = null;
          attempt.bestProgress = 0;
          attempt.best = null;
          attempt.counted = false;
          if (sample) {
            this.restSamples.push(sample);
            if (this.restSamples.length > REST_WINDOW) this.restSamples.shift();
          }
        } else if (attempt.leftStartAt === null) {
          attempt.leftStartAt = now;
          if (this.restSamples.length >= MIN_REST_SAMPLES) this.startValues = combine(this.restSamples);
        }
        if (target.state === 'met' && sample) {
          attempt.reachedAt = now;
          attempt.holdMs = 0;
          attempt.samples = [sample];
          this.phase = 'holding';
          emit('target-detected');
        }
        break;
      }

      case 'holding': {
        const attempt = this.attempt as Attempt;
        if (sample) this.track(attempt, sample, frame);
        if (target.state === 'met' && sample) {
          attempt.holdMs += step;
          attempt.samples.push(sample);
          if (attempt.holdMs >= this.holdMs) {
            emit('hold-complete');
            const steadyWithin = params.steadyWithin;
            const spread = robustSpread(attempt.samples.map((item) => item.primary));
            if (steadyWithin !== undefined && spread !== null && spread > steadyWithin) {
              const rejected = this.close(attempt, false, 'unsteady', now);
              this.reps.push(rejected);
              emit('attempt-rejected', { rep: rejected, reason: 'unsteady' });
              this.pending = null;
            } else {
              this.pending = this.close(attempt, true, null, now);
            }
            this.phase = 'release';
            this.returnSince = null;
          }
        } else {
          // Left the target before the hold was complete.
          if (attempt.holdMs >= this.timing.minAttemptMs) {
            const rejected = this.close(attempt, false, 'hold-too-short', now);
            this.reps.push(rejected);
            emit('attempt-rejected', { rep: rejected, reason: 'hold-too-short' });
          }
          this.attempt = this.open(now);
          this.attempt.leftStartAt = now;
          this.attempt.counted = true;
          this.phase = 'ready';
        }
        break;
      }

      case 'release': {
        const attempt = this.attempt;
        if (attempt && sample && target.state === 'met' && this.pending) {
          // Still holding: the hold simply gets longer.
          attempt.holdMs += step;
          attempt.samples.push(sample);
          this.track(attempt, sample, frame);
          this.pending = this.close(attempt, true, null, now);
        }
        // Back at the start means the start position AND no longer the target: for a movement like the
        // tabletop, where only one joint moves, the two can overlap on the start criterion alone.
        if (start.state === 'met' && target.state !== 'met' && sample) {
          if (this.returnSince === null) {
            this.returnSince = now;
            this.returnSamples = [];
          }
          this.returnSamples.push(sample);
          if (now - this.returnSince >= this.timing.returnMs) {
            if (this.pending) {
              const rep: RepRecord = { ...this.pending, returned: true, endedAt: this.relative(now) };
              this.reps.push(rep);
              this.pending = null;
              emit('rep-recorded', { rep });
            }
            this.restSamples = [...this.returnSamples];
            this.returnSince = null;
            if (this.validReps >= this.targetReps) {
              this.phase = 'complete';
              this.attempt = null;
              emit('complete');
            } else {
              this.phase = 'ready';
              this.attempt = this.open(now);
            }
          }
        } else {
          this.returnSince = null;
        }
        break;
      }

      default:
        break;
    }

    if (usable) this.lastUsableAt = now;
    return this.snapshot(frame, blockers, events, primary.value, primary.digits, target.failing);
  }

  // ---------- Internals ----------

  private relative(now: number): number {
    return Math.round(now - (this.startedAt ?? now));
  }

  private abandon(phase: 'searching' | 'positioning'): void {
    this.phase = phase;
    this.attempt = null;
    this.pending = null;
    this.settleSince = null;
    this.returnSince = null;
    this.interruptedSince = null;
    this.lastUsableAt = null;
  }

  private open(now: number): Attempt {
    return {
      startedAt: now,
      leftStartAt: null,
      reachedAt: null,
      frames: 0,
      usableFrames: 0,
      holdMs: 0,
      samples: [],
      peak: {},
      digits: new Set(),
      view: null,
      bestProgress: 0,
      best: null,
      counted: false,
    };
  }

  private threshold(criterion: Criterion): number {
    return this.setup.params[criterion.param];
  }

  /**
   * `inside` widens the test by the hysteresis margin, for a position that is already held.
   * `fromStart` compares joint angles as a change from the start position (target criteria) instead of as they are.
   */
  private check(frame: TrackedFrame, criteria: readonly Criterion[], inside: boolean, fromStart: boolean): PostureCheck {
    const { digits, focus, minGrade } = this.setup;
    const failing: Criterion[] = [];
    let unknown = false;
    if (fromStart && !this.startValues) return UNKNOWN;
    const baseline = fromStart ? (this.startValues?.joints ?? null) : null;
    for (const criterion of criteria) {
      const { value } = evaluateMetric(frame, criterion.metric, digits, focus, minGrade, baseline);
      if (value === null) {
        unknown = true;
        continue;
      }
      const margin = inside ? HYSTERESIS[criterion.metric === 'opposition' ? 'palm' : 'deg'] : 0;
      const limit = this.threshold(criterion);
      const met = criterion.cmp === 'at-least' ? value >= limit - margin : value <= limit + margin;
      if (!met) failing.push(criterion);
    }
    return { state: unknown ? 'unknown' : failing.length === 0 ? 'met' : 'unmet', failing };
  }

  private sample(frame: TrackedFrame, primary: number): Sample {
    const joints: Sample['joints'] = {};
    if (frame.joints) {
      const wanted: Finger[] = this.setup.definition.primary === 'opposition' ? ['thumb', this.setup.focus] : this.setup.digits;
      for (const digit of wanted) {
        const entry: Partial<Record<JointId, { deg: number; grade: Grade }>> = {};
        for (const joint of DIGIT_JOINTS[digit]) {
          const estimate = frame.joints[digit][joint];
          if (estimate && usableGrade(estimate.grade, this.setup.minGrade)) entry[joint] = { deg: estimate.deg, grade: estimate.grade };
        }
        if (Object.keys(entry).length > 0) joints[digit] = entry;
      }
    }
    return { primary, joints };
  }

  private track(attempt: Attempt, sample: Sample, frame: TrackedFrame): void {
    attempt.view = frame.view?.kind ?? attempt.view;
    for (const [digit, joints] of Object.entries(sample.joints) as [Finger, Sample['joints'][Finger]][]) {
      attempt.digits.add(digit);
      const peaks = attempt.peak[digit] ?? (attempt.peak[digit] = {});
      for (const [joint, estimate] of Object.entries(joints ?? {}) as [JointId, { deg: number }][]) {
        peaks[joint] = Math.max(peaks[joint] ?? -Infinity, estimate.deg);
      }
    }
  }

  private close(attempt: Attempt, valid: boolean, rejectReason: RejectReason | null, now: number): RepRecord {
    const held = combine(attempt.samples);
    const joints: RepRecord['joints'] = {};
    for (const [digit, entries] of Object.entries(held.joints) as [Finger, Sample['joints'][Finger]][]) {
      const out: Partial<Record<JointId, RepJoint>> = {};
      for (const [joint, estimate] of Object.entries(entries ?? {}) as [JointId, { deg: number; grade: Grade }][]) {
        out[joint] = {
          held: round(estimate.deg),
          peak: round(attempt.peak[digit]?.[joint] ?? estimate.deg),
          start: this.startValues?.joints[digit]?.[joint] ? round(this.startValues.joints[digit]?.[joint]?.deg as number) : null,
          grade: estimate.grade,
        };
      }
      joints[digit] = out;
    }
    const opposition = this.setup.definition.primary === 'opposition';
    // Numbered when first closed; closing the same attempt again (a hold that carries on) keeps its number.
    const existing = this.pending && this.pending.startedAt === this.relative(attempt.startedAt) ? this.pending.attempt : null;
    if (existing === null) this.attempts += 1;
    return {
      attempt: existing ?? this.attempts,
      valid,
      rejectReason,
      startedAt: this.relative(attempt.startedAt),
      endedAt: this.relative(now),
      holdMs: Math.round(attempt.holdMs),
      timeToTargetMs: attempt.reachedAt !== null && attempt.leftStartAt !== null ? Math.max(0, Math.round(attempt.reachedAt - attempt.leftStartAt)) : null,
      primary: opposition ? Math.round(held.primary * 1000) / 1000 : round(held.primary),
      holdSd: (() => {
        const spread = robustSpread(attempt.samples.map((item) => item.primary));
        return spread === null ? null : opposition ? Math.round(spread * 1000) / 1000 : round(spread);
      })(),
      joints,
      digits: [...attempt.digits],
      returned: false,
      view: attempt.view,
      usable: attempt.frames === 0 ? 1 : Math.round((attempt.usableFrames / attempt.frames) * 100) / 100,
    };
  }

  private snapshot(
    frame: TrackedFrame,
    blockers: Blocker[],
    events: EngineEvent[],
    primary: number | null,
    digits: Finger[],
    failing: Criterion[] = [],
  ): EngineState {
    const valid = this.validReps;
    const rejected = this.reps.length - valid;
    const holdProgress = this.phase === 'holding' && this.attempt ? Math.min(1, this.attempt.holdMs / this.holdMs) : this.phase === 'release' ? 1 : 0;
    return {
      phase: this.phase,
      paused: this.paused,
      validReps: valid,
      rejectedReps: rejected,
      targetReps: this.targetReps,
      holdProgress,
      progress: this.progressOf(frame, primary),
      rejectedBy: this.rejectedBy(),
      primary,
      digits,
      blockers,
      feedback: this.feedback(frame, blockers, failing),
      events,
      lastEvent: this.lastEvent,
      elapsedMs: this.elapsedMs(),
    };
  }

  /** How far the primary quantity has come from the start position towards its target threshold, 0 to 1. */
  private progressOf(frame: TrackedFrame, primary: number | null): number {
    if (primary === null || !this.startValues) return 0;
    const { definition, params, digits, focus, minGrade } = this.setup;
    const goal = definition.target.find((criterion) => criterion.metric === definition.primary);
    if (!goal) return 0;
    const limit = params[goal.param];
    if (definition.primary === 'opposition') {
      const span = limit - this.startValues.primary;
      return Math.abs(span) < 1e-9 ? 0 : Math.min(1, Math.max(0, (primary - this.startValues.primary) / span));
    }
    const change = evaluateMetric(frame, definition.primary, digits, focus, minGrade, this.startValues.joints).value;
    return change === null || limit <= 0 ? 0 : Math.min(1, Math.max(0, change / limit));
  }

  private rejectedBy(): Partial<Record<RejectReason, number>> {
    const counts: Partial<Record<RejectReason, number>> = {};
    for (const rep of this.reps) if (rep.rejectReason) counts[rep.rejectReason] = (counts[rep.rejectReason] ?? 0) + 1;
    return counts;
  }

  private feedback(frame: TrackedFrame, blockers: Blocker[], failing: Criterion[]): Feedback {
    const { cues } = this.setup.definition;
    const viewAdvice = this.viewAdvice;
    if (this.phase === 'complete') return { tone: 'good', text: 'All repetitions recorded' };
    if (this.paused) return { tone: 'guide', text: 'Paused' };
    if (frame.status === 'lost') return { tone: 'guide', text: QUALITY_GUIDANCE['no-hand'] };

    const first = blockers[0];
    if (first === 'view') return { tone: 'guide', text: viewAdvice };
    if (first === 'hidden') return { tone: 'guide', text: `The joints being assessed are hidden. ${viewAdvice}` };
    if (first && first !== 'not-at-start') {
      // Settling is only worth saying before a session is under way.
      if (first === 'settling' && this.phase !== 'searching' && this.phase !== 'positioning') return this.phaseCue(failing);
      return { tone: first === 'unstable' || first === 'device-moving' ? 'caution' : 'guide', text: QUALITY_GUIDANCE[first] };
    }
    if (this.phase === 'positioning') return { tone: 'guide', text: cues.start };
    return this.phaseCue(failing);
  }

  private phaseCue(failing: Criterion[]): Feedback {
    const { cues } = this.setup.definition;
    switch (this.phase) {
      case 'settling':
        return { tone: 'good', text: 'Starting position found. Hold it' };
      case 'ready': {
        // A specific correction only when it is the one thing missing and the data shows it.
        const hinted = failing.length === 1 && failing[0].hint ? failing[0].hint : null;
        const others = this.setup.definition.target.length - failing.length;
        if (hinted && others > 0) return { tone: 'active', text: hinted };
        return { tone: 'active', text: cues.move };
      }
      case 'holding':
        return { tone: 'good', text: cues.hold };
      case 'release':
        return { tone: 'good', text: this.pending ? `Recorded. ${cues.release}` : cues.release };
      default:
        return { tone: 'guide', text: cues.start };
    }
  }
}

// ---------- Small statistics ----------

const round = (value: number): number => Math.round(value * 10) / 10;

/** Sample standard deviation. Null with fewer than two values. */
export function deviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

/**
 * How much a held value wandered: the median absolute deviation, scaled to read
 * like a standard deviation for well-behaved data. The first moments of a hold
 * are still the tail of the movement into it; unlike a plain standard deviation,
 * this is not thrown by them.
 */
export function robustSpread(values: readonly number[]): number | null {
  if (values.length < 3) return null;
  const centre = median(values) as number;
  return 1.4826 * (median(values.map((value) => Math.abs(value - centre))) as number);
}

const GRADES: Grade[] = ['unavailable', 'inferred', 'direct'];

/** The median of each quantity across samples; a joint's grade is the weakest it was seen at. */
function combine(samples: readonly Sample[]): Sample {
  const joints: Sample['joints'] = {};
  const seen = new Map<string, { digit: Finger; joint: JointId; values: number[]; grade: number }>();
  for (const sample of samples) {
    for (const [digit, entries] of Object.entries(sample.joints) as [Finger, Sample['joints'][Finger]][]) {
      for (const [joint, estimate] of Object.entries(entries ?? {}) as [JointId, { deg: number; grade: Grade }][]) {
        const key = `${digit}.${joint}`;
        const entry = seen.get(key) ?? { digit, joint, values: [], grade: GRADE_RANK.direct };
        entry.values.push(estimate.deg);
        entry.grade = Math.min(entry.grade, GRADE_RANK[estimate.grade]);
        seen.set(key, entry);
      }
    }
  }
  for (const { digit, joint, values, grade } of seen.values()) {
    // A joint seen in under half the samples was not really held in view.
    if (values.length < samples.length / 2) continue;
    (joints[digit] ?? (joints[digit] = {}))[joint] = { deg: median(values) as number, grade: GRADES[grade] };
  }
  return { primary: median(samples.map((sample) => sample.primary)) ?? 0, joints };
}
