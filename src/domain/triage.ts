/**
 * Provisional triage rules for the clinician worklist.
 *
 * STATUS: preliminary team discussion. These are NOT clinical guidelines, they
 * are not validated, and they are not diagnostic. They exist so the team can
 * see a prioritised worklist working and decide what the real rules should be.
 *
 *   RED    Priority review
 *   AMBER  Review suggested
 *   GREEN  No current review trigger   (never "recovering normally")
 *
 * Two things in particular are unconfirmed and are stated on screen wherever a
 * rule relies on them:
 *   1. Direction. The rules assume a LOWER detected level means greater
 *      sensitivity. That needs clinical confirmation.
 *   2. Repeatability. Steps are motor command settings, not calibrated
 *      vibration amplitudes, so day-to-day comparison is itself provisional.
 *
 * Every threshold is in TriageConfig (plain data, editable in the portal).
 */
import { painOf, skinIssueOf, skinNoteOf } from './checkIn';
import { addDays, dateKeyOf, daysBetween, formatDay, formatDayShort, type DateKey } from './dates';
import { consecutiveMissedTests, lastCompletedTestDay } from './adherence';
import {
  buildDaySeries,
  checkInsBefore,
  checkInsForPatient,
  median,
  previousFelt,
  testsForPatient,
} from './selectors';
import type {
  CheckIn,
  DemoState,
  Patient,
  SensationTest,
  TriageConfig,
  TriageFlag,
  TriageLevel,
  TriageRuleId,
} from './types';

export const DEFAULT_TRIAGE_CONFIG: TriageConfig = {
  noImprovement: {
    enabled: true,
    level: 'RED',
    windowDays: 28,
    minReadingsPerHalf: 6,
    minImprovementSteps: 1,
    floorStep: 2,
  },
  missedTests: { enabled: true, level: 'AMBER', consecutiveDays: 3 },
  thresholdRise: { enabled: true, level: 'AMBER', minTotalRise: 2, withinDays: 3 },
  noFelt: { enabled: true, level: 'AMBER', withinDays: 3 },
  skinIssue: { enabled: true, level: 'AMBER', withinDays: 3 },
  painIncrease: { enabled: true, level: 'AMBER', points: 3, baselineDays: 7, minBaselineEntries: 3, withinDays: 3 },
};

export const LEVEL_LABEL: Record<TriageLevel, string> = {
  RED: 'Priority review',
  AMBER: 'Review suggested',
  GREEN: 'No current review trigger',
};

export const RULE_LABEL: Record<TriageRuleId, string> = {
  NO_IMPROVEMENT: 'No improvement across four weeks',
  MISSED_TESTS: 'Consecutive missed tests',
  THRESHOLD_RISE: 'Level rose on two consecutive readings',
  NO_FELT_RECENT: 'Recent test not felt',
  SKIN_ISSUE: 'New skin issue reported',
  PAIN_INCREASE: 'Pain increase reported',
  CLINICIAN_FLAG: 'Marked for review',
};

export const DIRECTION_CAVEAT =
  'Assumes a lower level means greater sensitivity. The direction of change has not been confirmed clinically.';

/** The exact provisional condition for each rule, written with the values currently in force. */
export function ruleCondition(ruleId: TriageRuleId, config: TriageConfig): string {
  switch (ruleId) {
    case 'NO_IMPROVEMENT': {
      const rule = config.noImprovement;
      const half = Math.floor(rule.windowDays / 2);
      return `No improvement in the recorded detection level across ${rule.windowDays} days of adequate testing. Adequate testing means at least ${rule.minReadingsPerHalf} felt results in each ${half}-day half of the window. Improvement means the median level in the recent half is at least ${rule.minImprovementSteps} lower than in the earlier half. Not applied when the recent median is level ${rule.floorStep} or lower.`;
    }
    case 'MISSED_TESTS':
      return `${config.missedTests.consecutiveDays} or more consecutive days, counted back from yesterday, with no completed test.`;
    case 'THRESHOLD_RISE':
      return `The detected level rose on two consecutive felt readings, by ${config.thresholdRise.minTotalRise} or more levels in total, with the latest reading in the last ${config.thresholdRise.withinDays} days. Whether a rise is clinically concerning has not been agreed.`;
    case 'NO_FELT_RECENT':
      return `A test in the last ${config.noFelt.withinDays} days ran all ten levels without a reported vibration.`;
    case 'SKIN_ISSUE':
      return `A check-in in the last ${config.skinIssue.withinDays} days answered “yes” to new skin issues.`;
    case 'PAIN_INCREASE':
      return `The latest pain score, reported in the last ${config.painIncrease.withinDays} days, is ${config.painIncrease.points} or more points above the median of the previous ${config.painIncrease.baselineDays} days (at least ${config.painIncrease.minBaselineEntries} check-ins).`;
    case 'CLINICIAN_FLAG':
      return 'Marked for review by hand in this portal.';
  }
}

