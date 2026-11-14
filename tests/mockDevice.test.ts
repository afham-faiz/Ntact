/**
 * The simulated wearable against the V3 firmware contract.
 *
 * The first block mirrors the handoff's integration acceptance tests (section 12).
 * Time is faked: the adapter delivers every notification NOTIFY_LATENCY_MS after
 * the simulated firmware "sends" it, so each test advances the clock to hear it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoStore } from '../src/demo/store';
import { DeviceNotConnectedError } from '../src/devices/DeviceAdapter';
import {
  CONNECT_DELAY_MS,
  MockDeviceAdapter,
  NOTIFY_LATENCY_MS,
  type MockDeviceHost,
} from '../src/devices/MockDeviceAdapter';
import { DEVICE_COMMANDS, MAX_TRIAL_MS, RTP_BY_LEVEL, parseNotification } from '../src/domain/firmware';
import { testReducer, type TestInput, type TestPhase } from '../src/domain/testSession';
import type { ConnectionState, DeviceCommand, DeviceEvent, TrialOutcome } from '../src/domain/types';
import { FIXED_NOW, MemoryStorage, createDeviceHost } from './helpers';

/** Everything the firmware says during an unanswered run, with the firmware time it says it at. */
const RAMP: [message: string, atMs: number][] = [
  ['LEVEL,0,0', 0],
  ['LEVEL,1,1', 1_000],
  ['LEVEL,2,12', 4_000],
  ['LEVEL,3,24', 7_000],
  ['LEVEL,4,35', 10_000],
  ['LEVEL,5,47', 13_000],
  ['LEVEL,6,58', 16_000],
  ['LEVEL,7,70', 19_000],
  ['LEVEL,8,82', 22_000],
  ['LEVEL,9,93', 25_000],
  ['LEVEL,10,105', 28_000],
  ['COMPLETE,NO_FELT', 31_000],
];
const RAMP_MESSAGES = RAMP.map(([message]) => message);

interface Heard {
  message: string;
  /** Clock time at which the app heard it. */
  at: number;
}

function listenTo(adapter: MockDeviceAdapter) {
  const heard: Heard[] = [];
  const connections: ConnectionState[] = [];
  adapter.subscribe((message) => {
    heard.push({ message, at: Date.now() });
  });
  adapter.onConnectionChange((state) => {
    connections.push(state);
  });
  return { heard, connections, messages: () => heard.map((entry) => entry.message) };
}

function rig(initial: Parameters<typeof createDeviceHost>[0] = {}) {
  const host = createDeviceHost(initial);
  const adapter = new MockDeviceAdapter(host);
  return { host, adapter, ...listenTo(adapter) };
}

/** Let whatever the device has already said cross the simulated transport. */
function deliver(): void {
  vi.advanceTimersByTime(NOTIFY_LATENCY_MS);
}

/** The order the handoff requires: REHAB, wait for REHAB_READY, then START. The trial clock starts on return. */
async function startTrial(adapter: MockDeviceAdapter): Promise<void> {
  await adapter.send('REHAB');
  deliver();
  await adapter.send('START');
}

