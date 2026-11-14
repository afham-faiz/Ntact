import { describe, expect, it } from 'vitest';
import { REHAB_LEVELS, RTP_BY_LEVEL } from '../src/domain/firmware';
import {
  isActivePhase,
  isAwaitingAck,
  testReducer,
  toBlindedView,
  type TestEffect,
  type TestInput,
  type TestPhase,
} from '../src/domain/testSession';
import type { DeviceEvent } from '../src/domain/types';

// ---------- Inputs ----------

const device = (event: DeviceEvent): TestInput => ({ type: 'DEVICE', event });

const BEGIN: TestInput = { type: 'BEGIN' };
const TAP_FELT: TestInput = { type: 'TAP_FELT' };
const TAP_STOP: TestInput = { type: 'TAP_STOP' };
const LINK_LOST: TestInput = { type: 'LINK_LOST' };
const TIMEOUT: TestInput = { type: 'TIMEOUT' };
const RESET: TestInput = { type: 'RESET' };

const REHAB_READY = device({ type: 'REHAB_READY' });
const LEVEL_0 = device({ type: 'LEVEL', level: 0, drive: 0 });
const FELT_AT_3 = device({ type: 'FELT', level: 3, drive: 24, elapsedMs: 8500 });
const STOPPED = device({ type: 'STOPPED' });
const COMPLETE_NO_FELT = device({ type: 'COMPLETE_NO_FELT' });
const ERR_DRIVER = device({ type: 'ERR', code: 'DRIVER' });

const READY: TestPhase = { name: 'ready' };

interface TraceEntry {
  phase: TestPhase['name'];
  effects: TestEffect[];
}

/** Feed inputs in order. Returns the final phase and what every step produced. */
function play(inputs: TestInput[], from: TestPhase = READY): { phase: TestPhase; trace: TraceEntry[] } {
  let phase = from;
  const trace: TraceEntry[] = [];
  for (const input of inputs) {
    const step = testReducer(phase, input);
    phase = step.phase;
    trace.push({ phase: phase.name, effects: step.effects });
  }
  return { phase, trace };
}

/** How each in-flight phase is reached from ready. */
const ROUTE = {
  arming: [BEGIN],
  starting: [BEGIN, REHAB_READY],
  running: [BEGIN, REHAB_READY, LEVEL_0],
  responding: [BEGIN, REHAB_READY, LEVEL_0, TAP_FELT],
  stopping: [BEGIN, REHAB_READY, LEVEL_0, TAP_STOP],
} satisfies Record<string, TestInput[]>;

type ActivePhaseName = keyof typeof ROUTE;

const ACTIVE: ActivePhaseName[] = ['arming', 'starting', 'running', 'responding', 'stopping'];

function reach(name: ActivePhaseName): TestPhase {
  const { phase } = play(ROUTE[name]);
  expect(phase.name).toBe(name);
  return phase;
}

const EVERY_PHASE: TestPhase[] = [
  { name: 'ready' },
  { name: 'arming' },
  { name: 'starting' },
  { name: 'running' },
  { name: 'responding' },
  { name: 'stopping' },
  { name: 'result', outcome: { outcome: 'FELT', level: 3, drive: 24, elapsedMs: 8500 } },
  { name: 'result', outcome: { outcome: 'NO_FELT' } },
  { name: 'result', outcome: { outcome: 'STOPPED', stopReason: 'USER_STOP' } },
  { name: 'connection-lost' },
  { name: 'device-error', code: 'DRIVER' },
];

/** Asserts that `input` does nothing at all in `phase`: same phase object back, no effects. */
function expectIgnored(phase: TestPhase, input: TestInput): void {
  const step = testReducer(phase, input);
  expect(step.phase).toBe(phase);
  expect(step.effects).toEqual([]);
}

// ---------- Tests ----------

describe('happy path', () => {
  it('sends REHAB, waits for REHAB_READY, sends START, and records only what the device reports', () => {
    const { trace } = play([BEGIN, REHAB_READY, LEVEL_0, TAP_FELT, FELT_AT_3]);

    expect(trace).toEqual([
      { phase: 'arming', effects: [{ type: 'SEND', command: 'REHAB' }] },
      { phase: 'starting', effects: [{ type: 'SEND', command: 'START' }] },
      { phase: 'running', effects: [] },
      { phase: 'responding', effects: [{ type: 'SEND', command: 'FELT' }] },
      {
        phase: 'result',
        effects: [{ type: 'RECORD', outcome: { outcome: 'FELT', level: 3, drive: 24, elapsedMs: 8500 } }],
      },
    ]);
  });

  it('responds first and saves second: the tap sends FELT with no RECORD effect yet', () => {
    const tap = testReducer(reach('running'), TAP_FELT);

    expect(tap.effects).toEqual([{ type: 'SEND', command: 'FELT' }]);
    expect(tap.phase).toEqual({ name: 'responding' });

    const reported = testReducer(tap.phase, FELT_AT_3);
    expect(reported.phase).toEqual({
      name: 'result',
      outcome: { outcome: 'FELT', level: 3, drive: 24, elapsedMs: 8500 },
    });
  });
});

