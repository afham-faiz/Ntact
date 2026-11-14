import { useMemo, type ReactNode } from 'react';
import { useDemoState, useToday } from '../../app/hooks';
import { useToast } from '../../components/Toast';
import { Button, Panel, cx } from '../../components/ui';
import { demoStore } from '../../demo/store';
import { ESTIMATE_LABEL } from '../../domain/recoveryEstimate';
import { DIRECTION_CAVEAT, RULE_LABEL, deriveFlags, ruleCondition } from '../../domain/triage';
import type { EstimateConfig, FingerSegment, TriageConfig, TriageRuleId } from '../../domain/types';

type RuleKey = keyof TriageConfig;

const RULES: { key: RuleKey; id: TriageRuleId; params: { field: string; label: string; min: number; max: number }[]; caveat?: string }[] = [
  {
    key: 'noImprovement',
    id: 'NO_IMPROVEMENT',
    caveat: DIRECTION_CAVEAT,
    params: [
      { field: 'windowDays', label: 'Window, days', min: 2, max: 84 },
      { field: 'minReadingsPerHalf', label: 'Felt results per half', min: 1, max: 30 },
      { field: 'minImprovementSteps', label: 'Improvement, levels', min: 1, max: 9 },
      { field: 'floorStep', label: 'Not applied at or below level', min: 0, max: 9 },
    ],
  },
  { key: 'missedTests', id: 'MISSED_TESTS', params: [{ field: 'consecutiveDays', label: 'Consecutive days', min: 1, max: 30 }] },
  {
    key: 'thresholdRise',
    id: 'THRESHOLD_RISE',
    caveat: 'Whether a rise in level is clinically concerning has not been agreed.',
    params: [
      { field: 'minTotalRise', label: 'Total rise, levels', min: 2, max: 9 },
      { field: 'withinDays', label: 'Latest reading within, days', min: 1, max: 14 },
    ],
  },
  { key: 'noFelt', id: 'NO_FELT_RECENT', params: [{ field: 'withinDays', label: 'Within, days', min: 1, max: 14 }] },
  { key: 'skinIssue', id: 'SKIN_ISSUE', params: [{ field: 'withinDays', label: 'Within, days', min: 1, max: 14 }] },
  {
    key: 'painIncrease',
    id: 'PAIN_INCREASE',
    params: [
      { field: 'points', label: 'Increase, points', min: 1, max: 10 },
      { field: 'baselineDays', label: 'Baseline, days', min: 2, max: 28 },
      { field: 'minBaselineEntries', label: 'Baseline check-ins', min: 1, max: 28 },
      { field: 'withinDays', label: 'Within, days', min: 1, max: 14 },
      { field: 'severeAt', label: 'Severe at, out of 10', min: 1, max: 10 },
    ],
  },
  {
    key: 'missedExercises',
    id: 'MISSED_EXERCISES',
    params: [{ field: 'consecutiveDays', label: 'Consecutive days', min: 1, max: 30 }],
  },
  {
    key: 'movementDecline',
    id: 'MOVEMENT_DECLINE',
    caveat: 'Range is estimated from a phone or laptop camera. It shows a trend; it is not goniometry.',
    params: [
      { field: 'minDropDeg', label: 'Drop, degrees', min: 5, max: 90 },
      { field: 'sessionsPerSide', label: 'Sessions compared', min: 1, max: 10 },
    ],
  },
];

const numberClass = 'nums h-10 w-20 rounded-[10px] border border-rule bg-paper px-2.5 text-[14px] font-semibold text-ink hover:border-ink/30';

function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange(value: number): void }) {
  return (
    <label className="block">
      <span className="block text-[12.5px] leading-5 text-ink-soft">{label}</span>
      <input
        type="number"
        className={numberClass}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
    </label>
  );
}

