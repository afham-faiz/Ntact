/**
 * Monitoring adherence for the clinician record.
 *
 * Everything except wear time is counted from records the prototype really
 * holds (tests and check-ins). Wear time is NOT available from V3 firmware; the
 * function at the bottom produces clearly labelled placeholder values so the
 * layout can be designed for a future device revision.
 */
import { addDays, dateKeyOf, daysBetween, lastDays, type DateKey } from './dates';
import { checkInCompletion, testCompletion, testsOnDay, type Completion } from './selectors';
import type { CheckIn, Patient, SensationTest } from './types';

export interface WeekCount {
  /** First day of the seven-day block. */
  start: DateKey;
  /** Days in the block with a completed test. */
  testDays: number;
  /** Days in the block that fall on or after enrolment and on or before today. */
  days: number;
}

export interface Adherence {
  tests7: Completion;
  tests14: Completion;
  tests28: Completion;
  checkIns7: Completion;
  checkIns14: Completion;
  checkIns28: Completion;
  /** Full days in a row, counting back from yesterday, with no completed test. */
  consecutiveMissed: number;
  /** Day of the most recent completed test, if any. */
  lastCompletedDay: DateKey | null;
  /** Completed-test days per week, oldest first, at most twelve weeks. */
  weekly: WeekCount[];
}

function dayHasCompletedTest(tests: SensationTest[], day: DateKey): boolean {
  return testsOnDay(tests, day).some((test) => test.outcome !== 'STOPPED');
}

/**
 * Consecutive missed daily tests: whole calendar days before today with no
 * completed test, counted back from yesterday and never past the enrolment day.
 * Today is not counted, because the day is not over.
 */
export function consecutiveMissedTests(tests: SensationTest[], enrolledDate: DateKey, today: DateKey): number {
  let missed = 0;
  let cursor = addDays(today, -1);
  while (cursor >= enrolledDate && missed < 366) {
    if (dayHasCompletedTest(tests, cursor)) break;
    missed += 1;
    cursor = addDays(cursor, -1);
  }
  return missed;
}

export function lastCompletedTestDay(tests: SensationTest[]): DateKey | null {
  for (let index = tests.length - 1; index >= 0; index -= 1) {
    if (tests[index].outcome !== 'STOPPED') return dateKeyOf(tests[index].timestamp);
  }
  return null;
}

export function weeklyTestCounts(tests: SensationTest[], enrolledDate: DateKey, today: DateKey, maxWeeks = 12): WeekCount[] {
  const weeks: WeekCount[] = [];
  for (let back = 0; back < maxWeeks; back += 1) {
    const end = addDays(today, -7 * back);
    const start = addDays(end, -6);
    if (end < enrolledDate) break;
    const days = lastDays(end, 7).filter((day) => day >= enrolledDate && day <= today);
    weeks.unshift({
      start,
      testDays: days.filter((day) => dayHasCompletedTest(tests, day)).length,
      days: days.length,
    });
  }
  return weeks;
}

export function adherenceFor(
  patient: Pick<Patient, 'enrolledDate'>,
  tests: SensationTest[],
  checkIns: CheckIn[],
  today: DateKey,
): Adherence {
  return {
    tests7: testCompletion(tests, today, 7, patient.enrolledDate),
    tests14: testCompletion(tests, today, 14, patient.enrolledDate),
    tests28: testCompletion(tests, today, 28, patient.enrolledDate),
    checkIns7: checkInCompletion(checkIns, today, 7, patient.enrolledDate),
    checkIns14: checkInCompletion(checkIns, today, 14, patient.enrolledDate),
    checkIns28: checkInCompletion(checkIns, today, 28, patient.enrolledDate),
    consecutiveMissed: consecutiveMissedTests(tests, patient.enrolledDate, today),
    lastCompletedDay: lastCompletedTestDay(tests),
    weekly: weeklyTestCounts(tests, patient.enrolledDate, today),
  };
}

// ---------- Wear time: placeholder only ----------

export interface SimulatedWearDay {
  date: DateKey;
  hours: number;
  /** Always true. These numbers are invented to show a future layout. */
  simulated: true;
}

/**
 * Invented wear-time values for layout purposes only.
 *
 * The V3 protocol has no wear-time, battery or continuous-activity message, so
 * nothing here comes from a device, simulated or otherwise. The values are a
 * fixed function of the patient id and the date, so the mock-up is stable.
 */
export function simulatedWearTime(patientId: string, today: DateKey, count = 7): SimulatedWearDay[] {
  let seed = 0;
  for (let index = 0; index < patientId.length; index += 1) seed = (seed * 31 + patientId.charCodeAt(index)) >>> 0;
  return lastDays(today, count).map((date) => {
    const dayNumber = daysBetween('2026-01-01', date);
    const wave = Math.sin((dayNumber + (seed % 11)) * 1.3) * 1.6 + Math.cos((dayNumber + (seed % 7)) * 0.6) * 1.1;
    const hours = Math.round(Math.min(14, Math.max(4.5, 9.5 + wave + ((seed % 5) - 2) * 0.4)) * 2) / 2;
    return { date, hours, simulated: true };
  });
}
