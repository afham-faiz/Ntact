import type { RehabLevel } from '../../domain/types';
import { C } from '../palette';
import { cx } from '../ui';

/**
 * The ten steps as an arc of segments with one lit. Shown only AFTER a test,
 * never while one is running.
 *
 * Only the detected segment is lit. The arc is deliberately not filled up to
 * that point, so it reads as "which step" and not as a score or a percentage.
 */
export function StepDial({
  level,
  tone = 'light',
  size = 'lg',
  className,
}: {
  level: RehabLevel;
  tone?: 'light' | 'dark';
  size?: 'lg' | 'sm';
  className?: string;
}) {
  const dark = tone === 'dark';
  const width = 260;
  const height = 150;
  const cxValue = width / 2;
  const cyValue = 132;
  const radius = 104;
  const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const span = 180 / 10;
  const gap = 5;

  const pointAt = (degrees: number, r: number) => {
    const radians = (degrees * Math.PI) / 180;
    return { x: cxValue + r * Math.cos(radians), y: cyValue + r * Math.sin(radians) };
  };

  const segment = (step: number) => {
    const from = 180 + (step - 1) * span + gap / 2;
    const to = 180 + step * span - gap / 2;
    const a = pointAt(from, radius);
    const b = pointAt(to, radius);
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  };

  const hit = pointAt(180 + (level - 0.5) * span, radius);
  const idle = dark ? '#FFFFFF' : C.ink;
  const lit = dark ? C.mint : C.teal500;

  return (
    <div className={cx(size === 'sm' ? 'w-[168px]' : 'w-full max-w-[280px]', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="block w-full" role="img" aria-label={`Level ${level} of 10`}>
        {steps.map((step) => (
          <path
            key={step}
            d={segment(step)}
            fill="none"
            stroke={step === level ? lit : idle}
            strokeOpacity={step === level ? 1 : dark ? 0.18 : 0.1}
            strokeWidth={step === level ? 16 : 11}
            strokeLinecap="round"
          />
        ))}
        <circle cx={hit.x} cy={hit.y} r={17} fill={lit} fillOpacity={0.22} />
        <text
          x={cxValue}
          y={cyValue - 22}
          textAnchor="middle"
          fontSize={62}
          fontWeight={700}
          letterSpacing="-0.04em"
          fill={dark ? '#FFFFFF' : C.ink}
        >
          {level}
        </text>
        <text x={cxValue} y={cyValue + 2} textAnchor="middle" fontSize={14.5} fontWeight={500} fill={dark ? C.mist : C.inkSoft}>
          of 10
        </text>
      </svg>
      {size === 'lg' ? (
        <div className={cx('mt-1 flex justify-between px-1 text-[12px] leading-4', dark ? 'text-mist' : 'text-ink-soft')}>
          <span>1, gentlest</span>
          <span>10, strongest</span>
        </div>
      ) : null}
    </div>
  );
}
