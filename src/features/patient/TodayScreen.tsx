import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CaretRight, CheckCircle, ClipboardText, Fingerprint, HandPalm, HandTap, type Icon } from '@phosphor-icons/react';
import { assistStateOf, useDevice, type AssistState } from '../../app/DeviceContext';
import { useActivePatient, useDemoState, useNow } from '../../app/hooks';
import { cx } from '../../components/ui';
import { painOf, weeklyDue, weeklyForPatient } from '../../domain/checkIn';
import { formatDayLong, greetingFor, toDateKey } from '../../domain/dates';
import { physioToday } from '../../domain/exercise';
import { homeLine } from '../../domain/patientMessages';
import { checkInOn, checkInsForPatient, primaryTestOfDay, testsForPatient, testsOnDay } from '../../domain/selectors';
import { RESULT_RULES, triageSummaries } from '../../domain/triage';
import { linkSummary } from './deviceCopy';
import { HelpButton } from './PatientShell';

const ASSIST_WORD: Record<AssistState, string> = {
  on: 'On',
  paused: 'Paused',
  testing: 'Paused for the test',
  offline: 'Not connected',
  checking: 'Checking',
  changing: 'Updating',
};

interface Task {
  key: string;
  title: string;
  /** One short line: what it is, or what happened. */
  line: string;
  to: string;
  icon: Icon;
  done: boolean;
}

/**
 * Home is a to-do list and nothing else: the three things to do today, each one tap
 * away, with the next one picked out. Charts and history live on the Recovery tab.
 */
