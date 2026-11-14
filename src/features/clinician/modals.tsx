import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Segmented, cx } from '../../components/ui';
import { demoStore, todayKey } from '../../demo/store';
import { ESTIMATE_LABEL, SEGMENT_LABEL } from '../../domain/recoveryEstimate';
import { LEVEL_LABEL, RULE_LABEL } from '../../domain/triage';
import type { FingerSegment, Patient, TriageFlag } from '../../domain/types';
import { LEVEL_STYLE } from './parts';

export const LOCAL_ONLY = 'Saved in this browser only. Nothing is sent to a clinician, to the patient or to a server.';

const fieldClass =
  'block w-full rounded-[10px] border border-line bg-paper px-3 py-2.5 text-[14px] leading-5 text-ink placeholder:text-ink-faint hover:border-ink/25';

/** Record that the listed flags were looked at, with an optional note. */
export function RecordReviewModal({
  open,
  onClose,
  patient,
  flags,
}: {
  open: boolean;
  onClose(): void;
  patient: Patient;
  flags: TriageFlag[];
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Record a review for ${patient.name}`}
      description={`${flags.length} ${flags.length === 1 ? 'flag' : 'flags'} will be marked as reviewed.`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              demoStore.recordReview(flags, note);
              toast.show('Review recorded. Saved locally.');
              onClose();
            }}
          >
            Record review
          </Button>
        </>
      }
    >
      <ul className="space-y-2">
        {flags.map((flag) => (
          <li key={flag.id} className="flex items-start gap-2.5 rounded-[10px] bg-canvas px-3 py-2.5">
            <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', LEVEL_STYLE[flag.level].bar)} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[13.5px] font-bold leading-5 text-ink">
                {RULE_LABEL[flag.ruleId]}
                <span className="ml-1.5 font-medium text-ink-soft">{LEVEL_LABEL[flag.level]}</span>
              </span>
              <span className="block text-[13px] leading-5 text-ink-soft">{flag.evidence}</span>
            </span>
          </li>
        ))}
      </ul>

      <label htmlFor="review-note" className="mt-4 block text-[13.5px] font-semibold leading-5 text-ink">
        Review note <span className="font-normal text-ink-soft">(optional)</span>
      </label>
      <textarea
        id="review-note"
        data-autofocus
        rows={3}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What you looked at and what, if anything, you decided."
        className={cx(fieldClass, 'mt-1.5 resize-none')}
      />
      <p className="mt-3 text-[12.5px] leading-5 text-ink-soft">
        {LOCAL_ONLY} A rule flag comes back if its condition is met again later; the four-week rule is re-raised weekly.
      </p>
    </Modal>
  );
}

/** Raise a manual flag on a record. */
export function FlagModal({ open, onClose, patient }: { open: boolean; onClose(): void; patient: Patient }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Mark ${patient.name} for review`}
      description="Adds a manual “review suggested” flag to this record."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              demoStore.flagForReview(patient.id, note);
              toast.show('Marked for review. Saved locally.');
              onClose();
            }}
          >
            Mark for review
          </Button>
        </>
      }
    >
      <label htmlFor="flag-note" className="block text-[13.5px] font-semibold leading-5 text-ink">
        Reason <span className="font-normal text-ink-soft">(optional)</span>
      </label>
      <textarea
        id="flag-note"
        data-autofocus
        rows={3}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Why this record should be looked at."
        className={cx(fieldClass, 'mt-1.5 resize-none')}
      />
      <p className="mt-3 text-[12.5px] leading-5 text-ink-soft">{LOCAL_ONLY}</p>
    </Modal>
  );
}

export function NoteModal({ open, onClose, patient }: { open: boolean; onClose(): void; patient: Patient }) {
  const toast = useToast();
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText('');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add a note for ${patient.name}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!text.trim()}
            onClick={() => {
              demoStore.addClinicianNote(patient.id, text);
              toast.show('Note added. Saved locally.');
              onClose();
            }}
          >
            Save note
          </Button>
        </>
      }
    >
      <label htmlFor="clinician-note" className="block text-[13.5px] font-semibold leading-5 text-ink">
        Clinician note
      </label>
      <textarea
        id="clinician-note"
        data-autofocus
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Write a note for this record."
        className={cx(fieldClass, 'mt-1.5 resize-none')}
      />
      <p className="mt-3 text-[12.5px] leading-5 text-ink-soft">{LOCAL_ONLY}</p>
    </Modal>
  );
}

type Basis = 'segment' | 'distance' | 'unset';

const SEGMENTS: { value: FingerSegment; label: string }[] = [
  { value: 'distal', label: 'Distal' },
  { value: 'middle', label: 'Middle' },
  { value: 'proximal', label: 'Proximal' },
];

