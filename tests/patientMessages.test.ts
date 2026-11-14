import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/demo/seed';
import {
  REVIEW_LINE,
  gapNote,
  gentlerLately,
  homeLine,
  recoveryMessage,
  type RecoveryMessage,
} from '../src/domain/patientMessages';
import { testsForPatient } from '../src/domain/selectors';
import { RESULT_RULES, triageSummaries } from '../src/domain/triage';
import type { SensationTest } from '../src/domain/types';
import { FIXED_DATE_KEY as TODAY, daysFromToday, historyEnding, testOn, type DayPlan } from './helpers';

const YESTERDAY = daysFromToday(-1);

/** Nothing alarming, nothing falsely reassuring, nothing that reads as an interpretation. */
const FORBIDDEN = [
  'fail',
  'surgery',
  'regenerat',
  'normal',
  'progressing well',
  'worse',
  'deteriorat',
  'concern',
  'abnormal',
  'diagnos',
];

const seed = createSeedState(TODAY);
const PATIENT_IDS = seed.patients.map((patient) => patient.id);
const testsOf = (patientId: string): SensationTest[] => testsForPatient(seed.tests, patientId);

const message = (tests: SensationTest[], resultsUnderReview = false): RecoveryMessage =>
  recoveryMessage({ tests, today: TODAY, resultsUnderReview });

function expectAllowedWording(text: string): void {
  for (const word of FORBIDDEN) {
    expect(text.toLowerCase(), text).not.toContain(word);
  }
}

const repeat = (mark: DayPlan, days: number): DayPlan[] => Array.from({ length: days }, () => mark);

describe('recoveryMessage wording', () => {
  it('never uses alarming or falsely reassuring language for any seeded person, under review or not', () => {
    expect(PATIENT_IDS).toHaveLength(9);

    for (const patientId of PATIENT_IDS) {
      for (const resultsUnderReview of [true, false]) {
        const { headline, body } = message(testsOf(patientId), resultsUnderReview);
        expectAllowedWording(`${headline} ${body}`);
      }
    }
  });

  it('holds every kind of message, the home line and the gap note to the same wording rules', () => {
    const danielDoneToday = [...testsOf('p-daniel'), testOn(TODAY, 7)];
    const messages = [
      message(testsOf('p-maya'), true),
      message(testsOf('p-maya')),
      message(testsOf('p-elin')),
      message(testsOf('p-daniel')),
      message(danielDoneToday),
    ];
    // All five kinds are represented, so no wording escapes the check.
    expect(messages.map((entry) => entry.kind).sort()).toEqual(['review', 'starting', 'steady', 'today', 'trend']);

    const lines = [
      ...messages.flatMap((entry) => [entry.headline, entry.body]),
      homeLine(testsOf('p-daniel'), TODAY, true),
      homeLine(testsOf('p-daniel'), TODAY, false),
      homeLine(danielDoneToday, TODAY, false),
      gapNote(testsOf('p-maya'), TODAY, 14) ?? '',
      gapNote(testsOf('p-priya'), TODAY, 28) ?? '',
    ];
    expect(lines.every((line) => line.trim() !== '')).toBe(true);
    for (const line of lines) expectAllowedWording(line);
  });

  it('says exactly "Your therapist will review your recent results." when results are under review', () => {
    expect(REVIEW_LINE).toBe('Your therapist will review your recent results.');

    for (const patientId of PATIENT_IDS) {
      const review = message(testsOf(patientId), true);

      expect(review.headline).toBe('Your therapist will review your recent results.');
      expect(review.kind).toBe('review');
      expect(homeLine(testsOf(patientId), TODAY, true)).toBe('Your therapist will review your recent results.');
    }
  });

  it('gives the review line to exactly the seeded people with a pending flag about their results', () => {
    const summaries = triageSummaries(seed, TODAY);
    const underReview = PATIENT_IDS.filter((patientId) =>
      summaries.get(patientId)?.pending.some((flag) => RESULT_RULES.includes(flag.ruleId)),
    );

    // Priya's flag is about missed tests, not results, so she is not told her results are under review.
    expect(underReview.sort()).toEqual(['p-aiko', 'p-daniel', 'p-leon', 'p-tomas']);
    expect([...RESULT_RULES].sort()).toEqual(['NO_FELT_RECENT', 'NO_IMPROVEMENT', 'THRESHOLD_RISE']);
  });
});

