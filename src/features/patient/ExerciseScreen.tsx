import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CaretRight, CheckCircle, LockSimple, X } from '@phosphor-icons/react';
import { useActivePatient, useDemoState, useToday } from '../../app/hooks';
import { Button, ButtonLink, Card, Explainer, Spinner, cx } from '../../components/ui';
import { demoStore } from '../../demo/store';
import { dateKeyOf, lastDays, relativeDay } from '../../domain/dates';
import {
  EXERCISES,
  EXERCISE_ORDER,
  FINGERS,
  RepTracker,
  TREND_EXERCISE,
  isExerciseId,
  patientSummaryLine,
  physioToday,
  previousMeasured,
  sessionsForPatient,
  trendSessions,
  unlockedExercises,
  type CuePhase,
  type ExerciseDefinition,
  type FingerValues,
  type SessionResult,
} from '../../domain/exercise';
import type { ExerciseId, ExerciseSession, Finger, TestSite } from '../../domain/types';
import { CameraError, CameraHandSource, cameraSupport, type CameraFailure } from '../../exercise/cameraHand';
import { DemoHandSource } from '../../exercise/demoHand';
import { drawHand } from '../../exercise/drawHand';
import { Screen, SectionHeading, TopBar } from './PatientShell';

const FINGER_LABEL: Record<Finger, string> = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  little: 'Little',
};

const fingerWords = (finger: Finger) => (finger === 'thumb' ? 'thumb' : `${finger} finger`);

// ---------- Physio: the list ----------

/** A small trend line of the camera-estimated range. Shape only: no axis, no promise of precision. */
function RangeTrend({ sessions }: { sessions: ExerciseSession[] }) {
  const values = trendSessions(sessions).slice(-14);
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
          <stop offset="0" stopColor="#3D63A6" stopOpacity="0.22" />
          <stop offset="1" stopColor="#3D63A6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#range-fill)" />
      <path d={path} fill="none" stroke="#2E4A7D" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(numbers.length - 1)} cy={y(numbers[numbers.length - 1])} r="4" fill="#2E4A7D" stroke="#ffffff" strokeWidth="2" />
    </svg>
  );
}