async function reconnect(adapter: MockDeviceAdapter): Promise<void> {
  const connecting = adapter.connect();
  vi.advanceTimersByTime(CONNECT_DELAY_MS);
  await connecting;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('V3 acceptance tests', () => {
  it('is labelled as a simulation, never as a real wearable', () => {
    const { adapter } = rig();

    expect(adapter.kind).toBe('mock');
    expect(adapter.label).toBe('Demo device');
  });

  it('answers STATUS with STATUS,NORMAL,0 on a freshly powered device', async () => {
    const { adapter, messages } = rig();

    await adapter.send('STATUS');
    expect(messages()).toEqual([]); // nothing is heard before the transport delay
    deliver();

    expect(messages()).toEqual(['STATUS,NORMAL,0']);
  });

  it('refuses START with ERR,SELECT_REHAB unless Rehab was selected first, from NORMAL and from IDLE', async () => {
    const { adapter, messages } = rig();

    await adapter.send('START'); // fresh device: NORMAL
    deliver();
    await adapter.send('STOP'); // now IDLE
    deliver();
    await adapter.send('START');
    vi.advanceTimersByTime(MAX_TRIAL_MS);

    expect(messages()).toEqual(['ERR,SELECT_REHAB', 'STOPPED', 'ERR,SELECT_REHAB']);
  });

  it('REHAB answers REHAB_READY; START then gives LEVEL,0,0, ten levels three seconds apart and COMPLETE,NO_FELT at 31 s', async () => {
    const { adapter, heard, messages } = rig();

    await adapter.send('REHAB');
    deliver();
    expect(messages()).toEqual(['REHAB_READY']);

    await adapter.send('START');
    const startedAt = Date.now();
    vi.advanceTimersByTime(MAX_TRIAL_MS + NOTIFY_LATENCY_MS);

    const trial = heard.slice(1);
    expect(trial.map((entry) => entry.message)).toEqual(RAMP_MESSAGES);
    trial.forEach((entry, index) => {
      const firmwareMs = RAMP[index][1];
      const heardAfterMs = entry.at - startedAt;
      // Never early: nothing is announced before the firmware reaches it...
      expect(heardAfterMs).toBeGreaterThanOrEqual(firmwareMs);
      // ...and never later than the simulated transport delay.
      expect(heardAfterMs).toBeLessThanOrEqual(firmwareMs + NOTIFY_LATENCY_MS);
    });

    vi.advanceTimersByTime(MAX_TRIAL_MS);
    expect(heard).toHaveLength(1 + RAMP.length); // and then it is quiet
  });

  it('reports the running level through STATUS: STATUS,REHAB,5 fourteen seconds in', async () => {
    const { adapter, messages } = rig();
    await startTrial(adapter);
    vi.advanceTimersByTime(14_000);

    await adapter.send('STATUS');
    deliver();

    expect(messages().at(-1)).toBe('STATUS,REHAB,5');
  });

  it('answers FELT about 8.5 s in with FELT,3,24,<elapsed>, and sends no LEVEL or COMPLETE afterwards', async () => {
    const { adapter, messages } = rig();
    await startTrial(adapter);
    vi.advanceTimersByTime(8_500);

    await adapter.send('FELT');
    vi.advanceTimersByTime(MAX_TRIAL_MS * 2);

    const heard = messages();
    // Three levels were announced before the tap. The report is the last thing the device says.
    expect(heard.slice(0, -1)).toEqual(['REHAB_READY', 'LEVEL,0,0', 'LEVEL,1,1', 'LEVEL,2,12', 'LEVEL,3,24']);
    const report = parseNotification(heard[heard.length - 1]);
    if (report.type !== 'FELT') throw new Error(`expected a FELT report, heard ${heard[heard.length - 1]}`);
    expect(report.level).toBe(3);
    expect(report.drive).toBe(24);
    expect(Math.abs(report.elapsedMs - 8_500)).toBeLessThanOrEqual(NOTIFY_LATENCY_MS);
  });

  it('keeps Rehab selected after a result, so the next START begins a new run', async () => {
    const { adapter, messages } = rig();
    await startTrial(adapter);
    vi.advanceTimersByTime(8_500);
    await adapter.send('FELT');
    deliver();

    await adapter.send('STATUS');
    deliver();
    expect(messages().at(-1)).toBe('STATUS,REHAB,0');

    await adapter.send('START');
    deliver();
    expect(messages().at(-1)).toBe('LEVEL,0,0');
  });

  it('answers FELT with ERR,NO_TEST when no trial is running, armed or not', async () => {
    const { adapter, messages } = rig();

    await adapter.send('FELT');
    deliver();
    await adapter.send('REHAB');
    deliver();
    await adapter.send('FELT');
    deliver();

    expect(messages()).toEqual(['ERR,NO_TEST', 'REHAB_READY', 'ERR,NO_TEST']);
  });

  it('answers a tap that lands after the ramp has completed with ERR,NO_TEST, never with a late FELT', async () => {
    const { adapter, messages } = rig();
    await startTrial(adapter);
    vi.advanceTimersByTime(MAX_TRIAL_MS + NOTIFY_LATENCY_MS);
    expect(messages().at(-1)).toBe('COMPLETE,NO_FELT');

    await adapter.send('FELT');
    deliver();
    await adapter.send('STATUS');
    deliver();

    // No detection is reported, and Rehab stays selected with no trial active.
    expect(messages().slice(-2)).toEqual(['ERR,NO_TEST', 'STATUS,REHAB,0']);
  });

  it('START then STOP answers STOPPED, and a following STATUS reports STATUS,IDLE,0', async () => {
    const { adapter, messages } = rig();
    await startTrial(adapter);
    vi.advanceTimersByTime(2_000);

    await adapter.send('STOP');
    deliver();
    await adapter.send('STATUS');
    vi.advanceTimersByTime(MAX_TRIAL_MS);

    expect(messages()).toEqual(['REHAB_READY', 'LEVEL,0,0', 'LEVEL,1,1', 'STOPPED', 'STATUS,IDLE,0']);
  });

  it('NORMAL answers NORMAL_READY and ends a running trial: assist and a test never run together', async () => {
    const { adapter, messages } = rig();
    await startTrial(adapter);
    vi.advanceTimersByTime(2_000);

    await adapter.send('NORMAL');
    deliver();
    await adapter.send('STATUS');
    vi.advanceTimersByTime(MAX_TRIAL_MS);

    expect(messages()).toEqual(['REHAB_READY', 'LEVEL,0,0', 'LEVEL,1,1', 'NORMAL_READY', 'STATUS,NORMAL,0']);
  });
});

describe('link handling', () => {
  it('rejects send with DeviceNotConnectedError while disconnected and while still connecting', async () => {
    const { adapter, messages } = rig();
    await adapter.disconnect();

    await expect(adapter.send('STATUS')).rejects.toBeInstanceOf(DeviceNotConnectedError);

    const connecting = adapter.connect();
    await expect(adapter.send('STATUS')).rejects.toBeInstanceOf(DeviceNotConnectedError);
    vi.advanceTimersByTime(CONNECT_DELAY_MS);
    await connecting;

    await expect(adapter.send('STATUS')).resolves.toBeUndefined();
    deliver();
    expect(messages()).toEqual(['STATUS,IDLE,0']);
  });

  it('goes quiet when disconnected mid-trial; reconnecting takes CONNECT_DELAY_MS and finds the device idle, with no trial resumed', async () => {
    const { host, adapter, connections, messages } = rig();
    await startTrial(adapter);
    vi.advanceTimersByTime(5_000);
    const heardBefore = messages();
    expect(heardBefore).toEqual(['REHAB_READY', 'LEVEL,0,0', 'LEVEL,1,1', 'LEVEL,2,12']);

    await adapter.disconnect();
    expect(adapter.getConnectionState()).toBe('disconnected');
    expect(host.getDevice()).toEqual({ linkUp: false, mode: 'IDLE' });
    vi.advanceTimersByTime(3_000); // level 3 would have been announced in this stretch
    expect(messages()).toEqual(heardBefore);

    const connecting = adapter.connect();
    await vi.advanceTimersByTimeAsync(CONNECT_DELAY_MS - 1);
    expect(adapter.getConnectionState()).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1);
    await connecting;
    expect(adapter.getConnectionState()).toBe('connected');
    expect(connections).toEqual(['disconnected', 'connecting', 'connected']);

    // Back on the link with two thirds of the old ramp still to come: the mode is not
    // restored and the trial does not pick up where it left off.
    await adapter.send('STATUS');
    vi.advanceTimersByTime(MAX_TRIAL_MS * 2);
    expect(messages().slice(heardBefore.length)).toEqual(['STATUS,IDLE,0']);
  });

  it('lets the host pull the link (another tab): the adapter reports disconnected and the running trial is cancelled', async () => {
    const { host, adapter, connections, messages } = rig();
    await startTrial(adapter);
    vi.advanceTimersByTime(5_000);
    const heardBefore = messages();

    host.setDevice({ linkUp: false, mode: 'IDLE' });

    expect(adapter.getConnectionState()).toBe('disconnected');
    expect(connections).toEqual(['disconnected']);
    await expect(adapter.send('FELT')).rejects.toBeInstanceOf(DeviceNotConnectedError);
    vi.advanceTimersByTime(3_000); // level 3 would have been announced in this stretch
    expect(messages()).toEqual(heardBefore);

    // When the other tab brings the link back, this one follows. The device is idle and the
    // cancelled trial stays cancelled, although most of its ramp was still to come.
    host.setDevice({ linkUp: true, mode: 'IDLE' });
    expect(adapter.getConnectionState()).toBe('connected');
    await adapter.send('STATUS');
    vi.advanceTimersByTime(MAX_TRIAL_MS * 2);
    expect(messages().slice(heardBefore.length)).toEqual(['STATUS,IDLE,0']);
  });

  it('treats a device left armed by an earlier page load as idle, and a host with the link down as disconnected', async () => {
    const armed = createDeviceHost({ device: { linkUp: true, mode: 'REHAB' } });
    new MockDeviceAdapter(armed);
    expect(armed.getDevice()).toEqual({ linkUp: true, mode: 'IDLE' });

    const offline = rig({ device: { linkUp: false, mode: 'IDLE' } });
    expect(offline.adapter.getConnectionState()).toBe('disconnected');
    await expect(offline.adapter.send('STATUS')).rejects.toBeInstanceOf(DeviceNotConnectedError);
  });

  it('stops delivering to a listener once it has unsubscribed', async () => {
    const { adapter } = rig();
    const heard: string[] = [];
    const unsubscribe = adapter.subscribe((message) => {
      heard.push(message);
    });

    await adapter.send('STATUS');
    deliver();
    unsubscribe();
    await adapter.send('STATUS');
    deliver();

    expect(heard).toEqual(['STATUS,NORMAL,0']);
  });

  // SUSPECTED BUG (src/devices/MockDeviceAdapter.ts, connect / disconnect / syncWithHost):
  // cancelling a reconnect clears the very timer that would have resolved the promise
  // returned by connect(), so that promise is left pending for ever. Expected: it settles
  // (resolved or rejected) once the attempt is abandoned. Harmless to today's only caller,
  // which does not await it, but anything that does `await adapter.connect()` would hang.
  it('fixed: connect() settles when the attempt is cancelled by disconnect()', async () => {
    const { adapter } = rig();
    await adapter.disconnect();
    let settled = false;
    const mark = (): void => {
      settled = true;
    };
    adapter.connect().then(mark, mark);

    vi.advanceTimersByTime(CONNECT_DELAY_MS / 2);
    await adapter.disconnect();
    await vi.advanceTimersByTimeAsync(CONNECT_DELAY_MS * 2);

    expect(adapter.getConnectionState()).toBe('disconnected');
    expect(settled).toBe(true);
  });
});

