import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/demo/seed';
import { daysBetween } from '../src/domain/dates';
import {
  buildDaySeries,
  connectableSegments,
  describeTest,
  feltRuns,
  linearFit,
  median,
  previousFelt,
  primaryTestOfDay,
  testCompletion,
  testsForPatient,
  type DayPoint,
} from '../src/domain/selectors';
import { FIXED_DATE_KEY as TODAY, daysFromToday, historyEnding, testOn } from './helpers';

const YESTERDAY = daysFromToday(-1);

/** Every seeded person's last ninety days, as the charts would see them. */
function seededSeries(): { patientId: string; series: DayPoint[] }[] {
  const state = createSeedState(TODAY);
  return state.patients.map((patient) => ({
    patientId: patient.id,
    series: buildDaySeries(testsForPatient(state.tests, patient.id), TODAY, 90),
  }));
}

describe('buildDaySeries', () => {
  it('returns exactly `count` consecutive days ending on `end`, oldest first', () => {
    const series = buildDaySeries([], TODAY, 14);

    expect(series).toHaveLength(14);
    expect(series[0].date).toBe('2026-10-30');
    expect(series[13].date).toBe(TODAY);
    for (let index = 1; index < series.length; index += 1) {
      expect(daysBetween(series[index - 1].date, series[index].date)).toBe(1);
    }
  });

  it('keeps days without a test in the series as NONE, so gaps stay where they happened', () => {
    const tests = historyEnding(YESTERDAY, [5, null, 6, null, null, 4]);

    const series = buildDaySeries(tests, TODAY, 7);

    expect(series.map((point) => point.kind)).toEqual(['FELT', 'NONE', 'FELT', 'NONE', 'NONE', 'FELT', 'NONE']);
    expect(series.map((point) => point.step)).toEqual([5, null, 6, null, null, 4, null]);
    expect(series[1]).toEqual({ date: daysFromToday(-5), tests: [], primary: null, kind: 'NONE', step: null });
  });

  it('gives a step only to FELT days: NO_FELT and STOPPED days have step null', () => {
    const tests = historyEnding(TODAY, [5, 'N', 'S']);

    const series = buildDaySeries(tests, TODAY, 3);

    expect(series.map((point) => [point.kind, point.step])).toEqual([
      ['FELT', 5],
      ['NO_FELT', null],
      ['STOPPED', null],
    ]);
  });

  it('ignores tests outside the window and sorts a day’s attempts by time before choosing its primary', () => {
    const early = testOn(TODAY, 7, { hour: 8 });
    const late = testOn(TODAY, 4, { hour: 21 });
    const tooOld = testOn(daysFromToday(-3), 9);

    const [point] = buildDaySeries([late, tooOld, early], TODAY, 1);

    expect(point.tests).toEqual([early, late]);
    expect(point.primary).toBe(late);
    expect(point.step).toBe(4);
  });

  it('never yields step 0 or step 11 anywhere in ninety days of the seeded cohort', () => {
    const kindsSeen = new Set<string>();

    for (const { series } of seededSeries()) {
      expect(series).toHaveLength(90);
      for (const point of series) {
        kindsSeen.add(point.kind);
        if (point.kind === 'FELT') {
          expect(point.step).toBeGreaterThanOrEqual(1);
          expect(point.step).toBeLessThanOrEqual(10);
          expect(point.primary?.outcome).toBe('FELT');
        } else {
          expect(point.step).toBeNull();
        }
        expect(point.step).not.toBe(0);
        expect(point.step).not.toBe(11);
      }
    }

    // The cohort holds every kind of day, so the non-felt branch above really ran.
    expect(kindsSeen).toEqual(new Set(['FELT', 'NO_FELT', 'STOPPED', 'NONE']));
  });
});

describe('primaryTestOfDay', () => {
  it('is null for a day with no tests', () => {
    expect(primaryTestOfDay([])).toBeNull();
  });

  it('prefers the latest completed test over a later STOPPED one', () => {
    const felt = testOn(TODAY, 6, { hour: 9 });
    const stoppedLater = testOn(TODAY, 'S', { hour: 18 });

    expect(primaryTestOfDay([felt, stoppedLater])).toBe(felt);
  });

  it('lets a lone STOPPED test represent the day', () => {
    const stopped = testOn(TODAY, 'S');

    expect(primaryTestOfDay([stopped])).toBe(stopped);
  });

  it('takes the most recent completed test, whether it was felt or not', () => {
    const feltFirst = testOn(TODAY, 6, { hour: 9 });
    const notFeltLater = testOn(TODAY, 'N', { hour: 18 });
    const feltLast = testOn(TODAY, 5, { hour: 21 });

    expect(primaryTestOfDay([feltFirst, notFeltLater])).toBe(notFeltLater);
    expect(primaryTestOfDay([feltFirst, notFeltLater, feltLast])).toBe(feltLast);
  });
});

