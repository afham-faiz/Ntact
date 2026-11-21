/**
 * The frame loop: takes observations from a source (the camera, or a recording),
 * runs them through the tracker, and hands each tracked frame to whoever is
 * listening. Measures its own speed as it goes.
 *
 * The model runs on the page's main thread. A worker was considered and left out:
 * the model's runtime loads its WebAssembly in a way that module workers do not
 * support in every browser this app targets, and with graphics acceleration the
 * model's time per frame is small next to the frame interval. The loop instead
 * adapts: when the model cannot keep up it processes every other camera frame
 * rather than queueing work, so the screen stays responsive. The measured rate is
 * shown and stored; nothing here assumes one.
 */
import type { Hand } from '../domain/types';
import { frameObservations, ReplayCursor, type LandmarkRecording } from '../tracking/recording';
import type { HandObservation } from '../tracking/stabiliser';
import type { HandTracker, TrackedFrame } from '../tracking/tracker';
import type { LandmarkerHandle } from './landmarker';
import type { LumaSampler, MotionSensor } from './sensors';

export interface SourceFrame {
  observations: HandObservation[];
  /** Model time for this frame, when a model ran. */
  inferenceMs: number | null;
  /** The frame's own timestamp. */
  t: number;
}

export interface FrameSource {
  readonly kind: 'camera' | 'replay';
  /** Picture width divided by height. */
  aspect(): number;
  /** The newest frame not yet handed out, or null when nothing new has arrived. */
  poll(now: number): SourceFrame | null;
  /** True when the source has nothing more to give (a recording that has played through). */
  readonly ended: boolean;
}

export class CameraSource implements FrameSource {
  readonly kind = 'camera' as const;
  readonly ended = false;
  private lastVideoTime = -1;
  private lastStamp = 0;
  private skip = false;
  private slowFrames = 0;
  /** True while every other frame is being skipped because the model cannot keep up. */
  halved = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly landmarker: LandmarkerHandle,
  ) {}

  aspect(): number {
    return this.video.videoHeight > 0 ? this.video.videoWidth / this.video.videoHeight : 4 / 3;
  }

  poll(now: number): SourceFrame | null {
    const video = this.video;
    if (video.readyState < 2 || video.videoWidth === 0 || video.paused) return null;
    // The screen redraws faster than the camera delivers frames.
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;
    if (this.halved) {
      this.skip = !this.skip;
      if (this.skip) return null;
    }
    // The model requires strictly increasing timestamps.
    const stamp = Math.max(this.lastStamp + 1, Math.round(now));
    this.lastStamp = stamp;
    const started = performance.now();
    let observations: HandObservation[] = [];
    try {
      observations = this.landmarker.detect(video, stamp);
    } catch {
      observations = [];
    }
    const inferenceMs = performance.now() - started;
    // Sustained slowness switches to half rate; sustained speed switches back.
    this.slowFrames = Math.max(0, Math.min(60, this.slowFrames + (inferenceMs > (this.halved ? 24 : 42) ? 1 : -1)));
    if (!this.halved && this.slowFrames >= 20) this.halved = true;
    else if (this.halved && this.slowFrames === 0) this.halved = false;
    return { observations, inferenceMs, t: now };
  }
}

export class ReplaySource implements FrameSource {
  readonly kind = 'replay' as const;
  private readonly cursor: ReplayCursor;
  private startedAt: number | null = null;

  constructor(
    private readonly recording: LandmarkRecording,
    loop = false,
  ) {
    this.cursor = new ReplayCursor(recording, loop);
  }

  get ended(): boolean {
    return this.cursor.finished;
  }

  aspect(): number {
    return this.recording.aspect;
  }

  poll(now: number): SourceFrame | null {
    if (this.startedAt === null) this.startedAt = now;
    const frame = this.cursor.advance(now - this.startedAt);
    return frame ? { observations: frameObservations(frame), inferenceMs: null, t: now } : null;
  }
}

export interface PerfStats {
  /** Tracked frames per second over the last second. Null until a second has passed. */
  fps: number | null;
  /** Smoothed model time per frame, milliseconds. Null for a replay. */
  inferenceMs: number | null;
  /** Smoothed time for everything after the model: stabilising, geometry, quality. */
  pipelineMs: number | null;
  frames: number;
  halved: boolean;
}

export interface LoopOptions {
  source: FrameSource;
  tracker: HandTracker;
  expectedHand?: Hand | null;
  video?: HTMLVideoElement | null;
  luma?: LumaSampler | null;
  motion?: MotionSensor | null;
  onFrame(frame: TrackedFrame, perf: PerfStats, observations: HandObservation[]): void;
  onEnded?(): void;
}

export class TrackingLoop {
  private request = 0;
  private running = false;
  private stamps: number[] = [];
  private inferenceMs: number | null = null;
  private pipelineMs: number | null = null;
  private frames = 0;
  private fpsSamples: number[] = [];
  private inferenceSum = 0;
  private inferenceCount = 0;

  constructor(private readonly options: LoopOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.request = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.request);
  }

  /** Session-long averages, for the stored record. */
  averages(): { fps: number | null; inferenceMs: number | null } {
    const fps = this.fpsSamples.length > 0 ? this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length : null;
    return {
      fps: fps === null ? null : Math.round(fps * 10) / 10,
      inferenceMs: this.inferenceCount > 0 ? Math.round((this.inferenceSum / this.inferenceCount) * 10) / 10 : null,
    };
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const { source, tracker, expectedHand, video, luma, motion, onFrame, onEnded } = this.options;
    const next = source.poll(now);
    if (next) {
      this.frames += 1;
      this.stamps.push(now);
      while (this.stamps.length > 0 && now - this.stamps[0] > 1000) this.stamps.shift();
      const fps = this.frames > 15 && this.stamps.length > 1 ? ((this.stamps.length - 1) * 1000) / (now - this.stamps[0]) : null;
      if (fps !== null && this.frames % 15 === 0) this.fpsSamples.push(fps);
      if (next.inferenceMs !== null) {
        this.inferenceMs = this.inferenceMs === null ? next.inferenceMs : this.inferenceMs + 0.1 * (next.inferenceMs - this.inferenceMs);
        this.inferenceSum += next.inferenceMs;
        this.inferenceCount += 1;
      }
      const started = performance.now();
      const frame = tracker.update(next.observations, next.t, {
        aspect: source.aspect(),
        expectedHand: expectedHand ?? null,
        luma: video && luma ? luma.sample(video, now) : null,
        deviceRotation: motion?.rotationRate ?? null,
        fps,
      });
      const spent = performance.now() - started;
      this.pipelineMs = this.pipelineMs === null ? spent : this.pipelineMs + 0.1 * (spent - this.pipelineMs);
      onFrame(
        frame,
        {
          fps,
          inferenceMs: this.inferenceMs,
          pipelineMs: this.pipelineMs,
          frames: this.frames,
          halved: source instanceof CameraSource ? source.halved : false,
        },
        next.observations,
      );
    }
    if (source.ended) {
      this.running = false;
      onEnded?.();
      return;
    }
    this.request = requestAnimationFrame(this.tick);
  };
}
