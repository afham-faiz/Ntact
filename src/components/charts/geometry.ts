import { scaleBand, scaleLinear } from '@visx/scale';
import { fromDateKey, type DateKey } from '../../domain/dates';

export interface ChartFrame {
  left: number;
  right: number;
}

/** One band per calendar day. Days are categories, not a continuous line. */
export function dayScale(count: number, width: number, frame: ChartFrame) {
  return scaleBand<number>({
    domain: Array.from({ length: count }, (_, index) => index),
    range: [frame.left, Math.max(frame.left + 1, width - frame.right)],
    padding: 0,
  });
}

/** Ordinal steps 1–10 mapped to a vertical range. Step 1 sits at the bottom. */
export function stepScale(top: number, bottom: number) {
  return scaleLinear<number>({ domain: [1, 10], range: [bottom, top] });
}

export function painScale(top: number, bottom: number) {
  return scaleLinear<number>({ domain: [0, 10], range: [bottom, top] });
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Which day a pointer position falls on. */
export function indexAtX(x: number, count: number, width: number, frame: ChartFrame): number {
  const inner = Math.max(1, width - frame.left - frame.right);
  return clamp(Math.floor(((x - frame.left) / inner) * count), 0, count - 1);
}

const LABEL_STEPS = [1, 2, 7, 14, 28];

/** Days between x-axis labels so they never collide, counted back from the newest day. */
export function labelEvery(dayWidth: number, minSpacing: number): number {
  for (const step of LABEL_STEPS) {
    if (step * dayWidth >= minSpacing) return step;
  }
  return LABEL_STEPS[LABEL_STEPS.length - 1];
}

const monthShort = new Intl.DateTimeFormat('en-GB', { month: 'short' });

export interface AxisLabel {
  index: number;
  text: string;
}

/** Labels like "30 Oct", "1 Nov", "3", "5" … "Today": the month appears only when it changes. */
export function axisLabels(dates: DateKey[], every: number, today: DateKey): AxisLabel[] {
  const labels: AxisLabel[] = [];
  let previousMonth = -1;
  for (let index = 0; index < dates.length; index += 1) {
    if ((dates.length - 1 - index) % every !== 0) continue;
    const date = fromDateKey(dates[index]);
    if (dates[index] === today) {
      labels.push({ index, text: 'Today' });
    } else if (date.getMonth() !== previousMonth) {
      labels.push({ index, text: `${date.getDate()} ${monthShort.format(date)}` });
    } else {
      labels.push({ index, text: String(date.getDate()) });
    }
    previousMonth = date.getMonth();
  }
  return labels;
}
