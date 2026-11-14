import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { assistStateOf, useDevice, type AssistState } from '../../app/DeviceContext';
import { useActivePatient, useDemoState, useNow } from '../../app/hooks';
import { LevelGraph } from '../../components/charts/LevelGraph';
import { linkSummary } from './deviceCopy';
import { PrototypeTag } from './PatientShell';
import { latestWeekly, painOf, weeklyDue, weeklyForPatient } from '../../domain/checkIn';
import { dateKeyOf, formatDayLong, greetingFor, relativeDay, toDateKey } from '../../domain/dates';
import { homeLine } from '../../domain/patientMessages';
import {
  buildDaySeries,
  checkInOn,
  checkInsForPatient,
  primaryTestOfDay,
  testCompletion,
  testsForPatient,
  testsOnDay,
} from '../../domain/selectors';
import { RESULT_RULES, triageSummaries } from '../../domain/triage';
import type { FeltTest } from '../../domain/types';

const ASSIST_COPY: Record<AssistState, { state: string; line: string }> = {
  on: { state: 'On', line: 'Feedback at your wrist is enabled.' },
  paused: { state: 'Paused', line: 'Turn it back on whenever you are ready.' },
  testing: { state: 'Paused', line: 'Paused while you test.' },
  offline: { state: 'Unavailable', line: '{Connect} the {device} to use it.' },
  checking: { state: 'Checking', line: 'Asking the {device} for its mode.' },
  changing: { state: 'Updating', line: 'Waiting for the {device}.' },
};


/** A section of the paper body: label on the left, quiet metadata on the right, then content. */
function Section({
  title,
  meta,
  children,
  to,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
  to?: string;
}) {
  const head = (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="serif text-[22px] leading-8 text-ink">
        {title}
        {to ? <span className="ml-1.5 text-ink-faint" aria-hidden="true">›</span> : null}
      </h2>
      {meta ? <span className="shrink-0 text-[15px] leading-6 text-ink-soft">{meta}</span> : null}
    </div>
  );
  return (
    <section className="border-t border-rule py-7 first:border-t-0">
      {to ? (
        <Link to={to} className="block">
          {head}
        </Link>
      ) : (
        head
      )}
      {children}
    </section>
  );
}

