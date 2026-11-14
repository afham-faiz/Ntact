/**
 * What the app knows about the wearable.
 *
 * Everything here is learned the same way for the demonstration and for the
 * physical device: from connection events and from the notification strings the
 * device sends. The provider never reads the simulated device's internals, and it
 * never guesses a mode the device has not reported.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { demoStore } from '../demo/store';
import { getDeviceAdapter, type DeviceAdapter } from '../devices';
import { detectBleSupport, type BleSupport } from '../devices/BleDeviceAdapter';
import { DeviceConnectError, type ConnectFailure, type ConnectStage } from '../devices/DeviceAdapter';
import { deviceSourceStore, type DeviceSource, type DeviceSourceStore } from '../devices/source';
import { parseNotification } from '../domain/firmware';
import type { ConnectionState, DeviceCommand, DeviceMode } from '../domain/types';

/** Why there is no link right now. 'lost' is an established link that dropped on its own. */
export type LinkProblem = ConnectFailure | 'lost';

/** How to name the device in a sentence, so no screen hard-codes "demo device". */
export interface DeviceWords {
  /** Mid-sentence: "the demo device", "the Ntact device". */
  name: string;
  /** Sentence start. */
  Name: string;
  /** Label for the button that brings the link up. */
  connect: string;
  /** Label while that is in progress. */
  connecting: string;
}

export interface DeviceContextValue {
  adapter: DeviceAdapter;
  /** Which wearable this tab is set to use. Only ever changed by `chooseSource`. */
  source: DeviceSource;
  connection: ConnectionState;
  /** Finer progress while connecting to the physical device. */
  stage: ConnectStage | null;
  /** null until the device has reported its mode (or while there is no link). */
  mode: DeviceMode | null;
  /** A mode change the person asked for that the device has not confirmed yet. */
  pending: 'NORMAL' | 'STOP' | null;
  /** Why the last attempt failed or the link dropped. Cleared by the next attempt. */
  problem: LinkProblem | null;
  /** True when the link is the demonstration. Drives every "Demo device" label. */
  simulated: boolean;
  /** Whether this browser could use Bluetooth at all. */
  bluetooth: BleSupport;
  label: string;
  words: DeviceWords;
  /** Must be called from a tap or click when the source is the physical device. */
  connect(): void;
  disconnect(): void;
  /** Switch between the demonstration and the physical device. Closes a Bluetooth link first. */
  chooseSource(source: DeviceSource): void;
  /** Forget the remembered physical device, so the next connect shows the device list. */
  forgetDevice(): void;
  enableAssist(): void;
  pauseAssist(): void;
  /** Write a command, swallowing "not connected". Returns false if it could not be sent. */
  send(command: DeviceCommand): Promise<boolean>;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

interface DeviceProviderProps {
  children: ReactNode;
  /** Pin one adapter (tests). Disables source switching. */
  adapter?: DeviceAdapter;
  /** How a source becomes an adapter. Defaults to the app's two singletons. */
  resolveAdapter?: (source: DeviceSource) => DeviceAdapter;
  sourceStore?: DeviceSourceStore;
  bleSupport?: BleSupport;
}

export function DeviceProvider({
  children,
  adapter: provided,
  resolveAdapter = getDeviceAdapter,
  sourceStore = deviceSourceStore,
  bleSupport,
}: DeviceProviderProps) {
  const chosenSource = useSyncExternalStore(sourceStore.subscribe, sourceStore.get, sourceStore.get);
  const adapter = useMemo(() => provided ?? resolveAdapter(chosenSource), [provided, resolveAdapter, chosenSource]);
  const simulated = adapter.kind === 'mock';
  const source: DeviceSource = simulated ? 'simulation' : 'hardware';
  const bluetooth = useMemo(() => bleSupport ?? detectBleSupport(), [bleSupport]);

  const [connection, setConnection] = useState<ConnectionState>(() => adapter.getConnectionState());
  const [stage, setStage] = useState<ConnectStage | null>(() => adapter.getConnectStage?.() ?? null);
  const [mode, setMode] = useState<DeviceMode | null>(null);
  const [pending, setPending] = useState<'NORMAL' | 'STOP' | null>(null);
  const [problem, setProblem] = useState<LinkProblem | null>(null);
  const [everConnected, setEverConnected] = useState(() => adapter.getConnectionState() === 'connected');
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set just before the app itself closes the link, so that is not reported as "lost". */
  const deliberate = useRef(false);
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  const clearPending = useCallback(() => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    pendingTimer.current = null;
    setPending(null);
  }, []);

  const send = useCallback(
    async (command: DeviceCommand): Promise<boolean> => {
      try {
        await adapter.send(command);
        return true;
      } catch {
        return false;
      }
    },
    [adapter],
  );

