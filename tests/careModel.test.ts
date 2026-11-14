/**
 * The care model added around the measurements: routing, same-day flags, the
 * weekly questions, exercise records, and the two decisions kept for clinicians.
 */
import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/demo/seed';
import { DemoStore, STORAGE_KEY } from '../src/demo/store';
import { weeklyDue, weeklyForPatient } from '../src/domain/checkIn';
import { DEFAULT_UNLOCKED, EXERCISES, EXERCISE_ORDER, physioToday, summariseReps, unlockedExercises } from '../src/domain/exercise';
import {
  DEFAULT_TRIAGE_CONFIG,
  ROUTE_LABEL,
  RULE_LABEL,
  RULE_ROUTE,
  ruleFlags,
  routesOf,
  triageSummaries,
} from '../src/domain/triage';
import type { DemoState, TriageRuleId } from '../src/domain/types';
import { exerciseSourceLabel } from '../src/features/clinician/MovementPanel';
import { FIXED_DATE_KEY as TODAY, FIXED_NOW, MemoryStorage, checkInOn, daysFromToday, makePatient } from './helpers';

const freshStore = () => new DemoStore(new MemoryStorage(), FIXED_NOW);
const pendingRules = (state: DemoState, patientId: string): TriageRuleId[] =>
  triageSummaries(state, TODAY).get(patientId)?.pending.map((flag) => flag.ruleId) ?? [];

describe('routing', () => {
  it('sends every rule somewhere, and names every destination', () => {
    for (const ruleId of Object.keys(RULE_LABEL) as TriageRuleId[]) {
      expect(ROUTE_LABEL[RULE_ROUTE[ruleId]], ruleId).toBeTruthy();
    }
  });

  it('sends sensation to the surgical team, movement and adherence to hand therapy, skin and pain to same-day review', () => {
    expect(RULE_ROUTE.NO_IMPROVEMENT).toBe('surgeon');
    expect(RULE_ROUTE.THRESHOLD_RISE).toBe('surgeon');
    expect(RULE_ROUTE.NO_FELT_RECENT).toBe('surgeon');
    expect(RULE_ROUTE.MISSED_TESTS).toBe('therapist');
    expect(RULE_ROUTE.MISSED_EXERCISES).toBe('therapist');
    expect(RULE_ROUTE.MOVEMENT_DECLINE).toBe('therapist');
    expect(RULE_ROUTE.SKIN_ISSUE).toBe('same-day');
    expect(RULE_ROUTE.PAIN_INCREASE).toBe('same-day');
  });

  it('lists a patient’s destinations once each, most urgent first', () => {
    const tomas = triageSummaries(createSeedState(TODAY), TODAY).get('p-tomas');
    expect(routesOf(tomas?.pending ?? [])).toEqual(['same-day', 'surgeon']);
    expect(routesOf([])).toEqual([]);
  });
});

describe('same-day pain', () => {
  const patient = makePatient();
  // The test patient has no sensation tests, which raises its own flag; only the pain rule is of interest here.
  const rules = (pain: number) =>
    ruleFlags(patient, [], [checkInOn(TODAY, { pain, skin: false, cold: 'none' })], TODAY, DEFAULT_TRIAGE_CONFIG).filter(
      (flag) => flag.ruleId === 'PAIN_INCREASE',
    );

  it('flags severe pain on its own, with no earlier check-ins to compare against', () => {
    const flags = rules(DEFAULT_TRIAGE_CONFIG.painIncrease.severeAt);
    expect(flags.map((flag) => [flag.ruleId, flag.level])).toEqual([['PAIN_INCREASE', 'RED']]);
    expect(flags[0].evidence).toContain('Too few earlier check-ins');
  });

  it('does not flag a pain score just under the severe line', () => {
    expect(rules(DEFAULT_TRIAGE_CONFIG.painIncrease.severeAt - 1)).toEqual([]);
  });
});

