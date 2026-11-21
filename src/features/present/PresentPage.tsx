/**
 * The technical demonstration: five sections, one screen, built to be shared.
 *
 *   1  What it measures      what a camera can and cannot estimate
 *   2  Live tracking         real landmarks and changing joint-angle estimates
 *   3  Movement assessment   one assessment from start to finish
 *   4  Results               what was just captured, with its quality and limits
 *   5  Clinician view        sessions over time, beside the sensory test
 *
 * Keys: 1 to 5 jump to a section, left and right step through them, F is full
 * screen, B switches between the camera and the labelled synthetic replay, N
 * shows the speaker's notes, R resets what was captured here.
 *
 * Nothing shown here is staged. Sections 2 and 3 run the same tracker and engine
 * as the patient app. When the camera cannot be used, the backup is a synthetic
 * sequence that is labelled as synthetic on screen and in what it saves.
 *
 * It looks like the rest of the app: frosted white cards on the softly lit ground,
 * navy ink, gold for the one thing to look at. The camera picture is the only dark surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowsOut, ArrowLeft, ArrowRight, ArrowCounterClockwise, Notepad } from '@phosphor-icons/react';
import { DEFINITIONS, recommendedView, resolveAssessment } from '../../assessment/definitions';
import { previousOf, sessionsOf } from '../../assessment/session';
import type { AssessmentId, AssessmentSession } from '../../assessment/types';
import { useActivePatient, useDemoState, useToday } from '../../app/hooks';
import { Button, cx } from '../../components/ui';
import { demoStore } from '../../demo/store';
import type { Hand } from '../../domain/types';
import { CHAIN } from '../../tracking/geometry';
import { postureOf } from '../../tracking/handModel';
import { AssessmentReviewPanel } from '../clinician/AssessmentPanel';
import { AssessmentFlow } from '../movement/AssessmentFlow';
import { ART_LIGHT } from '../movement/handArt';
import { HandSvg, MovementGuide, posePoints } from '../movement/HandFigure';
import { Runner } from '../movement/Runner';
import { SessionReport } from '../movement/SessionReport';
import { syntheticFreeTracking } from '../movement/syntheticDemo';
import { ESTIMATE_NOTE, GRADE_WORD, VIEW_NAME } from '../movement/words';
import { Preflight } from './Preflight';

const SECTIONS = [
  { key: 'measures', title: 'What it measures' },
  { key: 'tracking', title: 'Live tracking' },
  { key: 'assessment', title: 'Movement assessment' },
  { key: 'results', title: 'Results' },
  { key: 'clinician', title: 'Clinician view' },
] as const;

/** What to say, section by section. The full script is in docs/DEMO_SCRIPT.md. */
const NOTES: string[] = [
  'Ntact has two halves. The wearable measures and assists touch. This is the other half: a camera estimating how the finger joints move. It runs entirely on the device. It estimates angles; it does not measure sensation, and it has not been validated against goniometry yet. That is what we would like to do with you.',
  'These are live landmarks from the camera: 21 points, smoothed, with an angle estimate at each joint. Turn the hand side-on and the dials change from dotted, “depth-inferred”, to solid, “in view”: the software knows when a bend lies across the picture and when it is relying on the model’s depth. Cover a finger and it reads “not seen” rather than guessing.',
  'A composite fist, start to finish. The drawing shows what to do. The engine waits for the start position, detects the fist, counts a hold only while tracking is usable, and records the repetition when the hand opens again. Let one go early to show a rejected attempt: it is counted separately and never averaged in.',
  'This is what was just captured. Completion is kept apart from the estimates. Each joint carries how it was seen, and the capture quality is recorded with the session, so a clinician can tell a change in the hand from a change in the camera.',
  'Over time, in the clinician record. The dashed line is illustrative example data and is marked as such; sessions from a camera are solid. A session taken from a different view is left off the line. Below it, the sensory test from the wearable on the same dates: two different things, shown side by side, never merged into a score.',
];

// ---------- Section 1 ----------