/**
 * Clinician setup: where the repair is and when it was done. This is the only
 * place these values are entered, and the patient never sees them.
 */
export function ClinicalSetupModal({ open, onClose, patient }: { open: boolean; onClose(): void; patient: Patient }) {
  const toast = useToast();
  const [basis, setBasis] = useState<Basis>('unset');
  const [segment, setSegment] = useState<FingerSegment>('middle');
  const [distance, setDistance] = useState('');
  const [repairDate, setRepairDate] = useState(patient.repairDate);
  const today = todayKey();

  useEffect(() => {
    if (!open) return;
    const { clinical } = patient;
    setBasis(clinical.repairToTipMm !== null ? 'distance' : clinical.segment ? 'segment' : 'unset');
    setSegment(clinical.segment ?? 'middle');
    setDistance(clinical.repairToTipMm !== null ? String(clinical.repairToTipMm) : '');
    setRepairDate(patient.repairDate);
  }, [open, patient]);

  const distanceValue = Number(distance);
  const distanceValid = basis !== 'distance' || (Number.isFinite(distanceValue) && distanceValue >= 1 && distanceValue <= 200);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(repairDate) && repairDate <= today;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Clinical setup"
      description={`For ${patient.name}. Used only for the clinician-facing return window. ${ESTIMATE_LABEL}.`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!distanceValid || !dateValid}
            onClick={() => {
              demoStore.updateClinicalSetup(
                patient.id,
                {
                  segment: basis === 'segment' ? segment : null,
                  repairToTipMm: basis === 'distance' ? Math.round(distanceValue) : null,
                },
                repairDate,
              );
              toast.show('Clinical setup saved locally.');
              onClose();
            }}
          >
            Save setup
          </Button>
        </>
      }
    >
      <fieldset>
        <legend className="text-[13.5px] font-semibold leading-5 text-ink">Injury location</legend>
        <p className="mt-0.5 text-[12.5px] leading-5 text-ink-soft">Enter the finger segment, or the measured distance if you have it.</p>
        <Segmented<Basis>
          options={[
            { value: 'segment', label: 'By segment' },
            { value: 'distance', label: 'By distance' },
            { value: 'unset', label: 'Not set' },
          ]}
          value={basis}
          onChange={(value) => setBasis(value)}
          label="How the injury location is entered"
          size="sm"
          className="mt-2.5"
        />

        {basis === 'segment' ? (
          <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Finger segment">
            {SEGMENTS.map((option) => {
              const selected = option.value === segment;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setSegment(option.value)}
                  className={cx(
                    'rounded-[10px] border px-2 py-2.5 text-center transition-colors duration-150',
                    selected ? 'border-teal-600 bg-teal-50' : 'border-line bg-paper hover:border-ink/25',
                  )}
                >
                  <span className={cx('block text-[13.5px] font-bold', selected ? 'text-teal-700' : 'text-ink')}>{option.label}</span>
                  <span className="block text-[11.5px] leading-4 text-ink-soft">{SEGMENT_LABEL[option.value].toLowerCase()}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {basis === 'distance' ? (
          <div className="mt-3">
            <label htmlFor="setup-distance" className="block text-[13px] font-medium leading-5 text-ink">
              Distance from the nerve repair to the fingertip
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="setup-distance"
                type="number"
                inputMode="numeric"
                min={1}
                max={200}
                value={distance}
                onChange={(event) => setDistance(event.target.value)}
                aria-invalid={!distanceValid}
                className={cx(fieldClass, 'nums w-28')}
              />
              <span className="text-[14px] text-ink-soft">mm</span>
            </div>
            {!distanceValid ? <p className="mt-1.5 text-[12.5px] leading-5 text-wine-600">Enter a distance between 1 and 200 mm.</p> : null}
          </div>
        ) : null}

        {basis === 'unset' ? (
          <p className="mt-3 rounded-[10px] bg-canvas px-3 py-2.5 text-[13px] leading-5 text-ink-soft">
            Without a location no return window is shown for this record.
          </p>
        ) : null}
      </fieldset>

      <label htmlFor="setup-repair-date" className="mt-5 block text-[13.5px] font-semibold leading-5 text-ink">
        Surgery / repair date
      </label>
      <input
        id="setup-repair-date"
        type="date"
        value={repairDate}
        max={today}
        onChange={(event) => setRepairDate(event.target.value)}
        aria-invalid={!dateValid}
        className={cx(fieldClass, 'nums mt-1.5 w-48')}
      />
      {!dateValid ? <p className="mt-1.5 text-[12.5px] leading-5 text-wine-600">Choose a date that is today or earlier.</p> : null}

      <p className="mt-4 text-[12.5px] leading-5 text-ink-soft">{LOCAL_ONLY}</p>
    </Modal>
  );
}
