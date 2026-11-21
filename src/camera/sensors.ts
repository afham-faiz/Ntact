/**
 * Two small readings from the device that help decide whether a frame is worth
 * measuring: how bright the picture is, and whether the phone itself is moving.
 * Both are optional. Where a device does not offer one, it is simply absent.
 */

/** Mean brightness of the camera picture, 0 to 255, sampled a couple of times a second from a tiny copy of the frame. */
export class LumaSampler {
  private canvas: HTMLCanvasElement | null = null;
  private lastAt = -Infinity;
  private value: number | null = null;
  private broken = false;

  constructor(private readonly everyMs = 500) {}

  sample(video: HTMLVideoElement, now: number): number | null {
    if (this.broken || now - this.lastAt < this.everyMs || video.videoWidth === 0) return this.value;
    this.lastAt = now;
    try {
      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 32;
        this.canvas.height = 24;
      }
      const context = this.canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        this.broken = true;
        return null;
      }
      context.drawImage(video, 0, 0, 32, 24);
      const { data } = context.getImageData(0, 0, 32, 24);
      let sum = 0;
      for (let index = 0; index < data.length; index += 4) sum += 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
      this.value = sum / (data.length / 4);
    } catch {
      // A browser that will not let the frame be read: go without.
      this.broken = true;
      this.value = null;
    }
    return this.value;
  }
}

interface MotionPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/**
 * How fast the device is turning, from its gyroscope, in degrees per second.
 *
 * This is what lets a hand-held phone's own movement be told apart from the hand
 * moving: the camera cannot tell the two apart from one hand alone, but the phone
 * knows when it is being turned. Laptops have no such sensor; the reading is then null.
 */
export class MotionSensor {
  private rate: number | null = null;
  private listening = false;

  static get available(): boolean {
    return typeof window !== 'undefined' && typeof window.DeviceMotionEvent !== 'undefined';
  }

  /** iOS asks the person before sharing motion data, and only in response to a tap. */
  static get needsPermission(): boolean {
    return MotionSensor.available && typeof (window.DeviceMotionEvent as unknown as MotionPermission).requestPermission === 'function';
  }

  /** Call from a tap. Resolves true when motion readings will arrive. */
  async start(): Promise<boolean> {
    if (!MotionSensor.available) return false;
    try {
      const request = (window.DeviceMotionEvent as unknown as MotionPermission).requestPermission;
      if (typeof request === 'function' && (await request()) !== 'granted') return false;
    } catch {
      return false;
    }
    if (!this.listening) {
      window.addEventListener('devicemotion', this.onMotion);
      this.listening = true;
    }
    return true;
  }

  stop(): void {
    if (this.listening) window.removeEventListener('devicemotion', this.onMotion);
    this.listening = false;
    this.rate = null;
  }

  /** Null until a reading has arrived (and always on a device without a gyroscope). */
  get rotationRate(): number | null {
    return this.rate;
  }

  private onMotion = (event: DeviceMotionEvent): void => {
    const rotation = event.rotationRate;
    if (!rotation || rotation.alpha === null) return;
    const magnitude = Math.hypot(rotation.alpha ?? 0, rotation.beta ?? 0, rotation.gamma ?? 0);
    this.rate = this.rate === null ? magnitude : this.rate + 0.35 * (magnitude - this.rate);
  };
}

interface WakeLockLike {
  release(): Promise<void>;
}

/** Keeps the screen on during a session, where the browser allows it. Released when the session ends. */
export class ScreenAwake {
  private lock: WakeLockLike | null = null;

  async hold(): Promise<void> {
    try {
      const api = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } }).wakeLock;
      if (api && !this.lock) this.lock = await api.request('screen');
    } catch {
      // Not allowed (low battery, background tab). The session carries on.
    }
  }

  release(): void {
    this.lock?.release().catch(() => undefined);
    this.lock = null;
  }
}
