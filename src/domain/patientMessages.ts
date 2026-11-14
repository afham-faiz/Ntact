/**
 * What the patient app is allowed to say about the recovery curve.
 *
 * Rules agreed with the team's medical lead:
 *  - never alarming ("your recovery is failing", "you may need surgery");
 *  - never falsely reassuring ("everything is normal", "you're progressing well");
 *  - a change is only described when the recorded data supports it, and it is
 *    described as what was recorded, not as nerve recovery;
 *  - when recent results would prompt a clinician review, the only thing said
 *    is the neutral line below;
 *  - missed days are acknowledged without blame.
 *
 * Kept in one module so the wording can be reviewed in one place.
 */
import type { DateKey } from './dates';
import { buildDaySeries, primaryTestOfDay, testsOnDay } from './selectors';
import { trendHalves } from './triage';
import type { SensationTest } from './types';

export const REVIEW_LINE = 'Your therapist will review your recent results.';

export interface RecoveryMessage {
  headline: string;
  body: string;
  kind: 'review' | 'trend' | 'today' | 'starting' | 'steady';
}

/** Felt results needed in each fortnight before any change is described. */
export const TREND_MIN_READINGS = 6;
/** Median change, in steps, before any change is described. */
export const TREND_MIN_STEPS = 1;

/** True when the last fortnight's median level is clearly lower than the fortnight before. */
export function gentlerLately(tests: SensationTest[], today: DateKey): boolean {
  const { earlier, recent } = trendHalves(tests, today, 28);
  if (earlier.steps.length < TREND_MIN_READINGS || recent.steps.length < TREND_MIN_READINGS) return false;
  if (earlier.median === null || recent.median === null) return false;
  return earlier.median - recent.median >= TREND_MIN_STEPS;
}

export function recoveryMessage(input: {
  tests: SensationTest[];
  today: DateKey;
  /** A pending clinician flag about test results exists for this person. */
  resultsUnderReview: boolean;
}): RecoveryMessage {
  const { tests, today, resultsUnderReview } = input;
  const todayPrimary = primaryTestOfDay(testsOnDay(tests, today));
  const doneToday = todayPrimary !== null && todayPrimary.outcome !== 'STOPPED';
  const feltCount = tests.filter((test) => test.outcome === 'FELT').length;

  if (resultsUnderReview) {
    return {
      kind: 'review',
      headline: REVIEW_LINE,
      body: 'Recovery looks different for everyone. Keep testing when you can; every result helps them see the full picture.',
    };
  }

  if (gentlerLately(tests, today)) {
    return {
      kind: 'trend',
      headline: 'You’ve been noticing gentler vibrations lately.',
      body: 'Over the last two weeks your tests picked up gentler settings than in the two weeks before. Your therapist can use these results to follow your progress.',
    };
  }

  if (feltCount < 5) {
    return {
      kind: 'starting',
      headline: 'Your curve fills in as you test.',
      body: 'Each test adds one point. Recovery looks different for everyone, so there is no pace you are meant to match.',
    };
  }

  if (doneToday) {
    return {
      kind: 'today',
      headline: 'You’ve completed today’s test.',
      body: 'Another day of tracking your recovery. Your therapist can use these results to follow your progress.',
    };
  }

  return {
    kind: 'steady',
    headline: 'Another day of tracking your recovery.',
    body: 'Your therapist can use these results to follow your progress. Recovery looks different for everyone.',
  };
}

/** A line about gaps in the selected range, or null when there are none worth mentioning. */
export function gapNote(tests: SensationTest[], today: DateKey, rangeDays: number, enrolledDate?: DateKey): string | null {
  const series = buildDaySeries(tests, today, rangeDays);
  // Today is not a gap until it is over, and days before enrolment were never expected.
  const missed = series
    .slice(0, -1)
    .filter((point) => point.kind === 'NONE' && (!enrolledDate || point.date >= enrolledDate)).length;
  if (missed === 0) return null;
  return missed === 1
    ? 'One day in this view has no test. That’s fine: it is left blank, and nothing is filled in for it.'
    : `${missed} days in this view have no test. That’s fine: they are left blank, and you can pick up again any time.`;
}

/** Short line for the home screen, under the feature card. */
export function homeLine(tests: SensationTest[], today: DateKey, resultsUnderReview: boolean): string {
  if (resultsUnderReview) return REVIEW_LINE;
  const todayPrimary = primaryTestOfDay(testsOnDay(tests, today));
  if (todayPrimary && todayPrimary.outcome !== 'STOPPED') return 'You’ve completed today’s test.';
  return 'Recovery looks different for everyone.';
}
