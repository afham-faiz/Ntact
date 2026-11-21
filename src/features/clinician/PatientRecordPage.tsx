import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useDemoState, useToday } from '../../app/hooks';
import { PainChart, PainLegend } from '../../components/charts/PainChart';
import { RecoveryChart, RecoveryLegend } from '../../components/charts/RecoveryChart';
import { CompletionStrip, WeeklyBars, type StripDay } from '../../components/charts/Small';
import { useToast } from '../../components/Toast';
import { Button, Panel, Segmented, SimulatedBadge, cx } from '../../components/ui';
import { demoStore } from '../../demo/store';
import { adherenceFor, simulatedWearTime } from '../../domain/adherence';
import { describeCold, noteOf, painOf, skinIssueOf, skinNoteOf } from '../../domain/checkIn';
import { dateKeyOf, daysBetween, formatDateFull, formatDay, formatDayShort, formatSeconds, formatTime } from '../../domain/dates';
import { ESTIMATE_LABEL, SEGMENT_LABEL, estimateReturnWindow } from '../../domain/recoveryEstimate';
import { buildDaySeries, checkInsForPatient, linearFit, testsForPatient } from '../../domain/selectors';
import { AssessmentReviewPanel, ProtocolPanel } from './AssessmentPanel';
import { FollowUpControl, MovementPanel, WeeklyPanel } from './MovementPanel';
import { DIRECTION_CAVEAT, LEVEL_LABEL, RESULT_RULES, ROUTE_LABEL, ROUTE_REASON, RULE_LABEL, RULE_ROUTE, deriveFlags, triageSummaries } from '../../domain/triage';
import type { TriageLevel } from '../../domain/types';
import { ClinicalSetupModal, FlagModal, LOCAL_ONLY, NoteModal, RecordReviewModal } from './modals';
import { OutcomeMark, injurySite, outcomeKind, testSourceLabel } from './parts';

type Range = '14' | '30' | '90';
const RANGES: { value: Range; label: string }[] = [
  { value: '14', label: '2 weeks' },
  { value: '30', label: '1 month' },
  { value: '90', label: '3 months' },
];

const MARK: Record<TriageLevel, string> = {
  RED: 'bg-wine-600',
  AMBER: 'bg-amber-500',
  GREEN: 'border border-ink/45',
};

