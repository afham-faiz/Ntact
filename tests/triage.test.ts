import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/demo/seed';
import { DemoStore } from '../src/demo/store';
import {
  DEFAULT_TRIAGE_CONFIG,
  LEVEL_LABEL,
  RULE_LABEL,
  deriveFlags,
  ruleCondition,
  ruleFlags,
  triageSummaries,
  type TriageSummary,
} from '../src/domain/triage';
import { dateKeyOf, type DateKey } from '../src/domain/dates';
import type {
  CheckIn,
  DemoState,
  SensationTest,
  TriageConfig,
  TriageFlag,
  TriageLevel,
  TriageRuleId,
} from '../src/domain/types';
import {
  FIXED_DATE_KEY as TODAY,
  FIXED_NOW,
  MemoryStorage,
  checkInOn,
  daysFromToday,
  historyEnding,
  makePatient,
  type DayPlan,
} from './helpers';

const YESTERDAY = daysFromToday(-1);

/** The seeded cohort for the fixed date, optionally with the provisional thresholds edited. */
function seeded(edit?: (config: TriageConfig) => void): DemoState {
  const state = createSeedState(TODAY);
  edit?.(state.triageConfig);
  return state;
}

function summaryOf(state: DemoState, patientId: string): TriageSummary {
  const summary = triageSummaries(state, TODAY).get(patientId);
  if (!summary) throw new Error(`No triage summary for ${patientId}`);
  return summary;
}

const pendingRules = (state: DemoState, patientId: string): TriageRuleId[] =>
  summaryOf(state, patientId).pending.map((flag) => flag.ruleId);

const allPendingRules = (state: DemoState): TriageRuleId[] =>
  [...triageSummaries(state, TODAY).values()].flatMap((summary) => summary.pending.map((flag) => flag.ruleId));

function flagFor(state: DemoState, patientId: string, ruleId: TriageRuleId): TriageFlag {
  const flag = summaryOf(state, patientId).pending.find((candidate) => candidate.ruleId === ruleId);
  if (!flag) throw new Error(`${patientId} has no pending ${ruleId} flag`);
  return flag;
}

describe('seeded cohort', () => {
  it.each<[string, TriageLevel]>([
    ['p-tomas', 'RED'],
    ['p-daniel', 'RED'],
    ['p-priya', 'AMBER'],
    ['p-aiko', 'AMBER'],
    ['p-leon', 'AMBER'],
    ['p-maya', 'GREEN'],
    ['p-samuel', 'GREEN'],
    ['p-noor', 'GREEN'],
    ['p-elin', 'GREEN'],
  ])('%s is %s', (patientId, level) => {
    expect(summaryOf(seeded(), patientId).level).toBe(level);
  });

  it.each<[string, TriageRuleId[]]>([
    ['p-tomas', ['NO_IMPROVEMENT', 'PAIN_INCREASE']],
    ['p-daniel', ['NO_IMPROVEMENT', 'SKIN_ISSUE']],
    ['p-priya', ['MISSED_TESTS']],
    ['p-aiko', ['NO_FELT_RECENT']],
    ['p-leon', ['THRESHOLD_RISE']],
  ])('%s has pending flags that include %j', (patientId, rules) => {
    expect(pendingRules(seeded(), patientId)).toEqual(expect.arrayContaining(rules));
  });

  it('lists the most urgent pending flag first, whichever rule raised it', () => {
    // By default the only RED rule is also the first one evaluated, so swap the two levels round.
    const state = seeded((config) => {
      config.noImprovement.level = 'AMBER';
      config.painIncrease.level = 'RED';
    });

    const summary = summaryOf(state, 'p-tomas');

    expect(summary.pending.map((flag) => [flag.ruleId, flag.level])).toEqual([
      ['PAIN_INCREASE', 'RED'],
      ['NO_IMPROVEMENT', 'AMBER'],
    ]);
    expect(summary.level).toBe('RED');
  });

  it('does not let an already reviewed flag raise a level once its condition has passed', () => {
    const state = seeded();
    const reviewed = state.flagLog.filter((flag) => flag.patientId === 'p-samuel');
    expect(reviewed.map((flag) => flag.ruleId)).toEqual(['PAIN_INCREASE']);

    const summary = summaryOf(state, 'p-samuel');

    expect(summary).toMatchObject({ level: 'GREEN', pending: [], reviewedStillActive: [] });
    // It is still on record for the portal's history.
    expect(deriveFlags(state, TODAY)).toContainEqual(reviewed[0]);
  });
});

