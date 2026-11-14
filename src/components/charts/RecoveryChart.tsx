/**
 * The recovery curve: the detected level for each day's test, over time.
 *
 * It is drawn to be friendly, but it stays strict about what was recorded:
 *  - a line and its soft fill only ever join felt results on consecutive days.
 *    A day with no test, a not-felt test or a cancelled test ends the line;
 *  - "not felt" and "cancelled" never sit on the 1–10 scale. They have their own
 *    lane under the plot, so they cannot be read as a step;
 *  - nothing is smoothed, averaged or extrapolated. The optional trend line and
 *    the optional return-window band are clinician-only, drawn separately and
 *    labelled for what they are.
 */
import { useId, useMemo, type KeyboardEvent, type PointerEvent } from 'react';
import { useElementWidth } from '../../app/hooks';
import { formatDay, formatSeconds, formatTime, type DateKey } from '../../domain/dates';
import { feltRuns, type DayPoint, type LinearFit } from '../../domain/selectors';
import type { SensationTest } from '../../domain/types';
import { C } from '../palette';
import { cx } from '../ui';
import { axisLabels, clamp, dayScale, indexAtX, labelEvery, stepScale, type ChartFrame } from './geometry';

type Variant = 'patient' | 'clinician';

interface Layout {
  frame: ChartFrame;
  top: number;
  plot: number;
  laneGap: number;
  lane: number;
  axis: number;
  labelSpacing: number;
  fallbackWidth: number;
}

const LAYOUT: Record<Variant, Layout> = {
  patient: { frame: { left: 40, right: 14 }, top: 30, plot: 176, laneGap: 26, lane: 30, axis: 28, labelSpacing: 34, fallbackWidth: 320 },
  clinician: { frame: { left: 48, right: 22 }, top: 34, plot: 236, laneGap: 14, lane: 30, axis: 28, labelSpacing: 56, fallbackWidth: 780 },
};

export function summariseSeries(series: DayPoint[]): string {
  const felt = series.filter((point) => point.kind === 'FELT');
  const notFelt = series.filter((point) => point.kind === 'NO_FELT').length;
  const cancelled = series.filter((point) => point.kind === 'STOPPED').length;
  const none = series.filter((point) => point.kind === 'NONE').length;
  const steps = felt.map((point) => point.step as number);
  const range =
    steps.length === 0
      ? 'No vibration was reported as felt.'
      : Math.min(...steps) === Math.max(...steps)
        ? `A vibration was felt on ${felt.length} of ${series.length} days, always at level ${steps[0]}.`
        : `A vibration was felt on ${felt.length} of ${series.length} days, between level ${Math.min(...steps)} and level ${Math.max(...steps)}.`;
  return `${range} ${notFelt} ${notFelt === 1 ? 'day' : 'days'} completed without a reported vibration, ${cancelled} cancelled, ${none} with no test.`;
}

function describeForPatient(test: SensationTest): string {
  if (test.outcome === 'FELT') return `felt at level ${test.detectedLevel} of 10`;
  if (test.outcome === 'NO_FELT') return 'test completed, no vibration reported';
  return test.stopReason === 'EARLY_RESPONSE' ? 'cancelled: tapped before the test began' : 'cancelled before a result';
}

/** One-line readout for the patient view. */
export function patientReadout(point: DayPoint, today: DateKey): string {
  const day = point.date === today ? 'Today' : formatDay(point.date);
  if (!point.primary) return point.date === today ? 'Today: no test yet' : `${day}: no test`;
  return `${day}: ${describeForPatient(point.primary)}`;
}

