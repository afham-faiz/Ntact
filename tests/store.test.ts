import { describe, expect, it, vi } from 'vitest';
import { createSeedState } from '../src/demo/seed';
import { DemoStore, STORAGE_KEY, seedAgeDays, type StorageLike } from '../src/demo/store';
import { dateKeyOf } from '../src/domain/dates';
import { RTP_BY_LEVEL, levelAtElapsed } from '../src/domain/firmware';
import { buildDaySeries, testsForPatient } from '../src/domain/selectors';
import { triageSummaries } from '../src/domain/triage';
import type { TriageLevel, TriageRuleId, TrialOutcome } from '../src/domain/types';
import { FIXED_DATE_KEY as TODAY, FIXED_NOW, MemoryStorage, daysFromToday } from './helpers';

const freshStore = (storage: StorageLike | null = new MemoryStorage()): DemoStore => new DemoStore(storage, FIXED_NOW);

/** Level and pending rule ids for one person, as the worklist would show them on the fixed date. */
function triageOf(store: DemoStore, patientId: string): { level: TriageLevel; rules: TriageRuleId[] } {
  const summary = triageSummaries(store.getState(), TODAY).get(patientId);
  if (!summary) throw new Error(`No triage summary for ${patientId}`);
  return { level: summary.level, rules: summary.pending.map((flag) => flag.ruleId) };
}

