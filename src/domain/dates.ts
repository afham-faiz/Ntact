/**
 * Calendar-day helpers. A DateKey is a local calendar day (YYYY-MM-DD) in the
 * browser's time zone, which is what "today's test" means to a patient.
 */
export type DateKey = string;

const DAY_MS = 86_400_000;

export function toDateKey(date: Date): DateKey {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Noon local time, so daylight-saving changes never shift the day. */
export function fromDateKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(key: DateKey, amount: number): DateKey {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

/** Whole days from `earlier` to `later` (positive when `later` is after `earlier`). */
export function daysBetween(earlier: DateKey, later: DateKey): number {
  return Math.round((fromDateKey(later).getTime() - fromDateKey(earlier).getTime()) / DAY_MS);
}

export function dateKeyOf(iso: string): DateKey {
  return toDateKey(new Date(iso));
}

export function atLocalTime(key: DateKey, hours: number, minutes: number): string {
  const date = fromDateKey(key);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

/** `count` consecutive days ending on `end`, oldest first. */
export function lastDays(end: DateKey, count: number): DateKey[] {
  const days: DateKey[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) days.push(addDays(end, -offset));
  return days;
}

const weekdayShort = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const weekdayLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const monthShort = new Intl.DateTimeFormat('en-GB', { month: 'short' });
const monthLong = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const timeShort = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

/** "Tue 10 Nov" */
export function formatDay(key: DateKey): string {
  const date = fromDateKey(key);
  return `${weekdayShort.format(date)} ${date.getDate()} ${monthShort.format(date)}`;
}

/** "10 Nov" */
export function formatDayShort(key: DateKey): string {
  const date = fromDateKey(key);
  return `${date.getDate()} ${monthShort.format(date)}`;
}

/** "Tuesday 10 November" */
export function formatDayLong(key: DateKey): string {
  const date = fromDateKey(key);
  return `${weekdayLong.format(date)} ${date.getDate()} ${monthLong.format(date)}`;
}

/** "10 November 2026" */
export function formatDateFull(key: DateKey): string {
  const date = fromDateKey(key);
  return `${date.getDate()} ${monthLong.format(date)} ${date.getFullYear()}`;
}

/** "18:42" */
export function formatTime(iso: string): string {
  return timeShort.format(new Date(iso));
}

/** "Today", "Yesterday", "3 days ago", then a date once it is over a week old. */
export function relativeDay(key: DateKey, today: DateKey): string {
  const age = daysBetween(key, today);
  if (age === 0) return 'Today';
  if (age === 1) return 'Yesterday';
  if (age > 1 && age <= 7) return `${age} days ago`;
  return formatDayShort(key);
}

export function weeksSince(key: DateKey, today: DateKey): number {
  return Math.max(0, Math.floor(daysBetween(key, today) / 7));
}

export function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** "13.4 s" */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
