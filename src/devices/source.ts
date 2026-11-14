/**
 * Which wearable this tab talks to: the demonstration, or the physical device.
 *
 * It is always a deliberate choice. Nothing in the app changes it on its own, and
 * in particular a failed Bluetooth connection never falls back to the demonstration.
 *
 * The choice is kept per tab (sessionStorage), because a Bluetooth link belongs to
 * the tab that opened it. A second tab, such as the clinician portal, starts in
 * demonstration mode and cannot pull the physical device away from the first.
 * It survives a reload; the Bluetooth link itself does not, and has to be
 * reconnected by hand.
 */
export type DeviceSource = 'simulation' | 'hardware';

export const DEVICE_SOURCE_KEY = 'ntact.deviceSource';

interface SourceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class DeviceSourceStore {
  private source: DeviceSource;
  private readonly storage: SourceStorage | null;
  private readonly listeners = new Set<() => void>();

  constructor(storage: SourceStorage | null) {
    this.storage = storage;
    let stored: string | null = null;
    try {
      stored = storage?.getItem(DEVICE_SOURCE_KEY) ?? null;
    } catch {
      stored = null;
    }
    // Anything unrecognised is the demonstration, which is always safe to show.
    this.source = stored === 'hardware' ? 'hardware' : 'simulation';
  }

  get = (): DeviceSource => this.source;

  set(next: DeviceSource): void {
    if (next === this.source) return;
    this.source = next;
    try {
      this.storage?.setItem(DEVICE_SOURCE_KEY, next);
    } catch {
      // Storage blocked: the choice still holds for this page load.
    }
    for (const listener of [...this.listeners]) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

function tabStorage(): SourceStorage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** The choice for this tab. */
export const deviceSourceStore = new DeviceSourceStore(tabStorage());