function ClinicianTip({ point }: { point: DayPoint }) {
  return (
    <div className="w-[244px] rounded-[10px] border border-ink/25 bg-paper px-3.5 py-3 text-[12.5px] leading-[18px] text-ink">
      <p className="font-semibold">{formatDay(point.date)}</p>
      {point.tests.length === 0 ? (
        <p className="mt-0.5 text-ink-soft">No test logged.</p>
      ) : (
        <ul className="mt-1.5 space-y-2">
          {point.tests.map((test) => (
            <li key={test.id}>
              <p className="nums">
                <span className="text-ink-soft">{formatTime(test.timestamp)}</span>{' '}
                {test.outcome === 'FELT' ? (
                  <span className="font-semibold">Felt at level {test.detectedLevel}</span>
                ) : test.outcome === 'NO_FELT' ? (
                  <span className="font-semibold">Not felt (all 10 levels ran)</span>
                ) : (
                  <span className="font-semibold">
                    Cancelled{test.stopReason === 'EARLY_RESPONSE' ? ' (tap before first level)' : ''}
                  </span>
                )}
              </p>
              {test.outcome === 'FELT' ? (
                <p className="nums text-ink-soft">
                  Motor command RTP {test.commandedRtp}, reported after {formatSeconds(test.elapsedMs)}
                </p>
              ) : (
                <p className="text-ink-soft">No level recorded.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 border-t border-line-soft pt-1.5 text-[11.5px] text-ink-soft">Click to pin this day.</p>
    </div>
  );
}

export interface RecoveryChartProps {
  series: DayPoint[];
  today: DateKey;
  variant: Variant;
  /** Day under the pointer or keyboard cursor. */
  activeIndex: number | null;
  onActiveChange(index: number | null): void;
  /** Clinician: day pinned for inspection. */
  selectedIndex?: number | null;
  onSelect?(index: number): void;
  /** First day the person was enrolled. Earlier days are outside monitoring, not missed. */
  enrolledDate?: DateKey;
  /** Clinician only: illustrative return window, as dates. Drawn where it overlaps the view. */
  returnWindow?: { earliest: DateKey; latest: DateKey } | null;
  /** Clinician only: least-squares line through the felt results in view. */
  fit?: LinearFit | null;
  /** Clinician: shade days that had no test. */
  highlightMissing?: boolean;
  className?: string;
}

export function RecoveryChart({
  series,
  today,
  variant,
  activeIndex,
  onActiveChange,
  selectedIndex = null,
  onSelect,
  enrolledDate,
  returnWindow = null,
  fit = null,
  highlightMissing = false,
  className,
}: RecoveryChartProps) {
  const layout = LAYOUT[variant];
  const [measureRef, width] = useElementWidth<HTMLDivElement>(layout.fallbackWidth);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const descriptionId = `${uid}-desc`;
  const clinician = variant === 'clinician';

  const count = series.length;
  const x = useMemo(() => dayScale(count, width, layout.frame), [count, width, layout.frame]);
  const band = x.bandwidth();
  const plotTop = layout.top;
  const plotBottom = layout.top + layout.plot;
  const y = useMemo(() => stepScale(plotTop + 8, plotBottom - 8), [plotTop, plotBottom]);
  const laneTop = plotBottom + layout.laneGap;
  const laneMid = laneTop + layout.lane / 2;
  const height = laneTop + layout.lane + layout.axis;
  const left = layout.frame.left;
  const right = width - layout.frame.right;

  const radius = clamp(band * 0.2, 2.2, clinician ? 4.6 : 5);
  const centre = (index: number) => (x(index) ?? 0) + band / 2;

  const runs = useMemo(() => feltRuns(series), [series]);
  const labels = useMemo(
    () => axisLabels(series.map((point) => point.date), labelEvery(band, layout.labelSpacing), today),
    [series, band, layout.labelSpacing, today],
  );
  const summary = useMemo(() => summariseSeries(series), [series]);

  const lastFeltIndex = useMemo(() => {
    for (let index = series.length - 1; index >= 0; index -= 1) if (series[index].kind === 'FELT') return index;
    return -1;
  }, [series]);

  const focusIndex = activeIndex ?? selectedIndex;
  const focus = focusIndex !== null && focusIndex >= 0 && focusIndex < count ? series[focusIndex] : null;
  const showValues = clinician && band >= 19;
  const todayIndex = series.length > 0 && series[series.length - 1].date === today ? series.length - 1 : -1;

  // Illustrative return window, clipped to the days in view.
  const windowSpan = useMemo(() => {
    if (!returnWindow) return null;
    let first = -1;
    let last = -1;
    series.forEach((point, index) => {
      if (point.date >= returnWindow.earliest && point.date <= returnWindow.latest) {
        if (first === -1) first = index;
        last = index;
      }
    });
    return first === -1 ? null : { first, last };
  }, [returnWindow, series]);

  const enrolledIndex = enrolledDate ? series.findIndex((point) => point.date === enrolledDate) : -1;

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return indexAtX(event.clientX - bounds.left, count, width, layout.frame);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = activeIndex ?? selectedIndex ?? count - 1;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onActiveChange(clamp(activeIndex === null ? current : current - 1, 0, count - 1));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onActiveChange(clamp(activeIndex === null ? current : current + 1, 0, count - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onActiveChange(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      onActiveChange(count - 1);
    } else if ((event.key === 'Enter' || event.key === ' ') && onSelect && activeIndex !== null) {
      event.preventDefault();
      onSelect(activeIndex);
    } else if (event.key === 'Escape' && clinician) {
      onActiveChange(null);
    }
  };

  const tipLeft =
    activeIndex === null ? 0 : centre(activeIndex) < width / 2 ? centre(activeIndex) + 16 : centre(activeIndex) - 16 - 244;

  const fitLine = useMemo(() => {
    if (!fit || lastFeltIndex < 0) return null;
    const firstFelt = series.findIndex((point) => point.kind === 'FELT');
    if (firstFelt < 0 || firstFelt === lastFeltIndex) return null;
    const at = (index: number) => clamp(fit.intercept + fit.slope * index, 1, 10);
    return { x1: centre(firstFelt), y1: y(at(firstFelt)), x2: centre(lastFeltIndex), y2: y(at(lastFeltIndex)) };
    // centre and y derive from the same inputs as the dependencies below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, series, lastFeltIndex, width, band]);

  return (
    <div
      ref={measureRef}
      className={cx('relative w-full rounded-[10px]', className)}
      role="group"
      tabIndex={0}
      aria-label="Recovery curve. Use the left and right arrow keys to move between days."
      aria-describedby={descriptionId}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (clinician) onActiveChange(null);
      }}
    >
      <p id={descriptionId} className="sr-only-live">
        {summary}
      </p>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cx('block touch-pan-y select-none', onSelect && 'cursor-pointer')}
        role="img"
        aria-label={summary}
        onPointerDown={(event) => {
          const index = pick(event);
          onActiveChange(index);
          onSelect?.(index);
        }}
        onPointerMove={(event) => {
          if (clinician || event.pointerType === 'mouse') onActiveChange(pick(event));
        }}
        onPointerLeave={() => {
          if (clinician) onActiveChange(null);
        }}
      >
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.teal400} stopOpacity="0.1" />
            <stop offset="100%" stopColor={C.teal400} stopOpacity="0" />
          </linearGradient>
          <pattern id={`${uid}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke={C.ink} strokeOpacity="0.1" strokeWidth="1.5" />
          </pattern>
          <pattern id={`${uid}-window`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <rect width="8" height="8" fill={C.violet100} fillOpacity="0.55" />
            <line x1="0" y1="0" x2="0" y2="8" stroke={C.violet500} strokeOpacity="0.2" strokeWidth="2" />
          </pattern>
        </defs>

        {/* Today */}
        {todayIndex >= 0 ? (
          <rect
            x={(x(todayIndex) ?? 0) + (band > 8 ? 1 : 0)}
            y={plotTop - 4}
            width={Math.max(2, band - (band > 8 ? 2 : 0))}
            height={laneTop + layout.lane - plotTop + 4}
            rx={Math.min(8, band / 2)}
            fill={C.mint}
            fillOpacity={0.5}
          />
        ) : null}

        {/* Clinician: days with no test, shaded so gaps are obvious */}
        {highlightMissing
          ? series.map((point, index) =>
              point.kind === 'NONE' && index !== todayIndex && (!enrolledDate || point.date >= enrolledDate) ? (
                <rect
                  key={`missing-${point.date}`}
                  x={x(index) ?? 0}
                  y={plotTop}
                  width={band}
                  height={layout.plot}
                  fill={`url(#${uid}-hatch)`}
                />
              ) : null,
            )
          : null}

        {/* Clinician: illustrative return window */}
        {windowSpan ? (
          <g>
            <rect
              x={x(windowSpan.first) ?? 0}
              y={plotTop}
              width={(x(windowSpan.last) ?? 0) + band - (x(windowSpan.first) ?? 0)}
              height={layout.plot}
              fill={`url(#${uid}-window)`}
            />
            <line x1={x(windowSpan.first) ?? 0} x2={x(windowSpan.first) ?? 0} y1={plotTop} y2={plotBottom} stroke={C.violet500} strokeWidth={1} strokeDasharray="3 3" />
            <text
              x={clamp((x(windowSpan.first) ?? 0) + 6, left, right - 150)}
              y={plotTop - 10}
              fontSize={11}
              fontWeight={600}
              fill={C.violet600}
            >
              Illustrative return window
            </text>
          </g>
        ) : null}

        {/* Step guides */}
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((step) => (
          <line
            key={step}
            x1={left}
            x2={right}
            y1={y(step)}
            y2={y(step)}
            stroke={C.ink}
            strokeOpacity={step === 1 || step === 5 || step === 10 ? 0.1 : 0.045}
            strokeWidth={1}
          />
        ))}
        {(clinician ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 5, 10]).map((step) => (
          <text
            key={step}
            x={left - 10}
            y={y(step)}
            dy="0.34em"
            textAnchor="end"
            fontSize={11.5}
            fontWeight={500}
            fill={C.inkSoft}
            className="nums"
          >
            {step}
          </text>
        ))}
        {!clinician ? (
          <>
            <text x={left} y={plotTop - 12} fontSize={12} fontWeight={600} fill={C.inkSoft}>
              ↑ Stronger vibration
            </text>
            <text x={left} y={plotBottom + 17} fontSize={12} fontWeight={600} fill={C.inkSoft}>
              ↓ Gentler vibration
            </text>
            <text x={right} y={plotBottom + 17} textAnchor="end" fontSize={11} fill={C.inkSoft}>
              no result:
            </text>
          </>
        ) : null}

        {/* Enrolment marker */}
        {enrolledIndex > 0 ? (
          <g>
            <line
              x1={x(enrolledIndex) ?? 0}
              x2={x(enrolledIndex) ?? 0}
              y1={plotTop}
              y2={plotBottom}
              stroke={C.inkFaint}
              strokeWidth={1}
              strokeDasharray="2 4"
            />
            <text x={(x(enrolledIndex) ?? 0) + 5} y={plotBottom - 6} fontSize={10.5} fill={C.inkSoft}>
              {clinician ? 'Enrolled' : 'Started'}
            </text>
          </g>
        ) : null}

        {/* Lane for results that are not a step */}
        <rect x={left} y={laneTop} width={Math.max(0, right - left)} height={layout.lane} rx={layout.lane / 2} fill={C.ink} fillOpacity={0.045} />
        {clinician ? (
          <text x={left - 10} y={laneMid} dy="0.34em" textAnchor="end" fontSize={10.5} fill={C.inkSoft}>
            No level
          </text>
        ) : null}

        {/* Focus guide */}
        {focus && focusIndex !== null ? (
          <line
            x1={centre(focusIndex)}
            x2={centre(focusIndex)}
            y1={plotTop}
            y2={laneTop + layout.lane}
            stroke={C.ink}
            strokeOpacity={0.3}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ) : null}

        {/* Runs: fill, then line */}
        {runs.map((run) => {
          if (run.indexes.length < 2) return null;
          const points = run.indexes.map((index) => `${centre(index).toFixed(1)} ${y(series[index].step as number).toFixed(1)}`);
          const first = centre(run.indexes[0]).toFixed(1);
          const last = centre(run.indexes[run.indexes.length - 1]).toFixed(1);
          return (
            <g key={`run-${run.indexes[0]}`}>
              <path d={`M ${points.join(' L ')} L ${last} ${plotBottom} L ${first} ${plotBottom} Z`} fill={`url(#${uid}-fill)`} />
              <path
                d={`M ${points.join(' L ')}`}
                fill="none"
                stroke={C.teal500}
                strokeWidth={clinician ? 2 : 2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {/* Clinician: statistical trend, clearly not a forecast */}
        {fitLine ? (
          <g>
            <line {...fitLine} stroke={C.ink} strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="2 5" strokeLinecap="round" />
            <text x={Math.min(fitLine.x2 + 6, right - 2)} y={fitLine.y2 - 8} textAnchor="end" fontSize={10.5} fill={C.inkSoft}>
              statistical trend
            </text>
          </g>
        ) : null}

        {/* Marks */}
        {series.map((point, index) => {
          const cxValue = centre(index);
          const isFocus = index === focusIndex;
          const isSelected = index === selectedIndex;
          if (point.kind === 'FELT') {
            const cy = y(point.step as number);
            const emphasised = isFocus || isSelected || (!clinician && activeIndex === null && index === lastFeltIndex);
            return (
              <g key={point.date}>
                {emphasised ? <circle cx={cxValue} cy={cy} r={radius + 6} fill={C.teal400} fillOpacity={0.22} /> : null}
                <circle
                  cx={cxValue}
                  cy={cy}
                  r={emphasised ? radius + 1 : radius}
                  fill={emphasised ? C.teal600 : C.paper}
                  stroke={C.teal600}
                  strokeWidth={radius > 3 ? 2.2 : 1.6}
                />
                {showValues || (clinician && emphasised) ? (
                  <text
                    x={cxValue}
                    y={cy - radius - 7}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={emphasised ? 700 : 600}
                    fill={C.ink}
                    className="nums"
                  >
                    {point.step}
                  </text>
                ) : null}
                {!clinician && emphasised ? (
                  <g transform={`translate(${clamp(cxValue, left + 16, right - 16)} ${cy - radius - 13})`}>
                    <rect x={-16} y={-21} width={32} height={22} rx={11} fill={C.ink} />
                    <text x={0} y={-5.5} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={C.paper} className="nums">
                      {point.step}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          }
          if (point.kind === 'NO_FELT') {
            const ring = Math.max(radius, 3.2);
            return (
              <g key={point.date}>
                {isFocus || isSelected ? <circle cx={cxValue} cy={laneMid} r={ring + 5} fill={C.violet500} fillOpacity={0.18} /> : null}
                <circle cx={cxValue} cy={laneMid} r={ring} fill={C.paper} stroke={C.violet500} strokeWidth={2} />
              </g>
            );
          }
          if (point.kind === 'STOPPED') {
            const arm = Math.max(radius * 0.8, 2.6);
            return (
              <g key={point.date} stroke={C.inkSoft} strokeWidth={1.8} strokeLinecap="round">
                <line x1={cxValue - arm} y1={laneMid - arm} x2={cxValue + arm} y2={laneMid + arm} />
                <line x1={cxValue - arm} y1={laneMid + arm} x2={cxValue + arm} y2={laneMid - arm} />
              </g>
            );
          }
          // No test. Shown as a quiet open dot when days are wide enough to read, otherwise left blank.
          if (band < 12 || index === todayIndex || (enrolledDate && point.date < enrolledDate)) return null;
          return (
            <circle
              key={point.date}
              cx={cxValue}
              cy={laneMid}
              r={Math.max(2, radius - 1.4)}
              fill="none"
              stroke={C.inkFaint}
              strokeWidth={1.2}
              strokeDasharray="1.6 2.2"
            />
          );
        })}

        {/* Dates */}
        {labels.map((label, position) => {
          const isLast = position === labels.length - 1;
          const isToday = label.text === 'Today';
          return (
            <text
              key={label.index}
              x={isLast ? Math.min(width - 2, centre(label.index) + 18) : centre(label.index)}
              y={laneTop + layout.lane + 18}
              textAnchor={isLast ? 'end' : 'middle'}
              fontSize={11.5}
              fontWeight={isToday ? 700 : 500}
              fill={isToday ? C.teal700 : C.inkSoft}
              className="nums"
            >
              {label.text}
            </text>
          );
        })}
      </svg>

      {clinician && activeIndex !== null && series[activeIndex] ? (
        <div className="pointer-events-none absolute z-10" style={{ left: clamp(tipLeft, 0, Math.max(0, width - 244)), top: plotTop + 4 }}>
          <ClinicianTip point={series[activeIndex]} />
        </div>
      ) : null}
    </div>
  );
}

/** Shape key shared by both views. Shapes differ, so it never relies on colour alone. */
export function RecoveryLegend({
  className,
  variant = 'patient',
  showMissing = true,
}: {
  className?: string;
  variant?: Variant;
  showMissing?: boolean;
}) {
  const patient = variant === 'patient';
  return (
    <ul className={cx('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] leading-5 text-ink-soft', className)}>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden="true">
          <circle cx="7" cy="7" r="4.4" fill={C.paper} stroke={C.teal600} strokeWidth="2.2" />
        </svg>
        {patient ? 'Felt' : 'Felt at this level'}
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden="true">
          <circle cx="7" cy="7" r="4.4" fill={C.paper} stroke={C.violet500} strokeWidth="2" />
        </svg>
        {patient ? 'Not felt' : 'Completed, not felt'}
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden="true" stroke={C.inkSoft} strokeWidth="1.8" strokeLinecap="round">
          <path d="M3.5 3.5l7 7M3.5 10.5l7-7" />
        </svg>
        Cancelled
      </li>
      {showMissing ? (
        <li className="flex items-center gap-1.5">
          <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden="true">
            <circle cx="7" cy="7" r="4" fill="none" stroke={C.inkFaint} strokeWidth="1.3" strokeDasharray="1.6 2.2" />
          </svg>
          No test
        </li>
      ) : null}
    </ul>
  );
}
