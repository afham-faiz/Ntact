import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/demo/seed';
import {
  adherenceFor,
  consecutiveMissedTests,
  lastCompletedTestDay,
  simulatedWearTime,
  weeklyTestCounts,
} from '../src/domain/adherence';
import { checkInsForPatient, testsForPatient } from '../src/domain/selectors';
import { FIXED_DATE_KEY as TODAY, daysFromToday, historyEnding, testOn } from './helpers';

const YESTERDAY = daysFromToday(-1);
const LONG_AGO = daysFromToday(-60);

describe('consecutiveMissedTests', () => {
  it('counts back from yesterday until the most recent day with a completed test', () => {
    expect(consecutiveMissedTests(historyEnding(YESTERDAY, [6]), LONG_AGO, TODAY)).toBe(0);
    expect(consecutiveMissedTests(historyEnding(YESTERDAY, [6, null]), LONG_AGO, TODAY)).toBe(1);
    expect(consecutiveMissedTests(historyEnding(YESTERDAY, [6, null, null, null]), LONG_AGO, TODAY)).toBe(3);
    // Days missed before the most recent test are not part of the current run.
    expect(consecutiveMissedTests(historyEnding(YESTERDAY, [null, null, 6, null]), LONG_AGO, TODAY)).toBe(1);
  });

  it('ignores today: the day is not over, and a test today does not hide yesterday’s gap', () => {
    const missedYesterday = historyEnding(YESTERDAY, [6, null]);

    expect(consecutiveMissedTests(missedYesterday, LONG_AGO, TODAY)).toBe(1);
    expect(consecutiveMissedTests([...missedYesterday, testOn(TODAY, 5)], LONG_AGO, TODAY)).toBe(1);
  });

  it('stops at the enrolment day', () => {
    expect(consecutiveMissedTests([], daysFromToday(-5), TODAY)).toBe(5);
    expect(consecutiveMissedTests([], YESTERDAY, TODAY)).toBe(1);
    expect(consecutiveMissedTests([], TODAY, TODAY)).toBe(0);
    // A test from before enrolment is never reached.
    expect(consecutiveMissedTests([testOn(daysFromToday(-9), 6)], daysFromToday(-5), TODAY)).toBe(5);
  });

  it('counts a day with only a cancelled attempt as missed, and a not-felt day as completed', () => {
    expect(consecutiveMissedTests(historyEnding(YESTERDAY, [6, 'S', null]), LONG_AGO, TODAY)).toBe(2);
    expect(consecutiveMissedTests(historyEnding(YESTERDAY, [6, 'N', null]), LONG_AGO, TODAY)).toBe(1);
    expect(consecutiveMissedTests(historyEnding(YESTERDAY, [6, ['S', 5]]), LONG_AGO, TODAY)).toBe(0);
  });
});

describe('lastCompletedTestDay', () => {
  it('is the day of the latest felt or not-felt test, skipping cancelled ones', () => {
    expect(lastCompletedTestDay(historyEnding(YESTERDAY, [6, 'N', 'S']))).toBe(daysFromToday(-2));
    expect(lastCompletedTestDay(historyEnding(YESTERDAY, ['S', 'S']))).toBeNull();
    expect(lastCompletedTestDay([])).toBeNull();
  });
});

