import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, HeartHandshake, Sprout, Stethoscope } from 'lucide-react';
import { useActivePatient, useDemoState, useToday } from '../../app/hooks';
import { useSwipe } from '../../app/useSwipe';
import { PainChart, PainLegend } from '../../components/charts/PainChart';
import { LevelGraph } from '../../components/charts/LevelGraph';
import { patientReadout } from '../../components/charts/RecoveryChart';
import { Card, Explainer, IconChip, Segmented, cx, type Tone } from '../../components/ui';
import { describeCold, noteOf, painOf, skinIssueOf, skinNoteOf } from '../../domain/checkIn';
import { formatDay, formatTime } from '../../domain/dates';
import { recoveryMessage, type RecoveryMessage } from '../../domain/patientMessages';
import { buildDaySeries, checkInsForPatient, describeTest, testsForPatient } from '../../domain/selectors';
import { RESULT_RULES, triageSummaries } from '../../domain/triage';
import { OutcomeMark } from '../clinician/parts';
import { Screen, SectionHeading, TopBar } from './PatientShell';

type Range = '14' | '30' | '90';

const RANGES: { value: Range; label: string }[] = [
  { value: '14', label: '2 weeks' },
  { value: '30', label: '1 month' },
  { value: '90', label: '3 months' },
];

const MESSAGE_STYLE: Record<RecoveryMessage['kind'], { icon: typeof Sprout; tone: Tone }> = {
  review: { icon: Stethoscope, tone: 'navy' },
  trend: { icon: Sprout, tone: 'teal' },
  today: { icon: ClipboardCheck, tone: 'teal' },
  starting: { icon: Sprout, tone: 'teal' },
  steady: { icon: HeartHandshake, tone: 'teal' },
};

const HISTORY_PAGE = 5;