function Head({ title, note, action }: { title: string; note?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-6 pt-5">
      <div className="min-w-0">
        <h2 className="text-[17px] font-bold leading-6 tracking-[-0.02em] text-ink">{title}</h2>
        {note ? <p className="mt-0.5 max-w-[70ch] text-[13px] leading-5 text-ink-soft">{note}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** The record is split three ways so one screen never holds everything at once. */
type RecordTab = 'overview' | 'results' | 'movement';

const RECORD_TABS: { value: RecordTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'results', label: 'Test results' },
  { value: 'movement', label: 'Movement and check-ins' },
];

function Ratio({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-[13.5px] leading-5 text-ink-soft">{label}</span>
      <span className="nums text-[14.5px] font-bold leading-5 text-ink">
        {done} of {total} days
      </span>
    </div>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange(value: boolean): void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13.5px] font-medium leading-5 text-ink">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-[#14213D]" />
      {children}
    </label>
  );
}

export function PatientRecordPage() {
  const { id } = useParams();
  const state = useDemoState();
  const today = useToday();
  const toast = useToast();
  const patient = state.patients.find((item) => item.id === id);

  const [range, setRange] = useState<Range>('30');
  const [active, setActive] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showWindow, setShowWindow] = useState(true);
  const [showTrend, setShowTrend] = useState(false);
  const [modal, setModal] = useState<'review' | 'flag' | 'note' | 'setup' | null>(null);
  const [resultRows, setResultRows] = useState(12);
  // A link can open the record on a particular part: /clinician/patients/p-maya?tab=movement
  const [query] = useSearchParams();
  const asked = query.get('tab');
  const [tab, setTab] = useState<RecordTab>(asked === 'movement' || asked === 'results' ? asked : 'overview');

  useEffect(() => {
    setActive(null);
    setSelected(null);
  }, [range, id]);

  const tests = useMemo(() => (patient ? testsForPatient(state.tests, patient.id) : []), [state.tests, patient]);
  const checkIns = useMemo(() => (patient ? checkInsForPatient(state.checkIns, patient.id) : []), [state.checkIns, patient]);
  const days = Number(range);
  const series = useMemo(() => buildDaySeries(tests, today, days), [tests, today, days]);
  const dates = useMemo(() => series.map((point) => point.date), [series]);
  const checkInByDate = useMemo(() => new Map(checkIns.map((entry) => [entry.date, entry])), [checkIns]);

  if (!patient) {
    return (
      <div className="py-24 text-center">
        <h1 className="serif text-[30px] leading-9 text-ink">No record with that ID.</h1>
        <Link to="/clinician" className="mt-3 inline-block text-[15px] font-semibold text-ink underline decoration-mint decoration-2 underline-offset-4">
          Back to the worklist
        </Link>
      </div>
    );
  }

  const summary = triageSummaries(state, today).get(patient.id);
  const level: TriageLevel = summary?.level ?? 'GREEN';
  const pending = summary?.pending ?? [];
  const stillActive = summary?.reviewedStillActive ?? [];
  const reviewedLog = deriveFlags(state, today)
    .filter((flag) => flag.patientId === patient.id && flag.status === 'reviewed')
    .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''));
  const notes = state.clinicianNotes.filter((note) => note.patientId === patient.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const adherence = adherenceFor(patient, tests, checkIns, today);
  const estimate = estimateReturnWindow(patient, state.estimateConfig);
  const wear = simulatedWearTime(patient.id, today, 7);
  const daysSinceRepair = daysBetween(patient.repairDate, today);

  const fit = showTrend
    ? linearFit(series.flatMap((point, index) => (point.kind === 'FELT' ? [{ x: index, y: point.step as number }] : [])))
    : null;

  const strip: StripDay[] = buildDaySeries(tests, today, 28).map((point) => ({
    date: point.date,
    kind: point.kind,
    checkIn: checkInByDate.has(point.date),
    outside: point.date < patient.enrolledDate,
  }));

  const inspected = selected !== null ? series[selected] : null;
  const inspectedCheckIn = inspected ? checkInByDate.get(inspected.date) ?? null : null;
  const allResults = [...tests].reverse();

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="pb-6 pt-8">
        <Link to="/clinician" className="text-[14px] font-semibold text-ink-soft hover:text-ink">
          ‹ Patients
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <h1 className="serif text-[34px] leading-10 text-ink">{patient.name}</h1>
            <p className="nums mt-1 text-[14.5px] leading-6 text-ink-soft">
              {injurySite(patient)}. {patient.injury}, {daysSinceRepair} days since repair (week {Math.floor(daysSinceRepair / 7)}). {patient.demoId}, fictional.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setModal('note')}>
              Add note
            </Button>
            <Button variant="outline" size="sm" onClick={() => setModal('flag')}>
              Mark for review
            </Button>
            <Button variant="primary" size="sm" onClick={() => setModal('review')} disabled={pending.length === 0}>
              Record review{pending.length > 0 ? ` (${pending.length})` : ''}
            </Button>
          </div>
        </div>
      </div>

      <Segmented<RecordTab> options={RECORD_TABS} value={tab} onChange={setTab} label="Part of the record" className="mb-5" />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {tab === 'overview' ? (
            <>
          {/* Why this record is flagged */}
          <Panel className={cx('overflow-hidden', level === 'RED' && 'border-wine-300')}>
            <div className={cx('h-1', level === 'RED' ? 'bg-wine-600' : level === 'AMBER' ? 'bg-amber-500' : 'bg-rule')} />
            <Head
              title={LEVEL_LABEL[level]}
              note={
                level === 'GREEN'
                  ? 'None of the provisional rules is met for this record today. This is not a clinical assessment.'
                  : 'The exact provisional condition behind each flag, and the recorded data that met it. Provisional rules, not clinical guidelines.'
              }
              action={
                <Link to="/clinician/rules" className="text-[13.5px] font-semibold text-ink underline decoration-mint decoration-2 underline-offset-4">
                  View the rules
                </Link>
              }
            />
            <div className="px-6 pb-5 pt-3">
              {pending.length === 0 && stillActive.length === 0 ? (
                <p className="text-[14px] leading-6 text-ink-soft">Nothing is waiting for review.</p>
              ) : null}
              <ul className="divide-y divide-rule">
                {pending.map((flag) => (
                  <li key={flag.id} className="py-4 first:pt-1">
                    <p className="flex items-center gap-2.5 text-[15.5px] font-bold leading-6 text-ink">
                      <span className={cx('size-2.5 shrink-0 rounded-[2px]', MARK[flag.level])} aria-hidden="true" />
                      {RULE_LABEL[flag.ruleId]}
                      <span className={cx('text-[13px] font-semibold', flag.level === 'RED' ? 'text-wine-600' : 'text-amber-700')}>{LEVEL_LABEL[flag.level]}</span>
                    </p>
                    <dl className="mt-2 grid gap-x-6 gap-y-2 text-[13.5px] leading-[21px] md:grid-cols-[150px_minmax(0,1fr)]">
                      <dt className="text-ink-soft">Provisional condition</dt>
                      <dd className="text-ink">{flag.condition}</dd>
                      <dt className="text-ink-soft">What was recorded</dt>
                      <dd className="text-ink">{flag.evidence}</dd>
                      <dt className="text-ink-soft">Goes to</dt>
                      <dd className="text-ink">
                        <span className="font-bold">{ROUTE_LABEL[RULE_ROUTE[flag.ruleId]]}.</span> {ROUTE_REASON[RULE_ROUTE[flag.ruleId]]}
                      </dd>
                      {RESULT_RULES.includes(flag.ruleId) ? (
                        <>
                          <dt className="text-ink-soft">Unconfirmed</dt>
                          <dd className="text-ink-soft">{DIRECTION_CAVEAT}</dd>
                        </>
                      ) : null}
                    </dl>
                  </li>
                ))}
                {stillActive.map((flag) => (
                  <li key={flag.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3 text-[13.5px] leading-5">
                    <span className="text-ink-soft">
                      <span className="font-semibold text-ink">{RULE_LABEL[flag.ruleId]}</span>: reviewed {flag.reviewedAt ? formatDayShort(dateKeyOf(flag.reviewedAt)) : ''}. The condition is still met.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        demoStore.reopenFlag(flag.id);
                        toast.show('Flag reopened. Saved locally.');
                      }}
                      className="font-semibold text-ink underline decoration-mint decoration-2 underline-offset-4"
                    >
                      Reopen
                    </button>
                  </li>
                ))}
              </ul>
              <FollowUpControl patient={patient} state={state} level={level} />
            </div>
          </Panel>

          {/* Recovery curve */}
          <Panel>
            <Head
              title="Recovery curve"
              note="Detected level per day. A level is a motor command setting (RTP 1 to 105), not a calibrated vibration amplitude. Hatched days had no test."
              action={<Segmented<Range> options={RANGES} value={range} onChange={(value) => setRange(value)} label="Time range" size="sm" />}
            />
            <div className="flex flex-wrap gap-x-6 gap-y-2 px-6 pt-3">
              <Toggle checked={showWindow} onChange={setShowWindow}>
                Illustrative return window
              </Toggle>
              <Toggle checked={showTrend} onChange={setShowTrend}>
                Statistical trend line
              </Toggle>
            </div>
            <div className="px-3 pt-2">
              <RecoveryChart
                series={series}
                today={today}
                variant="clinician"
                activeIndex={active}
                onActiveChange={setActive}
                selectedIndex={selected}
                onSelect={setSelected}
                enrolledDate={patient.enrolledDate}
                returnWindow={showWindow && estimate ? estimate : null}
                fit={fit}
                highlightMissing
              />
            </div>
            <RecoveryLegend variant="clinician" className="px-6 pt-1" />
            {showTrend ? (
              <p className="px-6 pt-2 text-[12.5px] leading-5 text-ink-soft">
                The dotted line is a least-squares fit through the felt results in view. It is a statistical illustration, not a
                validated medical forecast, and it is not derived from the return window.
              </p>
            ) : null}

            <div className="mt-4 border-t border-rule px-3 pt-4">
              <p className="px-3 text-[13px] font-semibold leading-5 text-ink-soft">Reported pain, 0 to 10. A separate axis: patient-reported, not measured.</p>
              <PainChart dates={dates} checkIns={checkIns} today={today} variant="clinician" activeIndex={active ?? selected} onActiveChange={setActive} />
              <PainLegend className="px-3" />
            </div>

            {/* Inspect one day */}
            <div className="mt-4 border-t border-rule px-6 py-5">
              {inspected ? (
                <>
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="text-[15px] font-bold leading-6 text-ink">{formatDay(inspected.date)}</h3>
                    <button type="button" onClick={() => setSelected(null)} className="text-[13.5px] font-semibold text-ink-soft hover:text-ink">
                      Clear
                    </button>
                  </div>
                  {inspected.tests.length === 0 ? (
                    <p className="mt-1 text-[14px] leading-6 text-ink-soft">
                      {inspected.date < patient.enrolledDate ? 'Before enrolment.' : 'No test was logged on this day.'}
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {inspected.tests.map((test) => (
                        <li key={test.id} className="nums flex flex-wrap items-center gap-x-3 text-[14px] leading-6 text-ink">
                          <OutcomeMark outcome={test.outcome} />
                          <span className="text-ink-soft">{formatTime(test.timestamp)}</span>
                          <span className="font-semibold">{outcomeKind(test)}</span>
                          {test.outcome === 'FELT' ? (
                            <span>
                              level {test.detectedLevel}, motor command RTP {test.commandedRtp}, reported after {formatSeconds(test.elapsedMs)}
                            </span>
                          ) : (
                            <span className="text-ink-soft">no level recorded</span>
                          )}
                          <span className="text-ink-soft">{testSourceLabel(test)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-[14px] leading-6 text-ink">
                    {inspectedCheckIn ? (
                      <span className="nums">
                        Check-in: pain {painOf(inspectedCheckIn) ?? '–'}/10, cold sensitivity {describeCold(inspectedCheckIn).toLowerCase()},{' '}
                        {skinIssueOf(inspectedCheckIn) ? 'new skin issue reported' : 'no new skin issues'}.
                        {[skinNoteOf(inspectedCheckIn), noteOf(inspectedCheckIn)].filter(Boolean).map((text) => ` “${text}”`)}
                      </span>
                    ) : (
                      <span className="text-ink-soft">No check-in on this day.</span>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-[14px] leading-6 text-ink-soft">Select a day on the chart to inspect its tests and check-in.</p>
              )}
            </div>
          </Panel>
            </>
          ) : null}

          {tab === 'results' ? (
            <>
          {/* Daily results */}
          <Panel className="overflow-hidden">
            <Head title="Daily results" note="Every test on record, newest first. “Wearable” means the outcome was reported by the physical device over Bluetooth; everything else is demonstration data." />
            <div className="quiet-scroll mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[14px] leading-6">
                <thead>
                  <tr className="border-y border-rule bg-floor text-left text-[12.5px] font-semibold text-ink-soft">
                    <th scope="col" className="py-2.5 pl-6 pr-4">Date</th>
                    <th scope="col" className="px-4 py-2.5">Time</th>
                    <th scope="col" className="px-4 py-2.5">Result</th>
                    <th scope="col" className="px-4 py-2.5">Level</th>
                    <th scope="col" className="px-4 py-2.5">Motor command</th>
                    <th scope="col" className="px-4 py-2.5">Reported after</th>
                    <th scope="col" className="px-4 py-2.5 pr-6">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {allResults.slice(0, resultRows).map((test) => (
                    <tr key={test.id} className="nums border-b border-rule/70 last:border-b-0">
                      <td className="whitespace-nowrap py-2.5 pl-6 pr-4 text-ink">{formatDay(dateKeyOf(test.timestamp))}</td>
                      <td className="px-4 py-2.5 text-ink-soft">{formatTime(test.timestamp)}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2 text-ink">
                          <OutcomeMark outcome={test.outcome} />
                          {outcomeKind(test)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-bold text-ink">{test.outcome === 'FELT' ? test.detectedLevel : '–'}</td>
                      <td className="px-4 py-2.5 text-ink-soft">{test.outcome === 'FELT' ? `RTP ${test.commandedRtp}` : '–'}</td>
                      <td className="px-4 py-2.5 text-ink-soft">{test.outcome === 'FELT' ? formatSeconds(test.elapsedMs) : '–'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 pr-6 text-ink-soft">{testSourceLabel(test)}</td>
                    </tr>
                  ))}
                  {allResults.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-ink-soft">
                        No tests on record yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {allResults.length > resultRows ? (
              <button type="button" onClick={() => setResultRows(resultRows + 20)} className="w-full border-t border-rule py-3 text-[14px] font-semibold text-ink hover:bg-floor">
                Show earlier results
              </button>
            ) : null}
          </Panel>
            </>
          ) : null}

          {tab === 'movement' ? (
            <>
          <AssessmentReviewPanel patient={patient} state={state} today={today} />

          {/* Check-ins */}
          <Panel className="overflow-hidden">
            <Head title="Check-ins" note="Patient-reported, newest first. Last 14 on record." />
            <ul className="mt-3 divide-y divide-rule/70 border-t border-rule">
              {[...checkIns].reverse().slice(0, 14).map((entry) => {
                const text = [skinNoteOf(entry), noteOf(entry)].filter(Boolean).join(' ');
                return (
                  <li key={entry.id} className="nums grid gap-x-6 gap-y-1 px-6 py-3 text-[14px] leading-6 md:grid-cols-[130px_90px_150px_minmax(0,1fr)]">
                    <span className="text-ink">{formatDay(entry.date)}</span>
                    <span className="font-bold text-ink">Pain {painOf(entry) ?? '–'}/10</span>
                    <span className="text-ink-soft">Cold: {describeCold(entry).toLowerCase()}</span>
                    <span className={skinIssueOf(entry) ? 'font-semibold text-wine-600' : 'text-ink-soft'}>
                      {skinIssueOf(entry) ? 'New skin issue. ' : ''}
                      <span className="font-normal text-ink-soft">{text ? `“${text}”` : skinIssueOf(entry) ? '' : 'No new skin issues'}</span>
                    </span>
                  </li>
                );
              })}
              {checkIns.length === 0 ? <li className="px-6 py-8 text-[14px] text-ink-soft">No check-ins on record yet.</li> : null}
            </ul>
          </Panel>
            </>
          ) : null}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {tab === 'results' ? (
            <>
          <Panel>
            <Head title="Return window" action={<SimulatedBadge>Illustrative</SimulatedBadge>} />
            <div className="px-6 pb-5 pt-2">
              <p className="text-[12.5px] font-semibold leading-5 text-wine-600">{ESTIMATE_LABEL}</p>
              {estimate ? (
                <>
                  <p className="serif nums mt-3 text-[24px] leading-8 text-ink">
                    {formatDayShort(estimate.earliest)} to {formatDayShort(estimate.latest)}
                  </p>
                  <p className="nums mt-1 text-[13.5px] leading-5 text-ink-soft">
                    Day {estimate.earliestDay} to day {estimate.latestDay} after repair. Today is day {daysSinceRepair}.
                  </p>
                  <p className="mt-3 text-[13px] font-semibold leading-5 text-ink">Assumptions</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-[13px] leading-5 text-ink-soft">
                    {estimate.assumptions.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-3 text-[14px] leading-6 text-ink-soft">
                  No injury location has been entered for this record, so no window is shown.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] font-semibold">
                <button type="button" onClick={() => setModal('setup')} className="text-ink underline decoration-mint decoration-2 underline-offset-4">
                  {estimate ? 'Edit clinical setup' : 'Add clinical setup'}
                </button>
                <Link to="/clinician/rules" className="text-ink underline decoration-mint decoration-2 underline-offset-4">
                  Edit assumptions
                </Link>
              </div>
            </div>
          </Panel>

          <Panel>
            <Head title="Adherence" note="Counted from tests and check-ins on record." />
            <div className="px-6 pb-5 pt-2">
              <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-3">
                <span className="text-[13.5px] leading-5 text-ink-soft">Consecutive missed tests</span>
                <span className={cx('serif nums text-[26px] leading-8', adherence.consecutiveMissed >= state.triageConfig.missedTests.consecutiveDays ? 'text-amber-700' : 'text-ink')}>
                  {adherence.consecutiveMissed}
                </span>
              </div>
              <div className="divide-y divide-rule/70">
                <Ratio label="Tests, last 7 days" done={adherence.tests7.done} total={adherence.tests7.total} />
                <Ratio label="Tests, last 28 days" done={adherence.tests28.done} total={adherence.tests28.total} />
                <Ratio label="Check-ins, last 7 days" done={adherence.checkIns7.done} total={adherence.checkIns7.total} />
                <Ratio label="Check-ins, last 28 days" done={adherence.checkIns28.done} total={adherence.checkIns28.total} />
              </div>
              <p className="mt-4 text-[13px] font-semibold leading-5 text-ink">Last 28 days</p>
              <p className="text-[12.5px] leading-5 text-ink-soft">Square: test outcome. Dot beneath: check-in done.</p>
              <div className="mt-2">
                <CompletionStrip days={strip} today={today} />
              </div>
              <p className="mt-4 text-[13px] font-semibold leading-5 text-ink">Completed-test days per week</p>
              <WeeklyBars weeks={adherence.weekly} className="mt-2" />
            </div>
          </Panel>
            </>
          ) : null}

          {tab === 'movement' ? (
            <>
          <ProtocolPanel patient={patient} state={state} />

          <MovementPanel patient={patient} state={state} today={today} />

          <WeeklyPanel patient={patient} state={state} today={today} />
            </>
          ) : null}

          {tab === 'results' ? (
            <>
          <Panel>
            <Head title="Wear time" action={<SimulatedBadge>Simulated placeholder</SimulatedBadge>} />
            <div className="px-6 pb-5 pt-2">
              <p className="text-[13px] leading-5 text-ink-soft">
                The V3 device cannot report wear time, battery or continuous activity. These bars are invented to show where a
                future device revision could report it. They are not readings.
              </p>
              <div className="hatch mt-3 flex h-[72px] items-end gap-2 rounded-[8px] px-3 pb-2 pt-3" aria-hidden="true">
                {wear.map((day) => (
                  <div key={day.date} className="flex-1 border border-dashed border-ink/40 bg-paper/70" style={{ height: `${(day.hours / 14) * 100}%` }} />
                ))}
              </div>
            </div>
          </Panel>
            </>
          ) : null}

          {tab === 'overview' ? (
            <>
          <Panel>
            <Head
              title="Clinician notes"
              action={
                <button type="button" onClick={() => setModal('note')} className="text-[13.5px] font-semibold text-ink underline decoration-mint decoration-2 underline-offset-4">
                  Add note
                </button>
              }
            />
            <div className="px-6 pb-5 pt-2">
              {notes.length === 0 ? <p className="text-[14px] leading-6 text-ink-soft">No notes yet.</p> : null}
              <ul className="divide-y divide-rule/70">
                {notes.map((note) => (
                  <li key={note.id} className="py-3">
                    <p className="nums text-[12.5px] leading-5 text-ink-soft">
                      {formatDay(dateKeyOf(note.createdAt))}, {formatTime(note.createdAt)}
                    </p>
                    <p className="text-[14px] leading-[22px] text-ink">{note.text}</p>
                  </li>
                ))}
              </ul>
              {reviewedLog.length > 0 ? (
                <>
                  <p className="mt-3 text-[13px] font-semibold leading-5 text-ink">Review history</p>
                  <ul className="mt-1 space-y-2 text-[13px] leading-5 text-ink-soft">
                    {reviewedLog.map((flag) => (
                      <li key={flag.id}>
                        <span className="font-semibold text-ink">{RULE_LABEL[flag.ruleId]}</span>, reviewed{' '}
                        {flag.reviewedAt ? formatDay(dateKeyOf(flag.reviewedAt)) : ''}.{flag.note ? ` ${flag.note}` : ''}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className="mt-3 text-[12.5px] leading-5 text-ink-soft">{LOCAL_ONLY}</p>
            </div>
          </Panel>

          <Panel>
            <Head title="Clinical setup" />
            <dl className="nums grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 px-6 pb-5 pt-3 text-[13.5px] leading-5">
              <dt className="text-ink-soft">Affected finger</dt>
              <dd className="text-right font-semibold text-ink">{injurySite(patient)}</dd>
              <dt className="text-ink-soft">Repair date</dt>
              <dd className="text-right font-semibold text-ink">{formatDateFull(patient.repairDate)}</dd>
              <dt className="text-ink-soft">Enrolled</dt>
              <dd className="text-right font-semibold text-ink">{formatDateFull(patient.enrolledDate)}</dd>
              <dt className="text-ink-soft">Injury location</dt>
              <dd className="text-right font-semibold text-ink">
                {patient.clinical.repairToTipMm !== null
                  ? `${patient.clinical.repairToTipMm} mm from fingertip`
                  : patient.clinical.segment
                    ? SEGMENT_LABEL[patient.clinical.segment]
                    : 'Not set'}
              </dd>
            </dl>
          </Panel>
            </>
          ) : null}
        </div>
      </div>

      <RecordReviewModal open={modal === 'review'} onClose={() => setModal(null)} patient={patient} flags={pending} />
      <FlagModal open={modal === 'flag'} onClose={() => setModal(null)} patient={patient} />
      <NoteModal open={modal === 'note'} onClose={() => setModal(null)} patient={patient} />
      <ClinicalSetupModal open={modal === 'setup'} onClose={() => setModal(null)} patient={patient} />
    </div>
  );
}
