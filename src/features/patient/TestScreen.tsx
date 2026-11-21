import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, CircleSlash, TriangleAlert, Unplug } from 'lucide-react';
import { useDevice } from '../../app/DeviceContext';
import { useTestSession } from '../../app/TestSessionContext';
import { useActivePatient, useDemoState, useToday } from '../../app/hooks';
import { StepDial } from '../../components/charts/StepDial';
import { HandIllustration } from '../../components/HandIllustration';
import { Button, ButtonLink, Card, Explainer, IconChip, Pill, Spinner } from '../../components/ui';
import { dateKeyOf, relativeDay } from '../../domain/dates';
import { primaryTestOfDay, testsForPatient, testsOnDay } from '../../domain/selectors';
import { toBlindedView, type TestPhase } from '../../domain/testSession';
import type { TrialOutcome } from '../../domain/types';
import { PROBLEM_COPY } from './deviceCopy';
import { Screen, TopBar } from './PatientShell';

// ---------- Before the test ----------

/** The physical prototype has one motor, on the wristband. The test is done with the band off the wrist. */
const PREP = [
  'Take the band off your wrist and lay it flat.',
  'Rest the tip of your {finger} on the round disc.',
  'Tap “I Feel It” the moment you feel a buzz.',
];

function PreTest({ arming }: { arming: boolean }) {
  const patient = useActivePatient();
  const state = useDemoState();
  const today = useToday();
  const device = useDevice();
  const session = useTestSession();
  const connected = device.connection === 'connected';
  const fingerName = patient.finger === 'thumb' ? 'thumb' : `${patient.finger} finger`;
  const primary = primaryTestOfDay(testsOnDay(testsForPatient(state.tests, patient.id), today));
  const doneToday = primary !== null && primary.outcome !== 'STOPPED';

  return (
    <Screen
      header={<TopBar title="Sensation test" />}
      footer={
        connected ? (
          <Button variant="primary" size="lg" block onClick={session.begin} disabled={arming}>
            {arming ? (
              <>
                <Spinner /> Getting the device ready
              </>
            ) : (
              'Start test'
            )}
          </Button>
        ) : (
          <Button variant="primary" size="lg" block onClick={device.connect} disabled={device.connection === 'connecting'}>
            {device.connection === 'connecting' ? (
              <>
                <Spinner /> {device.words.connecting}
              </>
            ) : (
              device.words.connect
            )}
          </Button>
        )
      }
    >
      <p className="-mt-1 text-[15.5px] leading-6 text-ink-soft">A 30-second check of what your fingertip can feel.</p>

      <figure className="glass mt-4 overflow-hidden rounded-[22px]">
        <HandIllustration
          hand={patient.hand}
          finger={patient.finger}
          mode="test"
          active={false}
          className="mx-auto block h-[236px] w-auto pt-1"
          title={`A ${patient.hand} hand seen from above. The wristband is off the wrist and lying flat, and the tip of the ${fingerName} rests on the round disc on the band.`}
        />
      </figure>


      {!connected ? (
        <p className="mt-4 flex items-start gap-2.5 rounded-[12px] bg-amber-50 px-4 py-3 text-[14.5px] leading-6 text-amber-700" role="status">
          <Unplug className="mt-1 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          <span>
            {device.simulated
              ? 'The demo device is disconnected. Reconnect it to start the test.'
              : device.problem
                ? `${PROBLEM_COPY[device.problem].title}${device.problem === 'lost' ? '' : `. ${PROBLEM_COPY[device.problem].body}`}`
                : 'The Ntact device is not connected. Connect it to start the test.'}
          </span>
        </p>
      ) : null}

      <Card className="mt-4 p-4">
        <ol className="space-y-3.5">
          {PREP.map((step, index) => (
            <li key={step} className="flex gap-3.5 text-[15.5px] leading-[23px] text-ink">
              <span className="nums w-4 shrink-0 font-bold text-teal-600">{index + 1}</span>
              <span>{step.replace('{finger}', fingerName)}</span>
            </li>
          ))}
        </ol>
      </Card>

      <p className="mt-4 text-[14px] leading-6 text-ink-soft">Touch Assist pauses while you test. Put the band back on afterwards.</p>
      {doneToday ? (
        <p className="mt-1 text-[14px] leading-6 text-ink-soft">
          You have already completed a test today. Another one is saved alongside it.
        </p>
      ) : null}


      <Explainer summary="How it works" className="mt-1">
        <p>
          The disc on the band starts with a moment of nothing, then buzzes at up to ten settings, from its gentlest to
          its strongest. It ends on its own after about 30 seconds.
        </p>
        <p className="mt-2">
          The app deliberately doesn’t show which setting is running, so that what you see can’t influence what you feel.
        </p>
      </Explainer>
    </Screen>
  );
}

