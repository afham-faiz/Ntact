import type { ConnectionState, DeviceCommand } from '../domain/types';

/**
 * The only seam between the screens and a wearable.
 *
 * Screens and the test state machine depend on this interface and on the plain
 * UTF-8 notification strings the firmware sends. They never import a concrete
 * adapter, so swapping the simulation for Bluetooth is a change in
 * `src/devices/index.ts` and nowhere else.
 */
export interface DeviceAdapter {
  /** 'mock' is the in-browser simulation. 'ble' is reserved for the real build. */
  readonly kind: 'mock' | 'ble';

  /** Human label for the link. The simulation always says "Demo device". */
  readonly label: string;

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
}

export class DeviceNotConnectedError extends Error {
  constructor() {
    super('The device is not connected.');
    this.name = 'DeviceNotConnectedError';
  }
}
