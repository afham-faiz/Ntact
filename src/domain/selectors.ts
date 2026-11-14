/**
 * Read-only views over the demo records. Pure functions, shared by the patient
 * app, the clinician portal and the tests.
 */
import { addDays, dateKeyOf, daysBetween, lastDays, type DateKey } from './dates';
import type { CheckIn, FeltTest, RehabLevel, SensationTest } from './types';

export function testsForPatient(tests: SensationTest[], patientId: string): SensationTest[] {
  return tests
    .filter((test) => test.patientId === patientId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function checkInsForPatient(checkIns: CheckIn[], patientId: string): CheckIn[] {
  return checkIns
    .filter((entry) => entry.patientId === patientId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function latestTest(tests: SensationTest[]): SensationTest | null {
  return tests.length > 0 ? tests[tests.length - 1] : null;
}

/** Most recent valid detection strictly before `beforeTimestamp`. Used for the post-test comparison. */
export function previousFelt(tests: SensationTest[], beforeTimestamp: string): FeltTest | null {
  for (let index = tests.length - 1; index >= 0; index -= 1) {
    const test = tests[index];
    if (test.timestamp < beforeTimestamp && test.outcome === 'FELT') return test;
  }
  return null;
}

export function testsOnDay(tests: SensationTest[], day: DateKey): SensationTest[] {
  return tests.filter((test) => dateKeyOf(test.timestamp) === day);
}

export type DayKind = 'FELT' | 'NO_FELT' | 'STOPPED' | 'NONE';

export interface DayPoint {
  date: DateKey;
  /** Every test logged that day, oldest first. */
  tests: SensationTest[];
  /** The test that represents the day on a chart. */
  primary: SensationTest | null;
  kind: DayKind;
  /** Present only when kind is FELT. Never 0, never 11. */
  step: RehabLevel | null;
}

/**
 * Which test stands for a day when there are several.
 *
 * Assumption (the protocol is still an open team question): the most recent
 * *completed* test of the day, whether felt or not felt. A stopped test only
 * represents the day when nothing was completed.
 */
export function primaryTestOfDay(tests: SensationTest[]): SensationTest | null {
  if (tests.length === 0) return null;
  for (let index = tests.length - 1; index >= 0; index -= 1) {
    if (tests[index].outcome !== 'STOPPED') return tests[index];
  }
  return tests[tests.length - 1];
}

/**
 * One point per calendar day, oldest first. Days without a test stay in the
 * series as NONE so that gaps remain visible instead of being interpolated away.
 */
export function buildDaySeries(tests: SensationTest[], end: DateKey, count: number): DayPoint[] {
  const byDay = new Map<DateKey, SensationTest[]>();
  for (const test of tests) {
    const day = dateKeyOf(test.timestamp);
    const list = byDay.get(day);
    if (list) list.push(test);
    else byDay.set(day, [test]);
  }

  return lastDays(end, count).map((date) => {
    const dayTests = (byDay.get(date) ?? []).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const primary = primaryTestOfDay(dayTests);
    if (!primary) return { date, tests: dayTests, primary: null, kind: 'NONE', step: null };
    if (primary.outcome === 'FELT') {
      return { date, tests: dayTests, primary, kind: 'FELT', step: primary.detectedLevel };
    }
    return { date, tests: dayTests, primary, kind: primary.outcome, step: null };
  });
}

/** A run of felt results on consecutive calendar days, as indexes into the series. */
export interface FeltRun {
  indexes: number[];
}

/**
 * Felt results grouped into runs of consecutive days. A line (and the fill under
 * it) is only ever drawn within a run. A missed day, a not-felt day or a stopped
 * test ends the run, so the chart never implies a measurement that was not taken.
 */
export function feltRuns(series: DayPoint[]): FeltRun[] {
  const runs: FeltRun[] = [];
  let current: number[] = [];
  series.forEach((point, index) => {
    if (point.kind === 'FELT') {
      current.push(index);
    } else if (current.length > 0) {
      runs.push({ indexes: current });
      current = [];
    }
  });
  if (current.length > 0) runs.push({ indexes: current });
  return runs;
}

export interface StepSegment {
  from: number;
  to: number;
}

/** Index pairs that may be joined with a line: two felt results on consecutive calendar days. */
export function connectableSegments(series: DayPoint[]): StepSegment[] {
  const segments: StepSegment[] = [];
  for (let index = 1; index < series.length; index += 1) {
    if (series[index - 1].kind === 'FELT' && series[index].kind === 'FELT') {
      segments.push({ from: index - 1, to: index });
    }
  }
  return segments;
}

export interface Completion {
  /** Days in the window with at least one completed test (felt or not felt). */
  done: number;
  total: number;
  days: boolean[];
}

/**
 * Test completion over the `count` days ending today, not counting days before
 * enrolment. This is an engagement figure. It says nothing about sensation.
 */
export function testCompletion(
  tests: SensationTest[],
  today: DateKey,
  count: number,
  enrolledDate?: DateKey,
): Completion {
  const days = lastDays(today, count)
    .filter((day) => !enrolledDate || day >= enrolledDate)
    .map((day) => testsOnDay(tests, day).some((test) => test.outcome !== 'STOPPED'));
  return { done: days.filter(Boolean).length, total: days.length, days };
}

export function checkInCompletion(
  checkIns: CheckIn[],
  today: DateKey,
  count: number,
  enrolledDate?: DateKey,
): Completion {
  const dates = new Set(checkIns.map((entry) => entry.date));
  const days = lastDays(today, count)
    .filter((day) => !enrolledDate || day >= enrolledDate)
    .map((day) => dates.has(day));
  return { done: days.filter(Boolean).length, total: days.length, days };
}

export function checkInOn(checkIns: CheckIn[], day: DateKey): CheckIn | null {
  return checkIns.find((entry) => entry.date === day) ?? null;
}

export function latestCheckIn(checkIns: CheckIn[]): CheckIn | null {
  return checkIns.length > 0 ? checkIns[checkIns.length - 1] : null;
}

/** No check-in for two or more days. */
export function isCheckInOverdue(checkIns: CheckIn[], enrolledDate: DateKey, today: DateKey): boolean {
  const last = latestCheckIn(checkIns);
  const reference = last ? last.date : enrolledDate;
  return daysBetween(reference, today) >= 2;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Check-ins on the `count` days before `day` (not including it). */
export function checkInsBefore(checkIns: CheckIn[], day: DateKey, count: number): CheckIn[] {
  const from = addDays(day, -count);
  return checkIns.filter((entry) => entry.date >= from && entry.date < day);
}

export const OUTCOME_LABEL: Record<SensationTest['outcome'], string> = {
  FELT: 'Felt',
  NO_FELT: 'Not felt',
  STOPPED: 'Cancelled',
};

/** Short, neutral description of a test record. */
export function describeTest(test: SensationTest): string {
  if (test.outcome === 'FELT') return `Felt at level ${test.detectedLevel} of 10`;
  if (test.outcome === 'NO_FELT') return 'Completed, no vibration reported';
  return test.stopReason === 'EARLY_RESPONSE' ? 'Cancelled: tapped before the test began' : 'Cancelled before a result';
}

export interface LinearFit {
  slope: number;
  intercept: number;
  /** Number of points the line was fitted through. */
  n: number;
}

/**
 * Ordinary least-squares line through (x, y) points. Used only for the
 * clinician's optional trend overlay, which is labelled as a statistical
 * illustration and is never used to predict or to trigger anything.
 */
export function linearFit(points: { x: number; y: number }[]): LinearFit | null {
  const n = points.length;
  if (n < 5) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }
  if (denominator === 0) return null;
  const slope = numerator / denominator;
  return { slope, intercept: meanY - slope * meanX, n };
}
