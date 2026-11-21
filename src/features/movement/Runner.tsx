/**
 * The live session screen: camera picture, the tracked hand drawn over it,
 * what to do next (shown as a moving drawing as well as in words), the joint
 * read-out, and the controls.
 *
 * One component for every place a session runs: full-screen on a phone, inside
 * the phone frame on a desktop, and on the demonstration stage. It lays itself out
 * from the space it is given (container queries), so portrait, landscape and wide
 * all come from the same markup.
 *
 * It wears the patient app's own clothes: frosted white cards over the softly lit
 * ground, navy ink, gold for the thing being measured. The camera picture is the
 * one dark surface.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowCounterClockwise, Bug, CameraRotate, Check, Lifebuoy, Pause, Play, SpeakerHigh, SpeakerSlash, X } from '@phosphor-icons/react';
import { METRIC_WORDS, nearestDigit, type ResolvedAssessment } from '../../assessment/definitions';
import { QUALITY_GUIDANCE, type EnginePhase, type EngineState } from '../../assessment/engine';
import type { CameraSetup } from '../../assessment/types';
import { cameraSupport, countCameras, type CameraFailure, type Facing } from '../../camera/cameraStream';
import { Button, Spinner, cx } from '../../components/ui';
import type { Finger, Hand } from '../../domain/types';
import { DIGIT_JOINTS, FINGERS, type Grade, type JointId } from '../../tracking/geometry';
import type { LandmarkRecording } from '../../tracking/recording';
import { Cues } from './cues';
import { MovementGuide, type GuideStage } from './HandFigure';
import { LiveRun, type HelpKind, type JointReading, type LiveSnapshot, type RunResult } from './liveRun';
import {
  ADVISORY_WORD,
  FINGER_NAME,
  GRADE_WORD,
  JOINT_NAME,
  SETUP_NAME,
  SETUP_ORDER,
  VIEW_NAME,
  defaultFacing,
  defaultSetup,
  fingerWords,
  viewAdviceFor,
} from './words';

export const CAMERA_COPY: Record<CameraFailure, { title: string; body: string }> = {
  unsupported: { title: 'This browser can’t use the camera', body: 'Open Ntact in Chrome, Edge or Safari.' },
  insecure: { title: 'The camera needs the secure address', body: 'Open Ntact from its https:// link, or from localhost on this computer.' },
  denied: { title: 'The camera was blocked', body: 'Allow the camera for this site in your browser’s site settings (the icon beside the address), then try again.' },
  'no-camera': { title: 'No camera was found', body: 'Check that a camera is connected and switched on.' },
  busy: { title: 'The camera is in use', body: 'Close any other app or tab that is using the camera (a video call, for example), then try again.' },
  model: { title: 'Hand tracking couldn’t load', body: 'It needs an internet connection the first time it is used on a device. Check the connection and try again.' },
  failed: { title: 'The camera couldn’t start', body: 'Try again. If it keeps happening, reload the page.' },
};

const PREFERENCES = { setup: 'ntact.movement.setup', voice: 'ntact.movement.voice', sound: 'ntact.movement.sound' };

function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode. The choice lasts for this session only.
  }
}

const isSetup = (value: string | null): value is CameraSetup => value !== null && (SETUP_ORDER as readonly string[]).includes(value);

// ---------- Pieces ----------

const STEPS: { phases: EnginePhase[]; label: string }[] = [
  { phases: ['searching', 'positioning'], label: 'Position' },
  { phases: ['settling'], label: 'Start' },
  { phases: ['ready'], label: 'Move' },
  { phases: ['holding'], label: 'Hold' },
  { phases: ['release'], label: 'Return' },
];

function PhaseSteps({ phase }: { phase: EnginePhase }) {
  const current = phase === 'complete' ? STEPS.length : STEPS.findIndex((step) => step.phases.includes(phase));
  return (
    <ol className="flex items-start gap-1.5" aria-label="Where the session is">
      {STEPS.map((step, index) => (
        <li key={step.label} className="min-w-0 flex-1" aria-current={index === current ? 'step' : undefined}>
          <span className={cx('block h-[3px] rounded-full transition-colors duration-200', index < current ? 'bg-ink/30' : index === current ? 'bg-ink' : 'bg-ink/10')} />
          <span className={cx('mt-1.5 block truncate text-[11.5px] leading-4 short:mt-1', index === current ? 'font-bold text-ink' : 'font-medium text-ink-soft short:invisible')}>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

const GUIDE_STAGE: Record<EnginePhase, GuideStage> = {
  searching: 'start',
  positioning: 'start',
  settling: 'start',
  ready: 'move',
  holding: 'hold',
  release: 'return',
  complete: 'start',
};

const CUE_FOR: Record<GuideStage, 'start' | 'move' | 'hold' | 'release'> = { start: 'start', move: 'move', hold: 'hold', return: 'release' };

/** The hold as a ring that fills, with the count of valid repetitions inside it. Sits on the camera picture. */
function HoldRing({ state, size = 78 }: { state: EngineState | null; size?: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const holding = state?.phase === 'holding' || state?.phase === 'release';
  const amount = holding ? (state?.holdProgress ?? 0) : (state?.progress ?? 0);
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 80 80" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r={radius} fill="rgb(21 23 27 / 0.72)" stroke="rgb(255 255 255 / 0.22)" strokeWidth="5" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={holding ? '#ECB424' : 'rgb(255 255 255 / 0.7)'}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, amount)))}
        />
      </svg>
      <span className="relative text-center leading-none text-white">
        <span className="display nums block text-[26px]">{state?.validReps ?? 0}</span>
        <span className="nums mt-0.5 block text-[11px] font-semibold text-white/70">of {state?.targetReps ?? 0}</span>
      </span>
    </div>
  );
}

