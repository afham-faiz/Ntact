/**
 * Demo store: one object in localStorage, shared by the patient app, the
 * clinician portal and the demo controls.
 *
 * Honest limits, repeated here because they matter for the demo:
 *  - localStorage belongs to one browser profile on one device. A test done on a
 *    phone will NOT appear on a laptop. Tabs of the same browser do stay in step,
 *    through the browser's `storage` event.
 *  - There is no server, no account and no network request anywhere in this app.
 */
import { DAILY_CHECK_IN, normaliseAnswers, painOf } from '../domain/checkIn';
import { addDays, dateKeyOf, daysBetween, fromDateKey, toDateKey, type DateKey } from '../domain/dates';
import { driveForLevel, levelStartMs } from '../domain/firmware';
import { DEFAULT_ESTIMATE_CONFIG } from '../domain/recoveryEstimate';
import { checkInsForPatient, median, testsForPatient } from '../domain/selectors';
import type { SessionResult } from '../domain/exercise';
import { DEFAULT_TRIAGE_CONFIG } from '../domain/triage';
import type { AssessmentProtocol, AssessmentSession, ReferenceReading } from '../assessment/types';
import { seedAssessmentSessions } from './assessmentSeed';
import { makeExerciseSession } from './exerciseSeed';
import type {
  CheckIn,
  CheckInAnswer,
  ClinicalSetup,
  ClinicianFlag,
  DemoState,
  DeviceLogEntry,
  EstimateConfig,
  ExerciseId,
  ExerciseSession,
  ExerciseSource,
  Finger,
  Hand,
  RehabLevel,
  Scenario,
  SensationTest,
  Severity,
  SimulatedDevice,
  TestSite,
  TestSource,
  TriageConfig,
  TriageFlag,
  TrialOutcome,
  WeeklyCheckIn,
} from '../domain/types';
import {
  DEFAULT_SCENARIO,
  JUDGE_DEMO_SCENARIO,
  PRESET_HISTORY_DAYS,
  createSeedState,
  makeSeedTest,
  presetHistory,
  type HistoryPreset,
} from './seed';

export const STORAGE_KEY = 'sensebridge.demo.v2';
const DEVICE_LOG_LIMIT = 60;

type Listener = () => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isDemoState(value: unknown): value is DemoState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DemoState>;
  return (
    candidate.version === 2 &&
    typeof candidate.anchorDate === 'string' &&
    Array.isArray(candidate.patients) &&
    Array.isArray(candidate.tests) &&
    Array.isArray(candidate.checkIns) &&
    Array.isArray(candidate.flagLog) &&
    Array.isArray(candidate.clinicianFlags) &&
    Array.isArray(candidate.clinicianNotes) &&
    typeof candidate.triageConfig === 'object' &&
    typeof candidate.estimateConfig === 'object' &&
    typeof candidate.scenario === 'object' &&
    typeof candidate.device === 'object'
  );
}

/**
 * Bring a state saved by an earlier build up to date. Exercises, exercise plans
 * and follow-up were added later; a state without them is given empty ones, and
 * the provisional rules are replaced with the current defaults because their
 * shape (and the agreed priority levels) changed at the same time.
 */
