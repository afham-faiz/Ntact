import { cx } from './ui';

/**
 * The bridge mark: one arc carrying a signal from one point to another.
 * The same arc is the path between fingertip and wrist in the Touch Assist illustration.
 */
export function BridgeMark({
  className,
  tone = 'light',
}: {
  className?: string;
  tone?: 'light' | 'dark' | 'teal';
}) {
  const line = tone === 'dark' ? '#C4F1C9' : tone === 'teal' ? '#0B8272' : '#223641';
  const from = tone === 'dark' ? '#C4F1C9' : tone === 'teal' ? '#0B8272' : '#223641';
  const to = tone === 'dark' ? '#FFFFFF' : '#14A38C';
  return (
    <svg viewBox="0 0 30 20" className={cx('h-5 w-[30px]', className)} fill="none" aria-hidden="true">
      <path d="M5 15C5 2.5 25 2.5 25 15" stroke={line} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="5" cy="15" r="3.3" fill={from} />
      <circle cx="25" cy="15" r="3.3" fill={to} />
    </svg>
  );
}

/** Logo tile: the mark on the navy surface with a lit corner. */
export function LogoTile({ className }: { className?: string }) {
  return (
    <span className={cx('surface-deep grid size-10 shrink-0 place-items-center rounded-[12px] shadow-soft', className)}>
      <BridgeMark tone="dark" className="!h-[17px] !w-[26px]" />
    </span>
  );
}

export function Wordmark({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <BridgeMark tone={tone} />
      <span className={cx('text-[17px] font-bold tracking-[-0.02em]', tone === 'dark' ? 'text-white' : 'text-ink')}>
        Ntact
      </span>
    </span>
  );
}