function Section({ title, note, action, children }: { title: string; note: ReactNode; action: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-9 first:mt-0">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 pb-4">
        <div>
          <h2 className="serif text-[24px] leading-8 text-ink">{title}</h2>
          <p className="mt-1 max-w-[80ch] text-[14px] leading-6 text-ink-soft">{note}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Every provisional threshold in one place, so it can be changed when clinical guidance arrives. */
export function RulesPage() {
  const state = useDemoState();
  const today = useToday();
  const toast = useToast();
  const config = state.triageConfig;
  const estimate = state.estimateConfig;

  const pendingByRule = useMemo(() => {
    const counts = new Map<TriageRuleId, number>();
    for (const flag of deriveFlags(state, today)) {
      if (flag.status === 'pending') counts.set(flag.ruleId, (counts.get(flag.ruleId) ?? 0) + 1);
    }
    return counts;
  }, [state, today]);

  const patchRule = (key: RuleKey, patch: Record<string, number | boolean | string>) =>
    demoStore.setTriageConfig({ ...config, [key]: { ...config[key], ...patch } } as TriageConfig);

  const patchEstimate = (next: EstimateConfig) => demoStore.setEstimateConfig(next);

  return (
    <div className="pb-6">
      <div className="pb-7 pt-9">
        <h1 className="serif text-[34px] leading-10 text-ink">Provisional rules</h1>
        <p className="mt-1 max-w-[86ch] text-[14.5px] leading-6 text-ink-soft">
          These come from preliminary team discussion. They are not clinical guidelines, they have not been validated and they
          are not diagnostic. Changes apply at once and are saved in this browser only.
        </p>
      </div>

      <Section
        title="Triage rules"
        note="Red means same-day review, amber means review soon. Each rule is routed to the team shown beside it. A record with no pending flag shows “No current review trigger”, which is not a statement about recovery."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              demoStore.resetTriageConfig();
              toast.show('Triage rules reset to defaults.');
            }}
          >
            Reset triage rules
          </Button>
        }
      >
        <Panel className="divide-y divide-rule/70">
          {RULES.map((rule) => {
            const values = config[rule.key] as unknown as Record<string, number | boolean | string>;
            const enabled = values.enabled as boolean;
            const level = values.level as 'RED' | 'AMBER';
            const count = pendingByRule.get(rule.id) ?? 0;
            return (
              <div key={rule.key} className={cx('grid gap-x-10 gap-y-4 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_auto]', !enabled && 'opacity-60')}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[16px] font-bold leading-6 text-ink">
                    <span className={cx('size-2.5 shrink-0 rounded-[2px]', level === 'RED' ? 'bg-wine-600' : 'bg-amber-500')} aria-hidden="true" />
                    {RULE_LABEL[rule.id]}
                    <span className="nums text-[13px] font-medium text-ink-soft">
                      {enabled ? `${count} pending now` : 'switched off'}
                    </span>
                  </p>
                  <p className="mt-1.5 max-w-[78ch] text-[14px] leading-[22px] text-ink">{ruleCondition(rule.id, config)}</p>
                  {rule.caveat ? <p className="mt-1.5 max-w-[78ch] text-[13px] leading-5 text-wine-600">{rule.caveat}</p> : null}
                </div>
                <div className="flex flex-wrap items-end gap-3 lg:max-w-[440px] lg:justify-end">
                  {rule.params.map((param) => (
                    <NumberField
                      key={param.field}
                      label={param.label}
                      value={values[param.field] as number}
                      min={param.min}
                      max={param.max}
                      onChange={(value) => patchRule(rule.key, { [param.field]: value })}
                    />
                  ))}
                  <label className="block">
                    <span className="block text-[12.5px] leading-5 text-ink-soft">Level</span>
                    <select
                      value={level}
                      onChange={(event) => patchRule(rule.key, { level: event.target.value })}
                      className="h-10 rounded-[10px] border border-rule bg-paper px-2.5 text-[14px] font-semibold text-ink"
                    >
                      <option value="RED">Same-day review</option>
                      <option value="AMBER">Review soon</option>
                    </select>
                  </label>
                  <label className="flex h-10 cursor-pointer items-center gap-2 text-[14px] font-semibold text-ink">
                    <input type="checkbox" checked={enabled} onChange={(event) => patchRule(rule.key, { enabled: event.target.checked })} className="size-4 accent-[#14213D]" />
                    On
                  </label>
                </div>
              </div>
            );
          })}
        </Panel>
      </Section>

      <Section
        title="Return-window assumptions"
        note={`${ESTIMATE_LABEL}. Clinician-facing only. The window is for when sensation might begin to return; it is never used to predict the detection level or to raise a flag.`}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              demoStore.resetEstimateConfig();
              toast.show('Assumptions reset to defaults.');
            }}
          >
            Reset assumptions
          </Button>
        }
      >
        <Panel className="divide-y divide-rule/70">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4 px-6 py-5">
            <p className="w-full max-w-[300px] text-[14px] leading-[22px] text-ink">
              <span className="block font-bold">Initial delay</span>
              Days after repair before regeneration is assumed to begin.
            </p>
            <NumberField label="Shortest, days" value={estimate.delayDays.min} min={0} max={120} onChange={(value) => patchEstimate({ ...estimate, delayDays: { ...estimate.delayDays, min: Math.min(value, estimate.delayDays.max) } })} />
            <NumberField label="Longest, days" value={estimate.delayDays.max} min={0} max={180} onChange={(value) => patchEstimate({ ...estimate, delayDays: { ...estimate.delayDays, max: Math.max(value, estimate.delayDays.min) } })} />
          </div>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4 px-6 py-5">
            <p className="w-full max-w-[300px] text-[14px] leading-[22px] text-ink">
              <span className="block font-bold">Regeneration rate</span>
              Around the commonly quoted 1 mm a day, with wide variation.
            </p>
            <NumberField label="Slow, mm/day" value={estimate.rateMmPerDay.slow} min={0.1} max={5} step={0.1} onChange={(value) => patchEstimate({ ...estimate, rateMmPerDay: { ...estimate.rateMmPerDay, slow: Math.min(value, estimate.rateMmPerDay.fast) } })} />
            <NumberField label="Fast, mm/day" value={estimate.rateMmPerDay.fast} min={0.1} max={5} step={0.1} onChange={(value) => patchEstimate({ ...estimate, rateMmPerDay: { ...estimate.rateMmPerDay, fast: Math.max(value, estimate.rateMmPerDay.slow) } })} />
          </div>
          {(['distal', 'middle', 'proximal'] as FingerSegment[]).map((segment) => (
            <div key={segment} className="flex flex-wrap items-end gap-x-10 gap-y-4 px-6 py-5">
              <p className="w-full max-w-[300px] text-[14px] leading-[22px] text-ink">
                <span className="block font-bold capitalize">{segment} segment</span>
                Placeholder distance from repair to fingertip, used when no measurement is entered.
              </p>
              <NumberField
                label="Shortest, mm"
                value={estimate.segmentDistanceMm[segment].min}
                min={1}
                max={200}
                onChange={(value) =>
                  patchEstimate({
                    ...estimate,
                    segmentDistanceMm: { ...estimate.segmentDistanceMm, [segment]: { ...estimate.segmentDistanceMm[segment], min: Math.min(value, estimate.segmentDistanceMm[segment].max) } },
                  })
                }
              />
              <NumberField
                label="Longest, mm"
                value={estimate.segmentDistanceMm[segment].max}
                min={1}
                max={200}
                onChange={(value) =>
                  patchEstimate({
                    ...estimate,
                    segmentDistanceMm: { ...estimate.segmentDistanceMm, [segment]: { ...estimate.segmentDistanceMm[segment], max: Math.max(value, estimate.segmentDistanceMm[segment].min) } },
                  })
                }
              />
            </div>
          ))}
        </Panel>
      </Section>
    </div>
  );
}
