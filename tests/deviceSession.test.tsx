/**
 * The app's device and test-session providers, driven end to end.
 *
 * The physical-device cases run against the fake peripheral in tests/fakeBle.ts;
 * the demonstration cases run against the real MockDeviceAdapter. Records are
 * read back from the same demo store the clinician portal reads.
 *
 * SOFTWARE tests only. None of this has touched an ESP32.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceProvider, useDevice, type DeviceContextValue } from '../src/app/DeviceContext';
import { ACK_TIMEOUT_MS, TestSessionProvider, useTestSession } from '../src/app/TestSessionContext';
import { demoStore, todayKey } from '../src/demo/store';
import { BleDeviceAdapter } from '../src/devices/BleDeviceAdapter';
import type { DeviceAdapter } from '../src/devices/DeviceAdapter';
import { MockDeviceAdapter } from '../src/devices/MockDeviceAdapter';
import { DeviceSourceStore, type DeviceSource } from '../src/devices/source';
import { primaryTestOfDay, testsForPatient, testsOnDay } from '../src/domain/selectors';
import { toBlindedView } from '../src/domain/testSession';
import { triageSummaries } from '../src/domain/triage';
import type { SensationTest } from '../src/domain/types';
import { testSourceLabel } from '../src/features/clinician/parts';
import { FakePeripheral, domError } from './fakeBle';

type Session = ReturnType<typeof useTestSession>;

interface App {
  readonly device: DeviceContextValue;
  readonly session: Session;
  peripheral: FakePeripheral;
  ble: BleDeviceAdapter;
  mock: MockDeviceAdapter;
  sources: DeviceSourceStore;
}

function mount(source: DeviceSource, configure?: (peripheral: FakePeripheral) => void): App {
  const peripheral = new FakePeripheral();
  configure?.(peripheral);
  const ble = new BleDeviceAdapter({ bluetooth: peripheral.bluetooth, log: (entry) => demoStore.logDevice(entry) });
  const mock = new MockDeviceAdapter({
    getDevice: () => demoStore.getState().device,
    setDevice: (device) => demoStore.setDevice(device),
    getScenario: () => demoStore.getState().scenario,
    clearDropLink: () => demoStore.setScenario({ dropLinkOnNextTest: false }),
    log: (entry) => demoStore.logDevice({ ...entry, via: 'mock' }),
    subscribe: (listener) => demoStore.subscribe(listener),
  });
  const sources = new DeviceSourceStore(null);
  sources.set(source);
  const resolveAdapter = (chosen: DeviceSource): DeviceAdapter => (chosen === 'hardware' ? ble : mock);

  const seen: { device?: DeviceContextValue; session?: Session } = {};
  function Probe() {
    seen.device = useDevice();
    seen.session = useTestSession();
    return null;
  }

  render(
    <DeviceProvider resolveAdapter={resolveAdapter} sourceStore={sources} bleSupport={{ supported: true }}>
      <TestSessionProvider>
        <Probe />
      </TestSessionProvider>
    </DeviceProvider>,
  );
  // Stands in for the test screen being on display. Without it the provider treats every
  // finished trial as "the person already left" and clears it straight away.
  act(() => (seen.session as Session).attach());

  return {
    get device() {
      return seen.device as DeviceContextValue;
    },
    get session() {
      return seen.session as Session;
    },
    peripheral,
    ble,
    mock,
    sources,
  };
}

/** Let promises, React and (when real) zero-delay timers settle. */
async function settle(): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function run(action: () => void): Promise<void> {
  await act(async () => {
    action();
  });
  await settle();
}

async function connectHardware(app: App): Promise<void> {
  await run(() => app.device.connect());
  expect(app.device.connection).toBe('connected');
}

/** REHAB, REHAB_READY, START, LEVEL,0,0: the trial is running. */
async function startHardwareTrial(app: App): Promise<void> {
  await run(() => app.session.begin());
  expect(app.session.phase).toEqual({ name: 'running' });
}

