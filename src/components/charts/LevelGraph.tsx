/**
 * The patient's graph: a plain line graph of the level felt each day.
 * Used on the home screen (last seven days) and on Recovery (any range), so the
 * two always look the same.
 *
 * Still strict about the data: the line only joins days next to each other, and
 * a day with no result is never placed on the 1–10 scale.
 */
import { useMemo, type PointerEvent } from 'react';
import { useElementWidth } from '../../app/hooks';
import { fromDateKey, type DateKey } from '../../domain/dates';
import { feltRuns, type DayPoint } from '../../domain/selectors';
import { C } from '../palette';
import { cx } from '../ui';
import { axisLabels, clamp, dayScale, indexAtX, labelEvery } from './geometry';
import { summariseSeries } from './RecoveryChart';

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const FRAME = { left: 30, right: 10 };

export function LevelGraph({
  series,
  today,
  activeIndex = null,
  onActiveChange,
  plotHeight = 150,
  className,
}: {
  series: DayPoint[];
  today: DateKey;
  activeIndex?: number | null;
  /** When given, tapping a day selects it. */
  onActiveChange?(index: number): void;
  plotHeight?: number;
  className?: string;
}) {
  const [measureRef, width] = useElementWidth<HTMLDivElement>(320);
  const count = series.length;
  const x = useMemo(() => dayScale(count, width, FRAME), [count, width]);
  const band = x.bandwidth();
  const top = 24;
  const bottom = top + plotHeight;
  const y = (level: number) => bottom - 6 - ((level - 1) / 9) * (plotHeight - 12);
  const centre = (index: number) => (x(index) ?? 0) + band / 2;

  const roomy = band >= 40; // a week: weekday names and words for missing results
  const numbered = band >= 19; // up to about two weeks: a number on every point
  const radius = clamp(band * 0.2, 2.4, 5.5);
  const height = bottom + (roomy ? 44 : 40);

  const runs = useMemo(() => feltRuns(series), [series]);
  const labels = useMemo(
    () =>
      roomy
        ? series.map((point, index) => ({ index, text: point.date === today ? 'Today' : WEEKDAY.format(fromDateKey(point.date)) }))
        : axisLabels(series.map((point) => point.date), labelEvery(band, 34), today),
    [roomy, series, band, today],
  );

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    if (!onActiveChange) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onActiveChange(indexAtX(event.clientX - bounds.left, count, width, FRAME));
  };

  const active = activeIndex !== null && activeIndex < count ? activeIndex : null;

  return (
    <div ref={measureRef} data-own-swipe className={cx('w-full', className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cx('block touch-pan-y select-none', onActiveChange && 'cursor-pointer')}
        role="img"
        aria-label={summariseSeries(series)}
        onPointerDown={(event) => {
          if (onActiveChange) event.currentTarget.setPointerCapture?.(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          // Finger or mouse held down: move through the days.
          if (event.buttons > 0 || event.pointerType === 'touch') pick(event);
        }}
      >
        {[1, 5, 10].map((level) => (
          <g key={level}>
            <line x1={FRAME.left} x2={width - FRAME.right} y1={y(level)} y2={y(level)} stroke={C.ink} strokeOpacity={0.1} strokeWidth={1} />
            <text x={FRAME.left - 8} y={y(level)} dy="0.34em" textAnchor="end" fontSize={11.5} fill={C.inkSoft} className="nums">
              {level}
            </text>
          </g>
        ))}

        {active !== null ? (
          <line x1={centre(active)} x2={centre(active)} y1={top - 6} y2={bottom} stroke={C.ink} strokeOpacity={0.25} strokeDasharray="3 3" />
        ) : null}

        {runs.map((run) =>
          run.indexes.length > 1 ? (
            <polyline
              key={run.indexes[0]}
              points={run.indexes.map((index) => `${centre(index).toFixed(1)},${y(series[index].step as number).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={C.ink}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null,
        )}

        {series.map((point, index) => {
          const cxValue = centre(index);
          const isToday = point.date === today;
          const isActive = index === active;
          if (point.kind === 'FELT') {
            const cy = y(point.step as number);
            return (
              <g key={point.date}>
                {isActive ? <circle cx={cxValue} cy={cy} r={radius + 6} fill={C.ink} fillOpacity={0.14} /> : null}
                <circle cx={cxValue} cy={cy} r={isToday ? radius + 1.5 : radius} fill={isToday ? C.wine600 : C.ink} />
                {numbered || isActive || isToday ? (
                  <text x={cxValue} y={cy - radius - 7} textAnchor="middle" fontSize={12} fontWeight={700} fill={C.ink} className="nums">
                    {point.step}
                  </text>
                ) : null}
              </g>
            );
          }
          if (point.kind === 'NONE') return null;
          // A test with no level: named under the day when there is room, otherwise a small mark.
          if (roomy) {
            return (
              <text key={point.date} x={cxValue} y={bottom + 36} textAnchor="middle" fontSize={10.5} fill={C.inkSoft}>
                {point.kind === 'NO_FELT' ? 'not felt' : 'cancelled'}
              </text>
            );
          }
          return point.kind === 'NO_FELT' ? (
            <circle key={point.date} cx={cxValue} cy={bottom + 31} r={Math.max(2.4, radius - 1)} fill="none" stroke={C.ink} strokeWidth={1.6} />
          ) : (
            <g key={point.date} stroke={C.inkSoft} strokeWidth={1.6} strokeLinecap="round">
              <line x1={cxValue - 3} y1={bottom + 28} x2={cxValue + 3} y2={bottom + 34} />
              <line x1={cxValue - 3} y1={bottom + 34} x2={cxValue + 3} y2={bottom + 28} />
            </g>
          );
        })}

        {labels.map((label, position) => {
          const isLast = !roomy && position === labels.length - 1;
          const isToday = label.text === 'Today';
          return (
            <text
              key={label.index}
              x={isLast ? Math.min(width - 2, centre(label.index) + 16) : centre(label.index)}
              y={bottom + 19}
              textAnchor={isLast ? 'end' : 'middle'}
              fontSize={11.5}
              fontWeight={isToday ? 700 : 500}
              fill={isToday ? C.ink : C.inkSoft}
              className="nums"
            >
              {label.text}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
