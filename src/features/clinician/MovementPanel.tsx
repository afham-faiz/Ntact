/**
 * The clinician's view of guided exercises, and the two decisions that are only
 * ever a clinician's: which exercises a patient may do, and whether a patient
 * moves to patient-initiated follow-up.
 */
import { useToast } from '../../components/Toast';
import { Button, Panel, cx } from '../../components/ui';
import { demoStore } from '../../demo/store';
import { dateKeyOf, formatDay, formatDayShort, formatTime, lastDays, type DateKey } from '../../domain/dates';
import { SEVERITY_LABEL, WEEKLY_QUESTIONS, weeklyDue, weeklyForPatient } from '../../domain/checkIn';
import { EXERCISES, EXERCISE_ORDER, sessionsForPatient, trendSessions, unlockedExercises } from '../../domain/exercise';
import type { DemoState, ExerciseSession, Patient, TriageLevel } from '../../domain/types';
import { fingerName } from './parts';

/** Where a session's figures came from. Only the camera is a real observation of the patient. */
export function exerciseSourceLabel(session: ExerciseSession): string {
  return session.source === 'camera' && session.simulated === false ? 'Camera' : 'Demonstration';
}

function daysWithSession(sessions: ExerciseSession[], days: DateKey[]): number {
  return days.filter((day) => sessions.some((session) => session.reps > 0 && dateKeyOf(session.timestamp) === day)).length;
}

function Trend({ sessions }: { sessions: ExerciseSession[] }) {
  const measured = trendSessions(sessions).slice(-21);
  if (measured.length < 2) return <p className="mt-3 text-[13px] leading-5 text-ink-soft">Not enough sessions for a trend yet.</p>;
  const values = measured.map((session) => session.rangeDeg as number);
  const low = Math.min(...values) - 10;
  const high = Math.max(...values) + 10;
  const width = 312;
  const height = 96;
  const x = (index: number) => 8 + (index / (values.length - 1)) * (width - 16);
  const y = (value: number) => height - 10 - ((value - low) / (high - low)) * (height - 22);
  const path = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 block h-24 w-full" role="img" aria-label={`Estimated range across the last ${values.length} sessions, from about ${values[0]} to about ${values[values.length - 1]} degrees`}>
      <defs>
        <linearGradient id="movement-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3D63A6" stopOpacity="0.2" />
          <stop offset="1" stopColor="#3D63A6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L${x(values.length - 1).toFixed(1)} ${height} L${x(0).toFixed(1)} ${height} Z`} fill="url(#movement-fill)" />
      <path d={path} fill="none" stroke="#2E4A7D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {measured.map((session, index) => (
        <circle
          key={session.id}
          cx={x(index)}
          cy={y(values[index])}
          r={session.simulated ? 2.4 : 3.6}
          fill={session.simulated ? '#ffffff' : '#2E4A7D'}
          stroke="#2E4A7D"
          strokeWidth="1.6"
        />
      ))}
    </svg>
  );
}