describe('feltRuns and connectableSegments', () => {
  it('breaks the line at every missed, not-felt or cancelled day', () => {
    //                                   0  1  2     3  4    5  6  7    8  9  10
    const tests = historyEnding(TODAY, [5, 6, null, 6, 'N', 5, 5, 'S', 4, 4, 4]);
    const series = buildDaySeries(tests, TODAY, 11);

    expect(feltRuns(series).map((run) => run.indexes)).toEqual([[0, 1], [3], [5, 6], [8, 9, 10]]);
    expect(connectableSegments(series)).toEqual([
      { from: 0, to: 1 },
      { from: 5, to: 6 },
      { from: 8, to: 9 },
      { from: 9, to: 10 },
    ]);
  });

  it('never spans a NONE, NO_FELT or STOPPED day anywhere in the seeded cohort', () => {
    for (const { series } of seededSeries()) {
      const runs = feltRuns(series);
      const segments = connectableSegments(series);

      for (const { indexes } of runs) {
        indexes.forEach((seriesIndex, position) => {
          expect(series[seriesIndex].kind).toBe('FELT');
          if (position > 0) expect(seriesIndex).toBe(indexes[position - 1] + 1);
        });
      }
      // Runs are maximal and cover every felt day exactly once.
      const feltIndexes = series.flatMap((point, index) => (point.kind === 'FELT' ? [index] : []));
      expect(runs.flatMap((run) => run.indexes)).toEqual(feltIndexes);
      runs.slice(1).forEach((run, position) => {
        const previous = runs[position].indexes;
        expect(run.indexes[0]).toBeGreaterThan(previous[previous.length - 1] + 1);
      });

      for (const { from, to } of segments) {
        expect(to).toBe(from + 1);
        expect(series[from].kind).toBe('FELT');
        expect(series[to].kind).toBe('FELT');
      }
      // A line is drawn between neighbours inside a run and nowhere else.
      expect(segments).toHaveLength(runs.reduce((total, run) => total + run.indexes.length - 1, 0));
    }
  });
});

describe('testCompletion', () => {
  it('counts days with a completed test, felt or not; a cancelled attempt alone does not count', () => {
    const tests = historyEnding(TODAY, [5, 'N', 'S', null, 6, ['S', 5], null]);

    expect(testCompletion(tests, TODAY, 7)).toEqual({
      done: 4,
      total: 7,
      days: [true, true, false, false, true, true, false],
    });
  });

  it('ignores days before enrolment', () => {
    const tests = historyEnding(TODAY, [5, 5, 5, 5, 5, 5, null]);

    const completion = testCompletion(tests, TODAY, 7, daysFromToday(-2));

    // Only the day before yesterday, yesterday and today are in scope.
    expect(completion).toEqual({ done: 2, total: 3, days: [true, true, false] });
  });
});

describe('previousFelt and describeTest', () => {
  it('finds the most recent detection strictly before a moment, skipping not-felt and cancelled tests', () => {
    const tests = historyEnding(TODAY, [7, 6, 'N', 'S', 5]);
    const todays = tests[tests.length - 1];

    expect(previousFelt(tests, todays.timestamp)).toBe(tests[1]);
    expect(previousFelt(tests, tests[0].timestamp)).toBeNull();
  });

  it('puts a number into the description of a felt test only', () => {
    expect(describeTest(testOn(TODAY, 4))).toBe('Felt at level 4 of 10');
    expect(describeTest(testOn(TODAY, 'N'))).not.toMatch(/\d/);
    expect(describeTest(testOn(TODAY, 'S'))).not.toMatch(/\d/);
  });
});

describe('median', () => {
  it('is null for no values', () => {
    expect(median([])).toBeNull();
  });

  it('is the middle value, or the mean of the two middle values, of the sorted list', () => {
    expect(median([7])).toBe(7);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([6, 5, 5, 6])).toBe(5.5);
    expect(median([10, 2, 9, 1])).toBe(5.5);
  });

  it('leaves the list it was given in its original order', () => {
    const values = [3, 1, 2];

    median(values);

    expect(values).toEqual([3, 1, 2]);
  });
});

describe('linearFit', () => {
  it('returns null for fewer than five points', () => {
    const fourOnALine = [0, 1, 2, 3].map((x) => ({ x, y: 2 * x + 1 }));

    expect(linearFit(fourOnALine)).toBeNull();
    expect(linearFit([])).toBeNull();
  });

  it('recovers slope and intercept from five points on a line, and reports how many it used', () => {
    const points = [0, 1, 2, 3, 4].map((x) => ({ x, y: 9 - 0.5 * x }));

    const fit = linearFit(points);

    expect(fit?.n).toBe(5);
    expect(fit?.slope).toBeCloseTo(-0.5, 10);
    expect(fit?.intercept).toBeCloseTo(9, 10);
  });

  it('returns null when every point shares one x, because no slope exists', () => {
    const points = [4, 5, 6, 7, 8].map((y) => ({ x: 3, y }));

    expect(linearFit(points)).toBeNull();
  });
});
