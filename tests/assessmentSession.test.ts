/**
 * Sessions: the summary, what counts as comparable, repeatability and agreement
 * statistics, the labelled synthetic replays, the illustrative seed, and storage.
 */
import { describe, expect, it } from 'vitest';
import { ASSESSMENT_ORDER, DEFAULT_PROTOCOL, DEFINITIONS, protocolFor, recommendedView, resolveAssessment, resolveParams, viewAdvice } from '../src/assessment/definitions';
import {
  TRACKING_DEFAULTS,
  agreement,
  betweenSessions,
  buildSession,
  comparability,
  previousOf,
  qualityConcerns,
  referencePairs,
  replay,
  sessionsOf,
  spreadOf,
  summariseSession,
  withinSession,
} from '../src/assessment/session';
import type { AssessmentSession, RepRecord } from '../src/assessment/types';
import { makeSeedAssessment, seedAssessmentSessions } from '../src/demo/assessmentSeed';
import { createSeedState } from '../src/demo/seed';
import { DemoStore } from '../src/demo/store';
import { syntheticFreeTracking, syntheticRecordingFor } from '../src/features/movement/syntheticDemo';
import { yawForView } from '../src/tracking/handModel';
import { repetitionKeys, synthesise } from '../src/tracking/recording';
import { FIXED_DATE_KEY, FIXED_NOW, MemoryStorage, daysFromToday } from './helpers';

const patient = { id: 'p-test', hand: 'right', finger: 'index' } as const;

function sessionFrom(reps: RepRecord[], overrides: Partial<Parameters<typeof buildSession>[0]> = {}): AssessmentSession {
  return buildSession({
    id: 'session-1',
    patientId: patient.id,
    timestamp: '2026-11-12T10:00:00.000Z',
    hand: 'right',
    detectedHand: 'right',
    setup: resolveAssessment('composite-fist', 'index'),
    reps,
    durationMs: 21_000,
    quality: { frames: 630, tracked: 0.98, usable: 0.9, jumps: 0, reasons: {} },
    view: 'palmar',
    capture: { setup: 'laptop', facing: 'user', width: 1280, height: 720, fps: 30, inferenceMs: 12 },
    tracking: { ...TRACKING_DEFAULTS, delegate: 'GPU', labelConvention: 'subject' },
    source: 'camera',
    ...overrides,
  });
}

function recordedFist(reps = 3, amount: number | number[] = 1) {
  const setup = resolveAssessment('composite-fist', 'index');
  const recording = synthesise(repetitionKeys({ side: 'right', from: 'open', to: 'fist', reps, amount }), { camera: { yaw: yawForView('palmar', 'right') } });
  return replay(recording, setup).reps;
}

describe('session summary', () => {
  it('reports medians across valid repetitions, joint by joint', () => {
    const reps = recordedFist(3, [1, 0.9, 0.8]);
    const summary = summariseSession(reps, resolveAssessment('composite-fist', 'index'), 'palmar');
    expect(summary.validReps).toBe(3);
    expect(summary.rejectedReps).toBe(0);
    expect(summary.completed).toBe(true);
    // 85/100/60 at 100%, 90% and 80%: the middle one is the median.
    expect(summary.joints.index?.mcp?.flex).toBeCloseTo(76.5, 0);
    expect(summary.joints.index?.pip?.flex).toBeCloseTo(90, 0);
    expect(summary.joints.index?.dip?.flex).toBeCloseTo(54, 0);
    expect(summary.joints.index?.pip?.ext).toBeCloseTo(0, 0);
    expect(summary.joints.index?.pip?.arc).toBeCloseTo(90, 0);
    expect(summary.joints.index?.pip?.n).toBe(3);
    expect(summary.joints.index?.pip?.grade).toBe('inferred');
    expect(summary.primary.median).toBeCloseTo(220.5, 0);
    expect(summary.primary.min as number).toBeLessThan(summary.primary.max as number);
    expect(summary.holdMs.median as number).toBeGreaterThanOrEqual(2000);
  });

  it('never averages a rejected repetition into the figures', () => {
    const valid = recordedFist(1);
    const rejected: RepRecord = { ...valid[0], attempt: 2, valid: false, rejectReason: 'unsteady', primary: 999 };
    const summary = summariseSession([...valid, rejected], resolveAssessment('composite-fist', 'index', { params: { reps: 2 } }), 'palmar');
    expect(summary.validReps).toBe(1);
    expect(summary.rejectedReps).toBe(1);
    expect(summary.completed).toBe(false);
    expect(summary.primary.median).toBeCloseTo(valid[0].primary as number, 1);
    expect(summary.primary.sd).toBeNull();
  });

  it('reports nothing, rather than zero, when no repetition was valid', () => {
    const summary = summariseSession([], resolveAssessment('composite-fist', 'index'), null);
    expect(summary.primary.median).toBeNull();
    expect(summary.holdMs.median).toBeNull();
    expect(summary.joints).toEqual({});
    expect(summary.completed).toBe(false);
  });

  it('keeps what is needed to reproduce and compare a session', () => {
    const session = sessionFrom(recordedFist());
    expect(session.synthetic).toBe(false);
    expect(session.definitionVersion).toBe(DEFINITIONS['composite-fist'].version);
    expect(session.params.fistAbove).toBe(120);
    expect(session.minGrade).toBe('inferred');
    expect(session.tracking.model).toMatch(/MediaPipe/);
    expect(session.tracking.engine).toMatch(/^\d+\.\d+\.\d+$/);
    expect(session.capture).toMatchObject({ setup: 'laptop', width: 1280, height: 720, fps: 30 });
    expect(session.digits).toEqual(['index', 'middle', 'ring', 'little']);
    expect(session.focus).toBe('index');
    expect(session.references).toEqual([]);
  });

  it('marks everything that did not come from a camera as synthetic', () => {
    expect(sessionFrom([], { source: 'camera' }).synthetic).toBe(false);
    expect(sessionFrom([], { source: 'synthetic-replay' }).synthetic).toBe(true);
    expect(sessionFrom([], { source: 'seed' }).synthetic).toBe(true);
  });
});