describe('flag wording', () => {
  const FORBIDDEN = ['diagnos', 'failed', 'failing', 'surgery', 'risk score', 'normal recovery', 'deteriorat'];
  const ALL_RULES = Object.keys(RULE_LABEL) as TriageRuleId[];

  /** The seeded cohort, a hand-raised flag and both exercise rules, so every rule id is represented. */
  function everyFlag(): TriageFlag[] {
    const state = seeded();
    // Maya stops exercising for three days; Noor's estimated range falls across her last six sessions.
    const cutoff = daysFromToday(-3);
    state.exerciseSessions = state.exerciseSessions.filter(
      (session) => session.patientId !== 'p-maya' || dateKeyOf(session.timestamp) < cutoff,
    );
    state.exerciseSessions
      .filter((session) => session.patientId === 'p-noor')
      .slice(-6)
      .forEach((session, index) => {
        session.rangeDeg = index < 3 ? 150 : 112;
      });
    state.clinicianFlags.push({
      id: 'flag-manual-1',
      patientId: 'p-maya',
      createdAt: FIXED_NOW.toISOString(),
      note: 'Sleeve fit to check at the next visit.',
    });
    return deriveFlags(state, TODAY);
  }

  it('gives every flag a condition and the evidence that met it', () => {
    const flags = everyFlag();

    expect(new Set(flags.map((flag) => flag.ruleId))).toEqual(new Set(ALL_RULES));
    for (const flag of flags) {
      expect(flag.condition.trim(), flag.id).not.toBe('');
      expect(flag.evidence.trim(), flag.id).not.toBe('');
    }
  });

  it('never uses diagnostic or outcome language in a flag, a rule label or a level label', () => {
    const texts = [
      ...everyFlag().flatMap((flag) => [flag.condition, flag.evidence]),
      ...ALL_RULES.map((ruleId) => ruleCondition(ruleId, DEFAULT_TRIAGE_CONFIG)),
      ...Object.values(RULE_LABEL),
      ...Object.values(LEVEL_LABEL),
    ];

    for (const text of texts) {
      for (const word of FORBIDDEN) {
        expect(text.toLowerCase(), text).not.toContain(word);
      }
    }
  });

  it('labels GREEN as "No current review trigger", never as a statement about recovery', () => {
    expect(LEVEL_LABEL.GREEN).toBe('No current review trigger');
    for (const word of ['recover', 'normal', 'healthy', 'good']) {
      expect(LEVEL_LABEL.GREEN.toLowerCase()).not.toContain(word);
    }
  });

  it('writes the condition out with the values currently in force', () => {
    const edited = structuredClone(DEFAULT_TRIAGE_CONFIG);
    edited.missedTests.consecutiveDays = 5;
    edited.painIncrease.points = 4;

    expect(ruleCondition('MISSED_TESTS', DEFAULT_TRIAGE_CONFIG)).toContain('3 or more consecutive days');
    expect(ruleCondition('MISSED_TESTS', edited)).toContain('5 or more consecutive days');
    expect(ruleCondition('PAIN_INCREASE', edited)).toContain('4 or more points');
  });
});

