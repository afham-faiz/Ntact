import { useEffect, useState, useSyncExternalStore } from 'react';
import { demoStore, todayKey } from '../demo/store';
import type { DateKey } from '../domain/dates';
import type { DemoState, Patient } from '../domain/types';

/** The whole demo state. Re-renders on any change, which is fine at this size. */
export function useDemoState(): DemoState {
  return useSyncExternalStore(demoStore.subscribe, demoStore.getState, demoStore.getState);
}

export function useActivePatient(): Patient {
  const state = useDemoState();
  return state.patients.find((patient) => patient.id === state.activePatientId) ?? state.patients[0];
}

/** Current clock, refreshed once a minute so greetings and "today" stay right overnight. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function useToday(): DateKey {
  return todayKey(useNow());
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/** Width of an element, for charts that draw to the pixel. */
export function useElementWidth<T extends HTMLElement>(fallback: number): [(node: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    if (!node) return;
    const measure = () => {
      const next = Math.round(node.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [setNode, width];
}