/** An open hand with every landmark marked and the three joints of the index finger named. Drawn from the kinematic model. */
function LandmarkDiagram() {
  const points = useMemo(() => posePoints(postureOf('open', 'right'), { yaw: 0, pitch: 4 }), []);
  const [mcp, pip, dip] = CHAIN.index;
  const named = [
    { index: dip, text: 'DIP' },
    { index: pip, text: 'PIP' },
    { index: mcp, text: 'MCP' },
  ];
  return (
    <figure>
      <HandSvg points={points} style={ART_LIGHT} highlight={['index']} label="An open hand with its 21 tracked landmarks marked, and the MCP, PIP and DIP joints of the index finger named">
        {points.map((point, index) => (
          <circle key={index} cx={point.x} cy={point.y} r="0.95" fill="#14213D" />
        ))}
        {named.map(({ index, text }) => (
          // The names sit in a column clear of the hand, each joined to its joint by a rule.
          <g key={text}>
            <circle cx={points[index].x} cy={points[index].y} r="2.6" fill="none" stroke="#14213D" strokeWidth="0.7" />
            <line x1={points[index].x - 2.6} y1={points[index].y} x2="12.5" y2={points[index].y} stroke="#14213D" strokeWidth="0.45" />
            <text x="11.5" y={points[index].y + 1.5} textAnchor="end" fontSize="4.4" fontWeight="700" fill="#14213D">
              {text}
            </text>
          </g>
        ))}
      </HandSvg>
      <figcaption className="mt-1 text-center text-[12.5px] leading-5 text-ink-soft">21 landmarks per hand. A drawing from the app’s hand model, not a picture of a person.</figcaption>
    </figure>
  );
}

const PIPELINE = [
  { title: 'Camera', line: 'On the device. No video is stored or sent.' },
  { title: 'Landmarks', line: 'MediaPipe Hand Landmarker, 21 points per hand.' },
  { title: 'Stabilise', line: 'Reject jumps, bridge gaps, One Euro filter.' },
  { title: 'Geometry', line: 'Palm axes, then an angle at each joint.' },
  { title: 'Quality', line: 'Framing, steadiness, view, hidden joints.' },
  { title: 'Assessment', line: 'Start, target, hold, return.' },
  { title: 'Record', line: 'Estimates, how each was seen, how it was captured.' },
];

const FACTS = [
  {
    title: 'What the camera sees',
    body: '21 landmarks on the hand, in the picture and as a 3-D estimate, about thirty times a second. All of it is computed on the device.',
  },
  {
    title: 'What is estimated',
    body: 'Flexion at the MCP, PIP and DIP joints of each finger, the thumb’s two joints, how long a position is held, and how consistent repetitions are.',
  },
  {
    title: 'What is not claimed',
    body: 'These are estimates from one view. They have not been compared with goniometry, they are not diagnostic, and no figure here says how recovery is going.',
  },
];