describe('blinding', () => {
  it('drops every LEVEL notification while running: the very same phase object comes back, with no effects', () => {
    const running = reach('running');

    let phase = running;
    for (const level of REHAB_LEVELS) {
      const step = testReducer(phase, device({ type: 'LEVEL', level, drive: RTP_BY_LEVEL[level] }));
      expect(step.phase).toBe(running);
      expect(step.effects).toEqual([]);
      phase = step.phase;
    }
  });

  it('keeps nothing but a name in the running phase', () => {
    const running = reach('running');

    expect(Object.keys(running)).toEqual(['name']);
    expect(JSON.stringify(running)).not.toMatch(/\d/);
  });

  it('gives the running screen exactly canRespond, canStop and acknowledged, and never a number', () => {
    for (const phase of EVERY_PHASE) {
      const view = toBlindedView(phase);

      expect(Object.keys(view).sort()).toEqual(['acknowledged', 'canRespond', 'canStop']);
      for (const value of Object.values(view)) {
        expect(typeof value).not.toBe('number');
        expect(typeof value).toBe('boolean');
      }
    }
  });

  it('lets the person respond or stop only while running, and acknowledges only a tap in flight', () => {
    for (const phase of EVERY_PHASE) {
      expect(toBlindedView(phase)).toEqual({
        canRespond: phase.name === 'running',
        canStop: phase.name === 'running',
        acknowledged: phase.name === 'responding',
      });
    }
  });
});

describe('outcomes that are not detections', () => {
  it('records NO_FELT when the device completes all ten levels, with no level or drive on the outcome', () => {
    const step = testReducer(reach('running'), COMPLETE_NO_FELT);

    expect(step.effects).toEqual([{ type: 'RECORD', outcome: { outcome: 'NO_FELT' } }]);
    expect(step.phase).toEqual({ name: 'result', outcome: { outcome: 'NO_FELT' } });
    const [effect] = step.effects;
    if (effect.type !== 'RECORD') throw new Error('expected a RECORD effect');
    expect(Object.keys(effect.outcome)).toEqual(['outcome']);
  });

  it('sends STOP on the stop tap, and records STOPPED / USER_STOP once the device confirms', () => {
    const tap = testReducer(reach('running'), TAP_STOP);
    expect(tap.phase).toEqual({ name: 'stopping' });
    expect(tap.effects).toEqual([{ type: 'SEND', command: 'STOP' }]);

    const confirmed = testReducer(tap.phase, STOPPED);
    expect(confirmed.effects).toEqual([
      { type: 'RECORD', outcome: { outcome: 'STOPPED', stopReason: 'USER_STOP' } },
    ]);
    expect(confirmed.phase.name).toBe('result');
  });

  it('records a FELT reported at level 0 (a tap in the silent first second) as STOPPED / EARLY_RESPONSE, never as FELT', () => {
    const step = testReducer(reach('responding'), device({ type: 'FELT', level: 0, drive: 0, elapsedMs: 420 }));

    expect(step.effects).toEqual([
      { type: 'RECORD', outcome: { outcome: 'STOPPED', stopReason: 'EARLY_RESPONSE' } },
    ]);
    expect(step.phase).toEqual({
      name: 'result',
      outcome: { outcome: 'STOPPED', stopReason: 'EARLY_RESPONSE' },
    });
  });

  it.each(['responding', 'stopping'] as const)(
    'takes the firmware’s word when the ramp ends just before the tap lands (%s)',
    (name) => {
      const step = testReducer(reach(name), COMPLETE_NO_FELT);

      expect(step.effects).toEqual([{ type: 'RECORD', outcome: { outcome: 'NO_FELT' } }]);
    },
  );
});

