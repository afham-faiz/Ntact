/**
 * The movement screens, rendered: what a patient and a clinician actually read,
 * and one whole session played through the real screen with a synthetic recording.
 *
 * The camera and the tracking model are not involved anywhere in this file.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAssessment } from '../src/assessment/definitions';
import { replay } from '../src/assessment/session';
import { ToastProvider } from '../src/components/Toast';
import { demoStore, todayKey } from '../src/demo/store';
import { AssessmentReviewPanel, ProtocolPanel } from '../src/features/clinician/AssessmentPanel';
import { AssessmentFlow, saveRun } from '../src/features/movement/AssessmentFlow';
import { Runner } from '../src/features/movement/Runner';
import { yawForView } from '../src/tracking/handModel';
import { repetitionKeys, synthesise } from '../src/tracking/recording';
import type { RunResult } from '../src/features/movement/liveRun';
import { SessionReport } from '../src/features/movement/SessionReport';
import { syntheticRecordingFor } from '../src/features/movement/syntheticDemo';
import { MovementHome, MovementIntroScreen, MovementSessionScreen } from '../src/features/patient/MovementScreen';
import { PresentPage } from '../src/features/present/PresentPage';
import { TRACKING_DEFAULTS } from '../src/assessment/session';

function patient() {
  const state = demoStore.getState();
  return state.patients.find((item) => item.id === state.activePatientId) ?? state.patients[0];
}

/** A finished run, produced by replaying the synthetic sequence through the real tracker and engine. */
function runOf(id: Parameters<typeof resolveAssessment>[0], source: 'camera' | 'replay' = 'camera'): { setup: ReturnType<typeof resolveAssessment>; result: RunResult } {
  const person = patient();
  const setup = resolveAssessment(id, person.finger);
  const played = replay(syntheticRecordingFor(setup, person.hand), setup, { hand: person.hand });
  return {
    setup,
    result: {
      reps: played.reps,
      quality: played.engine.quality(),
      view: played.engine.dominantView(),
      durationMs: played.engine.elapsedMs(),
      capture: { setup: 'laptop', facing: 'user', width: 1280, height: 720, fps: 29.8, inferenceMs: 11.2 },
      tracking: { ...TRACKING_DEFAULTS, delegate: 'GPU', labelConvention: 'subject' },
      detectedHand: person.hand,
      replay: source === 'replay',
    },
  };
}

