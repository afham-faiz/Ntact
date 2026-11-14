/**
 * A pretend ESP32 behind a pretend Web Bluetooth, for testing the real adapter.
 *
 * It follows the V3 handoff at the protocol level: the same six commands, the
 * same notification strings, IDLE after a disconnect, NORMAL after power-on.
 * Timing is NOT simulated: a test moves the trial along by calling `level()`,
 * `finishUnanswered()` and so on, so nothing here depends on a clock.
 *
 * This proves the app's side of the contract. It proves nothing about a real
 * board, a real radio or a real motor.
 */
import type {
  BleCharacteristicLike,
  BleDeviceLike,
  BleRequestOptions,
  BleServerLike,
  BleServiceLike,
  BluetoothLike,
} from '../src/devices/BleDeviceAdapter';
import { RTP_BY_LEVEL } from '../src/domain/firmware';
import type { DeviceMode } from '../src/domain/types';

export const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export function domError(name: string, message = name): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

type Listener = (event: Event) => void;

export interface PeripheralFaults {
  /** `requestDevice` rejects with this (NotFoundError = the person closed the list). */
  chooser?: Error;
  /** `getAvailability` answers false: no radio, or switched off. */
  radioOff?: boolean;
  /** `gatt.connect` rejects with this. */
  connect?: Error;
  /** `gatt.connect` never settles. */
  connectHangs?: boolean;
  /** The service is not there: a different device, or different firmware. */
  noService?: boolean;
  /** The service is there but the TX characteristic is not. */
  noTx?: boolean;
  /** START is answered with ERR,DRIVER. */
  driverFault?: boolean;
  /** Commands are written but never answered. */
  silent?: boolean;
  /** Every write rejects with this. */
  write?: Error;
}

export class FakePeripheral {
  name: string | null = 'SenseBridge-V2.0';
  faults: PeripheralFaults = {};

  /** Firmware state. A freshly powered board reports NORMAL. */
  mode: DeviceMode = 'NORMAL';
  trialLevel: number | null = null;
  /** What the firmware reports as elapsed time when it answers FELT. */
  elapsedMs = 8_500;
  /** When true, a FELT command is received but not answered until `answerFelt()`. */
  holdFelt = false;

  /** Every Web Bluetooth call and every write, in order. */
  readonly calls: string[] = [];
  /** Just the command words written to RX, in order. */
  readonly writes: string[] = [];
  lastRequest: BleRequestOptions | null = null;
  requestCount = 0;
  /** The most writes that were ever in flight at once. More than 1 is a protocol violation. */
  maxConcurrentWrites = 0;

  private connected = false;
  private notifying = false;
  private inFlight = 0;
  private writeGate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;
  private feltPending = false;
  private readonly valueListeners = new Set<Listener>();
  private readonly disconnectListeners = new Set<Listener>();
  private txValue: DataView | null = null;

  // ---------- Web Bluetooth surface ----------

  readonly tx: BleCharacteristicLike = {
    get value() {
      return null;
    },
    startNotifications: async () => {
      this.calls.push('startNotifications');
      this.notifying = true;
    },
    addEventListener: (_type, listener) => {
      this.valueListeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      this.valueListeners.delete(listener);
    },
  };

  readonly rx: BleCharacteristicLike = {
    startNotifications: async () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    writeValueWithResponse: async (value: BufferSource) => {
      const text = new TextDecoder().decode(value);
      this.calls.push(`write:${text}`);
      this.writes.push(text);
      if (this.inFlight > 0) {
        this.maxConcurrentWrites = Math.max(this.maxConcurrentWrites, this.inFlight + 1);
        throw domError('NetworkError', 'GATT operation already in progress.');
      }
      this.inFlight += 1;
      this.maxConcurrentWrites = Math.max(this.maxConcurrentWrites, this.inFlight);
      try {
        if (this.writeGate) await this.writeGate;
        if (this.faults.write) throw this.faults.write;
        if (!this.connected) throw domError('NetworkError', 'GATT Server is disconnected.');
      } finally {
        this.inFlight -= 1;
      }
      // The firmware acts after the write is acknowledged.
      this.receive(text);
    },
  };

  private readonly service: BleServiceLike = {
    getCharacteristic: async (uuid: string) => {
      this.calls.push(`getCharacteristic:${uuid}`);
      if (uuid === RX) return this.rx;
      if (uuid === TX && !this.faults.noTx) return this.tx;
      throw domError('NotFoundError', 'No Characteristics matching UUID.');
    },
  };