export function MovementPanel({ patient, state, today }: { patient: Patient; state: DemoState; today: DateKey }) {
  const toast = useToast();
  const sessions = sessionsForPatient(state.exerciseSessions ?? [], patient.id);
  const unlocked = unlockedExercises(state.exercisePlans, patient.id);
  const measured = trendSessions(sessions);
  const latest = measured.length > 0 ? measured[measured.length - 1] : null;
  const done7 = daysWithSession(sessions, lastDays(today, 7));
  const done28 = daysWithSession(sessions, lastDays(today, 28));
  const recent = [...sessions].reverse().slice(0, 6);
  const camera = sessions.filter((session) => !session.simulated).length;

  return (
    <Panel>
      <div className="px-6 pt-5">
        <h2 className="text-[17px] font-bold leading-6 tracking-[-0.02em] text-ink">Movement and exercises</h2>
        <p className="mt-0.5 text-[13px] leading-5 text-ink-soft">
          Range of the {fingerName(patient.finger)} in the open-and-close exercise, estimated from the patient’s camera. A
          trend indicator: typically within 10 to 20 degrees, and not goniometry.
        </p>
      </div>
      <div className="px-6 pb-5 pt-3">
        <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-3">
          <span className="text-[13.5px] leading-5 text-ink-soft">Latest estimated range</span>
          <span className="serif nums text-[26px] leading-8 text-ink">{latest ? `≈${latest.rangeDeg}°` : '–'}</span>
        </div>
        <div className="divide-y divide-rule/70">
          <div className="flex items-baseline justify-between gap-4 py-2">
            <span className="text-[13.5px] leading-5 text-ink-soft">Exercise days, last 7</span>
            <span className="nums text-[14.5px] font-bold leading-5 text-ink">{done7} of 7</span>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-2">
            <span className="text-[13.5px] leading-5 text-ink-soft">Exercise days, last 28</span>
            <span className="nums text-[14.5px] font-bold leading-5 text-ink">{done28} of 28</span>
          </div>
        </div>

        <Trend sessions={sessions} />
        <p className="text-[12.5px] leading-5 text-ink-soft">
          Filled points are camera sessions ({camera}). Hollow points are demonstration data.
        </p>

        {recent.length > 0 ? (
          <ul className="mt-3 divide-y divide-rule/70 border-t border-rule">
            {recent.map((session) => (
              <li key={session.id} className="nums flex items-baseline justify-between gap-3 py-2 text-[13px] leading-5">
                <span className="text-ink">
                  {formatDayShort(dateKeyOf(session.timestamp))}
                  <span className="text-ink-soft">, {formatTime(session.timestamp)}</span>
                </span>
                <span className="text-right text-ink-soft">
                  {EXERCISES[session.exerciseId]?.title ?? 'Exercise'}{' '}
                  <span className="font-semibold text-ink">
                    {session.reps}/{session.targetReps}
                  </span>
                  {session.rangeDeg !== null ? `, ≈${session.rangeDeg}°` : ''} · {exerciseSourceLabel(session)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] leading-5 text-ink-soft">No exercise session on record.</p>
        )}

        <div className="mt-5 border-t border-rule pt-4">
          <p className="text-[13px] font-semibold leading-5 text-ink">Exercise plan</p>
          <p className="text-[12.5px] leading-5 text-ink-soft">You decide what the patient may do. The app never unlocks an exercise by itself.</p>
          <ul className="mt-2 divide-y divide-rule/70">
            {EXERCISE_ORDER.map((id) => {
              const exercise = EXERCISES[id];
              const open = unlocked.includes(id);
              return (
                <li key={id} className="flex items-center justify-between gap-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[14px] font-bold leading-5 text-ink">{exercise.title}</span>
                    <span className={cx('block text-[13px] leading-5', open ? 'text-teal-700' : 'text-ink-soft')}>
                      Phase {exercise.phase}. {open ? 'Unlocked for this patient' : 'Locked'}
                    </span>
                  </span>
                  <Button
                    variant={open ? 'outline' : 'primary'}
                    size="sm"
                    onClick={() => {
                      demoStore.setExercisePlan(patient.id, open ? unlocked.filter((item) => item !== id) : [...unlocked, id]);
                      toast.show(`${exercise.title} ${open ? 'locked' : 'unlocked'}. Saved locally.`);
                    }}
                  >
                    {open ? 'Lock' : 'Unlock'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

/** The weekly questions: the latest answers, and how they have moved since the time before. */
export function WeeklyPanel({ patient, state, today }: { patient: Patient; state: DemoState; today: DateKey }) {
  const entries = weeklyForPatient(state.weeklyCheckIns ?? [], patient.id);
  const latest = entries.length > 0 ? entries[entries.length - 1] : null;
  const before = entries.length > 1 ? entries[entries.length - 2] : null;
  const rank = { none: 0, mild: 1, moderate: 2, severe: 3 } as const;
  const moved = (now: number, then: number | undefined) =>
    then === undefined || now === then ? 'no change' : now > then ? 'higher than last time' : 'lower than last time';

  return (
    <Panel>
      <div className="px-6 pt-5">
        <h2 className="text-[17px] font-bold leading-6 tracking-[-0.02em] text-ink">Weekly questions</h2>
        <p className="mt-0.5 text-[13px] leading-5 text-ink-soft">
          Patient-reported, once a week: cold sensitivity, tingling and everyday function. Provisional wording.
        </p>
      </div>
      <div className="px-6 pb-5 pt-2">
        {latest ? (
          <>
            <dl className="divide-y divide-rule/70">
              {[
                { label: 'Cold sensitivity', value: SEVERITY_LABEL[latest.cold], change: moved(rank[latest.cold], before ? rank[before.cold] : undefined) },
                { label: 'Tingling', value: SEVERITY_LABEL[latest.tingling], change: moved(rank[latest.tingling], before ? rank[before.tingling] : undefined) },
                { label: 'Everyday tasks limited', value: `${latest.function} / 10`, change: moved(latest.function, before?.function) },
              ].map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 py-2">
                  <dt className="text-[13.5px] leading-5 text-ink-soft">{row.label}</dt>
                  <dd className="nums text-right text-[14.5px] font-bold leading-5 text-ink">
                    {row.value}
                    <span className="block text-[12.5px] font-normal text-ink-soft">{row.change}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[12.5px] leading-5 text-ink-soft">
              Answered {formatDay(latest.date)}. {entries.length} on record.
              {weeklyDue(entries, today) ? ' The next set is due.' : ''}
            </p>
            <p className="mt-1 text-[12.5px] leading-5 text-ink-faint">“{WEEKLY_QUESTIONS.function}” 0 is not at all, 10 is couldn’t do them.</p>
          </>
        ) : (
          <p className="text-[13.5px] leading-5 text-ink-soft">No weekly answers on record.</p>
        )}
      </div>
    </Panel>
  );
}

/**
 * Patient-initiated follow-up. Shown on the flags panel: eligibility is a plain
 * statement of what the rules found, and the move itself is a clinician's click.
 */
export function FollowUpControl({ patient, state, level }: { patient: Patient; state: DemoState; level: TriageLevel }) {
  const toast = useToast();
  const current = state.followUp?.[patient.id];
  if (!current && level !== 'GREEN') return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[12px] bg-floor px-4 py-3.5">
      <p className="min-w-0 max-w-[62ch] text-[13.5px] leading-[21px] text-ink">
        {current ? (
          <>
            <span className="font-bold">On patient-initiated follow-up since {formatDay(current.since)}.</span> No routine visit is
            booked: the patient contacts the service if they need to, and this record still raises flags.
            {level !== 'GREEN' ? ' A flag is pending, so this needs looking at.' : ''}
          </>
        ) : (
          <>
            <span className="font-bold">No current review trigger.</span> Records like this one can be considered for
            patient-initiated follow-up, which frees a routine appointment. That is your decision, not the app’s.
          </>
        )}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          demoStore.setFollowUp(patient.id, !current);
          toast.show(current ? 'Returned to routine follow-up. Saved locally.' : 'Moved to patient-initiated follow-up. Saved locally.');
        }}
      >
        {current ? 'Return to routine follow-up' : 'Move to patient-initiated follow-up'}
      </Button>
    </div>
  );
}