function flagId(patientId: string, ruleId: TriageRuleId, key: string): string {
  return `${patientId}|${ruleId}|${key}`;
}

function isRecent(day: DateKey, today: DateKey, withinDays: number): boolean {
  const age = daysBetween(day, today);
  return age >= 0 && age < withinDays;
}

export interface TrendHalves {
  earlier: { from: DateKey; to: DateKey; steps: number[]; median: number | null };
  recent: { from: DateKey; to: DateKey; steps: number[]; median: number | null };
}

/** Felt steps in the two halves of the window ending today. Shared with the patient messaging. */
export function trendHalves(tests: SensationTest[], today: DateKey, windowDays: number): TrendHalves {
  const half = Math.max(1, Math.floor(windowDays / 2));
  const series = buildDaySeries(tests, today, half * 2);
  const stepsOf = (points: typeof series) =>
    points.filter((point) => point.kind === 'FELT').map((point) => point.step as number);
  const earlierPoints = series.slice(0, half);
  const recentPoints = series.slice(half);
  const earlierSteps = stepsOf(earlierPoints);
  const recentSteps = stepsOf(recentPoints);
  return {
    earlier: {
      from: earlierPoints[0].date,
      to: earlierPoints[earlierPoints.length - 1].date,
      steps: earlierSteps,
      median: median(earlierSteps),
    },
    recent: {
      from: recentPoints[0].date,
      to: recentPoints[recentPoints.length - 1].date,
      steps: recentSteps,
      median: median(recentSteps),
    },
  };
}

function noImprovement(patient: Patient, tests: SensationTest[], today: DateKey, config: TriageConfig): TriageFlag | null {
  const rule = config.noImprovement;
  if (!rule.enabled || rule.windowDays < 2) return null;
  const enrolledFor = daysBetween(patient.enrolledDate, today);
  if (enrolledFor < rule.windowDays) return null;

  const { earlier, recent } = trendHalves(tests, today, rule.windowDays);
  if (earlier.steps.length < rule.minReadingsPerHalf || recent.steps.length < rule.minReadingsPerHalf) return null;
  if (earlier.median === null || recent.median === null) return null;
  if (recent.median <= rule.floorStep) return null;
  if (earlier.median - recent.median >= rule.minImprovementSteps) return null;

  // Re-raised once a week while the condition holds, so one review does not silence it for good.
  const week = Math.floor(enrolledFor / 7);
  return {
    id: flagId(patient.id, 'NO_IMPROVEMENT', `week-${week}`),
    patientId: patient.id,
    ruleId: 'NO_IMPROVEMENT',
    level: rule.level,
    condition: ruleCondition('NO_IMPROVEMENT', config),
    evidence: `Median level ${earlier.median} from ${formatDayShort(earlier.from)} to ${formatDayShort(earlier.to)} (${earlier.steps.length} felt results), and ${recent.median} from ${formatDayShort(recent.from)} to ${formatDayShort(recent.to)} (${recent.steps.length} felt results).`,
    raisedOn: today,
    status: 'pending',
  };
}

function missedTests(patient: Patient, tests: SensationTest[], today: DateKey, config: TriageConfig): TriageFlag | null {
  const rule = config.missedTests;
  if (!rule.enabled) return null;
  const missed = consecutiveMissedTests(tests, patient.enrolledDate, today);
  if (missed < rule.consecutiveDays) return null;
  const last = lastCompletedTestDay(tests);
  const firstMissed = addDays(today, -missed);
  return {
    id: flagId(patient.id, 'MISSED_TESTS', last ?? patient.enrolledDate),
    patientId: patient.id,
    ruleId: 'MISSED_TESTS',
    level: rule.level,
    condition: ruleCondition('MISSED_TESTS', config),
    evidence: last
      ? `No completed test on the last ${missed} days (${formatDayShort(firstMissed)} to ${formatDayShort(addDays(today, -1))}). Last completed test: ${formatDay(last)}.`
      : `No completed test since enrolment on ${formatDay(patient.enrolledDate)} (${missed} days).`,
    raisedOn: addDays(firstMissed, rule.consecutiveDays - 1),
    status: 'pending',
  };
}