describe('demo scenarios', () => {
  it.each([400, 8_500, 29_000])(
    'scripted level 4 reports FELT at level 4 with drive 35 whatever the tap time (%i ms)',
    async (tapAtMs) => {
      const { adapter, messages } = rig({ scenario: { result: { kind: 'scripted', level: 4 } } });
      await startTrial(adapter);
      vi.advanceTimersByTime(tapAtMs);

      await adapter.send('FELT');
      vi.advanceTimersByTime(MAX_TRIAL_MS);

      const report = parseNotification(messages().at(-1) ?? '');
      if (report.type !== 'FELT') throw new Error('expected a FELT report');
      expect(report.level).toBe(4);
      expect(report.drive).toBe(35);
      // The reported time is a moment inside level 4, which runs from 10 s to 13 s.
      expect(report.elapsedMs).toBeGreaterThanOrEqual(10_000);
      expect(report.elapsedMs).toBeLessThan(13_000);
    },
  );

  it('speed 6 completes the whole run in about 31 000 / 6 ms of real time, with the same messages in the same order', async () => {
    const { adapter, heard } = rig({ scenario: { speed: 6 } });
    await adapter.send('REHAB');
    deliver();

    await adapter.send('START');
    const startedAt = Date.now();
    vi.advanceTimersByTime(MAX_TRIAL_MS);

    const trial = heard.slice(1);
    expect(trial.map((entry) => entry.message)).toEqual(RAMP_MESSAGES);
    trial.forEach((entry, index) => {
      const realMs = RAMP[index][1] / 6;
      const heardAfterMs = entry.at - startedAt;
      expect(heardAfterMs).toBeGreaterThanOrEqual(Math.floor(realMs));
      expect(heardAfterMs).toBeLessThanOrEqual(Math.ceil(realMs) + NOTIFY_LATENCY_MS);
    });
  });

  it('speed 6 still reports firmware time: a tap after 1.5 s of real time is FELT,3,24,9000', async () => {
    const { adapter, messages } = rig({ scenario: { speed: 6 } });
    await startTrial(adapter);
    vi.advanceTimersByTime(1_500);

    await adapter.send('FELT');
    vi.advanceTimersByTime(MAX_TRIAL_MS);

    expect(messages().at(-1)).toBe('FELT,3,24,9000');
  });

  it('driverFault makes START answer ERR,DRIVER and no trial begins, until the fault is cleared', async () => {
    const { host, adapter, messages } = rig({ scenario: { driverFault: true } });

    await startTrial(adapter);
    vi.advanceTimersByTime(MAX_TRIAL_MS);
    expect(messages()).toEqual(['REHAB_READY', 'ERR,DRIVER']);

    host.setScenario({ driverFault: false });
    await adapter.send('START');
    deliver();
    expect(messages().at(-1)).toBe('LEVEL,0,0');
  });

  it('dropLinkOnNextTest drops the link about 4 s of firmware time into the next trial, once, and clears the host’s flag', async () => {
    const { host, adapter, connections, messages } = rig({ scenario: { dropLinkOnNextTest: true } });
    await startTrial(adapter);

    vi.advanceTimersByTime(3_500);
    expect(adapter.getConnectionState()).toBe('connected');
    expect(host.getScenario().dropLinkOnNextTest).toBe(true);

    vi.advanceTimersByTime(1_000);
    expect(adapter.getConnectionState()).toBe('disconnected');
    expect(connections).toEqual(['disconnected']);
    expect(host.getScenario().dropLinkOnNextTest).toBe(false);
    expect(host.getDevice()).toEqual({ linkUp: false, mode: 'IDLE' });

    // The trial died with the link: level 2, already on its way, is never heard, and
    // reconnecting straight away does not bring the rest of the ramp back.
    await reconnect(adapter);
    await adapter.send('STATUS');
    vi.advanceTimersByTime(MAX_TRIAL_MS);
    expect(messages()).toEqual(['REHAB_READY', 'LEVEL,0,0', 'LEVEL,1,1', 'STATUS,IDLE,0']);

    // One-shot: the next trial runs to the end.
    await startTrial(adapter);
    vi.advanceTimersByTime(MAX_TRIAL_MS + NOTIFY_LATENCY_MS);
    expect(adapter.getConnectionState()).toBe('connected');
    expect(messages().at(-1)).toBe('COMPLETE,NO_FELT');
  });
});

