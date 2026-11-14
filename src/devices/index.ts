/**
 * The one place that decides which adapter the app talks to.
 *
 * 'simulation' is the in-browser demonstration, backed by the demo store.
 * 'hardware' is the physical wearable over Web Bluetooth.
 *
 * Both are created once and kept, so switching back and forth never leaves a
 * second copy listening. The screens only ever see the `DeviceAdapter` interface.
 */
import { demoStore } from '../demo/store';
import { BleDeviceAdapter } from './BleDeviceAdapter';
import type { DeviceAdapter } from './DeviceAdapter';
import { MockDeviceAdapter } from './MockDeviceAdapter';
import type { DeviceSource } from './source';

let mockAdapter: MockDeviceAdapter | null = null;
let bleAdapter: BleDeviceAdapter | null = null;

export function getDeviceAdapter(source: DeviceSource = 'simulation'): DeviceAdapter {
  if (source === 'hardware') {
    if (!bleAdapter) {
      // The developer panel reads the same log as the demonstration; entries carry `via: 'ble'`.
      bleAdapter = new BleDeviceAdapter({ log: (entry) => demoStore.logDevice(entry) });
    }
    return bleAdapter;
  }

  if (!mockAdapter) {
    mockAdapter = new MockDeviceAdapter({
      getDevice: () => demoStore.getState().device,
      setDevice: (device) => demoStore.setDevice(device),
      getScenario: () => demoStore.getState().scenario,
      clearDropLink: () => demoStore.setScenario({ dropLinkOnNextTest: false }),
      log: (entry) => demoStore.logDevice({ ...entry, via: 'mock' }),
      subscribe: (listener) => demoStore.subscribe(listener),
    });
  }
  return mockAdapter;
}

export type { DeviceAdapter } from './DeviceAdapter';
export type { DeviceSource } from './source';