// ---------- During the test: blinded ----------

/**
 * Nothing on this screen depends on the current level, the drive or the elapsed
 * time. It receives only whether a tap is possible and whether one has been
 * sent. The ambient rings are a fixed CSS loop that starts when the screen appears.
 */
function RunningTest({ phase }: { phase: TestPhase }) {
  const session = useTestSession();
  const device = useDevice();
  const patient = useActivePatient();
  const fingerName = patient.finger === 'thumb' ? 'thumb' : `${patient.finger} finger`;
  const view = toBlindedView(phase);
  const stopping = phase.name === 'stopping';

  return (
    <main className="on-dark flex min-h-dvh flex-1 flex-col px-6 frame:min-h-0 pb-[max(22px,env(safe-area-inset-bottom))] pt-[max(18px,env(safe-area-inset-top))] text-white frame:pb-8 frame:pt-2">
      <p className="text-center text-[14px] font-medium leading-5 text-mist">Daily sensation test</p>

      {/* A fixed picture of the position to hold. It does not move with the device, so it gives nothing away. */}
      <figure className="glass-dark mx-auto mt-4 flex w-full max-w-[330px] items-center gap-3 rounded-[22px] py-2 pl-2 pr-4">
        <HandIllustration
          hand={patient.hand}
          finger={patient.finger}
          mode="test"
          tone="dark"
          crop
          active={false}
          className="h-[104px] w-auto shrink-0"
          title={`A ${patient.hand} hand with the tip of the ${fingerName} resting on the round disc of a wristband lying flat.`}
        />
        <figcaption className="text-[14px] leading-5 text-mist">
          Keep your <span className="font-bold text-white">{fingerName}</span> resting on the disc.
        </figcaption>
      </figure>

      <h1 className="display mx-auto mt-5 max-w-[310px] text-center text-[27px] leading-[1.16] text-white">
        Tap as soon as you feel a buzz
      </h1>

      <div className="relative mt-auto grid place-items-center py-6">
        <span className="breathe absolute size-[236px] rounded-full border border-mint/30" aria-hidden="true" />
        <span className="breathe-late absolute size-[278px] rounded-full border border-mint/20" aria-hidden="true" />
        <span className="breathe-later absolute size-[320px] rounded-full border border-mint/10" aria-hidden="true" />
        <button
          type="button"
          onClick={session.tapFelt}
          disabled={!view.canRespond && !view.acknowledged}
          aria-disabled={view.acknowledged || undefined}
          className="relative grid size-[196px] select-none place-items-center rounded-full bg-mint text-ink shadow-[0_0_0_10px_rgb(236_180_36_/_0.16),0_24px_50px_-18px_rgb(236_180_36_/_0.6)] transition-transform duration-100 active:scale-[0.965] disabled:opacity-60"
        >
          <span className="display text-[31px] leading-none">
            {view.acknowledged ? (
              <span className="flex items-center gap-2">
                <Check className="size-7" strokeWidth={3} aria-hidden="true" />
                Got it
              </span>
            ) : (
              'I Feel It'
            )}
          </span>
        </button>
      </div>

      <p className="mt-auto text-center text-[14.5px] leading-6 text-mist" aria-live="polite">
        {view.acknowledged
          ? `Thanks. Reading the result from the ${device.words.name}.`
          : stopping
            ? 'Stopping the test.'
            : 'It ends on its own after about 30 seconds.'}
      </p>

      <Button variant="glass" size="md" block className="mt-4" onClick={session.tapStop} disabled={!view.canStop}>
        Stop test
      </Button>
    </main>
  );
}

// ---------- After the test ----------

