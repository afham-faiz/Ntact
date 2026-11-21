/**
 * One quantity across a person's sessions of one assessment.
 *
 * What the marks mean, and the chart always carries the key:
 *   filled point, solid line    camera sessions
 *   hollow point, dashed line   illustrative example data
 *   hollow square               a synthetic replay
 *   amber ring                  a session with a capture-quality concern
 *   grey, off the line          a session that cannot fairly be compared with the
 *                               latest of its kind (a different view, hand, finger
 *                               or version); shown, never joined
 *
 * Camera sessions, illustrative data and synthetic replays are never joined to
 * one another: they are three different kinds of thing.
 *
 * The comparison is always with the person's own earlier sessions. There is no
 * normal range on this chart because there is none in this codebase.
 */
import { useMemo } from 'react';
import { comparability, qualityConcerns } from '../../assessment/session';
import type { AssessmentSession } from '../../assessment/types';
import { useElementWidth } from '../../app/hooks';
import { cx } from '../../components/ui';
import { dateKeyOf, formatDayShort } from '../../domain/dates';

export interface TrendPoint {
  session: AssessmentSession;
  value: number;
  comparable: boolean;
  concern: boolean;
}

export function trendPoints(sessions: readonly AssessmentSession[], pick: (session: AssessmentSession) => number | null): TrendPoint[] {
  const measured = sessions.filter((session) => pick(session) !== null);
  // Each kind of data is compared with the latest session of its own kind.
  const latest = new Map<string, AssessmentSession>();
  for (const session of measured) latest.set(session.source, session);
  return measured.map((session) => ({
    session,
    value: pick(session) as number,
    comparable: comparability(session, latest.get(session.source) as AssessmentSession).comparable,
    concern: qualityConcerns(session).length > 0,
  }));
}