describe('seed', () => {
  it('is deterministic: the same date always produces the same state', () => {
    expect(createSeedState(TODAY)).toEqual(createSeedState(TODAY));
  });

  it('gives every FELT record a level from 1 to 10 with that level’s RTP drive, and every other record nulls', () => {
    const { tests } = createSeedState(TODAY);
    expect(new Set(tests.map((test) => test.outcome))).toEqual(new Set(['FELT', 'NO_FELT', 'STOPPED']));

    for (const test of tests) {
      expect(test.simulated, test.id).toBe(true);
      if (test.outcome === 'FELT') {
        expect(Number.isInteger(test.detectedLevel), test.id).toBe(true);
        expect(test.detectedLevel, test.id).toBeGreaterThanOrEqual(1);
        expect(test.detectedLevel, test.id).toBeLessThanOrEqual(10);
        expect(test.commandedRtp, test.id).toBe(RTP_BY_LEVEL[test.detectedLevel]);
        // The recorded time falls inside the level that was reported.
        expect(levelAtElapsed(test.elapsedMs), test.id).toBe(test.detectedLevel);
      } else {
        expect(test.detectedLevel, test.id).toBeNull();
        expect(test.commandedRtp, test.id).toBeNull();
        expect(test.elapsedMs, test.id).toBeNull();
      }
    }
  });

  it('ends yesterday so that today starts open, and never predates a person’s enrolment', () => {
    const state = createSeedState(TODAY);
    const enrolled = new Map(state.patients.map((patient) => [patient.id, patient.enrolledDate]));

    const recordDays = [
      ...state.tests.map((test) => ({ patientId: test.patientId, day: dateKeyOf(test.timestamp) })),
      ...state.checkIns.map((entry) => ({ patientId: entry.patientId, day: entry.date })),
    ];

    expect(recordDays.length).toBeGreaterThan(0);
    for (const { patientId, day } of recordDays) {
      expect(day < TODAY, `${patientId} ${day}`).toBe(true);
      expect(day >= (enrolled.get(patientId) ?? ''), `${patientId} ${day}`).toBe(true);
    }
    expect(recordDays.some(({ day }) => day === daysFromToday(-1))).toBe(true);
    expect(state.patients.every((patient) => patient.fictional)).toBe(true);
  });

  it('keeps at most one check-in per person per day, and unique record ids', () => {
    const state = createSeedState(TODAY);

    const checkInKeys = state.checkIns.map((entry) => `${entry.patientId} ${entry.date}`);
    expect(new Set(checkInKeys).size).toBe(checkInKeys.length);
    const ids = [...state.tests, ...state.checkIns].map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('persistence', () => {
  it('round-trips through storage: a second store on the same storage sees a recorded trial', () => {
    const storage = new MemoryStorage();
    const first = freshStore(storage);
    const recorded = first.recordTrial(
      'p-maya',
      { outcome: 'FELT', level: 4, drive: 35, elapsedMs: 11_400 },
      'mock-timed',
      FIXED_NOW,
    );

    // Opened a day later: what is stored wins over a fresh seed.
    const second = new DemoStore(storage, new Date(2026, 10, 13, 9, 0, 0));

    expect(second.getState().tests).toContainEqual(recorded);
    expect(second.getState()).toEqual(first.getState());
    expect(second.getState().anchorDate).toBe(TODAY);
  });

  it('picks up another tab’s write through syncFromStorage and tells its subscribers', () => {
    const storage = new MemoryStorage();
    const thisTab = freshStore(storage);
    const otherTab = freshStore(storage);
    const listener = vi.fn();
    thisTab.subscribe(listener);

    const recorded = otherTab.recordTrial('p-maya', { outcome: 'NO_FELT' }, 'mock-timed', FIXED_NOW);
    expect(thisTab.getState().tests).not.toContainEqual(recorded);
    thisTab.syncFromStorage();

    expect(thisTab.getState().tests).toContainEqual(recorded);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each<[string, (seedJson: string) => string]>([
    ['the wrong version', (seedJson) => JSON.stringify({ ...JSON.parse(seedJson), version: 1, tests: [] })],
    ['an incomplete shape', () => JSON.stringify({ version: 2, anchorDate: '2026-01-01' })],
    ['unreadable JSON', () => '{"version":2,'],
  ])('discards a stored state with %s and seeds again', (_label, corrupt) => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, corrupt(JSON.stringify(createSeedState('2026-01-01'))));

    const store = freshStore(storage);

    expect(store.getState()).toEqual(createSeedState(TODAY));
    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')).toEqual(createSeedState(TODAY));
  });

  it('keeps working in memory when storage is missing or refuses to write', () => {
    const refusing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };

    for (const storage of [null, refusing]) {
      const store = freshStore(storage);
      const recorded = store.recordTrial('p-maya', { outcome: 'NO_FELT' }, 'mock-timed', FIXED_NOW);

      expect(store.getState().tests).toContainEqual(recorded);
    }
  });

  it('notifies subscribers once per change and not at all when nothing changed', () => {
    const store = freshStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setDevice({ ...store.getState().device });
    store.setActivePatient('p-nobody');
    expect(listener).not.toHaveBeenCalled();

    store.setDevice({ linkUp: false, mode: 'IDLE' });
    store.setActivePatient('p-noor');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getState().activePatientId).toBe('p-noor');

    unsubscribe();
    store.setActivePatient('p-maya');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('reports how far the seeded story has drifted from today, never as a negative number', () => {
    const state = createSeedState(TODAY);

    expect(seedAgeDays(state, FIXED_NOW)).toBe(0);
    expect(seedAgeDays(state, new Date(2026, 10, 15, 8, 0, 0))).toBe(3);
    expect(seedAgeDays(state, new Date(2026, 10, 10, 8, 0, 0))).toBe(0);
  });
});

describe('recording trials', () => {
  it('stores a FELT exactly as the device reported it, flagged as simulated', () => {
    const store = freshStore();

    const test = store.recordTrial(
      'p-maya',
      { outcome: 'FELT', level: 3, drive: 24, elapsedMs: 8_500 },
      'mock-timed',
      FIXED_NOW,
    );

    expect(test).toMatchObject({
      patientId: 'p-maya',
      outcome: 'FELT',
      detectedLevel: 3,
      commandedRtp: 24,
      elapsedMs: 8_500,
      simulated: true,
      source: 'mock-timed',
      timestamp: FIXED_NOW.toISOString(),
    });
    expect(store.getState().tests.at(-1)).toEqual(test);
  });

  it.each<[string, TrialOutcome]>([
    ['NO_FELT', { outcome: 'NO_FELT' }],
    ['STOPPED by the person', { outcome: 'STOPPED', stopReason: 'USER_STOP' }],
    ['STOPPED for an early response', { outcome: 'STOPPED', stopReason: 'EARLY_RESPONSE' }],
  ])('stores nulls, never a number, for %s', (_label, outcome) => {
    const store = freshStore();

    const test = store.recordTrial('p-maya', outcome, 'mock-timed', FIXED_NOW);

    // The outcome, and the reason for a cancelled test, are kept exactly as given.
    expect(test).toMatchObject(outcome);
    expect(test.detectedLevel).toBeNull();
    expect(test.commandedRtp).toBeNull();
    expect(test.elapsedMs).toBeNull();
    expect(Object.values(test).filter((value) => typeof value === 'number')).toEqual([]);
    expect(store.getState().tests.at(-1)).toEqual(test);

    // On a chart the day is a not-felt or cancelled day with no step at all.
    const [today] = buildDaySeries(testsForPatient(store.getState().tests, 'p-maya'), TODAY, 1);
    expect(today.kind).toBe(outcome.outcome);
    expect(today.step).toBeNull();
  });

  it('caps the device log so it cannot grow without bound', () => {
    const store = freshStore();

    for (let index = 0; index < 75; index += 1) {
      store.logDevice({ at: FIXED_NOW.toISOString(), direction: 'app', text: `STATUS ${index}` });
    }

    const { deviceLog } = store.getState();
    expect(deviceLog).toHaveLength(60);
    expect(deviceLog[deviceLog.length - 1].text).toBe('STATUS 74');
    expect(deviceLog[0].text).toBe('STATUS 15');
  });
});

describe('check-ins', () => {
  const todaysCheckIns = (store: DemoStore, patientId: string) =>
    store.getState().checkIns.filter((entry) => entry.patientId === patientId && entry.date === TODAY);

  it('keeps one record per person per day: saving again keeps the id and replaces the answers', () => {
    const store = freshStore();
    const before = store.getState().checkIns.length;

    const first = store.saveCheckIn('p-maya', TODAY, { pain: 3, skin: false, cold: 'mild' }, FIXED_NOW);
    const later = new Date(2026, 10, 12, 21, 30, 0);
    const second = store.saveCheckIn('p-maya', TODAY, { pain: 6, skin: false, cold: 'severe' }, later);

    expect(second.id).toBe(first.id);
    expect(todaysCheckIns(store, 'p-maya')).toEqual([second]);
    expect(second.answers).toEqual({ pain: 6, skin: false, cold: 'severe' });
    expect(second.updatedAt).toBe(later.toISOString());
    expect(store.getState().checkIns).toHaveLength(before + 1);
  });

  it('keeps each person’s check-in for the same day separate', () => {
    const store = freshStore();

    const maya = store.saveCheckIn('p-maya', TODAY, { pain: 2, skin: false, cold: 'none' }, FIXED_NOW);
    const noor = store.saveCheckIn('p-noor', TODAY, { pain: 7, skin: false, cold: 'mild' }, FIXED_NOW);

    expect(noor.id).not.toBe(maya.id);
    expect(todaysCheckIns(store, 'p-maya')).toEqual([maya]);
    expect(todaysCheckIns(store, 'p-noor')).toEqual([noor]);
  });

  it('trims text, and drops the skin note once the skin answer is no longer yes', () => {
    const store = freshStore();

    const withIssue = store.saveCheckIn(
      'p-maya',
      TODAY,
      { pain: 4, skin: true, skinNote: '  Red patch under the sleeve  ', cold: 'mild', note: '  Slept badly.  ' },
      FIXED_NOW,
    );
    expect(withIssue.answers).toEqual({
      pain: 4,
      skin: true,
      skinNote: 'Red patch under the sleeve',
      cold: 'mild',
      note: 'Slept badly.',
    });

    const corrected = store.saveCheckIn(
      'p-maya',
      TODAY,
      { pain: 4, skin: false, skinNote: 'Red patch under the sleeve', cold: 'mild', note: '   ' },
      FIXED_NOW,
    );
    expect(corrected.answers).toEqual({ pain: 4, skin: false, cold: 'mild' });
    expect(todaysCheckIns(store, 'p-maya')).toEqual([corrected]);
  });
});

describe('demo controls', () => {
  it('starts from Maya with no review trigger, so each control below is what raises the flag', () => {
    expect(triageOf(freshStore(), 'p-maya')).toEqual({ level: 'GREEN', rules: [] });
  });

  it('applyHistoryPreset plateau raises NO_IMPROVEMENT, which is a review-soon flag and not a same-day one', () => {
    const store = freshStore();

    store.applyHistoryPreset('p-maya', 'plateau', FIXED_NOW);

    const triage = triageOf(store, 'p-maya');
    expect(triage.level).toBe('AMBER');
    expect(triage.rules).toContain('NO_IMPROVEMENT');
    // Only this person's history was replaced.
    expect(testsForPatient(store.getState().tests, 'p-noor')).toEqual(
      testsForPatient(createSeedState(TODAY).tests, 'p-noor'),
    );
  });

  it('applyHistoryPreset improving clears a NO_IMPROVEMENT flag and leaves check-in flags alone', () => {
    const store = freshStore();
    // Pain is the same-day flag, so it is listed first.
    expect(triageOf(store, 'p-tomas')).toEqual({ level: 'RED', rules: ['PAIN_INCREASE', 'NO_IMPROVEMENT'] });

    store.applyHistoryPreset('p-tomas', 'improving', FIXED_NOW);

    expect(triageOf(store, 'p-tomas')).toEqual({ level: 'RED', rules: ['PAIN_INCREASE'] });
  });

  it('simulateMissedTests for 3 days raises MISSED_TESTS', () => {
    const store = freshStore();

    store.simulateMissedTests('p-maya', 3, FIXED_NOW);

    expect(triageOf(store, 'p-maya')).toEqual({ level: 'AMBER', rules: ['MISSED_TESTS'] });
    const remaining = testsForPatient(store.getState().tests, 'p-maya');
    expect(remaining.every((test) => dateKeyOf(test.timestamp) < daysFromToday(-3))).toBe(true);
  });

  it('simulateRisingReadings raises THRESHOLD_RISE', () => {
    const store = freshStore();

    store.simulateRisingReadings('p-maya', FIXED_NOW);

    expect(triageOf(store, 'p-maya')).toEqual({ level: 'AMBER', rules: ['THRESHOLD_RISE'] });
  });

  it('simulateCheckInTrigger skin raises SKIN_ISSUE for same-day review', () => {
    const store = freshStore();

    store.simulateCheckInTrigger('p-maya', 'skin', FIXED_NOW);

    expect(triageOf(store, 'p-maya')).toEqual({ level: 'RED', rules: ['SKIN_ISSUE'] });
  });

  it('simulateCheckInTrigger pain raises PAIN_INCREASE for same-day review', () => {
    const store = freshStore();

    store.simulateCheckInTrigger('p-maya', 'pain', FIXED_NOW);

    expect(triageOf(store, 'p-maya')).toEqual({ level: 'RED', rules: ['PAIN_INCREASE'] });
  });

  it('simulateMissedExercises for 3 days raises MISSED_EXERCISES', () => {
    const store = freshStore();

    store.simulateMissedExercises('p-maya', 3, FIXED_NOW);

    expect(triageOf(store, 'p-maya')).toEqual({ level: 'AMBER', rules: ['MISSED_EXERCISES'] });
  });

  it('simulateMovementDecline raises MOVEMENT_DECLINE with demonstration data only', () => {
    const store = freshStore();

    store.simulateMovementDecline('p-maya', FIXED_NOW);

    expect(triageOf(store, 'p-maya')).toEqual({ level: 'AMBER', rules: ['MOVEMENT_DECLINE'] });
    expect(store.getState().exerciseSessions.every((session) => session.simulated)).toBe(true);
  });

  it('the seeded exercise history raises no flag by itself', () => {
    const store = freshStore();
    const flags = [...triageSummaries(store.getState(), TODAY).values()].flatMap((summary) =>
      summary.pending.map((flag) => flag.ruleId),
    );
    expect(flags).not.toContain('MISSED_EXERCISES');
    expect(flags).not.toContain('MOVEMENT_DECLINE');
    expect(store.getState().exerciseSessions.length).toBeGreaterThan(100);
  });

  it('reset() returns to the seed, and the judge-demo preset scripts the next result as step 4', () => {
    const store = freshStore();
    store.applyHistoryPreset('p-maya', 'plateau', FIXED_NOW);
    store.simulateCheckInTrigger('p-noor', 'skin', FIXED_NOW);
    store.setScenario({ speed: 6, driverFault: true });
    store.setDevice({ linkUp: false, mode: 'IDLE' });
    const listener = vi.fn();
    store.subscribe(listener);

    store.reset('default', FIXED_NOW);

    expect(store.getState()).toEqual(createSeedState(TODAY));
    expect(listener).toHaveBeenCalledTimes(1);

    store.reset('judge-demo', FIXED_NOW);

    expect(store.getState().scenario).toEqual({
      result: { kind: 'scripted', level: 4 },
      speed: 1,
      dropLinkOnNextTest: false,
      driverFault: false,
    });
    expect(store.getState().tests).toEqual(createSeedState(TODAY).tests);
  });

  // SUSPECTED BUG (src/demo/store.ts, simulateRisingReadings): the two new readings are
  // min(9, base + 2) and min(10, first + 1). When the person's last felt step before the
  // two-day window is already 9 or 10 (Aiko and Elin in the seed) that gives 9 then 10 after
  // a 9, which is not "rose on two consecutive readings", so no THRESHOLD_RISE flag appears.
  // For Aiko it also overwrites yesterday's not-felt test, so she goes from AMBER to GREEN.
  // Expected: the control always produces readings that meet the rule it is named after.
  it('fixed: simulateRisingReadings raises THRESHOLD_RISE for someone already at level 9', () => {
    for (const patientId of ['p-aiko', 'p-elin']) {
      const store = freshStore();

      store.simulateRisingReadings(patientId, FIXED_NOW);

      expect(triageOf(store, patientId).rules, patientId).toContain('THRESHOLD_RISE');
    }
  });

  // SUSPECTED BUG (src/demo/store.ts, simulateCheckInTrigger 'pain'): the control takes its
  // baseline from the last seven check-ins on record, but the PAIN_INCREASE rule needs at
  // least `minBaselineEntries` check-ins inside the previous seven DAYS. Priya has only two
  // in that week, so the entry is saved and no flag is raised.
  // Expected: the control produces a check-in history that meets the rule.
  it('fixed: simulateCheckInTrigger pain raises PAIN_INCREASE for someone with lapsed check-ins', () => {
    const store = freshStore();

    store.simulateCheckInTrigger('p-priya', 'pain', FIXED_NOW);

    expect(triageOf(store, 'p-priya').rules).toContain('PAIN_INCREASE');
  });
});
