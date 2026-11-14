/**
 * Runs before every test file (see `test.setupFiles` in vite.config.ts).
 *
 * Vitest globals are off in this project, so Testing Library never registers
 * its automatic cleanup. It is called here instead, after each test.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom has no layout or media engine, so it ships neither of the two APIs
// below. Components that ask about reduced motion or measure their own width
// need them to exist; neither stub ever reports a change.

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  const matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {
      // Nothing to measure in jsdom.
    }

    unobserve(): void {
      // Nothing was being observed.
    }

    disconnect(): void {
      // Nothing to release.
    }
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}