describe('describing a change', () => {
  it('describes a change for Maya, whose recent fortnight is clearly lower than the one before', () => {
    expect(gentlerLately(testsOf('p-maya'), TODAY)).toBe(true);
    expect(message(testsOf('p-maya')).kind).toBe('trend');
  });

  it('describes no change for Daniel (flat) or Tomás (fluctuating)', () => {
    for (const patientId of ['p-daniel', 'p-tomas']) {
      expect(gentlerLately(testsOf(patientId), TODAY), patientId).toBe(false);
      expect(message(testsOf(patientId)).kind, patientId).not.toBe('trend');
    }
  });

  it('tells a person with fewer than five felt results that the curve is still filling in', () => {
    expect(message(testsOf('p-elin')).kind).toBe('starting');
    expect(message(historyEnding(YESTERDAY, [9, 'N', 10, 'N', 9, 'N', 'N', 10])).kind).toBe('starting');
    expect(message([]).kind).toBe('starting');
  });

  it('needs six felt results in each fortnight and a drop of a whole step in the median', () => {
    const gentler = [...repeat(8, 14), ...repeat(6, 13)];
    const tooFewRecent: DayPlan[] = [...repeat(8, 14), ...repeat(null, 8), ...repeat(6, 5)];
    // Six 8s and six 7s: a recent median of 7.5, half a step below the earlier 8.
    const halfAStep: DayPlan[] = [...repeat(8, 14), 8, 7, 8, 7, 8, 7, 8, 7, 8, 7, 8, 7, null];
    const stronger = [...repeat(6, 14), ...repeat(8, 13)];

    expect(message(historyEnding(YESTERDAY, gentler)).kind).toBe('trend');
    expect(message(historyEnding(YESTERDAY, tooFewRecent)).kind).not.toBe('trend');
    expect(message(historyEnding(YESTERDAY, halfAStep)).kind).not.toBe('trend');
    // A change in the other direction is never described to the patient at all.
    expect(message(historyEnding(YESTERDAY, stronger)).kind).toBe('steady');
  });

  it('acknowledges today’s test once it is completed; a cancelled attempt alone does not count', () => {
    const before = testsOf('p-daniel');

    expect(message(before).kind).toBe('steady');
    expect(message([...before, testOn(TODAY, 7)]).kind).toBe('today');
    expect(message([...before, testOn(TODAY, 'N')]).kind).toBe('today');
    expect(message([...before, testOn(TODAY, 'S')]).kind).toBe('steady');

    expect(homeLine([...before, testOn(TODAY, 7)], TODAY, false)).toBe('You’ve completed today’s test.');
    expect(homeLine([...before, testOn(TODAY, 'S')], TODAY, false)).toBe(homeLine(before, TODAY, false));
  });
});

describe('gapNote', () => {
  it('is null when every day in the view has a test, and today is not a gap until it is over', () => {
    expect(gapNote(historyEnding(YESTERDAY, repeat(6, 13)), TODAY, 14)).toBeNull();
    expect(gapNote(testsOf('p-daniel'), TODAY, 14)).toBeNull();
    expect(gapNote(testsOf('p-tomas'), TODAY, 28)).toBeNull();
  });

  it('counts only days with no test at all: a not-felt or cancelled day is not a gap', () => {
    const tests = historyEnding(YESTERDAY, [6, 'N', 'S', 6, 6, 6]);

    expect(gapNote(tests, TODAY, 7)).toBeNull();
  });

  it('acknowledges one gap or several, in the singular or the plural', () => {
    expect(gapNote(historyEnding(YESTERDAY, [6, null, 6, 6]), TODAY, 5)).toMatch(/^One day in this view has no test\./);
    expect(gapNote(historyEnding(YESTERDAY, [6, null, null, 6]), TODAY, 5)).toMatch(
      /^2 days in this view have no test\./,
    );
    expect(gapNote(testsOf('p-priya'), TODAY, 14)).toMatch(/^8 days in this view have no test\./);
  });

  it('never blames: no "missed", "should", "forgot" or "behind", for any seeded person or range', () => {
    const notes = PATIENT_IDS.flatMap((patientId) =>
      [14, 28, 90].map((rangeDays) => gapNote(testsOf(patientId), TODAY, rangeDays)),
    ).filter((note): note is string => note !== null);

    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      for (const word of ['missed', 'should', 'forgot', 'behind']) {
        expect(note.toLowerCase(), note).not.toContain(word);
      }
    }
  });

  // SUSPECTED BUG (src/domain/patientMessages.ts, gapNote): the function is not given the
  // enrolment date, so days before the person joined count as days with no test. Elin joined
  // three days ago and has tested every day since, yet her two-week view reads "10 days in
  // this view have no test ... you can pick up again any time" (24 days in the month view).
  // Expected: null, i.e. days before enrolment are not gaps. No screen calls gapNote yet, so
  // a caller could also clip the range itself; either way the function as written cannot.
  it('gapNote does not count days before enrolment as gaps (fixed: pass the enrolment date)', () => {
    const elin = seed.patients.find((patient) => patient.id === 'p-elin');
    expect(elin?.enrolledDate).toBe(daysFromToday(-3));

    expect(gapNote(testsOf('p-elin'), TODAY, 14, elin?.enrolledDate)).toBeNull();
  });
});