describe('exercise records', () => {
  const result = summariseReps([{ flexDeg: 150, extDeg: 30 }], 10, 12_000);
  const site = { hand: 'right', finger: 'index' } as const;

  it('marks only a camera session as a real observation', () => {
    const store = freshStore();
    const camera = store.recordExercise('p-maya', 'open-close', result, 'camera', site, FIXED_NOW);
    const demo = store.recordExercise('p-maya', 'open-close', result, 'demo-motion', site, FIXED_NOW);

    expect(camera).toMatchObject({ simulated: false, source: 'camera', reps: 1, rangeDeg: 120, site });
    expect(demo.simulated).toBe(true);
    expect(exerciseSourceLabel(camera)).toBe('Camera');
    expect(exerciseSourceLabel(demo)).toBe('Demonstration');
    for (const seeded of createSeedState(TODAY).exerciseSessions) {
      expect(seeded.simulated, seeded.id).toBe(true);
      expect(exerciseSourceLabel(seeded)).toBe('Demonstration');
    }
  });

  it('a session today clears a missed-exercise flag', () => {
    const store = freshStore();
    store.simulateMissedExercises('p-maya', 3, FIXED_NOW);
    expect(pendingRules(store.getState(), 'p-maya')).toEqual(['MISSED_EXERCISES']);

    // Yesterday is what the rule counts back from, so a session then ends the run of missed days.
    const yesterday = new Date(FIXED_NOW.getTime() - 24 * 60 * 60 * 1000);
    store.recordExercise('p-maya', 'open-close', result, 'camera', site, yesterday);

    expect(pendingRules(store.getState(), 'p-maya')).toEqual([]);
  });

  it('never flags someone who has no session on record at all', () => {
    const state = createSeedState(TODAY);
    state.exerciseSessions = [];
    for (const summary of triageSummaries(state, TODAY).values()) {
      expect(summary.pending.map((flag) => flag.ruleId)).not.toContain('MISSED_EXERCISES');
    }
  });
});

describe('decisions kept for the clinician', () => {
  it('gives every patient the two phase 1 exercises, and keeps the putty squeeze locked, until a clinician changes the plan', () => {
    const store = freshStore();
    expect(EXERCISE_ORDER).toEqual(['finger-slides', 'open-close', 'putty-squeeze']);
    expect(DEFAULT_UNLOCKED).toEqual(['finger-slides', 'open-close']);
    expect(EXERCISES['putty-squeeze']).toMatchObject({ phase: 2, unlockedByDefault: false });
    expect(unlockedExercises(store.getState().exercisePlans, 'p-maya')).toEqual(['finger-slides', 'open-close']);

    // The clinician unlocks the later-stage exercise for one patient.
    store.setExercisePlan('p-maya', ['putty-squeeze', 'finger-slides', 'open-close']);
    expect(unlockedExercises(store.getState().exercisePlans, 'p-maya')).toEqual(['finger-slides', 'open-close', 'putty-squeeze']);
    // Nobody else's plan moved.
    expect(unlockedExercises(store.getState().exercisePlans, 'p-noor')).toEqual(['finger-slides', 'open-close']);

    store.setExercisePlan('p-maya', []);
    expect(unlockedExercises(store.getState().exercisePlans, 'p-maya')).toEqual([]);
  });

  it('counts the day’s physio as done only when every unlocked exercise has been done', () => {
    const store = freshStore();
    const result = summariseReps([{ flexDeg: 150, extDeg: 30 }], 10, 12_000);
    const site = { hand: 'right', finger: 'index' } as const;
    const today = () => physioToday(store.getState().exerciseSessions, store.getState().exercisePlans, 'p-maya', TODAY);

    expect(today()).toMatchObject({ done: [], allDone: false });
    store.recordExercise('p-maya', 'open-close', result, 'camera', site, FIXED_NOW);
    expect(today()).toMatchObject({ done: ['open-close'], allDone: false });
    store.recordExercise('p-maya', 'finger-slides', result, 'camera', site, FIXED_NOW);
    expect(today()).toMatchObject({ done: ['finger-slides', 'open-close'], allDone: true });

    // Unlocking the third exercise makes the day incomplete again.
    store.setExercisePlan('p-maya', ['finger-slides', 'open-close', 'putty-squeeze']);
    expect(today().allDone).toBe(false);
  });

  it('puts nobody on patient-initiated follow-up until a clinician does, and it can be undone', () => {
    const store = freshStore();
    expect(store.getState().followUp).toEqual({});

    store.setFollowUp('p-noor', true, FIXED_NOW);
    expect(store.getState().followUp).toEqual({ 'p-noor': { since: TODAY } });
    // Follow-up does not switch the rules off.
    store.simulateCheckInTrigger('p-noor', 'skin', FIXED_NOW);
    expect(pendingRules(store.getState(), 'p-noor')).toContain('SKIN_ISSUE');

    store.setFollowUp('p-noor', false);
    expect(store.getState().followUp).toEqual({});
  });
});