function upgrade(state: DemoState): DemoState {
  const loose = state as Partial<DemoState>;
  const current = loose.triageConfig as Partial<TriageConfig> | undefined;
  const rulesAreCurrent = current?.missedExercises !== undefined && current.movementDecline !== undefined;
  if (
    Array.isArray(loose.exerciseSessions) &&
    Array.isArray(loose.weeklyCheckIns) &&
    Array.isArray(loose.assessmentSessions) &&
    loose.assessmentProtocols &&
    loose.exercisePlans &&
    loose.followUp &&
    rulesAreCurrent
  ) {
    return state;
  }
  return {
    ...state,
    // Movement assessments were added later. A state saved before them is given the illustrative history.
    assessmentSessions: Array.isArray(loose.assessmentSessions) ? loose.assessmentSessions : seedAssessmentSessions(state.patients, state.anchorDate),
    assessmentProtocols: loose.assessmentProtocols ?? {},
    weeklyCheckIns: Array.isArray(loose.weeklyCheckIns) ? loose.weeklyCheckIns : [],
    exerciseSessions: Array.isArray(loose.exerciseSessions) ? loose.exerciseSessions : [],
    exercisePlans: loose.exercisePlans ?? {},
    followUp: loose.followUp ?? {},
    triageConfig: rulesAreCurrent ? state.triageConfig : structuredClone(DEFAULT_TRIAGE_CONFIG),
  };
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 0xffffffff).toString(16);
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${random}`;
}

export type ScriptedResult = { kind: 'FELT'; level: RehabLevel } | { kind: 'NO_FELT' } | { kind: 'STOPPED' };

export class DemoStore {
  private state: DemoState;
  private readonly listeners = new Set<Listener>();
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null, now: Date = new Date()) {
    this.storage = storage;
    this.state = this.read() ?? createSeedState(toDateKey(now));
    this.write();
  }

  // ---------- subscription ----------

  getState = (): DemoState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Another tab of the same browser changed the data. */
  syncFromStorage(): void {
    const next = this.read();
    if (!next) return;
    this.state = next;
    this.emit();
  }

  private read(): DemoState | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isDemoState(parsed) ? upgrade(parsed) : null;
    } catch {
      return null;
    }
  }

  private write(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage full or blocked (private mode). The session still works in memory.
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private update(recipe: (state: DemoState) => DemoState): void {
    const next = recipe(this.state);
    if (next === this.state) return;
    this.state = next;
    this.write();
    this.emit();
  }

  // ---------- demo controls ----------

  /** Back to the seeded story, re-anchored on today. */
  reset(preset: 'default' | 'judge-demo' = 'default', now: Date = new Date()): void {
    const scenario = preset === 'judge-demo' ? JUDGE_DEMO_SCENARIO : DEFAULT_SCENARIO;
    this.state = createSeedState(toDateKey(now), scenario);
    this.write();
    this.emit();
  }

  setActivePatient(patientId: string): void {
    this.update((state) =>
      state.patients.some((patient) => patient.id === patientId)
        ? { ...state, activePatientId: patientId }
        : state,
    );
  }

  setScenario(patch: Partial<Scenario>): void {
    this.update((state) => ({ ...state, scenario: { ...state.scenario, ...patch } }));
  }

  setOnboardingSeen(seen: boolean): void {
    this.update((state) => ({ ...state, onboardingSeen: seen }));
  }

  setAssistPreferred(preferred: boolean): void {
    this.update((state) => ({ ...state, assistPreferred: preferred }));
  }

  /** Replace one person's test history with a named pattern ending yesterday. */
  applyHistoryPreset(patientId: string, preset: HistoryPreset, now: Date = new Date()): void {
    const today = toDateKey(now);
    const history = presetHistory(patientId, preset, today);
    const earliest = addDays(today, -PRESET_HISTORY_DAYS);
    this.update((state) => ({
      ...state,
      // The pattern needs the person to have been enrolled for its whole length.
      patients: state.patients.map((patient) =>
        patient.id === patientId && patient.enrolledDate > earliest
          ? {
              ...patient,
              enrolledDate: earliest,
              repairDate: patient.repairDate > addDays(earliest, -5) ? addDays(earliest, -5) : patient.repairDate,
            }
          : patient,
      ),
      tests: [...state.tests.filter((test) => test.patientId !== patientId), ...history].sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp),
      ),
      // Old decisions belonged to the old history.
      flagLog: state.flagLog.filter((flag) => flag.patientId !== patientId),
    }));
  }

  /** Remove this person's tests for the last `days` full days (and today), as if they had been missed. */
  simulateMissedTests(patientId: string, days: number, now: Date = new Date()): void {
    const today = toDateKey(now);
    const from = addDays(today, -days);
    this.update((state) => ({
      ...state,
      tests: state.tests.filter((test) => test.patientId !== patientId || dateKeyOf(test.timestamp) < from),
    }));
  }

  /** Make the last two days' results rise, to meet the provisional "two consecutive readings" rule. */
  simulateRisingReadings(patientId: string, now: Date = new Date()): void {
    const today = toDateKey(now);
    const yesterday = addDays(today, -1);
    const dayBefore = addDays(today, -2);
    const threeAgo = addDays(today, -3);
    // Three readings are rewritten so the rise holds whatever came before, including step 9 or 10.
    const earlier = testsForPatient(this.state.tests, patientId).filter(
      (test) => dateKeyOf(test.timestamp) < threeAgo && test.outcome === 'FELT',
    );
    const last = earlier.length > 0 ? earlier[earlier.length - 1] : null;
    const base = Math.min(7, last && last.outcome === 'FELT' ? last.detectedLevel : 5);
    this.update((state) => ({
      ...state,
      tests: [
        ...state.tests.filter(
          (test) => test.patientId !== patientId || dateKeyOf(test.timestamp) < threeAgo,
        ),
        makeSeedTest(patientId, threeAgo, [18, 30], base, 0, 0.5, 'demo-panel'),
        makeSeedTest(patientId, dayBefore, [18, 30], base + 2, 0, 0.4, 'demo-panel'),
        makeSeedTest(patientId, yesterday, [18, 30], base + 3, 0, 0.6, 'demo-panel'),
      ].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    }));
  }

  /** Save a check-in for today that meets one of the provisional check-in rules. */
  simulateCheckInTrigger(patientId: string, kind: 'skin' | 'pain', now: Date = new Date()): void {
    const today = toDateKey(now);
    const history = checkInsForPatient(this.state.checkIns, patientId).filter((entry) => entry.date < today);
    const recentPain = history
      .slice(-7)
      .map(painOf)
      .filter((value): value is number => value !== null);
    const baseline = median(recentPain) ?? 2;
    if (kind === 'pain') {
      // The rule needs a baseline inside the previous week, so fill any of the last three days that have none.
      for (let back = 3; back >= 1; back -= 1) {
        const day = addDays(today, -back);
        if (!history.some((entry) => entry.date === day)) {
          this.saveCheckIn(patientId, day, { pain: Math.round(baseline), skin: false, cold: 'mild' }, now);
        }
      }
    }
    if (kind === 'skin') {
      this.saveCheckIn(
        patientId,
        today,
        { pain: Math.round(baseline), skin: true, skinNote: 'Red patch under the wristband. (Demo entry)', cold: 'mild' },
        now,
      );
    } else {
      this.saveCheckIn(
        patientId,
        today,
        { pain: Math.min(10, Math.round(baseline) + 4), skin: false, cold: 'moderate', note: 'Aching more than usual today. (Demo entry)' },
        now,
      );
    }
  }

  // ---------- simulated device ----------

  setDevice(device: SimulatedDevice): void {
    this.update((state) =>
      state.device.linkUp === device.linkUp && state.device.mode === device.mode
        ? state
        : { ...state, device },
    );
  }

  logDevice(entry: DeviceLogEntry): void {
    this.update((state) => ({
      ...state,
      deviceLog: [...state.deviceLog, entry].slice(-DEVICE_LOG_LIMIT),
    }));
  }

  clearDeviceLog(): void {
    this.update((state) => ({ ...state, deviceLog: [] }));
  }

  // ---------- sensation tests ----------

  /** Store the outcome the device reported. Called only after its notification arrives. */
  recordTrial(
    patientId: string,
    outcome: TrialOutcome,
    source: TestSource,
    at: Date = new Date(),
    site?: TestSite,
  ): SensationTest {
    const base = {
      id: newId('test'),
      patientId,
      timestamp: at.toISOString(),
      // Only an outcome reported by the physical wearable is ever marked as not simulated.
      simulated: source !== 'ble',
      source,
      ...(site ? { site } : {}),
    };
    let test: SensationTest;
    if (outcome.outcome === 'FELT') {
      test = {
        ...base,
        outcome: 'FELT',
        detectedLevel: outcome.level,
        commandedRtp: outcome.drive,
        elapsedMs: outcome.elapsedMs,
      };
    } else if (outcome.outcome === 'NO_FELT') {
      test = { ...base, outcome: 'NO_FELT', detectedLevel: null, commandedRtp: null, elapsedMs: null };
    } else {
      test = {
        ...base,
        outcome: 'STOPPED',
        detectedLevel: null,
        commandedRtp: null,
        elapsedMs: null,
        stopReason: outcome.stopReason,
      };
    }
    this.update((state) => ({ ...state, tests: [...state.tests, test] }));
    return test;
  }

  /** Demo controls only: add a result for today without running the test. */
  logScriptedResult(patientId: string, result: ScriptedResult, at: Date = new Date()): SensationTest {
    if (result.kind === 'FELT') {
      return this.recordTrial(
        patientId,
        {
          outcome: 'FELT',
          level: result.level,
          drive: driveForLevel(result.level),
          elapsedMs: levelStartMs(result.level) + 1_400,
        },
        'demo-panel',
        at,
      );
    }
    if (result.kind === 'NO_FELT') return this.recordTrial(patientId, { outcome: 'NO_FELT' }, 'demo-panel', at);
    return this.recordTrial(patientId, { outcome: 'STOPPED', stopReason: 'USER_STOP' }, 'demo-panel', at);
  }

  // ---------- exercises ----------

  /** Store a finished exercise session. Only a camera session is ever marked as not simulated. */
  recordExercise(
    patientId: string,
    exerciseId: ExerciseId,
    result: SessionResult,
    source: ExerciseSource,
    site: TestSite,
    at: Date = new Date(),
  ): ExerciseSession {
    const session: ExerciseSession = {
      id: newId('exercise'),
      patientId,
      timestamp: at.toISOString(),
      exerciseId,
      reps: result.reps,
      targetReps: result.targetReps,
      completed: result.completed,
      durationMs: result.durationMs,
      site,
      flexDeg: result.flexDeg,
      extDeg: result.extDeg,
      rangeDeg: result.rangeDeg,
      source,
      simulated: source !== 'camera',
    };
    this.update((state) => ({ ...state, exerciseSessions: [...state.exerciseSessions, session] }));
    return session;
  }

  // ---------- movement assessments ----------

  /** Store a finished assessment. Whether it is synthetic is decided when the session is built, from where its frames came from. */
  recordAssessment(session: AssessmentSession): AssessmentSession {
    this.update((state) => ({ ...state, assessmentSessions: [...state.assessmentSessions, session] }));
    return session;
  }

  /** From the clinician record: which assessments this patient is offered, and with what settings. */
  setAssessmentProtocol(patientId: string, protocol: AssessmentProtocol): void {
    this.update((state) => ({ ...state, assessmentProtocols: { ...state.assessmentProtocols, [patientId]: protocol } }));
  }

  /** A reading taken with a reference instrument, entered against a session for comparison. */
  addReferenceReading(sessionId: string, reading: Omit<ReferenceReading, 'id' | 'enteredAt'>, at: Date = new Date()): void {
    this.update((state) => ({
      ...state,
      assessmentSessions: state.assessmentSessions.map((session) =>
        session.id === sessionId
          ? { ...session, references: [...(session.references ?? []), { ...reading, id: newId('reference'), enteredAt: at.toISOString() }] }
          : session,
      ),
    }));
  }

  removeReferenceReading(sessionId: string, readingId: string): void {
    this.update((state) => ({
      ...state,
      assessmentSessions: state.assessmentSessions.map((session) =>
        session.id === sessionId ? { ...session, references: (session.references ?? []).filter((reading) => reading.id !== readingId) } : session,
      ),
    }));
  }

  /** Remove everything captured on this device (camera sessions and replays), leaving the illustrative history. */
  clearCapturedAssessments(patientId?: string): void {
    this.update((state) => ({
      ...state,
      assessmentSessions: state.assessmentSessions.filter(
        (session) => session.source === 'seed' || (patientId !== undefined && session.patientId !== patientId),
      ),
    }));
  }

  /** From the clinician record: which exercises this patient may do. */
  setExercisePlan(patientId: string, unlocked: ExerciseId[]): void {
    this.update((state) => ({ ...state, exercisePlans: { ...state.exercisePlans, [patientId]: [...unlocked] } }));
  }

  /** From the clinician record: move a patient to, or back from, patient-initiated follow-up. */
  setFollowUp(patientId: string, on: boolean, at: Date = new Date()): void {
    this.update((state) => {
      const next = { ...state.followUp };
      if (on) next[patientId] = { since: toDateKey(at) };
      else delete next[patientId];
      return { ...state, followUp: next };
    });
  }

  /** Demo controls: remove this person's exercise sessions for the last `days` full days and today. */
  simulateMissedExercises(patientId: string, days: number, now: Date = new Date()): void {
    const from = addDays(toDateKey(now), -days);
    this.update((state) => ({
      ...state,
      exerciseSessions: state.exerciseSessions.filter(
        (session) => session.patientId !== patientId || dateKeyOf(session.timestamp) < from,
      ),
    }));
  }

  /** Demo controls: rewrite the last six days so the camera-estimated range falls. */
  simulateMovementDecline(patientId: string, now: Date = new Date()): void {
    const today = toDateKey(now);
    const patient = this.state.patients.find((item) => item.id === patientId);
    if (!patient) return;
    const from = addDays(today, -6);
    const ranges = [128, 124, 126, 98, 94, 90];
    this.update((state) => ({
      ...state,
      exerciseSessions: [
        ...state.exerciseSessions.filter(
          (session) => session.patientId !== patientId || dateKeyOf(session.timestamp) < from,
        ),
        ...ranges.map((range, index) => makeExerciseSession(patient, addDays(from, index), range, 'demo-panel')),
      ].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    }));
  }

  // ---------- check-ins ----------

  /** One daily check-in per person per day. Saving again the same day replaces it. */
  saveCheckIn(
    patientId: string,
    date: DateKey,
    answers: Record<string, CheckInAnswer>,
    at: Date = new Date(),
  ): CheckIn {
    const existing = this.state.checkIns.find(
      (entry) => entry.patientId === patientId && entry.date === date && entry.schemaId === DAILY_CHECK_IN.id,
    );
    const entry: CheckIn = {
      id: existing?.id ?? newId('checkin'),
      patientId,
      date,
      schemaId: DAILY_CHECK_IN.id,
      answers: normaliseAnswers(DAILY_CHECK_IN, answers),
      updatedAt: at.toISOString(),
    };
    this.update((state) => ({
      ...state,
      checkIns: [...state.checkIns.filter((item) => item.id !== entry.id), entry].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    }));
    return entry;
  }

  /** The weekly questions. Answering again on the same day replaces that day's answers. */
  saveWeeklyCheckIn(
    patientId: string,
    date: DateKey,
    answers: { cold: Severity; tingling: Severity; function: number },
    at: Date = new Date(),
  ): WeeklyCheckIn {
    const existing = this.state.weeklyCheckIns.find((entry) => entry.patientId === patientId && entry.date === date);
    const entry: WeeklyCheckIn = {
      id: existing?.id ?? newId('weekly'),
      patientId,
      date,
      cold: answers.cold,
      tingling: answers.tingling,
      function: Math.min(10, Math.max(0, Math.round(answers.function))),
      updatedAt: at.toISOString(),
    };
    this.update((state) => ({
      ...state,
      weeklyCheckIns: [...state.weeklyCheckIns.filter((item) => item.id !== entry.id), entry].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    }));
    return entry;
  }

  // ---------- patient profile ----------

  /** From patient onboarding: the minimum a patient is asked for. */
  updateProfile(patientId: string, patch: { hand?: Hand; finger?: Finger; repairDate?: DateKey }): void {
    this.update((state) => ({
      ...state,
      patients: state.patients.map((patient) => (patient.id === patientId ? { ...patient, ...patch } : patient)),
    }));
  }

  /** From the clinician setup workflow. Never shown to the patient. */
  updateClinicalSetup(patientId: string, clinical: ClinicalSetup, repairDate?: DateKey): void {
    this.update((state) => ({
      ...state,
      patients: state.patients.map((patient) =>
        patient.id === patientId
          ? { ...patient, clinical, repairDate: repairDate ?? patient.repairDate }
          : patient,
      ),
    }));
  }

  // ---------- clinician actions (saved locally, never sent anywhere) ----------

  /** Record that a clinician looked at these flags. Nothing leaves the browser. */
  recordReview(flags: TriageFlag[], note?: string, at: Date = new Date()): void {
    if (flags.length === 0) return;
    const ids = new Set(flags.map((flag) => flag.id));
    const trimmed = note?.trim() || undefined;
    this.update((state) => ({
      ...state,
      clinicianFlags: state.clinicianFlags.filter((flag) => !ids.has(flag.id)),
      flagLog: [
        ...state.flagLog.filter((flag) => !ids.has(flag.id)),
        ...flags.map((flag) => ({
          ...flag,
          status: 'reviewed' as const,
          reviewedAt: at.toISOString(),
          note: trimmed,
        })),
      ],
      clinicianNotes: trimmed
        ? [
            ...state.clinicianNotes,
            {
              id: newId('note'),
              patientId: flags[0].patientId,
              createdAt: at.toISOString(),
              text: `Review recorded: ${trimmed}`,
            },
          ]
        : state.clinicianNotes,
    }));
  }

  /** Undo a recorded review. A rule flag returns if its condition still holds; a manual flag is restored. */
  reopenFlag(flagId: string): void {
    this.update((state) => {
      const entry = state.flagLog.find((flag) => flag.id === flagId);
      if (!entry) return state;
      const restoredFlags: ClinicianFlag[] =
        entry.ruleId === 'CLINICIAN_FLAG'
          ? [
              ...state.clinicianFlags,
              {
                id: entry.id,
                patientId: entry.patientId,
                createdAt: fromDateKey(entry.raisedOn).toISOString(),
                note: entry.flagNote,
              },
            ]
          : state.clinicianFlags;
      return {
        ...state,
        clinicianFlags: restoredFlags,
        flagLog: state.flagLog.filter((flag) => flag.id !== flagId),
      };
    });
  }

  flagForReview(patientId: string, note?: string, at: Date = new Date()): void {
    const flag: ClinicianFlag = {
      id: newId('flag'),
      patientId,
      createdAt: at.toISOString(),
      note: note?.trim() || undefined,
    };
    this.update((state) => ({ ...state, clinicianFlags: [...state.clinicianFlags, flag] }));
  }

  addClinicianNote(patientId: string, text: string, at: Date = new Date()): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.update((state) => ({
      ...state,
      clinicianNotes: [
        ...state.clinicianNotes,
        { id: newId('note'), patientId, createdAt: at.toISOString(), text: trimmed },
      ],
    }));
  }

  // ---------- provisional configuration ----------

  setTriageConfig(config: TriageConfig): void {
    this.update((state) => ({ ...state, triageConfig: config }));
  }

  resetTriageConfig(): void {
    this.update((state) => ({ ...state, triageConfig: structuredClone(DEFAULT_TRIAGE_CONFIG) }));
  }

  setEstimateConfig(config: EstimateConfig): void {
    this.update((state) => ({ ...state, estimateConfig: config }));
  }

  resetEstimateConfig(): void {
    this.update((state) => ({ ...state, estimateConfig: structuredClone(DEFAULT_ESTIMATE_CONFIG) }));
  }
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = '__sensebridge_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The single store for this tab. */
export const demoStore = new DemoStore(browserStorage());

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) demoStore.syncFromStorage();
  });
}

/** Today as a calendar day. Kept in one place so every screen agrees. */
export function todayKey(now: Date = new Date()): DateKey {
  return toDateKey(now);
}

/** How many days the seeded story has drifted from today (0 right after a reset). */
export function seedAgeDays(state: DemoState, now: Date = new Date()): number {
  return Math.max(0, daysBetween(state.anchorDate, toDateKey(now)));
}