describe('contract discipline', () => {
  const CONTRACT_SHAPES = [
    /^NORMAL_READY$/,
    /^REHAB_READY$/,
    /^STOPPED$/,
    /^COMPLETE,NO_FELT$/,
    /^STATUS,(IDLE|NORMAL|REHAB),(\d|10)$/,
    /^LEVEL,(\d|10),\d+$/,
    /^FELT,(\d|10),\d+,\d+$/,
    /^ERR,(SELECT_REHAB|DRIVER|NO_TEST)$/,
  ];

  it('never emits anything outside the V3 contract: no pressure, battery or temperature, whatever it is asked to do', async () => {
    const { host, adapter, messages } = rig();
    const say = async (command: DeviceCommand): Promise<void> => {
      await adapter.send(command);
      deliver();
    };

    // Every command, every refusal, every ending and every demo scenario.
    await say('STATUS');
    await say('START'); // refused: Rehab not selected
    await say('FELT'); // refused: no trial
    await say('NORMAL');
    await say('REHAB');
    await say('START');
    vi.advanceTimersByTime(14_000);
    await say('STATUS');
    await say('FELT');
    await say('START');
    vi.advanceTimersByTime(MAX_TRIAL_MS + NOTIFY_LATENCY_MS); // runs to the end unanswered
    await say('START');
    vi.advanceTimersByTime(2_000);
    await say('STOP');
    await say('STATUS');
    host.setScenario({ driverFault: true });
    await say('REHAB');
    await say('START'); // refused: driver fault
    host.setScenario({ driverFault: false, speed: 6, result: { kind: 'scripted', level: 4 } });
    await say('START');
    vi.advanceTimersByTime(900);
    await say('FELT');
    host.setScenario({ speed: 1, result: { kind: 'timed' }, dropLinkOnNextTest: true });
    await say('START');
    vi.advanceTimersByTime(MAX_TRIAL_MS); // the scripted drop takes the link down part-way
    await reconnect(adapter);
    await say('STATUS');

    const emitted = messages();
    const events: DeviceEvent[] = emitted.map(parseNotification);

    for (const [index, message] of emitted.entries()) {
      const event = events[index];
      expect(event.type, message).not.toBe('UNKNOWN');
      expect(CONTRACT_SHAPES.some((shape) => shape.test(message)), message).toBe(true);
      expect(message).not.toMatch(/press|batt|temp|fsr|adc|volt|ampl|gram/i);
      if (event.type === 'LEVEL' || event.type === 'FELT') {
        expect(event.drive, message).toBe(RTP_BY_LEVEL[event.level]);
      }
    }

    // The tour really did visit the whole contract, so the loop above was not vacuous.
    expect(new Set(events.map((event) => event.type))).toEqual(
      new Set(['STATUS', 'NORMAL_READY', 'REHAB_READY', 'LEVEL', 'FELT', 'STOPPED', 'COMPLETE_NO_FELT', 'ERR']),
    );
    expect(new Set(events.flatMap((event) => (event.type === 'ERR' ? [event.code] : [])))).toEqual(
      new Set(['SELECT_REHAB', 'NO_TEST', 'DRIVER']),
    );

    // The device log holds the same conversation and nothing else.
    const logged = (direction: string) =>
      host.logEntries.filter((entry) => entry.direction === direction).map((entry) => entry.text);
    expect(logged('device')).toEqual(emitted);
    for (const command of logged('app')) expect(DEVICE_COMMANDS).toContain(command);
  });
});

