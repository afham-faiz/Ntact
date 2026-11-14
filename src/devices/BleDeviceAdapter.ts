/**
 * The physical wearable, over Web Bluetooth.
 *
 * Written against the V3 handoff (`SenseBridge_V3_BLE_App_Developer_Handoff.pdf`,
 * 11 Nov 2026). The firmware source (`SenseBridge_V3_0.ino`) has not been seen
 * by the app side, so every behaviour below is "as documented", not "as observed".
 *
 *   Advertised name   SenseBridge-V2.0  (unchanged in V3 firmware; the product is now Ntact)
 *   Service           6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *   RX, app → device  6E400002-B5A3-F393-E0A9-E50E24DCCA9E   write with response
 *   TX, device → app  6E400003-B5A3-F393-E0A9-E50E24DCCA9E   notify + read
 *   Payload           UTF-8 text, comma separated, no guaranteed newline
 *
 * What this adapter guarantees:
 *
 *   1. The device list only opens from `connect()`, which the screens call from a tap.
 *   2. TX notifications are subscribed BEFORE the link is reported as connected, so the
 *      first STATUS the app writes cannot be answered into nothing.
 *   3. One write at a time. Web Bluetooth rejects overlapping GATT operations, so
 *      commands are queued; FELT and STOP go to the front of that queue.
 *   4. Nothing is retried, resumed or invented. A dropped link is reported as
 *      disconnected and stays that way until the person reconnects. The firmware goes
 *      IDLE on disconnect, so the app must choose NORMAL or REHAB again afterwards.
 *   5. The adapter never falls back to the simulation. That choice belongs to the person.
 *
 * The Web Bluetooth objects are described by the small `*Like` interfaces below
 * rather than by global DOM types, so the whole adapter can be driven by a fake
 * peripheral in tests (see tests/fakeBle.ts). Passing software tests is not the
 * same as working on a board: see HARDWARE_INTEGRATION.md.
 *
 * Platform note: Web Bluetooth exists in Chrome and Edge on Windows, macOS, Android
 * and ChromeOS, on https:// or localhost only. It does not exist in any iPhone or
 * iPad browser, or in Firefox.
 */
import { BLE_PROFILE } from '../domain/firmware';
import type { ConnectionState, DeviceCommand, DeviceLogEntry } from '../domain/types';
import {
  DeviceConnectError,
  DeviceNotConnectedError,
  type ConnectFailure,
  type ConnectStage,
  type DeviceAdapter,
} from './DeviceAdapter';

// ---------- The slice of Web Bluetooth this adapter uses ----------

export interface BleCharacteristicLike {
  value?: DataView | null;
  startNotifications(): Promise<unknown>;
  addEventListener(type: 'characteristicvaluechanged', listener: (event: Event) => void): void;
  removeEventListener(type: 'characteristicvaluechanged', listener: (event: Event) => void): void;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  /** Older Chromium only. Used when `writeValueWithResponse` is missing. */
  writeValue?(value: BufferSource): Promise<void>;
}

export interface BleServiceLike {
  getCharacteristic(uuid: string): Promise<BleCharacteristicLike>;
}

export interface BleServerLike {
  readonly connected: boolean;
  connect(): Promise<BleServerLike>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BleServiceLike>;
}

export interface BleDeviceLike {
  readonly name?: string | null;
  readonly gatt?: BleServerLike | null;
  addEventListener(type: 'gattserverdisconnected', listener: (event: Event) => void): void;
  removeEventListener(type: 'gattserverdisconnected', listener: (event: Event) => void): void;
}

export interface BleRequestOptions {
  filters: Array<{ name?: string; namePrefix?: string; services?: string[] }>;
  optionalServices: string[];
}

export interface BluetoothLike {
  requestDevice(options: BleRequestOptions): Promise<BleDeviceLike>;
  getAvailability?(): Promise<boolean>;
}

// ---------- Protocol constants ----------

/** Web Bluetooth only accepts lower-case UUIDs. The handoff prints them in upper case. */
export const BLE_UUIDS = {
  service: BLE_PROFILE.serviceUuid.toLowerCase(),
  rx: BLE_PROFILE.rxWriteUuid.toLowerCase(),
  tx: BLE_PROFILE.txNotifyUuid.toLowerCase(),
} as const;

/**
 * What the browser's device list is allowed to show. A device matches if ANY filter
 * matches. The exact name comes first; the service filter is a fallback for a board
 * that advertises the service but a different name; the "Ntact" prefix is there so a
 * future firmware rename does not need an app release. `optionalServices` is what
 * actually grants access to the service after connecting.
 */
