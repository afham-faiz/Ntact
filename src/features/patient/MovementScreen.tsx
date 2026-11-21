/**
 * Movement assessment, patient side: what is on offer, how to do one, doing it,
 * and what has been recorded so far.
 *
 * The tone is the rest of the patient app's: calm, plain, never a verdict. The
 * figures are shown as what the camera saw, compared only with the person's own
 * earlier sessions, and every screen that shows one says what it is not.
 */
import { useCallback, useMemo } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CaretRight, Info } from '@phosphor-icons/react';
import { DEFINITIONS, METRIC_WORDS, isAssessmentId, protocolFor, resolveAssessment } from '../../assessment/definitions';
import { previousOf, sessionsOf } from '../../assessment/session';
import type { AssessmentId, AssessmentSession } from '../../assessment/types';
import { useActivePatient, useDemoState, useToday } from '../../app/hooks';
import { ButtonLink, Card, Explainer } from '../../components/ui';
import { cameraSupport } from '../../camera/cameraStream';
import { dateKeyOf, relativeDay } from '../../domain/dates';
import { AssessmentFlow } from '../movement/AssessmentFlow';
import { MovementFigure } from '../movement/HandFigure';
import { SessionReport, SourceTag } from '../movement/SessionReport';
import { TrendChart, TrendKey, trendPoints } from '../movement/TrendChart';
import { ESTIMATE_NOTE, PATIENT_MEANING, VIEW_NAME, defaultSetup, fingerWords, formatPrimary, viewAdviceFor } from '../movement/words';
import { Screen, SectionHeading, TopBar } from './PatientShell';

const primaryOf = (session: AssessmentSession): number | null => session.summary.primary.median;

// ---------- The list ----------