describe('comparing sessions', () => {
  const base = sessionFrom(recordedFist());

  it('treats two like-for-like sessions as comparable', () => {
    expect(comparability(base, { ...base, id: 'other' })).toEqual({ comparable: true, differences: [] });
  });

  it('says why two sessions should not be put on one line', () => {
    const other: AssessmentSession = {
      ...base,
      hand: 'left',
      focus: 'ring',
      source: 'seed',
      synthetic: true,
      summary: { ...base.summary, view: 'radial' },
      tracking: { ...base.tracking, engine: '2.0.0' },
    };
    const result = comparability(base, other);
    expect(result.comparable).toBe(false);
    expect(result.differences).toEqual(['different hand', 'different finger', 'different camera view', 'different tracking engine', 'different kind of data']);
    expect(comparability(base, { ...base, assessmentId: 'hook-fist' }).differences).toContain('different assessment');
    expect(comparability(base, { ...base, definitionVersion: 99 }).differences).toContain('different version of the assessment');
  });

  it('raises quality concerns in plain words', () => {
    expect(qualityConcerns(base)).toEqual([]);
    const poor = sessionFrom(recordedFist(1), { quality: { frames: 300, tracked: 0.7, usable: 0.41, jumps: 6, reasons: { clipped: 120 } }, capture: { ...base.capture, fps: 9 } });
    const concerns = qualityConcerns(poor);
    expect(concerns).toContain('Tracking was usable for 41% of the session');
    expect(concerns).toContain('Based on a single repetition');
    expect(concerns).toContain('Low frame rate (9 per second)');
    expect(qualityConcerns(sessionFrom([]))).toContain('No valid repetition was recorded');
  });

  it('never compares a camera session with a synthetic replay or with illustrative data', () => {
    const replayed: AssessmentSession = { ...base, id: 'replayed', source: 'synthetic-replay', synthetic: true };
    const seeded: AssessmentSession = { ...base, id: 'seeded', source: 'seed', synthetic: true };
    expect(comparability(base, replayed).comparable).toBe(false);
    expect(comparability(base, seeded).comparable).toBe(false);
    expect(comparability(replayed, seeded).comparable).toBe(false);
  });

  it('finds the previous session of the same assessment and the same kind of data', () => {
    const older = { ...base, id: 'older', timestamp: '2026-11-08T10:00:00.000Z' };
    const seeded: AssessmentSession = { ...base, id: 'seeded', timestamp: '2026-11-11T10:00:00.000Z', source: 'seed', synthetic: true };
    const other = { ...base, id: 'other', timestamp: '2026-11-11T12:00:00.000Z', assessmentId: 'tabletop' as const };
    const later = { ...base, id: 'later', timestamp: '2026-11-14T10:00:00.000Z' };
    expect(previousOf([older, seeded, other, later, base], base)?.id).toBe('older');
    expect(previousOf([seeded, base], base)).toBeNull();
  });

  it('lists one patient’s sessions of one assessment, oldest first', () => {
    const sessions = [
      { ...base, id: 'b', timestamp: '2026-11-10T10:00:00.000Z' },
      { ...base, id: 'a', timestamp: '2026-11-08T10:00:00.000Z' },
      { ...base, id: 'c', patientId: 'someone-else' },
      { ...base, id: 'd', assessmentId: 'hook-fist' as const },
    ];
    expect(sessionsOf(sessions, patient.id, 'composite-fist').map((session) => session.id)).toEqual(['a', 'b']);
    expect(sessionsOf(sessions, patient.id)).toHaveLength(3);
  });
});

