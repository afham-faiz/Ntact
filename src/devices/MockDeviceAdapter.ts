/**
 * In-browser simulation of the Ntact V3 firmware.
 *
 * It answers the same six commands with the same notification strings and the
 * same timing as the handoff describes, so the app above it is written exactly
 * as it will be for Bluetooth. No radio, no hardware, no network.
 *
 * What it deliberately does not simulate: pressure readings, temperature,
 * battery level or measured vibration. V3 does not send those, so neither does this.
 */
import {
  LEVEL_COUNT,
  LEVEL_DURATION_MS,
  MAX_TRIAL_MS,
  SILENT_STAGE_MS,
  driveForLevel,
  levelAtElapsed,
  levelStartMs,
} from '../domain/firmware';
import type {
  ConnectionState,
  DeviceCommand,
  DeviceLogEntry,
  DeviceMode,
  RehabLevel,
  Scenario,
  SimulatedDevice,
} from '../domain/types';
import { DeviceNotConnectedError, type DeviceAdapter } from './DeviceAdapter';

/** Where the simulated wearable keeps its state. In the app this is the demo store. */
export interface MockDeviceHost {
  getDevice(): SimulatedDevice;
  setDevice(next: SimulatedDevice): void;
  getScenario(): Scenario;
  /** Called once a one-shot scripted fault has fired. */
  clearDropLink(): void;
  log(entry: DeviceLogEntry): void;
  subscribe(listener: () => void): () => void;
}

/** Stand-in for BLE transport delay between the device acting and the app hearing about it. */
export const NOTIFY_LATENCY_MS = 40;
/** How long the pretend reconnect takes. */
export const CONNECT_DELAY_MS = 700;
/** When a scripted link drop fires, in firmware time. */
export const SCRIPTED_DROP_AT_MS = 4_000;
/** Scripted results report a tap this far into the chosen level. */
const SCRIPTED_OFFSET_IN_LEVEL_MS = 1_400;

interface Trial {
  startedAt: number;
  speed: number;
  scriptedLevel: RehabLevel | null;
  timers: ReturnType<typeof setTimeout>[];
}

export class MockDeviceAdapter implements DeviceAdapter {
  readonly kind = 'mock' as const;
  readonly label = 'Demo device';

  private readonly host: MockDeviceHost;
  private readonly messageListeners = new Set<(message: string) => void>();
  private readonly connectionListeners = new Set<(state: ConnectionState) => void>();
  private connection: ConnectionState;
  private trial: Trial | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private abortConnect: (() => void) | null = null;

  constructor(host: MockDeviceHost) {
    this.host = host;
    const device = host.getDevice();
    this.connection = device.linkUp ? 'connected' : 'disconnected';

    // A page load cannot carry a running trial across. Treat an armed device as idle,
    // the same state the firmware falls back to when the link drops.
    if (device.mode === 'REHAB') host.setDevice({ ...device, mode: 'IDLE' });

    // Another tab (or the demo panel) can pull the link out from under us.
    host.subscribe(() => this.syncWithHost());
  }

  // ---------- DeviceAdapter ----------

  getConnectionState(): ConnectionState {
    return this.connection;
  }