describe('wired to the real DemoStore, the way src/devices/index.ts wires it', () => {
  function storeRig() {
    const store = new DemoStore(new MemoryStorage(), FIXED_NOW);
    const host: MockDeviceHost = {
      getDevice: () => store.getState().device,
      setDevice: (device) => store.setDevice(device),
      getScenario: () => store.getState().scenario,
      clearDropLink: () => store.setScenario({ dropLinkOnNextTest: false }),
      log: (entry) => store.logDevice(entry),
      subscribe: (listener) => store.subscribe(listener),
    };
    const adapter = new MockDeviceAdapter(host);
    return { store, adapter, ...listenTo(adapter) };
  }

  it('keeps the wearable’s mode in the store and logs both directions of the conversation', async () => {
    const { store, adapter } = storeRig();
    expect(store.getState().device).toEqual({ linkUp: true, mode: 'NORMAL' });

    await adapter.send('REHAB');
    deliver();
    expect(store.getState().device).toEqual({ linkUp: true, mode: 'REHAB' });
    await adapter.send('STOP');
    deliver();
    expect(store.getState().device).toEqual({ linkUp: true, mode: 'IDLE' });

    expect(store.getState().deviceLog.map((entry) => `${entry.direction}: ${entry.text}`)).toEqual([
      'app: REHAB',
      'device: REHAB_READY',
      'app: STOP',
      'device: STOPPED',
    ]);
  });

  it('follows the link when the store changes it under a running trial (demo controls or another tab)', async () => {
    const { store, adapter, connections, messages } = storeRig();
    await startTrial(adapter);
    vi.advanceTimersByTime(5_000);
    const heardBefore = messages();

    store.setDevice({ linkUp: false, mode: 'IDLE' });
    expect(adapter.getConnectionState()).toBe('disconnected');
    vi.advanceTimersByTime(3_000);
    expect(messages()).toEqual(heardBefore);

    store.setDevice({ linkUp: true, mode: 'IDLE' });
    expect(adapter.getConnectionState()).toBe('connected');
    expect(connections).toEqual(['disconnected', 'connected']);
    vi.advanceTimersByTime(MAX_TRIAL_MS);
    expect(messages()).toEqual(heardBefore); // the cancelled trial does not come back with the link
  });

  // SUSPECTED BUG (src/devices/MockDeviceAdapter.ts, syncWithHost): while a reconnect is in
  // progress the host still says linkUp: false, so ANY store notification is read as "the
  // link was pulled elsewhere". Here an unrelated setting changes half-way through the
  // 700 ms delay; the adapter clears its connect timer, falls back to 'disconnected' and the
  // link never comes up. In the app every store write notifies (check-ins, demo controls,
  // another tab's storage event), so the reconnect can be cancelled by something unrelated.
  // Expected: only a change to the device itself should abort a reconnect.
  it('fixed: an unrelated store update during the reconnect delay does not abort the reconnect', async () => {
    const { store, adapter } = storeRig();
    await adapter.disconnect();
    void adapter.connect();

    await vi.advanceTimersByTimeAsync(CONNECT_DELAY_MS / 2);
    store.setOnboardingSeen(true);
    await vi.advanceTimersByTimeAsync(CONNECT_DELAY_MS);

    expect(adapter.getConnectionState()).toBe('connected');
    expect(store.getState().device).toEqual({ linkUp: true, mode: 'IDLE' });
  });
});