export function TrendChart({
  sessions,
  pick,
  unit,
  tone = 'light',
  height = 150,
  selectedId,
  onSelect,
  label,
}: {
  sessions: readonly AssessmentSession[];
  pick(session: AssessmentSession): number | null;
  unit: 'deg' | 'palm';
  tone?: 'light' | 'dark';
  height?: number;
  selectedId?: string | null;
  onSelect?(session: AssessmentSession): void;
  /** What is plotted, for screen readers. */
  label: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>(320);
  const points = useMemo(() => trendPoints(sessions, pick), [sessions, pick]);
  const dark = tone === 'dark';
  const ink = dark ? '#ffffff' : '#14213D';
  const soft = dark ? '#B9C3DA' : '#55617A';
  const grid = dark ? 'rgba(255,255,255,0.12)' : '#E2E7F0';
  const line = dark ? '#ECB424' : '#2E4A7D';

  if (points.length === 0) {
    return <p className={cx('text-[13.5px] leading-5', dark ? 'text-mist' : 'text-ink-soft')}>No session with a figure for this yet.</p>;
  }

  const values = points.map((point) => point.value);
  const padding = unit === 'deg' ? 12 : 0.08;
  const low = Math.min(...values) - padding;
  const high = Math.max(...values) + padding;
  const left = 38;
  const right = 12;
  const top = 10;
  const bottom = 24;
  const x = (index: number) => (points.length === 1 ? (left + width - right) / 2 : left + (index / (points.length - 1)) * (width - left - right));
  const y = (value: number) => top + (1 - (value - low) / (high - low || 1)) * (height - top - bottom);
  const format = (value: number) => (unit === 'deg' ? `${Math.round(value)}°` : value.toFixed(2));
  const ticks = [low + (high - low) * 0.1, (low + high) / 2, high - (high - low) * 0.1];
  const pathFor = (source: AssessmentSession['source']): string | null => {
    const joined = points.map((point, index) => ({ point, index })).filter((item) => item.point.comparable && item.point.session.source === source);
    if (joined.length < 2) return null;
    return joined.map((item, order) => `${order === 0 ? 'M' : 'L'}${x(item.index).toFixed(1)} ${y(item.point.value).toFixed(1)}`).join(' ');
  };
  const cameraPath = pathFor('camera');
  const seedPath = pathFor('seed');
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block"
        role="img"
        aria-label={`${label}: ${points.length} ${points.length === 1 ? 'session' : 'sessions'}, from ${format(first.value)} on ${formatDayShort(dateKeyOf(first.session.timestamp))} to ${format(last.value)} on ${formatDayShort(dateKeyOf(last.session.timestamp))}.`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke={grid} strokeWidth="1" />
            <text x={left - 6} y={y(tick) + 4} textAnchor="end" fontSize="11" fill={soft} className="nums">
              {format(tick)}
            </text>
          </g>
        ))}
        {seedPath ? <path d={seedPath} fill="none" stroke={line} strokeOpacity="0.55" strokeWidth="1.6" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" /> : null}
        {cameraPath ? <path d={cameraPath} fill="none" stroke={line} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /> : null}
        {points.map((point, index) => {
          const real = !point.session.synthetic;
          const selected = selectedId === point.session.id;
          const colour = point.comparable ? line : dark ? 'rgba(255,255,255,0.4)' : '#97A1B5';
          return (
            <g
              key={point.session.id}
              onClick={onSelect ? () => onSelect(point.session) : undefined}
              style={onSelect ? { cursor: 'pointer' } : undefined}
            >
              {/* A generous target for a finger or a pointer. */}
              <circle cx={x(index)} cy={y(point.value)} r="13" fill="transparent" />
              {point.concern ? <circle cx={x(index)} cy={y(point.value)} r="7.5" fill="none" stroke="#D98A10" strokeWidth="1.6" /> : null}
              {selected ? <circle cx={x(index)} cy={y(point.value)} r="10" fill="none" stroke={ink} strokeWidth="1.4" /> : null}
              {point.session.source === 'synthetic-replay' ? (
                <rect x={x(index) - 3.6} y={y(point.value) - 3.6} width="7.2" height="7.2" rx="1" fill={dark ? '#14213D' : '#ffffff'} stroke={colour} strokeWidth="1.8" />
              ) : (
                <circle cx={x(index)} cy={y(point.value)} r={real ? 4.4 : 3.4} fill={real ? colour : dark ? '#14213D' : '#ffffff'} stroke={colour} strokeWidth="1.8" />
              )}
            </g>
          );
        })}
        <text x={x(0)} y={height - 6} textAnchor={points.length === 1 ? 'middle' : 'start'} fontSize="11" fill={soft}>
          {formatDayShort(dateKeyOf(first.session.timestamp))}
        </text>
        {points.length > 1 ? (
          <text x={x(points.length - 1)} y={height - 6} textAnchor="end" fontSize="11" fill={soft}>
            {formatDayShort(dateKeyOf(last.session.timestamp))}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

export function TrendKey({ tone = 'light', points }: { tone?: 'light' | 'dark'; points: readonly TrendPoint[] }) {
  const soft = tone === 'dark' ? 'text-mist' : 'text-ink-soft';
  const count = (source: AssessmentSession['source']) => points.filter((point) => point.session.source === source).length;
  const notComparable = points.filter((point) => !point.comparable).length;
  const concerns = points.filter((point) => point.concern).length;
  return (
    <p className={cx('text-[12.5px] leading-5', soft)}>
      Filled points on the solid line are camera sessions ({count('camera')}).
      {count('seed') > 0 ? ` Hollow points on the dashed line are illustrative example data (${count('seed')}), not measurements.` : ''}
      {count('synthetic-replay') > 0 ? ` Squares are synthetic replays (${count('synthetic-replay')}).` : ''}
      {concerns > 0 ? ` An amber ring marks a session with a capture-quality concern (${concerns}).` : ''}
      {notComparable > 0 ? ` Grey points (${notComparable}) are left off the line: they differ from the latest session of their kind in view, hand, finger or version.` : ''}
    </p>
  );
}
