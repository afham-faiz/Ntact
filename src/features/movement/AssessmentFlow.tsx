/**
 * One assessment from start to summary: run it, turn what the engine recorded
 * into a stored session, and show the result. Used by the patient app and by the
 * presentation, so both save and show sessions in exactly the same way.
 */
import { useCallback, useMemo, useState } from 'react';
import { resolveAssessment, protocolFor } from '../../assessment/definitions';
import { buildSession, previousOf } from '../../assessment/session';
import type { AssessmentId, AssessmentSession } from '../../assessment/types';
import { Button, cx } from '../../components/ui';
import { demoStore, newId } from '../../demo/store';
import type { Patient } from '../../domain/types';
import type { RunResult } from './liveRun';
import { Runner } from './Runner';
import { SessionReport } from './SessionReport';
import { syntheticRecordingFor } from './syntheticDemo';
import { PATIENT_MEANING } from './words';

/** Turns a finished run into a session and stores it. A run in which the target position was never reached leaves nothing behind. */
export function saveRun(patient: Pick<Patient, 'id' | 'hand'>, setup: ReturnType<typeof resolveAssessment>, result: RunResult, at: Date = new Date()): AssessmentSession | null {
  if (result.reps.length === 0) return null;
  const session = buildSession({
    id: newId('assessment'),
    patientId: patient.id,
    timestamp: at.toISOString(),
    hand: patient.hand,
    detectedHand: result.detectedHand,
    setup,
    reps: result.reps,
    durationMs: result.durationMs,
    quality: result.quality,
    view: result.view,
    capture: result.capture,
    tracking: result.tracking,
    // Only frames from a camera are an observation of a person.
    source: result.replay ? 'synthetic-replay' : 'camera',
  });
  return demoStore.recordAssessment(session);
}

export function AssessmentFlow({
  patient,
  assessmentId,
  audience,
  replay = false,
  allowDebug = false,
  onExit,
  onSaved,
  className,
}: {
  patient: Patient;
  assessmentId: AssessmentId;
  audience: 'patient' | 'clinical';
  /** Play the labelled synthetic sequence instead of opening the camera. */
  replay?: boolean;
  allowDebug?: boolean;
  onExit(): void;
  onSaved?(session: AssessmentSession | null): void;
  className?: string;
}) {
  // Who and what this session is for, fixed when it opens.
  const [subject] = useState(() => {
    const protocol = protocolFor(demoStore.getState().assessmentProtocols, patient.id);
    return { patient, setup: resolveAssessment(assessmentId, patient.finger, protocol.overrides[assessmentId]) };
  });
  const [useReplay, setUseReplay] = useState(replay);
  const [round, setRound] = useState(0);
  const [outcome, setOutcome] = useState<{ session: AssessmentSession | null; previous: AssessmentSession | null } | null>(null);

  const recording = useMemo(() => (useReplay ? syntheticRecordingFor(subject.setup, subject.patient.hand) : null), [useReplay, subject]);

  const finished = useCallback(
    (result: RunResult) => {
      const session = saveRun(subject.patient, subject.setup, result);
      setOutcome({ session, previous: session ? previousOf(demoStore.getState().assessmentSessions ?? [], session) : null });
      onSaved?.(session);
    },
    [onSaved, subject],
  );

  if (outcome) {
    const { session, previous } = outcome;
    const fellShort = session !== null && session.summary.validReps === 0 && session.reps.every((rep) => rep.rejectReason === 'target-not-reached');
    return (
      <div className={cx('quiet-scroll flex min-h-0 flex-1 flex-col overflow-y-auto text-ink', className)}>
        <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col">
          <p className="text-[13.5px] font-semibold leading-5 text-ink-soft">{subject.setup.definition.title}</p>
          <h1 className="display mt-1 text-[28px] leading-[1.15]" role="status">
            {session === null ? 'Nothing was recorded this time.' : session.summary.completed ? 'Session recorded.' : session.summary.validReps > 0 ? 'Session recorded, part-way.' : 'No valid repetition this time.'}
          </h1>
          <p className="mt-2 max-w-[56ch] text-[15px] leading-[23px] text-ink-soft">
            {session === null
              ? 'The hand did not move far enough towards the position while tracking was usable, so no session was saved. You can try again whenever you are ready.'
              : fellShort
                ? 'The movement did not reach the position this assessment is set to recognise, so no figures are reported. How far it went has been saved for your therapist, who can change the setting. It is not a verdict on your hand.'
                : session.summary.validReps === 0
                  ? 'The position was reached, but not held with steady tracking, so no figures are reported. That is the app being cautious, not a result about your hand.'
                  : audience === 'patient'
                    ? 'Thank you. Your therapist can see this session.'
                    : 'Captured, summarised and stored locally. The clinician record now shows this session.'}
          </p>

          {session ? <SessionReport session={session} previous={previous} tone="light" audience={audience} className="mt-5" /> : null}

          {audience === 'patient' && session ? (
            <div className="glass mt-3 rounded-[22px] px-5 py-4 text-[13.5px] leading-[21px] text-ink-soft">
              <p>
                <span className="font-bold text-ink">What this shows. </span>
                {PATIENT_MEANING.does}
              </p>
              <p className="mt-1.5">
                <span className="font-bold text-ink">What it does not. </span>
                {PATIENT_MEANING.doesNot}
              </p>
            </div>
          ) : null}

          <div className="mt-auto flex flex-col gap-2.5 pt-6 @md:flex-row-reverse">
            <Button variant="primary" size="lg" block onClick={onExit}>
              Done
            </Button>
            <Button
              variant="outline"
              size="lg"
              block
              onClick={() => {
                setOutcome(null);
                setRound((value) => value + 1);
              }}
            >
              Go again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Runner
      key={`${round}-${useReplay ? 'replay' : 'camera'}`}
      setup={subject.setup}
      hand={subject.patient.hand}
      title={subject.setup.definition.title}
      recording={recording}
      audience={audience}
      allowDebug={allowDebug}
      // Going again keeps the choices already made: straight back to the camera.
      autoStart={round > 0 && !useReplay}
      onClose={onExit}
      onFinished={finished}
      onUseBackup={useReplay ? undefined : () => setUseReplay(true)}
      className={className}
    />
  );
}