export function MovementHome() {
  const patient = useActivePatient();
  const state = useDemoState();
  const today = useToday();
  const protocol = protocolFor(state.assessmentProtocols, patient.id);
  const sessions = useMemo(() => sessionsOf(state.assessmentSessions ?? [], patient.id), [state.assessmentSessions, patient.id]);
  const recent = [...sessions].reverse().slice(0, 6);

  return (
    <Screen header={<TopBar title="Movement assessment" />}>
      <p className="-mt-1 text-[15.5px] leading-6 text-ink-soft">
        Your camera follows the joints of your fingers through a set movement and records how far they appear to bend. Your
        therapist chooses which movements are offered here.
      </p>

      <p className="mt-3 flex gap-2.5 rounded-[16px] bg-amber-50 px-4 py-3 text-[13.5px] leading-5 text-amber-700">
        <Info size={18} weight="fill" className="mt-px shrink-0" aria-hidden="true" />
        <span>
          Only do a movement your care team has said is right for you at this stage, and only as far as is comfortable. Never
          push or force a finger. If your team has given you different instructions, theirs come first.
        </span>
      </p>

      {protocol.enabled.length === 0 ? (
        <Card className="mt-4 px-5 py-4">
          <p className="text-[15.5px] leading-6 text-ink">Your therapist hasn’t switched on any movement assessments yet.</p>
        </Card>
      ) : (
        <ul className="mt-4 space-y-3">
          {protocol.enabled.map((id) => {
            const definition = DEFINITIONS[id];
            const own = sessions.filter((session) => session.assessmentId === id);
            const latest = [...own].reverse().find((session) => session.summary.validReps > 0) ?? null;
            const metric = METRIC_WORDS[definition.primary];
            return (
              <li key={id}>
                <Link
                  to={`/patient/movement/${id}`}
                  className="glass flex min-h-[92px] items-center gap-4 rounded-[24px] px-4 py-3.5 text-ink transition-transform duration-150 active:scale-[0.985]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-bold leading-6 tracking-[-0.015em]">{definition.title}</span>
                    <span className="block text-[14px] leading-5 text-ink-soft">{definition.summary}</span>
                    <span className="nums mt-1 block text-[13px] leading-5 text-ink-soft">
                      {latest ? (
                        <>
                          Last: <span className="font-bold text-ink">{formatPrimary(latest.summary.primary.median, metric.unit)}</span>,{' '}
                          {relativeDay(dateKeyOf(latest.timestamp), today).toLowerCase()}
                        </>
                      ) : (
                        'Not done yet'
                      )}
                    </span>
                  </span>
                  <CaretRight size={18} weight="bold" className="shrink-0 text-ink-soft" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {recent.length > 0 ? (
        <section aria-labelledby="movement-history" className="mt-6">
          <SectionHeading>
            <span id="movement-history">Your sessions</span>
          </SectionHeading>
          <Card className="mt-2.5 divide-y divide-line-soft px-5 py-1">
            {recent.map((session) => {
              const definition = DEFINITIONS[session.assessmentId];
              const metric = METRIC_WORDS[definition.primary];
              return (
                <Link key={session.id} to={`/patient/movement/session/${session.id}`} className="flex min-h-[60px] items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-bold leading-5 text-ink">{definition.title}</span>
                    <span className="nums block text-[13px] leading-5 text-ink-soft">
                      {relativeDay(dateKeyOf(session.timestamp), today)} · {session.summary.validReps} of {session.summary.targetReps} recorded
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="nums text-[15px] font-bold text-ink">{formatPrimary(session.summary.primary.median, metric.unit)}</span>
                    <SourceTag session={session} />
                  </span>
                </Link>
              );
            })}
          </Card>
          <p className="mt-2 px-1 text-[12.5px] leading-5 text-ink-soft">
            Sessions marked “Illustrative” are example data that came with this prototype. They are not yours.
          </p>
        </section>
      ) : null}

      <Card className="mt-5 divide-y divide-line-soft px-5 py-1">
        <Explainer summary="What do the numbers mean?">
          <p>{PATIENT_MEANING.does}</p>
          <p className="mt-2">{PATIENT_MEANING.doesNot}</p>
        </Explainer>
        <Explainer summary="How accurate is it?">
          <p>
            {ESTIMATE_NOTE} How close the estimates are depends on the camera, the light and how your hand is turned. When
            the app cannot see a joint well enough, it says so and records nothing for it rather than guessing.
          </p>
        </Explainer>
        <Explainer summary="What happens to the video?">
          <p>
            Nothing leaves this device. The picture goes from your camera to hand tracking that runs inside this page, and is
            never recorded, saved or sent anywhere. Only the figures from the session are kept.
          </p>
        </Explainer>
        <Explainer summary="Can I do it on my own with a phone?">
          <p>
            Yes. Rest the hand being assessed on a table and hold the phone in your other hand, or lean the phone against
            something. Once a session starts it runs by itself: you do not need to touch the screen. Movements read from the
            side are steadier with the phone propped up, and the app will tell you when that is the case.
          </p>
        </Explainer>
      </Card>
    </Screen>
  );
}

// ---------- One assessment: what it is, then start ----------

export function MovementIntroScreen() {
  const { assessmentId } = useParams();
  const patient = useActivePatient();
  const state = useDemoState();
  const support = cameraSupport();
  const pick = primaryOf;

  if (!isAssessmentId(assessmentId)) return <Navigate to="/patient/movement" replace />;
  const protocol = protocolFor(state.assessmentProtocols, patient.id);
  if (!protocol.enabled.includes(assessmentId)) return <Navigate to="/patient/movement" replace />;

  const setup = resolveAssessment(assessmentId, patient.finger, protocol.overrides[assessmentId]);
  const { definition } = setup;
  const advice = viewAdviceFor(setup, defaultSetup());
  const sessions = sessionsOf(state.assessmentSessions ?? [], patient.id, assessmentId);
  const metric = METRIC_WORDS[definition.primary];
  const points = trendPoints(sessions, pick);

  return (
    <Screen
      header={<TopBar title={definition.title} />}
      footer={
        support.supported ? (
          <ButtonLink to={`/patient/movement/${assessmentId}/live`} variant="primary" size="lg" block>
            Set up the camera
          </ButtonLink>
        ) : undefined
      }
    >
      <p className="-mt-1 text-[15.5px] leading-6 text-ink-soft">
        {Math.round(setup.params.reps)} repetitions, each held for {setup.params.holdSeconds} seconds. About a minute.
        {definition.digits === 'one-finger' ? ` For your ${fingerWords(setup.focus)}.` : ''}
      </p>

      <Card className="mt-4 p-5">
        <MovementFigure setup={setup} hand={patient.hand} />
        <ol className="mt-4 space-y-3.5">
          {definition.steps.map((step, index) => (
            <li key={step} className="flex gap-3.5 text-[15.5px] leading-[23px] text-ink">
              <span className="nums w-4 shrink-0 font-bold text-teal-600">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="mt-3 px-5 py-4">
        <p className="text-[13px] font-bold leading-5 text-teal-600">{VIEW_NAME[advice.view]}</p>
        <p className="mt-1 text-[14.5px] leading-[22px] text-ink">{advice.reason}</p>
        <p className="mt-2 text-[13.5px] leading-5 text-ink-soft">
          <span className="font-bold text-ink">What is recorded. </span>
          {definition.records}
        </p>
      </Card>

      {!support.supported ? (
        <p className="mt-4 rounded-[16px] bg-amber-50 px-4 py-3 text-[14.5px] leading-6 text-amber-700" role="status">
          {support.reason === 'insecure'
            ? 'The camera only works on the https:// address of Ntact, or on localhost.'
            : 'This browser can’t use the camera from a web page.'}
        </p>
      ) : null}

      {points.length > 0 ? (
        <section aria-labelledby="movement-trend" className="mt-5">
          <SectionHeading>
            <span id="movement-trend">Your earlier sessions</span>
          </SectionHeading>
          <Card className="mt-2.5 px-4 py-4">
            <p className="px-1 text-[13.5px] leading-5 text-ink-soft">{metric.label} while held</p>
            <div data-own-swipe className="mt-1">
              <TrendChart sessions={sessions} pick={pick} unit={metric.unit} label={`${metric.label} across your sessions`} />
            </div>
            <div className="mt-1 px-1">
              <TrendKey points={points} />
            </div>
          </Card>
        </section>
      ) : null}

      <ButtonLink to={`/patient/movement/${assessmentId}/live?mode=replay`} variant="ghost" size="md" className="-ml-4 mt-2">
        Watch a synthetic demonstration instead
      </ButtonLink>
    </Screen>
  );
}

// ---------- Live ----------

export function MovementLiveScreen() {
  const { assessmentId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const patient = useActivePatient();
  const exit = useCallback(() => navigate(isAssessmentId(assessmentId) ? `/patient/movement/${assessmentId}` : '/patient/movement'), [navigate, assessmentId]);
  if (!isAssessmentId(assessmentId)) return <Navigate to="/patient/movement" replace />;
  return (
    // Exactly the height of the screen, so the picture gets whatever the read-out does not need and nothing scrolls the page.
    <main className="flex h-dvh min-h-0 flex-1 flex-col px-[max(16px,env(safe-area-inset-left))] pb-[max(16px,env(safe-area-inset-bottom))] pr-[max(16px,env(safe-area-inset-right))] pt-[max(12px,env(safe-area-inset-top))] short:pb-2 short:pt-2 frame:h-auto frame:px-4 frame:pb-6 frame:pt-1">
      <AssessmentFlow
        // Keyed so that moving to another assessment starts from scratch.
        key={assessmentId as AssessmentId}
        patient={patient}
        assessmentId={assessmentId}
        audience="patient"
        replay={params.get('mode') === 'replay'}
        allowDebug={params.get('debug') === '1'}
        onExit={exit}
      />
    </main>
  );
}

// ---------- One past session ----------

export function MovementSessionScreen() {
  const { sessionId } = useParams();
  const patient = useActivePatient();
  const state = useDemoState();
  const session = (state.assessmentSessions ?? []).find((item) => item.id === sessionId && item.patientId === patient.id);
  if (!session) return <Navigate to="/patient/movement" replace />;
  const definition = DEFINITIONS[session.assessmentId];
  return (
    <Screen header={<TopBar title={definition.title} />}>
      <SessionReport session={session} previous={previousOf(state.assessmentSessions ?? [], session)} audience="patient" />
      <Card className="mt-3 px-5 py-4 text-[13.5px] leading-[21px] text-ink-soft">
        <p>
          <span className="font-bold text-ink">What this shows. </span>
          {PATIENT_MEANING.does}
        </p>
        <p className="mt-1.5">
          <span className="font-bold text-ink">What it does not. </span>
          {PATIENT_MEANING.doesNot}
        </p>
      </Card>
    </Screen>
  );
}
