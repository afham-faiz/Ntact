/**
 * One live session, from "start" to "finish": owns the camera (or a recording),
 * the model, the tracker, the assessment engine, the drawing and the cues, and
 * lets all of them go again.
 *
 * Not a React component. A screen creates one, gives it a video element and a
 * canvas, and subscribes to its snapshots. Keeping it outside React keeps the
 * per-frame work off React's render path: the canvas is painted directly, and the
 * screen is only told when something it shows has changed.
 */
import { viewAdvice, type ResolvedAssessment } from '../../assessment/definitions';
import { AssessmentEngine, type EngineState } from '../../assessment/engine';
import { TRACKING_DEFAULTS } from '../../assessment/session';
import type { CameraSetup, CaptureInfo, RepRecord, SessionQuality, TrackingInfo } from '../../assessment/types';
import { CameraError, CameraStream, type CameraFailure, type CameraInfo, type Facing } from '../../camera/cameraStream';
import { drawOverlay } from '../../camera/drawOverlay';
import { loadLandmarker, type Delegate, type ModelSource } from '../../camera/landmarker';
import { LumaSampler, MotionSensor, ScreenAwake } from '../../camera/sensors';
import { CameraSource, ReplaySource, TrackingLoop, type FrameSource, type PerfStats } from '../../camera/trackingLoop';
import type { Finger, Hand } from '../../domain/types';
import { DIGIT_JOINTS, FINGERS, type Grade, type HandView, type JointId } from '../../tracking/geometry';
import { RecordingBuilder, type LandmarkRecording } from '../../tracking/recording';
import { HandTracker, type QualityAdvisory, type QualityReason, type SideSource, type TrackedFrame } from '../../tracking/tracker';
import type { TrackStatus } from '../../tracking/stabiliser';
import { Cues } from './cues';
import { ART_DARK, paintHand } from './handArt';

/**
 * What a person seems to need help with, worked out from how the session is going.
 *   position  the start position has not been found for a while
 *   tracking  tracking keeps being unsteady or lost
 *   movement  the movement keeps falling short of the position the assessment is set to recognise
 *   hold      the position is reached but let go before the hold is complete
 */
export type HelpKind = 'position' | 'tracking' | 'movement' | 'hold';

const HELP_AFTER = { positionMs: 10_000, readyMs: 16_000, shortfalls: 2, briefHolds: 2 } as const;

export type RunStatus = 'idle' | 'starting' | 'live' | 'interrupted' | 'error' | 'finished';

export interface JointReading {
  deg: number;
  grade: Grade;
}

export interface TrackingSnapshot {
  status: TrackStatus;
  usable: boolean;
  reasons: QualityReason[];
  advisories: QualityAdvisory[];
  view: HandView | null;
  side: Hand | null;
  sideSource: SideSource | null;
  sideConfirmed: boolean;
  modelSide: Hand | null;
  shapeSide: Hand | null;
  modelScore: number | null;
  jitter: number;
  palmSpeed: number;
  size: number;
  facing: number | null;
}

export interface LiveSnapshot {
  status: RunStatus;
  failure: CameraFailure | null;
  /** Null when no assessment is running (free tracking). */
  engine: EngineState | null;
  tracking: TrackingSnapshot | null;
  /** Whole degrees for every joint of every digit, for the read-outs. */
  joints: Record<Finger, Partial<Record<JointId, JointReading>>> | null;
  opposition: number | null;
  perf: PerfStats | null;
  camera: CameraInfo | null;
  mirrored: boolean;
  delegate: Delegate | null;
  modelSource: ModelSource | null;
  modelLoadMs: number | null;
  /** True while frames come from a recording rather than a camera. */
  replay: boolean;
  recordingFrames: number;
  /** Set when the session looks stuck. The screen offers help; it never interrupts. */
  help: HelpKind | null;
}

export interface RunOptions {
  /** The assessment to run, or null to track freely without recording anything. */
  setup: ResolvedAssessment | null;
  /** The hand the session is set up for, when known. */
  hand: Hand | null;
  cameraSetup: CameraSetup;
  facing: Facing;
  /** A recording to play instead of opening the camera. */
  recording?: LandmarkRecording | null;
  loopRecording?: boolean;
  /** Collect the landmarks of this session so they can be exported. Landmarks only, never the picture. */
  capture?: boolean;
  onFinished?(result: RunResult): void;
}

export interface RunResult {
  reps: RepRecord[];
  quality: SessionQuality;
  view: HandView | null;
  durationMs: number;
  capture: CaptureInfo;
  tracking: TrackingInfo;
  detectedHand: Hand | null;
  replay: boolean;
}

type Listener = () => void;

