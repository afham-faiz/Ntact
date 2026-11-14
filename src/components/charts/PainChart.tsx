/**
 * Pain as reported in the daily check-in. Violet bars on their own 0–10 axis, so
 * patient-reported scores are never read against the device's step scale.
 * Days without a check-in are empty.
 */
import { useId, useMemo, type PointerEvent } from 'react';
import { useElementWidth } from '../../app/hooks';
import { painOf, skinIssueOf } from '../../domain/checkIn';
import type { DateKey } from '../../domain/dates';
import type { CheckIn } from '../../domain/types';
import { C } from '../palette';
import { cx } from '../ui';
import { axisLabels, clamp, dayScale, indexAtX, labelEvery, painScale, type ChartFrame } from './geometry';

type Variant = 'patient' | 'clinician';

const FRAME: Record<Variant, ChartFrame> = {
  patient: { left: 40, right: 14 },
  clinician: { left: 48, right: 22 },
};

export function PainChart({
  dates,
  checkIns,
  today,
  variant,
  activeIndex,
  onActiveChange,
  showAxis = true,
  className,
}: {
  dates: DateKey[];
  checkIns: CheckIn[];
  today: DateKey;
  variant: Variant;
  activeIndex: number | null;
  onActiveChange?(index: number | null): void;
  showAxis?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const frame = FRAME[variant];
  const [measureRef, width] = useElementWidth<HTMLDivElement>(variant === 'patient' ? 320 : 780);
  const plotTop = 16;
  const plotHeight = variant === 'patient' ? 72 : 84;
  const plotBottom = plotTop + plotHeight;
  const height = plotBottom + (showAxis ? 28 : 8);

  const count = dates.length;
  const x = useMemo(() => dayScale(count, width, frame), [count, width, frame]);
  const y = useMemo(() => painScale(plotTop, plotBottom), [plotTop, plotBottom]);
  const band = x.bandwidth();
  const barWidth = clamp(band * 0.56, 2, 14);
  const byDate = useMemo(() => new Map(checkIns.map((entry) => [entry.date, entry])), [checkIns]);
  const labels = useMemo(
    () => axisLabels(dates, labelEvery(band, variant === 'patient' ? 44 : 56), today),
    [dates, band, variant, today],
  );

  const reported = dates.filter((date) => byDate.has(date)).length;
  const summary = `Pain was reported on ${reported} of ${count} days.`;

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    if (!onActiveChange) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onActiveChange(indexAtX(event.clientX - bounds.left, count, width, frame));
  };

  return (
    <div ref={measureRef} data-own-swipe className={cx('w-full', className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block touch-pan-y select-none"
        role="img"
        aria-label={summary}
        onPointerDown={pick}
        onPointerMove={(event) => {
          if (variant === 'clinician' || event.buttons > 0 || event.pointerType === 'mouse') pick(event);
        }}
        onPointerLeave={() => {
          if (variant === 'clinician') onActiveChange?.(null);
        }}
      >
        <defs>
          <linearGradient id={`${uid}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.violet500} />
            <stop offset="100%" stopColor={C.violet300} />
          </linearGradient>
        </defs>

        {[0, 5, 10].map((value) => (
          <g key={value}>
            <line x1={frame.left} x2={width - frame.right} y1={y(value)} y2={y(value)} stroke={C.ink} strokeOpacity={0.08} strokeWidth={1} />
            <text x={frame.left - 10} y={y(value)} dy="0.34em" textAnchor="end" fontSize={11.5} fontWeight={500} fill={C.inkSoft} className="nums">
              {value}
            </text>
          </g>
        ))}

        {activeIndex !== null && activeIndex < count ? (
          <line
            x1={(x(activeIndex) ?? 0) + band / 2}
            x2={(x(activeIndex) ?? 0) + band / 2}
            y1={plotTop - 8}
            y2={plotBottom}
            stroke={C.ink}
            strokeOpacity={0.3}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ) : null}

        {dates.map((date, index) => {
          const entry = byDate.get(date);
          if (!entry) return null;
          const pain = painOf(entry);
          if (pain === null) return null;
          const centre = (x(index) ?? 0) + band / 2;
          const top = y(pain);
          const isActive = index === activeIndex;
          const markerY = Math.max(plotTop - 9, top - 11);
          return (
            <g key={date}>
              {/* A zero rating still gets a mark, so "no pain" is not confused with "no check-in". */}
              <rect
                x={centre - barWidth / 2}
                y={Math.min(top, plotBottom - 3)}
                width={barWidth}
                height={Math.max(3, plotBottom - top)}
                rx={Math.min(barWidth / 2, 5)}
                fill={isActive ? C.violet600 : `url(#${uid}-bar)`}
              />
              {skinIssueOf(entry) === true ? (
                <path d={`M ${centre} ${markerY} l 4.5 4.5 l -4.5 4.5 l -4.5 -4.5 Z`} fill={C.wine600} />
              ) : null}
              {isActive ? (
                <text x={centre} y={Math.max(11, top - (skinIssueOf(entry) === true ? 15 : 6))} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.ink} className="nums">
                  {pain}
                </text>
              ) : null}
            </g>
          );
        })}

        {showAxis
          ? labels.map((label, position) => {
              const isLast = position === labels.length - 1;
              const centre = (x(label.index) ?? 0) + band / 2;
              const isToday = label.text === 'Today';
              return (
                <text
                  key={label.index}
                  x={isLast ? Math.min(width - 2, centre + 18) : centre}
                  y={plotBottom + 18}
                  textAnchor={isLast ? 'end' : 'middle'}
                  fontSize={11.5}
                  fontWeight={isToday ? 700 : 500}
                  fill={isToday ? C.teal700 : C.inkSoft}
                  className="nums"
                >
                  {label.text}
                </text>
              );
            })
          : null}
      </svg>
    </div>
  );
}

export function PainLegend({ className }: { className?: string }) {
  return (
    <ul className={cx('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] leading-5 text-ink-soft', className)}>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden="true">
          <rect x="4.5" y="2" width="5" height="10" rx="2.5" fill={C.violet500} />
        </svg>
        Pain score, 0 to 10
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden="true">
          <path d="M7 2 12 7 7 12 2 7Z" fill={C.wine600} />
        </svg>
        New skin issue reported
      </li>
    </ul>
  );
}