function thresholdRise(patient: Patient, tests: SensationTest[], today: DateKey, config: TriageConfig): TriageFlag | null {
  const rule = config.thresholdRise;
  if (!rule.enabled) return null;
  // One reading per day: the day's representative felt result.
  const readings = buildDaySeries(tests, today, 60).filter((point) => point.kind === 'FELT');
  if (readings.length < 3) return null;
  const [a, b, c] = readings.slice(-3);
  const first = a.step as number;
  const second = b.step as number;
  const third = c.step as number;
  if (!(first < second && second < third)) return null;
  if (third - first < rule.minTotalRise) return null;
  if (!isRecent(c.date, today, rule.withinDays)) return null;
  return {
    id: flagId(patient.id, 'THRESHOLD_RISE', c.date),
    patientId: patient.id,
    ruleId: 'THRESHOLD_RISE',
    level: rule.level,
    condition: ruleCondition('THRESHOLD_RISE', config),
    evidence: `Last three felt results: level ${first} on ${formatDayShort(a.date)}, level ${second} on ${formatDayShort(b.date)}, level ${third} on ${formatDayShort(c.date)}. A higher level means a stronger commanded setting was needed.`,
    raisedOn: c.date,
    status: 'pending',
  };
}

function noFeltRecent(patient: Patient, tests: SensationTest[], today: DateKey, config: TriageConfig): TriageFlag | null {
  const rule = config.noFelt;
  if (!rule.enabled) return null;
  const recent = [...tests]
    .reverse()
    .find((test) => test.outcome === 'NO_FELT' && isRecent(dateKeyOf(test.timestamp), today, rule.withinDays));
  if (!recent) return null;
  const day = dateKeyOf(recent.timestamp);
  const earlier = previousFelt(tests, recent.timestamp);
  return {
    id: flagId(patient.id, 'NO_FELT_RECENT', day),
    patientId: patient.id,
    ruleId: 'NO_FELT_RECENT',
    level: rule.level,
    condition: ruleCondition('NO_FELT_RECENT', config),
    evidence: `Test on ${formatDay(day)} ran all ten levels without a reported vibration. ${
      earlier
        ? `Previous detection: level ${earlier.detectedLevel} on ${formatDayShort(dateKeyOf(earlier.timestamp))}.`
        : 'No earlier detection on record.'
    }`,
    raisedOn: day,
    status: 'pending',
  };
}

function skinIssue(patient: Patient, checkIns: CheckIn[], today: DateKey, config: TriageConfig): TriageFlag | null {
  const rule = config.skinIssue;
  if (!rule.enabled) return null;
  const recent = [...checkIns]
    .reverse()
    .find((entry) => skinIssueOf(entry) === true && isRecent(entry.date, today, rule.withinDays));
  if (!recent) return null;
  const quoted = skinNoteOf(recent);
  return {
    id: flagId(patient.id, 'SKIN_ISSUE', recent.date),
    patientId: patient.id,
    ruleId: 'SKIN_ISSUE',
    level: rule.level,
    condition: ruleCondition('SKIN_ISSUE', config),
    evidence: quoted
      ? `Check-in on ${formatDay(recent.date)} reported a new skin issue: “${quoted}”`
      : `Check-in on ${formatDay(recent.date)} reported a new skin issue. No description given.`,
    raisedOn: recent.date,
    status: 'pending',
  };
}

function painIncrease(patient: Patient, checkIns: CheckIn[], today: DateKey, config: TriageConfig): TriageFlag | null {
  const rule = config.painIncrease;
  if (!rule.enabled) return null;
  const latest = checkIns.length > 0 ? checkIns[checkIns.length - 1] : null;
  if (!latest || !isRecent(latest.date, today, rule.withinDays)) return null;
  const latestPain = painOf(latest);
  if (latestPain === null) return null;
  const baseline = checkInsBefore(checkIns, latest.date, rule.baselineDays)
    .map(painOf)
    .filter((value): value is number => value !== null);
  if (baseline.length < rule.minBaselineEntries) return null;
  const baselineMedian = median(baseline);
  if (baselineMedian === null || latestPain - baselineMedian < rule.points) return null;
  return {
    id: flagId(patient.id, 'PAIN_INCREASE', latest.date),
    patientId: patient.id,
    ruleId: 'PAIN_INCREASE',
    level: rule.level,
    condition: ruleCondition('PAIN_INCREASE', config),
    evidence: `Pain reported as ${latestPain}/10 on ${formatDay(latest.date)}. Median of the previous ${rule.baselineDays} days: ${baselineMedian}/10 (${baseline.length} check-ins).`,
    raisedOn: latest.date,
    status: 'pending',
  };
}

