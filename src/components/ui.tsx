import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link, type LinkProps } from 'react-router-dom';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------- Buttons ----------

type Variant = 'primary' | 'navy' | 'white' | 'soft' | 'outline' | 'ghost' | 'glass' | 'danger';
type Size = 'xl' | 'lg' | 'md' | 'sm' | 'xs';

interface ButtonStyle {
  variant?: Variant;
  size?: Size;
  block?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary: 'btn-primary text-white shadow-button',
  navy: 'btn-navy text-white',
  white: 'glass text-ink hover:bg-white',
  soft: 'bg-ink/[0.06] text-ink hover:bg-ink/10',
  outline: 'border border-ink/15 bg-white/70 text-ink shadow-soft backdrop-blur-md hover:border-ink/45 hover:bg-white',
  ghost: 'bg-transparent text-ink hover:bg-ink/[0.06]',
  glass: 'glass-dark text-white hover:bg-white/[0.14]',
  danger: 'bg-wine-600 text-white hover:bg-wine-800',
};

// Patient sizes (md and up) are pills and meet the 44 px touch minimum. sm and xs are for the desktop portal.
const SIZE: Record<Size, string> = {
  xl: 'min-h-16 rounded-[20px] px-7 text-[18px]',
  lg: 'min-h-14 rounded-[18px] px-6 text-[16.5px]',
  md: 'min-h-12 rounded-[15px] px-5 text-[15px]',
  sm: 'min-h-10 rounded-[10px] px-3.5 text-[14px]',
  xs: 'min-h-8 rounded-[8px] px-2.5 text-[13px]',
};

export function buttonClass({ variant = 'primary', size = 'md', block = false }: ButtonStyle = {}): string {
  return cx(
    'inline-flex select-none items-center justify-center gap-2 font-semibold leading-none',
    'transition-[background-color,border-color,color,transform,opacity,box-shadow] duration-150 ease-soft',
    'active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45',
    VARIANT[variant],
    SIZE[size],
    block && 'w-full',
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyle;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, className, type = 'button', ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={cx(buttonClass({ variant, size, block }), className)} {...rest} />;
});

type ButtonLinkProps = LinkProps & ButtonStyle;

export function ButtonLink({ variant, size, block, className, ...rest }: ButtonLinkProps) {
  return <Link className={cx(buttonClass({ variant, size, block }), className)} {...rest} />;
}

// ---------- Surfaces ----------

/** Frosted-glass card for the patient app: large radius, soft lift over the lit ground. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('glass rounded-[22px]', className)}>{children}</div>;
}

/** Frosted-glass panel for the clinician dashboard. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('glass rounded-[20px]', className)}>{children}</section>;
}

// ---------- Tones ----------

export type Tone = 'teal' | 'navy' | 'violet' | 'amber' | 'wine' | 'green' | 'sand' | 'sky' | 'neutral';

export const CHIP_TONE: Record<Tone, string> = {
  teal: 'bg-teal-50 text-teal-700',
  navy: 'bg-navy-50 text-navy-800',
  violet: 'bg-violet-50 text-violet-600',
  amber: 'bg-amber-50 text-amber-700',
  wine: 'bg-wine-50 text-wine-600',
  green: 'bg-green-50 text-green-700',
  sand: 'bg-sand-50 text-sand-600',
  sky: 'bg-sky-50 text-sky-600',
  neutral: 'bg-ink/[0.06] text-ink-soft',
};

export type IconType = LucideIcon;

/** An icon on a tinted tile. */
export function IconChip({
  icon: Icon,
  tone = 'teal',
  size = 'md',
  round = false,
  className,
}: {
  icon: IconType;
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  round?: boolean;
  className?: string;
}) {
  void Icon;
  void tone;
  void size;
  void round;
  void className;
  return null;
}

/** Small status label. Always carries words; the dot is extra. */
export function Pill({
  tone = 'neutral',
  dot = false,
  children,
  className,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold leading-5',
        tone === 'amber' ? 'text-amber-700' : tone === 'wine' ? 'text-wine-600' : 'text-ink-soft',
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

const AVATAR_TONES = [
  'bg-teal-100 text-teal-800',
  'bg-violet-100 text-violet-600',
  'bg-amber-100 text-amber-700',
  'bg-sky-50 text-sky-600',
  'bg-green-100 text-green-700',
  'bg-navy-100 text-navy-800',
];

/** Initials on a soft tint. No photographs: every person here is fictional. */
export function Avatar({ name, size = 'md', className }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  const box = size === 'sm' ? 'size-8 text-[12px]' : size === 'lg' ? 'size-14 text-[19px]' : 'size-10 text-[13.5px]';
  return (
    <span
      className={cx('grid shrink-0 place-items-center rounded-full font-semibold', box, AVATAR_TONES[hash % AVATAR_TONES.length], className)}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

// ---------- Small pieces ----------

/** Required prototype disclosure. Wording is fixed by the brief. */
export function ConceptNote({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  return (
    <p className={cx('text-[12px] leading-5', tone === 'dark' ? 'text-mist' : 'text-ink-soft', className)}>
      Concept prototype • Fictional data
    </p>
  );
}

export function MedicalNotice({ className }: { className?: string }) {
  return (
    <p className={cx('text-[12.5px] leading-5 text-ink-soft', className)}>
      Interactive concept. Demonstration data, not a medical device.
    </p>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('spin size-4', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** A small set of mutually exclusive views (date ranges, filters). Arrow keys move between them. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  block = false,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange(value: T): void;
  label: string;
  size?: 'md' | 'sm';
  block?: boolean;
  className?: string;
}) {
  const move = (direction: 1 | -1) => {
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + direction + options.length) % options.length];
    onChange(next.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(
        'rounded-[12px] bg-ink/[0.06] p-1',
        block ? 'flex w-full' : 'inline-flex',
        size === 'sm' && 'rounded-[11px] p-[3px]',
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cx(
              'font-semibold transition-[background-color,color,box-shadow] duration-150',
              block && 'flex-1',
              size === 'md' ? 'min-h-11 rounded-[9px] px-4 text-[14px]' : 'min-h-8 rounded-[8px] px-3 text-[13px]',
              selected ? 'bg-paper text-ink shadow-soft' : 'text-ink-soft hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Expandable explanation. Native <details>, so it works without script and with a keyboard. */
export function Explainer({
  summary,
  children,
  className,
  tone = 'light',
}: {
  summary: string;
  children: ReactNode;
  className?: string;
  tone?: 'light' | 'dark';
}) {
  return (
    <details className={cx('group', className)}>
      <summary
        className={cx(
          'flex min-h-11 cursor-pointer list-none items-center gap-2 text-[14px] font-semibold',
          tone === 'dark' ? 'text-white' : 'text-ink',
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3.5 shrink-0 text-teal-600 transition-transform duration-150 group-open:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
        {summary}
      </summary>
      <div className={cx('pb-2 pl-[22px] text-[14px] leading-6', tone === 'dark' ? 'text-mist' : 'text-ink-soft')}>
        {children}
      </div>
    </details>
  );
}

/** Marks a value that is invented for layout purposes, so it is never mistaken for a reading. */
export function SimulatedBadge({ children = 'Simulated placeholder', className }: { children?: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'hatch inline-flex items-center rounded-[6px] border border-dashed border-ink/30 px-1.5 py-px text-[11.5px] font-semibold leading-4 text-ink-soft',
        className,
      )}
    >
      {children}
    </span>
  );
}