describe('driving the test state machine', () => {
  /** The glue the app puts between the reducer and the adapter, reduced to its essentials. */
  function runSession(adapter: MockDeviceAdapter) {
    let phase: TestPhase = { name: 'ready' };
    const phases: TestPhase[] = [phase];
    const recorded: TrialOutcome[] = [];

    const dispatch = (input: TestInput): void => {
      const step = testReducer(phase, input);
      if (step.phase !== phase) {
        phase = step.phase;
        phases.push(phase);
      }
      for (const effect of step.effects) {
        if (effect.type === 'SEND') {
          adapter.send(effect.command).catch(() => dispatch({ type: 'LINK_LOST' }));
        } else {
          recorded.push(effect.outcome);
        }
      }
    };

    adapter.subscribe((raw) => dispatch({ type: 'DEVICE', event: parseNotification(raw) }));
    adapter.onConnectionChange((next) => {
      if (next !== 'connected') dispatch({ type: 'LINK_LOST' });
    });

    return { dispatch, phases, recorded, phase: () => phase };
  }

  /** BEGIN, then let REHAB_READY and LEVEL,0,0 arrive. The trial clock then reads NOTIFY_LATENCY_MS. */
  async function beginAndReachRunning(session: ReturnType<typeof runSession>): Promise<void> {
    session.dispatch({ type: 'BEGIN' });
    await vi.advanceTimersByTimeAsync(NOTIFY_LATENCY_MS);
    await vi.advanceTimersByTimeAsync(NOTIFY_LATENCY_MS);
    expect(session.phase()).toEqual({ name: 'running' });
  }

  it('sends the tap first and records only once the device reports: level 3, drive 24, with no number on screen before then', async () => {
    const { adapter } = rig();
    const session = runSession(adapter);
    await beginAndReachRunning(session);
    await vi.advanceTimersByTimeAsync(8_500 - NOTIFY_LATENCY_MS);

    session.dispatch({ type: 'TAP_FELT' });
    expect(session.phase()).toEqual({ name: 'responding' });
    expect(session.recorded).toEqual([]);

    await vi.advanceTimersByTimeAsync(NOTIFY_LATENCY_MS);
    expect(session.recorded).toEqual([{ outcome: 'FELT', level: 3, drive: 24, elapsedMs: 8_500 }]);
    expect(session.phase().name).toBe('result');

    // Three LEVEL notifications arrived on the way. None of them reached a phase.
    const shownBeforeResult = session.phases.filter((phase) => phase.name !== 'result');
    expect(shownBeforeResult.map((phase) => phase.name)).toEqual([
      'ready',
      'arming',
      'starting',
      'running',
      'responding',
    ]);
    expect(JSON.stringify(shownBeforeResult)).not.toMatch(/\d/);
  });

  it('records a tap during the silent first second as cancelled, not as a detection', async () => {
    const { adapter } = rig();
    const session = runSession(adapter);
    await beginAndReachRunning(session);

    session.dispatch({ type: 'TAP_FELT' });
    await vi.advanceTimersByTimeAsync(MAX_TRIAL_MS);

    expect(session.recorded).toEqual([{ outcome: 'STOPPED', stopReason: 'EARLY_RESPONSE' }]);
  });

  it('ends a scripted link drop in connection-lost with nothing recorded, and nothing resumes after reconnecting', async () => {
    const { adapter, messages } = rig({ scenario: { dropLinkOnNextTest: true } });
    const session = runSession(adapter);
    await beginAndReachRunning(session);

    await vi.advanceTimersByTimeAsync(5_000); // the scripted drop fires four seconds in
    expect(session.phase()).toEqual({ name: 'connection-lost' });
    expect(session.recorded).toEqual([]);

    // Reconnect at once, while the old ramp would still have most of its levels to run.
    const heardBefore = messages();
    const connecting = adapter.connect();
    await vi.advanceTimersByTimeAsync(CONNECT_DELAY_MS + MAX_TRIAL_MS);
    await connecting;
    expect(adapter.getConnectionState()).toBe('connected');
    expect(messages()).toEqual(heardBefore);
    expect(session.phase()).toEqual({ name: 'connection-lost' });
    expect(session.recorded).toEqual([]);
  });
});