export function TodayScreen() {
  const state = useDemoState();
  const patient = useActivePatient();
  const device = useDevice();
  const now = useNow();
  const today = toDateKey(now);

  const tests = useMemo(() => testsForPatient(state.tests, patient.id), [state.tests, patient.id]);
  const checkIns = useMemo(() => checkInsForPatient(state.checkIns, patient.id), [state.checkIns, patient.id]);
  const primaryToday = primaryTestOfDay(testsOnDay(tests, today));
  const tested = primaryToday !== null && primaryToday.outcome !== 'STOPPED';
  const checkIn = checkInOn(checkIns, today);
  const physio = physioToday(state.exerciseSessions ?? [], state.exercisePlans, patient.id, today);
  // With nothing unlocked there is nothing to do, so it does not hold the day up.
  const exercised = physio.allDone || physio.unlocked.length === 0;
  const weeklyIsDue = weeklyDue(weeklyForPatient(state.weeklyCheckIns ?? [], patient.id), today);
  const assist = assistStateOf(device);

  const resultsUnderReview = useMemo(() => {
    const summary = triageSummaries(state, today).get(patient.id);
    return summary ? summary.pending.some((flag) => RESULT_RULES.includes(flag.ruleId)) : false;
  }, [state, today, patient.id]);

  const tasks: Task[] = [
    {
      key: 'test',
      title: 'Sensation test',
      line: tested
        ? primaryToday?.outcome === 'FELT'
          ? `Done. You felt it at level ${primaryToday.detectedLevel} of 10.`
          : 'Done. Not felt this time.'
        : 'About 30 seconds, with your wristband.',
      to: '/patient/test',
      icon: Fingerprint,
      done: tested,
    },
    {
      key: 'exercise',
      title: 'Physio',
      line:
        physio.unlocked.length === 0
          ? 'Nothing unlocked yet.'
          : physio.allDone
            ? `Done. ${physio.done.length} of ${physio.unlocked.length} exercises.`
            : physio.done.length > 0
              ? `${physio.done.length} of ${physio.unlocked.length} exercises done.`
              : `${physio.unlocked.length} exercises, guided by your camera.`,
      to: '/patient/exercise',
      icon: HandPalm,
      done: exercised,
    },
    {
      key: 'check-in',
      title: 'Check-in',
      line: checkIn ? `Done. Pain ${painOf(checkIn) ?? '–'} of 10.` : 'Three quick questions.',
      to: '/patient/check-in',
      icon: ClipboardText,
      done: checkIn !== null,
    },
  ];
  const doneCount = tasks.filter((task) => task.done).length;
  const next = tasks.find((task) => !task.done) ?? null;

  return (
    <main className="screen-in no-scrollbar flex-1 sm:min-h-0 sm:overflow-y-auto">
      {/* Masthead: navy, with the day's progress in gold */}
      <div className="on-dark relative rounded-b-[32px] bg-ink px-6 pb-7 pt-[max(18px,env(safe-area-inset-top))] text-white shadow-[0_-600px_0_600px_#14213D] sm:pt-2 sm:shadow-none">
        <div className="flex items-center justify-between">
          <span className="text-[18px] font-bold leading-6 tracking-[-0.02em]">Ntact</span>
          <HelpButton tone="dark" />
        </div>

        <p className="mt-7 text-[15.5px] leading-6 text-mist">
          {greetingFor(now)}, {patient.firstName}
        </p>
        <h1 className="display mt-1 text-[33px] leading-[1.12] text-white">
          {doneCount === tasks.length ? 'All done for today.' : doneCount === 0 ? 'Three things today.' : `${tasks.length - doneCount} to go today.`}
        </h1>

        <div className="mt-5 flex items-center gap-3" aria-label={`${doneCount} of ${tasks.length} done today`}>
          <div className="flex flex-1 gap-1.5" aria-hidden="true">
            {tasks.map((task) => (
              <span key={task.key} className={cx('h-1.5 flex-1 rounded-full transition-colors duration-300', task.done ? 'bg-mint' : 'bg-white/20')} />
            ))}
          </div>
          <span className="nums text-[13.5px] font-semibold leading-5 text-mist">
            {doneCount} of {tasks.length}
          </span>
        </div>
      </div>

      <div className="px-5 pb-6 pt-5">
        <ul className="space-y-3">
          {tasks.map((task) => {
            const isNext = next?.key === task.key;
            return (
              <li key={task.key}>
                <Link
                  to={task.to}
                  className={cx(
                    'flex min-h-[84px] items-center gap-4 rounded-[24px] px-4 py-3.5 transition-transform duration-150 active:scale-[0.985]',
                    isNext ? 'btn-primary text-white shadow-button' : 'glass text-ink',
                  )}
                >
                  <span
                    className={cx(
                      'grid size-12 shrink-0 place-items-center rounded-full',
                      task.done ? 'bg-green-50 text-green-700' : isNext ? 'bg-mint text-ink' : 'bg-navy-50 text-ink',
                    )}
                  >
                    {task.done ? <CheckCircle size={26} weight="fill" aria-hidden="true" /> : <task.icon size={24} weight="regular" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17.5px] font-bold leading-6 tracking-[-0.015em]">{task.title}</span>
                    <span className={cx('block text-[14.5px] leading-5', isNext ? 'text-mist' : 'text-ink-soft')}>{task.line}</span>
                  </span>
                  {isNext ? (
                    <span className="shrink-0 rounded-full bg-mint px-4 py-2 text-[14.5px] font-bold leading-5 text-ink">Start</span>
                  ) : (
                    <CaretRight size={18} weight="bold" className={task.done ? 'text-ink-faint' : 'text-ink-soft'} aria-hidden="true" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {weeklyIsDue ? (
          <Link to="/patient/check-in/weekly" className="glass mt-3 flex min-h-[60px] items-center justify-between gap-4 rounded-[20px] px-5 py-3">
            <span>
              <span className="block text-[15.5px] font-bold leading-5 text-ink">Weekly questions are due</span>
              <span className="block text-[13.5px] leading-5 text-ink-soft">Three questions about the past week.</span>
            </span>
            <CaretRight size={18} weight="bold" className="shrink-0 text-ink-soft" aria-hidden="true" />
          </Link>
        ) : null}

        {/* Touch Assist is not a task. It is the thing the wearable does all day. */}
        <Link to="/patient/assist" className="glass mt-5 flex min-h-[68px] items-center gap-4 rounded-[22px] px-4 py-3">
          <span className={cx('grid size-11 shrink-0 place-items-center rounded-full', assist === 'on' ? 'bg-mint-soft text-ink' : 'bg-navy-50 text-ink-soft')}>
            <HandTap size={22} weight={assist === 'on' ? 'fill' : 'regular'} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-bold leading-5 text-ink">Touch Assist</span>
            <span className="block text-[13.5px] leading-5 text-ink-soft">Taps at your wrist when your fingertip touches something.</span>
          </span>
          <span
            className={cx(
              'shrink-0 rounded-full px-3 py-1.5 text-[13px] font-bold leading-4',
              assist === 'on' ? 'bg-ink text-mint' : assist === 'offline' ? 'bg-amber-50 text-amber-700' : 'bg-navy-50 text-ink-soft',
            )}
          >
            {ASSIST_WORD[assist]}
          </span>
        </Link>

        {resultsUnderReview ? <p className="mt-5 px-1 text-[15px] leading-6 text-ink">{homeLine(tests, today, true)}</p> : null}

        <footer className="mt-6 flex items-baseline justify-between gap-4 px-1 text-[13.5px] leading-5 text-ink-soft">
          <Link to="/patient/settings" className="-my-2 py-2 underline decoration-rule underline-offset-4">
            {linkSummary(device)}
          </Link>
          <span>{formatDayLong(today)}</span>
        </footer>
      </div>
    </main>
  );
}