export function ProgressScreen() {
  const state = useDemoState();
  const patient = useActivePatient();
  const today = useToday();
  const [range, setRange] = useState<Range>('14');
  const [active, setActive] = useState<number | null>(null);
  const [shown, setShown] = useState(HISTORY_PAGE);

  // Swipe across the chart card to move between 2 weeks, 1 month and 3 months.
  const rangeSwipe = useSwipe((direction) => {
    const index = RANGES.findIndex((option) => option.value === range);
    const next = RANGES[index + (direction === 'left' ? 1 : -1)];
    if (next) setRange(next.value);
  });

  const days = Number(range);
  const tests = useMemo(() => testsForPatient(state.tests, patient.id), [state.tests, patient.id]);
  const checkIns = useMemo(() => checkInsForPatient(state.checkIns, patient.id), [state.checkIns, patient.id]);
  const series = useMemo(() => buildDaySeries(tests, today, days), [tests, today, days]);
  const dates = useMemo(() => series.map((point) => point.date), [series]);
  const checkInByDate = useMemo(() => new Map(checkIns.map((entry) => [entry.date, entry])), [checkIns]);

  useEffect(() => {
    setActive(null);
    setShown(HISTORY_PAGE);
  }, [range, patient.id]);

  const resultsUnderReview = useMemo(() => {
    const summary = triageSummaries(state, today).get(patient.id);
    return summary ? summary.pending.some((flag) => RESULT_RULES.includes(flag.ruleId)) : false;
  }, [state, today, patient.id]);

  const message = useMemo(() => recoveryMessage({ tests, today, resultsUnderReview }), [tests, today, resultsUnderReview]);
  const style = MESSAGE_STYLE[message.kind];

  // Readout: the day being pointed at, otherwise the most recent day with a test.
  const fallbackIndex = useMemo(() => {
    for (let index = series.length - 1; index >= 0; index -= 1) if (series[index].primary) return index;
    return series.length - 1;
  }, [series]);
  // A day picked in a longer range may not exist in a shorter one; never index past the end.
  const safeActive = active !== null && active < series.length ? active : null;
  const readoutPoint = series[safeActive ?? fallbackIndex] ?? series[series.length - 1];

  // History: newest first, only days on or after enrolment that have something to show.
  const history = useMemo(
    () =>
      [...series]
        .reverse()
        .filter((point) => point.date >= patient.enrolledDate)
        .map((point) => ({ point, checkIn: checkInByDate.get(point.date) ?? null }))
        .filter((entry) => entry.point.tests.length > 0 || entry.checkIn !== null),
    [series, checkInByDate, patient.enrolledDate],
  );

  const hasAnyTest = tests.length > 0;

  return (
    <Screen header={<TopBar title="Recovery" />}>
      <div data-own-swipe {...rangeSwipe}>
        <Segmented<Range> options={RANGES} value={range} onChange={(value) => setRange(value)} label="Time range" block />
      </div>

      {/* The recovery curve */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex items-start gap-3 px-4 pt-4">
          <IconChip icon={style.icon} tone={style.tone} round />
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold leading-[22px] tracking-[-0.015em] text-ink">{message.headline}</h2>
          </div>
        </div>

        <div className="mt-4 px-1.5">
          <p className="px-2.5 text-[15px] font-bold leading-5 text-ink">The level you felt each day</p>
          {hasAnyTest ? (
            <LevelGraph series={series} today={today} activeIndex={safeActive} onActiveChange={setActive} plotHeight={170} className="mt-3 px-1" />
          ) : (
            <div className="mx-2.5 mt-2 grid h-[200px] place-items-center rounded-[12px] bg-canvas px-6 text-center">
              <p className="text-[14.5px] leading-6 text-ink-soft">
                Your curve starts with your first test. Each test adds one point.
              </p>
            </div>
          )}
        </div>

        {hasAnyTest ? (
          <>
            <p
              className="mx-4 mt-1 rounded-full bg-navy-50 px-3.5 py-2 text-center text-[13.5px] font-semibold leading-5 text-ink"
              aria-live="polite"
            >
              {patientReadout(readoutPoint, today)}
            </p>
            <div className="h-4" />
          </>
        ) : (
          <div className="h-4" />
        )}

        <div className="border-t border-line-soft px-4 py-1">
          <Explainer summary="What this can and can’t tell you">
            <p>
              Each dot is the gentlest level you felt that day; lower on the chart means gentler. Days with no test are left
              blank. The levels are settings on this wearable, from 1 (gentlest) to 10 (strongest). They are not a medical
              measurement, and this prototype’s device has not been calibrated.
            </p>
            <p className="mt-2">
              Results can shift with how the sleeve sits, how your finger is resting, cold hands and how quickly you tap. One
              result on its own doesn’t say anything about your nerve. Your therapist is the right person to interpret your
              recovery.
            </p>
            <p className="mt-2">
              Dots are only joined when they are on days next to each other. Tests that finished without you reporting a
              vibration sit in the row underneath, not on the scale.
            </p>
          </Explainer>
        </div>
      </Card>

      {/* What the patient reported */}
      <section aria-labelledby="reported" className="mt-6">
        <SectionHeading>
          <span id="reported">How you’ve been feeling</span>
        </SectionHeading>
        <Card className="mt-2.5 px-1.5 pb-4 pt-4">
          <p className="px-2.5 text-[12.5px] font-semibold leading-4 text-ink-soft">Pain you reported, from your check-ins</p>
          {checkIns.length > 0 ? (
            <>
              <PainChart dates={dates} checkIns={checkIns} today={today} variant="patient" activeIndex={safeActive} onActiveChange={setActive} className="mt-1" />
              <PainLegend className="px-2.5 pt-1" />
            </>
          ) : (
            <p className="px-2.5 py-6 text-[14.5px] leading-6 text-ink-soft">Your check-ins will appear here once you have done one.</p>
          )}
        </Card>
      </section>

      {/* Day-by-day history */}
      <section aria-labelledby="history" className="mt-6">
        <SectionHeading>
          <span id="history">Day by day</span>
        </SectionHeading>

        {history.length === 0 ? (
          <Card className="mt-2.5 p-5">
            <p className="text-[14.5px] leading-6 text-ink-soft">Nothing recorded in this period yet.</p>
          </Card>
        ) : (
          <ol className="mt-2.5 space-y-2.5">
            {history.slice(0, shown).map(({ point, checkIn }) => {
              const pain = checkIn ? painOf(checkIn) : null;
              const skin = checkIn ? skinIssueOf(checkIn) : null;
              const note = checkIn ? [skinNoteOf(checkIn), noteOf(checkIn)].filter(Boolean).join(' ') : '';
              return (
                <li key={point.date}>
                  <Card className="px-4 py-3.5">
                    <p className="text-[13px] font-bold leading-5 text-ink">{point.date === today ? 'Today' : formatDay(point.date)}</p>
                    {point.tests.length > 0 ? (
                      <ul className="mt-1.5 space-y-1">
                        {point.tests.map((test) => (
                          <li key={test.id} className="flex items-center gap-2 text-[14.5px] leading-6 text-ink">
                            <OutcomeMark outcome={test.outcome} />
                            <span className="flex-1">{describeTest(test)}</span>
                            <span className="nums text-[12.5px] text-ink-soft">{formatTime(test.timestamp)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1.5 flex items-center gap-2 text-[14.5px] leading-6 text-ink-soft">
                        <OutcomeMark outcome="NONE" />
                        No test
                      </p>
                    )}
                    {checkIn ? (
                      <div className="mt-2.5 border-t border-line-soft pt-2.5">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] leading-5 text-ink">
                          <span className="rounded-full bg-floor px-2 py-0.5 text-[12px] font-bold text-ink">Check-in</span>
                          <span className="nums">Pain {pain ?? '–'} of 10</span>
                          <span className="text-ink-faint" aria-hidden="true">
                            /
                          </span>
                          <span>Cold: {describeCold(checkIn).toLowerCase()}</span>
                          {skin ? <span className={cx('font-semibold text-wine-600')}>New skin issue</span> : null}
                        </p>
                        {note ? <p className="mt-1.5 text-[13.5px] leading-5 text-ink-soft">“{note}”</p> : null}
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ol>
        )}

        {history.length > shown ? (
          <button
            type="button"
            onClick={() => setShown(shown + HISTORY_PAGE)}
            className="mt-3 min-h-11 w-full rounded-full bg-paper text-[14.5px] font-semibold text-ink underline decoration-wine-600 decoration-2 underline-offset-[6px] hover:bg-navy-50"
          >
            Show earlier days
          </button>
        ) : null}
      </section>
    </Screen>
  );
}
