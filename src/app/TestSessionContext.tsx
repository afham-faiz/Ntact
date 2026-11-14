/**
 * Runs the sensation-test state machine against the device adapter.
 *
 * It lives above the patient routes so that leaving the test screen mid-trial
 * still sends STOP and still records what the device answers.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { demoStore } from '../demo/store';
import { parseNotification } from '../domain/firmware';
import { previousFelt, testsForPatient } from '../domain/selectors';
import { isActivePhase, isAwaitingAck, testReducer, type TestInput, type TestPhase } from '../domain/testSession';
import type { FeltTest, SensationTest, TestSite, TestSource } from '../domain/types';
import { useDevice } from './DeviceContext';

/** How long to wait for a single acknowledgement before telling the person something is wrong. */
export const ACK_TIMEOUT_MS = 5_000;

/**
 * Who a test belongs to, fixed at the moment it starts.
 *
 * The outcome arrives from the device seconds later. By then the demo controls (or
 * another tab) may have switched the active patient, so the record is always
 * written against this snapshot and never against "whoever is active now".
 */
export interface TestSubject {
  patientId: string;
  /** The injured finger the sleeve is on. One finger per test with the current hardware. */
  site: TestSite;
  /** Which link the test ran over. A result is only labelled as real when this is 'ble'. */
  link: 'mock' | 'ble';
}

export interface SavedResult {
  test: SensationTest;
  /** The most recent earlier detection, for the "previous test" line. null if there is none. */
  previous: FeltTest | null;
}

interface TestSessionValue {
  phase: TestPhase;
  saved: SavedResult | null;
  begin(): void;
  tapFelt(): void;
  tapStop(): void;
  reset(): void;
  /** The test screen is on display. */
  attach(): void;
  /** The test screen went away. Stops a running trial and tidies up. */
  detach(): void;
}

const TestSessionContext = createContext<TestSessionValue | null>(null);

export function TestSessionProvider({ children }: { children: ReactNode }) {
  const device = useDevice();
  const { adapter } = device;

  const [phase, setPhase] = useState<TestPhase>({ name: 'ready' });
  const [saved, setSaved] = useState<SavedResult | null>(null);
  const phaseRef = useRef<TestPhase>(phase);
  const attachedRef = useRef(false);
  const ranRef = useRef(false);
  const subjectRef = useRef<TestSubject | null>(null);
  const deviceRef = useRef(device);
  deviceRef.current = device;

  const dispatchRef = useRef<(input: TestInput) => void>(() => undefined);

  const dispatch = useCallback(
    (input: TestInput) => {
      const step = testReducer(phaseRef.current, input);
      if (step.phase !== phaseRef.current) {
        phaseRef.current = step.phase;
        setPhase(step.phase);
      }
      for (const effect of step.effects) {
        if (effect.type === 'SEND') {
          // Commands go out synchronously with the tap. Nothing is awaited first.
          adapter.send(effect.command).catch(() => dispatchRef.current({ type: 'LINK_LOST' }));
        } else {
          // Reached only from a device notification: the reported outcome is saved second.
          const subject = subjectRef.current;
          subjectRef.current = null;
          // No subject means no test was started from this screen, so there is nobody to
          // attribute an outcome to. Nothing is saved rather than guessing.
          if (!subject) continue;
          const state = demoStore.getState();
          const earlier = testsForPatient(state.tests, subject.patientId);
          const scripted = state.scenario.result.kind === 'scripted' && effect.outcome.outcome === 'FELT';
          const source: TestSource = subject.link === 'ble' ? 'ble' : scripted ? 'mock-scripted' : 'mock-timed';
          const test = demoStore.recordTrial(subject.patientId, effect.outcome, source, new Date(), subject.site);
          setSaved({ test, previous: previousFelt(earlier, test.timestamp) });
        }
      }
    },
    [adapter],
  );
  dispatchRef.current = dispatch;

  /** After a test, put Touch Assist back if that is the person's standing choice. Never after a lost link. */
  const settle = useCallback(() => {
    const current = phaseRef.current;
    if (isActivePhase(current)) return;
    if (ranRef.current && current.name !== 'connection-lost') {
      const now = deviceRef.current;
      if (demoStore.getState().assistPreferred && now.connection === 'connected' && now.mode !== 'NORMAL') {
        void now.send('NORMAL');
      }
    }
    ranRef.current = false;
    if (current.name !== 'ready') dispatchRef.current({ type: 'RESET' });
  }, []);

  useEffect(() => {
    const offMessage = adapter.subscribe((raw) => {
      dispatchRef.current({ type: 'DEVICE', event: parseNotification(raw) });
    });
    const offConnection = adapter.onConnectionChange((next) => {
      if (next !== 'connected') dispatchRef.current({ type: 'LINK_LOST' });
    });
    return () => {
      offMessage();
      offConnection();
      // The wearable was switched (demonstration ↔ physical) under a test. The old device is
      // told to stop, and the test ends as a lost connection: nothing recorded, nothing resumed.
      if (isActivePhase(phaseRef.current)) {
        adapter.send('STOP').catch(() => undefined);
        dispatchRef.current({ type: 'LINK_LOST' });
      }
    };
  }, [adapter]);

  // Watchdog for a missing acknowledgement.
  useEffect(() => {
    if (!isAwaitingAck(phase)) return;
    const timer = setTimeout(() => dispatchRef.current({ type: 'TIMEOUT' }), ACK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // A trial that finished after the person had already left the screen.
  useEffect(() => {
    if (!attachedRef.current && !isActivePhase(phase) && phase.name !== 'ready') settle();
  }, [phase, settle]);

  // These must keep the same identity across renders: the test screen calls detach from an
  // effect cleanup, and a changing identity would fire that cleanup on every phase change.
  const begin = useCallback(() => {
    if (phaseRef.current.name !== 'ready') return;
    // Identity is captured here, once, and not read again until the device reports an outcome.
    const state = demoStore.getState();
    const patient = state.patients.find((item) => item.id === state.activePatientId) ?? state.patients[0];
    subjectRef.current = {
      patientId: patient.id,
      site: { hand: patient.hand, finger: patient.finger },
      link: adapter.kind,
    };
    ranRef.current = true;
    setSaved(null);
    dispatch({ type: 'BEGIN' });
  }, [adapter, dispatch]);
  const tapFelt = useCallback(() => dispatch({ type: 'TAP_FELT' }), [dispatch]);
  const tapStop = useCallback(() => dispatch({ type: 'TAP_STOP' }), [dispatch]);
  const reset = useCallback(() => dispatch({ type: 'RESET' }), [dispatch]);
  const attach = useCallback(() => {
    attachedRef.current = true;
  }, []);
  const detach = useCallback(() => {
    attachedRef.current = false;
    if (isActivePhase(phaseRef.current)) {
      dispatch({ type: 'TAP_STOP' });
      // If that returned straight to ready (still arming), there is nothing to wait for.
      if (!isActivePhase(phaseRef.current)) settle();
    } else {
      settle();
    }
  }, [dispatch, settle]);

  const value = useMemo<TestSessionValue>(
    () => ({ phase, saved, begin, tapFelt, tapStop, reset, attach, detach }),
    [phase, saved, begin, tapFelt, tapStop, reset, attach, detach],
  );

  return <TestSessionContext.Provider value={value}>{children}</TestSessionContext.Provider>;
}

export function useTestSession(): TestSessionValue {
  const value = useContext(TestSessionContext);
  if (!value) throw new Error('useTestSession must be used inside <TestSessionProvider>.');
  return value;
}