describe('lost link', () => {
  it.each(ACTIVE)('LINK_LOST while %s ends in connection-lost and records nothing', (name) => {
    const step = testReducer(reach(name), LINK_LOST);

    expect(step.phase).toEqual({ name: 'connection-lost' });
    expect(step.effects).toEqual([]);
  });

  it('does nothing from connection-lost except on RESET, which returns to ready: nothing resumes the trial', () => {
    const lost = testReducer(reach('running'), LINK_LOST).phase;

    const everythingElse: TestInput[] = [
      BEGIN,
      TAP_FELT,
      TAP_STOP,
      LINK_LOST,
      TIMEOUT,
      REHAB_READY,
      LEVEL_0,
      device({ type: 'LEVEL', level: 4, drive: 35 }),
      FELT_AT_3,
      STOPPED,
      COMPLETE_NO_FELT,
      ERR_DRIVER,
      device({ type: 'STATUS', mode: 'IDLE', level: 0 }),
    ];
    for (const input of everythingElse) expectIgnored(lost, input);

    const reset = testReducer(lost, RESET);
    expect(reset.phase).toEqual({ name: 'ready' });
    expect(reset.effects).toEqual([]);
  });

  it('ignores LINK_LOST when no command or trial is in flight', () => {
    expectIgnored(READY, LINK_LOST);
    expectIgnored({ name: 'result', outcome: { outcome: 'NO_FELT' } }, LINK_LOST);
  });
});

describe('device errors and timeouts', () => {
  it('goes to device-error DRIVER when the device answers START with ERR,DRIVER', () => {
    const step = testReducer(reach('starting'), ERR_DRIVER);

    expect(step.phase).toEqual({ name: 'device-error', code: 'DRIVER' });
    expect(step.effects).toEqual([]);
  });

  it('carries whichever error code the device gave while a command was being acknowledged', () => {
    const refused = testReducer(reach('starting'), device({ type: 'ERR', code: 'SELECT_REHAB' }));
    expect(refused.phase).toEqual({ name: 'device-error', code: 'SELECT_REHAB' });

    const whileArming = testReducer(reach('arming'), ERR_DRIVER);
    expect(whileArming.phase).toEqual({ name: 'device-error', code: 'DRIVER' });
  });

  it.each(['arming', 'starting', 'responding', 'stopping'] as const)(
    'TIMEOUT while %s (awaiting an acknowledgement) becomes device-error TIMEOUT and records nothing',
    (name) => {
      const step = testReducer(reach(name), TIMEOUT);

      expect(step.phase).toEqual({ name: 'device-error', code: 'TIMEOUT' });
      expect(step.effects).toEqual([]);
    },
  );

  it('ignores TIMEOUT while running: the ramp is allowed its full thirty-one seconds', () => {
    expectIgnored(reach('running'), TIMEOUT);
  });

  it('classifies phases the way the watchdog and the link handler rely on', () => {
    for (const phase of EVERY_PHASE) {
      expect(isActivePhase(phase)).toBe((ACTIVE as string[]).includes(phase.name));
      expect(isAwaitingAck(phase)).toBe(['arming', 'starting', 'responding', 'stopping'].includes(phase.name));
    }
  });
});

describe('ignored and guarded input', () => {
  it('ignores TAP_FELT in every phase except running', () => {
    for (const phase of EVERY_PHASE) {
      if (phase.name !== 'running') expectIgnored(phase, TAP_FELT);
    }
  });

  it('ignores BEGIN in every phase except ready', () => {
    for (const phase of EVERY_PHASE) {
      if (phase.name !== 'ready') expectIgnored(phase, BEGIN);
    }
  });

  it('cancels straight back to ready when stopped before the device has armed, without sending STOP', () => {
    const step = testReducer(reach('arming'), TAP_STOP);

    expect(step.phase).toEqual({ name: 'ready' });
    expect(step.effects).toEqual([]);
  });

  it('RESET clears a result or an error but cannot abandon a trial in flight', () => {
    for (const name of ACTIVE) expectIgnored(reach(name), RESET);

    const settled: TestPhase[] = [
      { name: 'result', outcome: { outcome: 'NO_FELT' } },
      { name: 'device-error', code: 'TIMEOUT' },
      { name: 'connection-lost' },
    ];
    for (const phase of settled) {
      expect(testReducer(phase, RESET)).toEqual({ phase: { name: 'ready' }, effects: [] });
    }
  });
});

describe('a FELT the device has no trial for', () => {
  it('ends as a device error, with nothing recorded', () => {
    const step = testReducer(reach('responding'), device({ type: 'ERR', code: 'NO_TEST' }));
    expect(step.phase).toEqual({ name: 'device-error', code: 'NO_TEST' });
    expect(step.effects).toEqual([]);
  });

  it('is ignored while the trial is simply running', () => {
    const running = reach('running');
    expect(testReducer(running, device({ type: 'ERR', code: 'NO_TEST' })).phase).toBe(running);
  });
});