export const BLE_REQUEST_OPTIONS: BleRequestOptions = {
  filters: [
    { name: BLE_PROFILE.advertisedName },
    { namePrefix: 'SenseBridge' },
    { namePrefix: 'Ntact' },
    { services: [BLE_UUIDS.service] },
  ],
  optionalServices: [BLE_UUIDS.service],
};

/** Opening the GATT connection. Chrome can otherwise wait indefinitely on a device that went away. */
export const BLE_CONNECT_TIMEOUT_MS = 12_000;
/** Each discovery step after the connection is open. */
export const BLE_DISCOVERY_TIMEOUT_MS = 8_000;
/** One command write, including the device's write response. */
export const BLE_WRITE_TIMEOUT_MS = 4_000;

/** These are never left waiting behind an ordinary command. */
const PRIORITY_COMMANDS: ReadonlySet<DeviceCommand> = new Set<DeviceCommand>(['FELT', 'STOP']);

export type BleSupport =
  | { supported: true }
  | { supported: false; reason: Extract<ConnectFailure, 'unsupported' | 'insecure'> };

/** Whether this page could use Web Bluetooth at all. Does not open anything. */
export function detectBleSupport(): BleSupport {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { supported: false, reason: 'insecure' };
  }
  if (!browserBluetooth()) return { supported: false, reason: 'unsupported' };
  return { supported: true };
}

