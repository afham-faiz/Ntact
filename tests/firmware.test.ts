import { describe, expect, it } from 'vitest';
import {
  DEVICE_COMMANDS,
  LEVEL_COUNT,
  LEVEL_DURATION_MS,
  MAX_TRIAL_MS,
  REHAB_LEVELS,
  RTP_BY_LEVEL,
  SILENT_STAGE_MS,
  driveForLevel,
  isRehabLevel,
  levelAtElapsed,
  levelStartMs,
  parseNotification,
} from '../src/domain/firmware';
import type { DeviceEvent } from '../src/domain/types';

describe('V3 firmware tables', () => {
  it('accepts exactly the six command words of the handoff', () => {
    expect([...DEVICE_COMMANDS]).toEqual(['STATUS', 'NORMAL', 'REHAB', 'START', 'FELT', 'STOP']);
  });

  it('holds exactly the V3 RTP drive table, indexed by level', () => {
    expect([...RTP_BY_LEVEL]).toEqual([0, 1, 12, 24, 35, 47, 58, 70, 82, 93, 105]);
  });

  it('times a full trial at 31 000 ms: one silent second, then ten levels of three seconds', () => {
    expect(SILENT_STAGE_MS).toBe(1_000);
    expect(LEVEL_DURATION_MS).toBe(3_000);
    expect(LEVEL_COUNT).toBe(10);
    expect(MAX_TRIAL_MS).toBe(31_000);
  });

  it('driveForLevel reads the table and refuses anything outside levels 0 to 10', () => {
    expect(driveForLevel(0)).toBe(0);
    expect(driveForLevel(3)).toBe(24);
    expect(driveForLevel(10)).toBe(105);
    for (const invalid of [-1, 11, 2.5, Number.NaN]) {
      expect(() => driveForLevel(invalid)).toThrow(RangeError);
    }
  });

  it('counts only levels 1 to 10 as possible results: level 0 is the silent stage', () => {
    expect([...REHAB_LEVELS]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const level of REHAB_LEVELS) expect(isRehabLevel(level)).toBe(true);
    for (const notALevel of [0, 11, -1, 2.5]) expect(isRehabLevel(notALevel)).toBe(false);
  });
});

describe('levelAtElapsed', () => {
  it.each([
    [0, 0],
    [500, 0],
    [999, 0],
    [1_000, 1],
    [3_999, 1],
    [4_000, 2],
    [8_500, 3],
    [27_999, 9],
    [28_000, 10],
    [30_999, 10],
  ])('%i ms into a trial is level %i', (elapsedMs, level) => {
    expect(levelAtElapsed(elapsedMs)).toBe(level);
  });

  it('is null from 31 000 ms, once all ten levels have run', () => {
    expect(levelAtElapsed(31_000)).toBeNull();
    expect(levelAtElapsed(60_000)).toBeNull();
  });

  it('changes level exactly where levelStartMs says each level begins', () => {
    expect(levelStartMs(0)).toBe(0);
    expect(levelStartMs(1)).toBe(1_000);
    expect(levelStartMs(2)).toBe(4_000);
    expect(levelStartMs(10)).toBe(28_000);
    for (const level of REHAB_LEVELS) {
      expect(levelAtElapsed(levelStartMs(level))).toBe(level);
      expect(levelAtElapsed(levelStartMs(level) - 1)).toBe(level - 1);
    }
  });
});

describe('parseNotification', () => {
  const CONTRACT: [string, DeviceEvent][] = [
    ['NORMAL_READY', { type: 'NORMAL_READY' }],
    ['REHAB_READY', { type: 'REHAB_READY' }],
    ['LEVEL,0,0', { type: 'LEVEL', level: 0, drive: 0 }],
    ['LEVEL,3,24', { type: 'LEVEL', level: 3, drive: 24 }],
    ['FELT,3,24,8500', { type: 'FELT', level: 3, drive: 24, elapsedMs: 8500 }],
    ['STOPPED', { type: 'STOPPED' }],
    ['COMPLETE,NO_FELT', { type: 'COMPLETE_NO_FELT' }],
    ['STATUS,NORMAL,0', { type: 'STATUS', mode: 'NORMAL', level: 0 }],
    ['STATUS,REHAB,5', { type: 'STATUS', mode: 'REHAB', level: 5 }],
    ['STATUS,IDLE,0', { type: 'STATUS', mode: 'IDLE', level: 0 }],
    ['ERR,SELECT_REHAB', { type: 'ERR', code: 'SELECT_REHAB' }],
    ['ERR,DRIVER', { type: 'ERR', code: 'DRIVER' }],
    ['ERR,NO_TEST', { type: 'ERR', code: 'NO_TEST' }],
  ];

  it.each(CONTRACT)('parses the contract message %s', (raw, expected) => {
    expect(parseNotification(raw)).toStrictEqual(expected);
  });

  it.each<[string, string, DeviceEvent]>([
    ['surrounding whitespace', '  REHAB_READY  ', { type: 'REHAB_READY' }],
    ['a trailing newline', 'LEVEL,3,24\n', { type: 'LEVEL', level: 3, drive: 24 }],
    ['a trailing CRLF', 'FELT,3,24,8500\r\n', { type: 'FELT', level: 3, drive: 24, elapsedMs: 8500 }],
    ['spaces around the fields', 'STATUS, REHAB , 5', { type: 'STATUS', mode: 'REHAB', level: 5 }],
    ['lowercase', 'status,rehab,5', { type: 'STATUS', mode: 'REHAB', level: 5 }],
    ['lowercase without fields', 'stopped', { type: 'STOPPED' }],
    ['mixed case', 'Complete,No_Felt', { type: 'COMPLETE_NO_FELT' }],
    ['a lowercase error code', 'err,driver', { type: 'ERR', code: 'DRIVER' }],
  ])('tolerates %s', (_label, raw, expected) => {
    expect(parseNotification(raw)).toStrictEqual(expected);
  });

  it.each([
    '',
    '   ',
    'HELLO',
    'LEVELS,3,24',
    'COMPLETE',
    'COMPLETE,FELT',
    // V3 sends no telemetry. If something like this ever arrives it must not be mistaken for an event.
    'PRESSURE,412',
    'BATTERY,87',
    'TEMP,36.5',
  ])('returns UNKNOWN for the unrecognised message %j', (raw) => {
    expect(parseNotification(raw)).toStrictEqual({ type: 'UNKNOWN', raw: raw.trim() });
  });

  it.each([
    'LEVEL',
    'LEVEL,3',
    'LEVEL,three,24',
    'LEVEL,3,2.4',
    'LEVEL,,',
    'FELT,3,24',
    'FELT,3,x,8500',
    'FELT,3,24,soon',
    'FELT,3,24,8500ms',
    'STATUS,REHAB',
    'STATUS,REHAB,five',
    'STATUS,SLEEP,0',
    'STATUS,,0',
  ])('returns UNKNOWN for the malformed message %j', (raw) => {
    expect(parseNotification(raw)).toStrictEqual({ type: 'UNKNOWN', raw });
  });

  it('passes an error code it does not know through as an ERR event, upper-cased', () => {
    expect(parseNotification('ERR,overheat')).toStrictEqual({ type: 'ERR', code: 'OVERHEAT' });
    expect(parseNotification('ERR')).toStrictEqual({ type: 'ERR', code: 'UNKNOWN' });
  });
});
