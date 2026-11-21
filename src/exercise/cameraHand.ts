/**
 * Hand tracking for the guided physio exercises.
 *
 * A thin adapter: the exercises' repetition counter asks for "the hand in this
 * frame", and this answers from the same camera, model and tracking pipeline the
 * movement assessments use (src/camera, src/tracking). There is one tracking
 * system in the app, not two.
 *
 * Privacy: the video never leaves the device. Nothing is recorded, stored or
 * uploaded; only the finished session's numbers are saved.
 */
import { CameraError, CameraStream, cameraSupport, classifyCameraError, type CameraFailure } from '../camera/cameraStream';
import { loadLandmarker } from '../camera/landmarker';
import { CameraSource } from '../camera/trackingLoop';
import type { HandFrame } from '../domain/exercise';
import { HandTracker } from '../tracking/tracker';

export { CameraError, cameraSupport };
export type { CameraFailure };

export class CameraHandSource {
  readonly kind = 'camera' as const;
  private readonly stream = new CameraStream();
  private readonly tracker = new HandTracker();
  private source: CameraSource | null = null;
  private lastFrame: HandFrame | null = null;
  private stopped = false;

  /** Asks for the camera, loads the model, and starts the video playing in `video`. */
  async start(video: HTMLVideoElement): Promise<void> {
    this.stopped = false;
    // Start the model loading while the permission prompt is on screen.
    const model = loadLandmarker();
    model.catch(() => undefined);

    await this.stream.open(video, { facing: 'user', width: 960, height: 720 });
    try {
      const landmarker = await model;
      if (!this.stopped) this.source = new CameraSource(video, landmarker);
    } catch (error) {
      this.stop();
      throw classifyCameraError(error);
    }
    if (this.stopped) this.stop();
  }

  /** The hand in the current video frame, smoothed, or null when no hand is in view. */
  read(now: number): HandFrame | null {
    const next = this.source?.poll(now);
    // The screen redraws faster than the camera delivers frames: reuse the last answer.
    if (!next || !this.source) return this.lastFrame;
    const frame = this.tracker.update(next.observations, next.t, { aspect: this.source.aspect() });
    this.lastFrame = frame.image ? { image: frame.image, world: frame.world } : null;
    return this.lastFrame;
  }

  /** Turns the camera off. The camera light goes out. */
  stop(): void {
    this.stopped = true;
    this.stream.stop();
    this.source = null;
    this.lastFrame = null;
    this.tracker.reset();
  }
}
