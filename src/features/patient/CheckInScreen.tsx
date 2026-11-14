import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, Minus, Plus } from 'lucide-react';
import { useActivePatient, useDemoState, useToday } from '../../app/hooks';
import { useToast } from '../../components/Toast';
import { Button, ButtonLink, Card, IconChip, cx } from '../../components/ui';
import { demoStore } from '../../demo/store';
import {
  DAILY_CHECK_IN,
  describeCold,
  describeSkin,
  firstUnanswered,
  isComplete,
  noteOf,
  painOf,
  skinNoteOf,
  type CheckInQuestion,
} from '../../domain/checkIn';
import { formatDayLong } from '../../domain/dates';
import { checkInOn, checkInsForPatient } from '../../domain/selectors';
import type { CheckIn, CheckInAnswer } from '../../domain/types';
import { Screen, TopBar } from './PatientShell';

type Answers = Record<string, CheckInAnswer>;

const schema = DAILY_CHECK_IN;

// ---------- One input per kind of question ----------

function ScaleInput({
  question,
  value,
  onChange,
}: {
  question: Extract<CheckInQuestion, { kind: 'scale' }>;
  value: number | null;
  onChange(value: number): void;
}) {
  const unset = value === null;
  const shown = value ?? Math.round((question.min + question.max) / 2);
  const fill = ((shown - question.min) / (question.max - question.min)) * 100;
  const step = (delta: number) => onChange(Math.min(question.max, Math.max(question.min, (value ?? shown) + delta)));

  return (
    <div>
      <div className="flex items-center justify-center gap-5">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="One lower"
          className="grid size-12 place-items-center rounded-full bg-floor text-ink hover:bg-ink/10"
        >
          <Minus className="size-5" strokeWidth={2.4} aria-hidden="true" />
        </button>
        <div
          className={cx(
            'grid size-[104px] place-items-center rounded-full transition-colors duration-150',
            unset ? 'border-2 border-dashed border-ink-faint text-ink-faint' : 'bg-ink text-white',
          )}
          aria-hidden="true"
        >
          <span className="display nums text-[48px] leading-none">{unset ? '–' : value}</span>
        </div>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="One higher"
          className="grid size-12 place-items-center rounded-full bg-floor text-ink hover:bg-ink/10"
        >
          <Plus className="size-5" strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>

      <input
        type="range"
        className="sb-range mt-5"
        min={question.min}
        max={question.max}
        step={1}
        value={shown}
        data-unset={unset}
        style={{ ['--fill' as string]: `${unset ? 0 : fill}%` }}
        aria-label={question.prompt}
        aria-valuetext={unset ? 'Not answered yet' : `${value} out of ${question.max}`}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerDown={() => {
          if (unset) onChange(shown);
        }}
      />
      <div className="flex justify-between text-[13px] font-medium leading-5 text-ink-soft">
        <span>
          {question.min}, {question.minLabel.toLowerCase()}
        </span>
        <span>
          {question.max}, {question.maxLabel.toLowerCase()}
        </span>
      </div>
      {unset ? <p className="mt-3 text-center text-[13.5px] leading-5 text-ink-soft">Slide, or tap plus and minus.</p> : null}
    </div>
  );
}

function BigChoice({
  selected,
  onSelect,
  label,
  hint,
}: {
  selected: boolean;
  onSelect(): void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        'flex min-h-[60px] w-full items-center justify-between gap-3 rounded-[12px] border-2 px-4 text-left transition-[border-color,background-color] duration-150',
        selected ? 'border-ink bg-floor' : 'border-line bg-paper hover:border-ink/25',
      )}
    >
      <span>
        <span className="block text-[16.5px] font-bold leading-6 text-ink">{label}</span>
        {hint ? <span className="block text-[13px] leading-5 text-ink-soft">{hint}</span> : null}
      </span>
      <span
        className={cx(
          'grid size-6 shrink-0 place-items-center rounded-full border-2',
          selected ? 'border-ink bg-ink text-white' : 'border-ink-faint',
        )}
        aria-hidden="true"
      >
        {selected ? <Check className="size-3.5" strokeWidth={3.2} /> : null}
      </span>
    </button>
  );
}

// ---------- Saved view ----------

