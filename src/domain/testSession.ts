/**
 * The daily sensation test as a pure state machine.
 *
 * Two rules shape it:
 *
 * 1. Blinding. The machine never keeps the current level or drive. LEVEL
 *    notifications are accepted and dropped, so no screen can show them even by
 *    accident. The step only exists once the device reports it in a FELT message.
 *
 * 2. Respond first, save second. A tap produces a SEND effect immediately. The
 *    RECORD effect is only produced later, by the device's own notification.
 */
import { isRehabLevel } from './firmware';
import type { DeviceCommand, DeviceEvent, TrialOutcome } from './types';

export type TestPhase =
  | { name: 'ready' }
  /** REHAB sent, waiting for REHAB_READY. */
  | { name: 'arming' }
  /** START sent, waiting for LEVEL,0,0. */
  | { name: 'starting' }
  /** Trial in progress. Deliberately carries no level, drive or timing. */
  | { name: 'running' }
  /** FELT sent, waiting for the device to report what it was on. */
  | { name: 'responding' }
  /** STOP sent, waiting for STOPPED. */
  | { name: 'stopping' }
  | { name: 'result'; outcome: TrialOutcome }
  | { name: 'connection-lost' }
  | { name: 'device-error'; code: string };

export type TestInput =
  | { type: 'BEGIN' }
  | { type: 'TAP_FELT' }
  | { type: 'TAP_STOP' }
  | { type: 'DEVICE'; event: DeviceEvent }
  | { type: 'LINK_LOST' }
  | { type: 'TIMEOUT' }
  | { type: 'RESET' };

export type TestEffect =
  | { type: 'SEND'; command: DeviceCommand }
  | { type: 'RECORD'; outcome: TrialOutcome };

export interface TestStep {
  phase: TestPhase;
  effects: TestEffect[];
}

const stay = (phase: TestPhase): TestStep => ({ phase, effects: [] });

const finish = (outcome: TrialOutcome): TestStep => ({
  phase: { name: 'result', outcome },
  effects: [{ type: 'RECORD', outcome }],
});

/** True while a command is outstanding or a trial is running. */
export function isActivePhase(phase: TestPhase): boolean {
  return (
    phase.name === 'arming' ||
    phase.name === 'starting' ||
    phase.name === 'running' ||
    phase.name === 'responding' ||
    phase.name === 'stopping'
  );
}

/** Phases that wait on a single acknowledgement and should time out if it never arrives. */
export function isAwaitingAck(phase: TestPhase): boolean {
  return (
    phase.name === 'arming' ||
    phase.name === 'starting' ||
    phase.name === 'responding' ||
    phase.name === 'stopping'
  );
}

function onDevice(phase: TestPhase, event: DeviceEvent): TestStep {
  switch (phase.name) {
    case 'arming':
      if (event.type === 'REHAB_READY') {
        return { phase: { name: 'starting' }, effects: [{ type: 'SEND', command: 'START' }] };
      }
      if (event.type === 'ERR') return stay({ name: 'device-error', code: event.code });
      return stay(phase);

    case 'starting':
      if (event.type === 'LEVEL') return stay({ name: 'running' });
      if (event.type === 'ERR') return stay({ name: 'device-error', code: event.code });
      return stay(phase);

    case 'running':
      // LEVEL,n,drive arrives here ten times. It is intentionally discarded.
      if (event.type === 'COMPLETE_NO_FELT') return finish({ outcome: 'NO_FELT' });
      if (event.type === 'STOPPED') return finish({ outcome: 'STOPPED', stopReason: 'USER_STOP' });
      if (event.type === 'ERR' && event.code === 'DRIVER') {
        return stay({ name: 'device-error', code: event.code });
      }
      return stay(phase);

    case 'responding':
      if (event.type === 'FELT') {
        // A tap during the silent first second: nothing was commanded, so nothing was detected.
        if (!isRehabLevel(event.level)) {
          return finish({ outcome: 'STOPPED', stopReason: 'EARLY_RESPONSE' });
        }
        return finish({
          outcome: 'FELT',
          level: event.level,
          drive: event.drive,
          elapsedMs: event.elapsedMs,
        });
      }
      // The sequence ended a moment before the tap reached the device. The firmware's word is final.
      if (event.type === 'COMPLETE_NO_FELT') return finish({ outcome: 'NO_FELT' });
      // The device says it had no trial to answer for. Nothing was measured, so nothing is recorded.
      if (event.type === 'ERR' && event.code === 'NO_TEST') return stay({ name: 'device-error', code: event.code });
      return stay(phase);

    case 'stopping':
      if (event.type === 'STOPPED') return finish({ outcome: 'STOPPED', stopReason: 'USER_STOP' });
      if (event.type === 'COMPLETE_NO_FELT') return finish({ outcome: 'NO_FELT' });
      return stay(phase);

    default:
      return stay(phase);
  }
}

export function testReducer(phase: TestPhase, input: TestInput): TestStep {
  switch (input.type) {
    case 'BEGIN':
      if (phase.name !== 'ready') return stay(phase);
      // Handoff order: REHAB, wait for REHAB_READY, then START.
      return { phase: { name: 'arming' }, effects: [{ type: 'SEND', command: 'REHAB' }] };

    case 'TAP_FELT':
      if (phase.name !== 'running') return stay(phase);
      return { phase: { name: 'responding' }, effects: [{ type: 'SEND', command: 'FELT' }] };

    case 'TAP_STOP':
      if (phase.name === 'running' || phase.name === 'starting') {
        return { phase: { name: 'stopping' }, effects: [{ type: 'SEND', command: 'STOP' }] };
      }
      if (phase.name === 'arming') return stay({ name: 'ready' });
      return stay(phase);

    case 'DEVICE':
      return onDevice(phase, input.event);

    case 'LINK_LOST':
      // The trial is cancelled and nothing is recorded. It is never resumed.
      return isActivePhase(phase) ? stay({ name: 'connection-lost' }) : stay(phase);

    case 'TIMEOUT':
      return isAwaitingAck(phase) ? stay({ name: 'device-error', code: 'TIMEOUT' }) : stay(phase);

    case 'RESET':
      return isActivePhase(phase) ? stay(phase) : stay({ name: 'ready' });

    default:
      return stay(phase);
  }
}

/**
 * Everything the patient's running screen is allowed to know. Kept as a separate
 * type so a future change cannot quietly add a level or a progress value to it.
 */
export interface BlindedRunningView {
  canRespond: boolean;
  canStop: boolean;
  acknowledged: boolean;
}

export function toBlindedView(phase: TestPhase): BlindedRunningView {
  return {
    canRespond: phase.name === 'running',
    canStop: phase.name === 'running',
    acknowledged: phase.name === 'responding',
  };
}