  private readonly server: BleServerLike = (() => {
    const peripheral = this;
    return {
      get connected() {
        return peripheral.connected;
      },
      connect: async () => {
        peripheral.calls.push('gatt.connect');
        if (peripheral.faults.connectHangs) return new Promise<BleServerLike>(() => undefined);
        if (peripheral.faults.connect) throw peripheral.faults.connect;
        peripheral.connected = true;
        return peripheral.server;
      },
      disconnect: () => {
        peripheral.calls.push('gatt.disconnect');
        peripheral.powerDownLink(false);
      },
      getPrimaryService: async (uuid: string) => {
        peripheral.calls.push(`getPrimaryService:${uuid}`);
        if (!peripheral.connected) throw domError('NetworkError', 'GATT Server is disconnected.');
        if (uuid !== SERVICE || peripheral.faults.noService) throw domError('NotFoundError', 'No Services matching UUID.');
        return peripheral.service;
      },
    };
  })();

  readonly device: BleDeviceLike = (() => {
    const peripheral = this;
    return {
      get name() {
        return peripheral.name;
      },
      get gatt() {
        return peripheral.server;
      },
      addEventListener: (_type: 'gattserverdisconnected', listener: Listener) => {
        peripheral.disconnectListeners.add(listener);
      },
      removeEventListener: (_type: 'gattserverdisconnected', listener: Listener) => {
        peripheral.disconnectListeners.delete(listener);
      },
    };
  })();

  readonly bluetooth: BluetoothLike = {
    getAvailability: async () => !this.faults.radioOff,
    requestDevice: async (options: BleRequestOptions) => {
      this.calls.push('requestDevice');
      this.requestCount += 1;
      this.lastRequest = options;
      if (this.faults.chooser) throw this.faults.chooser;
      return this.device;
    },
  };

  // ---------- Firmware ----------

  private receive(raw: string): void {
    if (this.faults.silent) return;
    const command = raw.trim().toUpperCase();
    switch (command) {
      case 'STATUS':
        this.notify(`STATUS,${this.mode},${this.trialLevel ?? 0}`);
        return;
      case 'NORMAL':
        this.trialLevel = null;
        this.mode = 'NORMAL';
        this.notify('NORMAL_READY');
        return;
      case 'REHAB':
        this.trialLevel = null;
        this.mode = 'REHAB';
        this.notify('REHAB_READY');
        return;
      case 'START':
        if (this.mode !== 'REHAB') return this.notify('ERR,SELECT_REHAB');
        if (this.faults.driverFault) return this.notify('ERR,DRIVER');
        this.trialLevel = 0;
        this.notify('LEVEL,0,0');
        return;
      case 'FELT':
        if (this.holdFelt) {
          this.feltPending = true;
          return;
        }
        this.answerFelt();
        return;
      case 'STOP':
        this.trialLevel = null;
        this.mode = 'IDLE';
        this.notify('STOPPED');
        return;
      default:
        return;
    }
  }

  /** The firmware's reply to FELT: motor off, then the level it was on. */
  answerFelt(): void {
    this.feltPending = false;
    if (this.trialLevel === null) return this.notify('ERR,NO_TEST');
    const level = this.trialLevel;
    this.trialLevel = null;
    this.notify(`FELT,${level},${RTP_BY_LEVEL[level]},${this.elapsedMs}`);
  }

  get feltWaiting(): boolean {
    return this.feltPending;
  }

  /** The automatic ramp reaches `level` (1 to 10). */
  level(level: number): void {
    if (this.trialLevel === null) throw new Error('No trial is running on the fake peripheral.');
    this.trialLevel = level;
    this.notify(`LEVEL,${level},${RTP_BY_LEVEL[level]}`);
  }

  /** All ten levels ran with no FELT. Rehab stays selected. */
  finishUnanswered(): void {
    this.trialLevel = null;
    this.notify('COMPLETE,NO_FELT');
  }

  /** Send any text on TX, exactly as given. */
  notify(text: string): void {
    this.notifyBytes(new TextEncoder().encode(text));
  }

  notifyBytes(bytes: Uint8Array): void {
    if (!this.connected || !this.notifying) return;
    this.txValue = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const event = { target: { value: this.txValue } } as unknown as Event;
    for (const listener of [...this.valueListeners]) listener(event);
  }

  // ---------- Things that happen to the link ----------

  /** The board went out of range or lost power. */
  dropLink(): void {
    this.powerDownLink(true);
  }

  private powerDownLink(announce: boolean): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.notifying = false;
    // V3: motor off and IDLE whenever the link goes.
    this.trialLevel = null;
    this.mode = 'IDLE';
    this.feltPending = false;
    if (announce && wasConnected) {
      for (const listener of [...this.disconnectListeners]) listener({} as Event);
    }
  }

  /** Hold every write open until `releaseWrites()`, to observe queueing. */
  holdWrites(): void {
    this.writeGate = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
    });
  }

  releaseWrites(): void {
    this.releaseGate?.();
    this.writeGate = null;
    this.releaseGate = null;
  }

  get listenerCount(): number {
    return this.valueListeners.size + this.disconnectListeners.size;
  }

  get isConnected(): boolean {
    return this.connected;
  }
}

/** Let pending promise callbacks run. */
export async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
