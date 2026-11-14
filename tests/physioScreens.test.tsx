/**
 * The Physio screens, rendered: the streak card on the list, and the streak on the
 * end-of-session summary. Logic is covered in exercise.test.ts; this checks that
 * what the patient reads actually appears.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { demoStore, todayKey } from '../src/demo/store';
import { EXERCISES, physioStreak, summariseReps } from '../src/domain/exercise';
import { ExerciseHome, Summary } from '../src/features/patient/ExerciseScreen';

const result = summariseReps(
  Array.from({ length: 10 }, () => ({ flexDeg: 150, extDeg: 30 })),
  10,
  34_000,
);
const site = { hand: 'right', finger: 'index' } as const;

beforeEach(() => {
  demoStore.reset('default');
});

describe('Physio list', () => {
  it('shows the streak, the week and the three exercises with the third locked', () => {
    const patientId = demoStore.getState().activePatientId;
    const streak = physioStreak(demoStore.getState().exerciseSessions, patientId, todayKey());

    render(
      <MemoryRouter>
        <ExerciseHome />
      </MemoryRouter>,
    );

    // The seeded history always includes the last two days, so there is a streak to show.
    expect(streak.current).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('day streak')).toBeInTheDocument();
    expect(screen.getByText(String(streak.current), { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Do today’s physio to keep it going.')).toBeInTheDocument();
    expect(screen.getByLabelText('The last seven days').querySelectorAll('li')).toHaveLength(7);
    expect(screen.getByText('Today')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Finger slides/ })).toHaveAttribute('href', '/patient/exercise/finger-slides');
    expect(screen.getByRole('link', { name: /Open and close/ })).toHaveAttribute('href', '/patient/exercise/open-close');
    // Locked: named, explained, and not a link.
    expect(screen.getByText('Putty squeeze')).toBeInTheDocument();
    expect(screen.getByText('Your therapist unlocks this at a later stage.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Putty squeeze/ })).toBeNull();
  });

  it('extends the streak once an exercise is done today', () => {
    const patientId = demoStore.getState().activePatientId;
    const before = physioStreak(demoStore.getState().exerciseSessions, patientId, todayKey()).current;
    demoStore.recordExercise(patientId, 'open-close', result, 'camera', site);

    render(
      <MemoryRouter>
        <ExerciseHome />
      </MemoryRouter>,
    );

    expect(screen.getByText(String(before + 1), { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText('Do today’s physio to keep it going.')).toBeNull();
    expect(screen.getByText(/1 of 2 done today/)).toBeInTheDocument();
  });

  it('unlocks the putty squeeze for the patient when the clinician unlocks it', () => {
    const patientId = demoStore.getState().activePatientId;
    demoStore.setExercisePlan(patientId, ['finger-slides', 'open-close', 'putty-squeeze']);

    render(
      <MemoryRouter>
        <ExerciseHome />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /Putty squeeze/ })).toHaveAttribute('href', '/patient/exercise/putty-squeeze');
  });
});

describe('end-of-session summary', () => {
  it('shows the streak as it stands after the session, and offers the next exercise', () => {
    const patientId = demoStore.getState().activePatientId;
    demoStore.recordExercise(patientId, 'finger-slides', result, 'camera', site);
    const streak = physioStreak(demoStore.getState().exerciseSessions, patientId, todayKey());

    render(
      <MemoryRouter>
        <Summary
          exercise={EXERCISES['finger-slides']}
          result={result}
          previous={null}
          demo={false}
          site={site}
          nextId="open-close"
          streak={streak}
          onAgain={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(`${streak.current}-day streak`)).toBeInTheDocument();
    expect(screen.getByText('Done. Well done.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next exercise' })).toHaveAttribute('href', '/patient/exercise/open-close');
  });

  it('shows no streak when nothing was counted', () => {
    const patientId = demoStore.getState().activePatientId;
    const streak = physioStreak(demoStore.getState().exerciseSessions, patientId, todayKey());

    render(
      <MemoryRouter>
        <Summary
          exercise={EXERCISES['open-close']}
          result={summariseReps([], 10, 4_000)}
          previous={null}
          demo={false}
          site={site}
          nextId={null}
          streak={streak}
          onAgain={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/-day streak/)).toBeNull();
    expect(screen.getByText('Nothing was counted this time.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Done' })).toHaveAttribute('href', '/patient/exercise');
  });
});