function Saved({ checkIn, onEdit, justSaved }: { checkIn: CheckIn; onEdit(): void; justSaved: boolean }) {
  const pain = painOf(checkIn);
  const rows = [
    { label: 'Pain', value: pain === null ? 'Not answered' : `${pain} of 10` },
    { label: 'Skin', value: describeSkin(checkIn) },
    { label: 'Cold sensitivity', value: describeCold(checkIn) },
  ];
  const skinNote = skinNoteOf(checkIn);
  const note = noteOf(checkIn);
  return (
    <Screen
      header={<TopBar title="Daily check-in" back="/patient" />}
      footer={
        <div className="flex gap-2.5">
          <ButtonLink to="/patient" variant="primary" size="lg" className="flex-1">
            Back to Today
          </ButtonLink>
          <Button variant="outline" size="lg" className="flex-1" onClick={onEdit}>
            Edit
          </Button>
        </div>
      }
    >
      <div className="mt-2 flex flex-col items-center text-center">
        <IconChip icon={Check} tone="violet" size="lg" round />
        <h2 className="display mt-4 text-[26px] leading-[1.18] text-ink" role="status">
          {justSaved ? 'Check-in saved.' : 'Today’s check-in is done.'}
        </h2>
        <p className="mt-1.5 text-[15.5px] leading-6 text-ink-soft">Thanks for keeping a record.</p>
      </div>

      <Card className="mt-6 divide-y divide-line-soft px-5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 py-3.5">
            <span className="text-[14.5px] leading-5 text-ink-soft">{row.label}</span>
            <span className="text-right text-[15.5px] font-bold leading-5 text-ink">{row.value}</span>
          </div>
        ))}
        {skinNote ? (
          <div className="py-3.5">
            <span className="block text-[13px] leading-5 text-ink-soft">What you noticed</span>
            <span className="block text-[15px] leading-6 text-ink">{skinNote}</span>
          </div>
        ) : null}
        {note ? (
          <div className="py-3.5">
            <span className="block text-[13px] leading-5 text-ink-soft">Your note</span>
            <span className="block text-[15px] leading-6 text-ink">{note}</span>
          </div>
        ) : null}
      </Card>

      <p className="mt-4 text-center text-[13.5px] leading-5 text-ink-soft">
        {formatDayLong(checkIn.date)}. You can change today’s answers until midnight.
      </p>
    </Screen>
  );
}

// ---------- The check-in ----------

