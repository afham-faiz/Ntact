/**
 * The Bluetooth adapter against a fake peripheral (tests/fakeBle.ts).
 *
 * These are SOFTWARE tests of the app's half of the V3 contract. They do not show
 * that a physical ESP32 connects, advertises the expected name or drives a motor.
 * That is what HARDWARE_INTEGRATION.md is for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BLE_CONNECT_TIMEOUT_MS,
  BLE_REQUEST_OPTIONS,
  BLE_WRITE_TIMEOUT_MS,
  BleDeviceAdapter,
  decodeNotification,
} from '../src/devices/BleDeviceAdapter';
import { DeviceConnectError, DeviceNotConnectedError, type ConnectStage } from '../src/devices/DeviceAdapter';
import { BLE_PROFILE, parseNotification } from '../src/domain/firmware';
import type { ConnectionState, DeviceLogEntry } from '../src/domain/types';
import { FakePeripheral, RX, SERVICE, TX, domError, flush } from './fakeBle';

function rig(configure?: (peripheral: FakePeripheral) => void) {
  const peripheral = new FakePeripheral();
  configure?.(peripheral);
  const log: DeviceLogEntry[] = [];
  const adapter = new BleDeviceAdapter({ bluetooth: peripheral.bluetooth, log: (entry) => log.push(entry) });
  const heard: string[] = [];
  const connections: ConnectionState[] = [];
  const stages: (ConnectStage | null)[] = [];
  adapter.subscribe((message) => heard.push(message));
  adapter.onConnectionChange((state) => connections.push(state));
  adapter.onConnectStageChange((stage) => stages.push(stage));
  return { peripheral, adapter, heard, connections, stages, log };
}

async function failure(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject.');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('connection setup', () => {
  it('is the physical-device adapter and starts disconnected', () => {
    const { adapter } = rig();
    expect(adapter.kind).toBe('ble');
    expect(adapter.getConnectionState()).toBe('disconnected');
    expect(adapter.label).toBe('Ntact device');
  });

  it('follows the handoff order and subscribes to TX before announcing the link', async () => {
    const { peripheral, adapter, connections, stages } = rig();
    let callsWhenConnected: string[] = [];
    adapter.onConnectionChange((state) => {
      if (state === 'connected') callsWhenConnected = [...peripheral.calls];
    });

    await adapter.connect();

    expect(peripheral.calls).toEqual([
      'requestDevice',
      'gatt.connect',
      `getPrimaryService:${SERVICE}`,
      `getCharacteristic:${RX}`,
      `getCharacteristic:${TX}`,
      'startNotifications',
    ]);
    // "connected" is what makes the app write STATUS, so notifications must already be on.
    expect(callsWhenConnected).toContain('startNotifications');
    expect(peripheral.writes).toEqual([]);
    expect(connections).toEqual(['connecting', 'connected']);
    expect(stages).toEqual(['choosing', 'linking', null]);
    expect(adapter.label).toBe('SenseBridge-V2.0');
  });

  it('asks the browser for the documented device, with lower-case UUIDs', async () => {
    const { peripheral, adapter } = rig();
    await adapter.connect();

    expect(peripheral.lastRequest).toEqual(BLE_REQUEST_OPTIONS);
    expect(BLE_REQUEST_OPTIONS.filters[0]).toEqual({ name: 'SenseBridge-V2.0' });
    expect(BLE_REQUEST_OPTIONS.optionalServices).toEqual([BLE_PROFILE.serviceUuid.toLowerCase()]);
    for (const uuid of [SERVICE, RX, TX]) expect(uuid).toBe(uuid.toLowerCase());
  });

  it('does nothing when asked to connect twice', async () => {
    const { peripheral, adapter } = rig();
    await Promise.all([adapter.connect(), adapter.connect()]);
    await adapter.connect();
    expect(peripheral.requestCount).toBe(1);
  });
});

describe('commands', () => {
  it('writes each command as plain UTF-8 text, with response, and hears the reply', async () => {
    const { peripheral, adapter, heard } = rig();
    await adapter.connect();

    await adapter.send('STATUS');
    await adapter.send('REHAB');
    await adapter.send('START');

    expect(peripheral.writes).toEqual(['STATUS', 'REHAB', 'START']);
    expect(heard).toEqual(['STATUS,NORMAL,0', 'REHAB_READY', 'LEVEL,0,0']);
  });

  it('never has two writes in flight, however quickly they are sent', async () => {
    const { peripheral, adapter } = rig();
    await adapter.connect();
    peripheral.holdWrites();

    const all = Promise.all([adapter.send('STATUS'), adapter.send('NORMAL'), adapter.send('REHAB')]);
    await flush();
    // Only the first has reached the device; the rest are waiting their turn.
    expect(peripheral.writes).toEqual(['STATUS']);

    peripheral.releaseWrites();
    await all;
    expect(peripheral.writes).toEqual(['STATUS', 'NORMAL', 'REHAB']);
    expect(peripheral.maxConcurrentWrites).toBe(1);
  });

  it('starts the write in the same tick as send, so a tap is never delayed', async () => {
    const { peripheral, adapter } = rig();
    await adapter.connect();
    void adapter.send('STOP');
    expect(peripheral.writes).toEqual(['STOP']);
  });

  it.each(['FELT', 'STOP'] as const)('puts %s ahead of ordinary commands that are still waiting', async (urgent) => {
    const { peripheral, adapter } = rig();
    await adapter.connect();
    await adapter.send('REHAB');
    await adapter.send('START');
    peripheral.holdWrites();

    const all = Promise.all([adapter.send('STATUS'), adapter.send('STATUS'), adapter.send(urgent)]);
    await flush();
    peripheral.releaseWrites();
    await all;

    expect(peripheral.writes.slice(2)).toEqual(['STATUS', urgent, 'STATUS']);
    expect(peripheral.maxConcurrentWrites).toBe(1);
  });

  it('rejects a command when there is no link', async () => {
    const { adapter } = rig();
    expect(await failure(adapter.send('STATUS'))).toBeInstanceOf(DeviceNotConnectedError);
  });

  it('treats a write that never completes as a lost link', async () => {
    vi.useFakeTimers();
    const { peripheral, adapter, connections } = rig();
    await adapter.connect();
    peripheral.holdWrites();

    const stuck = failure(adapter.send('REHAB'));
    await vi.advanceTimersByTimeAsync(BLE_WRITE_TIMEOUT_MS);

    expect(await stuck).toBeInstanceOf(Error);
    expect(adapter.getConnectionState()).toBe('disconnected');
    expect(connections).toEqual(['connecting', 'connected', 'disconnected']);
  });
});

describe('notifications', () => {
  it('delivers every documented message unchanged, for the shared parser', async () => {
    const { peripheral, adapter, heard } = rig();
    await adapter.connect();
    const documented = [
      'STATUS,REHAB,5',
      'NORMAL_READY',
      'REHAB_READY',
      'LEVEL,3,24',
      'FELT,3,24,8500',
      'STOPPED',
      'COMPLETE,NO_FELT',
      'ERR,SELECT_REHAB',
      'ERR,DRIVER',
      'ERR,NO_TEST',
    ];
    for (const message of documented) peripheral.notify(message);

    expect(heard).toEqual(documented);
    expect(parseNotification(heard[4])).toEqual({ type: 'FELT', level: 3, drive: 24, elapsedMs: 8500 });
    expect(heard.map((message) => parseNotification(message).type)).not.toContain('UNKNOWN');
  });

  it('tolerates a trailing newline, a trailing NUL and two messages in one packet', () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(decodeNotification(bytes('REHAB_READY\r\n'))).toEqual(['REHAB_READY']);
    expect(decodeNotification(bytes('STOPPED\0\0'))).toEqual(['STOPPED']);
    expect(decodeNotification(bytes('LEVEL,1,1\nLEVEL,2,12\n'))).toEqual(['LEVEL,1,1', 'LEVEL,2,12']);
    expect(decodeNotification(bytes('   '))).toEqual([]);
    expect(decodeNotification(null)).toEqual([]);
  });

  it('passes a malformed message through as text, which the parser marks UNKNOWN', async () => {
    const { peripheral, adapter, heard } = rig();
    await adapter.connect();

    peripheral.notify('LEVEL,three,24');
    peripheral.notify('HELLO');
    peripheral.notifyBytes(new Uint8Array([0xff, 0xfe, 0x00]));
    peripheral.notify('FELT,3,24');

    expect(heard).toHaveLength(4);
    for (const message of heard) expect(parseNotification(message).type).toBe('UNKNOWN');
  });

  it('keeps delivering to the other listeners when one throws', async () => {
    const { peripheral, adapter, heard } = rig();
    adapter.subscribe(() => {
      throw new Error('listener bug');
    });
    await adapter.connect();
    peripheral.notify('NORMAL_READY');
    expect(heard).toEqual(['NORMAL_READY']);
  });

  it('stops delivering after unsubscribe', async () => {
    const { peripheral, adapter } = rig();
    const late: string[] = [];
    const off = adapter.subscribe((message) => late.push(message));
    await adapter.connect();
    peripheral.notify('NORMAL_READY');
    off();
    peripheral.notify('REHAB_READY');
    expect(late).toEqual(['NORMAL_READY']);
  });
});

describe('connection failures', () => {
  it('reports an unsupported browser without opening anything', async () => {
    const adapter = new BleDeviceAdapter({ bluetooth: null });
    const error = await failure(adapter.connect());
    expect(error).toBeInstanceOf(DeviceConnectError);
    expect((error as DeviceConnectError).reason).toBe('unsupported');
    expect(adapter.getConnectionState()).toBe('disconnected');
  });

  const cases: [string, (peripheral: FakePeripheral) => void, string][] = [
    ['the device list is closed', (p) => (p.faults.chooser = domError('NotFoundError')), 'cancelled'],
    ['the browser blocks Bluetooth', (p) => (p.faults.chooser = domError('SecurityError')), 'permission'],
    ['Bluetooth is switched off', (p) => (p.faults.radioOff = true), 'bluetooth-off'],
    ['the device cannot be reached', (p) => (p.faults.connect = domError('NetworkError')), 'unreachable'],
    ['the service is missing', (p) => (p.faults.noService = true), 'service-missing'],
    ['the TX characteristic is missing', (p) => (p.faults.noTx = true), 'service-missing'],
  ];

  it.each(cases)('ends disconnected with a reason when %s', async (_label, configure, reason) => {
    const { peripheral, adapter, connections } = rig(configure);

    const error = await failure(adapter.connect());

    expect(error).toBeInstanceOf(DeviceConnectError);
    expect((error as DeviceConnectError).reason).toBe(reason);
    expect(adapter.getConnectionState()).toBe('disconnected');
    expect(connections[connections.length - 1]).toBe('disconnected');
    expect(connections).not.toContain('connected');
    // Nothing is left listening, and nothing was written to a device that never connected.
    expect(peripheral.listenerCount).toBe(0);
    expect(peripheral.writes).toEqual([]);
    expect(await failure(adapter.send('STATUS'))).toBeInstanceOf(DeviceNotConnectedError);
  });

  it('gives up on a connection that never opens', async () => {
    vi.useFakeTimers();
    const { adapter } = rig((p) => (p.faults.connectHangs = true));

    const attempt = failure(adapter.connect());
    await vi.advanceTimersByTimeAsync(BLE_CONNECT_TIMEOUT_MS);

    expect(((await attempt) as DeviceConnectError).reason).toBe('timeout');
    expect(adapter.getConnectionState()).toBe('disconnected');
  });

  it('goes back to the device list after any failed attempt', async () => {
    const { peripheral, adapter } = rig((p) => (p.faults.connect = domError('NetworkError')));
    await failure(adapter.connect());
    peripheral.faults = {};
    await adapter.connect();
    expect(peripheral.requestCount).toBe(2);
    expect(adapter.getConnectionState()).toBe('connected');
  });

  it('can be cancelled while the device list is open', async () => {
    const { peripheral, adapter, connections } = rig();
    let choose: (() => void) | null = null;
    const original = peripheral.bluetooth.requestDevice;
    peripheral.bluetooth.requestDevice = (options) =>
      new Promise((resolve) => {
        choose = () => resolve(original(options));
      });

    const attempt = adapter.connect();
    await flush();
    expect(adapter.getConnectionState()).toBe('connecting');

    await adapter.disconnect();
    (choose as (() => void) | null)?.();
    await attempt;
    await flush();

    expect(adapter.getConnectionState()).toBe('disconnected');
    expect(connections).toEqual(['connecting', 'disconnected']);
    expect(peripheral.calls).not.toContain('gatt.connect');
  });
});

describe('losing and restoring the link', () => {
  it('reports a dropped link, releases its listeners and fails anything queued', async () => {
    const { peripheral, adapter, connections } = rig();
    await adapter.connect();
    peripheral.holdWrites();
    const inFlight = failure(adapter.send('STATUS'));
    const queued = failure(adapter.send('REHAB'));
    await flush();

    peripheral.dropLink();
    peripheral.releaseWrites();

    expect(await queued).toBeInstanceOf(DeviceNotConnectedError);
    expect(await inFlight).toBeInstanceOf(Error);
    expect(connections).toEqual(['connecting', 'connected', 'disconnected']);
    expect(peripheral.listenerCount).toBe(0);
    expect(peripheral.writes).toEqual(['STATUS']);
  });

  it('does not reconnect on its own', async () => {
    vi.useFakeTimers();
    const { peripheral, adapter } = rig();
    await adapter.connect();
    peripheral.dropLink();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(adapter.getConnectionState()).toBe('disconnected');
    expect(peripheral.calls.filter((call) => call === 'gatt.connect')).toHaveLength(1);
  });

  it('reconnects to the remembered device without the device list, and re-subscribes', async () => {
    const { peripheral, adapter, heard } = rig();
    await adapter.connect();
    peripheral.dropLink();

    await adapter.connect();

    expect(peripheral.requestCount).toBe(1);
    expect(peripheral.calls.filter((call) => call === 'startNotifications')).toHaveLength(2);
    expect(adapter.getConnectionState()).toBe('connected');

    // The firmware is idle after any reconnect, and the adapter sends nothing by itself.
    expect(peripheral.writes).toEqual([]);
    await adapter.send('STATUS');
    expect(heard).toEqual(['STATUS,IDLE,0']);
  });

  it('shows the device list again once the device is forgotten', async () => {
    const { peripheral, adapter } = rig();
    await adapter.connect();
    await adapter.disconnect();
    adapter.forgetDevice();
    await adapter.connect();
    expect(peripheral.requestCount).toBe(2);
  });

  it('closes the link and stops listening on a deliberate disconnect', async () => {
    const { peripheral, adapter, heard, connections } = rig();
    await adapter.connect();

    await adapter.disconnect();
    peripheral.notify('NORMAL_READY');

    expect(peripheral.calls).toContain('gatt.disconnect');
    expect(peripheral.isConnected).toBe(false);
    expect(peripheral.listenerCount).toBe(0);
    expect(heard).toEqual([]);
    expect(connections).toEqual(['connecting', 'connected', 'disconnected']);
  });
});

describe('developer log', () => {
  it('records commands, notifications and link events, all marked as Bluetooth', async () => {
    const { peripheral, adapter, log } = rig();
    await adapter.connect();
    await adapter.send('STATUS');
    peripheral.dropLink();

    expect(log.every((entry) => entry.via === 'ble')).toBe(true);
    expect(log.filter((entry) => entry.direction === 'app').map((entry) => entry.text)).toEqual(['STATUS']);
    expect(log.filter((entry) => entry.direction === 'device').map((entry) => entry.text)).toEqual(['STATUS,NORMAL,0']);
    const link = log.filter((entry) => entry.direction === 'link').map((entry) => entry.text);
    expect(link[0]).toBe('Searching for nearby devices');
    expect(link.some((text) => text.startsWith('Connected to SenseBridge-V2.0'))).toBe(true);
    expect(link[link.length - 1]).toMatch(/^Connection lost/);
  });

  it('notes when the chosen device does not have the documented name', async () => {
    const { adapter, log } = rig((p) => (p.name = 'Ntact-V3'));
    await adapter.connect();
    expect(log.map((entry) => entry.text)).toContain('Note: expected the name SenseBridge-V2.0');
    expect(adapter.label).toBe('Ntact-V3');
  });
});
