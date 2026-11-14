/**
 * Small supporting charts for the clinician portal. Each one counts records the
 * prototype really holds; none of them invents a rate or a trend.
 */
import { useElementWidth } from '../../app/hooks';
import { formatDayShort, type DateKey } from '../../domain/dates';
import type { WeekCount } from '../../domain/adherence';
import type { DayKind } from '../../domain/selectors';
import { C } from '../palette';
import { cx } from '../ui';

// ---------- Donut ----------

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function Donut({ slices, centre, caption, size = 132 }: { slices: DonutSlice[]; centre: string; caption: string; size?: number }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const gap = total > 0 && slices.filter((slice) => slice.value > 0).length > 1 ? 3 : 0;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`${caption}: ${slices.map((slice) => `${slice.label} ${slice.value}`).join(', ')}`}>
      <circle cx="60" cy="60" r={radius} fill="none" stroke={C.ink} strokeOpacity="0.07" strokeWidth="13" />
      {total > 0
        ? slices.map((slice) => {
            if (slice.value === 0) return null;
            const length = (slice.value / total) * circumference;
            const dash = `${Math.max(0, length - gap)} ${circumference - Math.max(0, length - gap)}`;
            const element = (
              <circle
                key={slice.label}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth="13"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                transform="rotate(-90 60 60)"
              />
            );
            offset += length;
            return element;
          })
        : null}
      <text x="60" y="58" textAnchor="middle" fontSize="27" fontWeight="700" letterSpacing="-0.03em" fill={C.ink}>
        {centre}
      </text>
      <text x="60" y="75" textAnchor="middle" fontSize="10.5" fontWeight="500" fill={C.inkSoft}>
        {caption}
      </text>
    </svg>
  );
}

// ---------- Cohort activity: tests logged per day ----------

export interface ActivityDay {
  date: DateKey;
  felt: number;
  notFelt: number;
  cancelled: number;
  /** People enrolled on that day. */
  enrolled: number;
}

