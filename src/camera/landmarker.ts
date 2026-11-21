/**
 * The hand-tracking model: MediaPipe Hand Landmarker, running in this page.
 *
 * Why this model: it is an established, openly documented landmark model that runs
 * in a browser on a phone or a laptop without a server, returns the 21 standard
 * hand landmarks in picture and in 3-D "world" coordinates, and reports a left/right
 * label. No model is trained in this project.
 *
 * What it does not give: a per-landmark confidence. The only confidence it exposes
 * through this API is the score of its left/right label. Everything else called
 * "quality" in this codebase is a geometric check computed from the landmarks, and
 * is labelled as such.
 *
 * Which hand: the model's own documentation says its "Left"/"Right" label names
 * the person's actual hand when it is given an unmirrored picture, which is what
 * this app gives it (the mirror view on screen is a display choice only). That was
 * checked here against public sample photographs; the tracker also checks it
 * against the hand's shape on every session and corrects itself if they disagree
 * (see SideResolver in tracking/tracker.ts).
 *
 * Offline: the WebAssembly runtime is served by this app from /mediapipe/wasm. The
 * model file is looked for in three places, in order:
 *   1. this app's own /mediapipe/models folder (put there by `npm run fetch-model`);
 *   2. the browser's cache storage, where it is kept after the first download;
 *   3. Google's public model storage.
 * After the first successful load on a device, no connection is needed.
 */
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandObservation } from '../tracking/stabiliser';
import { CameraError } from './cameraStream';

const WASM_BASE = '/mediapipe/wasm';
export const LOCAL_MODEL_URL = '/mediapipe/models/hand_landmarker.task';
export const REMOTE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODEL_CACHE = 'ntact-models-v1';

export type Delegate = 'GPU' | 'CPU';
export type ModelSource = 'app' | 'device-cache' | 'network';

export interface LandmarkerHandle {
  delegate: Delegate;
  /** Where the model file came from this time. */
  source: ModelSource;
  /** Milliseconds from asking for the model to it being ready. */
  loadMs: number;
  /** Runs the model on the current video frame. `timestamp` must increase from call to call. */
  detect(video: HTMLVideoElement, timestamp: number): HandObservation[];
}

/** The model file's bytes from this app or from the device's cache, or null when neither has it. */
async function storedModel(): Promise<{ bytes: Uint8Array; source: ModelSource } | null> {
  try {
    const response = await fetch(LOCAL_MODEL_URL);
    // A development server answers an unknown path with the app's own HTML page, not a 404.
    const type = response.headers.get('content-type') ?? '';
    if (response.ok && !type.includes('text/html')) {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 1_000_000) return { bytes: new Uint8Array(buffer), source: 'app' };
    }
  } catch {
    // Not served by the app. Try the device's cache.
  }
  try {
    if (typeof caches === 'undefined') return null;
    const cached = await (await caches.open(MODEL_CACHE)).match(REMOTE_MODEL_URL);
    if (!cached) return null;
    const buffer = await cached.arrayBuffer();
    return buffer.byteLength > 1_000_000 ? { bytes: new Uint8Array(buffer), source: 'device-cache' } : null;
  } catch {
    return null;
  }
}

/** Keeps a copy of the downloaded model on this device, so the next session needs no connection. */
function rememberModel(): void {
  if (typeof caches === 'undefined') return;
  caches
    .open(MODEL_CACHE)
    .then(async (cache) => {
      if (!(await cache.match(REMOTE_MODEL_URL))) await cache.add(REMOTE_MODEL_URL);
    })
    .catch(() => undefined);
}

/** Whether the model is already available without a connection. Does not download anything. */
export async function modelAvailableOffline(): Promise<ModelSource | null> {
  return (await storedModel())?.source ?? null;
}

let pending: Promise<LandmarkerHandle> | null = null;

/** Loaded once per page and reused. A failed load is forgotten so that it can be tried again. */
export function loadLandmarker(): Promise<LandmarkerHandle> {
  if (!pending) {
    pending = (async (): Promise<LandmarkerHandle> => {
      const started = typeof performance !== 'undefined' ? performance.now() : 0;
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const stored = await storedModel();
      const model = stored ? { modelAssetBuffer: stored.bytes } : { modelAssetPath: REMOTE_MODEL_URL };

      const create = (delegate: Delegate): Promise<HandLandmarker> =>
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { ...model, delegate },
          runningMode: 'VIDEO',
          // Two, so that a second hand in the picture is seen and deliberately ignored rather than confused with the first.
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

      let landmarker: HandLandmarker;
      let delegate: Delegate = 'GPU';
      try {
        landmarker = await create('GPU');
      } catch {
        // No usable graphics acceleration: slower, but it works.
        delegate = 'CPU';
        landmarker = await create('CPU');
      }
      if (!stored) rememberModel();

      // The first run compiles the model for the graphics processor and takes a second or two.
      // It is spent here, on a blank picture, rather than on the first frame of a session.
      let warmStamp = 0;
      try {
        const blank = document.createElement('canvas');
        blank.width = 64;
        blank.height = 64;
        blank.getContext('2d')?.fillRect(0, 0, 64, 64);
        warmStamp = 1;
        landmarker.detectForVideo(blank, warmStamp);
      } catch {
        // Not every browser will run it on a blank canvas. The first real frame then pays for it instead.
      }

      return {
        delegate,
        source: stored?.source ?? 'network',
        loadMs: (typeof performance !== 'undefined' ? performance.now() : 0) - started,
        detect(video, timestamp) {
          const result = landmarker.detectForVideo(video, timestamp);
          const labels = result.handedness ?? result.handednesses ?? [];
          const hands: HandObservation[] = [];
          (result.landmarks ?? []).forEach((image, index) => {
            if (!image || image.length !== 21) return;
            const world = result.worldLandmarks?.[index];
            const category = labels[index]?.[0];
            hands.push({
              image: image.map((point) => ({ x: point.x, y: point.y, z: point.z })),
              world: world && world.length === 21 ? world.map((point) => ({ x: point.x, y: point.y, z: point.z })) : null,
              label: category?.categoryName === 'Left' || category?.categoryName === 'Right' ? category.categoryName : null,
              score: typeof category?.score === 'number' ? category.score : null,
            });
          });
          return hands;
        },
      };
    })().catch((error: unknown) => {
      pending = null;
      throw new CameraError('model', error instanceof Error ? error.message : String(error));
    });
  }
  return pending;
}
