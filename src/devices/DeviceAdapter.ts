import type { ConnectionState, DeviceCommand } from '../domain/types';

/**
 * The only seam between the screens and a wearable.
 *
 * Screens and the test state machine depend on this interface and on the plain
 * UTF-8 notification strings the firmware sends. They never import a concrete
 * adapter, so the simulation and the Bluetooth link are interchangeable: which
 * one is in use is decided in `src/devices/index.ts` and nowhere else.
 */
export interface DeviceAdapter {
  /** 'mock' is the in-browser simulation. 'ble' is the physical wearable over Web Bluetooth. */
  readonly kind: 'mock' | 'ble';

  /** Human label for the link. The simulation always says "Demo device". */
  readonly label: string;

  /**
   * Bring the link up. The Bluetooth adapter must be called from a user gesture
   * (a tap or click) and rejects with `DeviceConnectError` when it cannot connect.
   */
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /**
   * Write one command. Resolves once the write is accepted, not when the device
   * has acted on it: outcomes always arrive as notifications.
   * Rejects with `DeviceNotConnectedError` when there is no link.
   */
  send(command: DeviceCommand): Promise<void>;

  /** Raw TX notifications, one message per call. Returns an unsubscribe function. */
  subscribe(onMessage: (message: string) => void): () => void;

  getConnectionState(): ConnectionState;
  onConnectionChange(listener: (state: ConnectionState) => void): () => void;

  /** Finer progress while `connecting`. Optional: the simulation has only one step. */
  getConnectStage?(): ConnectStage | null;
  onConnectStageChange?(listener: (stage: ConnectStage | null) => void): () => void;

  /** Drop the remembered device so the next `connect()` asks the person to choose again. */
  forgetDevice?(): void;
}

/**
 * choosing: the browser's device list is open and scanning.
 * linking: a device was chosen; connecting and finding its service.
 */
export type ConnectStage = 'choosing' | 'linking';

export class DeviceNotConnectedError extends Error {
  constructor() {
    super('The device is not connected.');
    this.name = 'DeviceNotConnectedError';
  }
}

/**
 * Why a connection attempt did not produce a link.
 *
 * unsupported      this browser has no Web Bluetooth (for example iPhone Safari, Firefox)
 * insecure         the page is not on https:// or localhost, so the browser withholds Bluetooth
 * bluetooth-off    the computer has no Bluetooth radio, or it is switched off
 * cancelled        the person closed the device list without choosing anything
 * permission       the browser or a site setting blocked Bluetooth
 * unreachable      a device was chosen but the connection could not be opened
 * timeout          the device stopped answering part-way through connecting
 * service-missing  it connected, but is not running the expected V3 service and characteristics
 * failed           anything else
 */
export type ConnectFailure =
  | 'unsupported'
  | 'insecure'
  | 'bluetooth-off'
  | 'cancelled'
  | 'permission'
  | 'unreachable'
  | 'timeout'
  | 'service-missing'
  | 'failed';

export class DeviceConnectError extends Error {
  readonly reason: ConnectFailure;

  constructor(reason: ConnectFailure, detail?: string) {
    super(detail ? `Could not connect (${reason}): ${detail}` : `Could not connect (${reason}).`);
    this.name = 'DeviceConnectError';
    this.reason = reason;
  }
}