describe('weeklyTestCounts', () => {
  it('returns seven-day blocks ending today, oldest first, cut off at enrolment', () => {
    const everyDay = historyEnding(TODAY, Array.from({ length: 30 }, () => 6));

    const weeks = weeklyTestCounts(everyDay, daysFromToday(-16), TODAY);

    expect(weeks).toEqual([
      { start: daysFromToday(-20), testDays: 3, days: 3 },
      { start: daysFromToday(-13), testDays: 7, days: 7 },
      { start: daysFromToday(-6), testDays: 7, days: 7 },
    ]);
  });

  it('never counts a day before enrolment, even when a test is on record for it', () => {
    const everyDay = historyEnding(TODAY, Array.from({ length: 30 }, () => 6));

    const weeks = weeklyTestCounts(everyDay, daysFromToday(-16), TODAY);

    // Seventeen days from enrolment to today, inclusive; the thirteen earlier tests are left out.
    expect(weeks.reduce((total, week) => total + week.days, 0)).toBe(17);
    expect(weeks.reduce((total, week) => total + week.testDays, 0)).toBe(17);
    for (const week of weeks) expect(week.testDays).toBeLessThanOrEqual(week.days);
  });

  it('counts completed-test days, not attempts: cancelled-only days and empty days are left out', () => {
    const tests = historyEnding(TODAY, [6, 'N', 'S', null, [6, 5], ['S', 6], null]);

    expect(weeklyTestCounts(tests, LONG_AGO, TODAY, 1)).toEqual([{ start: daysFromToday(-6), testDays: 4, days: 7 }]);
  });

  it('goes back at most twelve weeks by default', () => {
    const weeks = weeklyTestCounts([], daysFromToday(-200), TODAY);

    expect(weeks).toHaveLength(12);
    expect(weeks[0].start).toBe(daysFromToday(-83));
    expect(weeks[11].start).toBe(daysFromToday(-6));
  });
});

describe('adherenceFor', () => {
  it('summarises Priya’s seeded record: four missed days in a row and one test in the last week', () => {
    const state = createSeedState(TODAY);
    const priya = state.patients.find((patient) => patient.id === 'p-priya');
    if (!priya) throw new Error('p-priya is missing from the seed');

    const adherence = adherenceFor(
      priya,
      testsForPatient(state.tests, priya.id),
      checkInsForPatient(state.checkIns, priya.id),
      TODAY,
    );

    expect(adherence.consecutiveMissed).toBe(4);
    expect(adherence.lastCompletedDay).toBe(daysFromToday(-5));
    expect(adherence.tests7).toMatchObject({ done: 1, total: 7 });
    expect(adherence.checkIns7.total).toBe(7);
    expect(adherence.weekly[adherence.weekly.length - 1]).toEqual({
      start: daysFromToday(-6),
      testDays: 1,
      days: 7,
    });
  });

  it('never divides by days before enrolment: a person enrolled three days ago is measured over four days', () => {
    const state = createSeedState(TODAY);
    const elin = state.patients.find((patient) => patient.id === 'p-elin');
    if (!elin) throw new Error('p-elin is missing from the seed');

    const adherence = adherenceFor(
      elin,
      testsForPatient(state.tests, elin.id),
      checkInsForPatient(state.checkIns, elin.id),
      TODAY,
    );

    expect(adherence.tests28).toEqual({ done: 3, total: 4, days: [true, true, true, false] });
    expect(adherence.checkIns28).toEqual({ done: 3, total: 4, days: [true, true, true, false] });
    expect(adherence.consecutiveMissed).toBe(0);
  });
});

describe('simulatedWearTime', () => {
  it('flags every entry as simulated: V3 reports no wear time', () => {
    const week = simulatedWearTime('p-maya', TODAY);

    expect(week).toHaveLength(7);
    expect(week.map((entry) => entry.date)).toEqual([-6, -5, -4, -3, -2, -1, 0].map(daysFromToday));
    for (const entry of week) {
      expect(entry.simulated).toBe(true);
      expect(entry.hours).toBeGreaterThanOrEqual(4.5);
      expect(entry.hours).toBeLessThanOrEqual(14);
      expect(Number.isInteger(entry.hours * 2)).toBe(true);
    }
  });

  it('is deterministic: a fixed function of the person and the date, whatever window is asked for', () => {
    expect(simulatedWearTime('p-maya', TODAY)).toEqual(simulatedWearTime('p-maya', TODAY));

    const longer = simulatedWearTime('p-maya', daysFromToday(3), 14);
    const overlap = simulatedWearTime('p-maya', TODAY, 7);
    expect(longer.filter((entry) => overlap.some((other) => other.date === entry.date))).toEqual(overlap);
  });
});