describe('configuration', () => {
  it.each<[TriageRuleId, keyof TriageConfig]>([
    ['NO_IMPROVEMENT', 'noImprovement'],
    ['MISSED_TESTS', 'missedTests'],
    ['THRESHOLD_RISE', 'thresholdRise'],
    ['NO_FELT_RECENT', 'noFelt'],
    ['SKIN_ISSUE', 'skinIssue'],
    ['PAIN_INCREASE', 'painIncrease'],
  ])('disabling %s removes its flags and leaves the other rules alone', (ruleId, key) => {
    const before = allPendingRules(seeded());
    expect(before).toContain(ruleId);

    const after = allPendingRules(
      seeded((config) => {
        config[key].enabled = false;
      }),
    );

    expect(after).not.toContain(ruleId);
    expect(after).toEqual(before.filter((rule) => rule !== ruleId));
  });

  it('clears Priya’s missed-tests flag when consecutiveDays is raised to 10', () => {
    expect(pendingRules(seeded(), 'p-priya')).toContain('MISSED_TESTS');

    const state = seeded((config) => {
      config.missedTests.consecutiveDays = 10;
    });

    expect(pendingRules(state, 'p-priya')).not.toContain('MISSED_TESTS');
    expect(summaryOf(state, 'p-priya').level).toBe('GREEN');
  });

  it('a flag carries whatever level its rule is set to: NO_IMPROVEMENT is review-soon unless changed', () => {
    expect(flagFor(seeded(), 'p-tomas', 'NO_IMPROVEMENT').level).toBe('AMBER');

    const state = seeded((config) => {
      config.noImprovement.level = 'RED';
    });

    expect(flagFor(state, 'p-tomas', 'NO_IMPROVEMENT').level).toBe('RED');
  });

  it('makes skin and pain problems same-day by default, and review-soon when a clinician sets them so', () => {
    expect(flagFor(seeded(), 'p-tomas', 'PAIN_INCREASE').level).toBe('RED');
    expect(flagFor(seeded(), 'p-daniel', 'SKIN_ISSUE').level).toBe('RED');

    const state = seeded((config) => {
      config.painIncrease.level = 'AMBER';
      config.skinIssue.level = 'AMBER';
    });

    expect(summaryOf(state, 'p-tomas').level).toBe('AMBER');
    expect(summaryOf(state, 'p-daniel').level).toBe('AMBER');
  });

  it('removes NO_IMPROVEMENT when minReadingsPerHalf is 20: fourteen days cannot hold that much testing', () => {
    const state = seeded((config) => {
      config.noImprovement.minReadingsPerHalf = 20;
    });

    expect(allPendingRules(state)).not.toContain('NO_IMPROVEMENT');
    // Their same-day check-in flags are untouched, so both are still at the top of the worklist.
    expect(summaryOf(state, 'p-tomas').level).toBe('RED');
    expect(summaryOf(state, 'p-daniel').level).toBe('RED');
  });
});

describe('NO_IMPROVEMENT on synthetic histories', () => {
  const flat = (step: number, days: number): DayPlan[] => Array.from({ length: days }, () => step);

  /** Whether the rule fires for a person enrolled `enrolledDaysAgo` days ago with this history ending yesterday. */
  function raised(enrolledDaysAgo: number, plan: DayPlan[], config: TriageConfig = DEFAULT_TRIAGE_CONFIG): boolean {
    const patient = makePatient({ enrolledDate: daysFromToday(-enrolledDaysAgo) });
    const flags = ruleFlags(patient, historyEnding(YESTERDAY, plan), [], TODAY, config);
    return flags.some((flag) => flag.ruleId === 'NO_IMPROVEMENT');
  }

  it('is raised for a flat history once the person has been enrolled for the whole window', () => {
    expect(raised(28, flat(7, 28))).toBe(true);
  });

  it('is not raised for anyone enrolled for fewer than windowDays', () => {
    expect(raised(27, flat(7, 27))).toBe(false);
    // Even with a full window of readings on file, enrolment is what counts.
    expect(raised(27, flat(7, 28))).toBe(false);
  });

  it('is not raised when the recent median is at or below floorStep', () => {
    expect(raised(40, flat(2, 28))).toBe(false);
    expect(raised(40, flat(1, 28))).toBe(false);
    // One step above the floor, the same flat pattern does count.
    expect(raised(40, flat(3, 28))).toBe(true);
  });

  it('is not raised when the recent median is at least minImprovementSteps lower than the earlier one', () => {
    expect(raised(40, [...flat(7, 14), ...flat(6, 14)])).toBe(false);
    // A rise is not an improvement.
    expect(raised(40, [...flat(6, 14), ...flat(7, 14)])).toBe(true);
  });

  it('is not raised without adequate testing in both halves, however flat the readings are', () => {
    const sparseRecentHalf: DayPlan[] = [...flat(7, 14), 7, null, 7, null, 7, null, 7, null, 7, null, 'N', 'N', 'S', null];

    expect(raised(40, sparseRecentHalf)).toBe(false);
  });

  // SUSPECTED BUG (src/domain/triage.ts, trendHalves): a window shorter than two days leaves
  // both halves empty and `earlierPoints[0].date` throws "Cannot read properties of undefined".
  // TriageConfig is plain data that the portal can edit and that is read back from storage
  // unvalidated, so `noImprovement.windowDays` of 0 or 1 takes down the whole worklist.
  // Expected: the rule simply does not apply (or the value is clamped).
  it('fixed: a one-day window does not crash the worklist', () => {
    const state = seeded((config) => {
      config.noImprovement.windowDays = 1;
    });

    expect(() => triageSummaries(state, TODAY)).not.toThrow();
  });
});

