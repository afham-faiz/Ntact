/**
 * Shared fixtures for the logic-layer tests.
 *
 * Nothing here imports from `src/features` or `src/components`, and nothing
 * touches the real localStorage or the app's `demoStore` singleton.
 */
import { DEFAULT_SCENARIO } from '../src/demo/seed';
import type { StorageLike } from '../src/demo/store';
import type { MockDeviceHost } from '../src/devices/MockDeviceAdapter';
import { DAILY_CHECK_IN } from '../src/domain/checkIn';
import { addDays, atLocalTime, toDateKey, type DateKey } from '../src/domain/dates';
import { RTP_BY_LEVEL, isRehabLevel, levelStartMs } from '../src/domain/firmware';
import type {
  CheckIn,
  CheckInAnswer,
  DeviceLogEntry,
  Patient,
  Scenario,
  SensationTest,
  SimulatedDevice,
} from '../src/domain/types';

// ---------- A fixed "today" ----------

/** 12 November 2026, 10:00 local time. Treat as read-only: it is shared by every test. */
export const FIXED_NOW = new Date(2026, 10, 12, 10, 0, 0);

/** The calendar day of FIXED_NOW, i.e. '2026-11-12'. */
export const FIXED_DATE_KEY: DateKey = toDateKey(FIXED_NOW);

/** The calendar day `offset` days from the fixed date. Negative offsets are in the past. */
export function daysFromToday(offset: number): DateKey {
  return addDays(FIXED_DATE_KEY, offset);
}

// ---------- Storage ----------

/** A StorageLike kept in memory, so no test reads or writes the real localStorage. */
export class MemoryStorage implements StorageLike {
  private readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

// ---------- Simulated device host ----------

export interface InMemoryDeviceHost extends MockDeviceHost {
  /** Everything passed to `log`, oldest first. */
  readonly logEntries: DeviceLogEntry[];
  /** Change the scenario the way the demo controls would. */
  setScenario(patch: Partial<Scenario>): void;
  /** Notify listeners without changing the device, like any unrelated store update. */
  notifyListeners(): void;
  listenerCount(): number;
}

/**
 * Stands in for the demo store behind a MockDeviceAdapter. It holds the
 * simulated device, the scenario, the log and the listeners.
 *
 * `setDevice` follows DemoStore.setDevice exactly: a device equal to the current
 * one is not a change; anything else is stored and every listener is notified.
 * That notification is how the adapter learns that the link was pulled elsewhere.
 */
export function createDeviceHost(
  initial: { device?: Partial<SimulatedDevice>; scenario?: Partial<Scenario> } = {},
): InMemoryDeviceHost {
  // A freshly powered device starts in Normal mode with the link up, as in the seed.
  let device: SimulatedDevice = { linkUp: true, mode: 'NORMAL', ...initial.device };
  let scenario: Scenario = { ...DEFAULT_SCENARIO, ...initial.scenario };
  const logEntries: DeviceLogEntry[] = [];
  const listeners = new Set<() => void>();

  const notifyListeners = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    logEntries,
    getDevice: () => device,
    setDevice(next) {
      if (device.linkUp === next.linkUp && device.mode === next.mode) return;
      device = next;
      notifyListeners();
    },
    getScenario: () => scenario,
    clearDropLink() {
      scenario = { ...scenario, dropLinkOnNextTest: false };
    },
    log(entry) {
      logEntries.push(entry);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setScenario(patch) {
      scenario = { ...scenario, ...patch };
    },
    notifyListeners,
    listenerCount: () => listeners.size,
  };
}

// ---------- Record builders ----------

/** A felt step (1 to 10), 'N' for a run that ended without a response, 'S' for a cancelled one. */
export type Mark = number | 'N' | 'S';

/** One day of a history: a single mark, several attempts in order, or null for a day with no test. */
export type DayPlan = Mark | Mark[] | null;

export const TEST_PATIENT_ID = 'p-test';

/** One simulated test record on `day`, at 18:00 local time unless told otherwise. */
export function testOn(
  day: DateKey,
  mark: Mark,
  options: { patientId?: string; hour?: number; minute?: number } = {},
): SensationTest {
  const { patientId = TEST_PATIENT_ID, hour = 18, minute = 0 } = options;
  const base = {
    id: `test-${patientId}-${day}-${hour}-${minute}`,
    patientId,
    timestamp: atLocalTime(day, hour, minute),
    simulated: true as const,
    source: 'seed' as const,
  };
  if (mark === 'N') {
    return { ...base, outcome: 'NO_FELT', detectedLevel: null, commandedRtp: null, elapsedMs: null };
  }
  if (mark === 'S') {
    return {
      ...base,
      outcome: 'STOPPED',
      detectedLevel: null,
      commandedRtp: null,
      elapsedMs: null,
      stopReason: 'USER_STOP',
    };
  }
  if (!isRehabLevel(mark)) throw new Error(`testOn: ${mark} is not a rehab level (1 to 10)`);
  return {
    ...base,
    outcome: 'FELT',
    detectedLevel: mark,
    commandedRtp: RTP_BY_LEVEL[mark],
    elapsedMs: levelStartMs(mark) + 1_000,
  };
}

/**
 * A daily history, oldest first, whose last entry falls on `lastDay`.
 * Several attempts on one day are spaced ten minutes apart, in the order given.
 */
export function historyEnding(lastDay: DateKey, plan: DayPlan[], patientId: string = TEST_PATIENT_ID): SensationTest[] {
  const tests: SensationTest[] = [];
  plan.forEach((entry, index) => {
    if (entry === null) return;
    const day = addDays(lastDay, index - (plan.length - 1));
    const marks = Array.isArray(entry) ? entry : [entry];
    marks.forEach((mark, attempt) => {
      tests.push(testOn(day, mark, { patientId, minute: attempt * 10 }));
    });
  });
  return tests;
}

/** A daily check-in record with the given raw answers. */
export function checkInOn(
  day: DateKey,
  answers: Record<string, CheckInAnswer>,
  patientId: string = TEST_PATIENT_ID,
): CheckIn {
  return {
    id: `checkin-${patientId}-${day}`,
    patientId,
    date: day,
    schemaId: DAILY_CHECK_IN.id,
    answers,
    updatedAt: atLocalTime(day, 20, 0),
  };
}

/** A fictional person, enrolled sixty days before the fixed date unless overridden. */
export function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: TEST_PATIENT_ID,
    demoId: 'Demo 99',
    name: 'Test Person',
    firstName: 'Test',
    hand: 'right',
    finger: 'index',
    injury: 'Digital nerve repair',
    repairDate: daysFromToday(-66),
    enrolledDate: daysFromToday(-60),
    clinical: { segment: null, repairToTipMm: null },
    fictional: true,
    ...overrides,
  };
}