const ACTIVE = () => demoStore.getState().activePatientId;
const testsOf = (patientId: string): SensationTest[] => testsForPatient(demoStore.getState().tests, patientId);
const allTests = (): SensationTest[] => demoStore.getState().tests;
const patientOf = (patientId: string) => {
  const patient = demoStore.getState().patients.find((item) => item.id === patientId);
  if (!patient) throw new Error(`No patient ${patientId}`);
  return patient;
};

beforeEach(() => {
  demoStore.reset('default');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('physical device: connecting', () => {
  it('starts disconnected and never connects by itself', async () => {
    const app = mount('hardware');
    await settle();
    expect(app.device.source).toBe('hardware');
    expect(app.device.simulated).toBe(false);
    expect(app.device.connection).toBe('disconnected');
    expect(app.peripheral.calls).toEqual([]);
    expect(app.device.words.connect).toBe('Connect Ntact device');
  });

  it('subscribes, then asks for STATUS, and shows the mode the device reports', async () => {
    const app = mount('hardware');
    await connectHardware(app);

    const status = app.peripheral.calls.indexOf('write:STATUS');
    expect(status).toBeGreaterThan(app.peripheral.calls.indexOf('startNotifications'));
    expect(app.peripheral.writes).toEqual(['STATUS']);
    // A freshly powered board reports NORMAL. The app shows that, it does not assume it.
    expect(app.device.mode).toBe('NORMAL');
    expect(app.device.problem).toBeNull();
  });

  it('switches Touch Assist off and on, and waits for the device to confirm each time', async () => {
    const app = mount('hardware');
    await connectHardware(app);

    await run(() => app.device.pauseAssist());
    expect(app.device.mode).toBe('IDLE');
    await run(() => app.device.enableAssist());
    expect(app.device.mode).toBe('NORMAL');
    expect(app.peripheral.writes).toEqual(['STATUS', 'STOP', 'NORMAL']);
  });

  it.each([
    ['the device list is closed', domError('NotFoundError'), 'cancelled'],
    ['the wearable cannot be reached', null, 'unreachable'],
  ] as const)('stays in physical-device mode with nothing saved when %s', async (_label, chooserError, reason) => {
    const before = allTests().length;
    const app = mount('hardware', (p) => {
      if (chooserError) p.faults.chooser = chooserError;
      else p.faults.connect = domError('NetworkError');
    });

    await run(() => app.device.connect());

    expect(app.device.connection).toBe('disconnected');
    expect(app.device.problem).toBe(reason);
    // No silent fallback: still the physical device, still not simulated.
    expect(app.device.source).toBe('hardware');
    expect(app.device.simulated).toBe(false);
    expect(app.sources.get()).toBe('hardware');
    expect(allTests()).toHaveLength(before);
  });
});

describe('physical device: the daily sensation test', () => {
  it('runs REHAB, START, FELT in order and saves what the firmware reports', async () => {
    const app = mount('hardware');
    await connectHardware(app);
    const patientId = ACTIVE();
    const before = testsOf(patientId).length;

    await startHardwareTrial(app);
    await run(() => {
      app.peripheral.level(1);
      app.peripheral.level(2);
      app.peripheral.level(3);
    });
    app.peripheral.elapsedMs = 8_500;
    await run(() => app.session.tapFelt());

    // START is written once, and only after REHAB_READY.
    expect(app.peripheral.writes).toEqual(['STATUS', 'REHAB', 'START', 'FELT']);
    expect(app.session.phase).toEqual({
      name: 'result',
      outcome: { outcome: 'FELT', level: 3, drive: 24, elapsedMs: 8_500 },
    });

    const saved = testsOf(patientId);
    expect(saved).toHaveLength(before + 1);
    const test = saved[saved.length - 1];
    expect(test).toMatchObject({
      patientId,
      outcome: 'FELT',
      detectedLevel: 3,
      commandedRtp: 24,
      elapsedMs: 8_500,
      source: 'ble',
      simulated: false,
      site: { hand: patientOf(patientId).hand, finger: patientOf(patientId).finger },
    });
    expect(app.session.saved?.test.id).toBe(test.id);
  });

  it('never exposes the level to the screen while the trial runs', async () => {
    const app = mount('hardware');
    await connectHardware(app);
    await startHardwareTrial(app);

    for (let level = 1; level <= 6; level += 1) {
      await run(() => app.peripheral.level(level));
      // The whole phase object is the name and nothing else.
      expect(app.session.phase).toEqual({ name: 'running' });
      expect(toBlindedView(app.session.phase)).toEqual({ canRespond: true, canStop: true, acknowledged: false });
    }
  });

  it('sends FELT at once and saves nothing until the firmware answers', async () => {
    const app = mount('hardware');
    await connectHardware(app);
    const before = allTests().length;
    await startHardwareTrial(app);
    await run(() => app.peripheral.level(5));
    app.peripheral.holdFelt = true;

    act(() => app.session.tapFelt());
    // Same tick as the tap: the command is already on its way.
    expect(app.peripheral.writes[app.peripheral.writes.length - 1]).toBe('FELT');
    await settle();
    expect(app.peripheral.feltWaiting).toBe(true);
    expect(app.session.phase).toEqual({ name: 'responding' });
    expect(allTests()).toHaveLength(before);

    await run(() => app.peripheral.answerFelt());
    expect(allTests()).toHaveLength(before + 1);
    expect(allTests()[allTests().length - 1]).toMatchObject({ outcome: 'FELT', detectedLevel: 5, commandedRtp: 47 });
  });

  it('saves a completed, not-felt run as NO_FELT and never as a level', async () => {
    const app = mount('hardware');
    await connectHardware(app);
    const patientId = ACTIVE();
    await startHardwareTrial(app);

    await run(() => {
      for (let level = 1; level <= 10; level += 1) app.peripheral.level(level);
      app.peripheral.finishUnanswered();
    });

    expect(app.session.phase).toEqual({ name: 'result', outcome: { outcome: 'NO_FELT' } });
    const test = testsOf(patientId).pop();
    expect(test).toMatchObject({ outcome: 'NO_FELT', detectedLevel: null, commandedRtp: null, elapsedMs: null, source: 'ble', simulated: false });
    expect(app.peripheral.writes).not.toContain('FELT');
  });

  it('saves a stopped run as cancelled, with no level', async () => {
    const app = mount('hardware');
    await connectHardware(app);
    const patientId = ACTIVE();
    await startHardwareTrial(app);
    await run(() => app.peripheral.level(4));

    act(() => app.session.tapStop());
    expect(app.peripheral.writes[app.peripheral.writes.length - 1]).toBe('STOP');
    await settle();

    expect(app.session.phase).toEqual({ name: 'result', outcome: { outcome: 'STOPPED', stopReason: 'USER_STOP' } });
    const test = testsOf(patientId).pop();
    expect(test).toMatchObject({ outcome: 'STOPPED', detectedLevel: null, commandedRtp: null, stopReason: 'USER_STOP', source: 'ble' });
    expect(app.device.mode).toBe('IDLE');
  });

  it('does not record a tap during the silent first second as a detection', async () => {
    const app = mount('hardware');
    await connectHardware(app);
    const patientId = ACTIVE();
    await startHardwareTrial(app);

    await run(() => app.session.tapFelt());

    expect(app.session.phase).toEqual({ name: 'result', outcome: { outcome: 'STOPPED', stopReason: 'EARLY_RESPONSE' } });
    expect(testsOf(patientId).pop()).toMatchObject({ outcome: 'STOPPED', detectedLevel: null });
  });

  it('saves nothing and does not start when the device reports a driver fault', async () => {
    const before = allTests().length;
    const app = mount('hardware', (p) => (p.faults.driverFault = true));
    await connectHardware(app);

    await run(() => app.session.begin());

    expect(app.session.phase).toEqual({ name: 'device-error', code: 'DRIVER' });
    expect(app.peripheral.writes).toEqual(['STATUS', 'REHAB', 'START']);
    expect(allTests()).toHaveLength(before);
  });

  it('reports a device that stops answering, and saves nothing', async () => {
    const before = allTests().length;
    const app = mount('hardware');
    await connectHardware(app);
    vi.useFakeTimers();
    app.peripheral.faults.silent = true;

    await run(() => app.session.begin());
    expect(app.session.phase).toEqual({ name: 'arming' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    });

    expect(app.session.phase).toEqual({ name: 'device-error', code: 'TIMEOUT' });
    // START was never sent, because REHAB_READY never came.
    expect(app.peripheral.writes).toEqual(['STATUS', 'REHAB']);
    expect(allTests()).toHaveLength(before);
  });

  it('ignores a result the device sends when no test was started from the app', async () => {
    const before = allTests().length;
    const app = mount('hardware');
    await connectHardware(app);

    await run(() => {
      app.peripheral.notify('FELT,3,24,8500');
      app.peripheral.notify('COMPLETE,NO_FELT');
      app.peripheral.notify('LEVEL,nonsense');
    });

    expect(app.session.phase).toEqual({ name: 'ready' });
    expect(allTests()).toHaveLength(before);
  });
});

describe('physical device: losing the link', () => {
  it('cancels the trial, saves nothing, and does not resume after reconnecting', async () => {
    const before = allTests().length;
    const app = mount('hardware');
    await connectHardware(app);
    await startHardwareTrial(app);
    await run(() => app.peripheral.level(2));

    await run(() => app.peripheral.dropLink());

    expect(app.device.connection).toBe('disconnected');
    expect(app.device.problem).toBe('lost');
    expect(app.device.mode).toBeNull();
    expect(app.session.phase).toEqual({ name: 'connection-lost' });
    expect(allTests()).toHaveLength(before);
    // Still the physical device: no fallback to the demonstration.
    expect(app.device.simulated).toBe(false);

    const writesBefore = app.peripheral.writes.length;
    await run(() => app.device.connect());

    expect(app.device.connection).toBe('connected');
    expect(app.device.problem).toBeNull();
    expect(app.peripheral.requestCount).toBe(1);
    // After a reconnect the app only asks for STATUS. It does not re-arm or restart anything.
    expect(app.peripheral.writes.slice(writesBefore)).toEqual(['STATUS']);
    expect(app.device.mode).toBe('IDLE');
    expect(app.session.phase).toEqual({ name: 'connection-lost' });
    expect(allTests()).toHaveLength(before);

    // The person sets the test up again, and it runs from the beginning.
    await run(() => app.session.reset());
    await startHardwareTrial(app);
    expect(app.peripheral.writes.slice(writesBefore)).toEqual(['STATUS', 'REHAB', 'START']);
  });

  it('does not call a deliberate disconnect "lost"', async () => {
    const app = mount('hardware');
    await connectHardware(app);
    await run(() => app.device.disconnect());
    expect(app.device.connection).toBe('disconnected');
    expect(app.device.problem).toBeNull();
    expect(app.device.words.connect).toBe('Reconnect Ntact device');
  });

  it('a tap after the link has gone records nothing', async () => {
    const before = allTests().length;
    const app = mount('hardware');
    await connectHardware(app);
    await startHardwareTrial(app);
    await run(() => app.peripheral.dropLink());

    await run(() => app.session.tapFelt());
    await run(() => app.session.tapStop());

    expect(app.session.phase).toEqual({ name: 'connection-lost' });
    expect(allTests()).toHaveLength(before);
  });
});

describe('patient attribution', () => {
  it('saves the result to the patient and finger captured at Start, even if the active patient changes mid-test', async () => {
    const app = mount('hardware');
    await connectHardware(app);
    const starter = ACTIVE();
    const other = demoStore.getState().patients.find(
      (patient) => patient.id !== starter && patient.finger !== patientOf(starter).finger,
    );
    if (!other) throw new Error('The seed needs a second patient with a different finger.');
    const starterBefore = testsOf(starter).length;
    const otherBefore = testsOf(other.id).length;

    await startHardwareTrial(app);
    await run(() => app.peripheral.level(2));
    // The demo controls (or another tab) switch the patient while the trial is running.
    await run(() => demoStore.setActivePatient(other.id));
    expect(ACTIVE()).toBe(other.id);
    await run(() => app.session.tapFelt());

    expect(testsOf(other.id)).toHaveLength(otherBefore);
    const saved = testsOf(starter);
    expect(saved).toHaveLength(starterBefore + 1);
    expect(saved[saved.length - 1]).toMatchObject({
      patientId: starter,
      outcome: 'FELT',
      detectedLevel: 2,
      site: { hand: patientOf(starter).hand, finger: patientOf(starter).finger },
    });
  });

  it('attributes the next test to whoever is active when that test starts', async () => {
    const app = mount('hardware');
    await connectHardware(app);
    const first = ACTIVE();
    const second = demoStore.getState().patients.find((patient) => patient.id !== first)!.id;

    await startHardwareTrial(app);
    await run(() => app.peripheral.level(1));
    await run(() => app.session.tapFelt());
    await run(() => demoStore.setActivePatient(second));
    await run(() => app.session.reset());
    await startHardwareTrial(app);
    await run(() => app.peripheral.level(4));
    await run(() => app.session.tapFelt());

    expect(testsOf(first).pop()).toMatchObject({ patientId: first, detectedLevel: 1 });
    expect(testsOf(second).pop()).toMatchObject({ patientId: second, detectedLevel: 4, source: 'ble' });
  });
});

describe('clinician view of a wearable result', () => {
  it('shows today’s result in the record and recalculates review flags from it', async () => {
    const app = mount('hardware');
    await connectHardware(app);
    const patientId = ACTIVE();
    const today = todayKey();

    await startHardwareTrial(app);
    await run(() => app.peripheral.level(3));
    await run(() => app.session.tapFelt());

    const state = demoStore.getState();
    const primary = primaryTestOfDay(testsOnDay(testsForPatient(state.tests, patientId), today));
    expect(primary).toMatchObject({ outcome: 'FELT', detectedLevel: 3, source: 'ble' });
    expect(testSourceLabel(primary as SensationTest)).toBe('Wearable');
    // The rule engine runs over the same list, so it has seen the new record.
    expect(triageSummaries(state, today).get(patientId)).toBeDefined();
    // Seeded history is never relabelled as coming from the wearable.
    const seeded = state.tests.filter((test) => test.source !== 'ble');
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((test) => test.simulated === true && testSourceLabel(test) === 'Demonstration')).toBe(true);
  });

  it('a not-felt run from the wearable can raise the provisional not-felt flag', async () => {
    const app = mount('hardware');
    await connectHardware(app);
    const patientId = ACTIVE();
    const today = todayKey();
    const flaggedBefore = triageSummaries(demoStore.getState(), today).get(patientId)?.pending.some((flag) => flag.ruleId === 'NO_FELT_RECENT');

    await startHardwareTrial(app);
    await run(() => app.peripheral.finishUnanswered());

    const flags = triageSummaries(demoStore.getState(), today).get(patientId)?.pending.map((flag) => flag.ruleId) ?? [];
    expect(flaggedBefore).toBe(false);
    expect(flags).toContain('NO_FELT_RECENT');
  });
});

describe('choosing between the physical device and the demonstration', () => {
  it('closes the Bluetooth link before switching to the demonstration', async () => {
    const app = mount('hardware');
    await connectHardware(app);

    await run(() => app.device.chooseSource('simulation'));

    expect(app.peripheral.isConnected).toBe(false);
    expect(app.peripheral.calls).toContain('gatt.disconnect');
    expect(app.ble.getConnectionState()).toBe('disconnected');
    expect(app.device.source).toBe('simulation');
    expect(app.device.simulated).toBe(true);
    expect(app.device.label).toBe('Demo device');
    expect(app.device.problem).toBeNull();
  });

  it('switching to the physical device does not connect it or carry the demo’s mode across', async () => {
    const app = mount('simulation');
    await settle();
    expect(app.device.connection).toBe('connected');

    await run(() => app.device.chooseSource('hardware'));

    expect(app.device.simulated).toBe(false);
    expect(app.device.connection).toBe('disconnected');
    expect(app.device.mode).toBeNull();
    expect(app.peripheral.calls).toEqual([]);
  });

  it('a test that was running when the device is switched ends as lost, with nothing saved', async () => {
    const before = allTests().length;
    const app = mount('hardware');
    await connectHardware(app);
    await startHardwareTrial(app);

    await run(() => app.device.chooseSource('simulation'));

    expect(app.session.phase).toEqual({ name: 'connection-lost' });
    expect(allTests()).toHaveLength(before);
  });
});

describe('demonstration mode still works', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it('runs a full simulated test and saves it as simulated, never as a wearable result', async () => {
    demoStore.setScenario({ result: { kind: 'scripted', level: 4 } });
    const app = mount('simulation');
    await advance(100);
    const patientId = ACTIVE();
    const before = testsOf(patientId).length;

    expect(app.device.simulated).toBe(true);
    expect(app.device.label).toBe('Demo device');
    expect(app.device.connection).toBe('connected');

    act(() => app.session.begin());
    await advance(200);
    expect(app.session.phase).toEqual({ name: 'running' });
    await advance(2_000);
    act(() => app.session.tapFelt());
    await advance(100);

    expect(app.session.phase).toMatchObject({ name: 'result', outcome: { outcome: 'FELT', level: 4 } });
    const saved = testsOf(patientId);
    expect(saved).toHaveLength(before + 1);
    const test = saved[saved.length - 1];
    expect(test).toMatchObject({ outcome: 'FELT', detectedLevel: 4, source: 'mock-scripted', simulated: true });
    expect(testSourceLabel(test)).toBe('Demonstration');
    // The Bluetooth adapter was never touched.
    expect(app.peripheral.calls).toEqual([]);
  });

  it('still handles a simulated not-felt run, a stop and a dropped link', async () => {
    demoStore.setScenario({ speed: 6 });
    const app = mount('simulation');
    await advance(100);
    const patientId = ACTIVE();

    act(() => app.session.begin());
    await advance(6_000);
    expect(app.session.phase).toEqual({ name: 'result', outcome: { outcome: 'NO_FELT' } });
    expect(testsOf(patientId).pop()).toMatchObject({ outcome: 'NO_FELT', source: 'mock-timed', simulated: true });

    act(() => app.session.reset());
    act(() => app.session.begin());
    await advance(300);
    act(() => app.session.tapStop());
    await advance(100);
    expect(app.session.phase).toEqual({ name: 'result', outcome: { outcome: 'STOPPED', stopReason: 'USER_STOP' } });

    const before = allTests().length;
    demoStore.setScenario({ dropLinkOnNextTest: true, speed: 1 });
    act(() => app.session.reset());
    act(() => app.session.begin());
    await advance(5_000);
    expect(app.session.phase).toEqual({ name: 'connection-lost' });
    expect(app.device.connection).toBe('disconnected');
    expect(allTests()).toHaveLength(before);
  });

  it('resets the fictional data, including anything the wearable saved', async () => {
    vi.useRealTimers();
    const app = mount('hardware');
    await connectHardware(app);
    await startHardwareTrial(app);
    await run(() => app.peripheral.level(3));
    await run(() => app.session.tapFelt());
    expect(allTests().some((test) => test.source === 'ble')).toBe(true);

    act(() => demoStore.reset('default'));

    expect(allTests().some((test) => test.source === 'ble')).toBe(false);
    expect(allTests().every((test) => test.simulated === true)).toBe(true);
  });
});
