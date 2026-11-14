/**
 * Hand tracking from this device's camera.
 *
 * Privacy: the video never leaves the device. Frames go from the camera to a model
 * running in this browser tab (MediaPipe Hand Landmarker, WebAssembly). Nothing is
 * recorded, stored or uploaded; only the finished session's numbers are saved.
 *
 * Two things are fetched the first time, then cached by the browser:
 *   - the WebAssembly runtime, served by this app from /mediapipe/wasm
 *     (copied out of node_modules by scripts/copy-mediapipe.mjs);
 *   - the hand model (about 8 MB), from Google's public model storage.
 *
 * Works in Chrome, Edge and Safari, including on iPhone, on https:// or localhost.
 */
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandFrame } from '../domain/exercise';

const WASM_BASE = '/mediapipe/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/**
 * unsupported  the browser has no camera API
 * insecure     not on https:// or localhost, so the browser withholds the camera
 * denied       the person (or a site setting) refused the camera
 * no-camera    no camera was found
 * busy         another app is using the camera
 * model        the hand-tracking model could not be loaded (usually no network)
 * failed       anything else
 */
export type CameraFailure = 'unsupported' | 'insecure' | 'denied' | 'no-camera' | 'busy' | 'model' | 'failed';

export class CameraError extends Error {
  readonly reason: CameraFailure;

  constructor(reason: CameraFailure, detail?: string) {
    super(detail ? `Camera unavailable (${reason}): ${detail}` : `Camera unavailable (${reason}).`);
    this.name = 'CameraError';
    this.reason = reason;
  }
}

let landmarkerPromise: Promise<HandLandmarker> | null = null;

/** Loaded once per page and reused. A failed load is forgotten so it can be tried again. */
function loadLandmarker(): Promise<HandLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const create = (delegate: 'GPU' | 'CPU') =>
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try {
        return await create('GPU');
      } catch {
        // Older graphics drivers: slower, but it works.
        return await create('CPU');
      }
    })().catch((error: unknown) => {
      landmarkerPromise = null;
      throw new CameraError('model', error instanceof Error ? error.message : String(error));
    });
  }
  return landmarkerPromise;
}

function classify(error: unknown): CameraError {
  if (error instanceof CameraError) return error;
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  const detail = error instanceof Error ? error.message : String(error);
  if (name === 'NotAllowedError' || name === 'SecurityError') return new CameraError('denied', detail);
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new CameraError('no-camera', detail);
  if (name === 'NotReadableError' || name === 'AbortError') return new CameraError('busy', detail);
  return new CameraError('failed', detail);
}

/** Whether this page could ask for the camera at all. Does not ask. */
export function cameraSupport(): { supported: true } | { supported: false; reason: 'unsupported' | 'insecure' } {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return { supported: false, reason: 'insecure' };
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return { supported: false, reason: 'unsupported' };
  return { supported: true };
}

export class CameraHandSource {
  readonly kind = 'camera' as const;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;
  private lastStamp = 0;
  private lastFrame: HandFrame | null = null;
  private stopped = false;

  /** Asks for the camera, loads the model, and starts the video playing in `video`. */
  async start(video: HTMLVideoElement): Promise<void> {
    const support = cameraSupport();
    if (!support.supported) throw new CameraError(support.reason);
    this.stopped = false;

    // Start the model loading while the permission prompt is on screen.
    const model = loadLandmarker();
    model.catch(() => undefined);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
      });
    } catch (error) {
      throw classify(error);
    }
    if (this.stopped) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.stream = stream;
    this.video = video;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    try {
      await video.play();
      this.landmarker = await model;
    } catch (error) {
      this.stop();
      throw classify(error);
    }
    if (this.stopped) this.stop();
  }

  /** The hand in the current video frame, or null when no hand is in view. */
  read(now: number): HandFrame | null {
    const video = this.video;
    const landmarker = this.landmarker;
    if (!video || !landmarker || video.readyState < 2 || video.videoWidth === 0) return null;
    // The screen redraws faster than the camera delivers frames: reuse the last answer.
    if (video.currentTime === this.lastVideoTime) return this.lastFrame;
    this.lastVideoTime = video.currentTime;
    // The model requires strictly increasing timestamps.
    const stamp = Math.max(this.lastStamp + 1, Math.round(now));
    this.lastStamp = stamp;
    try {
      const result = landmarker.detectForVideo(video, stamp);
      const image = result.landmarks[0];
      this.lastFrame = image && image.length === 21 ? { image, world: result.worldLandmarks[0] ?? null } : null;
    } catch {
      this.lastFrame = null;
    }
    return this.lastFrame;
  }

  /** Turns the camera off. The camera light goes out. */
  stop(): void {
    this.stopped = true;
    if (this.stream) for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = null;
    this.landmarker = null;
    this.lastFrame = null;
    this.lastVideoTime = -1;
  }
}