export function CheckInScreen() {
  const state = useDemoState();
  const patient = useActivePatient();
  const today = useToday();
  const toast = useToast();

  const existing = useMemo(
    () => checkInOn(checkInsForPatient(state.checkIns, patient.id), today),
    [state.checkIns, patient.id, today],
  );

  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );

  // A different person (demo persona switch) starts a fresh form.
  useEffect(() => {
    setEditing(false);
    setJustSaved(false);
    setAnswers({});
    setStep(0);
  }, [patient.id]);

  if (existing && !editing) {
    return (
      <Saved
        checkIn={existing}
        justSaved={justSaved}
        onEdit={() => {
          setAnswers({ ...existing.answers });
          setStep(0);
          setEditing(true);
        }}
      />
    );
  }

  const questions = schema.questions;
  const question = questions[step];
  const last = step === questions.length - 1;
  const answer = answers[question.id];
  const answered = question.kind === 'text' ? true : answer !== undefined && answer !== null;
  const complete = isComplete(schema, answers);

  const set = (id: string, value: CheckInAnswer) => setAnswers((current) => ({ ...current, [id]: value }));

  const next = () => setStep((current) => Math.min(questions.length - 1, current + 1));

  /** A single tap answers and moves on. The pause lets the choice register visually first. */
  const answerAndAdvance = (id: string, value: CheckInAnswer) => {
    set(id, value);
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(next, 220);
  };

  const save = () => {
    if (!complete) {
      setStep(firstUnanswered(schema, answers));
      return;
    }
    demoStore.saveCheckIn(patient.id, today, answers);
    if (existing) toast.show('Changes saved');
    setJustSaved(!existing);
    setEditing(false);
  };

  return (
    <Screen
      header={<TopBar title="Daily check-in" back="/patient" />}
      footer={
        <div className="flex items-center gap-2.5">
          {step > 0 ? (
            <Button variant="outline" size="lg" onClick={() => setStep(step - 1)} aria-label="Previous question" className="!px-4">
              <ChevronLeft className="size-5" strokeWidth={2.2} aria-hidden="true" />
            </Button>
          ) : null}
          {last ? (
            <Button variant="primary" size="lg" className="flex-1" onClick={save}>
              {existing ? 'Save changes' : 'Save check-in'}
            </Button>
          ) : (
            <Button variant="primary" size="lg" className="flex-1" onClick={next} disabled={!answered}>
              Next
            </Button>
          )}
        </div>
      }
    >
      {/* Progress: one segment per question */}
      <div className="mt-1 flex items-center gap-3">
        <ol className="flex flex-1 gap-1.5" aria-label={`Question ${step + 1} of ${questions.length}`}>
          {questions.map((item, index) => (
            <li
              key={item.id}
              className={cx('h-1.5 flex-1 rounded-full transition-colors duration-200', index <= step ? 'bg-ink' : 'bg-ink/10')}
            />
          ))}
        </ol>
        <span className="nums text-[13px] font-semibold leading-5 text-ink-soft" aria-hidden="true">
          {step + 1} of {questions.length}
        </span>
      </div>

      <Card key={question.id} className="screen-in mt-5 px-5 pb-6 pt-6">
        <h2 className="display text-[23px] leading-[1.2] text-ink">{question.prompt}</h2>

        {question.kind === 'scale' ? (
          <div className="mt-6">
            <ScaleInput question={question} value={typeof answer === 'number' ? answer : null} onChange={(value) => set(question.id, value)} />
          </div>
        ) : null}

        {question.kind === 'yesno' ? (
          <>
            {question.hint ? <p className="mt-1.5 text-[14.5px] leading-6 text-ink-soft">{question.hint}</p> : null}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <BigChoice selected={answer === false} onSelect={() => answerAndAdvance(question.id, false)} label="No" />
              <BigChoice selected={answer === true} onSelect={() => set(question.id, true)} label="Yes" />
            </div>
            {answer === true && question.followUp ? (
              <div className="screen-in mt-4">
                <label htmlFor="check-in-follow-up" className="block text-[14.5px] font-semibold leading-6 text-ink">
                  {question.followUp.prompt}
                </label>
                <textarea
                  id="check-in-follow-up"
                  rows={2}
                  maxLength={240}
                  value={typeof answers[question.followUp.id] === 'string' ? (answers[question.followUp.id] as string) : ''}
                  onChange={(event) => set(question.followUp!.id, event.target.value)}
                  placeholder={question.followUp.placeholder}
                  className="mt-1.5 block w-full resize-none rounded-[14px] border border-line bg-canvas px-3.5 py-3 text-[15.5px] leading-6 text-ink placeholder:text-ink-faint"
                />
                {question.yesNote ? (
                  <p className="mt-3 rounded-[14px] bg-amber-50 px-3.5 py-2.5 text-[13.5px] leading-5 text-amber-700">{question.yesNote}</p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {question.kind === 'choice' ? (
          <div className="mt-5 space-y-2.5">
            {question.options.map((option) => (
              <BigChoice
                key={option.value}
                selected={answer === option.value}
                onSelect={() => answerAndAdvance(question.id, option.value)}
                label={option.label}
                hint={option.hint}
              />
            ))}
          </div>
        ) : null}

        {question.kind === 'text' ? (
          <>
            <p className="mt-1.5 text-[14.5px] leading-6 text-ink-soft">You can leave this empty.</p>
            <label htmlFor="check-in-note" className="sr-only-live">
              {question.prompt}
            </label>
            <textarea
              id="check-in-note"
              rows={3}
              maxLength={question.maxLength}
              value={typeof answer === 'string' ? answer : ''}
              onChange={(event) => set(question.id, event.target.value)}
              placeholder={question.placeholder}
              className="mt-4 block w-full resize-none rounded-[14px] border border-line bg-canvas px-3.5 py-3 text-[15.5px] leading-6 text-ink placeholder:text-ink-faint"
            />
          </>
        ) : null}
      </Card>

      {editing ? (
        <Button variant="ghost" size="md" className="-ml-5 mt-2" onClick={() => setEditing(false)}>
          Keep my earlier answers
        </Button>
      ) : (
        <p className="mt-4 text-center text-[13.5px] leading-5 text-ink-soft">Three quick answers. Under a minute.</p>
      )}
    </Screen>
  );
}
