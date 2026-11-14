import { assistStateOf, useDevice, type AssistState } from '../../app/DeviceContext';
import { useActivePatient } from '../../app/hooks';
import { HandIllustration } from '../../components/HandIllustration';
import { Button, Card, Pill, Spinner, type Tone } from '../../components/ui';
import { Screen, TopBar } from './PatientShell';

const HEADLINE: Record<AssistState, string> = {
  on: 'Touch feedback enabled',
  paused: 'Touch Assist is paused',
  testing: 'Paused for the sensation test',
  offline: 'Demo device disconnected',
  checking: 'Checking the demo device',
  changing: 'Waiting for the demo device',
};

const DETAIL: Record<AssistState, string> = {
  on: 'When your fingertip senses pressure, the wearable gives feedback at your wrist.',
  paused: 'The wearable is idle, so it gives no feedback at your wrist until you turn Touch Assist back on.',
  testing: 'Touch Assist and the sensation test can’t run at the same time. Turn Touch Assist back on when you have finished testing.',
  offline:
    'With the current firmware the wearable stops giving feedback when the connection drops. Reconnect, then turn Touch Assist back on.',
  checking: 'Asking the demo device which mode it is in.',
  changing: 'The mode changes once the demo device confirms it.',
};

const STATE_WORD: Record<AssistState, { word: string; tone: Tone }> = {
  on: { word: 'On', tone: 'teal' },
  paused: { word: 'Paused', tone: 'neutral' },
  testing: { word: 'Paused', tone: 'neutral' },
  offline: { word: 'Unavailable', tone: 'amber' },
  checking: { word: 'Checking', tone: 'neutral' },
  changing: { word: 'Updating', tone: 'neutral' },
};

const STEPS = [
  'A sensor in the sleeve notices pressure at your fingertip.',
  'The wearable answers with taps at your wrist: slow taps for a light touch, quicker taps for a firmer one, and a steady buzz when you press hard.',
  'All of this happens inside the wearable. The app only switches the mode on or off.',
];

export function AssistScreen() {
  const patient = useActivePatient();
  const device = useDevice();
  const state = assistStateOf(device);
  const on = state === 'on';
  const busy = state === 'changing' || state === 'checking';
  const fingerName = patient.finger === 'thumb' ? 'thumb' : `${patient.finger} finger`;

  return (
    <Screen header={<TopBar title="Touch Assist" back="/patient" />}>
      <figure className="relative overflow-hidden rounded-feature border border-rule bg-paper">
        <div className="absolute left-4 top-4">
          <Pill tone={STATE_WORD[state].tone} dot={on} className="">
            {STATE_WORD[state].word}
          </Pill>
        </div>
        <HandIllustration
          hand={patient.hand}
          finger={patient.finger}
          active={on}
          className="mx-auto block h-[268px] w-auto pt-3"
          title={`A ${patient.hand} hand seen from the palm. A sleeve with a pressure sensor sits on the ${fingerName}, and a dotted path runs from it to a band at the wrist.`}
        />
        <figcaption className="flex items-start justify-between gap-4 border-t border-rule px-4 py-3 text-[12.5px] leading-5 text-ink-soft">
          <ol className="space-y-1">
            <li className="flex items-center gap-2">
              <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-ink text-[10.5px] font-bold leading-none text-white">1</span>
              Sensor on the fingertip sleeve
            </li>
            <li className="flex items-center gap-2">
              <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-ink text-[10.5px] font-bold leading-none text-white">2</span>
              Feedback at the wrist
            </li>
          </ol>
          <span className="shrink-0 text-right">
            Illustration,
            <br />
            not a live reading
          </span>
        </figcaption>
      </figure>

      <div className="mt-5" aria-live="polite">
        <h2 className="display text-[24px] leading-8 text-ink">{HEADLINE[state]}</h2>
        <p className="mt-1.5 text-[15.5px] leading-6 text-ink-soft">{DETAIL[state]}</p>
      </div>

      <div className="mt-4 space-y-2.5">
        {state === 'offline' ? (
          <>
            <Button variant="primary" size="lg" block onClick={device.connect} disabled={device.connection === 'connecting'}>
              {device.connection === 'connecting' ? (
                <>
                  <Spinner /> Reconnecting
                </>
              ) : (
                'Reconnect demo device'
              )}
            </Button>
            <Button variant="outline" size="lg" block disabled>
              Enable Touch Assist
            </Button>
          </>
        ) : on ? (
          <Button variant="outline" size="lg" block onClick={device.pauseAssist}>
            Pause Touch Assist
          </Button>
        ) : (
          <Button variant="primary" size="lg" block onClick={device.enableAssist} disabled={busy}>
            {busy ? (
              <>
                <Spinner /> One moment
              </>
            ) : (
              'Enable Touch Assist'
            )}
          </Button>
        )}
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-[17px] font-bold leading-6 tracking-[-0.015em] text-ink">How it works</h2>
        <ol className="mt-3.5 space-y-3.5">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-3 text-[14.5px] leading-[22px] text-ink">
              <span className="mt-px grid size-6 shrink-0 place-items-center rounded-full bg-floor text-[12.5px] font-bold text-ink">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Card>
    </Screen>
  );
}