beforeEach(() => {
  demoStore.reset('default');
  // jsdom has no canvas.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('patient: movement assessment', () => {
  it('lists the assessments a clinician has switched on, with the safety note and the illustrative history marked', () => {
    render(
      <MemoryRouter>
        <MovementHome />
      </MemoryRouter>,
    );
    // The first link for each is the assessment itself; the ones below it are past sessions.
    expect(screen.getAllByRole('link', { name: /Composite fist/ })[0]).toHaveAttribute('href', '/patient/movement/composite-fist');
    expect(screen.getAllByRole('link', { name: /Hook fist/ })[0]).toHaveAttribute('href', '/patient/movement/hook-fist');
    expect(screen.getAllByRole('link', { name: /Tabletop/ })[0]).toHaveAttribute('href', '/patient/movement/tabletop');
    // The exploratory ones are not offered until a clinician offers them.
    expect(screen.queryByRole('link', { name: /Thumb opposition/ })).toBeNull();
    expect(screen.getByText(/Never\s+push or force a finger/)).toBeInTheDocument();
    expect(screen.getAllByText('Illustrative').length).toBeGreaterThan(0);
    expect(screen.getByText(/example data that came with this prototype/)).toBeInTheDocument();
  });

  it('shows nothing to do when the clinician has withdrawn every assessment', () => {
    demoStore.setAssessmentProtocol(patient().id, { enabled: [], overrides: {} });
    render(
      <MemoryRouter>
        <MovementHome />
      </MemoryRouter>,
    );
    expect(screen.getByText(/hasn’t switched on any movement assessments/)).toBeInTheDocument();
  });

  it('explains one assessment and leads to the camera setup', () => {
    render(
      <MemoryRouter initialEntries={['/patient/movement/hook-fist']}>
        <Routes>
          <Route path="/patient/movement/:assessmentId" element={<MovementIntroScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Hook fist' })).toBeInTheDocument();
    expect(screen.getByText(/3 repetitions, each held for 2 seconds/)).toBeInTheDocument();
    // The comfortable view for a hook in front of a camera, and the movement shown as a drawing.
    expect(screen.getByText('Palm view')).toBeInTheDocument();
    expect(screen.getByText(/An illustration drawn by the app/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Hook fist: .*Illustration/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Watch a synthetic demonstration instead' })).toHaveAttribute('href', '/patient/movement/hook-fist/live?mode=replay');
  });

  it('does not open an assessment that has not been offered', () => {
    render(
      <MemoryRouter initialEntries={['/patient/movement/thumb-opposition']}>
        <Routes>
          <Route path="/patient/movement/:assessmentId" element={<MovementIntroScreen />} />
          <Route path="/patient/movement" element={<p>Assessment list</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Assessment list')).toBeInTheDocument();
  });

  it('shows a past session with what it does and does not mean', () => {
    const { setup, result } = runOf('composite-fist');
    const session = saveRun(patient(), setup, result);
    render(
      <MemoryRouter initialEntries={[`/patient/movement/session/${session?.id}`]}>
        <Routes>
          <Route path="/patient/movement/session/:sessionId" element={<MovementSessionScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    expect(screen.getByText('Camera')).toBeInTheDocument();
    expect(screen.getByText(/It is not a measurement of your joints/)).toBeInTheDocument();
    // Plain names for the patient, with the clinical abbreviation beside them.
    expect(screen.getByText('Middle joint')).toBeInTheDocument();
    expect(screen.getByText('(PIP)')).toBeInTheDocument();
  });
});

describe('saving a session', () => {
  it('stores a camera session as an observation and a replay as synthetic', () => {
    const camera = runOf('composite-fist');
    const real = saveRun(patient(), camera.setup, camera.result);
    expect(real).toMatchObject({ source: 'camera', synthetic: false });
    const played = runOf('composite-fist', 'replay');
    const synthetic = saveRun(patient(), played.setup, played.result);
    expect(synthetic).toMatchObject({ source: 'synthetic-replay', synthetic: true });
    expect(demoStore.getState().assessmentSessions.filter((session) => session.source !== 'seed')).toHaveLength(2);
  });

  it('stores nothing when the target position was never reached', () => {
    const { setup, result } = runOf('composite-fist');
    const before = demoStore.getState().assessmentSessions.length;
    expect(saveRun(patient(), setup, { ...result, reps: [] })).toBeNull();
    expect(demoStore.getState().assessmentSessions).toHaveLength(before);
  });
});

describe('session report', () => {
  it('keeps completion, estimates and capture quality apart, and lists rejected repetitions for a clinician', () => {
    const { setup, result } = runOf('tabletop');
    const session = saveRun(patient(), setup, result);
    if (!session) throw new Error('expected a session');
    render(<SessionReport session={session} audience="clinical" />);
    expect(screen.getByText('Completion')).toBeInTheDocument();
    expect(screen.getByText('Estimates while held')).toBeInTheDocument();
    expect(screen.getByText('Capture quality')).toBeInTheDocument();
    expect(screen.getByText(/1 more reached the position but was not recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Rejected: not held for long enough/)).toBeInTheDocument();
    expect(screen.getAllByText('In view').length).toBeGreaterThan(0);
    expect(screen.getByText(/MediaPipe Hand Landmarker/)).toBeInTheDocument();
    expect(screen.getByText(/have not been compared with goniometer measurements/)).toBeInTheDocument();
  });

  it('reports no figure when no repetition was valid', () => {
    const { setup, result } = runOf('composite-fist');
    const session = saveRun(patient(), setup, { ...result, reps: result.reps.filter((rep) => !rep.valid) });
    if (!session) throw new Error('expected a session');
    render(<SessionReport session={session} audience="patient" />);
    expect(screen.getByText('0 of 3')).toBeInTheDocument();
    expect(screen.getByText(/there is no figure to report. Nothing has been filled in/)).toBeInTheDocument();
    expect(screen.getByText('No valid repetition was recorded.')).toBeInTheDocument();
  });

  it('says so when the data is synthetic or illustrative', () => {
    const played = runOf('composite-fist', 'replay');
    const session = saveRun(patient(), played.setup, played.result);
    if (!session) throw new Error('expected a session');
    const { unmount } = render(<SessionReport session={session} audience="clinical" />);
    expect(screen.getByText('Synthetic replay')).toBeInTheDocument();
    expect(screen.getByText(/Not a person, and not a measurement/)).toBeInTheDocument();
    unmount();
    const seeded = demoStore.getState().assessmentSessions.find((item) => item.source === 'seed');
    if (!seeded) throw new Error('expected seeded data');
    render(<SessionReport session={seeded} audience="clinical" />);
    expect(screen.getByText('Illustrative')).toBeInTheDocument();
    expect(screen.getByText(/Illustrative example data written by the demonstration/)).toBeInTheDocument();
  });
});

describe('clinician: movement assessments', () => {
  function renderPanels() {
    const state = demoStore.getState();
    return render(
      <ToastProvider>
        <AssessmentReviewPanel patient={patient()} state={state} today={todayKey()} />
        <ProtocolPanel patient={patient()} state={state} />
      </ToastProvider>,
    );
  }

  it('says when there is only illustrative data, and keeps completion apart from estimates', () => {
    renderPanels();
    expect(screen.getByText('No camera session yet: illustrative data only')).toBeInTheDocument();
    expect(screen.getByText(/Completion only: whether sessions were done/)).toBeInTheDocument();
    expect(screen.getByText(/never combined into one figure/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Composite flexion: \d+ sessions/ })).toBeInTheDocument();
    expect(screen.getByText(/Hollow points on the dashed line are illustrative example data/)).toBeInTheDocument();
  });

  it('shows a camera session once there is one, and flags a poorly captured one', () => {
    const { setup, result } = runOf('composite-fist');
    saveRun(patient(), setup, result);
    renderPanels();
    expect(screen.queryByText('No camera session yet: illustrative data only')).toBeNull();
    expect(screen.getAllByText('Camera').length).toBeGreaterThan(0);
    // The seed includes one deliberately poor session, which the chart marks.
    expect(screen.getByText(/An amber ring marks a session with a capture-quality concern \(1\)/)).toBeInTheDocument();
  });

  it('refuses to compare a camera session with illustrative data', async () => {
    const user = userEvent.setup();
    const { setup, result } = runOf('composite-fist');
    saveRun(patient(), setup, result);
    renderPanels();
    await user.click(screen.getByRole('radio', { name: 'Compare' }));
    expect(screen.getByText(/no earlier session of this assessment and this kind of data/)).toBeInTheDocument();
  });

  it('takes a reference reading and reports the difference without calling it accuracy', async () => {
    const user = userEvent.setup();
    const { setup, result } = runOf('composite-fist');
    const session = saveRun(patient(), setup, result);
    const view = renderPanels();
    await user.click(screen.getByRole('radio', { name: 'Reference readings' }));
    await user.type(screen.getByLabelText('Goniometer, degrees'), '90');
    await user.click(screen.getByRole('button', { name: 'Add reading' }));

    const stored = demoStore.getState().assessmentSessions.find((item) => item.id === session?.id);
    expect(stored?.references).toHaveLength(1);
    expect(stored?.references[0]).toMatchObject({ joint: 'pip', kind: 'flex', deg: 90 });

    view.unmount();
    renderPanels();
    await user.click(screen.getByRole('radio', { name: 'Reference readings' }));
    expect(screen.getByText(/goniometer 90°/)).toBeInTheDocument();
    expect(screen.getByText(/It is not a validation result/)).toBeInTheDocument();
  });

  it('lets a clinician offer, withdraw and configure an assessment', async () => {
    const user = userEvent.setup();
    renderPanels();
    const protocol = screen.getByRole('heading', { name: 'Assessment protocol' }).closest('section') as HTMLElement;
    const rows = within(protocol).getAllByRole('listitem');
    const opposition = rows.find((row) => within(row).queryByText('Thumb opposition')) as HTMLElement;
    await user.click(within(opposition).getByRole('button', { name: 'Offer' }));
    expect(demoStore.getState().assessmentProtocols[patient().id].enabled).toContain('thumb-opposition');

    const fist = rows.find((row) => within(row).queryByText('Composite fist')) as HTMLElement;
    await user.click(within(fist).getByRole('button', { name: 'Settings' }));
    expect(within(fist).getByText(/Not a therapeutic target/)).toBeInTheDocument();
    await user.selectOptions(within(fist).getByLabelText(/Joints accepted/), 'direct');
    expect(demoStore.getState().assessmentProtocols[patient().id].overrides['composite-fist']?.minGrade).toBe('direct');
  });
});

describe('a whole session, played through the screen', () => {
  it('runs the labelled synthetic replay to a stored, synthetic session', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const exit = vi.fn();
    const before = demoStore.getState().assessmentSessions.length;

    render(
      <MemoryRouter>
        <AssessmentFlow patient={patient()} assessmentId="composite-fist" audience="patient" replay onExit={exit} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Synthetic replay').length).toBeGreaterThan(0);

    // The recording lasts about half a minute; the clock is run forward through it.
    for (let step = 0; step < 2600 && !screen.queryByText('Session recorded.'); step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16);
      });
    }

    expect(screen.getByText('Session recorded.')).toBeInTheDocument();
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    expect(screen.getByText(/It is not a measurement of your joints/)).toBeInTheDocument();
    const sessions = demoStore.getState().assessmentSessions;
    expect(sessions).toHaveLength(before + 1);
    const saved = sessions[sessions.length - 1];
    expect(saved).toMatchObject({ source: 'synthetic-replay', synthetic: true, assessmentId: 'composite-fist' });
    expect(saved.summary.validReps).toBe(3);
    expect(saved.summary.rejectedReps).toBe(1);
    expect(saved.tracking.delegate).toBe('none');
  }, 60_000);
});

describe('when someone is finding the movement difficult', () => {
  it('offers help after tries that fall short, never pushes, and saves how far the movement went', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const person = patient();
    const setup = resolveAssessment('composite-fist', person.finger);
    // Three tries at 40% of a fist: clearly a movement, clearly short of what the assessment is set to recognise.
    const recording = synthesise(repetitionKeys({ side: person.hand, from: 'open', to: 'fist', reps: 3, amount: 0.4 }), { camera: { yaw: yawForView('palmar', person.hand) } });
    let result: RunResult | null = null;

    render(<Runner setup={setup} hand={person.hand} title="Composite fist" recording={recording} audience="patient" onFinished={(value) => (result = value)} />);
    for (let step = 0; step < 1500 && !screen.queryByText('Finding the movement difficult?'); step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16);
      });
    }
    // An offer, not an interruption: the session carries on unless the person asks.
    expect(screen.getByText('Finding the movement difficult?')).toBeInTheDocument();
    expect(screen.getByText(/did not reach the set position, so it is not counted. Only go as far as is comfortable/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Get help' }));
    const sheet = screen.getByRole('dialog', { name: 'Only go as far as is comfortable' });
    expect(within(sheet).getByText(/Never push or force a finger, and stop if it hurts/)).toBeInTheDocument();
    expect(within(sheet).getByText(/It is not a failure/)).toBeInTheDocument();
    expect(within(sheet).getByText(/tries have been saved as “did not reach the set position”/)).toBeInTheDocument();
    expect(within(sheet).getByText('The session is paused while this is open.')).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Finish here' }));
    const finished = result as RunResult | null;
    expect(finished).not.toBeNull();
    expect(finished?.reps.length).toBeGreaterThanOrEqual(2);
    expect(finished?.reps.every((rep) => !rep.valid && rep.rejectReason === 'target-not-reached')).toBe(true);

    // What the clinician then sees: no figure reported, and how far the tries went.
    const session = saveRun(person, setup, finished as RunResult);
    if (!session) throw new Error('expected a session');
    expect(session.summary.validReps).toBe(0);
    cleanup();
    render(<SessionReport session={session} audience="clinical" />);
    expect(screen.getByText(/tries did not reach the set position \(furthest ≈\d+°\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/Rejected: did not reach the set position/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/there is no figure to report/)).toBeInTheDocument();
  }, 60_000);

  it('shows the movement as a drawing before the camera starts, in a view that is comfortable to hold', () => {
    const person = patient();
    const setup = resolveAssessment('hook-fist', person.finger);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(), enumerateDevices: async () => [] } });
    render(<Runner setup={setup} hand={person.hand} title="Hook fist" audience="patient" onFinished={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'How are you using the camera?' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /Hook fist: .*Illustration/ }).length).toBeGreaterThan(0);
    // In front of a laptop the hook is asked for palm-on, not thumb side to the camera.
    expect(screen.getByText('Palm view')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Phone in my other hand/ }));
    expect(screen.getByText(/Rest the back of your hand on a table, palm up/)).toBeInTheDocument();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });
});