const EMPTY: LiveSnapshot = {
  status: 'idle',
  failure: null,
  engine: null,
  tracking: null,
  joints: null,
  opposition: null,
  perf: null,
  camera: null,
  mirrored: true,
  delegate: null,
  modelSource: null,
  modelLoadMs: null,
  replay: false,
  recordingFrames: 0,
  help: null,
};

export class LiveRun {
  readonly cues = new Cues();
  private readonly options: RunOptions;
  private readonly camera = new CameraStream();
  private readonly tracker = new HandTracker();
  private readonly luma = new LumaSampler();
  private readonly motion = new MotionSensor();
  private readonly awake = new ScreenAwake();
  private readonly listeners = new Set<Listener>();
  private engine: AssessmentEngine | null;
  private loop: TrackingLoop | null = null;
  private recorder: RecordingBuilder | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private stage: HTMLElement | null = null;
  private snapshot: LiveSnapshot = EMPTY;
  private lastPublished = 0;
  private lastFrame: TrackedFrame | null = null;
  private lastState: EngineState | null = null;
  private pulseAt: number | null = null;
  private detectedHand: Hand | null = null;
  private disposed = false;
  private finished = false;
  private generation = 0;
  private unsubscribeCamera: (() => void) | null = null;
  private lastSpokenText = '';
  private waitingSince: { phase: string; at: number } | null = null;
  debug = false;
  labels = true;

  constructor(options: RunOptions) {
    this.options = options;
    this.engine = options.setup ? new AssessmentEngine(options.setup) : null;
    this.adviseView();
  }

  /** The camera choices can change until the session starts. */
  configure(choices: Pick<RunOptions, 'cameraSetup' | 'facing'>): void {
    this.options.cameraSetup = choices.cameraSetup;
    this.options.facing = choices.facing;
    this.adviseView();
  }

  /** The view asked for depends on how the camera is being used: a hand held up to a laptop, or resting under a phone. */
  private adviseView(): void {
    const setup = this.options.setup;
    if (this.engine && setup) this.engine.viewAdvice = viewAdvice(setup.definition, setup.focus, this.options.cameraSetup);
  }