describe('rule boundaries on synthetic records', () => {
  /** Rule ids raised for a person enrolled sixty days ago with exactly these records. */
  function rulesFor(
    tests: SensationTest[],
    checkIns: CheckIn[] = [],
    config: TriageConfig = DEFAULT_TRIAGE_CONFIG,
  ): TriageRuleId[] {
    return ruleFlags(makePatient(), tests, checkIns, TODAY, config).map((flag) => flag.ruleId);
  }

  it('MISSED_TESTS needs three missed days in a row before today: two are not enough', () => {
    expect(rulesFor(historyEnding(YESTERDAY, [6, null, null]))).not.toContain('MISSED_TESTS');
    expect(rulesFor(historyEnding(YESTERDAY, [6, null, null, null]))).toContain('MISSED_TESTS');
    // A cancelled attempt does not break the run of missed days. A completed not-felt test does.
    expect(rulesFor(historyEnding(YESTERDAY, [6, null, 'S', null]))).toContain('MISSED_TESTS');
    expect(rulesFor(historyEnding(YESTERDAY, [6, null, 'N', null]))).not.toContain('MISSED_TESTS');
  });

  it('THRESHOLD_RISE needs two rises in a row on felt readings, with the latest in the last three days', () => {
    expect(rulesFor(historyEnding(YESTERDAY, [6, 6, 7, 8]))).toContain('THRESHOLD_RISE');
    // One jump is not two rises, and neither is a dip followed by a rise.
    expect(rulesFor(historyEnding(YESTERDAY, [6, 6, 6, 8]))).not.toContain('THRESHOLD_RISE');
    expect(rulesFor(historyEnding(YESTERDAY, [6, 8, 7, 8]))).not.toContain('THRESHOLD_RISE');
    // Readings are compared felt-to-felt: a not-felt day and a missed day in between are skipped.
    expect(rulesFor(historyEnding(YESTERDAY, [6, 'N', 7, null, 8]))).toContain('THRESHOLD_RISE');
    // The same two rises, with the latest reading two days ago, then three.
    expect(rulesFor(historyEnding(daysFromToday(-2), [6, 6, 7, 8]))).toContain('THRESHOLD_RISE');
    expect(rulesFor(historyEnding(daysFromToday(-3), [6, 6, 7, 8]))).not.toContain('THRESHOLD_RISE');
  });

  it('THRESHOLD_RISE honours minTotalRise', () => {
    const stricter = structuredClone(DEFAULT_TRIAGE_CONFIG);
    stricter.thresholdRise.minTotalRise = 3;

    expect(rulesFor(historyEnding(YESTERDAY, [6, 7, 8]), [], stricter)).not.toContain('THRESHOLD_RISE');
    expect(rulesFor(historyEnding(YESTERDAY, [6, 7, 9]), [], stricter)).toContain('THRESHOLD_RISE');
  });

  it('NO_FELT_RECENT and SKIN_ISSUE look at today and the two days before, and no further back', () => {
    expect(rulesFor(historyEnding(TODAY, [6, 'N']))).toContain('NO_FELT_RECENT');
    expect(rulesFor(historyEnding(daysFromToday(-2), [6, 'N']))).toContain('NO_FELT_RECENT');
    expect(rulesFor(historyEnding(daysFromToday(-3), [6, 'N']))).not.toContain('NO_FELT_RECENT');
    // A cancelled test is not a not-felt result.
    expect(rulesFor(historyEnding(YESTERDAY, [6, 'S']))).not.toContain('NO_FELT_RECENT');

    const skinReportOn = (day: DateKey, skin: boolean) => [checkInOn(day, { pain: 2, skin, cold: 'none' })];
    expect(rulesFor([], skinReportOn(TODAY, true))).toContain('SKIN_ISSUE');
    expect(rulesFor([], skinReportOn(daysFromToday(-2), true))).toContain('SKIN_ISSUE');
    expect(rulesFor([], skinReportOn(daysFromToday(-3), true))).not.toContain('SKIN_ISSUE');
    expect(rulesFor([], skinReportOn(YESTERDAY, false))).not.toContain('SKIN_ISSUE');
  });

  it('PAIN_INCREASE compares the latest score with the median of the week before it, and needs three earlier check-ins', () => {
    /** Daily pain scores, oldest first, ending yesterday. null is a day with no check-in. */
    const painHistory = (scores: (number | null)[]): CheckIn[] =>
      scores.flatMap((pain, index) =>
        pain === null ? [] : [checkInOn(daysFromToday(index - scores.length), { pain, skin: false, cold: 'none' })],
      );

    // Exactly three points above a median of 2 counts; two points do not.
    expect(rulesFor([], painHistory([2, 2, 2, 5]))).toContain('PAIN_INCREASE');
    expect(rulesFor([], painHistory([2, 2, 2, 4]))).not.toContain('PAIN_INCREASE');
    // One earlier bad day does not move the median.
    expect(rulesFor([], painHistory([2, 7, 2, 2, 5]))).toContain('PAIN_INCREASE');
    // Too little to compare with: only two earlier check-ins, or none inside the previous week.
    expect(rulesFor([], painHistory([2, 2, 6]))).not.toContain('PAIN_INCREASE');
    expect(rulesFor([], painHistory([2, 2, 2, null, null, null, null, null, null, null, 6]))).not.toContain(
      'PAIN_INCREASE',
    );
    // The latest score is itself four days old.
    expect(rulesFor([], painHistory([2, 2, 2, 6, null, null, null]))).not.toContain('PAIN_INCREASE');
  });
});

