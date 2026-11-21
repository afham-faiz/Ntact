/**
 * The camera layer without a camera: where landmarks land on the screen, and the
 * life cycle of the camera stream against a pretend `navigator.mediaDevices`.
 *
 * This pins down the arithmetic and the order of calls. It cannot show how a
 * particular phone's browser behaves: see docs/MOBILE_TESTING.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFINITIONS } from '../src/assessment/definitions';
import { CameraError, CameraStream, cameraSupport, classifyCameraError } from '../src/camera/cameraStream';
import { toPicture, toScreen, visibleRegion, type Viewport } from '../src/camera/viewport';
import { defaultFacing, setupAdvice } from '../src/features/movement/words';

describe('landmarks on the screen', () => {
  const landscape: Viewport = { width: 800, height: 600, sourceWidth: 1280, sourceHeight: 720, fit: 'cover', mirrored: false };

  it('puts the middle of the picture in the middle of the box', () => {
    expect(toScreen({ x: 0.5, y: 0.5 }, landscape)).toEqual({ x: 400, y: 300 });
    expect(toScreen({ x: 0.5, y: 0.5 }, { ...landscape, fit: 'contain' })).toEqual({ x: 400, y: 300 });
  });

  it('crops a wide picture shown in a narrower box', () => {
    // 1280 by 720 scaled to fill a height of 600 is 1066.7 wide; 133.3 is cropped from each side.
    const left = toScreen({ x: 0, y: 0 }, landscape);
    expect(left.x).toBeCloseTo(-133.33, 1);
    expect(left.y).toBeCloseTo(0, 6);
    const region = visibleRegion(landscape);
    expect(region.left).toBeCloseTo(0.125, 3);
    expect(region.right).toBeCloseTo(0.875, 3);
    expect(region.top).toBeCloseTo(0, 6);
    expect(region.bottom).toBeCloseTo(1, 6);
  });

  it('letterboxes with contain, showing the whole picture', () => {
    const contain: Viewport = { ...landscape, fit: 'contain' };
    const top = toScreen({ x: 0, y: 0 }, contain);
    expect(top.x).toBeCloseTo(0, 6);
    expect(top.y).toBeCloseTo(75, 6);
    expect(visibleRegion(contain)).toEqual({ left: 0, right: 1, top: 0, bottom: 1 });
  });

  it('flips left and right for a mirrored selfie view, and only left and right', () => {
    const mirrored: Viewport = { ...landscape, mirrored: true };
    const plain = toScreen({ x: 0.3, y: 0.4 }, landscape);
    const flipped = toScreen({ x: 0.3, y: 0.4 }, mirrored);
    expect(flipped.x).toBeCloseTo(landscape.width - plain.x, 6);
    expect(flipped.y).toBeCloseTo(plain.y, 6);
  });

  it('handles a phone held upright: a tall picture in a tall box, and in a wide one', () => {
    const portrait: Viewport = { width: 390, height: 700, sourceWidth: 720, sourceHeight: 1280, fit: 'cover', mirrored: false };
    const corner = toScreen({ x: 1, y: 1 }, portrait);
    expect(corner.y).toBeCloseTo(700, 4);
    expect(corner.x).toBeGreaterThanOrEqual(390);
    // The same upright picture in a landscape box: the top and bottom are cropped instead.
    const turned: Viewport = { ...portrait, width: 844, height: 390 };
    const region = visibleRegion(turned);
    expect(region.left).toBeCloseTo(0, 6);
    expect(region.right).toBeCloseTo(1, 6);
    expect(region.bottom - region.top).toBeCloseTo((390 / 844) * (720 / 1280), 3);
  });

  it('maps back from the screen to the picture exactly', () => {
    for (const viewport of [landscape, { ...landscape, mirrored: true }, { ...landscape, fit: 'contain' as const }, { width: 390, height: 700, sourceWidth: 720, sourceHeight: 1280, fit: 'cover' as const, mirrored: true }]) {
      for (const point of [
        { x: 0.1, y: 0.9 },
        { x: 0.5, y: 0.5 },
        { x: 0.83, y: 0.27 },
      ]) {
        const back = toPicture(toScreen(point, viewport), viewport);
        expect(back.x).toBeCloseTo(point.x, 9);
        expect(back.y).toBeCloseTo(point.y, 9);
      }
    }
  });

  it('does not divide by zero before the camera has reported its size', () => {
    const unknown: Viewport = { ...landscape, sourceWidth: 0, sourceHeight: 0 };
    const point = toScreen({ x: 0.5, y: 0.5 }, unknown);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});

// ---------- A pretend camera ----------

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  label: string;
  getSettings(): MediaTrackSettings;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  end(): void;
}

function fakeTrack(settings: MediaTrackSettings, label = 'Fake camera'): FakeTrack {
  const listeners = new Set<() => void>();
  return {
    stop: vi.fn(),
    label,
    getSettings: () => settings,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    end: () => listeners.forEach((listener) => listener()),
  };
}

const streamOf = (track: FakeTrack) => ({ getTracks: () => [track], getVideoTracks: () => [track] }) as unknown as MediaStream;

describe('camera stream', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let video: HTMLVideoElement;
  let hidden = false;

  beforeEach(() => {
    getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices: async () => [] } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    video = document.createElement('video');
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'mediaDevices');
    Reflect.deleteProperty(document, 'hidden');
    vi.useRealTimers();
  });

  it('asks for the camera it was told to prefer, at a sensible size, without sound', async () => {
    const track = fakeTrack({ facingMode: 'environment', width: 1280, height: 720, frameRate: 30 });
    getUserMedia.mockResolvedValue(streamOf(track));
    const camera = new CameraStream();
    const info = await camera.open(video, { facing: 'environment' });

    const constraints = getUserMedia.mock.calls[0][0];
    expect(constraints.audio).toBe(false);
    expect(constraints.video.facingMode).toEqual({ ideal: 'environment' });
    expect(constraints.video.width).toEqual({ ideal: 1280 });
    expect(info).toMatchObject({ facing: 'environment', facingConfirmed: true, frameRate: 30, label: 'Fake camera' });
    expect(camera.mirrored).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    camera.stop();
  });

  it('mirrors the front camera, and treats a webcam that reports no facing as a front camera', async () => {
    getUserMedia.mockResolvedValue(streamOf(fakeTrack({ width: 640, height: 480 })));
    const camera = new CameraStream();
    const info = await camera.open(video, { facing: 'user' });
    expect(info.facing).toBe('user');
    expect(info.facingConfirmed).toBe(false);
    expect(camera.mirrored).toBe(true);
    camera.stop();
  });

  it('believes what was opened over what was asked for', async () => {
    // A laptop has no rear camera: asked for "environment", the browser hands back the front one.
    getUserMedia.mockResolvedValue(streamOf(fakeTrack({ facingMode: 'user' })));
    const camera = new CameraStream();
    const info = await camera.open(video, { facing: 'environment' });
    expect(info.facing).toBe('user');
    expect(camera.mirrored).toBe(true);
    camera.stop();
  });

  it('switches cameras: the old one is released before the other is opened', async () => {
    const front = fakeTrack({ facingMode: 'user' });
    const rear = fakeTrack({ facingMode: 'environment' });
    getUserMedia.mockResolvedValueOnce(streamOf(front)).mockResolvedValueOnce(streamOf(rear));
    const camera = new CameraStream();
    await camera.open(video, { facing: 'user' });
    const info = await camera.flip();
    expect(front.stop).toHaveBeenCalled();
    expect(getUserMedia.mock.calls[1][0].video.facingMode).toEqual({ ideal: 'environment' });
    expect(info.facing).toBe('environment');
    expect(camera.mirrored).toBe(false);
    camera.stop();
    expect(rear.stop).toHaveBeenCalled();
  });

  it('asks again with no preferences when the camera refuses the size it was asked for', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('too big'), { name: 'OverconstrainedError' })).mockResolvedValueOnce(streamOf(fakeTrack({})));
    const camera = new CameraStream();
    await camera.open(video, { facing: 'user' });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: false, video: true });
    camera.stop();
  });

  it('says why the camera could not be opened', async () => {
    const cases: [string, string][] = [
      ['NotAllowedError', 'denied'],
      ['SecurityError', 'denied'],
      ['NotReadableError', 'busy'],
      ['AbortError', 'busy'],
      ['SomethingElse', 'failed'],
    ];
    for (const [name, reason] of cases) {
      getUserMedia.mockRejectedValueOnce(Object.assign(new Error(name), { name }));
      await expect(new CameraStream().open(video, { facing: 'user' })).rejects.toMatchObject({ reason });
    }
    getUserMedia.mockRejectedValue(Object.assign(new Error('none'), { name: 'NotFoundError' }));
    await expect(new CameraStream().open(video, { facing: 'user' })).rejects.toMatchObject({ reason: 'no-camera' });
    expect(classifyCameraError(new CameraError('model')).reason).toBe('model');
  });

  it('reports a page that cannot ask for a camera at all', () => {
    expect(cameraSupport()).toEqual({ supported: true });
    Reflect.deleteProperty(navigator, 'mediaDevices');
    expect(cameraSupport()).toEqual({ supported: false, reason: 'unsupported' });
  });

  it('lets go of a camera that arrives after the session was closed', async () => {
    const track = fakeTrack({});
    let release: (stream: MediaStream) => void = () => undefined;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((resolve) => (release = resolve)));
    const camera = new CameraStream();
    const opening = camera.open(video, { facing: 'user' });
    camera.stop();
    release(streamOf(track));
    await expect(opening).rejects.toBeInstanceOf(CameraError);
    expect(track.stop).toHaveBeenCalled();
  });

  it('switches the camera off in the background and brings it back afterwards', async () => {
    const first = fakeTrack({ facingMode: 'user' });
    const second = fakeTrack({ facingMode: 'user' });
    getUserMedia.mockResolvedValueOnce(streamOf(first)).mockResolvedValueOnce(streamOf(second));
    const camera = new CameraStream();
    const events: string[] = [];
    camera.subscribe((event) => events.push(event));
    await camera.open(video, { facing: 'user' });

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(first.stop).toHaveBeenCalled();
    expect(camera.active).toBe(false);
    expect(events).toEqual(['interrupted']);

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(events).toEqual(['interrupted', 'resumed']));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(camera.active).toBe(true);
    camera.stop();
    expect(second.stop).toHaveBeenCalled();
  });

  it('tries once to get the camera back when the system takes it away', async () => {
    vi.useFakeTimers();
    const first = fakeTrack({});
    const second = fakeTrack({});
    getUserMedia.mockResolvedValueOnce(streamOf(first)).mockResolvedValueOnce(streamOf(second));
    const camera = new CameraStream();
    const events: string[] = [];
    camera.subscribe((event) => events.push(event));
    await camera.open(video, { facing: 'user' });

    first.end();
    expect(events).toEqual(['interrupted']);
    await vi.advanceTimersByTimeAsync(900);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['interrupted', 'resumed']);
    camera.stop();
  });

  it('reports failure when the camera cannot be brought back', async () => {
    vi.useFakeTimers();
    const first = fakeTrack({});
    getUserMedia.mockResolvedValueOnce(streamOf(first)).mockRejectedValue(Object.assign(new Error('gone'), { name: 'NotReadableError' }));
    const camera = new CameraStream();
    const events: string[] = [];
    camera.subscribe((event) => events.push(event));
    await camera.open(video, { facing: 'user' });
    first.end();
    await vi.advanceTimersByTimeAsync(900);
    expect(events).toEqual(['interrupted', 'failed']);
    camera.stop();
  });

  it('does nothing after it has been stopped', async () => {
    const track = fakeTrack({});
    getUserMedia.mockResolvedValue(streamOf(track));
    const camera = new CameraStream();
    await camera.open(video, { facing: 'user' });
    camera.stop();
    camera.stop();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(camera.info).toBeNull();
  });
});

describe('camera setup advice', () => {
  it('asks for the rear camera when the phone is pointed at the hand, and the front one otherwise', () => {
    expect(defaultFacing('laptop')).toBe('user');
    expect(defaultFacing('phone-propped')).toBe('user');
    expect(defaultFacing('phone-held')).toBe('environment');
    expect(defaultFacing('phone-assisted')).toBe('environment');
  });

  it('says plainly when a hand-held camera is not ideal for an assessment', () => {
    expect(setupAdvice(DEFINITIONS['composite-fist'], 'index', 'phone-held').caution).toBeNull();
    expect(setupAdvice(DEFINITIONS.tabletop, 'index', 'phone-held').caution).toMatch(/steadier/);
    expect(setupAdvice(DEFINITIONS.tabletop, 'index', 'phone-propped').caution).toBeNull();
  });

  it('describes where to put the hand for every way of holding the camera', () => {
    for (const setup of ['laptop', 'phone-propped', 'phone-held', 'phone-assisted'] as const) {
      for (const id of ['composite-fist', 'hook-fist', 'tabletop', 'thumb-opposition', 'digit-flexion'] as const) {
        for (const finger of ['index', 'middle', 'ring', 'little'] as const) {
          const advice = setupAdvice(DEFINITIONS[id], finger, setup);
          expect(advice.place.length, `${id} ${finger} ${setup}`).toBeGreaterThan(30);
          expect(DEFINITIONS[id].views.acceptable).toContain(advice.view);
        }
      }
    }
    expect(setupAdvice(DEFINITIONS.tabletop, 'index', 'laptop').view).toBe('ulnar');
    expect(setupAdvice(DEFINITIONS.tabletop, 'index', 'laptop').place).toMatch(/karate chop/);
    expect(setupAdvice(DEFINITIONS.tabletop, 'index', 'phone-held').place).toMatch(/little-finger edge on a table, thumb on top/);
    expect(setupAdvice(DEFINITIONS['hook-fist'], 'index', 'laptop').view).toBe('palmar');
  });
});
