/**
 * What the app knows about the wearable.
 *
 * Everything here is learned the way it will be over Bluetooth: from connection
 * events and from the notification strings the device sends. The provider never
 * reads the simulated device's internals.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { demoStore } from '../demo/store';
import { getDeviceAdapter, type DeviceAdapter } from '../devices';
import { parseNotification } from '../domain/firmware';
import type { ConnectionState, DeviceCommand, DeviceMode } from '../domain/types';

export interface DeviceContextValue {
  adapter: DeviceAdapter;
  connection: ConnectionState;
  /** null until the device has reported its mode (or while there is no link). */
  mode: DeviceMode | null;
  /** A mode change the person asked for that the device has not confirmed yet. */
  pending: 'NORMAL' | 'STOP' | null;
  /** True when the link is simulated. Drives every "Demo device" label. */
  simulated: boolean;
  label: string;
  connect(): void;
  disconnect(): void;
  enableAssist(): void;
  pauseAssist(): void;
  /** Write a command, swallowing "not connected". Returns false if it could not be sent. */
  send(command: DeviceCommand): Promise<boolean>;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children, adapter: provided }: { children: ReactNode; adapter?: DeviceAdapter }) {
  const adapter = useMemo(() => provided ?? getDeviceAdapter(), [provided]);
  const [connection, setConnection] = useState<ConnectionState>(() => adapter.getConnectionState());
  const [mode, setMode] = useState<DeviceMode | null>(null);
  const [pending, setPending] = useState<'NORMAL' | 'STOP' | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          break;
      }
    });

    const offConnection = adapter.onConnectionChange((next) => {
      setConnection(next);
      if (next === 'connected') {
        // Handoff: after connecting, subscribe first (done above), then ask for STATUS.
        void send('STATUS');
      } else {
        setMode(null);
        clearPending();
      }
    });

    setConnection(adapter.getConnectionState());
    if (adapter.getConnectionState() === 'connected') void send('STATUS');

    return () => {
      offMessage();
      offConnection();
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

  const value = useMemo<DeviceContextValue>(
    () => ({
      adapter,
      connection,
      mode,
      pending,
      simulated: adapter.kind === 'mock',
      label: adapter.label,
      connect: () => {
        void adapter.connect().catch(() => undefined);
      },
      disconnect: () => {
        void adapter.disconnect().catch(() => undefined);
      },
      enableAssist: () => {
        demoStore.setAssistPreferred(true);
        requestMode('NORMAL');
      },
      pauseAssist: () => {
        demoStore.setAssistPreferred(false);
        requestMode('STOP');
      },
      send,
    }),
    [adapter, connection, mode, pending, requestMode, send],
  );

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
