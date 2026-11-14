/**
 * The one place that decides which adapter the app talks to.
 *
 * Today: the in-browser simulation, backed by the demo store.
 * Later: return a BleDeviceAdapter here (see BleDeviceAdapter.ts). No screen changes.
 */
import { demoStore } from '../demo/store';
import type { DeviceAdapter } from './DeviceAdapter';
import { MockDeviceAdapter } from './MockDeviceAdapter';

let adapter: DeviceAdapter | null = null;

export function getDeviceAdapter(): DeviceAdapter {
  if (!adapter) {
    adapter = new MockDeviceAdapter({
      getDevice: () => demoStore.getState().device,
      setDevice: (device) => demoStore.setDevice(device),
      getScenario: () => demoStore.getState().scenario,
      clearDropLink: () => demoStore.setScenario({ dropLinkOnNextTest: false }),
      log: (entry) => demoStore.logDevice(entry),
      subscribe: (listener) => demoStore.subscribe(listener),
    });
  }
  return adapter;
}

export type { DeviceAdapter } from './DeviceAdapter';