describe('recording a review', () => {
  it('moves the reviewed flags out of pending, turns the person GREEN, keeps them listed as still active, and reopens on request', () => {
    const store = new DemoStore(new MemoryStorage(), FIXED_NOW);
    const before = summaryOf(store.getState(), 'p-tomas');
    expect(before.level).toBe('RED');
    const noImprovement = flagFor(store.getState(), 'p-tomas', 'NO_IMPROVEMENT');
    const painIncrease = flagFor(store.getState(), 'p-tomas', 'PAIN_INCREASE');

    store.recordReview(before.pending, 'note', FIXED_NOW);

    const reviewed = summaryOf(store.getState(), 'p-tomas');
    expect(reviewed.level).toBe('GREEN');
    expect(reviewed.pending).toEqual([]);
    expect(reviewed.reviewedStillActive.map((flag) => flag.id).sort()).toEqual(
      [noImprovement.id, painIncrease.id].sort(),
    );
    for (const flag of reviewed.reviewedStillActive) {
      expect(flag).toMatchObject({ status: 'reviewed', note: 'note', reviewedAt: FIXED_NOW.toISOString() });
    }

    store.reopenFlag(noImprovement.id);

    const reopened = summaryOf(store.getState(), 'p-tomas');
    expect(reopened.pending.map((flag) => flag.id)).toEqual([noImprovement.id]);
    expect(reopened.pending[0].status).toBe('pending');
    // Only the review-soon flag was reopened; the same-day pain flag stays reviewed.
    expect(reopened.level).toBe('AMBER');
    expect(reopened.reviewedStillActive.map((flag) => flag.id)).toEqual([painIncrease.id]);
  });

  it('treats a flag raised by hand as AMBER until it is reviewed, and restores it when reopened', () => {
    const store = new DemoStore(new MemoryStorage(), FIXED_NOW);
    expect(summaryOf(store.getState(), 'p-maya').level).toBe('GREEN');

    store.flagForReview('p-maya', '  Ask about sleeve fit  ', FIXED_NOW);

    const raised = summaryOf(store.getState(), 'p-maya');
    expect(raised.level).toBe('AMBER');
    expect(raised.pending).toHaveLength(1);
    expect(raised.pending[0]).toMatchObject({ ruleId: 'CLINICIAN_FLAG', level: 'AMBER', raisedOn: TODAY });
    expect(raised.pending[0].evidence).toContain('Ask about sleeve fit');

    store.recordReview(raised.pending, undefined, FIXED_NOW);
    expect(summaryOf(store.getState(), 'p-maya').level).toBe('GREEN');

    store.reopenFlag(raised.pending[0].id);
    const reopened = summaryOf(store.getState(), 'p-maya');
    expect(reopened.level).toBe('AMBER');
    expect(reopened.pending.map((flag) => flag.id)).toEqual([raised.pending[0].id]);
  });
});
