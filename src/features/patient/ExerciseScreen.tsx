import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, X } from 'lucide-react';
import { useActivePatient, useDemoState, useToday } from '../../app/hooks';
import { Button, ButtonLink, Card, Explainer, Spinner, cx } from '../../components/ui';
import { demoStore } from '../../demo/store';
import { dateKeyOf, lastDays, relativeDay } from '../../domain/dates';
import {
  EXERCISES,
  FINGERS,
  OpenCloseTracker,
  UPCOMING_PHASES,
  patientSummaryLine,
  previousMeasured,
  sessionsForPatient,
  type CuePhase,
  type FingerValues,
  type SessionResult,
} from '../../domain/exercise';
import type { ExerciseId, ExerciseSession, Finger, TestSite } from '../../domain/types';
import { CameraError, CameraHandSource, cameraSupport, type CameraFailure } from '../../exercise/cameraHand';
import { DemoHandSource } from '../../exercise/demoHand';
import { drawHand } from '../../exercise/drawHand';
import { Screen, SectionHeading, TopBar } from './PatientShell';

const EXERCISE = EXERCISES['open-close'];

const FINGER_LABEL: Record<Finger, string> = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  little: 'Little',
};

/** Exercises this patient may do. Only a clinician changes this, from the record. */
export function unlockedExercises(plans: Record<string, ExerciseId[]> | undefined, patientId: string): ExerciseId[] {
  return plans?.[patientId] ?? ['open-close'];
}

// ---------- Overview ----------

/** A small trend line of the camera-estimated range. Shape only: no axis, no promise of precision. */
function RangeTrend({ sessions }: { sessions: ExerciseSession[] }) {
  const values = sessions.filter((session) => session.rangeDeg !== null).slice(-14);
  if (values.length < 2) return null;
  const numbers = values.map((session) => session.rangeDeg as number);
  const low = Math.min(...numbers) - 8;
  const high = Math.max(...numbers) + 8;
  const width = 300;
  const height = 64;
  const x = (index: number) => 6 + (index / (numbers.length - 1)) * (width - 12);
  const y = (value: number) => height - 8 - ((value - low) / (high - low)) * (height - 16);
  const path = numbers.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(numbers.length - 1).toFixed(1)} ${height} L${x(0).toFixed(1)} ${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 block h-16 w-full" role="img" aria-label="Movement over your recent sessions">
      <defs>
        <linearGradient id="range-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14a38c" stopOpacity="0.22" />
          <stop offset="1" stopColor="#14a38c" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#range-fill)" />
      <path d={path} fill="none" stroke="#0b8272" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(numbers.length - 1)} cy={y(numbers[numbers.length - 1])} r="4" fill="#0b8272" stroke="#ffffff" strokeWidth="2" />
    </svg>
  );
}