/**
 * One joint's estimate, drawn the way the instrument it stands beside is read:
 * a protractor scale from 20 degrees of extension to 120 of flexion, with the
 * arc filled from zero to the estimate. A solid arc is a joint seen across the
 * picture; a dotted one is depth-inferred; none at all means it was not seen.
 */
function JointDial({ label, reading }: { label: string; reading: JointReading | undefined }) {
  const grade: Grade = reading?.grade ?? 'unavailable';
  const shown = reading !== undefined && grade !== 'unavailable';
  const centreX = 50;
  const centreY = 50;
  const radius = 38;
  const low = -20;
  const high = 120;
  const angleOf = (degrees: number) => Math.PI - ((Math.min(high, Math.max(low, degrees)) - low) / (high - low)) * Math.PI;
  const at = (degrees: number, r: number) => ({ x: centreX + r * Math.cos(angleOf(degrees)), y: centreY - r * Math.sin(angleOf(degrees)) });
  const arc = (from: number, to: number) => {
    const a = at(from, radius);
    const b = at(to, radius);
    return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} A${radius} ${radius} 0 0 ${to > from ? 1 : 0} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  };
  const ticks = [-20, 0, 20, 40, 60, 80, 100, 120];
  const needle = shown ? at(reading.deg, radius) : null;
  return (
    <div className="min-w-0 text-center">
      <svg viewBox="0 0 100 58" className="mx-auto block w-full max-w-[124px] short:max-w-[92px]" aria-hidden="true">
        <path d={arc(low, high)} fill="none" stroke="#DDE3EC" strokeWidth="3" strokeLinecap="round" />
        {ticks.map((tick) => {
          const major = tick === 0 || tick === 60 || tick === 120;
          const a = at(tick, radius + 3.5);
          const b = at(tick, radius + (major ? 8.5 : 6));
          return <line key={tick} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={tick === 0 ? '#14213D' : '#97A1B5'} strokeWidth={major ? 1.3 : 0.9} />;
        })}
        {shown ? <path d={arc(0, reading.deg)} fill="none" stroke="#14213D" strokeWidth="3" strokeLinecap="round" strokeDasharray={grade === 'inferred' ? '1 5.5' : undefined} /> : null}
        {needle ? <circle cx={needle.x} cy={needle.y} r="4.2" fill="#ECB424" stroke="#14213D" strokeWidth="1.3" /> : null}
        <text x={centreX} y={centreY + 1} textAnchor="middle" fontSize="19" fontWeight="700" fill={shown ? '#14213D' : '#97A1B5'} className="nums">
          {shown ? `${reading.deg}°` : '–'}
        </text>
      </svg>
      <p className="truncate text-[12.5px] font-bold leading-4 text-ink">{label}</p>
      <p className={cx('truncate text-[11.5px] leading-4', grade === 'unavailable' ? 'text-ink-faint' : 'text-ink-soft')}>{GRADE_WORD[grade].tag}</p>
    </div>
  );
}

function JointDials({ joints, digit, list, plain }: { joints: LiveSnapshot['joints']; digit: Finger; list: readonly JointId[]; plain: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label={`${FINGER_NAME[digit]} finger, estimated flexion`}>
      {list.map((joint) => (
        <JointDial key={joint} label={plain ? JOINT_NAME[joint].plain : JOINT_NAME[joint].short} reading={joints?.[digit]?.[joint]} />
      ))}
    </div>
  );
}

function StatusChip({ snapshot }: { snapshot: LiveSnapshot }) {
  const tracking = snapshot.tracking;
  const state = tracking?.status ?? 'lost';
  const good = state === 'tracking' && (tracking?.usable ?? false);
  const text = state === 'lost' ? 'Looking for a hand' : state === 'holding' ? 'Finding hand again' : good ? 'Tracking' : 'Hand found';
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-[12.5px] font-bold leading-4 text-ink shadow-soft" role="status">
      <span className={cx('size-2 rounded-full', good ? 'bg-green-500' : state === 'lost' ? 'bg-ink/25' : 'bg-amber-400')} aria-hidden="true" />
      {text}
      {tracking?.view && state !== 'lost' ? <span className="font-medium text-ink-soft">{VIEW_NAME[tracking.view]}</span> : null}
    </span>
  );
}

