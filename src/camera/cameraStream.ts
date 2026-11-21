/**
 * The device camera: asking for it, choosing front or rear, noticing when it is
 * interrupted, and always letting go of it.
 *
 * Privacy: frames go from the camera to a model running in this page. Nothing here
 * records, stores or sends a picture anywhere.
 *
 * Browser differences this file allows for (none of them verified on a physical
 * phone from this codebase; see docs/MOBILE_TESTING.md):
 *  - `facingMode` is a request, not a guarantee. What was actually opened is read
 *    back from the track's settings, and falls back to what was asked for.
 *  - iOS Safari only plays camera video inline when the element is muted and has
 *    `playsinline`, and it stops the camera when the page goes to the background.
 *  - A phone held upright delivers a portrait frame (height greater than width);
 *    turning it changes the frame's size mid-stream. Nothing caches the size.
 *  - Desktop webcams usually report no facing mode at all; they are treated as
 *    front cameras, since the person is looking at the screen.
 */

/**
 * unsupported  the browser has no camera API
 * insecure     not on https:// or localhost, so the browser withholds the camera
 * denied       the person (or a site setting) refused the camera
 * no-camera    no camera was found
 * busy         another app is using the camera
 * model        the hand-tracking model could not be loaded
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

export function classifyCameraError(error: unknown): CameraError {
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

export type Facing = 'user' | 'environment';

export interface CameraInfo {
  /** What was opened, as far as the browser says. */
  facing: Facing;
  /** True when the browser confirmed the facing; false when it is assumed from the request. */
  facingConfirmed: boolean;
  width: number;
  height: number;
  frameRate: number | null;
  label: string;
}

export interface CameraRequest {
  facing: Facing;
  /** Ideal frame size. The browser picks the nearest the camera offers. */
  width?: number;
  height?: number;
}

type Listener = (event: 'interrupted' | 'resumed' | 'failed') => void;

export class CameraStream {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private request: CameraRequest = { facing: 'user' };
  private stopped = true;
  private suspended = false;
  private opening: Promise<CameraInfo> | null = null;
  private readonly listeners = new Set<Listener>();
  private current: CameraInfo | null = null;

  get info(): CameraInfo | null {
    return this.current;
  }

  get active(): boolean {
    return this.stream !== null && !this.suspended;
  }

  /** The selfie view is shown flipped, the way a mirror would show it. The rear view is not. */
  get mirrored(): boolean {
    return (this.current?.facing ?? this.request.facing) === 'user';
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: 'interrupted' | 'resumed' | 'failed'): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  /** Asks for the camera and starts it playing in `video`. Rejects with a CameraError that says why. */
  async open(video: HTMLVideoElement, request: CameraRequest): Promise<CameraInfo> {
    const support = cameraSupport();
    if (!support.supported) throw new CameraError(support.reason);
    this.stopped = false;
    this.suspended = false;
    this.video = video;
    this.request = request;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    return this.acquire();
  }

  /** Switches between the front and rear cameras. Resolves with what was actually opened. */
  async flip(): Promise<CameraInfo> {
    const next: Facing = (this.current?.facing ?? this.request.facing) === 'user' ? 'environment' : 'user';
    this.request = { ...this.request, facing: next };
    this.release();
    return this.acquire();
  }

  /** Turns the camera off. The camera light goes out. Safe to call more than once. */
  stop(): void {
    this.stopped = true;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.release();
    this.video = null;
    this.current = null;
  }

  private release(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.removeEventListener?.('ended', this.onEnded);
        track.stop();
      }
    }
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
  }

  private acquire(): Promise<CameraInfo> {
    if (this.opening) return this.opening;
    this.opening = this.acquireOnce().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async acquireOnce(): Promise<CameraInfo> {
    const video = this.video;
    if (!video) throw new CameraError('failed', 'No video element.');
    const { facing, width = 1280, height = 720 } = this.request;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing }, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 } },
      });
    } catch (error) {
      const classified = classifyCameraError(error);
      // Some cameras refuse the size or rate that was asked for. Ask again with no preferences before giving up.
      if (classified.reason !== 'no-camera') throw classified;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } catch (second) {
        throw classifyCameraError(second);
      }
    }
    if (this.stopped || this.video !== video) {
      for (const track of stream.getTracks()) track.stop();
      throw new CameraError('failed', 'Stopped while starting.');
    }

    this.stream = stream;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    try {
      await video.play();
    } catch (error) {
      this.release();
      throw classifyCameraError(error);
    }
    if (this.stopped) {
      this.release();
      throw new CameraError('failed', 'Stopped while starting.');
    }

    const track = stream.getVideoTracks?.()[0];
    track?.addEventListener?.('ended', this.onEnded);
    const settings = track?.getSettings?.() ?? {};
    const reported = settings.facingMode === 'user' || settings.facingMode === 'environment' ? settings.facingMode : null;
    this.current = {
      facing: reported ?? facing,
      facingConfirmed: reported !== null,
      width: video.videoWidth || settings.width || 0,
      height: video.videoHeight || settings.height || 0,
      frameRate: typeof settings.frameRate === 'number' ? settings.frameRate : null,
      label: track?.label ?? '',
    };
    return this.current;
  }

  /** The camera was taken away: unplugged, claimed by another app, or stopped by the system. Try once to get it back. */
  private onEnded = (): void => {
    if (this.stopped || this.suspended) return;
    this.release();
    this.emit('interrupted');
    window.setTimeout(() => {
      if (this.stopped || this.suspended || this.stream) return;
      this.acquire().then(
        () => this.emit('resumed'),
        () => this.emit('failed'),
      );
    }, 800);
  };

  /**
   * In the background the camera is switched off: it saves the battery, and a
   * camera running behind a hidden page is not something anyone expects. It comes
   * back when the page does.
   */
  private onVisibility = (): void => {
    if (this.stopped) return;
    if (document.hidden) {
      if (!this.stream) return;
      this.suspended = true;
      this.release();
      this.emit('interrupted');
      return;
    }
    if (!this.suspended) return;
    this.suspended = false;
    this.acquire().then(
      () => this.emit('resumed'),
      () => this.emit('failed'),
    );
  };
}

/** How many cameras the device says it has. Labels are only filled in after permission has been given. */
export async function countCameras(): Promise<number> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput').length;
  } catch {
    return 0;
  }
}
