import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft } from 'lucide-react';
import { useActivePatient } from '../../app/hooks';
import { HandIllustration } from '../../components/HandIllustration';
import { Ripples } from '../../components/Ripples';
import { Button, Segmented, cx } from '../../components/ui';
import { demoStore, todayKey } from '../../demo/store';
import type { Finger, Hand } from '../../domain/types';

const FINGERS: { value: Finger; label: string }[] = [
  { value: 'thumb', label: 'Thumb' },
  { value: 'index', label: 'Index' },
  { value: 'middle', label: 'Middle' },
  { value: 'ring', label: 'Ring' },
  { value: 'little', label: 'Little' },
];

const HANDS: { value: Hand; label: string }[] = [
  { value: 'left', label: 'Left hand' },
  { value: 'right', label: 'Right hand' },
];

const TOTAL = 3;

/**
 * Optional three-step introduction. It asks only for what the patient knows:
 * which finger and when the surgery was. Distances and estimates belong to the
 * clinician's setup, not here. Skipping is always possible.
 */
export function OnboardingScreen() {
  const patient = useActivePatient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initial = Math.min(TOTAL, Math.max(1, Number(params.get('step')) || 1));
  const [step, setStep] = useState(initial);
  const [hand, setHand] = useState<Hand>(patient.hand);
  const [finger, setFinger] = useState<Finger>(patient.finger);
  const [repairDate, setRepairDate] = useState(patient.repairDate);
  const today = todayKey();
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(repairDate) && repairDate <= today;

  const leave = () => {
    demoStore.setOnboardingSeen(true);
    navigate('/patient');
  };

  const finish = () => {
    demoStore.updateProfile(patient.id, { hand, finger, repairDate: dateValid ? repairDate : patient.repairDate });
    leave();
  };

  return (
    <div className="flex flex-1 flex-col sm:min-h-0">
      <header className="flex min-h-[56px] shrink-0 items-center justify-between px-5 pt-[max(8px,env(safe-area-inset-top))] sm:pt-1">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            aria-label="Back"
            className="-ml-1 grid size-11 place-items-center rounded-full bg-paper text-ink hover:bg-navy-50"
          >
            <ChevronLeft className="size-[22px]" strokeWidth={2} aria-hidden="true" />
          </button>
        ) : (
          <span className="size-11" aria-hidden="true" />
        )}
        <ol className="flex gap-1.5" aria-label={`Level ${step} of ${TOTAL}`}>
          {Array.from({ length: TOTAL }, (_, index) => (
            <li
              key={index}
              className={cx('h-1.5 rounded-full transition-all duration-200', index + 1 === step ? 'w-7 bg-mint' : index + 1 < step ? 'w-3 bg-ink/40' : 'w-3 bg-ink/15')}
            />
          ))}
        </ol>
        <button type="button" onClick={leave} className="-mr-2 min-h-11 rounded-full px-3 text-[14.5px] font-semibold text-ink-soft hover:text-ink">
          Skip
        </button>
      </header>

      <main key={step} className="screen-in no-scrollbar flex-1 px-5 pb-4 sm:min-h-0 sm:overflow-y-auto">
        {step === 1 ? (
          <>
            <figure className="relative mt-2 overflow-hidden rounded-feature border border-rule bg-paper">
              <HandIllustration
                hand={hand}
                finger={finger}
                active
                className="mx-auto block h-[300px] w-auto pt-2"
                title="A hand seen from the palm. A dotted path runs from a sleeve on one fingertip to a band at the wrist."
              />
              <figcaption className="border-t border-rule px-4 py-2 text-center text-[12.5px] leading-5 text-ink-soft">Illustration</figcaption>
            </figure>
            <h1 className="display mt-6 text-[28px] leading-[1.15] text-ink">Touch, sent somewhere you can feel it.</h1>
            <p className="mt-2.5 text-[16px] leading-6 text-ink-soft">
              While your fingertip is recovering, the sleeve notices pressure there and the wearable passes it on as gentle taps
              at your wrist. That’s Touch Assist.
            </p>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="surface-deep relative mt-2 grid h-[300px] place-items-center overflow-hidden rounded-feature" aria-hidden="true">
              <Ripples className="absolute size-[420px]" rings={7} />
              <span className="relative grid size-[132px] place-items-center rounded-full bg-mint text-[20px] font-bold tracking-[-0.02em] text-ink">
                I Feel It
              </span>
            </div>
            <h1 className="display mt-6 text-[28px] leading-[1.15] text-ink">One short test a day.</h1>
            <p className="mt-2.5 text-[16px] leading-6 text-ink-soft">
              It takes about 30 seconds. The wearable tries a series of vibrations and you tap as soon as you feel one. You won’t
              see how strong they are while it runs.
            </p>
            <ul className="mt-4 space-y-2.5 text-[15px] leading-6 text-ink">
              {['Each result adds a point to your recovery curve.', 'Your therapist can use the curve to follow your progress.', 'Recovery looks different for everyone.'].map(
                (line) => (
                  <li key={line} className="flex gap-2.5">
                    <span className="mt-1 grid size-[18px] shrink-0 place-items-center rounded-full bg-floor text-ink">
                      <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                    </span>
                    {line}
                  </li>
                ),
              )}
            </ul>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h1 className="display mt-2 text-[28px] leading-[1.15] text-ink">Which finger is wearing the sleeve?</h1>
            <p className="mt-2 text-[15px] leading-6 text-ink-soft">This sets up the pictures in the app. You can change it later.</p>

            <figure className="mt-4 overflow-hidden rounded-feature border border-rule bg-paper">
              <HandIllustration
                hand={hand}
                finger={finger}
                active={false}
                showPath={false}
                className="mx-auto block h-[190px] w-auto pt-2"
                title={`A ${hand} hand seen from the palm with the sleeve on the ${finger === 'thumb' ? 'thumb' : `${finger} finger`}.`}
              />
            </figure>

            <Segmented<Hand> options={HANDS} value={hand} onChange={(value) => setHand(value)} label="Affected hand" block className="mt-4" />

            <div role="radiogroup" aria-label="Affected finger" className="mt-3 grid grid-cols-5 gap-1.5">
              {FINGERS.map((option) => {
                const selected = option.value === finger;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setFinger(option.value)}
                    className={cx(
                      'min-h-12 rounded-[14px] border-2 px-1 text-[13.5px] font-bold transition-colors duration-150',
                      selected ? 'border-ink bg-floor text-ink' : 'border-line bg-paper text-ink hover:border-ink/25',
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <label htmlFor="repair-date" className="mt-5 block text-[15.5px] font-bold leading-6 text-ink">
              When was your surgery?
            </label>
            <input
              id="repair-date"
              type="date"
              value={repairDate}
              max={today}
              onChange={(event) => setRepairDate(event.target.value)}
              aria-invalid={!dateValid}
              className="sb-date mt-1.5 rounded-[14px] border border-rule bg-paper text-[16px] font-semibold text-ink"
            />
            <p className={cx('mt-1.5 text-[13px] leading-5', dateValid ? 'text-ink-soft' : 'text-teal-600')}>
              {dateValid ? 'An approximate date is fine. This is a fictional demo profile.' : 'Choose a date that is today or earlier.'}
            </p>
          </>
        ) : null}
      </main>

      <div className="shrink-0 px-5 pb-[max(18px,env(safe-area-inset-bottom))] pt-2 sm:pb-7">
        {step < TOTAL ? (
          <Button variant="primary" size="lg" block onClick={() => setStep(step + 1)}>
            Next
          </Button>
        ) : (
          <Button variant="primary" size="lg" block onClick={finish} disabled={!dateValid}>
            Finish
          </Button>
        )}
      </div>
    </div>
  );
}