export function ExerciseHome() {
  const patient = useActivePatient();
  const state = useDemoState();
  const today = useToday();
  const sessions = sessionsForPatient(state.exerciseSessions ?? [], patient.id);
  const unlocked = unlockedExercises(state.exercisePlans, patient.id).includes('open-close');
  const doneToday = sessions.filter((session) => session.reps > 0 && dateKeyOf(session.timestamp) === today);
  const week = lastDays(today, 7);
  const daysDone = week.filter((day) => sessions.some((session) => session.reps > 0 && dateKeyOf(session.timestamp) === day)).length;
  const latest = previousMeasured(sessions);
  const support = cameraSupport();
  const fingerName = patient.finger === 'thumb' ? 'thumb' : `${patient.finger} finger`;

  return (
    <Screen header={<TopBar title="Exercises" />}>
      <p className="-mt-1 text-[15.5px] leading-6 text-ink-soft">
        Guided by your camera. It follows your fingers and counts for you.
      </p>

      <Card className="mt-4 overflow-hidden">
        <div className="border-b border-rule px-5 py-5">
          <p className="text-[13px] font-semibold leading-5 text-ink-soft">Phase {EXERCISE.phase}</p>
          <h2 className="display mt-0.5 text-[24px] leading-8 text-ink">{EXERCISE.title}</h2>
          <p className="mt-1 text-[15px] leading-6 text-ink-soft">{EXERCISE.summary}</p>
          <p className="mt-3 text-[14px] font-semibold leading-5 text-ink">
            {EXERCISE.targetReps} repetitions · about a minute
            {doneToday.length > 0 ? <span className="ml-2 font-bold text-teal-700">Done today</span> : null}
          </p>
        </div>
        <ol className="space-y-3 px-5 py-4">
          {EXERCISE.steps.map((step, index) => (
            <li key={step} className="flex gap-3.5 text-[15px] leading-[22px] text-ink">
              <span className="nums w-4 shrink-0 font-bold text-wine-600">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <div className="px-5 pb-5">
          {!unlocked ? (
            <p className="flex items-start gap-2.5 rounded-[12px] bg-floor px-4 py-3 text-[14.5px] leading-6 text-ink" role="status">
              <Lock className="mt-1 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span>Your therapist hasn’t unlocked this exercise yet. They will switch it on when you are ready for it.</span>
            </p>
          ) : (
            <>
              {support.supported ? (
                <ButtonLink to="/patient/exercise/open-close" variant="primary" size="lg" block>
                  {doneToday.length > 0 ? 'Do it again' : 'Start with camera'}
                </ButtonLink>
              ) : (
                <p className="rounded-[12px] bg-amber-50 px-4 py-3 text-[14.5px] leading-6 text-amber-700" role="status">
                  {support.reason === 'insecure'
                    ? 'The camera only works on the https:// address of Ntact, or on localhost.'
                    : 'This browser can’t use the camera from a web page.'}
                </p>
              )}
              <ButtonLink to="/patient/exercise/open-close?mode=demo" variant="ghost" size="md" block className="mt-1.5">
                Watch a demonstration instead
              </ButtonLink>
            </>
          )}
        </div>
      </Card>

      <section aria-labelledby="exercise-movement" className="mt-6">
        <SectionHeading>
          <span id="exercise-movement">Your movement</span>
        </SectionHeading>
        <Card className="mt-2.5 px-5 py-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13.5px] leading-5 text-ink-soft">How far your {fingerName} moved</p>
              <p className="display nums mt-0.5 text-[30px] leading-9 text-ink">
                {latest?.rangeDeg != null ? `about ${latest.rangeDeg}°` : 'No sessions yet'}
              </p>
            </div>
            <p className="pb-1 text-right text-[13.5px] leading-5 text-ink-soft">
              <span className="block font-bold text-ink">{daysDone} of 7 days</span>
              this week
            </p>
          </div>
          <RangeTrend sessions={sessions} />
          <p className="mt-2 text-[13px] leading-5 text-ink-soft">
            {latest ? `Last session ${relativeDay(dateKeyOf(latest.timestamp), today).toLowerCase()}. ` : ''}
            An estimate from the camera: good for seeing the trend, not a precise measurement.
          </p>
        </Card>
      </section>

      <section aria-labelledby="exercise-later" className="mt-6">
        <SectionHeading>
          <span id="exercise-later">Coming later</span>
        </SectionHeading>
        <Card className="mt-2.5 divide-y divide-line-soft px-5">
          {UPCOMING_PHASES.map((item) => (
            <div key={item.phase} className="flex items-center justify-between gap-4 py-3.5">
              <span>
                <span className="block text-[15px] font-bold leading-5 text-ink">{item.title}</span>
                <span className="block text-[13.5px] leading-5 text-ink-soft">{item.note}</span>
              </span>
              <Lock className="size-4 shrink-0 text-ink-faint" strokeWidth={2} aria-hidden="true" />
            </div>
          ))}
        </Card>
        <p className="mt-2.5 text-[13.5px] leading-5 text-ink-soft">
          Your therapist chooses which exercises you do and unlocks each phase. The app never decides that for you.
        </p>
      </section>

      <Card className="mt-6 divide-y divide-line-soft px-5 py-1">
        <Explainer summary="What happens to the video?">
          <p>
            Nothing leaves this device. The picture goes from your camera to hand tracking that runs inside this page, and is
            never recorded, saved or sent anywhere. Only the result is kept: how many repetitions, and the estimated movement.
          </p>
        </Explainer>
        <Explainer summary="How accurate is it?">
          <p>
            A camera sees your hand from one side, so the angles are estimates and can be out by ten or twenty degrees, more if
            your hand is turned. They are for guiding you and showing the trend over weeks. Your therapist’s own measurements
            are the ones that count.
          </p>
        </Explainer>
        <Explainer summary="It hurts, or my finger won’t go that far">
          <p>
            Stop at the point that is comfortable. Partial movement still counts as a repetition here. If pain is getting
            worse, say so in today’s check-in or contact your care team.
          </p>
        </Explainer>
      </Card>
    </Screen>
  );
}

// ---------- Live session ----------

const CAMERA_COPY: Record<CameraFailure, { title: string; body: string }> = {
  unsupported: { title: 'This browser can’t use the camera', body: 'Open Ntact in Chrome, Edge or Safari.' },
  insecure: { title: 'The camera needs the secure address', body: 'Open Ntact from its https:// link, or from localhost on the development laptop.' },
  denied: { title: 'The camera was blocked', body: 'Allow the camera for this site in your browser’s site settings (the icon beside the address), then try again.' },
  'no-camera': { title: 'No camera was found', body: 'Check a camera is connected and switched on.' },
  busy: { title: 'The camera is in use', body: 'Close any other app or tab that is using the camera, then try again.' },
  model: { title: 'Hand tracking couldn’t load', body: 'It needs an internet connection the first time. Check the connection and try again.' },
  failed: { title: 'The camera couldn’t start', body: 'Try again. If it keeps happening, reload the page.' },
};

interface LiveView {
  reps: number;
  cue: string;
  cuePhase: CuePhase;
  closure: number;
  curl: FingerValues;
  handVisible: boolean;
  ready: boolean;
}

const EMPTY_VIEW: LiveView = {
  reps: 0,
  cue: 'Hold your hand up to the camera',
  cuePhase: 'find-hand',
  closure: 0,
  curl: { thumb: 0, index: 0, middle: 0, ring: 0, little: 0 },
  handVisible: false,
  ready: false,
};

function sameView(a: LiveView, b: LiveView): boolean {
  if (a.reps !== b.reps || a.cue !== b.cue || a.handVisible !== b.handVisible || a.ready !== b.ready) return false;
  if (Math.abs(a.closure - b.closure) > 0.012) return false;
  return FINGERS.every((finger) => Math.abs(a.curl[finger] - b.curl[finger]) <= 0.02);
}

/** How closed the hand is, as an arc. Fills as the fist forms, empties as it opens. */
function ClosureRing({ closure, reps, target }: { closure: number; reps: number; target: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative grid size-[88px] place-items-center">
      <svg viewBox="0 0 80 80" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r={radius} fill="rgb(17 28 34 / 0.55)" stroke="rgb(255 255 255 / 0.16)" strokeWidth="5" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="#c4f1c9"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, closure)))}
        />
      </svg>
      <span className="relative text-center leading-none text-white">
        <span className="display nums block text-[30px]">{reps}</span>
        <span className="nums mt-0.5 block text-[12px] font-semibold text-mist">of {target}</span>
      </span>
    </div>
  );
}

