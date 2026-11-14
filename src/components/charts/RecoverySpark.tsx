/**
 * Small, non-interactive recovery curve. Same rules as the full chart: lines and
 * fills only join felt results on consecutive days, and not-felt or cancelled
 * days sit on their own rail under the plot.
 */
import { useId } from 'react';
import { feltRuns, type DayPoint } from '../../domain/selectors';
import { C } from '../palette';
import { summariseSeries } from './RecoveryChart';

interface SparkSize {
  width: number;
  plot: number;
  rail: number;
  gap: number;
  radius: number;
  padX: number;
  stroke: number;
}

const SIZES: Record<'home' | 'row', SparkSize> = {
  home: { width: 320, plot: 84, rail: 18, gap: 9, radius: 4.4, padX: 6, stroke: 2.5 },
  row: { width: 148, plot: 26, rail: 9, gap: 4, radius: 2.2, padX: 3, stroke: 1.5 },
};

export function RecoverySpark({
  series,
  size,
  highlightLast = false,
  plain = false,
  className,
}: {
  /** Editorial look: ink line and dots, no fill, no tint. */
  plain?: boolean;
  series: DayPoint[];
  size: 'home' | 'row';
  /** Tint the newest column (today). */
  highlightLast?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const s = SIZES[size];
  const count = series.length;
  const band = (s.width - s.padX * 2) / count;
  const top = s.radius + 3;
  const bottom = top + s.plot;
  const railTop = bottom + s.gap;
  const railMid = railTop + s.rail / 2;
  const height = railTop + s.rail + 1;

  const cxAt = (index: number) => s.padX + band * (index + 0.5);
  const yAt = (step: number) => bottom - ((step - 1) / 9) * s.plot;
  const runs = feltRuns(series);

  let lastFelt = -1;
  for (let index = count - 1; index >= 0; index -= 1) {
    if (series[index].kind === 'FELT') {
      lastFelt = index;
      break;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${s.width} ${height}`}
      className={className}
      width={size === 'row' ? s.width : undefined}
      height={size === 'row' ? height : undefined}
      role="img"
      aria-label={`Last ${count} days. ${summariseSeries(series)}`}
    >
      <defs>
        <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.teal400} stopOpacity={size === 'home' ? 0.36 : 0.28} />
          <stop offset="100%" stopColor={C.teal400} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {highlightLast && !plain ? (
        <rect
          x={cxAt(count - 1) - band / 2 + 1.5}
          y={0}
          width={band - 3}
          height={height}
          rx={Math.min(8, band / 2 - 1.5)}
          fill={C.mint}
          fillOpacity={0.6}
        />
      ) : null}

      {size === 'home'
        ? [1, 5.5, 10].map((step) => (
            <line
              key={step}
              x1={s.padX}
              x2={s.width - s.padX}
              y1={yAt(step)}
              y2={yAt(step)}
              stroke={C.ink}
              strokeOpacity={step === 5.5 ? 0.05 : 0.09}
              strokeWidth={1}
              strokeDasharray={step === 5.5 ? '2 5' : undefined}
            />
          ))
        : null}

      {plain ? (
        <line x1={s.padX} x2={s.width - s.padX} y1={railTop - s.gap / 2} y2={railTop - s.gap / 2} stroke={C.ink} strokeOpacity={0.18} strokeWidth={1} />
      ) : (
        <rect x={s.padX} y={railTop} width={s.width - s.padX * 2} height={s.rail} rx={s.rail / 2} fill={C.ink} fillOpacity={0.05} />
      )}

      {runs.map((run) => {
        if (run.indexes.length < 2) return null;
        const points = run.indexes.map((index) => `${cxAt(index).toFixed(1)} ${yAt(series[index].step as number).toFixed(1)}`);
        const first = cxAt(run.indexes[0]).toFixed(1);
        const last = cxAt(run.indexes[run.indexes.length - 1]).toFixed(1);
        return (
          <g key={run.indexes[0]}>
            {plain ? null : <path d={`M ${points.join(' L ')} L ${last} ${bottom} L ${first} ${bottom} Z`} fill={`url(#${uid}-fill)`} />}
            <path d={`M ${points.join(' L ')}`} fill="none" stroke={plain ? C.ink : C.teal500} strokeWidth={plain ? Math.min(1.5, s.stroke) : s.stroke} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        );
      })}

      {series.map((point, index) => {
        const centre = cxAt(index);
        if (point.kind === 'FELT') {
          const latest = index === lastFelt;
          return (
            <g key={point.date}>
              {latest && size === 'home' && !plain ? <circle cx={centre} cy={yAt(point.step as number)} r={s.radius + 5} fill={C.teal400} fillOpacity={0.24} /> : null}
              <circle
                cx={centre}
                cy={yAt(point.step as number)}
                r={latest && size === 'home' ? s.radius + 0.6 : s.radius}
                fill={plain ? C.ink : latest ? C.teal600 : C.paper}
                stroke={plain ? C.ink : C.teal600}
                strokeWidth={size === 'home' ? 2.2 : 1.3}
              />
            </g>
          );
        }
        if (point.kind === 'NO_FELT') {
          return (
            <circle
              key={point.date}
              cx={centre}
              cy={railMid}
              r={Math.max(2.2, s.radius - 0.4)}
              fill={plain ? 'none' : C.paper}
              stroke={plain ? C.ink : C.violet500}
              strokeWidth={size === 'home' ? 2 : 1.3}
            />
          );
        }
        if (point.kind === 'STOPPED') {
          const arm = Math.max(1.8, s.radius * 0.7);
          return (
            <g key={point.date} stroke={C.inkSoft} strokeWidth={size === 'home' ? 1.8 : 1.2} strokeLinecap="round">
              <line x1={centre - arm} y1={railMid - arm} x2={centre + arm} y2={railMid + arm} />
              <line x1={centre - arm} y1={railMid + arm} x2={centre + arm} y2={railMid - arm} />
            </g>
          );
        }
        return null;
      })}
    </svg>
  );
}