function DebugPanel({ snapshot, run }: { snapshot: LiveSnapshot; run: LiveRun }) {
  const { tracking, perf, joints, engine, camera } = snapshot;
  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-3 border-t border-line py-[3px] first:border-t-0">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="nums text-right font-semibold text-ink">{value}</dd>
    </div>
  );
  return (
    <div className="quiet-scroll max-h-[44vh] overflow-y-auto rounded-[14px] border border-line bg-white/60 px-3.5 py-3 text-[12px] leading-[18px]" aria-label="Developer view">
      <p className="mb-1 text-[12.5px] font-bold text-ink">Developer view</p>
      <dl>
        {row('Frames per second', perf?.fps ? perf.fps.toFixed(1) : 'measuring')}
        {row('Model time per frame', perf?.inferenceMs != null ? `${perf.inferenceMs.toFixed(1)} ms` : snapshot.replay ? 'replay' : '–')}
        {row('Pipeline time per frame', perf?.pipelineMs != null ? `${perf.pipelineMs.toFixed(2)} ms` : '–')}
        {row('Model runs on', snapshot.delegate ?? (snapshot.replay ? 'not running' : '–'))}
        {row('Model loaded from', snapshot.modelSource ?? '–')}
        {row('Camera frame', camera ? `${camera.width}×${camera.height} ${camera.facing}${camera.facingConfirmed ? '' : ' (assumed)'}` : '–')}
        {row('Half rate', perf?.halved ? 'yes' : 'no')}
        {row('Track', tracking?.status ?? '–')}
        {row('Hand', tracking?.side ? `${tracking.side} (by ${tracking.sideSource})` : '–')}
        {row('Model label / shape', `${tracking?.modelSide ?? '–'} / ${tracking?.shapeSide ?? 'undecided'}`)}
        {row('Model label score', tracking?.modelScore != null ? tracking.modelScore.toFixed(2) : '–')}
        {row('View', tracking?.view ? `${tracking.view}, facing ${(tracking.facing ?? 0).toFixed(2)}` : '–')}
        {row('Jitter (palm lengths)', tracking ? tracking.jitter.toFixed(3) : '–')}
        {row('Palm speed (palm/s)', tracking ? tracking.palmSpeed.toFixed(2) : '–')}
        {row('Hand size in picture', tracking ? tracking.size.toFixed(2) : '–')}
        {row('Not usable because', tracking && tracking.reasons.length > 0 ? tracking.reasons.join(', ') : 'usable')}
        {engine ? row('Engine', `${engine.phase}${engine.blockers.length ? ` [${engine.blockers.join(', ')}]` : ''}`) : null}
        {engine ? row('Primary quantity', engine.primary === null ? 'not evaluable' : engine.primary.toFixed(1)) : null}
        {engine ? row('Progress to target', `${Math.round(engine.progress * 100)}%`) : null}
        {snapshot.recordingFrames > 0 ? row('Landmark frames kept', String(snapshot.recordingFrames)) : null}
      </dl>
      <table className="nums mt-2 w-full text-right">
        <thead>
          <tr className="text-ink-soft">
            <th className="text-left font-semibold">Degrees</th>
            <th className="font-semibold">MCP</th>
            <th className="font-semibold">PIP/IP</th>
            <th className="font-semibold">DIP</th>
          </tr>
        </thead>
        <tbody>
          {FINGERS.map((finger) => (
            <tr key={finger} className="border-t border-line">
              <th className="text-left font-medium text-ink-soft">{FINGER_NAME[finger]}</th>
              {(['mcp', finger === 'thumb' ? 'ip' : 'pip', 'dip'] as JointId[]).map((joint) => {
                const reading = DIGIT_JOINTS[finger].includes(joint) ? joints?.[finger]?.[joint] : undefined;
                return (
                  <td key={joint} className={reading?.grade === 'direct' ? 'font-bold text-ink' : reading?.grade === 'unavailable' ? 'text-ink-faint line-through' : 'text-ink-soft'}>
                    {reading ? reading.deg : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11.5px] leading-4 text-ink-soft">
        Bold: joint seen across the picture. Grey: depth-inferred. Struck through: hidden. Cyan squares on the picture are the model’s raw landmarks; crosses mark landmarks
        the occlusion check thinks are hidden.
      </p>
      <button
        type="button"
        className="mt-2 text-[12.5px] font-bold text-ink underline underline-offset-2"
        onClick={() => {
          const recording = run.exportRecording('Ntact landmark recording');
          if (!recording) return;
          const url = URL.createObjectURL(new Blob([JSON.stringify(recording)], { type: 'application/json' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = `ntact-landmarks-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
          link.click();
          URL.revokeObjectURL(url);
        }}
      >
        Save landmark recording (no video)
      </button>
    </div>
  );
}

// ---------- Help for someone who is finding it difficult ----------

interface HelpContent {
  title: string;
  lead: string;
  tips: string[];
  /** What the drawing shows. Undefined plays the whole movement. */
  stage: GuideStage | undefined;
  /** Whether finishing now is the suggested way on, rather than carrying on. */
  finishFirst: boolean;
}

function helpContent(kind: HelpKind, setup: ResolvedAssessment, camera: CameraSetup, shortfalls: number): HelpContent {
  const advice = viewAdviceFor(setup, camera);
  if (kind === 'movement') {
    return {
      title: 'Only go as far as is comfortable',
      lead: 'You do not have to reach the full position. Never push or force a finger, and stop if it hurts.',
      tips: [
        'This assessment is set to recognise a certain amount of movement. If yours is smaller today, that is useful for your therapist to know. It is not a failure.',
        shortfalls > 0
          ? `${shortfalls === 1 ? 'One try has' : `${shortfalls} tries have`} been saved as “did not reach the set position”, with how far the movement went.`
          : 'A try that falls short is saved as “did not reach the set position”, with how far the movement went.',
        'You can finish here. Your therapist can see what was recorded and can change the setting.',
      ],
      stage: undefined,
      finishFirst: true,
    };
  }
  if (kind === 'hold') {
    return {
      title: 'Holding the position',
      lead: 'A repetition is recorded once the position has been held until the ring is full.',
      tips: [
        `Keep still and count slowly to ${Math.max(2, Math.ceil(setup.params.holdSeconds))} before letting go.`,
        'Keep your hand in the same place in the picture while you hold.',
        'If holding is uncomfortable, stop. Your therapist can shorten the hold.',
      ],
      stage: 'hold',
      finishFirst: false,
    };
  }
  if (kind === 'tracking') {
    return {
      title: 'The camera keeps losing your hand',
      lead: 'Nothing is recorded while the tracking is unsteady. A few changes usually settle it.',
      tips: [
        'Light your hand from the front: face a window or a lamp.',
        'Use a plain background, and keep your other hand out of the picture.',
        camera === 'phone-held' ? 'Rest the elbow of the arm holding the phone on the table, or lean the phone against something.' : 'Hold your hand in one place, about half an arm’s length from the camera.',
        'Move slowly into each position.',
      ],
      stage: 'start',
      finishFirst: false,
    };
  }
  return {
    title: 'Getting into the starting position',
    lead: 'The app needs to see your whole hand, in the starting position, before it begins. The drawing shows it.',
    tips: [advice.place, 'Keep the whole hand in the picture, with your fingers straight.', 'Hold still for a second once you are there.', 'Face a window or a lamp so your hand is well lit.'],
    stage: 'start',
    finishFirst: false,
  };
}

function HelpSheet({ content, setup, hand, camera, onCarryOn, onFinish }: { content: HelpContent; setup: ResolvedAssessment; hand: Hand; camera: CameraSetup; onCarryOn(): void; onFinish(): void }) {
  const carryOn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    carryOn.current?.focus();
  }, []);
  return (
    <div className="absolute inset-0 z-20 grid place-items-center rounded-[26px] bg-canvas/80 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={content.title}>
      <div className="quiet-scroll dialog-in max-h-full w-full max-w-[560px] overflow-y-auto rounded-[26px] bg-white p-5 shadow-pop @2xl:p-6">
        <div className="grid items-center gap-4 @xl:grid-cols-[150px_minmax(0,1fr)]">
          <MovementGuide setup={setup} hand={hand} camera={camera} stage={content.stage} caption={false} className="mx-auto w-[130px] @xl:w-full" />
          <div>
            <h2 className="display text-[22px] leading-[1.18] text-ink">{content.title}</h2>
            <p className="mt-1.5 text-[15px] leading-[22px] text-ink-soft">{content.lead}</p>
          </div>
        </div>
        <ul className="mt-4 space-y-2.5 border-t border-line-soft pt-4">
          {content.tips.map((tip) => (
            <li key={tip} className="flex gap-3 text-[14.5px] leading-[21px] text-ink">
              <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-mint" aria-hidden="true" />
              <span>{tip}</span>
            </li>
          ))}
        </ul>
        <div className={cx('mt-5 flex flex-col gap-2 @md:flex-row', content.finishFirst && '@md:flex-row-reverse')}>
          <Button ref={carryOn} variant={content.finishFirst ? 'outline' : 'primary'} size="md" className="flex-1" onClick={onCarryOn}>
            Carry on
          </Button>
          <Button variant={content.finishFirst ? 'primary' : 'outline'} size="md" className="flex-1" onClick={onFinish}>
            Finish here
          </Button>
        </div>
        <p className="mt-3 text-center text-[12px] leading-4 text-ink-soft">The session is paused while this is open.</p>
      </div>
    </div>
  );
}

const OFFER_WORD: Record<HelpKind, string> = {
  movement: 'Finding the movement difficult?',
  hold: 'Finding it hard to hold?',
  position: 'Not getting started?',
  tracking: 'The camera keeps losing your hand?',
};

const NO_SUBSCRIPTION = (): (() => void) => () => undefined;
const IDLE: LiveSnapshot = {
  status: 'idle',
  failure: null,
  engine: null,
  tracking: null,
  joints: null,
  opposition: null,
  perf: null,
  camera: null,
  mirrored: true,
  delegate: null,
  modelSource: null,
  modelLoadMs: null,
  replay: false,
  recordingFrames: 0,
  help: null,
};
const IDLE_SNAPSHOT = (): LiveSnapshot => IDLE;

// ---------- The runner ----------

export interface RunnerProps {
  /** The assessment to run, or null to show free tracking with nothing recorded. */
  setup: ResolvedAssessment | null;
  hand: Hand;
  title: string;
  /** A recording to play instead of the camera. Always labelled on screen. */
  recording?: LandmarkRecording | null;
  /** Plain joint names and less detail (patient) or clinical terms (presentation). */
  audience: 'patient' | 'clinical';
  /** Start as soon as the screen opens, where the browser allows it, instead of waiting on the setup card. */
  autoStart?: boolean;
  allowDebug?: boolean;
  debugInitially?: boolean;
  onClose?(): void;
  onFinished(result: RunResult): void;
  /** Offered when the camera cannot be used. */
  onUseBackup?(): void;
  className?: string;
}

const iconButton = 'glass grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-white';
const card = 'glass rounded-[22px] px-4 py-3.5 short:rounded-[18px] short:px-3 short:py-2';

export function Runner({ setup, hand, title, recording = null, audience, autoStart = false, allowDebug = false, debugInitially = false, onClose, onFinished, onUseBackup, className }: RunnerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const [cameraSetup, setCameraSetup] = useState<CameraSetup>(() => {
    const saved = typeof window === 'undefined' ? null : readPreference(PREFERENCES.setup);
    return isSetup(saved) ? saved : defaultSetup();
  });
  const [facing, setFacing] = useState<Facing>(() => defaultFacing(cameraSetup));
  const [voice, setVoice] = useState(() => typeof window !== 'undefined' && readPreference(PREFERENCES.voice) === 'on');
  const [sound, setSound] = useState(() => typeof window === 'undefined' || readPreference(PREFERENCES.sound) !== 'off');
  const [debug, setDebug] = useState(debugInitially);
  const [cameras, setCameras] = useState(1);
  /** Bumped to throw the session away and make a new one. */
  const [attempt, setAttempt] = useState(0);
  const [begun, setBegun] = useState(autoStart || recording !== null);
  /** The help sheet that is open, and the kinds already offered and put aside. */
  const [helpOpen, setHelpOpen] = useState<HelpKind | null>(null);
  const [dismissed, setDismissed] = useState<HelpKind[]>([]);

  // One run per attempt. Made in an effect, so that leaving the screen (or React re-running the effect) always lets go of the camera.
  const [run, setRun] = useState<LiveRun | null>(null);
  const choices = useRef({ cameraSetup, facing, begun });
  choices.current = { cameraSetup, facing, begun };
  useEffect(() => {
    const created = new LiveRun({
      setup,
      hand,
      cameraSetup: choices.current.cameraSetup,
      facing: choices.current.facing,
      recording,
      capture: allowDebug,
      onFinished: (result) => finishedRef.current(result),
    });
    created.attach(videoRef.current, canvasRef.current, stageRef.current);
    setRun(created);
    setHelpOpen(null);
    setDismissed([]);
    // A recording needs no permission and no tap; neither does a session that was asked to start by itself.
    if (choices.current.begun) void created.start().then(() => countCameras().then(setCameras));
    return () => {
      created.dispose();
      setRun(null);
    };
  }, [attempt, setup, hand, recording, allowDebug]);

  const snapshot = useSyncExternalStore(run?.subscribe ?? NO_SUBSCRIPTION, run?.getSnapshot ?? IDLE_SNAPSHOT, run?.getSnapshot ?? IDLE_SNAPSHOT);

  useEffect(() => {
    if (!run) return;
    run.debug = debug;
    run.labels = audience === 'clinical' || debug;
    run.cues.voice = voice;
    run.cues.sound = sound;
  }, [run, debug, voice, sound, audience]);

  const start = useCallback(() => {
    if (!run) return;
    setBegun(true);
    run.configure({ cameraSetup, facing });
    void run.start().then(() => countCameras().then(setCameras));
  }, [run, cameraSetup, facing]);

  const openHelp = useCallback(
    (kind: HelpKind) => {
      run?.pause();
      setHelpOpen(kind);
    },
    [run],
  );
  const closeHelp = useCallback(() => {
    if (helpOpen) setDismissed((list) => (list.includes(helpOpen) ? list : [...list, helpOpen]));
    setHelpOpen(null);
    run?.resume();
  }, [run, helpOpen]);

  const [freeDigit, setFreeDigit] = useState<Finger>('index');
  useEffect(() => {
    if (run) run.focusDigit = freeDigit;
  }, [run, freeDigit]);

  const support = cameraSupport();
  const engine = snapshot.engine;
  const status = snapshot.status;
  const live = status === 'live' || status === 'interrupted';
  const failure = snapshot.failure;
  const advice = setup ? viewAdviceFor(setup, cameraSetup) : null;
  const plain = audience === 'patient';
  const feedback = engine?.feedback ?? null;
  const freeReason = snapshot.tracking?.reasons[0];
  // Free tracking gives the same guidance an assessment would, without the "hold still" that only matters before a measurement.
  const freeText = !setup && snapshot.tracking ? (freeReason && freeReason !== 'settling' ? QUALITY_GUIDANCE[freeReason] : 'Tracking. Move your fingers') : null;
  const banner = feedback?.text ?? freeText;
  const tone = feedback?.tone ?? (snapshot.tracking?.usable ? 'good' : 'guide');
  const recordingNow = engine !== null && !engine.paused && ['ready', 'holding', 'release'].includes(engine.phase);
  const advisory = snapshot.tracking?.advisories[0];
  const wrongHand = snapshot.tracking?.sideConfirmed && snapshot.tracking.side !== null && snapshot.tracking.side !== hand && setup !== null;
  // Side-on, the read-out follows the finger the camera can actually see.
  const seenDigit = snapshot.tracking?.view ? nearestDigit(snapshot.tracking.view) : null;
  const shownDigit: Finger = setup ? (setup.definition.digits === 'fingers' && seenDigit ? seenDigit : setup.focus) : freeDigit;
  const opposition = setup?.definition.primary === 'opposition';
  const guideStage = GUIDE_STAGE[engine?.phase ?? 'searching'];
  const offered = snapshot.help && !dismissed.includes(snapshot.help) && helpOpen === null ? snapshot.help : null;
  const shortfalls = engine?.rejectedBy['target-not-reached'] ?? 0;
  const before = status === 'idle' && !begun;
  const lastRejection = engine?.lastEvent?.type === 'attempt-rejected' && engine.phase !== 'complete' ? engine.lastEvent.reason : null;
  const fallbackHelp: HelpKind = engine?.phase === 'ready' ? 'movement' : engine?.phase === 'holding' ? 'hold' : 'position';

  return (
    <div className={cx('@container relative flex min-h-0 flex-1 flex-col text-ink', className)}>
      <header className="flex shrink-0 items-center gap-3">
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close" className={iconButton}>
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[18px] font-bold leading-6 tracking-[-0.02em]">{title}</h1>
          {setup ? (
            <p className="truncate text-[12.5px] leading-4 text-ink-soft short:hidden">
              {hand === 'left' ? 'Left' : 'Right'} hand{setup.definition.digits === 'one-finger' ? `, ${fingerWords(setup.focus)}` : ''}. Demonstration assessment
            </p>
          ) : null}
        </div>
        <span className={cx('shrink-0 rounded-full px-3 py-1 text-[12px] font-bold leading-5', recording ? 'border border-dashed border-ink/40 text-ink-soft' : 'bg-mint text-ink')}>
          {recording ? 'Synthetic replay' : 'Live camera'}
        </span>
      </header>

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-4 short:mt-2 @3xl:flex-row @3xl:gap-5">
        {/* The picture */}
        <div ref={stageRef} className={cx('relative min-h-[240px] flex-1 overflow-hidden rounded-[26px] short:min-h-0', before || status === 'error' ? 'glass' : 'bg-navy-950 shadow-raised')}>
          <video
            ref={videoRef}
            muted
            playsInline
            className={cx('absolute inset-0 size-full object-cover', snapshot.mirrored && '-scale-x-100', (recording !== null || !live) && 'opacity-0')}
            aria-hidden="true"
          />
          <canvas ref={canvasRef} className={cx('pointer-events-none absolute inset-0 size-full', !live && 'opacity-0')} aria-hidden="true" />

          {live ? (
            <>
              <div className="absolute left-3 top-3 flex flex-col items-start gap-2">
                <StatusChip snapshot={snapshot} />
                {setup ? <HoldRing state={engine} /> : null}
              </div>
              <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
                {setup ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-[12.5px] font-bold leading-4 text-ink shadow-soft">
                    <span className={cx('size-2 rounded-full', recordingNow ? 'bg-wine-600' : 'bg-ink/25')} aria-hidden="true" />
                    {engine?.paused ? 'Paused' : recordingNow ? 'Recording estimates' : 'Standing by'}
                  </span>
                ) : null}
                {/* On a narrow screen the drawing of what to do sits on the picture; on a wide one it has its own place beside it. */}
                {setup && !engine?.paused ? (
                  <div className="w-[96px] rounded-[18px] bg-white/95 p-1 shadow-soft short:hidden @3xl:hidden" aria-hidden="true">
                    <MovementGuide setup={setup} hand={hand} camera={cameraSetup} stage={guideStage} caption={false} />
                  </div>
                ) : null}
                {recording ? (
                  <span className="hidden max-w-[240px] rounded-[12px] bg-white/95 px-3 py-1.5 text-right text-[11.5px] font-medium leading-4 text-ink-soft shadow-soft @3xl:block">
                    A drawn hand from the kinematic model. Not a person, and not a measurement.
                  </span>
                ) : null}
              </div>

              {snapshot.tracking?.status === 'lost' && !recording ? (
                <div className="pointer-events-none absolute inset-[14%] rounded-[28px] border-2 border-dashed border-white/40" aria-hidden="true" />
              ) : null}

              <div className="absolute inset-x-3 bottom-3 flex flex-col items-center gap-2">
                {wrongHand ? (
                  <p className="rounded-full bg-amber-100 px-3.5 py-1.5 text-center text-[12.5px] font-bold leading-4 text-amber-700">
                    This looks like your {snapshot.tracking?.side} hand. This assessment is set for your {hand} hand.
                  </p>
                ) : advisory ? (
                  <p className="rounded-full bg-white/95 px-3.5 py-1.5 text-center text-[12.5px] font-medium leading-4 text-ink-soft shadow-soft">{ADVISORY_WORD[advisory]}</p>
                ) : null}
                {status === 'interrupted' ? (
                  <p className="cue-in rounded-[16px] bg-white px-5 py-3 text-center text-[16px] font-bold leading-6 text-ink shadow-raised" role="status">
                    The camera stopped. Bringing it back…
                  </p>
                ) : banner ? (
                  <p
                    key={banner}
                    className={cx(
                      'cue-in w-fit max-w-full rounded-[18px] px-5 py-3 text-center text-[clamp(16px,2.5cqw,21px)] font-bold leading-[1.25] shadow-raised',
                      tone === 'good' ? 'bg-mint text-ink' : tone === 'active' ? 'bg-white text-ink' : tone === 'caution' ? 'bg-amber-100 text-amber-700' : 'bg-navy-950/80 text-white',
                    )}
                    role="status"
                    aria-live="polite"
                  >
                    {banner}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          {/* Before the camera: the movement, shown; how to set up; then one tap to begin. */}
          {before ? (
            <div className="quiet-scroll absolute inset-0 overflow-y-auto px-5 py-5">
              <div className="mx-auto flex min-h-full max-w-[720px] flex-col justify-center gap-5 @2xl:flex-row @2xl:items-center @2xl:gap-8">
                {setup ? (
                  <div className="mx-auto w-full max-w-[180px] shrink-0 @2xl:max-w-[250px]">
                    <MovementGuide setup={setup} hand={hand} camera={cameraSetup} />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <h2 className="display text-[23px] leading-[1.15]">How are you using the camera?</h2>
                  <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="How the camera is being used">
                    {SETUP_ORDER.map((option) => {
                      const selected = option === cameraSetup;
                      return (
                        <button
                          key={option}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => {
                            setCameraSetup(option);
                            setFacing(defaultFacing(option));
                            writePreference(PREFERENCES.setup, option);
                          }}
                          className={cx(
                            'min-h-[62px] rounded-[14px] border px-3 py-2 text-left transition-colors duration-150',
                            selected ? 'border-ink bg-white shadow-[inset_0_0_0_1px_var(--color-ink)]' : 'border-white/80 bg-white/70 shadow-soft hover:bg-white',
                          )}
                        >
                          <span className="block text-[14px] font-bold leading-5">{SETUP_NAME[option].title}</span>
                          <span className="block text-[12px] leading-4 text-ink-soft">{SETUP_NAME[option].line}</span>
                        </button>
                      );
                    })}
                  </div>

                  {advice ? (
                    <div className="mt-3 rounded-[16px] bg-mint-soft px-4 py-3">
                      <p className="text-[12.5px] font-bold leading-4 text-amber-700">{VIEW_NAME[advice.view]}</p>
                      <p className="mt-0.5 text-[14.5px] leading-[21px] text-ink">{advice.place}</p>
                      {advice.caution ? <p className="mt-1.5 text-[13px] leading-5 text-amber-700">{advice.caution}</p> : null}
                    </div>
                  ) : (
                    <p className="mt-3 text-[14.5px] leading-[21px] text-ink-soft">Hold your hand in front of the camera, about half an arm’s length away, with the whole hand in the picture.</p>
                  )}

                  {cameraSetup !== 'laptop' ? (
                    <div className="mt-3 flex items-center justify-between gap-3 text-[13.5px] leading-5">
                      <span className="text-ink-soft">Camera</span>
                      <div className="flex rounded-[12px] bg-ink/[0.06] p-1" role="radiogroup" aria-label="Which camera">
                        {(['user', 'environment'] as Facing[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={facing === option}
                            onClick={() => setFacing(option)}
                            className={cx('min-h-10 rounded-[9px] px-3.5 text-[13.5px] font-bold', facing === option ? 'bg-white text-ink shadow-soft' : 'text-ink-soft')}
                          >
                            {option === 'user' ? 'Front' : 'Rear'}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {Cues.voiceAvailable ? (
                    <label className="mt-2 flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[13.5px] leading-5 text-ink-soft">
                      <span>Spoken instructions{facing === 'environment' ? ' (useful when you can’t see the screen)' : ''}</span>
                      <input
                        type="checkbox"
                        checked={voice}
                        onChange={(event) => {
                          setVoice(event.target.checked);
                          writePreference(PREFERENCES.voice, event.target.checked ? 'on' : 'off');
                        }}
                        className="size-5 accent-[#14213D]"
                      />
                    </label>
                  ) : null}

                  {support.supported ? (
                    <Button variant="primary" size="lg" block className="mt-3" onClick={start}>
                      Start camera
                    </Button>
                  ) : (
                    <p className="mt-3 rounded-[14px] bg-amber-100 px-4 py-3 text-[14px] leading-5 text-amber-700" role="alert">
                      {CAMERA_COPY[support.reason].title}. {CAMERA_COPY[support.reason].body}
                    </p>
                  )}
                  {onUseBackup ? (
                    <button type="button" onClick={onUseBackup} className="mt-2 min-h-11 w-full text-center text-[13.5px] font-semibold text-ink-soft underline underline-offset-4">
                      Run the labelled synthetic replay instead
                    </button>
                  ) : null}
                  <p className="mt-1 text-center text-[12px] leading-4 text-ink-soft">The video stays on this device. Nothing is recorded or uploaded.</p>
                </div>
              </div>
            </div>
          ) : null}

          {status === 'starting' || (status === 'idle' && begun) ? (
            <div className="absolute inset-0 grid place-items-center px-8 text-center text-white">
              <div>
                <Spinner className="mx-auto size-7 text-mint" />
                <p className="mt-4 text-[17px] font-bold leading-6">{recording ? 'Starting' : 'Starting the camera'}</p>
                {!recording ? <p className="mt-1.5 text-[14px] leading-5 text-white/70">Your browser will ask to use the camera. Hand tracking takes a few seconds to load the first time.</p> : null}
              </div>
            </div>
          ) : null}

          {status === 'error' && failure ? (
            <div className="absolute inset-0 grid place-items-center px-7 text-center" role="alert">
              <div className="max-w-[380px]">
                <p className="display text-[23px] leading-7 text-ink">{CAMERA_COPY[failure].title}</p>
                <p className="mt-2 text-[15px] leading-6 text-ink-soft">{CAMERA_COPY[failure].body}</p>
                <div className="mt-5 space-y-2">
                  <Button variant="primary" size="md" block onClick={() => setAttempt((value) => value + 1)}>
                    Try again
                  </Button>
                  {onUseBackup ? (
                    <Button variant="outline" size="md" block onClick={onUseBackup}>
                      Run the labelled synthetic replay instead
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Beside (wide) or below (narrow) the picture. Not shown until the session has begun, or when the camera failed: those states have the whole screen. */}
        <aside className={cx('no-scrollbar shrink-0 flex-col gap-3.5 short:gap-2 @3xl:min-h-0 @3xl:w-[320px] @3xl:overflow-y-auto @5xl:w-[360px]', before || status === 'error' ? 'hidden' : 'flex')}>
          {setup ? (
            <>
              <div className={card}>
                <div className="mb-3 hidden items-center gap-3 short:!hidden @3xl:flex">
                  <MovementGuide setup={setup} hand={hand} camera={cameraSetup} stage={guideStage} caption={false} className="w-[124px] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-bold leading-4 text-teal-600">What to do now</p>
                    <p className="mt-0.5 text-[16px] font-bold leading-[21px] tracking-[-0.01em] text-ink">{setup.definition.cues[CUE_FOR[guideStage]]}</p>
                  </div>
                </div>
                <PhaseSteps phase={engine?.phase ?? 'searching'} />
              </div>
              <div className={card}>
              {opposition ? (
                <div className="py-1 text-center">
                  <p className="text-[12.5px] font-semibold leading-4 text-ink-soft">{METRIC_WORDS.opposition.label}</p>
                  <p className="display nums mt-0.5 text-[30px] leading-9 text-ink">{snapshot.opposition !== null && snapshot.tracking?.status !== 'lost' ? snapshot.opposition.toFixed(2) : '–'}</p>
                  <p className="text-[12px] leading-4 text-ink-soft">palm lengths. About 0.2 when the tips touch.</p>
                </div>
              ) : (
                <div>
                  <p className="mb-1 flex items-baseline justify-between text-[12.5px] leading-4 text-ink-soft">
                    <span className="font-bold text-ink">{FINGER_NAME[shownDigit]} finger</span>
                    <span>estimated flexion</span>
                  </p>
                  <JointDials joints={snapshot.joints} digit={shownDigit} list={setup.definition.joints} plain={plain} />
                  {setup.definition.digits === 'fingers' && seenDigit && seenDigit !== setup.focus ? (
                    <p className="mt-1.5 text-[12px] leading-4 text-ink-soft short:hidden">Side-on, only the finger nearest the camera can be read.</p>
                  ) : null}
                </div>
              )}
              <p className="nums mt-3 border-t border-line-soft pt-2.5 text-[13.5px] leading-5 text-ink-soft short:mt-1.5 short:pt-1.5" role="status">
                <span className="font-bold text-ink">
                  {engine?.validReps ?? 0} of {engine?.targetReps ?? Math.round(setup.params.reps)}
                </span>{' '}
                valid repetitions
                {engine && engine.rejectedReps > 0 ? `, ${engine.rejectedReps} not recorded` : ''}
                {lastRejection ? (
                  <span className="mt-0.5 block text-ink-soft">
                    {lastRejection === 'target-not-reached'
                      ? 'That one did not reach the set position, so it is not counted. Only go as far as is comfortable.'
                      : 'The last one could not be captured reliably. It is not counted; carry on when you are ready.'}
                  </span>
                ) : null}
              </p>
              </div>
              {offered ? (
                <div className="cue-in flex items-center justify-between gap-3 rounded-[18px] bg-mint-soft px-4 py-3 shadow-soft">
                  <p className="text-[13.5px] font-semibold leading-5 text-ink">{OFFER_WORD[offered]}</p>
                  <Button variant="primary" size="sm" onClick={() => openHelp(offered)}>
                    Get help
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <div className={card}>
              <div className="mb-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Finger to read out">
                {FINGERS.filter((finger) => finger !== 'thumb').map((finger) => (
                  <button
                    key={finger}
                    type="button"
                    role="radio"
                    aria-checked={freeDigit === finger}
                    onClick={() => setFreeDigit(finger)}
                    className={cx('min-h-10 rounded-full px-3.5 text-[13px] font-bold', freeDigit === finger ? 'bg-ink text-mint shadow-button' : 'bg-ink/[0.06] text-ink-soft hover:bg-ink/10')}
                  >
                    {FINGER_NAME[finger]}
                  </button>
                ))}
              </div>
              <JointDials joints={snapshot.joints} digit={shownDigit} list={['mcp', 'pip', 'dip']} plain={plain} />
              <p className="mt-3 border-t border-line-soft pt-3 text-[13px] leading-5 text-ink-soft">
                Live estimates of flexion, zero being straight. A solid arc is a joint seen across the picture; a dotted arc is depth-inferred. Nothing is being recorded on this screen.
              </p>
            </div>
          )}

          {allowDebug && debug && run ? <DebugPanel snapshot={snapshot} run={run} /> : null}

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            {setup ? (
              <>
                <Button variant="outline" size="md" className="min-w-[100px] flex-1" disabled={!live || engine?.phase === 'complete'} onClick={() => (engine?.paused ? run?.resume() : run?.pause())}>
                  {engine?.paused ? <Play size={16} weight="fill" aria-hidden="true" /> : <Pause size={16} weight="fill" aria-hidden="true" />}
                  {engine?.paused ? 'Resume' : 'Pause'}
                </Button>
                <Button variant="outline" size="md" className="min-w-[100px] flex-1" disabled={!live} onClick={() => run?.restart()}>
                  <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />
                  Restart
                </Button>
                <Button variant="primary" size="md" className="min-w-[100px] flex-1" disabled={!live} onClick={() => run?.finish()}>
                  <Check size={16} weight="bold" aria-hidden="true" />
                  Finish
                </Button>
              </>
            ) : null}
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {setup ? (
                  <button type="button" onClick={() => openHelp(snapshot.help ?? fallbackHelp)} disabled={!live} aria-label="Help with this assessment" className={cx(iconButton, 'disabled:opacity-40')}>
                    <Lifebuoy size={19} aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setSound((value) => {
                      writePreference(PREFERENCES.sound, value ? 'off' : 'on');
                      return !value;
                    });
                  }}
                  aria-label={sound ? 'Turn sounds off' : 'Turn sounds on'}
                  aria-pressed={sound}
                  className={iconButton}
                >
                  {sound ? <SpeakerHigh size={19} aria-hidden="true" /> : <SpeakerSlash size={19} aria-hidden="true" />}
                </button>
                {!recording && cameras > 1 && live ? (
                  <button type="button" onClick={() => void run?.flip()} aria-label="Switch between the front and rear cameras" className={iconButton}>
                    <CameraRotate size={20} aria-hidden="true" />
                  </button>
                ) : null}
                {allowDebug ? (
                  <button type="button" onClick={() => setDebug((value) => !value)} aria-label="Developer view" aria-pressed={debug} className={cx(iconButton, debug && '!border-ink !bg-ink !text-white')}>
                    <Bug size={19} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <p className="text-right text-[11.5px] leading-4 text-ink-soft short:hidden">{recording ? 'Synthetic landmarks. No camera in use.' : 'Video stays on this device. Nothing is recorded.'}</p>
            </div>
          </div>
        </aside>
      </div>

      {helpOpen && setup ? (
        <HelpSheet
          content={helpContent(helpOpen, setup, cameraSetup, shortfalls)}
          setup={setup}
          hand={hand}
          camera={cameraSetup}
          onCarryOn={closeHelp}
          onFinish={() => {
            setHelpOpen(null);
            run?.finish();
          }}
        />
      ) : null}
    </div>
  );
}