function MeasuresSection() {
  return (
    <div className="quiet-scroll h-full overflow-y-auto">
      <div className="@container mx-auto max-w-[1160px] pb-4">
        <div className="grid items-start gap-x-12 gap-y-6 @4xl:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <h1 className="display max-w-[20ch] text-[clamp(30px,4.4cqw,52px)] leading-[1.04] text-ink">Estimating finger-joint movement from an ordinary camera.</h1>
            <p className="mt-4 max-w-[62ch] text-[clamp(15px,1.45cqw,18px)] leading-[1.55] text-ink-soft">
              The wearable measures and assists touch. This is the other half of Ntact: software that follows the joints of the
              fingers through a set movement and records how far they appear to bend, so that change can be seen over weeks. It
              complements the sensory test. It does not replace it, and it does not measure sensation.
            </p>

            <dl className="mt-6 grid gap-3 @2xl:grid-cols-3">
              {FACTS.map((fact) => (
                <div key={fact.title} className="glass rounded-[22px] px-5 py-4">
                  <dt className="text-[15.5px] font-bold leading-6 text-ink">{fact.title}</dt>
                  <dd className="mt-1 text-[14px] leading-[21px] text-ink-soft">{fact.body}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="glass mx-auto w-full max-w-[340px] rounded-[26px] px-4 pb-4 pt-2">
            <LandmarkDiagram />
          </div>
        </div>

        <section className="glass mt-4 rounded-[24px] px-6 py-5" aria-label="How each estimate is labelled">
          <h2 className="text-[17px] font-bold leading-6 text-ink">Every estimate says how the joint was seen</h2>
          <dl className="mt-3 grid gap-x-8 gap-y-4 @2xl:grid-cols-3">
            {(['direct', 'inferred', 'unavailable'] as const).map((grade) => (
              <div key={grade} className="flex gap-3">
                <svg viewBox="0 0 44 26" className="mt-1 h-[26px] w-11 shrink-0" aria-hidden="true">
                  <path d="M4 22 A18 18 0 0 1 40 22" fill="none" stroke="#DDE3EC" strokeWidth="3" strokeLinecap="round" />
                  {grade !== 'unavailable' ? <path d="M4 22 A18 18 0 0 1 31 6.5" fill="none" stroke="#14213D" strokeWidth="3" strokeLinecap="round" strokeDasharray={grade === 'inferred' ? '1 5' : undefined} /> : null}
                  {grade !== 'unavailable' ? <circle cx="31" cy="6.5" r="3.4" fill="#ECB424" stroke="#14213D" strokeWidth="1.1" /> : null}
                </svg>
                <div>
                  <dt className="text-[15px] font-bold leading-6 text-ink">{GRADE_WORD[grade].tag}</dt>
                  <dd className="text-[14px] leading-[21px] text-ink-soft">{GRADE_WORD[grade].meaning}</dd>
                </div>
              </div>
            ))}
          </dl>
        </section>

        <section className="glass mt-4 rounded-[24px] px-6 py-5" aria-label="How a camera frame becomes a recorded estimate">
          <h2 className="text-[17px] font-bold leading-6 text-ink">From a camera frame to a recorded estimate</h2>
          <ol className="mt-4 grid gap-x-4 gap-y-4 @2xl:grid-cols-4 @5xl:grid-cols-7">
            {PIPELINE.map((step, index) => (
              <li key={step.title}>
                <span className="nums grid size-7 place-items-center rounded-full bg-teal-50 text-[13px] font-bold text-teal-600">{index + 1}</span>
                <span className="mt-2 block text-[15px] font-bold leading-5 text-ink">{step.title}</span>
                <span className="mt-0.5 block text-[13px] leading-[19px] text-ink-soft">{step.line}</span>
              </li>
            ))}
          </ol>
        </section>

        <Preflight className="mt-4" />
        <p className="mt-5 max-w-[90ch] text-[13px] leading-5 text-ink-soft">
          Research prototype. Not a medical device. Every person in the app is fictional and the history shown for them is
          illustrative. {ESTIMATE_NOTE}
        </p>
      </div>
    </div>
  );
}

// ---------- The page ----------

const CORE: AssessmentId[] = ['composite-fist', 'hook-fist', 'tabletop'];

const barButton = 'glass grid size-11 place-items-center rounded-full text-ink hover:bg-white';

export function PresentPage() {
  const patient = useActivePatient();
  const state = useDemoState();
  const today = useToday();
  const root = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState(0);
  const [backup, setBackup] = useState(false);
  const [notes, setNotes] = useState(false);
  const [hand, setHand] = useState<Hand>(patient.hand);
  const [assessmentId, setAssessmentId] = useState<AssessmentId>('composite-fist');
  /** Bumped to remount a live section: after a reset, or when the camera is swapped for the replay. */
  const [round, setRound] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [running, setRunning] = useState(false);

  const subject = useMemo(() => ({ ...patient, hand }), [patient, hand]);
  const captured = useMemo(
    () => sessionsOf(state.assessmentSessions ?? [], patient.id).filter((session) => session.source !== 'seed'),
    [state.assessmentSessions, patient.id],
  );
  const latest: AssessmentSession | null = captured.length > 0 ? captured[captured.length - 1] : null;
  const freeRecording = useMemo(() => (backup ? syntheticFreeTracking(hand) : null), [backup, hand]);
  const options = useMemo(() => CORE.map((id) => ({ id, setup: resolveAssessment(id, patient.finger) })), [patient.finger]);

  const go = useCallback((index: number) => {
    setSection(Math.min(SECTIONS.length - 1, Math.max(0, index)));
    setRunning(false);
  }, []);

  const fullScreen = useCallback(() => {
    const element = root.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen?.().catch(() => undefined);
  }, []);

  const toggleBackup = useCallback(() => {
    setBackup((value) => !value);
    setRunning(false);
    setRound((value) => value + 1);
  }, []);

  const reset = useCallback(() => {
    demoStore.clearCapturedAssessments(patient.id);
    setConfirmReset(false);
    setRunning(false);
    setRound((value) => value + 1);
    setSection(0);
  }, [patient.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key >= '1' && key <= '5') go(Number(key) - 1);
      else if (key === 'arrowright' || key === 'pagedown') setSection((value) => Math.min(SECTIONS.length - 1, value + 1));
      else if (key === 'arrowleft' || key === 'pageup') setSection((value) => Math.max(0, value - 1));
      else if (key === 'f') fullScreen();
      else if (key === 'n') setNotes((value) => !value);
      else if (key === 'b') toggleBackup();
      else if (key === 'r') setConfirmReset(true);
      else if (key === 'escape') setConfirmReset(false);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullScreen, go, toggleBackup]);

  return (
    <div ref={root} className="ground-wide flex h-dvh flex-col overflow-hidden text-ink">
      {/* Section bar */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 px-4 pt-3 lg:px-8">
        <Link to="/demo" className="text-[19px] font-bold tracking-[-0.03em] text-ink" aria-label="Ntact: back to the demo controls">
          Ntact
        </Link>
        <nav aria-label="Sections of the demonstration" className="no-scrollbar order-3 w-full overflow-x-auto lg:order-none lg:w-auto lg:flex-1">
          <ol className="glass flex w-fit gap-1 rounded-full p-1">
            {SECTIONS.map((item, index) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => go(index)}
                  aria-current={section === index ? 'step' : undefined}
                  className={cx(
                    'flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[14.5px] font-bold transition-colors duration-150',
                    section === index ? 'bg-ink text-white shadow-button' : 'text-ink-soft hover:bg-white hover:text-ink',
                  )}
                >
                  <span className={cx('nums text-[13px]', section === index ? 'text-mint' : 'text-teal-600')}>{index + 1}</span>
                  {item.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleBackup}
            aria-pressed={backup}
            title="Switch between the camera and the labelled synthetic replay (B)"
            className={cx('min-h-11 rounded-full px-4 text-[13px] font-bold', backup ? 'bg-mint text-ink shadow-soft' : 'glass text-ink-soft hover:bg-white')}
          >
            {backup ? 'Backup: synthetic replay' : 'Source: camera'}
          </button>
          <button type="button" onClick={() => setNotes((value) => !value)} aria-pressed={notes} aria-label="Speaker’s notes (N)" title="Speaker’s notes (N)" className={cx(barButton, notes && '!bg-ink !text-mint')}>
            <Notepad size={19} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setConfirmReset(true)} aria-label="Reset the demonstration (R)" title="Reset the demonstration (R)" className={barButton}>
            <ArrowCounterClockwise size={19} aria-hidden="true" />
          </button>
          <button type="button" onClick={fullScreen} aria-label="Full screen (F)" title="Full screen (F)" className={barButton}>
            <ArrowsOut size={19} aria-hidden="true" />
          </button>
        </div>
      </header>

      {confirmReset ? (
        <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-amber-100 px-5 py-3 text-amber-700 shadow-soft lg:mx-8" role="alertdialog" aria-label="Reset the demonstration">
          <p className="text-[14px] font-semibold leading-5">
            Remove the {captured.length} {captured.length === 1 ? 'session' : 'sessions'} captured here for {patient.firstName} and go back to the first section? The illustrative
            history stays.
          </p>
          <span className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={reset}>
              Reset
            </Button>
          </span>
        </div>
      ) : null}

      {/* Stage */}
      <main className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-4 lg:px-8" aria-label={SECTIONS[section].title}>
        {section === 0 ? <MeasuresSection /> : null}

        {section === 1 ? (
          <Runner
            key={`free-${round}-${backup ? 'replay' : 'camera'}-${hand}`}
            setup={null}
            hand={hand}
            title="Live digit tracking"
            recording={freeRecording}
            audience="clinical"
            autoStart
            allowDebug
            onFinished={() => undefined}
            onUseBackup={backup ? undefined : () => setBackup(true)}
          />
        ) : null}

        {section === 2 ? (
          running ? (
            <AssessmentFlow
              key={`run-${round}-${assessmentId}-${hand}-${backup ? 'replay' : 'camera'}`}
              patient={subject}
              assessmentId={assessmentId}
              audience="clinical"
              replay={backup}
              allowDebug
              onExit={() => setRunning(false)}
            />
          ) : (
            <div className="quiet-scroll h-full overflow-y-auto">
              <div className="mx-auto flex min-h-full max-w-[980px] flex-col justify-center pb-4">
                <h1 className="display text-[clamp(28px,3.8vw,44px)] leading-[1.08]">One assessment, start to finish.</h1>
                <p className="mt-3 max-w-[64ch] text-[16px] leading-[1.55] text-ink-soft">
                  The engine waits for the start position, detects the target position, counts the hold only while tracking is
                  usable, and records the repetition when the hand returns. Anything that falls short is counted separately and
                  kept out of the figures.
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Assessment">
                  {options.map(({ id, setup }) => {
                    const definition = DEFINITIONS[id];
                    const selected = id === assessmentId;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setAssessmentId(id)}
                        className={cx(
                          'rounded-[24px] px-4 pb-4 pt-3 text-left transition-shadow duration-150',
                          selected ? 'bg-white shadow-[0_0_0_2px_var(--color-ink),var(--shadow-raised)]' : 'glass hover:bg-white',
                        )}
                      >
                        <MovementGuide setup={setup} hand={hand} caption={false} className="mx-auto w-[150px]" />
                        <span className="mt-1 block text-[17px] font-bold leading-6">{definition.title}</span>
                        <span className="mt-0.5 block text-[13.5px] leading-5 text-ink-soft">{definition.clinical}</span>
                        <span className="mt-2.5 inline-block rounded-full bg-teal-50 px-2.5 py-1 text-[12px] font-bold leading-4 text-teal-600">{VIEW_NAME[recommendedView(definition, setup.focus, 'laptop')]}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <div className="flex items-center gap-2.5 text-[14px] text-ink-soft">
                    Hand
                    <div className="glass flex rounded-full p-1" role="radiogroup" aria-label="Which hand">
                      {(['left', 'right'] as Hand[]).map((option) => (
                        <button key={option} type="button" role="radio" aria-checked={hand === option} onClick={() => setHand(option)} className={cx('min-h-10 rounded-full px-4 text-[14px] font-bold capitalize', hand === option ? 'bg-ink text-white shadow-button' : 'text-ink-soft')}>
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[13.5px] leading-5 text-ink-soft">
                    {backup ? 'Backup mode: a labelled synthetic sequence will be replayed through the same engine.' : `Uses this computer’s camera. Saved to the fictional patient ${patient.name}.`}
                  </p>
                </div>
                <div className="mt-6">
                  <Button variant="primary" size="xl" onClick={() => setRunning(true)}>
                    {backup ? 'Run the synthetic replay' : 'Begin the assessment'}
                  </Button>
                </div>
              </div>
            </div>
          )
        ) : null}

        {section === 3 ? (
          <div className="quiet-scroll h-full overflow-y-auto">
            <div className="mx-auto max-w-[780px] pb-4">
              <h1 className="display text-[clamp(26px,3.4vw,38px)] leading-[1.1]">{latest ? `${DEFINITIONS[latest.assessmentId].title}: what was captured` : 'Nothing captured yet'}</h1>
              {latest ? (
                <SessionReport session={latest} previous={previousOf(state.assessmentSessions ?? [], latest)} tone="light" audience="clinical" className="mt-5" />
              ) : (
                <>
                  <p className="mt-3 max-w-[58ch] text-[16px] leading-[1.55] text-ink-soft">
                    This section shows the session recorded in section 3. No result is shown until one has actually been
                    captured: nothing here is pre-filled.
                  </p>
                  <Button variant="primary" size="lg" className="mt-5" onClick={() => go(2)}>
                    Go to the assessment
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : null}

        {section === 4 ? (
          <div className="quiet-scroll h-full overflow-y-auto">
            <div className="mx-auto max-w-[1080px] pb-4">
              <div className="flex flex-wrap items-end justify-between gap-3 pb-4">
                <h1 className="display text-[clamp(24px,3vw,34px)] leading-[1.1]">In the clinician record: {patient.name}, fictional</h1>
                <Link to={`/clinician/patients/${patient.id}?tab=movement`} className="glass inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-bold text-ink hover:bg-white">
                  Open the full record
                </Link>
              </div>
              <AssessmentReviewPanel patient={patient} state={state} today={today} />
            </div>
          </div>
        ) : null}
      </main>

      {/* Speaker's notes and stepping */}
      <footer className="glass-bar flex shrink-0 items-center gap-3 px-4 py-2.5 lg:px-8">
        <button type="button" onClick={() => go(section - 1)} disabled={section === 0} aria-label="Previous section" className={cx(barButton, 'shrink-0 disabled:opacity-35')}>
          <ArrowLeft size={18} weight="bold" aria-hidden="true" />
        </button>
        <p className={cx('min-w-0 flex-1 text-[13.5px] leading-5', notes ? 'text-ink' : 'truncate text-ink-soft')}>
          {notes ? NOTES[section] : `${section + 1} of ${SECTIONS.length}, ${SECTIONS[section].title}. Keys: 1 to 5, arrows, F full screen, B backup, N notes, R reset`}
        </p>
        <button type="button" onClick={() => go(section + 1)} disabled={section === SECTIONS.length - 1} aria-label="Next section" className={cx(barButton, 'shrink-0 disabled:opacity-35')}>
          <ArrowRight size={18} weight="bold" aria-hidden="true" />
        </button>
      </footer>
    </div>
  );
}
