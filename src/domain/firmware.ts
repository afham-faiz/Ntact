/**
 * Ntact V3 firmware contract, as described in
 * `SenseBridge_V3_BLE_App_Developer_Handoff.pdf` (11 Nov 2026).
 *
 * Pure data and parsing only. Nothing here talks to hardware.
 */
import type { DeviceCommand, DeviceEvent, DeviceMode, RehabLevel } from './types';

export const DEVICE_COMMANDS: readonly DeviceCommand[] = [
  'STATUS',
  'NORMAL',
  'REHAB',
  'START',
  'FELT',
  'STOP',
];

/**
 * Requested DRV2605L Real-Time Playback value for each Rehab level (index = level).
 * These are arbitrary command settings. They are not vibration amplitudes, clinical
 * thresholds or percentages, and low values may not physically spin the motor.
 */
export const RTP_BY_LEVEL: readonly number[] = [0, 1, 12, 24, 35, 47, 58, 70, 82, 93, 105];

export const LEVEL_COUNT = 10;
export const SILENT_STAGE_MS = 1_000;
export const LEVEL_DURATION_MS = 3_000;
/** 1 s of silence, then ten levels of 3 s each. */
export const MAX_TRIAL_MS = SILENT_STAGE_MS + LEVEL_COUNT * LEVEL_DURATION_MS;

/** Within a level the motor is commanded on for 700 ms and off for 300 ms. */
export const PULSE_ON_MS = 700;
export const PULSE_OFF_MS = 300;

/** Normal mode uses one fixed command intensity; only the rhythm changes with pressure. */
export const NORMAL_MODE_RTP = 70;

export const REHAB_LEVELS: readonly RehabLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function isRehabLevel(value: number): value is RehabLevel {
  return Number.isInteger(value) && value >= 1 && value <= LEVEL_COUNT;
}

export function driveForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0 || level > LEVEL_COUNT) {
    throw new RangeError(`No RTP drive for level ${level}`);
  }
  return RTP_BY_LEVEL[level];
}

/** Firmware-time at which a level begins. Level 0 starts at 0 ms, level 1 at 1 000 ms. */
export function levelStartMs(level: number): number {
  if (level <= 0) return 0;
  return SILENT_STAGE_MS + (level - 1) * LEVEL_DURATION_MS;
}

/**
 * Which level the firmware is on after `elapsedMs` of a trial.
 * Returns 0 during the silent stage and null once all ten levels have finished.
 */
export function levelAtElapsed(elapsedMs: number): number | null {
  if (elapsedMs < 0) return 0;
  if (elapsedMs < SILENT_STAGE_MS) return 0;
  if (elapsedMs >= MAX_TRIAL_MS) return null;
  return Math.floor((elapsedMs - SILENT_STAGE_MS) / LEVEL_DURATION_MS) + 1;
}

function parseMode(field: string | undefined): DeviceMode | null {
  const value = (field ?? '').trim().toUpperCase();
  return value === 'IDLE' || value === 'NORMAL' || value === 'REHAB' ? value : null;
}

function parseInteger(field: string | undefined): number | null {
  if (field === undefined) return null;
  const trimmed = field.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

/**
 * Parse one TX notification.
 *
 * Handoff parser rules: each notification is one UTF-8 message; split at commas and
 * switch on the first field; do not assume a trailing newline.
 */
export function parseNotification(raw: string): DeviceEvent {
  const text = raw.trim();
  const fields = text.split(',').map((field) => field.trim());
  const head = (fields[0] ?? '').toUpperCase();

  switch (head) {
    case 'NORMAL_READY':
      return { type: 'NORMAL_READY' };
    case 'REHAB_READY':
      return { type: 'REHAB_READY' };
    case 'STOPPED':
      return { type: 'STOPPED' };
    case 'COMPLETE':
      return (fields[1] ?? '').toUpperCase() === 'NO_FELT'
        ? { type: 'COMPLETE_NO_FELT' }
        : { type: 'UNKNOWN', raw: text };
    case 'STATUS': {
      const mode = parseMode(fields[1]);
      const level = parseInteger(fields[2]);
      return mode !== null && level !== null
        ? { type: 'STATUS', mode, level }
        : { type: 'UNKNOWN', raw: text };
    }
    case 'LEVEL': {
      const level = parseInteger(fields[1]);
      const drive = parseInteger(fields[2]);
      return level !== null && drive !== null
        ? { type: 'LEVEL', level, drive }
        : { type: 'UNKNOWN', raw: text };
    }
    case 'FELT': {
      const level = parseInteger(fields[1]);
      const drive = parseInteger(fields[2]);
      const elapsedMs = parseInteger(fields[3]);
      return level !== null && drive !== null && elapsedMs !== null
        ? { type: 'FELT', level, drive, elapsedMs }
        : { type: 'UNKNOWN', raw: text };
    }
    case 'ERR':
      return { type: 'ERR', code: (fields[1] ?? 'UNKNOWN').toUpperCase() };
    default:
      return { type: 'UNKNOWN', raw: text };
  }
}

/**
 * The Bluetooth identity of the wearable, exactly as the V3 handoff prints it.
 *
 * The advertised name is still `SenseBridge-V2.0`: it was not changed for V3 and it
 * was not changed when the product became Ntact. Do not edit it here unless the
 * firmware is re-flashed with a new name at the same time.
 */
export const BLE_PROFILE = {
  advertisedName: 'SenseBridge-V2.0',
  serviceUuid: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
  rxWriteUuid: '6E400002-B5A3-F393-E0A9-E50E24DCCA9E',
  txNotifyUuid: '6E400003-B5A3-F393-E0A9-E50E24DCCA9E',
  encoding: 'utf-8',
} as const;