  onConnectionChange(listener: (state: ConnectionState) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  subscribe(onMessage: (message: string) => void): () => void {
    this.messageListeners.add(onMessage);
    return () => this.messageListeners.delete(onMessage);
  }

  async connect(): Promise<void> {
    if (this.connection === 'connected' || this.connection === 'connecting') return;
    this.setConnection('connecting');
    const cancelled = await new Promise<boolean>((resolve) => {
      this.connectTimer = setTimeout(() => resolve(false), CONNECT_DELAY_MS);
      this.abortConnect = () => resolve(true);
    });
    this.connectTimer = null;
    this.abortConnect = null;
    // The attempt was abandoned (disconnect was called): settle without bringing the link up.
    if (cancelled) return;
    // After any reconnect the firmware is idle. The app must choose a mode again.
    this.host.setDevice({ linkUp: true, mode: 'IDLE' });
    this.logLink('Simulated link up');
    this.setConnection('connected');
  }

  async disconnect(): Promise<void> {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.abortConnect?.();
    this.dropLink('Simulated link closed by the app');
  }

  async send(command: DeviceCommand): Promise<void> {
    if (this.connection !== 'connected') throw new DeviceNotConnectedError();
    this.host.log({ at: new Date().toISOString(), direction: 'app', text: command });

    switch (command) {
      case 'STATUS':
        this.notify(`STATUS,${this.mode},${this.currentLevel() ?? 0}`);
        return;

      case 'NORMAL':
        this.cancelTrial();
        this.setMode('NORMAL');
        this.notify('NORMAL_READY');
        return;

      case 'REHAB':
        this.cancelTrial();
        this.setMode('REHAB');
        this.notify('REHAB_READY');
        return;

      case 'START':
        if (this.mode !== 'REHAB') {
          this.notify('ERR,SELECT_REHAB');
          return;
        }
        if (this.host.getScenario().driverFault) {
          this.notify('ERR,DRIVER');
          return;
        }
        this.beginTrial();
        return;

      case 'FELT':
        this.reportFelt();
        return;

      case 'STOP':
        // Motor off, then STOPPED, then idle. Applies in any mode.
        this.cancelTrial();
        this.setMode('IDLE');
        this.notify('STOPPED');
        return;
    }
  }

  // ---------- Simulated firmware ----------

  private get mode(): DeviceMode {
    return this.host.getDevice().mode;
  }

  private setMode(mode: DeviceMode): void {
    const device = this.host.getDevice();
    if (device.mode !== mode) this.host.setDevice({ ...device, mode });
  }

  /** Firmware-time elapsed in the running trial, allowing for the demo speed control. */
  private firmwareElapsed(trial: Trial): number {
    return Math.round((Date.now() - trial.startedAt) * trial.speed);
  }

  private currentLevel(): number | null {
    if (!this.trial) return null;
    return levelAtElapsed(this.firmwareElapsed(this.trial));
  }

  private beginTrial(): void {
    this.cancelTrial();
    const scenario = this.host.getScenario();
    const speed = scenario.speed;
    const trial: Trial = {
      startedAt: Date.now(),
      speed,
      scriptedLevel: scenario.result.kind === 'scripted' ? scenario.result.level : null,
      timers: [],
    };
    this.trial = trial;

    // Silent first second.
    this.notify('LEVEL,0,0');

    for (let level = 1; level <= LEVEL_COUNT; level += 1) {
      const at = (SILENT_STAGE_MS + (level - 1) * LEVEL_DURATION_MS) / speed;
      trial.timers.push(
        setTimeout(() => {
          if (this.trial === trial) this.notify(`LEVEL,${level},${driveForLevel(level)}`);
        }, at),
      );
    }

    trial.timers.push(
      setTimeout(() => {
        if (this.trial !== trial) return;
        this.trial = null;
        // All ten levels ran and nobody reported feeling anything. Rehab stays selected.
        this.notify('COMPLETE,NO_FELT');
      }, MAX_TRIAL_MS / speed),
    );

    if (scenario.dropLinkOnNextTest) {
      trial.timers.push(
        setTimeout(() => {
          if (this.trial !== trial) return;
          this.host.clearDropLink();
          this.dropLink('Simulated link lost (scripted in demo controls)');
        }, SCRIPTED_DROP_AT_MS / speed),
      );
    }
  }

  private reportFelt(): void {
    const trial = this.trial;
    if (!trial) {
      this.notify('ERR,NO_TEST');
      return;
    }

    let level: number;
    let elapsedMs: number;
    if (trial.scriptedLevel !== null) {
      level = trial.scriptedLevel;
      elapsedMs = levelStartMs(level) + SCRIPTED_OFFSET_IN_LEVEL_MS;
    } else {
      elapsedMs = Math.min(this.firmwareElapsed(trial), MAX_TRIAL_MS - 1);
      level = levelAtElapsed(elapsedMs) ?? LEVEL_COUNT;
    }

    // Motor off first, then the report. Rehab stays selected for the next START.
    this.cancelTrial();
    this.notify(`FELT,${level},${driveForLevel(level)},${elapsedMs}`);
  }

  private cancelTrial(): void {
    if (!this.trial) return;
    for (const timer of this.trial.timers) clearTimeout(timer);
    this.trial = null;
  }

  // ---------- Link ----------

  private dropLink(reason: string): void {
    if (this.connection !== 'disconnected') this.logLink(reason);
    this.cancelTrial();
    // The firmware turns the motor off and goes idle when the link drops.
    this.host.setDevice({ linkUp: false, mode: 'IDLE' });
    this.setConnection('disconnected');
  }

  private syncWithHost(): void {
    const { linkUp } = this.host.getDevice();
    // While a reconnect is in progress the host still says "link down"; that is expected,
    // so only an established link can be pulled from outside.
    if (!linkUp && this.connection === 'connected') {
      this.cancelTrial();
      this.setConnection('disconnected');
    } else if (linkUp && this.connection === 'disconnected') {
      this.setConnection('connected');
    }
  }

  private setConnection(next: ConnectionState): void {
    if (this.connection === next) return;
    this.connection = next;
    for (const listener of [...this.connectionListeners]) listener(next);
  }

  private logLink(text: string): void {
    this.host.log({ at: new Date().toISOString(), direction: 'link', text });
  }

  /** Deliver a notification after a short transport delay, in order. */
  private notify(message: string): void {
    setTimeout(() => {
      if (this.connection !== 'connected') return;
      this.host.log({ at: new Date().toISOString(), direction: 'device', text: message });
      for (const listener of [...this.messageListeners]) listener(message);
    }, NOTIFY_LATENCY_MS);
  }
}