function FingerBars({ curl, injured }: { curl: FingerValues; injured: Finger }) {
  return (
    <div className="grid grid-cols-5 gap-2" aria-hidden="true">
      {FINGERS.map((finger) => {
        const mine = finger === injured;
        return (
          <div key={finger} className="flex flex-col items-center gap-1.5">
            <div className={cx('relative h-12 w-full overflow-hidden rounded-[9px]', mine ? 'bg-mint/15 ring-1 ring-mint/50' : 'bg-white/[0.07]')}>
              <div
                className={cx('absolute inset-x-0 bottom-0 rounded-[9px]', mine ? 'bg-mint' : 'bg-white/45')}
                style={{ height: `${Math.round(Math.min(1, Math.max(0, curl[finger])) * 100)}%` }}
              />
            </div>
            <span className={cx('text-[11.5px] leading-4', mine ? 'font-bold text-mint' : 'font-medium text-mist')}>{FINGER_LABEL[finger]}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function Summary({
  result,
  previous,
  demo,
  site,
  onAgain,
}: {
  result: SessionResult;
  previous: ExerciseSession | null;
  demo: boolean;
  site: TestSite;
  onAgain(): void;
}) {
  const fingerName = site.finger === 'thumb' ? 'thumb' : `${site.finger} finger`;
  const counted = result.reps > 0;
  return (
    <main className="on-dark screen-in flex min-h-dvh flex-1 flex-col px-6 pb-[max(22px,env(safe-area-inset-bottom))] pt-[max(18px,env(safe-area-inset-top))] text-white sm:min-h-0 sm:pb-8 sm:pt-2">
      <p className="text-center text-[14px] font-medium leading-5 text-mist">{EXERCISE.title}</p>

      <div className="mt-8 text-center">
        <p className="display nums text-[68px] leading-none text-mint">
          {result.reps}
          <span className="text-[26px] text-mist"> of {result.targetReps}</span>
        </p>
        <h1 className="display mx-auto mt-4 max-w-[300px] text-[26px] leading-[1.18] text-white" role="status">
          {result.completed ? 'Session complete. Well done.' : counted ? 'Good work today.' : 'Nothing was counted this time.'}
        </h1>
        <p className="mx-auto mt-3 max-w-[310px] text-[15.5px] leading-6 text-mist">{patientSummaryLine(result, previous)}</p>
      </div>

      {counted ? (
        <dl className="mt-8 grid grid-cols-3 gap-2.5 text-center">
          {[
            { label: `${fingerName} bend`, value: result.flexDeg !== null ? `≈${result.flexDeg}°` : '–' },
            { label: 'Movement', value: result.rangeDeg !== null ? `≈${result.rangeDeg}°` : '–' },
            { label: 'Time', value: formatDuration(result.durationMs) },
          ].map((item) => (
            <div key={item.label} className="rounded-[16px] border border-navy-rule bg-white/[0.05] px-2 py-4">
              <dd className="display nums text-[23px] leading-7 text-white">{item.value}</dd>
              <dt className="mt-1 text-[12px] leading-4 text-mist first-letter:uppercase">{item.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}

      <p className="mt-5 text-center text-[13px] leading-5 text-mist">
        {demo
          ? 'This was the built-in demonstration, not your hand. It is saved as demonstration data.'
          : 'Angles are estimates from the camera. They show the trend, not a precise measurement.'}
      </p>

      <div className="mt-auto space-y-2.5 pt-8">
        <Link
          to="/patient/exercise"
          className="flex min-h-14 items-center justify-center rounded-[14px] bg-mint px-5 text-[16.5px] font-bold text-ink active:opacity-90"
        >
          Done
        </Link>
        <Button variant="glass" size="md" block onClick={onAgain}>
          Go again
        </Button>
      </div>
    </main>
  );
}

export function ExerciseSessionScreen() {
  const patient = useActivePatient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const demo = params.get('mode') === 'demo';

  // Who and which finger this session is for, fixed when it opens.
  const subject = useRef({ patientId: patient.id, site: { hand: patient.hand, finger: patient.finger } as TestSite });
  const injured = subject.current.site.finger;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef<() => void>(() => undefined);

  const [status, setStatus] = useState<'starting' | 'live' | 'error' | 'summary'>('starting');
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [view, setView] = useState<LiveView>(EMPTY_VIEW);
  const [outcome, setOutcome] = useState<{ result: SessionResult; previous: ExerciseSession | null } | null>(null);
  /** Bumped to start a fresh session without leaving the screen. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let frameRequest = 0;
    let finished = false;
    let doneAt: number | null = null;
    const tracker = new OpenCloseTracker(injured, EXERCISE.targetReps);
    const camera = demo ? null : new CameraHandSource();
    const drawn = demo ? new DemoHandSource(injured) : null;

    setStatus('starting');
    setFailure(null);
    setView(EMPTY_VIEW);
    setOutcome(null);

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frameRequest);
      camera?.stop();
      const result = tracker.result();
      const earlier = sessionsForPatient(demoStore.getState().exerciseSessions ?? [], subject.current.patientId);
      const previous = previousMeasured(earlier);
      // A session with nothing counted is not a session: nothing is saved.
      if (result.reps > 0) {
        demoStore.recordExercise(
          subject.current.patientId,
          'open-close',
          result,
          demo ? 'demo-motion' : 'camera',
          subject.current.site,
        );
      }
      if (!cancelled) {
        setOutcome({ result, previous });
        setStatus('summary');
      }
    };
    finishRef.current = finish;

    const loop = (now: number) => {
      if (cancelled || finished) return;
      const canvas = canvasRef.current;
      const stage = stageRef.current;
      const video = videoRef.current;
      const frame = camera ? camera.read(now) : (drawn as DemoHandSource).read(now);
      const state = tracker.update(frame, now);

      if (canvas && stage) {
        const width = stage.clientWidth;
        const height = stage.clientHeight;
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
        }
        const context = canvas.getContext('2d');
        if (context) {
          context.setTransform(ratio, 0, 0, ratio, 0, 0);
          drawHand(context, frame, {
            width,
            height,
            // The demonstration hand is laid out for a square picture as tall as the stage.
            sourceWidth: camera && video?.videoWidth ? video.videoWidth : height,
            sourceHeight: camera && video?.videoHeight ? video.videoHeight : height,
            mirrored: camera !== null,
            solid: camera === null,
            injured,
            closure: state.pose?.closure ?? 0,
            active: state.ready && state.framing === 'ok',
            sinceRep: state.lastRepAt === null ? null : now - state.lastRepAt,
            now,
          });
        }
      }

      const next: LiveView = {
        reps: state.reps,
        cue: state.cue.text,
        cuePhase: state.cue.phase,
        closure: state.pose?.closure ?? 0,
        curl: state.pose?.curl ?? EMPTY_VIEW.curl,
        handVisible: state.handVisible,
        ready: state.ready,
      };
      setView((previous) => (sameView(previous, next) ? previous : next));

      if (state.done) {
        // Keep drawing for a moment, so the last ring finishes before the summary takes over.
        if (doneAt === null) doneAt = now;
        if (now - doneAt > 1100) {
          finish();
          return;
        }
      }
      frameRequest = requestAnimationFrame(loop);
    };

    const begin = () => {
      if (cancelled) return;
      setStatus('live');
      frameRequest = requestAnimationFrame(loop);
    };

    if (camera) {
      const video = videoRef.current;
      if (!video) return;
      camera.start(video).then(begin, (error: unknown) => {
        if (cancelled) return;
        setFailure(error instanceof CameraError ? error.reason : 'failed');
        setStatus('error');
      });
    } else {
      begin();
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameRequest);
      // Leaving the screen always turns the camera off.
      camera?.stop();
    };
  }, [demo, injured, attempt]);

  const again = useCallback(() => setAttempt((value) => value + 1), []);

  if (status === 'summary' && outcome) {
    return <Summary result={outcome.result} previous={outcome.previous} demo={demo} site={subject.current.site} onAgain={again} />;
  }

  const copy = failure ? CAMERA_COPY[failure] : null;
  const steady = view.cuePhase === 'find-hand' || view.cuePhase === 'framing' || view.cuePhase === 'get-ready';

  return (
    <main className="on-dark flex min-h-dvh flex-1 flex-col px-5 pb-[max(18px,env(safe-area-inset-bottom))] pt-[max(14px,env(safe-area-inset-top))] text-white sm:min-h-0 sm:pb-7 sm:pt-1">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/patient/exercise')}
          aria-label="Close the exercise"
          className="grid size-11 shrink-0 place-items-center rounded-full border border-mist/40 text-white hover:bg-white/[0.06]"
        >
          <X className="size-5" strokeWidth={2.2} aria-hidden="true" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[18px] font-bold leading-6 tracking-[-0.02em]">{EXERCISE.title}</h1>
        <span className={cx('rounded-full px-3 py-1 text-[12.5px] font-bold leading-5', demo ? 'border border-dashed border-mist/60 text-mist' : 'bg-mint text-ink')}>
          {demo ? 'Demonstration' : 'Camera'}
        </span>
      </header>

      <div
        ref={stageRef}
        className={cx('relative mt-3 min-h-[280px] flex-1 overflow-hidden rounded-[26px] border border-navy-rule', demo ? 'stage-demo' : 'bg-navy-950')}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          className={cx('absolute inset-0 size-full -scale-x-100 object-cover', (demo || status !== 'live') && 'opacity-0')}
          aria-hidden="true"
        />
        {/* A slight darkening, so the drawn hand and the words stay readable over any room. */}
        {!demo && status === 'live' ? <div className="stage-shade pointer-events-none absolute inset-0" aria-hidden="true" /> : null}
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true" />

        {status === 'live' ? (
          <>
            <div className="absolute left-3.5 top-3.5">
              <ClosureRing closure={view.closure} reps={view.reps} target={EXERCISE.targetReps} />
            </div>
            <div className="absolute inset-x-3.5 bottom-3.5">
              <p
                key={view.cue}
                className={cx(
                  'cue-in mx-auto w-fit max-w-full rounded-[16px] px-5 py-3 text-center text-[18px] font-bold leading-6 backdrop-blur-md',
                  steady ? 'bg-navy-950/70 text-white' : 'bg-mint/95 text-ink',
                )}
                role="status"
                aria-live="polite"
              >
                {view.cue}
              </p>
            </div>
          </>
        ) : null}

        {status === 'starting' ? (
          <div className="absolute inset-0 grid place-items-center px-8 text-center">
            <div>
              <Spinner className="mx-auto size-7 text-mint" />
              <p className="mt-4 text-[17px] font-bold leading-6">{demo ? 'Starting' : 'Starting the camera'}</p>
              {!demo ? (
                <p className="mt-1.5 text-[14px] leading-5 text-mist">
                  Your browser will ask to use the camera. Hand tracking takes a few seconds to load the first time.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {status === 'error' && copy ? (
          <div className="absolute inset-0 grid place-items-center px-7 text-center" role="alert">
            <div>
              <p className="display text-[23px] leading-7">{copy.title}</p>
              <p className="mt-2 text-[15px] leading-6 text-mist">{copy.body}</p>
              <div className="mt-5 space-y-2">
                <Button variant="glass" size="md" block onClick={again}>
                  Try again
                </Button>
                <ButtonLink to="/patient/exercise/open-close?mode=demo" variant="ghost" size="md" block className="!text-mint hover:!bg-white/[0.06]">
                  Watch a demonstration instead
                </ButtonLink>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3.5">
        <FingerBars curl={view.curl} injured={injured} />
      </div>

      <div className="mt-3.5 flex items-center gap-1.5" aria-hidden="true">
        {Array.from({ length: EXERCISE.targetReps }, (_, index) => (
          <span key={index} className={cx('h-1.5 flex-1 rounded-full transition-colors duration-300', index < view.reps ? 'bg-mint' : 'bg-white/15')} />
        ))}
      </div>

      <p className="mt-3 text-center text-[12.5px] leading-5 text-mist">
        {demo ? 'A drawn hand, to show how it works. Not your movement.' : 'The video stays on this device. Nothing is recorded.'}
      </p>

      <Button variant="glass" size="md" block className="mt-3" onClick={() => finishRef.current()} disabled={status !== 'live'}>
        {view.reps > 0 ? 'Finish here' : 'Stop'}
      </Button>
    </main>
  );
}
