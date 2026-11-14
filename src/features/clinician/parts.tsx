import type { ReactNode } from 'react';
import { Eye, Flag } from 'lucide-react';
import { C } from '../../components/palette';
import { cx } from '../../components/ui';
import { LEVEL_LABEL, RULE_LABEL } from '../../domain/triage';
import type { Finger, Hand, Patient, SensationTest, TriageFlag, TriageLevel, TriageRuleId } from '../../domain/types';

/** Outcome as a shape plus words. The shapes match the chart legend. */
export function OutcomeMark({ outcome, className }: { outcome: SensationTest['outcome'] | 'NONE'; className?: string }) {
  return (
    <svg viewBox="0 0 14 14" className={cx('size-3.5 shrink-0', className)} aria-hidden="true">
      {outcome === 'FELT' ? <circle cx="7" cy="7" r="4.4" fill={C.paper} stroke={C.teal600} strokeWidth="2.2" /> : null}
      {outcome === 'NO_FELT' ? <circle cx="7" cy="7" r="4.4" fill={C.paper} stroke={C.violet500} strokeWidth="2" /> : null}
      {outcome === 'STOPPED' ? <path d="M3.5 3.5l7 7M3.5 10.5l7-7" stroke={C.inkSoft} strokeWidth="1.8" strokeLinecap="round" /> : null}
      {outcome === 'NONE' ? (
        <circle cx="7" cy="7" r="4" fill="none" stroke={C.inkFaint} strokeWidth="1.3" strokeDasharray="1.6 2.2" />
      ) : null}
    </svg>
  );
}

export function outcomeText(test: SensationTest): string {
  if (test.outcome === 'FELT') return `Felt at level ${test.detectedLevel}`;
  if (test.outcome === 'NO_FELT') return 'Not felt';
  return 'Cancelled';
}

/** How a result came about, in the clinician's terms. */
export function outcomeKind(test: SensationTest): string {
  if (test.outcome === 'FELT') return 'Completed test';
  if (test.outcome === 'NO_FELT') return 'Completed, not felt';
  return test.stopReason === 'EARLY_RESPONSE' ? 'Cancelled (tap before first level)' : 'Cancelled';
}

/**
 * Where a result came from. Only an outcome the physical wearable reported over
 * Bluetooth is called "Wearable"; seeded, simulated and manually logged records are not.
 */
export function testSourceLabel(test: SensationTest): string {
  return test.source === 'ble' && test.simulated === false ? 'Wearable' : 'Demonstration';
}

const FINGER_LABEL: Record<Finger, string> = {
  thumb: 'thumb',
  index: 'index finger',
  middle: 'middle finger',
  ring: 'ring finger',
  little: 'little finger',
};

const HAND_LABEL: Record<Hand, string> = { left: 'Left', right: 'Right' };

export function fingerName(finger: Finger): string {
  return FINGER_LABEL[finger];
}

export function injurySite(patient: Pick<Patient, 'hand' | 'finger'>): string {
  return `${HAND_LABEL[patient.hand]} ${FINGER_LABEL[patient.finger]}`;
}

export const LEVEL_STYLE: Record<TriageLevel, { chip: string; bar: string; text: string; soft: string; hex: string }> = {
  RED: { chip: 'bg-wine-50 text-wine-600 ring-1 ring-inset ring-wine-100', bar: 'bg-wine-600', text: 'text-wine-600', soft: 'bg-wine-50', hex: C.wine600 },
  AMBER: { chip: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100', bar: 'bg-amber-400', text: 'text-amber-700', soft: 'bg-amber-50', hex: C.amber500 },
  GREEN: { chip: 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-100', bar: 'bg-green-500', text: 'text-green-700', soft: 'bg-green-50', hex: C.green500 },
};

/** Review status. Icon and wording differ per level, so it never relies on colour alone. */
export function TriageChip({ level, compact = false, className }: { level: TriageLevel; compact?: boolean; className?: string }) {
  const label = level === 'GREEN' && compact ? 'No current trigger' : LEVEL_LABEL[level];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12.5px] font-bold leading-4',
        LEVEL_STYLE[level].chip,
        className,
      )}
    >
      {level === 'RED' ? <Flag className="size-3.5" strokeWidth={2.4} fill="currentColor" aria-hidden="true" /> : null}
      {level === 'AMBER' ? <Eye className="size-3.5" strokeWidth={2.4} aria-hidden="true" /> : null}
      {level === 'GREEN' ? <span className="size-2 rounded-full border-2 border-current" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

export const RULE_SHORT: Record<TriageRuleId, string> = {
  NO_IMPROVEMENT: 'No improvement, 4 weeks',
  MISSED_TESTS: 'Missed tests',
  THRESHOLD_RISE: 'Two rising readings',
  NO_FELT_RECENT: 'Recent test not felt',
  SKIN_ISSUE: 'New skin issue',
  PAIN_INCREASE: 'Severe or rising pain',
  MISSED_EXERCISES: 'Missed exercises',
  MOVEMENT_DECLINE: 'Movement falling',
  CLINICIAN_FLAG: 'Marked by hand',
};

/** One reason a patient is flagged. */
export function RuleChip({ flag, long = false, className }: { flag: Pick<TriageFlag, 'ruleId' | 'level'>; long?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-[7px] border border-line bg-paper px-2 py-[3px] text-[12.5px] font-medium leading-4 text-ink',
        className,
      )}
    >
      <span className={cx('size-1.5 shrink-0 rounded-full', LEVEL_STYLE[flag.level].bar)} aria-hidden="true" />
      {long ? RULE_LABEL[flag.ruleId] : RULE_SHORT[flag.ruleId]}
    </span>
  );
}

/** Sticky page header: title on the left, actions on the right. */
export function ClinicTopBar({
  title,
  subtitle,
  actions,
  leading,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line bg-paper/90 px-5 py-3.5 backdrop-blur-md lg:px-7">
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-bold leading-7 tracking-[-0.025em] text-ink">{title}</h1>
          {subtitle ? <p className="truncate text-[13px] leading-5 text-ink-soft">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Marks anything that rests on provisional, unvalidated rules. */
export function ProvisionalTag({ children = 'Provisional', className }: { children?: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-[6px] border border-dashed border-ink/30 px-1.5 py-px text-[11.5px] font-semibold leading-4 text-ink-soft',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PanelHeader({
  title,
  note,
  action,
  className,
}: {
  title: ReactNode;
  note?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[15.5px] font-bold leading-6 tracking-[-0.01em] text-ink">{title}</h2>
        {note ? <p className="text-[12.5px] leading-5 text-ink-soft">{note}</p> : null}
      </div>
      {action}
    </div>
  );
}