export function ActivityBars({ days, today }: { days: ActivityDay[]; today: DateKey }) {
  const [measureRef, width] = useElementWidth<HTMLDivElement>(420);
  const height = 118;
  const plot = height - 24;
  const band = width / days.length;
  const barWidth = Math.min(26, Math.max(6, band * 0.56));
  const max = Math.max(1, ...days.map((day) => day.enrolled));
  const unit = (plot - 8) / max;
  const labelEvery = band < 30 ? 2 : 1;

  return (
    <div ref={measureRef} className="w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
        role="img"
        aria-label={`Tests logged per day across the cohort for the last ${days.length} days.`}
      >
        {days.map((day, index) => {
          const x0 = index * band + (band - barWidth) / 2;
          const feltH = day.felt * unit;
          const notFeltH = day.notFelt * unit;
          const cancelledH = day.cancelled * unit;
          const trackH = day.enrolled * unit;
          const radius = Math.min(barWidth / 2, 7);
          const total = feltH + notFeltH + cancelledH;
          return (
            <g key={day.date}>
              {/* Track: how many people could have tested that day */}
              <rect x={x0} y={plot - trackH} width={barWidth} height={trackH} rx={radius} fill={C.ink} fillOpacity={0.055} />
              {total > 0 ? (
                <g clipPath={`inset(0 round ${radius}px)`}>
                  <rect x={x0} y={plot - total} width={barWidth} height={total} rx={radius} fill={C.teal500} />
                  {notFeltH > 0 ? <rect x={x0} y={plot - feltH - notFeltH} width={barWidth} height={notFeltH} fill={C.violet500} /> : null}
                  {cancelledH > 0 ? (
                    <rect x={x0} y={plot - total} width={barWidth} height={cancelledH} rx={radius} fill={C.inkFaint} />
                  ) : null}
                </g>
              ) : null}
              {(days.length - 1 - index) % labelEvery === 0 ? (
                <text
                  x={index === days.length - 1 ? width - 2 : index * band + band / 2}
                  y={height - 6}
                  textAnchor={index === days.length - 1 ? 'end' : 'middle'}
                  fontSize={11}
                  fontWeight={day.date === today ? 700 : 500}
                  fill={day.date === today ? C.teal700 : C.inkSoft}
                  className="nums"
                >
                  {day.date === today ? 'Today' : formatDayShort(day.date).split(' ')[0]}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- Weekly test frequency ----------

export function WeeklyBars({ weeks, className }: { weeks: WeekCount[]; className?: string }) {
  return (
    <div className={cx('flex items-end gap-1.5', className)} role="img" aria-label={`Completed-test days per week: ${weeks.map((week) => `${week.testDays} of ${week.days}`).join(', ')}`}>
      {weeks.map((week, index) => {
        const latest = index === weeks.length - 1;
        return (
          <div key={week.start} className="flex flex-1 flex-col items-center gap-1">
            <div className="relative flex h-[64px] w-full max-w-[26px] flex-col justify-end overflow-hidden rounded-[6px] bg-ink/[0.06]">
              <div
                className={cx('w-full rounded-[6px]', latest ? 'bg-ink' : 'bg-ink/35')}
                style={{ height: `${(week.testDays / 7) * 100}%` }}
              />
            </div>
            <span className={cx('nums text-[11px] leading-3', latest ? 'font-bold text-ink' : 'text-ink-soft')}>{week.testDays}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Day-by-day completion strip ----------

export interface StripDay {
  date: DateKey;
  kind: DayKind;
  checkIn: boolean;
  /** Before enrolment: outside monitoring. */
  outside: boolean;
}

const STRIP_LABEL: Record<DayKind, string> = {
  FELT: 'completed, felt',
  NO_FELT: 'completed, not felt',
  STOPPED: 'cancelled',
  NONE: 'no test',
};

/** One cell per day: test outcome as the cell, check-in as the dot underneath. */
export function CompletionStrip({ days, today }: { days: StripDay[]; today: DateKey }) {
  return (
    <ol className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-x-1 gap-y-2.5">
      {days.map((day) => {
        const isToday = day.date === today;
        return (
          <li key={day.date} className="flex flex-col items-center gap-1" title={`${formatDayShort(day.date)}: ${day.outside ? 'before enrolment' : STRIP_LABEL[day.kind]}${day.checkIn ? ', check-in done' : ''}`}>
            <span
              className={cx(
                'relative grid aspect-square w-full max-w-[26px] place-items-center rounded-[6px]',
                day.outside && 'bg-transparent',
                !day.outside && day.kind === 'FELT' && 'bg-ink',
                !day.outside && day.kind === 'NO_FELT' && 'border-2 border-ink bg-paper',
                !day.outside && day.kind === 'STOPPED' && 'bg-ink/[0.12]',
                !day.outside && day.kind === 'NONE' && 'hatch border border-dashed border-ink/25',
                isToday && 'ring-2 ring-wine-600 ring-offset-2 ring-offset-paper',
              )}
            >
              {!day.outside && day.kind === 'STOPPED' ? (
                <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true" stroke={C.inkSoft} strokeWidth="1.6" strokeLinecap="round">
                  <path d="M2 2l6 6M2 8l6-6" />
                </svg>
              ) : null}
              <span className="sr-only-live">
                {formatDayShort(day.date)}: {day.outside ? 'before enrolment' : STRIP_LABEL[day.kind]}
                {day.checkIn ? ', check-in done' : ''}
              </span>
            </span>
            <span className={cx('size-1.5 rounded-full', day.checkIn ? 'bg-ink-soft' : 'bg-transparent')} aria-hidden="true" />
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Tiny inline bars for stat cards ----------

export function MiniBars({ values, max, tone = 'teal' }: { values: number[]; max: number; tone?: 'teal' | 'navy' }) {
  return (
    <span className="flex h-8 items-end gap-[3px]" aria-hidden="true">
      {values.map((value, index) => (
        <span
          key={index}
          className={cx(
            'w-[7px] rounded-[2px]',
            index === values.length - 1 ? (tone === 'teal' ? 'bg-teal-500' : 'bg-navy-800') : tone === 'teal' ? 'bg-teal-200' : 'bg-navy-100',
          )}
          style={{ height: `${Math.max(8, (value / Math.max(1, max)) * 100)}%` }}
        />
      ))}
    </span>
  );
}
