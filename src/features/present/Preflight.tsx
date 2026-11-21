/**
 * Preflight: a short check of the camera and the tracking model before a
 * demonstration, reporting only what was actually measured on this machine.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, Circle, WarningCircle } from '@phosphor-icons/react';
import { CameraError, CameraStream, type CameraFailure } from '../../camera/cameraStream';
import { loadLandmarker, modelAvailableOffline, type LandmarkerHandle } from '../../camera/landmarker';
import { LumaSampler } from '../../camera/sensors';
import { CameraSource } from '../../camera/trackingLoop';
import { Button, Spinner, cx } from '../../components/ui';
import { CAMERA_COPY } from '../movement/Runner';

type Step = 'pending' | 'running' | 'ok' | 'warn' | 'fail';

interface Line {
  key: string;
  title: string;
  state: Step;
  detail: string;
}

const START: Line[] = [
  { key: 'camera', title: 'Camera', state: 'pending', detail: 'Not checked yet' },
  { key: 'model', title: 'Hand-tracking model', state: 'pending', detail: 'Not checked yet' },
  { key: 'speed', title: 'Tracking speed', state: 'pending', detail: 'Not checked yet' },
  { key: 'light', title: 'Lighting', state: 'pending', detail: 'Not checked yet' },
  { key: 'offline', title: 'Works without a connection', state: 'pending', detail: 'Not checked yet' },
];

const MEASURE_MS = 2600;

export function Preflight({ className }: { className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [lines, setLines] = useState<Line[]>(START);
  const [running, setRunning] = useState(false);
  const [seeing, setSeeing] = useState(false);
  const cancel = useRef<(() => void) | null>(null);

  const set = useCallback((key: string, state: Step, detail: string) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, state, detail } : line)));
  }, []);

  const run = useCallback(async () => {
    const video = videoRef.current;
    if (!video || running) return;
    setRunning(true);
    setLines(START.map((line) => ({ ...line, state: 'pending', detail: 'Waiting' })));
    const camera = new CameraStream();
    let stopped = false;
    let frameRequest = 0;
    cancel.current = () => {
      stopped = true;
      cancelAnimationFrame(frameRequest);
      camera.stop();
    };

    const offlineBefore = await modelAvailableOffline();

    set('camera', 'running', 'Asking for the camera');
    set('model', 'running', 'Loading');
    const model = loadLandmarker();
    model.catch(() => undefined);

    let landmarker: LandmarkerHandle | null = null;
    try {
      const info = await camera.open(video, { facing: 'user' });
      if (stopped) return;
      setSeeing(true);
      set('camera', 'ok', `${info.label || 'Camera'} · ${info.width}×${info.height}${info.frameRate ? ` at ${Math.round(info.frameRate)} frames per second` : ''}`);
    } catch (error) {
      const reason: CameraFailure = error instanceof CameraError ? error.reason : 'failed';
      set('camera', 'fail', `${CAMERA_COPY[reason].title}. ${CAMERA_COPY[reason].body}`);
    }

    try {
      landmarker = await model;
      if (stopped) return;
      const from = landmarker.source === 'app' ? 'served by this app' : landmarker.source === 'device-cache' ? 'this device’s cache' : 'the network';
      set(
        'model',
        landmarker.delegate === 'GPU' ? 'ok' : 'warn',
        `Ready in ${(landmarker.loadMs / 1000).toFixed(1)} s, loaded from ${from}, running on the ${landmarker.delegate === 'GPU' ? 'graphics processor' : 'main processor (slower: graphics acceleration was not available)'}`,
      );
    } catch {
      set('model', 'fail', `${CAMERA_COPY.model.title}. ${CAMERA_COPY.model.body}`);
    }

    if (landmarker && camera.active) {
      set('speed', 'running', 'Measuring for a few seconds');
      set('light', 'running', 'Measuring');
      const source = new CameraSource(video, landmarker);
      const luma = new LumaSampler(300);
      const started = performance.now();
      let frames = 0;
      let modelMs = 0;
      let hands = 0;
      let brightness: number | null = null;
      await new Promise<void>((resolve) => {
        const tick = (now: number) => {
          if (stopped) return resolve();
          const frame = source.poll(now);
          if (frame) {
            frames += 1;
            modelMs += frame.inferenceMs ?? 0;
            if (frame.observations.length > 0) hands += 1;
            brightness = luma.sample(video, now) ?? brightness;
          }
          if (now - started >= MEASURE_MS) return resolve();
          frameRequest = requestAnimationFrame(tick);
        };
        frameRequest = requestAnimationFrame(tick);
      });
      if (stopped) return;
      const seconds = (performance.now() - started) / 1000;
      const fps = frames / seconds;
      const perFrame = frames > 0 ? modelMs / frames : 0;
      if (frames < 3) {
        set('speed', 'warn', 'Too few frames arrived to measure. If this window was in the background, bring it to the front and check again.');
      } else {
        set(
          'speed',
          fps >= 20 ? 'ok' : fps >= 12 ? 'warn' : 'fail',
          `${fps.toFixed(1)} frames per second measured over ${seconds.toFixed(1)} s · model ${perFrame.toFixed(1)} ms per frame${hands > 0 ? ` · a hand was found in ${Math.round((hands / frames) * 100)}% of frames` : ' · no hand was in view during the check'}`,
        );
      }
      const lumaValue = brightness as number | null;
      if (lumaValue === null) set('light', 'warn', 'The picture’s brightness could not be read in this browser.');
      else set('light', lumaValue >= 70 ? 'ok' : lumaValue >= 40 ? 'warn' : 'fail', `Mean picture brightness ${Math.round(lumaValue)} of 255${lumaValue < 70 ? '. Tracking is steadier in brighter, even light: face a window or a lamp.' : ''}`);
    } else {
      set('speed', 'fail', 'Needs the camera and the model.');
      set('light', 'fail', 'Needs the camera.');
    }

    const offlineNow = await modelAvailableOffline();
    set(
      'offline',
      offlineNow ? 'ok' : 'warn',
      offlineNow
        ? `The model is held ${offlineNow === 'app' ? 'by this app' : 'in this device’s cache'}${offlineBefore ? '' : ' (stored just now)'}. Tracking will start without a connection.`
        : 'The model is not stored on this device yet. Load it once with a connection (this check does that when it can), or run “npm run fetch-model” so the app serves it itself.',
    );

    camera.stop();
    setSeeing(false);
    cancel.current = null;
    setRunning(false);
  }, [running, set]);

  useEffect(() => () => cancel.current?.(), []);

  return (
    <section className={cx('glass rounded-[24px] px-6 py-5', className)} aria-label="Preflight check">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold leading-6 text-ink">Preflight</h2>
          <p className="text-[14.5px] leading-6 text-ink-soft">Check the camera and the model on this machine before presenting. Only what is measured here is reported.</p>
        </div>
        <Button variant="primary" size="md" onClick={() => void run()} disabled={running}>
          {running ? <Spinner className="size-4" /> : null}
          {running ? 'Checking' : lines[0].state === 'pending' ? 'Run the check' : 'Check again'}
        </Button>
      </div>
      <div className="mt-3 grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_220px]">
        <ul>
          {lines.map((line) => (
            <li key={line.key} className="flex gap-3 border-t border-line-soft py-2.5 first:border-t-0">
              <span className="mt-0.5 shrink-0">
                {line.state === 'ok' ? (
                  <CheckCircle size={20} weight="fill" className="text-green-500" aria-hidden="true" />
                ) : line.state === 'warn' ? (
                  <WarningCircle size={20} weight="fill" className="text-amber-500" aria-hidden="true" />
                ) : line.state === 'fail' ? (
                  <WarningCircle size={20} weight="fill" className="text-wine-600" aria-hidden="true" />
                ) : line.state === 'running' ? (
                  <Spinner className="size-5 text-ink" />
                ) : (
                  <Circle size={20} className="text-ink-faint" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-[14.5px] font-bold leading-5 text-ink">
                  {line.title}
                  <span className="sr-only-live">
                    {' '}
                    {line.state === 'ok' ? 'passed' : line.state === 'warn' ? 'needs attention' : line.state === 'fail' ? 'failed' : ''}
                  </span>
                </span>
                <span className="block text-[13.5px] leading-5 text-ink-soft">{line.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className={cx('relative aspect-[4/3] self-start overflow-hidden rounded-[18px] bg-navy-950', !seeing && 'hidden @3xl:block')}>
          <video ref={videoRef} muted playsInline className={cx('absolute inset-0 size-full -scale-x-100 object-cover', !seeing && 'opacity-0')} aria-hidden="true" />
          {!seeing ? <p className="absolute inset-0 grid place-items-center px-4 text-center text-[12px] leading-4 text-white/60">The camera picture appears here during the check.</p> : null}
        </div>
      </div>
    </section>
  );
}