function ResultShell({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return (
    <Screen header={<TopBar title="Sensation test" />} footer={footer}>
      {children}
    </Screen>
  );
}

function Result({ outcome }: { outcome: TrialOutcome }) {
  const session = useTestSession();
  const state = useDemoState();
  const today = useToday();
  const previous = session.saved?.previous ?? null;
  const assistReturns = state.assistPreferred;

  if (outcome.outcome === 'FELT') {
    return (
      <ResultShell
        footer={
          <div className="flex gap-2.5">
            <ButtonLink to="/patient" variant="primary" size="lg" className="flex-1">
              Done
            </ButtonLink>
            <ButtonLink to="/patient/progress" variant="outline" size="lg" className="flex-1">
              See history
            </ButtonLink>
          </div>
        }
      >
        <Pill tone="teal" className="mt-1">
          <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
          Test complete
        </Pill>
        <h2 className="display mt-3 text-[28px] leading-[1.16] text-ink" role="status">
          You felt a vibration at level {outcome.level} of 10.
        </h2>

        <Card className="mt-5 flex flex-col items-center px-4 pb-4 pt-5">
          <StepDial level={outcome.level} />
        </Card>

        {previous ? (
          <p className="mt-5 text-[16px] leading-6 text-ink">
            Your previous test ({relativeDay(dateKeyOf(previous.timestamp), today).toLowerCase()}) detected level{' '}
            {previous.detectedLevel}.
          </p>
        ) : null}
        <p className="mt-2.5 text-[14.5px] leading-6 text-ink-soft">
          A lower detected level means you responded to a weaker commanded setting. Results can vary and are not a diagnosis.
        </p>
        <p className="mt-2.5 text-[14.5px] leading-6 text-ink-soft">
          Put the band back on your wrist.{assistReturns ? ' Touch Assist turns back on when you leave this screen.' : ''}
        </p>
      </ResultShell>
    );
  }

  if (outcome.outcome === 'NO_FELT') {
    return (
      <ResultShell
        footer={
          <div className="flex gap-2.5">
            <ButtonLink to="/patient" variant="primary" size="lg" className="flex-1">
              Done
            </ButtonLink>
            <ButtonLink to="/patient/progress" variant="outline" size="lg" className="flex-1">
              See history
            </ButtonLink>
          </div>
        }
      >
        <Pill tone="violet" className="mt-1">
          Test complete
        </Pill>
        <h2 className="display mt-3 text-[27px] leading-[1.18] text-ink" role="status">
          You didn’t report feeling a vibration this time.
        </h2>
        <Card className="mt-5 space-y-3 p-5 text-[15.5px] leading-6 text-ink">
          <p>That can happen for ordinary reasons: where your fingertip was resting on the disc, how firmly, or cold hands.</p>
          <p>It is saved as “not felt”. It isn’t a score and it isn’t placed on the 1 to 10 scale.</p>
        </Card>
        <p className="mt-4 text-[14.5px] leading-6 text-ink-soft">
          You can try again later, or carry on with your day. Put the band back on your wrist.
          {assistReturns ? ' Touch Assist turns back on when you leave this screen.' : ''}
        </p>
        <Button variant="ghost" size="md" className="-ml-5 mt-1" onClick={session.reset}>
          Test again now
        </Button>
      </ResultShell>
    );
  }

  const early = outcome.stopReason === 'EARLY_RESPONSE';
  return (
    <ResultShell
      footer={
        <div className="flex gap-2.5">
          <Button variant="primary" size="lg" className="flex-1" onClick={session.reset}>
            Start again
          </Button>
          <ButtonLink to="/patient" variant="outline" size="lg" className="flex-1">
            Done
          </ButtonLink>
        </div>
      }
    >
      <IconChip icon={CircleSlash} tone="neutral" size="lg" round className="mt-2" />
      <Pill tone="neutral" className="mt-4">
        Test stopped
      </Pill>
      <h2 className="display mt-3 text-[27px] leading-[1.18] text-ink" role="status">
        {early ? 'That tap came before the test had begun.' : 'The test was stopped, so there is no result this time.'}
      </h2>
      <p className="mt-4 text-[16px] leading-6 text-ink">
        {early
          ? 'Every test opens with a moment of nothing, so there was no vibration to feel yet. No level was recorded.'
          : 'No level was recorded. It is saved as a stopped test.'}
      </p>
      <p className="mt-2.5 text-[14.5px] leading-6 text-ink-soft">
        {early ? 'Start again when you are ready, and tap only once you feel something.' : 'Start again whenever you are ready.'}
      </p>
    </ResultShell>
  );
}

// ---------- When something goes wrong ----------

function ConnectionLost() {
  const device = useDevice();
  const session = useTestSession();
  const navigate = useNavigate();
  const connected = device.connection === 'connected';
  const connecting = device.connection === 'connecting';

  return (
    <ResultShell
      footer={
        connected ? (
          <div className="space-y-2.5">
            <Button variant="primary" size="lg" block onClick={session.reset}>
              Set up the test again
            </Button>
            <Button
              variant="outline"
              size="lg"
              block
              onClick={() => {
                device.enableAssist();
                navigate('/patient/assist');
              }}
            >
              Turn Touch Assist back on
            </Button>
          </div>
        ) : (
          <Button variant="primary" size="lg" block onClick={device.connect} disabled={connecting}>
            {connecting ? (
              <>
                <Spinner /> {device.words.connecting}
              </>
            ) : (
              device.words.connect
            )}
          </Button>
        )
      }
    >
      <IconChip icon={Unplug} tone="amber" size="lg" round className="mt-2" />
      <h2 className="display mt-4 text-[27px] leading-8 text-ink" role="alert">
        Connection lost
      </h2>
      <p className="mt-2.5 text-[16px] leading-6 text-ink">
        The {device.words.name} disconnected, so this test was cancelled. Nothing was saved, and the test will not pick up where it
        left off.
      </p>
      {connected ? (
        <p className="mt-4 rounded-[12px] bg-floor px-4 py-3 text-[15px] leading-6 text-ink" role="status">
          Reconnected. The wearable is idle until you choose what happens next.
        </p>
      ) : (
        <p className="mt-2.5 text-[14.5px] leading-6 text-ink-soft">
          Reconnect when you are ready. You will then choose whether to set up the test again or go back to Touch Assist.
        </p>
      )}
      <ButtonLink to="/patient" variant="ghost" size="md" className="-ml-5 mt-2">
        Back to Today
      </ButtonLink>
    </ResultShell>
  );
}

const ERROR_COPY: Record<string, { title: string; body: string }> = {
  DRIVER: {
    title: 'The wearable couldn’t start the test',
    body: 'It reported a problem with its vibration driver, so no test was run and nothing was saved.',
  },
  TIMEOUT: {
    title: 'The {device} didn’t answer',
    body: 'The app sent a command and heard nothing back. Nothing was saved.',
  },
  NO_TEST: {
    title: 'The wearable had no test running',
    body: 'Your tap reached it after the test had already ended, so there was nothing to report. Nothing was saved.',
  },
  SELECT_REHAB: {
    title: 'The wearable wasn’t ready for a test',
    body: 'It hadn’t switched into test mode yet. No test was run and nothing was saved.',
  },
};

function DeviceError({ code }: { code: string }) {
  const session = useTestSession();
  const device = useDevice();
  const copy = ERROR_COPY[code] ?? {
    title: 'The test couldn’t start',
    body: 'The wearable reported a problem. No test was run and nothing was saved.',
  };
  return (
    <ResultShell
      footer={
        <div className="flex gap-2.5">
          <Button variant="primary" size="lg" className="flex-1" onClick={session.reset}>
            Try again
          </Button>
          <ButtonLink to="/patient/help" variant="outline" size="lg" className="flex-1">
            Help
          </ButtonLink>
        </div>
      }
    >
      <IconChip icon={TriangleAlert} tone="amber" size="lg" round className="mt-2" />
      <h2 className="display mt-4 text-[27px] leading-8 text-ink" role="alert">
        {copy.title.replace('{device}', device.words.name)}
      </h2>
      <p className="mt-2.5 text-[16px] leading-6 text-ink">{copy.body}</p>
      <p className="mt-3 text-[13.5px] leading-5 text-ink-soft">
        The exact device message is in the developer panel, under Demo controls.
      </p>
    </ResultShell>
  );
}

// ---------- Route ----------

export function TestScreen() {
  const session = useTestSession();
  const { phase, attach, detach } = session;

  // Leaving this screen mid-test stops the trial. Leaving after a result restores Touch Assist.
  useEffect(() => {
    attach();
    return detach;
  }, [attach, detach]);

  switch (phase.name) {
    case 'ready':
      return <PreTest arming={false} />;
    case 'arming':
      return <PreTest arming />;
    case 'starting':
    case 'running':
    case 'responding':
    case 'stopping':
      return <RunningTest phase={phase} />;
    case 'result':
      return <Result outcome={phase.outcome} />;
    case 'connection-lost':
      return <ConnectionLost />;
    case 'device-error':
      return <DeviceError code={phase.code} />;
  }
}
