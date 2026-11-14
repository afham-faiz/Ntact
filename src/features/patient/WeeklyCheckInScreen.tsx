import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActivePatient, useDemoState, useToday } from '../../app/hooks';
import { useToast } from '../../components/Toast';
import { Button, Card, cx } from '../../components/ui';
import { demoStore } from '../../demo/store';
import { SEVERITY_OPTIONS, WEEKLY_QUESTIONS, latestWeekly, weeklyForPatient } from '../../domain/checkIn';
import { relativeDay } from '../../domain/dates';
import type { Severity } from '../../domain/types';
import { Screen, TopBar } from './PatientShell';

function SeverityChoice({ label, value, onChange }: { label: string; value: Severity | null; onChange(value: Severity): void }) {
  return (
    <div role="radiogroup" aria-label={label} className="mt-3 grid grid-cols-4 gap-2">
      {SEVERITY_OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cx(
              'min-h-12 rounded-[12px] border text-[14.5px] font-semibold transition-colors duration-150',
              selected ? 'border-ink bg-ink text-white' : 'border-rule bg-paper text-ink hover:border-ink/40',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Three questions, once a week. One screen, no steps: it should take under a minute. */
export function WeeklyCheckInScreen() {
  const patient = useActivePatient();
  const state = useDemoState();
  const today = useToday();
  const navigate = useNavigate();
  const toast = useToast();
  const entries = weeklyForPatient(state.weeklyCheckIns ?? [], patient.id);
  const latest = latestWeekly(entries);
  const editing = latest?.date === today ? latest : null;

  const [cold, setCold] = useState<Severity | null>(editing?.cold ?? null);
  const [tingling, setTingling] = useState<Severity | null>(editing?.tingling ?? null);
  const [limited, setLimited] = useState<number | null>(editing?.function ?? null);
  const complete = cold !== null && tingling !== null && limited !== null;

  const save = () => {
    if (cold === null || tingling === null || limited === null) return;
    demoStore.saveWeeklyCheckIn(patient.id, today, { cold, tingling, function: limited });
    toast.show('Weekly answers saved.');
    navigate('/patient');
  };

  return (
    <Screen
      header={<TopBar title="Weekly questions" />}
      footer={
        <Button variant="primary" size="lg" block onClick={save} disabled={!complete}>
          {editing ? 'Save changes' : 'Save'}
        </Button>
      }
    >
      <p className="-mt-1 text-[15.5px] leading-6 text-ink-soft">
        Three questions about the past week.
        {latest && !editing ? ` You last answered ${relativeDay(latest.date, today).toLowerCase()}.` : ''}
      </p>

      <Card className="mt-4 p-5">
        <h2 className="text-[17px] font-bold leading-6 tracking-[-0.015em] text-ink">{WEEKLY_QUESTIONS.cold}</h2>
        <SeverityChoice label={WEEKLY_QUESTIONS.cold} value={cold} onChange={setCold} />
      </Card>

      <Card className="mt-3 p-5">
        <h2 className="text-[17px] font-bold leading-6 tracking-[-0.015em] text-ink">{WEEKLY_QUESTIONS.tingling}</h2>
        <SeverityChoice label={WEEKLY_QUESTIONS.tingling} value={tingling} onChange={setTingling} />
      </Card>

      <Card className="mt-3 p-5">
        <h2 className="text-[17px] font-bold leading-6 tracking-[-0.015em] text-ink">{WEEKLY_QUESTIONS.function}</h2>
        <div role="radiogroup" aria-label={WEEKLY_QUESTIONS.function} className="mt-3 grid grid-cols-11 gap-1">
          {Array.from({ length: 11 }, (_, value) => {
            const selected = limited === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${value} out of 10`}
                onClick={() => setLimited(value)}
                className={cx(
                  'nums min-h-11 rounded-[9px] border text-[14px] font-semibold transition-colors duration-150',
                  selected ? 'border-ink bg-ink text-white' : 'border-rule bg-paper text-ink hover:border-ink/40',
                )}
              >
                {value}
              </button>
            );
          })}
        </div>
        <p className="mt-2 flex justify-between text-[12.5px] leading-5 text-ink-soft">
          <span>{WEEKLY_QUESTIONS.functionLow}</span>
          <span>{WEEKLY_QUESTIONS.functionHigh}</span>
        </p>
      </Card>

      <p className="mt-4 text-[13.5px] leading-5 text-ink-soft">
        Your care team can see these alongside your tests. If something is worrying you today, contact them directly: this
        prototype does not send alerts.
      </p>
    </Screen>
  );
}
