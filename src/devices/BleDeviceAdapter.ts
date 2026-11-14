/**
 * FUTURE ONLY. This file is a design seam, not an implementation.
 *
 * It is not imported anywhere in the prototype and it does not call any
 * Bluetooth API. It exists so the real integration has an agreed shape to fill
 * in and so the notes below sit next to the code they describe.
 *
 * Integration notes (from the V3 handoff, 11 Nov 2026):
 *
 *   Advertised name   SenseBridge-V2.0  (unchanged in V3 firmware)
 *   Service           6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *   RX, app → device  6E400002-B5A3-F393-E0A9-E50E24DCCA9E   write with response
 *   TX, device → app  6E400003-B5A3-F393-E0A9-E50E24DCCA9E   notify + read
 *   Payload           UTF-8 text, comma separated, no guaranteed newline
 *
 *   1. Scan, connect, discover the service, find RX and TX.
 *   2. Subscribe to TX notifications BEFORE writing anything, then write STATUS.
 *   3. Write REHAB and wait for REHAB_READY before writing START.
 *   4. On "I Feel It", write FELT first. Save only after FELT,<level>,<drive>,<ms> arrives.
 *   5. One write at a time. Do not queue STOP behind other writes.
 *   6. On disconnect the firmware goes IDLE. After reconnecting, re-subscribe,
 *      write STATUS, and make the person choose NORMAL or REHAB again. Never resume a trial.
 *   7. The app never drives GPIO or the motor directly. The ESP32 owns the DRV2605L.
 *
 * Platform note: Web Bluetooth is available in Chromium browsers (Android Chrome,
 * desktop Chrome/Edge). iOS Safari has no native Web Bluetooth, so an iPhone demo
 * needs a native wrapper or a different plan. Decide the demo device before building this.
 */
import type { ConnectionState, DeviceCommand } from '../domain/types';
import type { DeviceAdapter } from './DeviceAdapter';

const NOT_IMPLEMENTED =
  'BleDeviceAdapter is a placeholder. The prototype runs on MockDeviceAdapter only.';

export class BleDeviceAdapter implements DeviceAdapter {
  readonly kind = 'ble' as const;
  readonly label = 'Ntact wearable';

  connect(): Promise<void> {
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }

  disconnect(): Promise<void> {
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }

  send(_command: DeviceCommand): Promise<void> {
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }

  subscribe(_onMessage: (message: string) => void): () => void {
    return () => undefined;
  }

  getConnectionState(): ConnectionState {
    return 'disconnected';
  }

  onConnectionChange(_listener: (state: ConnectionState) => void): () => void {
    return () => undefined;
  }
}