/** Flags the rules raise for one patient, before any recorded reviews are applied. */
export function ruleFlags(
  patient: Patient,
  tests: SensationTest[],
  checkIns: CheckIn[],
  today: DateKey,
  config: TriageConfig,
): TriageFlag[] {
  return [
    noImprovement(patient, tests, today, config),
    thresholdRise(patient, tests, today, config),
    noFeltRecent(patient, tests, today, config),
    skinIssue(patient, checkIns, today, config),
    painIncrease(patient, checkIns, today, config),
    missedTests(patient, tests, today, config),
  ].filter((flag): flag is TriageFlag => flag !== null);
}

const LEVEL_ORDER: Record<TriageLevel, number> = { RED: 0, AMBER: 1, GREEN: 2 };

export function compareLevels(a: TriageLevel, b: TriageLevel): number {
  return LEVEL_ORDER[a] - LEVEL_ORDER[b];
}

export interface TriageSummary {
  patientId: string;
  level: TriageLevel;
  /** Flags waiting for a review, most urgent first. */
  pending: TriageFlag[];
  /** Flags already reviewed whose condition is still being met today. */
  reviewedStillActive: TriageFlag[];
}

/** Every flag for the portal: pending rule flags and manual flags, then the log of reviewed ones. */
export function deriveFlags(state: DemoState, today: DateKey): TriageFlag[] {
  const reviewed = new Map(state.flagLog.map((flag) => [flag.id, flag]));
  const pending: TriageFlag[] = [];

  for (const patient of state.patients) {
    const tests = testsForPatient(state.tests, patient.id);
    const checkIns = checkInsForPatient(state.checkIns, patient.id);
    for (const flag of ruleFlags(patient, tests, checkIns, today, state.triageConfig)) {
      if (!reviewed.has(flag.id)) pending.push(flag);
    }
  }

  for (const manual of state.clinicianFlags) {
    pending.push({
      id: manual.id,
      patientId: manual.patientId,
      ruleId: 'CLINICIAN_FLAG',
      level: 'AMBER',
      condition: ruleCondition('CLINICIAN_FLAG', state.triageConfig),
      evidence: manual.note?.trim() ? `Clinician note: “${manual.note.trim()}”` : 'No note was added.',
      raisedOn: dateKeyOf(manual.createdAt),
      status: 'pending',
      flagNote: manual.note,
    });
  }

  return [...pending, ...state.flagLog];
}

/** One summary per patient: the level is set by the most urgent PENDING flag. */
export function triageSummaries(state: DemoState, today: DateKey): Map<string, TriageSummary> {
  const flags = deriveFlags(state, today);
  const summaries = new Map<string, TriageSummary>();

  for (const patient of state.patients) {
    const tests = testsForPatient(state.tests, patient.id);
    const checkIns = checkInsForPatient(state.checkIns, patient.id);
    const activeIds = new Set(ruleFlags(patient, tests, checkIns, today, state.triageConfig).map((flag) => flag.id));
    const pending = flags
      .filter((flag) => flag.patientId === patient.id && flag.status === 'pending')
      .sort((a, b) => compareLevels(a.level, b.level));
    const reviewedStillActive = flags.filter(
      (flag) => flag.patientId === patient.id && flag.status === 'reviewed' && activeIds.has(flag.id),
    );
    const level: TriageLevel = pending.some((flag) => flag.level === 'RED')
      ? 'RED'
      : pending.length > 0
        ? 'AMBER'
        : 'GREEN';
    summaries.set(patient.id, { patientId: patient.id, level, pending, reviewedStillActive });
  }

  return summaries;
}

/** Rule ids whose flags are about test results (as opposed to adherence or check-ins). */
export const RESULT_RULES: TriageRuleId[] = ['NO_IMPROVEMENT', 'THRESHOLD_RISE', 'NO_FELT_RECENT'];