  /** Whether the session looks stuck, and on what. */
  private helpFor(state: EngineState | null, now: number): HelpKind | null {
    if (!state || state.paused || state.phase === 'complete') {
      this.waitingSince = null;
      return null;
    }
    const waiting = state.phase === 'searching' || state.phase === 'positioning' ? 'position' : state.phase === 'ready' ? 'ready' : null;
    if (waiting === null) this.waitingSince = null;
    else if (this.waitingSince?.phase !== waiting) this.waitingSince = { phase: waiting, at: now };

    if ((state.rejectedBy['target-not-reached'] ?? 0) >= HELP_AFTER.shortfalls) return 'movement';
    if ((state.rejectedBy['hold-too-short'] ?? 0) + (state.rejectedBy.unsteady ?? 0) >= HELP_AFTER.briefHolds) return 'hold';
    if (this.waitingSince?.phase === 'position' && now - this.waitingSince.at > HELP_AFTER.positionMs) {
      const first = state.blockers[0];
      return first === 'unstable' || first === 'tracking-held' || first === 'moving-fast' || first === 'device-moving' ? 'tracking' : 'position';
    }
    if (this.waitingSince?.phase === 'ready' && now - this.waitingSince.at > HELP_AFTER.readyMs) return 'movement';
    return null;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LiveSnapshot => this.snapshot;

  private publish(patch: Partial<LiveSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** Where to show the picture and draw the hand. `stage` is the box both fill. */
  attach(video: HTMLVideoElement | null, canvas: HTMLCanvasElement | null, stage: HTMLElement | null): void {
    this.video = video;
    this.canvas = canvas;
    this.stage = stage;
  }

  /** Opens the camera (or the recording) and begins. Call from a tap so that sound is allowed. */
  async start(): Promise<void> {
    if (this.disposed) return;
    const generation = (this.generation += 1);
    this.finished = false;
    this.cues.unlock();
    this.publish({ ...EMPTY, status: 'starting', replay: Boolean(this.options.recording) });
    const { recording, loopRecording, cameraSetup, facing, capture } = this.options;
    // Asked for now, while this is still the person's tap: iOS only offers motion readings in answer to one.
    if (!recording && cameraSetup !== 'laptop') void this.motion.start();

    let source: FrameSource;
    try {
      if (recording) {
        source = new ReplaySource(recording, loopRecording ?? false);
      } else {
        const video = this.video;
        if (!video) throw new CameraError('failed', 'No picture element.');
        // Load the model while the browser is asking about the camera.
        const model = loadLandmarker();
        model.catch(() => undefined);
        const info = await this.camera.open(video, { facing });
        const landmarker = await model;
        if (this.disposed || generation !== this.generation) return;
        source = new CameraSource(video, landmarker);
        this.unsubscribeCamera?.();
        this.unsubscribeCamera = this.camera.subscribe((event) => {
          if (event === 'interrupted') this.publish({ status: 'interrupted' });
          else if (event === 'resumed') this.publish({ status: 'live', camera: this.camera.info, mirrored: this.camera.mirrored });
          else this.publish({ status: 'error', failure: 'busy' });
        });
        this.publish({ camera: info, mirrored: this.camera.mirrored, delegate: landmarker.delegate, modelSource: landmarker.source, modelLoadMs: landmarker.loadMs });
        void this.awake.hold();
      }
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.camera.stop();
      this.publish({ status: 'error', failure: error instanceof CameraError ? error.reason : 'failed' });
      return;
    }

    this.recorder = capture ? new RecordingBuilder() : null;
    this.loop = new TrackingLoop({
      source,
      tracker: this.tracker,
      expectedHand: this.options.hand,
      video: recording ? null : this.video,
      luma: recording ? null : this.luma,
      motion: recording ? null : this.motion,
      onFrame: (frame, perf, observations) => this.onFrame(frame, perf, observations),
      onEnded: () => this.finish(),
    });
    this.publish({ status: 'live' });
    this.loop.start();
  }

  private onFrame(frame: TrackedFrame, perf: PerfStats, observations: Parameters<RecordingBuilder['push']>[1]): void {
    if (this.disposed || this.finished) return;
    this.lastFrame = frame;
    this.recorder?.push(frame.t, observations);
    if (frame.sideConfirmed && frame.side) this.detectedHand = frame.side;

    const state = this.engine ? this.engine.update(frame) : null;
    this.lastState = state;
    let urgent = false;
    if (state) {
      for (const event of state.events) {
        urgent = true;
        if (event.type === 'start-detected') this.cues.tone('ready');
        else if (event.type === 'target-detected') this.cues.tone('reached');
        else if (event.type === 'rep-recorded') {
          this.cues.tone('recorded');
          this.pulseAt = frame.t;
        } else if (event.type === 'attempt-rejected') this.cues.tone('rejected');
        else if (event.type === 'complete') this.cues.tone('complete');
      }
      if (state.feedback.text !== this.lastSpokenText) {
        this.lastSpokenText = state.feedback.text;
        this.cues.say(state.feedback.text, frame.t, urgent);
      }
    }

    this.paint(frame, state);

    // The screen is told at most about twelve times a second, and at once when something happens.
    if (urgent || frame.t - this.lastPublished > 80) {
      this.lastPublished = frame.t;
      this.publish({
        engine: state,
        tracking: describe(frame),
        joints: readings(frame),
        opposition: this.oppositionOf(frame),
        perf,
        recordingFrames: this.recorder?.length ?? 0,
        help: this.helpFor(state, frame.t),
      });
    }

    if (state?.phase === 'complete' && state.events.some((event) => event.type === 'complete')) {
      // Let the last ring finish before the summary takes over.
      window.setTimeout(() => this.finish(), 900);
    }
  }

  private oppositionOf(frame: TrackedFrame): number | null {
    const focus = this.options.setup?.focus ?? 'index';
    return frame.measures ? Math.round(frame.measures.opposition[focus] * 100) / 100 : null;
  }

  private paint(frame: TrackedFrame, state: EngineState | null): void {
    const canvas = this.canvas;
    const stage = this.stage;
    if (!canvas || !stage) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (width === 0 || height === 0) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const replay = Boolean(this.options.recording);
    const video = this.video;
    const setup = this.options.setup;
    const opposition = setup?.definition.primary === 'opposition';
    drawOverlay(context, frame, {
      viewport: {
        width,
        height,
        // A recording has no picture: its landmarks are laid out for a frame of its own shape.
        sourceWidth: !replay && video?.videoWidth ? video.videoWidth : height * (this.options.recording?.aspect ?? 4 / 3),
        sourceHeight: !replay && video?.videoHeight ? video.videoHeight : height,
        // The drawn hand sits in the middle of its frame: a narrow stage crops the empty sides, a wide one shows the whole frame.
        fit: !replay || width / height < (this.options.recording?.aspect ?? 4 / 3) ? 'cover' : 'contain',
        mirrored: !replay && this.camera.mirrored,
      },
      digits: setup ? (opposition ? ['thumb', setup.focus] : setup.digits) : FINGERS,
      focus: setup ? setup.focus : this.focusDigit,
      joints: setup ? (opposition ? [] : setup.definition.joints) : ['mcp', 'pip', 'dip'],
      labels: this.labels,
      debug: this.debug,
      active: state ? state.blockers.filter((blocker) => blocker !== 'not-at-start').length === 0 : frame.quality.ok,
      now: frame.t,
      pulseAt: this.pulseAt,
      // A replay has no camera picture, so the hand itself is drawn under the skeleton.
      underlay: replay ? (ctx, points) => paintHand(ctx, points, ART_DARK, [], frame.status === 'holding' ? 0.4 : 1) : undefined,
    });
  }

  /** In free tracking: which digit carries the angle labels. */
  focusDigit: Finger = 'index';

  pause(): void {
    this.engine?.pause();
    if (this.lastFrame && this.engine) this.publish({ engine: this.engine.update(this.lastFrame) });
  }

  resume(): void {
    this.engine?.resume();
  }

  /** Throws away what has been recorded so far and begins again, keeping the camera on. */
  restart(): void {
    if (!this.options.setup) return;
    this.engine = new AssessmentEngine(this.options.setup);
    this.adviseView();
    this.pulseAt = null;
    this.finished = false;
    this.waitingSince = null;
    this.publish({ engine: null, help: null });
  }

  /** Switches between the front and rear cameras. */
  async flip(): Promise<void> {
    if (this.options.recording) return;
    this.publish({ status: 'starting' });
    try {
      const info = await this.camera.flip();
      this.tracker.reset();
      this.publish({ status: 'live', camera: info, mirrored: this.camera.mirrored });
    } catch (error) {
      this.publish({ status: 'error', failure: error instanceof CameraError ? error.reason : 'failed' });
    }
  }

  /** The landmarks collected so far, when collecting was asked for. */
  exportRecording(label: string): LandmarkRecording | null {
    if (!this.recorder || this.recorder.length === 0) return null;
    const info = this.camera.info;
    return this.recorder.build({
      origin: this.options.recording ? this.options.recording.origin : 'recorded',
      label,
      aspect: info && info.height > 0 ? info.width / info.height : (this.options.recording?.aspect ?? 4 / 3),
      createdAt: new Date().toISOString(),
      note: 'Landmark coordinates only. No picture was stored.',
    });
  }

  /** Ends the session and hands back what was recorded. The camera is switched off. */
  finish(): RunResult | null {
    if (this.finished || this.disposed) return null;
    this.finished = true;
    const averages = this.loop?.averages() ?? { fps: null, inferenceMs: null };
    this.loop?.stop();
    const info = this.camera.info;
    const replay = Boolean(this.options.recording);
    const video = this.video;
    const result: RunResult = {
      reps: this.engine?.finish() ?? [],
      quality: this.engine?.quality() ?? { frames: 0, tracked: 0, usable: 0, jumps: 0, reasons: {} },
      view: this.engine?.dominantView() ?? null,
      durationMs: this.engine?.elapsedMs() ?? 0,
      capture: {
        setup: this.options.cameraSetup,
        facing: replay ? 'unknown' : (info?.facing ?? 'unknown'),
        width: replay ? 0 : video?.videoWidth || info?.width || 0,
        height: replay ? 0 : video?.videoHeight || info?.height || 0,
        fps: averages.fps,
        inferenceMs: averages.inferenceMs,
      },
      tracking: {
        ...TRACKING_DEFAULTS,
        delegate: replay ? 'none' : (this.snapshot.delegate ?? 'none'),
        labelConvention: this.tracker.labelConvention,
      },
      detectedHand: this.detectedHand,
      replay,
    };
    this.release();
    this.publish({ status: 'finished' });
    this.options.onFinished?.(result);
    return result;
  }

  private release(): void {
    this.loop?.stop();
    this.loop = null;
    this.unsubscribeCamera?.();
    this.unsubscribeCamera = null;
    this.camera.stop();
    this.motion.stop();
    this.awake.release();
  }

  /** Leaving the screen: everything is let go, and nothing is saved. */
  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.release();
    this.cues.close();
    this.listeners.clear();
  }

  get state(): EngineState | null {
    return this.lastState;
  }
}

function describe(frame: TrackedFrame): TrackingSnapshot {
  return {
    status: frame.status,
    usable: frame.quality.ok,
    reasons: frame.quality.reasons,
    advisories: frame.quality.advisories,
    view: frame.view?.kind ?? null,
    side: frame.side,
    sideSource: frame.sideSource,
    sideConfirmed: frame.sideConfirmed,
    modelSide: frame.modelSide,
    shapeSide: frame.shapeSide,
    modelScore: frame.quality.modelScore,
    jitter: frame.quality.jitter,
    palmSpeed: frame.quality.palmSpeed,
    size: frame.quality.size,
    facing: frame.view?.facing ?? null,
  };
}

function readings(frame: TrackedFrame): LiveSnapshot['joints'] {
  if (!frame.joints) return null;
  const out = {} as Record<Finger, Partial<Record<JointId, JointReading>>>;
  for (const finger of FINGERS) {
    out[finger] = {};
    for (const joint of DIGIT_JOINTS[finger]) {
      const estimate = frame.joints[finger][joint];
      if (estimate) out[finger][joint] = { deg: Math.round(estimate.deg), grade: estimate.grade };
    }
  }
  return out;
}