  useEffect(() => {
    // A different adapter is a different device: nothing known about the last one carries over.
    let previous = adapter.getConnectionState();
    deliberate.current = false;
    setConnection(previous);
    setStage(adapter.getConnectStage?.() ?? null);
    setMode(null);
    setProblem(null);
    setEverConnected(previous === 'connected');
    clearPending();

    const offMessage = adapter.subscribe((raw) => {
      const event = parseNotification(raw);
      switch (event.type) {
        case 'STATUS':
          setMode(event.mode);
          break;
        case 'NORMAL_READY':
          setMode('NORMAL');
          clearPending();
          break;
        case 'REHAB_READY':
          setMode('REHAB');
          break;
        case 'STOPPED':
          setMode('IDLE');
          clearPending();
          break;
        default:
          // LEVEL, FELT and errors belong to the test session. Anything unrecognised is ignored.
          break;
      }
    });

    const offConnection = adapter.onConnectionChange((next) => {
      setConnection(next);
      if (next === 'connected') {
        setProblem(null);
        setEverConnected(true);
        // Handoff: after connecting, subscribe first (done by the adapter and above), then ask for STATUS.
        void send('STATUS');
      } else {
        setMode(null);
        clearPending();
        if (next === 'disconnected') {
          if (previous === 'connected' && !deliberate.current) setProblem('lost');
          deliberate.current = false;
        }
      }
      previous = next;
    });

    const offStage = adapter.onConnectStageChange?.((next) => setStage(next));

    if (previous === 'connected') void send('STATUS');

    return () => {
      offMessage();
      offConnection();
      offStage?.();
    };
  }, [adapter, send, clearPending]);

  const requestMode = useCallback(
    (command: 'NORMAL' | 'STOP') => {
      setPending(command);
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => setPending(null), 4_000);
      void send(command).then((sent) => {
        if (!sent) clearPending();
      });
    },
    [send, clearPending],
  );

  const connect = useCallback(() => {
    deliberate.current = false;
    setProblem(null);
    // Called straight from the tap: the browser only opens its device list during a user gesture.
    adapter.connect().catch((error: unknown) => {
      if (adapterRef.current !== adapter) return;
      setProblem(error instanceof DeviceConnectError ? error.reason : 'failed');
    });
  }, [adapter]);

  const disconnect = useCallback(() => {
    deliberate.current = true;
    setProblem(null);
    void adapter.disconnect().catch(() => undefined);
  }, [adapter]);

  const chooseSource = useCallback(
    (next: DeviceSource) => {
      if (provided || next === sourceStore.get()) return;
      // The physical device is never left connected behind a "demonstration" label.
      if (adapter.kind === 'ble') {
        deliberate.current = true;
        void adapter.disconnect().catch(() => undefined);
      }
      sourceStore.set(next);
    },
    [adapter, provided, sourceStore],
  );

  const forgetDevice = useCallback(() => {
    adapter.forgetDevice?.();
    setEverConnected(false);
    setProblem(null);
  }, [adapter]);

  const value = useMemo<DeviceContextValue>(() => {
    const words: DeviceWords = simulated
      ? { name: 'demo device', Name: 'Demo device', connect: 'Reconnect demo device', connecting: 'Reconnecting' }
      : {
          name: 'Ntact device',
          Name: 'Ntact device',
          connect: everConnected ? 'Reconnect Ntact device' : 'Connect Ntact device',
          connecting: stage === 'choosing' ? 'Searching for nearby devices' : 'Connecting',
        };
    return {
      adapter,
      source,
      connection,
      stage,
      mode,
      pending,
      problem,
      simulated,
      bluetooth,
      // Read on every connection change: the Bluetooth label is the chosen board's name.
      label: adapter.label,
      words,
      connect,
      disconnect,
      chooseSource,
      forgetDevice,
      enableAssist: () => {
        demoStore.setAssistPreferred(true);
        requestMode('NORMAL');
      },
      pauseAssist: () => {
        demoStore.setAssistPreferred(false);
        requestMode('STOP');
      },
      send,
    };
  }, [
    adapter,
    source,
    connection,
    stage,
    mode,
    pending,
    problem,
    simulated,
    bluetooth,
    everConnected,
    connect,
    disconnect,
    chooseSource,
    forgetDevice,
    requestMode,
    send,
  ]);

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceContextValue {
  const value = useContext(DeviceContext);
  if (!value) throw new Error('useDevice must be used inside <DeviceProvider>.');
  return value;
}

/** Plain-language state of Touch Assist, derived from link and mode. */
export type AssistState = 'on' | 'paused' | 'testing' | 'offline' | 'checking' | 'changing';

export function assistStateOf(device: Pick<DeviceContextValue, 'connection' | 'mode' | 'pending'>): AssistState {
  if (device.connection !== 'connected') return 'offline';
  if (device.pending) return 'changing';
  if (device.mode === null) return 'checking';
  if (device.mode === 'NORMAL') return 'on';
  if (device.mode === 'REHAB') return 'testing';
  return 'paused';
}