export function ExerciseHome() {
  const patient = useActivePatient();
  const state = useDemoState();
  const today = useToday();
  const sessions = sessionsForPatient(state.exerciseSessions ?? [], patient.id);
  const { unlocked, done } = physioToday(state.exerciseSessions ?? [], state.exercisePlans, patient.id, today);
  const week = lastDays(today, 7);
  const daysDone = week.filter((day) => sessions.some((session) => session.reps > 0 && dateKeyOf(session.timestamp) === day)).length;
  const latest = previousMeasured(sessions, undefined, TREND_EXERCISE);

  return (
    <Screen header={<TopBar title="Physio" />}>
      <p className="-mt-1 text-[15.5px] leading-6 text-ink-soft">
        {unlocked.length === 0
          ? 'Your therapist hasn’t unlocked any exercises yet.'
          : done.length === unlocked.length
            ? 'All done for today. Your camera followed your fingers and counted for you.'
            : `${done.length} of ${unlocked.length} done today. Your camera follows your fingers and counts for you.`}
      </p>

      <ul className="mt-4 space-y-3">
        {EXERCISE_ORDER.map((id, index) => {
          const exercise = EXERCISES[id];
          const open = unlocked.includes(id);
          const isDone = done.includes(id);
          const next = open && !isDone && unlocked.find((item) => !done.includes(item)) === id;
          const body = (
            <>
              <span
                className={cx(
                  'nums grid size-12 shrink-0 place-items-center rounded-full text-[17px] font-bold',
                  isDone ? 'bg-green-50 text-green-700' : !open ? 'bg-navy-50 text-ink-faint' : next ? 'bg-mint text-ink' : 'bg-navy-50 text-ink',
                )}
              >
                {isDone ? <CheckCircle size={26} weight="fill" aria-hidden="true" /> : !open ? <LockSimple size={21} aria-hidden="true" /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-bold leading-6 tracking-[-0.015em]">{exercise.title}</span>
                <span className={cx('block text-[14px] leading-5', next ? 'text-mist' : 'text-ink-soft')}>
                  {!open ? 'Your therapist unlocks this at a later stage.' : isDone ? `Done today. ${exercise.targetReps} repetitions.` : exercise.summary}
                </span>
              </span>
            </>
          );
          return (
            <li key={id}>
              {open ? (
                <Link
                  to={`/patient/exercise/${id}`}
                  className={cx(
                    'flex min-h-[88px] items-center gap-4 rounded-[24px] px-4 py-3.5 transition-transform duration-150 active:scale-[0.985]',
                    next ? 'btn-primary text-white shadow-button' : 'glass text-ink',
                  )}
                >
                  {body}
                  {next ? (
                    <span className="shrink-0 rounded-full bg-mint px-4 py-2 text-[14.5px] font-bold leading-5 text-ink">Start</span>
                  ) : (
                    <CaretRight size={18} weight="bold" className="shrink-0 text-ink-soft" aria-hidden="true" />
                  )}
                </Link>
              ) : (
                <div className="flex min-h-[88px] items-center gap-4 rounded-[24px] border border-dashed border-ink/20 px-4 py-3.5 text-ink-soft">{body}</div>
              )}
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="exercise-movement" className="mt-6">
        <SectionHeading>
          <span id="exercise-movement">Your movement</span>
        </SectionHeading>
        <Card className="mt-2.5 px-5 py-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13.5px] leading-5 text-ink-soft">How far your {fingerWords(patient.finger)} moved</p>
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
            {latest ? `From “Open and close”, ${relativeDay(dateKeyOf(latest.timestamp), today).toLowerCase()}. ` : ''}
            An estimate from the camera: good for seeing the trend, not a precise measurement.
          </p>
        </Card>
      </section>

      <Card className="mt-5 divide-y divide-line-soft px-5 py-1">
        <Explainer summary="What happens to the video?">
          <p>
            Nothing leaves this device. The picture goes from your camera to hand tracking that runs inside this page, and is
            never recorded, saved or sent anywhere. Only the result is kept: how many repetitions, and the estimated movement.
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

// ---------- Get ready ----------

/** One exercise: what to do, then start. Kept short so the next tap is the camera. */
export function ExerciseReadyScreen() {
  const { exerciseId } = useParams();
  const patient = useActivePatient();
  const state = useDemoState();
  const support = cameraSupport();

  if (!isExerciseId(exerciseId)) return <Navigate to="/patient/exercise" replace />;
  const exercise = EXERCISES[exerciseId];
  if (!unlockedExercises(state.exercisePlans, patient.id).includes(exerciseId)) return <Navigate to="/patient/exercise" replace />;

  return (
    <Screen
      header={<TopBar title={exercise.title} />}
      footer={
        support.supported ? (
          <ButtonLink to={`/patient/exercise/${exerciseId}/live`} variant="primary" size="lg" block>
            Start with camera
          </ButtonLink>
        ) : undefined
      }
    >
      <p className="-mt-1 text-[15.5px] leading-6 text-ink-soft">{exercise.targetReps} repetitions. About a minute.</p>

      <Card className="mt-4 p-5">
        <ol className="space-y-3.5">
          {exercise.steps.map((step, index) => (
            <li key={step} className="flex gap-3.5 text-[15.5px] leading-[23px] text-ink">
              <span className="nums w-4 shrink-0 font-bold text-teal-600">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Card>

      {!support.supported ? (
        <p className="mt-4 rounded-[16px] bg-amber-50 px-4 py-3 text-[14.5px] leading-6 text-amber-700" role="status">
          {support.reason === 'insecure'
            ? 'The camera only works on the https:// address of Ntact, or on localhost.'
            : 'This browser can’t use the camera from a web page.'}
        </p>
      ) : (
        <p className="mt-4 px-1 text-[14px] leading-6 text-ink-soft">
          Your browser will ask to use the camera. The video stays on this device and is never recorded.
        </p>
      )}

      <ButtonLink to={`/patient/exercise/${exerciseId}/live?mode=demo`} variant="ghost" size="md" className="-ml-4 mt-1">
        Watch a demonstration instead
      </ButtonLink>
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
  amount: number;
  fingers: FingerValues;
  handVisible: boolean;
  ready: boolean;
}

const EMPTY_VIEW: LiveView = {
  reps: 0,
  cue: 'Hold your hand up to the camera',
  cuePhase: 'find-hand',
  amount: 0,
  fingers: { thumb: 0, index: 0, middle: 0, ring: 0, little: 0 },
  handVisible: false,
  ready: false,
};

function sameView(a: LiveView, b: LiveView): boolean {
  if (a.reps !== b.reps || a.cue !== b.cue || a.handVisible !== b.handVisible || a.ready !== b.ready) return false;
  if (Math.abs(a.amount - b.amount) > 0.012) return false;
  return FINGERS.every((finger) => Math.abs(a.fingers[finger] - b.fingers[finger]) <= 0.02);
}

/** How far into the movement the hand is, as an arc. Fills on the way in, empties on the way out. */
function AmountRing({ amount, reps, target }: { amount: number; reps: number; target: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative grid size-[88px] place-items-center">
      <svg viewBox="0 0 80 80" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r={radius} fill="rgb(10 17 34 / 0.55)" stroke="rgb(255 255 255 / 0.16)" strokeWidth="5" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="#ECB424"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, amount)))}
        />
      </svg>
      <span className="relative text-center leading-none text-white">
        <span className="display nums block text-[30px]">{reps}</span>
        <span className="nums mt-0.5 block text-[12px] font-semibold text-mist">of {target}</span>
      </span>
    </div>
  );
}

function FingerBars({ fingers, injured }: { fingers: FingerValues; injured: Finger }) {
  return (
    <div className="grid grid-cols-5 gap-2" aria-hidden="true">
      {FINGERS.map((finger) => {
        const mine = finger === injured;
        return (
          <div key={finger} className="flex flex-col items-center gap-1.5">
            <div className={cx('relative h-12 w-full overflow-hidden rounded-[9px]', mine ? 'bg-mint/15 ring-1 ring-mint/50' : 'bg-white/[0.07]')}>
              <div
                className={cx('absolute inset-x-0 bottom-0 rounded-[9px]', mine ? 'bg-mint' : 'bg-white/45')}
                style={{ height: `${Math.round(Math.min(1, Math.max(0, fingers[finger])) * 100)}%` }}
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
  exercise,
  result,
  previous,
  demo,
  site,
  nextId,
  onAgain,
}: {
  exercise: ExerciseDefinition;
  result: SessionResult;
  previous: ExerciseSession | null;
  demo: boolean;
  site: TestSite;
  /** The next exercise still to do today, if there is one. */
  nextId: ExerciseId | null;
  onAgain(): void;
}) {
  const counted = result.reps > 0;
  return (
    <main className="on-dark screen-in flex min-h-dvh flex-1 flex-col px-6 pb-[max(22px,env(safe-area-inset-bottom))] pt-[max(18px,env(safe-area-inset-top))] text-white sm:min-h-0 sm:pb-8 sm:pt-2">
      <p className="text-center text-[14px] font-medium leading-5 text-mist">{exercise.title}</p>

      <div className="mt-8 text-center">
        <p className="display nums text-[68px] leading-none text-mint">
          {result.reps}
          <span className="text-[26px] text-mist"> of {result.targetReps}</span>
        </p>
        <h1 className="display mx-auto mt-4 max-w-[300px] text-[26px] leading-[1.18] text-white" role="status">
          {result.completed ? 'Done. Well done.' : counted ? 'Good work today.' : 'Nothing was counted this time.'}
        </h1>
        <p className="mx-auto mt-3 max-w-[310px] text-[15.5px] leading-6 text-mist">{patientSummaryLine(result, previous)}</p>
      </div>

      {counted ? (
        <dl className="mt-8 grid grid-cols-3 gap-2.5 text-center">
          {[
            { label: `${fingerWords(site.finger)} bend`, value: result.flexDeg !== null ? `≈${result.flexDeg}°` : '–' },
            { label: 'Movement', value: result.rangeDeg !== null ? `≈${result.rangeDeg}°` : '–' },
            { label: 'Time', value: formatDuration(result.durationMs) },
          ].map((item) => (
            <div key={item.label} className="glass-dark rounded-[18px] px-2 py-4">
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
          to={nextId ? `/patient/exercise/${nextId}` : '/patient/exercise'}
          className="flex min-h-14 items-center justify-center rounded-[18px] bg-mint px-5 text-[16.5px] font-bold text-ink active:opacity-90"
        >
          {nextId ? 'Next exercise' : 'Done'}
        </Link>
        <Button variant="glass" size="md" block onClick={onAgain}>
          Go again
        </Button>
      </div>
    </main>
  );
}

export function ExerciseSessionScreen() {
  const { exerciseId } = useParams();
  if (!isExerciseId(exerciseId)) return <Navigate to="/patient/exercise" replace />;
  // Keyed so that moving to another exercise starts from scratch.
  return <LiveSession key={exerciseId} exercise={EXERCISES[exerciseId]} />;
}

function LiveSession({ exercise }: { exercise: ExerciseDefinition }) {
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
  const [outcome, setOutcome] = useState<{ result: SessionResult; previous: ExerciseSession | null; nextId: ExerciseId | null } | null>(null);
  /** Bumped to start a fresh session without leaving the screen. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let frameRequest = 0;
    let finished = false;
    let doneAt: number | null = null;
    const tracker = new RepTracker(exercise, injured);
    const camera = demo ? null : new CameraHandSource();
    // A squeeze round a ball is a smaller movement than a fist, so the drawn hand does less.
    const drawn = demo ? new DemoHandSource(injured, exercise.metric, exercise.id === 'putty-squeeze' ? 0.62 : 1) : null;

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
      const stateNow = demoStore.getState();
      const earlier = sessionsForPatient(stateNow.exerciseSessions ?? [], subject.current.patientId);
      const previous = previousMeasured(earlier, undefined, exercise.id);
      // A session with nothing counted is not a session: nothing is saved.
      if (result.reps > 0) {
        demoStore.recordExercise(subject.current.patientId, exercise.id, result, demo ? 'demo-motion' : 'camera', subject.current.site);
      }
      const after = demoStore.getState();
      const today = dateKeyOf(new Date().toISOString());
      const plan = physioToday(after.exerciseSessions ?? [], after.exercisePlans, subject.current.patientId, today);
      const nextId = plan.unlocked.find((id) => !plan.done.includes(id)) ?? null;
      if (!cancelled) {
        setOutcome({ result, previous, nextId });
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
            // The demonstration hand is laid out for a square picture.
            sourceWidth: camera && video?.videoWidth ? video.videoWidth : height,
            sourceHeight: camera && video?.videoHeight ? video.videoHeight : height,
            fit: camera ? 'cover' : 'contain',
            mirrored: camera !== null,
            solid: camera === null,
            injured,
            closure: state.amount,
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
        amount: state.amount,
        fingers: state.fingers ?? EMPTY_VIEW.fingers,
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
  }, [demo, injured, attempt, exercise]);

  const again = useCallback(() => setAttempt((value) => value + 1), []);

  if (status === 'summary' && outcome) {
    return (
      <Summary
        exercise={exercise}
        result={outcome.result}
        previous={outcome.previous}
        demo={demo}
        site={subject.current.site}
        nextId={outcome.nextId}
        onAgain={again}
      />
    );
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
          className="glass-dark grid size-11 shrink-0 place-items-center rounded-full text-white hover:bg-white/[0.14]"
        >
          <X size={19} weight="bold" aria-hidden="true" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[18px] font-bold leading-6 tracking-[-0.02em]">{exercise.title}</h1>
        <span className={cx('rounded-full px-3 py-1 text-[12.5px] font-bold leading-5', demo ? 'border border-dashed border-mist/60 text-mist' : 'bg-mint text-ink')}>
          {demo ? 'Demonstration' : 'Camera'}
        </span>
      </header>

      <div
        ref={stageRef}
        className={cx('relative mt-3 min-h-[280px] flex-1 overflow-hidden rounded-[28px] border border-navy-rule', demo ? 'stage-demo' : 'bg-navy-950')}
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
              <AmountRing amount={view.amount} reps={view.reps} target={exercise.targetReps} />
            </div>
            <div className="absolute inset-x-3.5 bottom-3.5">
              <p
                key={view.cue}
                className={cx(
                  'cue-in mx-auto w-fit max-w-full rounded-[18px] px-5 py-3 text-center text-[18px] font-bold leading-6 backdrop-blur-md',
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
                <ButtonLink
                  to={`/patient/exercise/${exercise.id}/live?mode=demo`}
                  variant="ghost"
                  size="md"
                  block
                  className="!text-mint hover:!bg-white/[0.06]"
                >
                  Watch a demonstration instead
                </ButtonLink>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3.5">
        <FingerBars fingers={view.fingers} injured={injured} />
      </div>

      <div className="mt-3.5 flex items-center gap-1.5" aria-hidden="true">
        {Array.from({ length: exercise.targetReps }, (_, index) => (
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
