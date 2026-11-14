import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDemoState, useToday } from '../../app/hooks';
import { useToast } from '../../components/Toast';
import { Button, Panel, Segmented, cx } from '../../components/ui';
import { demoStore } from '../../demo/store';
import { dateKeyOf, formatDay } from '../../domain/dates';
import { LEVEL_LABEL, RULE_LABEL, compareLevels, deriveFlags } from '../../domain/triage';
import type { TriageFlag, TriageRuleId } from '../../domain/types';
import { RecordReviewModal } from './modals';

type Status = 'pending' | 'reviewed' | 'all';

const STATUS: { value: Status; label: string }[] = [
  { value: 'pending', label: 'Waiting' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'all', label: 'All' },
];

/** Every flag across the cohort: what was raised, why, and whether someone has looked. */
export function ReviewsPage() {
  const state = useDemoState();
  const today = useToday();
  const toast = useToast();
  const [status, setStatus] = useState<Status>('pending');
  const [rule, setRule] = useState<TriageRuleId | 'all'>('all');
  const [reviewing, setReviewing] = useState<TriageFlag | null>(null);

  const flags = useMemo(() => deriveFlags(state, today), [state, today]);
  const patientById = useMemo(() => new Map(state.patients.map((patient) => [patient.id, patient])), [state.patients]);

  const visible = flags
    .filter((flag) => (status === 'all' ? true : flag.status === status))
    .filter((flag) => (rule === 'all' ? true : flag.ruleId === rule))
    .sort((a, b) => compareLevels(a.level, b.level) || b.raisedOn.localeCompare(a.raisedOn));

  const pendingCount = flags.filter((flag) => flag.status === 'pending').length;
  const reviewingPatient = reviewing ? patientById.get(reviewing.patientId) : undefined;

  return (
    <div className="pb-6">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-7 pt-9">
        <div>
          <h1 className="serif text-[34px] leading-10 text-ink">Review flags</h1>
          <p className="nums mt-1 text-[14.5px] leading-6 text-ink-soft">
            {pendingCount} waiting for review. Raised by provisional rules or by hand; none is a clinical finding.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<Status> options={STATUS} value={status} onChange={(value) => setStatus(value)} label="Flag status" size="sm" />
          <label className="flex items-center gap-2 text-[13.5px] text-ink-soft">
            Rule
            <select
              value={rule}
              onChange={(event) => setRule(event.target.value as TriageRuleId | 'all')}
              className="h-10 rounded-[10px] border border-rule bg-paper px-3 text-[14px] font-semibold text-ink"
            >
              <option value="all">All rules</option>
              {(Object.keys(RULE_LABEL) as TriageRuleId[]).map((id) => (
                <option key={id} value={id}>
                  {RULE_LABEL[id]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <Panel className="overflow-hidden">
        {visible.length === 0 ? (
          <p className="px-6 py-14 text-center text-[15px] text-ink-soft">
            {status === 'pending' ? 'Nothing is waiting for review with this filter.' : 'No flags match this filter.'}
          </p>
        ) : (
          <ul className="divide-y divide-rule/70">
            {visible.map((flag) => {
              const patient = patientById.get(flag.patientId);
              if (!patient) return null;
              return (
                <li key={flag.id} className="grid gap-x-8 gap-y-2 px-6 py-5 lg:grid-cols-[230px_minmax(0,1fr)_auto]">
                  <div>
                    <p className={cx('flex items-center gap-2.5 text-[14px] font-bold leading-5', flag.level === 'RED' ? 'text-wine-600' : 'text-amber-700')}>
                      <span className={cx('size-2.5 shrink-0 rounded-[2px]', flag.level === 'RED' ? 'bg-wine-600' : 'bg-amber-500')} aria-hidden="true" />
                      {LEVEL_LABEL[flag.level]}
                    </p>
                    <Link to={`/clinician/patients/${patient.id}`} className="mt-1 block text-[16px] font-bold leading-6 text-ink underline-offset-4 hover:underline">
                      {patient.name}
                    </Link>
                    <p className="nums text-[13px] leading-5 text-ink-soft">Raised {formatDay(flag.raisedOn)}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold leading-6 text-ink">{RULE_LABEL[flag.ruleId]}</p>
                    <p className="mt-0.5 text-[14px] leading-[22px] text-ink">{flag.evidence}</p>
                    <p className="mt-1 text-[13px] leading-5 text-ink-soft">Provisional condition: {flag.condition}</p>
                    {flag.status === 'reviewed' ? (
                      <p className="mt-1.5 text-[13px] leading-5 text-ink-soft">
                        Reviewed {flag.reviewedAt ? formatDay(dateKeyOf(flag.reviewedAt)) : ''}.{flag.note ? ` ${flag.note}` : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-start gap-2">
                    {flag.status === 'pending' ? (
                      <Button variant="primary" size="sm" onClick={() => setReviewing(flag)}>
                        Record review
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          demoStore.reopenFlag(flag.id);
                          toast.show('Flag reopened. Saved locally.');
                        }}
                      >
                        Reopen
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {reviewing && reviewingPatient ? (
        <RecordReviewModal open onClose={() => setReviewing(null)} patient={reviewingPatient} flags={[reviewing]} />
      ) : null}
    </div>
  );
}
