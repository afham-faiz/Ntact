import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDemoState, useToday } from '../../app/hooks';
import { cx } from '../../components/ui';
import { dateKeyOf, daysBetween, formatDayLong, lastDays, relativeDay, type DateKey } from '../../domain/dates';
import {
  buildDaySeries,
  checkInCompletion,
  checkInsForPatient,
  latestTest,
  testCompletion,
  testsForPatient,
  type Completion,
} from '../../domain/selectors';
import { LEVEL_LABEL, ROUTE_LABEL, RULE_LABEL, RULE_ROUTE, compareLevels, triageSummaries, type TriageSummary } from '../../domain/triage';
import type { DemoState, Patient, SensationTest, TriageLevel } from '../../domain/types';
import { injurySite, outcomeText } from './parts';

interface Row {
  patient: Patient;
  triage: TriageSummary;
  lastTest: SensationTest | null;
  lastTestAge: number | null;
  tests14: Completion;
  checkIns14: Completion;
  daysSinceRepair: number;
}

type Filter = 'all' | TriageLevel | 'missed';
type Sort = 'status' | 'name' | 'last-test' | 'adherence' | 'repair';

function buildRows(state: DemoState, today: DateKey): Row[] {
  const summaries = triageSummaries(state, today);
  return state.patients.map((patient) => {
    const tests = testsForPatient(state.tests, patient.id);
    const checkIns = checkInsForPatient(state.checkIns, patient.id);
    const last = latestTest(tests);
    return {
      patient,
      triage: summaries.get(patient.id) ?? { patientId: patient.id, level: 'GREEN', pending: [], reviewedStillActive: [] },
      lastTest: last,
      lastTestAge: last ? daysBetween(dateKeyOf(last.timestamp), today) : null,
      tests14: testCompletion(tests, today, 14, patient.enrolledDate),
      checkIns14: checkInCompletion(checkIns, today, 14, patient.enrolledDate),
      daysSinceRepair: daysBetween(patient.repairDate, today),
    };
  });
}

const byName = (a: Row, b: Row) => a.patient.name.localeCompare(b.patient.name);

const SORTERS: Record<Sort, (a: Row, b: Row) => number> = {
  status: (a, b) => compareLevels(a.triage.level, b.triage.level) || b.triage.pending.length - a.triage.pending.length || byName(a, b),
  name: byName,
  'last-test': (a, b) => (b.lastTestAge ?? 999) - (a.lastTestAge ?? 999) || byName(a, b),
  adherence: (a, b) => a.tests14.done / Math.max(1, a.tests14.total) - b.tests14.done / Math.max(1, b.tests14.total) || byName(a, b),
  repair: (a, b) => b.daysSinceRepair - a.daysSinceRepair || byName(a, b),
};

/** Completed tests across everyone, over the seven days ending today. */
function weekActivity(state: DemoState, today: DateKey): { logged: number; possible: number } {
  let logged = 0;
  let possible = 0;
  for (const date of lastDays(today, 7)) {
    for (const patient of state.patients) {
      if (patient.enrolledDate > date) continue;
      possible += 1;
      const kind = buildDaySeries(testsForPatient(state.tests, patient.id), date, 1)[0].kind;
      if (kind === 'FELT' || kind === 'NO_FELT') logged += 1;
    }
  }
  return { logged, possible };
}

/** Triage marker: a small square. Colour is backed by the wording beside it. */
const MARK: Record<TriageLevel, string> = {
  RED: 'bg-wine-600',
  AMBER: 'bg-amber-500',
  GREEN: 'border border-ink/45 bg-transparent',
};

const LEVEL_TEXT: Record<TriageLevel, string> = {
  RED: 'text-wine-600',
  AMBER: 'text-amber-700',
  GREEN: 'text-ink-soft',
};

function Stat({
  mark,
  value,
  label,
  note,
  selected,
  onSelect,
}: {
  mark?: string;
  value: React.ReactNode;
  label: string;
  note: string;
  selected?: boolean;
  onSelect?(): void;
}) {
  const body = (
    <>
      <span className="flex min-h-10 items-start gap-2 text-[13.5px] font-semibold leading-5 text-ink-soft [&>span:first-child]:mt-[5px]">
        {mark ? <span className={cx('size-2.5 shrink-0 rounded-[2px]', mark)} aria-hidden="true" /> : null}
        {label}
      </span>
      <span className="serif nums block pt-2 text-[44px] leading-[44px] text-ink">{value}</span>
      <span className="mt-2 block text-[13px] leading-5 text-ink-soft">{note}</span>
    </>
  );
  const shell = cx('flex h-full w-full flex-col items-start justify-start px-6 py-5 text-left', selected && 'bg-floor shadow-[inset_0_-3px_0_0_#992335]');
  return onSelect ? (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={cx(shell, !selected && 'hover:bg-floor/60')}>
      {body}
    </button>
  ) : (
    <div className={shell}>{body}</div>
  );
}

