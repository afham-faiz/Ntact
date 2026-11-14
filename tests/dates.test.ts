/**
 * Calendar-day helpers. Every series, rule and seed record is built on these, so
 * the suite pins down the few properties the rest relies on.
 */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  atLocalTime,
  dateKeyOf,
  daysBetween,
  fromDateKey,
  lastDays,
  relativeDay,
  toDateKey,
  weeksSince,
} from '../src/domain/dates';
import { FIXED_DATE_KEY, FIXED_NOW } from './helpers';

describe('date keys', () => {
  it('names the fixed test date 2026-11-12, the local calendar day', () => {
    expect(FIXED_DATE_KEY).toBe('2026-11-12');
    expect(toDateKey(FIXED_NOW)).toBe('2026-11-12');
    expect(toDateKey(new Date(2026, 0, 5, 23, 59, 59))).toBe('2026-01-05');
    expect(toDateKey(fromDateKey('2026-02-28'))).toBe('2026-02-28');
  });

  it('reads a timestamp written for any local time of a day back as that same day', () => {
    for (const [hours, minutes] of [
      [0, 0],
      [1, 30],
      [12, 0],
      [23, 59],
    ]) {
      expect(dateKeyOf(atLocalTime('2026-11-12', hours, minutes))).toBe('2026-11-12');
      // The night the clocks go back, and the night they go forward.
      expect(dateKeyOf(atLocalTime('2026-10-25', hours, minutes))).toBe('2026-10-25');
      expect(dateKeyOf(atLocalTime('2026-03-29', hours, minutes))).toBe('2026-03-29');
    }
  });
});

describe('day arithmetic', () => {
  it('crosses month ends, year ends and leap days', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-11-12', 0)).toBe('2026-11-12');
  });

  it('counts whole days between two keys, signed', () => {
    expect(daysBetween('2026-11-12', '2026-11-12')).toBe(0);
    expect(daysBetween('2026-11-05', '2026-11-12')).toBe(7);
    expect(daysBetween('2026-11-12', '2026-11-05')).toBe(-7);
    expect(daysBetween('2026-08-15', '2026-11-12')).toBe(89);
  });

  it('still counts one day per calendar day across the clock changes of 2026', () => {
    // Europe: 29 March and 25 October. North America: 8 March and 1 November.
    for (const changeover of ['2026-03-29', '2026-10-25', '2026-03-08', '2026-11-01']) {
      const before = addDays(changeover, -1);
      const after = addDays(changeover, 1);

      expect(daysBetween(before, after)).toBe(2);
      expect(lastDays(after, 3)).toEqual([before, changeover, after]);
    }
  });

  it('lists `count` consecutive days ending on `end`, oldest first', () => {
    expect(lastDays('2026-11-02', 4)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(lastDays('2026-11-12', 1)).toEqual(['2026-11-12']);
    expect(lastDays('2026-11-12', 0)).toEqual([]);
  });
});

describe('relative wording', () => {
  it('says Today, Yesterday, then a day count, then the date once it is over a week old', () => {
    expect(relativeDay('2026-11-12', '2026-11-12')).toBe('Today');
    expect(relativeDay('2026-11-11', '2026-11-12')).toBe('Yesterday');
    expect(relativeDay('2026-11-09', '2026-11-12')).toBe('3 days ago');
    expect(relativeDay('2026-11-05', '2026-11-12')).toBe('7 days ago');
    expect(relativeDay('2026-11-04', '2026-11-12')).toBe('4 Nov');
  });

  it('counts whole weeks since a day and never goes below zero', () => {
    expect(weeksSince('2026-11-12', '2026-11-12')).toBe(0);
    expect(weeksSince('2026-11-06', '2026-11-12')).toBe(0);
    expect(weeksSince('2026-11-05', '2026-11-12')).toBe(1);
    expect(weeksSince('2026-10-01', '2026-11-12')).toBe(6);
    expect(weeksSince('2026-11-20', '2026-11-12')).toBe(0);
  });
});