export function TodayScreen() {
  const state = useDemoState();
  const patient = useActivePatient();
  const device = useDevice();
  const now = useNow();
  const today = toDateKey(now);

  const tests = useMemo(() => testsForPatient(state.tests, patient.id), [state.tests, patient.id]);
  const checkIns = useMemo(() => checkInsForPatient(state.checkIns, patient.id), [state.checkIns, patient.id]);
  const week7 = useMemo(() => buildDaySeries(tests, today, 7), [tests, today]);
  const primaryToday = primaryTestOfDay(testsOnDay(tests, today));
  const completed = primaryToday !== null && primaryToday.outcome !== 'STOPPED';
  const checkIn = checkInOn(checkIns, today);
  const weekly = weeklyForPatient(state.weeklyCheckIns ?? [], patient.id);
  const weeklyIsDue = weeklyDue(weekly, today);
  const lastWeekly = latestWeekly(weekly);
  const exerciseDoneToday = (state.exerciseSessions ?? []).some(
    (session) => session.patientId === patient.id && session.reps > 0 && dateKeyOf(session.timestamp) === today,
  );
  const assistCopy = ASSIST_COPY[assistStateOf(device)];
  const assist = {
    state: assistCopy.state,
    line: assistCopy.line
      .replace('{Connect}', device.simulated ? 'Reconnect' : 'Connect')
      .replace('{device}', device.words.name),
  };
  const week = testCompletion(tests, today, 7, patient.enrolledDate);
  const connected = device.connection === 'connected';

  const lastFelt = useMemo(() => {
    for (let index = tests.length - 1; index >= 0; index -= 1) {
      if (tests[index].outcome === 'FELT') return tests[index] as FeltTest;
    }
    return null;
  }, [tests]);

  const resultsUnderReview = useMemo(() => {
    const summary = triageSummaries(state, today).get(patient.id);
    return summary ? summary.pending.some((flag) => RESULT_RULES.includes(flag.ruleId)) : false;
  }, [state, today, patient.id]);

  return (
    <main className="screen-in no-scrollbar flex-1 bg-floor sm:min-h-0 sm:overflow-y-auto">
      {/* Masthead: navy field, mint display type, one burgundy action */}
      <div className="on-dark relative rounded-b-[28px] bg-ink px-6 pb-8 pt-[max(22px,env(safe-area-inset-top))] text-white shadow-[0_-600px_0_600px_#223641] sm:pt-3 sm:shadow-none">
        <div className="relative">
        <div className="flex items-baseline justify-between">
          <span className="text-[17px] font-bold leading-6 tracking-[-0.02em] text-white">Ntact</span>
          <PrototypeTag tone="dark" />
        </div>

        <p className="mt-10 text-[16px] leading-6 text-mist">
          {greetingFor(now)}, {patient.firstName}
        </p>
        <h1 className="serif mt-2 text-[35px] leading-[1.1] text-white">
          Your recovery,
          <br />
          <span className="underline decoration-wine-500 decoration-[3px] underline-offset-[15px] [text-decoration-skip-ink:none]">one day</span> at a time.
        </h1>

        <div className="mt-11 border-t border-navy-rule pt-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-[16px] font-bold leading-6 text-white">Today’s sensation test</h2>
            <span className="shrink-0 text-[15px] leading-6 text-mist">{completed ? 'Completed today' : 'Not completed'}</span>
          </div>

          {completed && primaryToday ? (
            <>
              <p className="serif mt-3 text-[24px] leading-[1.25] text-white">
                {primaryToday.outcome === 'FELT'
                  ? `You felt a vibration at level ${primaryToday.detectedLevel} of 10.`
                  : 'You didn’t report feeling a vibration this time.'}
              </p>
              <div className="mt-6 flex gap-3">
                <Link
                  to="/patient/progress"
                  className="flex min-h-14 flex-1 items-center justify-center rounded-[14px] bg-mint px-4 text-[16px] font-bold text-ink"
                >
                  See your recovery
                </Link>
                <Link
                  to="/patient/test"
                  className="flex min-h-14 items-center justify-center rounded-[14px] border border-mist/60 px-5 text-[16px] font-bold text-white"
                >
                  Test again
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-[15px] leading-6 text-mist">
                {primaryToday
                  ? 'Today’s test was cancelled before a result.'
                  : connected
                    ? 'About 30 seconds.'
                    : device.simulated
                      ? 'The demo device is disconnected. Reconnect it to test.'
                      : 'The Ntact device is not connected. Connect it to test.'}
              </p>
              <Link
                to="/patient/test"
                className="mt-6 flex min-h-[60px] items-center justify-center rounded-[14px] bg-mint px-5 text-[17px] font-bold text-ink active:opacity-90"
              >
                Start today’s test
              </Link>
            </>
          )}
        </div>
        </div>
      </div>

      {/* Paper body: sections separated by rules, no cards */}
      <div className="px-6 pb-8">
        <Section title="Touch Assist" meta={assist.state} to="/patient/assist">
          <p className="mt-1.5 text-[16px] leading-6 text-ink-soft">{assist.line}</p>
        </Section>

        <Section title="Your recent tests">
          <div className="mt-5 flex items-end justify-between gap-6">
            <div>
              <p className="serif text-[50px] leading-[0.95] text-ink">
                {lastFelt ? (
                  <>
                    <span className="text-[20px] leading-none tracking-[-0.02em]">Level </span>
                    {lastFelt.detectedLevel}
                  </>
                ) : (
                  '–'
                )}
              </p>
              <p className="mt-2 text-[15px] leading-5 text-ink-soft">
                {lastFelt ? `last felt, ${relativeDay(dateKeyOf(lastFelt.timestamp), today).toLowerCase()}` : 'nothing felt yet'}
              </p>
            </div>
            <p className="pb-0.5 text-right text-[15px] leading-5 text-ink-soft">
              <span className="nums block text-[19px] font-semibold leading-6 text-ink">
                {week.done} of {week.total} days
              </span>
              tested this week
            </p>
          </div>

          <Link to="/patient/progress" className="mt-5 block" aria-label="Open your recovery chart">
            <LevelGraph series={week7} today={today} plotHeight={120} />
          </Link>
          <p className="mt-1 text-[14px] leading-[21px] text-ink-soft">Lower is gentler.</p>
          <Link to="/patient/progress" className="mt-3 inline-flex min-h-11 items-center text-[16px] font-semibold text-ink underline decoration-wine-600 decoration-2 underline-offset-[6px]">
            See your recovery
          </Link>
        </Section>

        <Section title="Exercises" meta={exerciseDoneToday ? 'Done today' : 'To do'} to="/patient/exercise">
          <p className="mt-1.5 text-[16px] leading-6 text-ink-soft">
            {exerciseDoneToday
              ? 'Open and close, done. Your camera followed your fingers and counted for you.'
              : 'Open and close: ten repetitions, guided by your camera. About a minute.'}
          </p>
        </Section>

        <Section title="Daily check-in" meta={checkIn ? '1 of 1 today' : '0 of 1 today'}>
          <p className="mt-1.5 text-[16px] leading-6 text-ink-soft">
            {checkIn ? `You reported pain ${painOf(checkIn) ?? '–'} of 10 today.` : 'Three short questions. Under a minute.'}
          </p>
          <Link
            to="/patient/check-in"
            className="mt-5 flex min-h-14 items-center justify-center rounded-[14px] bg-ink px-5 text-[16px] font-bold text-white active:bg-navy-900"
          >
            {checkIn ? 'Edit today’s check-in' : 'Check in'}
          </Link>
          <p className="mt-4 flex items-baseline justify-between gap-4 text-[15px] leading-6 text-ink-soft">
            <span>
              {weeklyIsDue
                ? 'Your three weekly questions are due.'
                : `Weekly questions answered ${lastWeekly ? relativeDay(lastWeekly.date, today).toLowerCase() : ''}.`}
            </span>
            <Link
              to="/patient/check-in/weekly"
              className="shrink-0 font-semibold text-ink underline decoration-wine-600 decoration-2 underline-offset-[6px]"
            >
              {weeklyIsDue ? 'Answer' : 'Edit'}
            </Link>
          </p>
        </Section>

        <footer className="border-t border-rule pt-6 text-[14.5px] leading-6 text-ink-soft">
          {resultsUnderReview ? <p className="mb-5 text-[17px] font-semibold leading-7 text-ink">{homeLine(tests, today, true)}</p> : null}
          <p className="flex items-baseline justify-between gap-4">
            <Link to="/patient/device" className="-my-2 py-2 underline decoration-rule underline-offset-4">
              {linkSummary(device)}
            </Link>
            <span>{formatDayLong(today)}</span>
          </p>
          <p className="mt-1">Concept prototype • Fictional data</p>
        </footer>
      </div>
    </main>
  );
}