export function WorklistPage() {
  const state = useDemoState();
  const today = useToday();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('status');

  const rows = useMemo(() => buildRows(state, today), [state, today]);
  const activity = useMemo(() => weekActivity(state, today), [state, today]);

  const counts = {
    all: rows.length,
    RED: rows.filter((row) => row.triage.level === 'RED').length,
    AMBER: rows.filter((row) => row.triage.level === 'AMBER').length,
    GREEN: rows.filter((row) => row.triage.level === 'GREEN').length,
    missed: rows.filter((row) => row.triage.pending.some((flag) => flag.ruleId === 'MISSED_TESTS')).length,
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if ((filter === 'RED' || filter === 'AMBER' || filter === 'GREEN') && row.triage.level !== filter) return false;
        if (filter === 'missed' && !row.triage.pending.some((flag) => flag.ruleId === 'MISSED_TESTS')) return false;
        if (!needle) return true;
        return `${row.patient.name} ${row.patient.demoId} ${injurySite(row.patient)}`.toLowerCase().includes(needle);
      })
      .sort(SORTERS[sort]);
  }, [rows, query, filter, sort]);

  const toggle = (value: Filter) => setFilter(filter === value ? 'all' : value);
  const filterLabel: Record<Filter, string> = {
    all: 'All patients',
    RED: LEVEL_LABEL.RED,
    AMBER: LEVEL_LABEL.AMBER,
    GREEN: LEVEL_LABEL.GREEN,
    missed: 'Missed-test follow-up',
  };

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-7 pt-9">
        <div>
          <h1 className="serif text-[34px] leading-10 text-ink">Worklist</h1>
          <p className="mt-1 text-[14.5px] leading-6 text-ink-soft">{formatDayLong(today)}. Everyone listed is fictional.</p>
        </div>
        <label className="block">
          <span className="sr-only-live">Search by name, demo ID or finger</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, ID or finger"
            className="h-11 w-[300px] rounded-[10px] border border-rule bg-paper px-4 text-[14.5px] text-ink placeholder:text-ink-faint hover:border-ink/30"
          />
        </label>
      </div>

      {/* Summary: one panel, four cells. The triage cells filter the list. */}
      <div className="grid overflow-hidden rounded-[14px] border border-rule bg-paper sm:grid-cols-2 xl:grid-cols-5 [&>*]:border-rule sm:[&>*]:border-l sm:[&>*:first-child]:border-l-0">
        <Stat mark={MARK.RED} value={counts.RED} label="Same-day review" note="Wound, skin or pain: look today" selected={filter === 'RED'} onSelect={() => toggle('RED')} />
        <Stat mark={MARK.AMBER} value={counts.AMBER} label="Review soon" note="A rule has been met" selected={filter === 'AMBER'} onSelect={() => toggle('AMBER')} />
        <Stat mark={MARK.GREEN} value={counts.GREEN} label="No current review trigger" note="Can be considered for patient-initiated follow-up" selected={filter === 'GREEN'} onSelect={() => toggle('GREEN')} />
        <Stat
          value={counts.missed}
          label="Missed-test follow-up"
          note={`${state.triageConfig.missedTests.consecutiveDays}+ days without a completed test`}
          selected={filter === 'missed'}
          onSelect={() => toggle('missed')}
        />
        <Stat
          value={
            <>
              {activity.logged}
              <span className="text-[22px] tracking-[-0.02em] text-ink-soft"> / {activity.possible}</span>
            </>
          }
          label="Tests completed, 7 days"
          note="Patient-days with a completed test"
        />
      </div>

      {/* Patient table */}
      <div className="mt-6 overflow-hidden rounded-[14px] border border-rule bg-paper">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-[17px] font-bold leading-6 tracking-[-0.02em] text-ink">{filterLabel[filter]}</h2>
            <span className="nums text-[14px] text-ink-soft">
              {visible.length} of {rows.length}
            </span>
            {filter !== 'all' ? (
              <button type="button" onClick={() => setFilter('all')} className="text-[14px] font-semibold text-ink underline decoration-wine-600 decoration-2 underline-offset-4">
                Show everyone
              </button>
            ) : null}
          </div>
          <label className="flex items-center gap-2.5 text-[13.5px] text-ink-soft">
            Order by
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              className="h-10 rounded-[10px] border border-rule bg-paper px-3 text-[14px] font-semibold text-ink hover:border-ink/30"
            >
              <option value="status">Review status</option>
              <option value="name">Name, A to Z</option>
              <option value="last-test">Longest since last test</option>
              <option value="adherence">Lowest adherence</option>
              <option value="repair">Longest since repair</option>
            </select>
          </label>
        </div>

        <div className="quiet-scroll overflow-x-auto">
          <table className="w-full min-w-[960px] table-fixed border-collapse">
            <caption className="sr-only-live">
              Patients with provisional review status, affected finger, days since repair, last test, monitoring adherence and review reasons
            </caption>
            <thead>
              <tr className="border-y border-rule bg-floor text-left text-[12.5px] font-semibold leading-5 text-ink-soft">
                <th scope="col" className="w-[19%] py-2.5 pl-6 pr-4">Review status</th>
                <th scope="col" className="w-[20%] px-4 py-2.5">Patient</th>
                <th scope="col" className="w-[10%] px-4 py-2.5">Since repair</th>
                <th scope="col" className="w-[13%] px-4 py-2.5">Last test</th>
                <th scope="col" className="w-[15%] px-4 py-2.5">Monitoring, 14 days</th>
                <th scope="col" className="px-4 py-2.5">Review reasons, and who they go to</th>
                <th scope="col" className="w-12">
                  <span className="sr-only-live">Open record</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <p className="text-[17px] font-bold text-ink">No one matches that search or filter.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('');
                        setFilter('all');
                      }}
                      className="mt-2 text-[14.5px] font-semibold text-ink underline decoration-wine-600 decoration-2 underline-offset-4"
                    >
                      Clear search and filters
                    </button>
                  </td>
                </tr>
              ) : null}

              {visible.map((row) => {
                const href = `/clinician/patients/${row.patient.id}`;
                const level = row.triage.level;
                return (
                  <tr key={row.patient.id} onClick={() => navigate(href)} className="group cursor-pointer border-b border-rule/70 align-middle last:border-b-0 hover:bg-floor/70">
                    <td className="py-4 pl-6 pr-4">
                      <span className={cx('flex items-center gap-2.5 text-[14.5px] font-bold leading-5', level === 'GREEN' ? 'font-medium text-ink-soft' : LEVEL_TEXT[level])}>
                        <span className={cx('size-2.5 shrink-0 rounded-[2px]', MARK[level])} aria-hidden="true" />
                        {level === 'GREEN' ? 'No current trigger' : LEVEL_LABEL[level]}
                      </span>
                    </td>

                    <td className="px-4 py-4">
                      <Link to={href} onClick={(event) => event.stopPropagation()} className="block truncate text-[15.5px] font-bold leading-6 tracking-[-0.01em] text-ink underline-offset-4 group-hover:underline">
                        {row.patient.name}
                      </Link>
                      <span className="block truncate text-[13px] leading-5 text-ink-soft">
                        {injurySite(row.patient)}
                        <span className="nums">, {row.patient.demoId}</span>
                      </span>
                    </td>

                    <td className="nums whitespace-nowrap px-4 py-4">
                      <span className="block text-[14.5px] font-semibold leading-6 text-ink">{row.daysSinceRepair} days</span>
                      <span className="block text-[13px] leading-5 text-ink-soft">week {Math.floor(row.daysSinceRepair / 7)}</span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4">
                      {row.lastTest ? (
                        <>
                          <span className={cx('block text-[14.5px] font-semibold leading-6', (row.lastTestAge ?? 0) >= 3 ? 'text-amber-700' : 'text-ink')}>
                            {relativeDay(dateKeyOf(row.lastTest.timestamp), today)}
                          </span>
                          <span className="block text-[13px] leading-5 text-ink-soft">{outcomeText(row.lastTest)}</span>
                        </>
                      ) : (
                        <span className="text-[14.5px] text-ink-soft">No test yet</span>
                      )}
                    </td>

                    <td className="nums whitespace-nowrap px-4 py-4">
                      <span className="block text-[14.5px] font-semibold leading-6 text-ink">
                        {row.tests14.done}/{row.tests14.total} tests
                      </span>
                      <span className="block text-[13px] leading-5 text-ink-soft">
                        {row.checkIns14.done}/{row.checkIns14.total} check-ins
                      </span>
                    </td>

                    <td className="px-4 py-4">
                      {row.triage.pending.length > 0 ? (
                        <ul className="space-y-0.5">
                          {row.triage.pending.map((flag) => (
                            <li key={flag.id} className="text-[14px] leading-[22px] text-ink">
                              {RULE_LABEL[flag.ruleId]}
                              <span className="whitespace-nowrap text-ink-soft"> · {ROUTE_LABEL[RULE_ROUTE[flag.ruleId]]}</span>
                            </li>
                          ))}
                        </ul>
                      ) : row.triage.reviewedStillActive.length > 0 ? (
                        <span className="text-[14px] leading-[22px] text-ink-soft">Reviewed. The condition is still met.</span>
                      ) : state.followUp?.[row.patient.id] ? (
                        <span className="text-[14px] leading-[22px] text-ink-soft">Patient-initiated follow-up. No routine visit.</span>
                      ) : (
                        <span className="text-[14px] text-ink-faint">None</span>
                      )}
                    </td>

                    <td className="pr-5 text-right text-[20px] leading-none text-ink-faint group-hover:text-ink" aria-hidden="true">
                      ›
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-5 max-w-[92ch] text-[13px] leading-5 text-ink-soft">
        Review status comes from provisional rules the team is still discussing; it prompts a look and does not assess
        recovery. Steps are motor command settings from 1 to 10, not calibrated vibration amplitudes.{' '}
        <Link to="/clinician/rules" className="font-semibold text-ink underline decoration-wine-600 decoration-2 underline-offset-4">
          See the provisional rules
        </Link>
      </p>
    </div>
  );
}