describe('repeatability and agreement', () => {
  it('summarises a spread', () => {
    expect(spreadOf([])).toMatchObject({ n: 0, mean: null, sd: null });
    const spread = spreadOf([100, 110, 120]);
    expect(spread.mean).toBe(110);
    expect(spread.sd).toBeCloseTo(10, 6);
    expect(spread.cv).toBeCloseTo(10 / 110, 6);
    expect(spread.min).toBe(100);
    expect(spread.max).toBe(120);
    expect(spreadOf([5]).sd).toBeNull();
  });

  it('gives within-session repeatability from the valid repetitions only', () => {
    const reps = recordedFist(3, [1, 0.9, 0.8]);
    const session = sessionFrom([...reps, { ...reps[0], attempt: 9, valid: false, rejectReason: 'unsteady', primary: 5 }]);
    const spread = withinSession(session);
    expect(spread.n).toBe(3);
    expect(spread.sd as number).toBeGreaterThan(15);
    expect(spread.min as number).toBeGreaterThan(150);
  });

  it('gives between-session repeatability only across comparable sessions', () => {
    const a = sessionFrom(recordedFist(3));
    const b = { ...sessionFrom(recordedFist(3, 0.9)), id: 'b' };
    const sideways = { ...b, id: 'c', summary: { ...b.summary, view: 'radial' as const } };
    expect(betweenSessions([a, b]).n).toBe(2);
    expect(betweenSessions([a, sideways, b]).n).toBe(2);
    expect(betweenSessions([]).n).toBe(0);
  });

  it('computes bias and limits of agreement against reference readings', () => {
    expect(agreement([])).toMatchObject({ n: 0, bias: null });
    const single = agreement([{ estimate: 92, reference: 90 }]);
    expect(single.bias).toBe(2);
    expect(single.lower).toBeNull();
    const several = agreement([
      { estimate: 92, reference: 90 },
      { estimate: 88, reference: 90 },
      { estimate: 96, reference: 90 },
      { estimate: 84, reference: 90 },
    ]);
    expect(several.bias).toBeCloseTo(0, 9);
    expect(several.mae).toBeCloseTo(4, 9);
    expect(several.upper as number).toBeCloseTo(1.96 * Math.sqrt(80 / 3), 6);
    expect(several.lower as number).toBeCloseTo(-(several.upper as number), 9);
  });

  it('pairs a reference reading with the session’s estimate for the same joint', () => {
    const session = sessionFrom(recordedFist());
    const withReading: AssessmentSession = {
      ...session,
      references: [
        { id: 'r1', finger: 'index', joint: 'pip', kind: 'flex', deg: 96, instrument: 'Finger goniometer', enteredAt: '2026-11-12T10:05:00.000Z' },
        { id: 'r2', finger: 'index', joint: 'pip', kind: 'ext', deg: 4, instrument: 'Finger goniometer', enteredAt: '2026-11-12T10:05:00.000Z' },
        { id: 'r3', finger: 'thumb', joint: 'ip', kind: 'flex', deg: 60, instrument: 'Finger goniometer', enteredAt: '2026-11-12T10:05:00.000Z' },
      ],
    };
    const pairs = referencePairs([withReading]);
    // The thumb was not part of this assessment, so its reading has nothing to be paired with.
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({ finger: 'index', joint: 'pip', kind: 'flex', reference: 96 });
    expect(pairs[0].estimate).toBeCloseTo(100, 0);
    expect(pairs[1].estimate).toBeCloseTo(0, 0);
  });
});