function browserBluetooth(): BluetoothLike | null {
  if (typeof navigator === 'undefined') return null;
  const candidate = (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth;
  return candidate && typeof candidate.requestDevice === 'function' ? candidate : null;
}

// ---------- Helpers ----------

class StepTimeoutError extends Error {
  constructor() {
    super('The device did not answer in time.');
    this.name = 'StepTimeoutError';
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StepTimeoutError()), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ConnectStep = 'choose' | 'link' | 'discover';

/** Turn whatever Web Bluetooth threw into one of the reasons the screens know how to explain. */
function classifyFailure(error: unknown, step: ConnectStep): DeviceConnectError {
  if (error instanceof DeviceConnectError) return error;
  const name = errorName(error);
  const detail = errorText(error);
  if (error instanceof StepTimeoutError) return new DeviceConnectError('timeout', detail);
  if (name === 'SecurityError' || name === 'NotAllowedError') return new DeviceConnectError('permission', detail);
  if (step === 'choose') {
    // Chrome reports a closed device list as NotFoundError.
    return new DeviceConnectError(name === 'NotFoundError' ? 'cancelled' : 'failed', detail);
  }
  if (step === 'discover') {
    return new DeviceConnectError(name === 'NotFoundError' ? 'service-missing' : 'unreachable', detail);
  }
  return new DeviceConnectError('unreachable', detail);
}

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

/**
 * One notification payload into messages. The handoff says each notification is one
 * message with no guaranteed newline; this also tolerates a trailing NUL or newline,
 * and a payload that carries more than one line.
 */
export function decodeNotification(value: DataView | ArrayBuffer | Uint8Array | null | undefined): string[] {
  if (!value) return [];
  let text: string;
  try {
    text = decoder.decode(value);
  } catch {
    return [];
  }
  return text
    .replace(/\0/g, '')
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface BleAdapterOptions {
  /** Defaults to `navigator.bluetooth`. Tests pass a fake. `null` behaves like an unsupported browser. */
  bluetooth?: BluetoothLike | null;
  /** Receives every command, notification and link event, for the developer panel. */
  log?: (entry: DeviceLogEntry) => void;
}

interface WriteJob {
  command: DeviceCommand;
  resolve(): void;
  reject(error: unknown): void;
}

export class BleDeviceAdapter implements DeviceAdapter {
  readonly kind = 'ble' as const;

  private readonly options: BleAdapterOptions;
  private readonly messageListeners = new Set<(message: string) => void>();
  private readonly connectionListeners = new Set<(state: ConnectionState) => void>();
  private readonly stageListeners = new Set<(stage: ConnectStage | null) => void>();

  private connection: ConnectionState = 'disconnected';
  private stage: ConnectStage | null = null;
  /** Bumped by every connect and disconnect, so a superseded attempt can tell it is stale. */
  private attempt = 0;

  /** Kept after a successful connection so "Reconnect" does not reopen the device list. */
  private device: BleDeviceLike | null = null;
  private rx: BleCharacteristicLike | null = null;
  private tx: BleCharacteristicLike | null = null;

  private readonly queue: WriteJob[] = [];
  private writing = false;

  constructor(options: BleAdapterOptions = {}) {
    this.options = options;
  }

  // ---------- DeviceAdapter ----------

  /** The name the connected board advertises, or a neutral label before one is chosen. */
  get label(): string {
    return this.device?.name?.trim() || 'Ntact device';
  }

  getConnectionState(): ConnectionState {
    return this.connection;
  }

  onConnectionChange(listener: (state: ConnectionState) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  getConnectStage(): ConnectStage | null {
    return this.stage;
  }

  onConnectStageChange(listener: (stage: ConnectStage | null) => void): () => void {
    this.stageListeners.add(listener);
    return () => this.stageListeners.delete(listener);
  }

  subscribe(onMessage: (message: string) => void): () => void {
    this.messageListeners.add(onMessage);
    return () => this.messageListeners.delete(onMessage);
  }

  forgetDevice(): void {
    if (this.connection !== 'disconnected') return;
    this.device = null;
  }

  async connect(): Promise<void> {
    if (this.connection === 'connected' || this.connection === 'connecting') return;

    const bluetooth = this.options.bluetooth === undefined ? browserBluetooth() : this.options.bluetooth;
    if (!bluetooth) {
      const support = detectBleSupport();
      const reason = support.supported ? 'unsupported' : support.reason;
      this.logLink(`Cannot connect: ${reason}`);
      throw new DeviceConnectError(reason);
    }

    const attempt = ++this.attempt;
    let step: ConnectStep = 'choose';
    let chosen: BleDeviceLike | null = null;
    let listening: BleCharacteristicLike | null = null;
    /**
     * True once `disconnect()` (or a newer attempt) has overtaken this one. The first
     * time it notices, it lets go of whatever this attempt had opened so far.
     */
    const stale = (): boolean => {
      if (attempt === this.attempt) return false;
      listening?.removeEventListener('characteristicvaluechanged', this.onNotification);
      if (listening && this.tx === listening) this.tx = null;
      listening = null;
      // Only close the connection if nobody else has started using it since.
      if (chosen && this.connection === 'disconnected') {
        try {
          chosen.gatt?.disconnect();
        } catch {
          // Already closed.
        }
      }
      chosen = null;
      return true;
    };
    this.setConnection('connecting');

    try {
      // Asked before the device list opens, because with the radio off that list is just empty.
      if (!this.device && bluetooth.getAvailability) {
        const available = await bluetooth.getAvailability().catch(() => true);
        if (stale()) return;
        if (!available) throw new DeviceConnectError('bluetooth-off');
      }

      let device = this.device;
      if (!device) {
        this.setStage('choosing');
        this.logLink('Searching for nearby devices');
        device = await bluetooth.requestDevice(BLE_REQUEST_OPTIONS);
        if (stale()) return;
        this.logLink(`Chosen: ${device.name?.trim() || 'unnamed device'}`);
        if (device.name && device.name.trim() !== BLE_PROFILE.advertisedName) {
          this.logLink(`Note: expected the name ${BLE_PROFILE.advertisedName}`);
        }
      }

      step = 'link';
      this.setStage('linking');
      const gatt = device.gatt;
      if (!gatt) throw new DeviceConnectError('unreachable', 'The device exposes no GATT server.');
      this.device = device;
      chosen = device;
      device.addEventListener('gattserverdisconnected', this.onGattDisconnected);
      const server = await withTimeout(gatt.connect(), BLE_CONNECT_TIMEOUT_MS);
      if (stale()) return;

      step = 'discover';
      const service = await withTimeout(server.getPrimaryService(BLE_UUIDS.service), BLE_DISCOVERY_TIMEOUT_MS);
      const rx = await withTimeout(service.getCharacteristic(BLE_UUIDS.rx), BLE_DISCOVERY_TIMEOUT_MS);
      const tx = await withTimeout(service.getCharacteristic(BLE_UUIDS.tx), BLE_DISCOVERY_TIMEOUT_MS);
      if (stale()) return;
      if (!rx.writeValueWithResponse && !rx.writeValue) {
        throw new DeviceConnectError('service-missing', 'The RX characteristic cannot be written.');
      }

      // Handoff: subscribe to TX before sending anything. The app writes STATUS when it
      // hears "connected", which is only announced after this resolves.
      this.tx = tx;
      listening = tx;
      tx.addEventListener('characteristicvaluechanged', this.onNotification);
      await withTimeout(tx.startNotifications(), BLE_DISCOVERY_TIMEOUT_MS);
      if (stale()) return;

      this.rx = rx;
      this.setStage(null);
      this.logLink(`Connected to ${this.label}. Listening for notifications.`);
      this.setConnection('connected');
    } catch (error) {
      if (stale()) return;
      const failure = classifyFailure(error, step);
      this.logLink(`Connection failed: ${failure.reason} (${errorText(error)})`);
      this.releaseLink(true);
      // Whatever went wrong, the next attempt starts from the device list again.
      this.device = null;
      this.setStage(null);
      this.setConnection('disconnected');
      throw failure;
    }
  }

  async disconnect(): Promise<void> {
    this.attempt += 1;
    if (this.connection !== 'disconnected') this.logLink('Disconnected by the app');
    this.releaseLink(true);
    this.setStage(null);
    this.setConnection('disconnected');
  }

  send(command: DeviceCommand): Promise<void> {
    if (this.connection !== 'connected' || !this.rx) return Promise.reject(new DeviceNotConnectedError());
    return new Promise<void>((resolve, reject) => {
      const job: WriteJob = { command, resolve, reject };
      if (PRIORITY_COMMANDS.has(command)) {
        // Ahead of anything ordinary that is still waiting, but behind an earlier FELT or STOP.
        const firstOrdinary = this.queue.findIndex((queued) => !PRIORITY_COMMANDS.has(queued.command));
        if (firstOrdinary === -1) this.queue.push(job);
        else this.queue.splice(firstOrdinary, 0, job);
      } else {
        this.queue.push(job);
      }
      void this.pump();
    });
  }

  // ---------- Writes ----------

  /** Runs the queue one write at a time. The first write starts synchronously with `send`. */
  private async pump(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift() as WriteJob;
        const rx = this.rx;
        if (!rx || this.connection !== 'connected') {
          job.reject(new DeviceNotConnectedError());
          continue;
        }
        this.log('app', job.command);
        try {
          const payload = encoder.encode(job.command);
          const write = rx.writeValueWithResponse
            ? rx.writeValueWithResponse(payload)
            : (rx.writeValue as (value: BufferSource) => Promise<void>)(payload);
          await withTimeout(write, BLE_WRITE_TIMEOUT_MS);
          job.resolve();
        } catch (error) {
          this.logLink(`Write failed for ${job.command}: ${errorText(error)}`);
          job.reject(error);
          // A write that never completes, or fails because the link has gone, means the
          // link cannot be trusted. Report it as lost rather than carrying on half-connected.
          if (error instanceof StepTimeoutError || !this.device?.gatt?.connected) this.handleLinkLost('write failed');
        }
      }
    } finally {
      this.writing = false;
    }
  }

  // ---------- Notifications ----------

  private readonly onNotification = (event: Event): void => {
    const source = event.target as { value?: DataView | null } | null;
    const messages = decodeNotification(source?.value ?? this.tx?.value);
    for (const message of messages) {
      this.log('device', message);
      for (const listener of [...this.messageListeners]) {
        try {
          listener(message);
        } catch {
          // One listener failing must not stop the others hearing the device.
        }
      }
    }
  };

  // ---------- Link ----------

  private readonly onGattDisconnected = (): void => {
    // While still connecting, the step that was in flight fails on its own and
    // `connect()` reports why. Only an established link is "lost".
    if (this.connection === 'connected') this.handleLinkLost('the device disconnected');
  };

  private handleLinkLost(reason: string): void {
    if (this.connection === 'disconnected') return;
    this.attempt += 1;
    this.logLink(`Connection lost (${reason}). The wearable goes idle; nothing is resumed.`);
    this.releaseLink(true);
    this.setStage(null);
    this.setConnection('disconnected');
  }

  /** Remove every listener, drop the characteristics and fail anything still queued. */
  private releaseLink(closeGatt: boolean): void {
    const device = this.device;
    if (this.tx) this.tx.removeEventListener('characteristicvaluechanged', this.onNotification);
    this.tx = null;
    this.rx = null;
    if (device) {
      device.removeEventListener('gattserverdisconnected', this.onGattDisconnected);
      if (closeGatt) {
        try {
          // Called even when not yet connected: it aborts a connection that is still opening.
          device.gatt?.disconnect();
        } catch {
          // Already gone.
        }
      }
    }
    while (this.queue.length > 0) (this.queue.shift() as WriteJob).reject(new DeviceNotConnectedError());
  }

  private setConnection(next: ConnectionState): void {
    if (this.connection === next) return;
    this.connection = next;
    for (const listener of [...this.connectionListeners]) listener(next);
  }

  private setStage(next: ConnectStage | null): void {
    if (this.stage === next) return;
    this.stage = next;
    for (const listener of [...this.stageListeners]) listener(next);
  }

  private log(direction: DeviceLogEntry['direction'], text: string): void {
    this.options.log?.({ at: new Date().toISOString(), direction, text, via: 'ble' });
  }

  private logLink(text: string): void {
    this.log('link', text);
  }
}
