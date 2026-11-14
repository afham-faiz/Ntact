import { useRef, type TouchEvent } from 'react';

const MIN_DISTANCE = 56;

/**
 * Horizontal swipe on touch screens. Fires only for a clearly sideways gesture,
 * so vertical scrolling is never mistaken for one. Elements inside `ignore`
 * (a CSS selector) are left alone, for sliders, text fields and nested swipe areas.
 */
export function useSwipe(onSwipe: (direction: 'left' | 'right') => void, ignore = 'input, textarea, select') {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart(event: TouchEvent) {
      const target = event.target as Element | null;
      if (event.touches.length !== 1 || (target && ignore && target.closest(ignore))) {
        start.current = null;
        return;
      }
      start.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    },
    onTouchEnd(event: TouchEvent) {
      const from = start.current;
      start.current = null;
      if (!from || event.changedTouches.length === 0) return;
      const dx = event.changedTouches[0].clientX - from.x;
      const dy = event.changedTouches[0].clientY - from.y;
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.8) return;
      onSwipe(dx < 0 ? 'left' : 'right');
    },
  };
}