describe('protocols', () => {
  it('offers the three core assessments until a clinician changes it', () => {
    expect(DEFAULT_PROTOCOL.enabled).toEqual(['composite-fist', 'hook-fist', 'tabletop']);
    expect(protocolFor(undefined, 'anyone')).toBe(DEFAULT_PROTOCOL);
    expect(protocolFor({ 'p-1': { enabled: ['tabletop', 'composite-fist'], overrides: {} } }, 'p-1').enabled).toEqual(['composite-fist', 'tabletop']);
  });

  it('keeps every clinician-set value inside its allowed range', () => {
    const definition = DEFINITIONS['composite-fist'];
    expect(resolveParams(definition).reps).toBe(3);
    const params = resolveParams(definition, { params: { reps: 99, holdSeconds: 0, fistAbove: 120, nonsense: 5 } });
    expect(params.reps).toBe(10);
    expect(params.holdSeconds).toBe(0.5);
    expect(params.fistAbove).toBe(120);
    expect(params.nonsense).toBeUndefined();
  });

  it('describes every assessment as a demonstration with configurable detection thresholds', () => {
    for (const id of ASSESSMENT_ORDER) {
      const definition = DEFINITIONS[id];
      expect(definition.steps.length, id).toBeGreaterThanOrEqual(3);
      expect(definition.views.acceptable, id).toContain(definition.views.facing);
      expect(definition.views.acceptable, id).toContain(definition.views.overhead);
      for (const criterion of [...definition.start, ...definition.target]) {
        expect(definition.params.some((spec) => spec.key === criterion.param), `${id} ${criterion.param}`).toBe(true);
      }
      for (const spec of definition.params) {
        expect(spec.default, `${id} ${spec.key}`).toBeGreaterThanOrEqual(spec.min);
        expect(spec.default, `${id} ${spec.key}`).toBeLessThanOrEqual(spec.max);
      }
      // Nothing in the wording claims a normal range or a target to reach.
      const words = JSON.stringify(definition).toLowerCase();
      expect(words, id).not.toMatch(/normal range|should reach|healthy/);
    }
  });

  it('recommends a view that can be held comfortably for the way the camera is being used', () => {
    // In front of a camera: palm-on, or the little-finger edge. Never the thumb side, which is awkward to turn to a camera in front of you.
    for (const id of ASSESSMENT_ORDER) {
      for (const finger of ['index', 'middle', 'ring', 'little'] as const) {
        for (const setup of ['laptop', 'phone-propped', 'phone-assisted'] as const) {
          expect(recommendedView(DEFINITIONS[id], finger, setup), `${id} ${finger} ${setup}`).not.toBe('radial');
        }
      }
    }
    expect(recommendedView(DEFINITIONS['hook-fist'], 'index')).toBe('palmar');
    expect(recommendedView(DEFINITIONS.tabletop, 'index')).toBe('ulnar');
    expect(recommendedView(DEFINITIONS['composite-fist'], 'ring')).toBe('palmar');
    expect(recommendedView(DEFINITIONS['digit-flexion'], 'little')).toBe('ulnar');
    // With the hand resting on a table under a phone, the thumb side is the one that faces up.
    expect(recommendedView(DEFINITIONS.tabletop, 'index', 'phone-held')).toBe('radial');
    expect(viewAdvice(DEFINITIONS.tabletop, 'index', 'phone-held')).toBe('Turn your hand side-on, thumb side towards the camera');
    expect(viewAdvice(DEFINITIONS['hook-fist'], 'index', 'laptop')).toBe('Turn your palm towards the camera');
  });
});

describe('synthetic replays', () => {
  it('complete every assessment for either hand, with one attempt rejected for a short hold', () => {
    for (const id of ASSESSMENT_ORDER) {
      for (const hand of ['left', 'right'] as const) {
        for (const finger of ['index', 'little'] as const) {
          const setup = resolveAssessment(id, finger);
          const recording = syntheticRecordingFor(setup, hand);
          expect(recording.origin).toBe('synthetic');
          const result = replay(recording, setup, { hand });
          const label = `${id} ${hand} ${finger}`;
          expect(result.reps.filter((rep) => rep.valid), label).toHaveLength(Math.round(setup.params.reps));
          expect(result.reps.filter((rep) => rep.rejectReason === 'hold-too-short'), label).toHaveLength(1);
          expect(result.states[result.states.length - 1].phase, label).toBe('complete');
        }
      }
    }
  });

  it('provide a free-tracking sequence', () => {
    const recording = syntheticFreeTracking('right');
    expect(recording.origin).toBe('synthetic');
    expect(recording.frames.length).toBeGreaterThan(300);
  });
});

