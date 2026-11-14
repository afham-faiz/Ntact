import { cx } from './ui';

/**
 * Concentric ripples spreading from a single point: the product's one recurring
 * image (a vibration reaching the skin). Decorative, so hidden from assistive tech.
 */
export function Ripples({
  className,
  tone = 'light',
  rings = 5,
}: {
  className?: string;
  /** light: for dark surfaces (white rings). teal: for pale surfaces. */
  tone?: 'light' | 'teal';
  rings?: number;
}) {
  const stroke = tone === 'light' ? '#C4F1C9' : '#14A38C';
  return (
    <svg viewBox="0 0 200 200" className={cx('pointer-events-none', className)} fill="none" aria-hidden="true">
      {Array.from({ length: rings }, (_, index) => {
        const radius = 14 + index * (86 / rings);
        return (
          <circle
            key={radius}
            cx="100"
            cy="100"
            r={radius}
            stroke={stroke}
            strokeOpacity={(tone === 'light' ? 0.2 : 0.28) * (1 - index / (rings + 1))}
            strokeWidth={1.5}
          />
        );
      })}
      <circle cx="100" cy="100" r="7" fill={stroke} fillOpacity={tone === 'light' ? 0.5 : 0.55} />
    </svg>
  );
}