describe('the demonstration', () => {
  it('moves between its five sections and shows no result until one has been captured', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ToastProvider>
          <PresentPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /Estimating finger-joint movement from an ordinary camera/ })).toBeInTheDocument();
    expect(screen.getByText('Preflight')).toBeInTheDocument();

    await user.keyboard('3');
    expect(screen.getByRole('heading', { name: 'One assessment, start to finish.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Begin the assessment' })).toBeInTheDocument();

    await user.keyboard('b');
    expect(screen.getByRole('button', { name: 'Run the synthetic replay' })).toBeInTheDocument();
    expect(screen.getByText('Backup: synthetic replay')).toBeInTheDocument();

    await user.keyboard('4');
    expect(screen.getByRole('heading', { name: 'Nothing captured yet' })).toBeInTheDocument();
    expect(screen.getByText(/nothing here is pre-filled/)).toBeInTheDocument();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('heading', { name: /In the clinician record/ })).toBeInTheDocument();
    expect(screen.getByText('No camera session yet: illustrative data only')).toBeInTheDocument();

    await user.keyboard('n');
    expect(screen.getByText(/two different things, shown side by side, never merged into a score/)).toBeInTheDocument();
  });

  it('shows what was captured, and removes it on reset while keeping the illustrative history', async () => {
    const user = userEvent.setup();
    const { setup, result } = runOf('composite-fist');
    saveRun(patient(), setup, result);
    const seeded = demoStore.getState().assessmentSessions.filter((session) => session.source === 'seed').length;

    render(
      <MemoryRouter>
        <ToastProvider>
          <PresentPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await user.keyboard('4');
    expect(screen.getByRole('heading', { name: 'Composite fist: what was captured' })).toBeInTheDocument();
    expect(screen.getByText('3 of 3')).toBeInTheDocument();

    await user.keyboard('r');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(demoStore.getState().assessmentSessions).toHaveLength(seeded);
    expect(screen.getByRole('heading', { name: /Estimating finger-joint movement/ })).toBeInTheDocument();
  });
});