describe('illustrative seed', () => {
  it('marks every seeded session as synthetic, and never as a camera session', () => {
    const state = createSeedState(FIXED_DATE_KEY);
    expect(state.assessmentSessions.length).toBeGreaterThan(40);
    for (const session of state.assessmentSessions) {
      expect(session.source).toBe('seed');
      expect(session.synthetic).toBe(true);
      expect(session.tracking.delegate).toBe('none');
    }
    for (const patientRecord of state.patients) {
      expect(sessionsOf(state.assessmentSessions, patientRecord.id, 'composite-fist').length, patientRecord.id).toBeGreaterThan(0);
    }
  });

  it('is the same every time for the same day', () => {
    const a = seedAssessmentSessions(createSeedState(FIXED_DATE_KEY).patients, FIXED_DATE_KEY);
    const b = seedAssessmentSessions(createSeedState(FIXED_DATE_KEY).patients, FIXED_DATE_KEY);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('runs its figures through the same summary as a real session', () => {
    const session = makeSeedAssessment(patient, daysFromToday(-3), 'composite-fist', { level: 0.6, view: 'palmar', rejected: 1 });
    expect(session.summary.validReps).toBe(3);
    expect(session.summary.rejectedReps).toBe(1);
    // The injured finger makes less of the movement than its neighbours.
    expect(session.summary.joints.index?.pip?.flex as number).toBeLessThan(session.summary.joints.middle?.pip?.flex as number);
    const side = makeSeedAssessment(patient, daysFromToday(-3), 'hook-fist', { level: 0.6, view: 'radial' });
    expect(Object.keys(side.summary.joints)).toEqual(['index']);
    expect(side.summary.joints.index?.pip?.grade).toBe('direct');
  });
});

describe('storage', () => {
  it('stores a session, a protocol and reference readings, and can clear what was captured', () => {
    const store = new DemoStore(new MemoryStorage(), FIXED_NOW);
    const patientId = store.getState().activePatientId;
    const seeded = store.getState().assessmentSessions.length;

    const captured = store.recordAssessment(sessionFrom(recordedFist(), { id: 'captured-1', patientId }));
    expect(store.getState().assessmentSessions).toHaveLength(seeded + 1);

    store.addReferenceReading(captured.id, { finger: 'index', joint: 'pip', kind: 'flex', deg: 95, instrument: 'Finger goniometer' }, FIXED_NOW);
    const stored = store.getState().assessmentSessions.find((session) => session.id === captured.id) as AssessmentSession;
    expect(stored.references).toHaveLength(1);
    expect(stored.references[0]).toMatchObject({ deg: 95, joint: 'pip' });
    store.removeReferenceReading(captured.id, stored.references[0].id);
    expect(store.getState().assessmentSessions.find((session) => session.id === captured.id)?.references).toHaveLength(0);

    store.setAssessmentProtocol(patientId, { enabled: ['composite-fist'], overrides: { 'composite-fist': { params: { reps: 5 } } } });
    expect(protocolFor(store.getState().assessmentProtocols, patientId).enabled).toEqual(['composite-fist']);

    store.clearCapturedAssessments();
    expect(store.getState().assessmentSessions).toHaveLength(seeded);
    expect(store.getState().assessmentSessions.every((session) => session.source === 'seed')).toBe(true);
  });

  it('gives a state saved before assessments existed the illustrative history, and nothing else', () => {
    const storage = new MemoryStorage();
    const old = createSeedState(FIXED_DATE_KEY) as unknown as Record<string, unknown>;
    delete old.assessmentSessions;
    delete old.assessmentProtocols;
    storage.setItem('sensebridge.demo.v2', JSON.stringify(old));
    const store = new DemoStore(storage, FIXED_NOW);
    expect(store.getState().assessmentSessions.length).toBeGreaterThan(0);
    expect(store.getState().assessmentSessions.every((session) => session.synthetic)).toBe(true);
    expect(store.getState().assessmentProtocols).toEqual({});
  });

  it('survives a reload', () => {
    const storage = new MemoryStorage();
    const first = new DemoStore(storage, FIXED_NOW);
    first.recordAssessment(sessionFrom(recordedFist(), { id: 'kept', patientId: first.getState().activePatientId }));
    const second = new DemoStore(storage, FIXED_NOW);
    const kept = second.getState().assessmentSessions.find((session) => session.id === 'kept');
    expect(kept?.source).toBe('camera');
    expect(kept?.summary.validReps).toBe(3);
  });
});