describe('weekly questions', () => {
  it('saves one set per day, replacing an earlier answer the same day', () => {
    const store = freshStore();
    const before = weeklyForPatient(store.getState().weeklyCheckIns, 'p-maya').length;

    store.saveWeeklyCheckIn('p-maya', TODAY, { cold: 'mild', tingling: 'moderate', function: 4 }, FIXED_NOW);
    store.saveWeeklyCheckIn('p-maya', TODAY, { cold: 'none', tingling: 'mild', function: 12 }, FIXED_NOW);

    const mine = weeklyForPatient(store.getState().weeklyCheckIns, 'p-maya');
    expect(mine).toHaveLength(before + 1);
    expect(mine[mine.length - 1]).toMatchObject({ date: TODAY, cold: 'none', tingling: 'mild', function: 10 });
  });

  it('comes due a week after the last answers', () => {
    const entry = (date: string) => ({ id: date, patientId: 'p', date, cold: 'none', tingling: 'none', function: 0, updatedAt: '' }) as const;
    expect(weeklyDue([], TODAY)).toBe(true);
    expect(weeklyDue([entry(daysFromToday(-6))], TODAY)).toBe(false);
    expect(weeklyDue([entry(daysFromToday(-7))], TODAY)).toBe(true);
  });

  it('never touches the daily check-ins, so the daily rules are unaffected', () => {
    const store = freshStore();
    const daily = store.getState().checkIns;
    const flags = pendingRules(store.getState(), 'p-tomas');

    store.saveWeeklyCheckIn('p-tomas', TODAY, { cold: 'severe', tingling: 'severe', function: 10 }, FIXED_NOW);

    expect(store.getState().checkIns).toBe(daily);
    expect(pendingRules(store.getState(), 'p-tomas')).toEqual(flags);
  });
});

describe('data saved by an earlier build', () => {
  it('is kept, and given empty exercise, weekly and follow-up records plus the current rules', () => {
    const storage = new MemoryStorage();
    const old: Partial<DemoState> = createSeedState(TODAY);
    delete old.exerciseSessions;
    delete old.weeklyCheckIns;
    delete old.exercisePlans;
    delete old.followUp;
    const rules = old.triageConfig as unknown as Record<string, unknown>;
    delete rules.missedExercises;
    delete rules.movementDecline;
    const tests = old.tests?.length;
    storage.setItem(STORAGE_KEY, JSON.stringify(old));

    const state = new DemoStore(storage, FIXED_NOW).getState();

    expect(state.tests).toHaveLength(tests as number);
    expect(state.exerciseSessions).toEqual([]);
    expect(state.weeklyCheckIns).toEqual([]);
    expect(state.exercisePlans).toEqual({});
    expect(state.followUp).toEqual({});
    expect(state.triageConfig).toEqual(DEFAULT_TRIAGE_CONFIG);
    // And the worklist still computes.
    expect(triageSummaries(state, TODAY).size).toBe(state.patients.length);
  });
});
