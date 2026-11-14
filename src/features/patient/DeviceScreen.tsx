import { Link } from 'react-router-dom';
import { ChevronRight, Unplug, Watch } from 'lucide-react';
import { assistStateOf, useDevice } from '../../app/DeviceContext';
import { useActivePatient } from '../../app/hooks';
import {
  Button,
  ButtonLink,
  Card,
  ConceptNote,
  Explainer,
  IconChip,
  Segmented,
  SimulatedBadge,
  Spinner,
  cx,
} from '../../components/ui';
import type { DeviceSource } from '../../devices/source';
import { formatDateFull } from '../../domain/dates';
import type { DeviceMode } from '../../domain/types';
import { injurySite } from '../clinician/parts';
import { LISTED_NAME, PROBLEM_COPY, linkHeadline } from './deviceCopy';
import { Screen, SectionHeading, TopBar } from './PatientShell';

const MODE_LABEL: Record<DeviceMode, string> = {
  NORMAL: 'Touch Assist',
  REHAB: 'Sensation test',
  IDLE: 'Idle',
};

const SOURCE_OPTIONS: { value: DeviceSource; label: string }[] = [
  { value: 'hardware', label: 'Physical device' },
  { value: 'simulation', label: 'Demonstration' },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-[14.5px] leading-5 text-ink-soft">{label}</span>
      <span className="text-right text-[15px] font-bold leading-5 text-ink">{children}</span>
    </div>
  );
}

export function DeviceScreen() {
  const device = useDevice();
  const patient = useActivePatient();
  const connected = device.connection === 'connected';
  const connecting = device.connection === 'connecting';
  const hardware = !device.simulated;
  const assist = assistStateOf(device);
  const modeBusy = assist === 'changing' || assist === 'checking';
  // Shown before any attempt, so nobody taps Connect in a browser that cannot do it.
  const blocked = hardware && !device.bluetooth.supported ? device.bluetooth.reason : null;
  const problem = hardware ? (device.problem ?? blocked) : null;
  const calm = connected || connecting;

  return (
    <Screen header={<TopBar title="Device" />}>
      <Card className="overflow-hidden">
        <div className={cx('flex items-center gap-3.5 px-5 py-5', calm ? 'border-b border-rule bg-paper' : 'border-b border-rule bg-amber-50')}>
          <IconChip icon={connected ? Watch : Unplug} tone={connected ? 'teal' : 'amber'} size="lg" round className="bg-paper" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-bold leading-6 tracking-[-0.02em] text-ink" aria-live="polite">
              {linkHeadline(device)}
            </h2>
            <p className="mt-0.5 text-[13.5px] leading-5 text-ink-soft">
              {hardware
                ? connected
                  ? 'Your wearable is linked to this browser over Bluetooth.'
                  : connecting
                    ? device.stage === 'choosing'
                      ? `Pick ${LISTED_NAME} from the list your browser has opened.`
                      : 'Setting up the link with your wearable.'
                    : 'Switch the wearable on and keep it close to this computer.'
                : 'Demonstration mode. No Bluetooth is used and nothing comes from a physical device.'}
            </p>
          </div>
        </div>

        {problem && !calm ? (
          <div className="border-b border-rule px-5 py-4" role={device.problem ? 'alert' : 'status'}>
            {problem !== 'lost' ? <p className="text-[15px] font-bold leading-6 text-ink">{PROBLEM_COPY[problem].title}</p> : null}
            <p className={cx('text-[14.5px] leading-6 text-ink-soft', problem !== 'lost' && 'mt-0.5')}>{PROBLEM_COPY[problem].body}</p>
          </div>
        ) : null}

        <div className="divide-y divide-line-soft px-5">
          <Row label="Link">{hardware ? 'Bluetooth' : <SimulatedBadge>Simulated</SimulatedBadge>}</Row>
          <Row label="Current mode">{connected ? (device.mode ? MODE_LABEL[device.mode] : 'Checking') : 'Not available'}</Row>
          <Row label="Wearable">Fingertip sleeve and wristband</Row>
        </div>

        <div className="px-5 pb-5 pt-2">
          {connected ? (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                {assist === 'on' ? (
                  <Button variant="outline" size="md" onClick={device.pauseAssist}>
                    Pause Touch Assist
                  </Button>
                ) : (
                  <Button variant="primary" size="md" onClick={device.enableAssist} disabled={modeBusy}>
                    {modeBusy ? (
                      <>
                        <Spinner /> One moment
                      </>
                    ) : (
                      'Touch Assist on'
                    )}
                  </Button>
                )}
                <ButtonLink to="/patient/test" variant="outline" size="md">
                  Sensation test
                </ButtonLink>
              </div>
              <Button variant="ghost" size="md" block className="mt-1.5" onClick={device.disconnect}>
                {hardware ? 'Disconnect' : 'Disconnect demo device'}
              </Button>
            </>
          ) : blocked ? (
            <Button variant="primary" size="md" block onClick={() => device.chooseSource('simulation')}>
              Use demonstration mode
            </Button>
          ) : (
            <Button variant="primary" size="md" block onClick={device.connect} disabled={connecting}>
              {connecting ? (
                <>
                  <Spinner /> {device.words.connecting}
                </>
              ) : (
                device.words.connect
              )}
            </Button>
          )}
          {connecting && hardware ? (
            <Button variant="ghost" size="md" block className="mt-1.5" onClick={device.disconnect}>
              Cancel
            </Button>
          ) : null}
          {!connected && !connecting && !blocked ? (
            <p className="mt-3 text-[13.5px] leading-5 text-ink-soft">
              {hardware
                ? 'After connecting, the wearable reports its current mode. After a reconnect it is idle: turn Touch Assist back on, or start a test, when you are ready.'
                : 'After reconnecting, the wearable is idle. Turn Touch Assist back on, or start a test, when you are ready.'}
            </p>
          ) : null}
        </div>
      </Card>

      <section aria-labelledby="device-source" className="mt-6">
        <SectionHeading>
          <span id="device-source">Which device</span>
        </SectionHeading>
        <Card className="mt-2.5 px-5 py-4">
          <Segmented<DeviceSource>
            options={SOURCE_OPTIONS}
            value={device.source}
            onChange={device.chooseSource}
            label="Which device this app uses"
            block
          />
          <p className="mt-3 text-[13.5px] leading-5 text-ink-soft">
            {hardware
              ? 'Results come from the wearable itself. If the connection fails, the app stays in this mode and tells you: it never switches to the demonstration by itself.'
              : 'A built-in stand-in for the wearable, for showing the app without hardware. Its results are always marked as simulated.'}
          </p>
        </Card>
      </section>

      <section aria-labelledby="your-details" className="mt-6">
        <SectionHeading>
          <span id="your-details">Your details</span>
        </SectionHeading>
        <Card className="mt-2.5 divide-y divide-line-soft px-5">
          <Row label="Sleeve is worn on">{injurySite(patient)}</Row>
          <Row label="Surgery date">{formatDateFull(patient.repairDate)}</Row>
          <Link to="/onboarding?step=3" className="flex min-h-12 items-center justify-between gap-3 py-2 text-[14.5px] font-semibold text-ink">
            Change these details
            <ChevronRight className="size-4 text-wine-600" strokeWidth={2.2} aria-hidden="true" />
          </Link>
        </Card>
      </section>

      <section aria-labelledby="device-help" className="mt-6">
        <SectionHeading>
          <span id="device-help">If something isn’t working</span>
        </SectionHeading>
        <Card className="mt-2.5 divide-y divide-line-soft px-5 py-1">
          {hardware ? (
            <Explainer summary="My wearable isn’t in the list">
              <p>
                Check it is switched on and within a metre or two, and that Bluetooth is on for this computer. It appears as{' '}
                {LISTED_NAME}. If a phone or another app is already connected to it, disconnect that first: the wearable accepts
                one connection at a time.
              </p>
            </Explainer>
          ) : null}
          <Explainer summary={hardware ? 'The connection keeps dropping' : 'The app says “disconnected”'}>
            <p>
              {hardware ? 'Keep the wearable close to this computer and tap Reconnect above.' : 'Tap Reconnect above.'} With the
              current firmware the wearable goes idle whenever the connection drops, so Touch Assist stays off until you turn it
              back on. A test that was running is cancelled and is never resumed.
            </p>
          </Explainer>
          <Explainer summary="I can’t feel the feedback at my wrist">
            <p>
              Check that Touch Assist is on, that the band sits snugly on your wrist, and that the sleeve’s sensor pad is
              against the pad of your fingertip. A very light touch gives only an occasional tap.
            </p>
          </Explainer>
          <Explainer summary="The test won’t start">
            <p>
              The wearable has to be connected and has to confirm it is ready before a test begins. If it reports a problem,
              the app tells you and nothing is saved. Try again, or contact your care team if it keeps happening.
            </p>
          </Explainer>
          {hardware && device.connection === 'disconnected' ? (
            <Explainer summary="I want to connect a different wearable">
              <p>The app remembers the last wearable it connected to, so Reconnect goes straight back to it.</p>
              <Button variant="outline" size="md" className="mt-2.5" onClick={device.forgetDevice}>
                Choose from the list again
              </Button>
            </Explainer>
          ) : null}
        </Card>
      </section>

      <div className="mt-6 flex flex-col gap-2">
        <Link to="/onboarding" className="flex min-h-12 items-center justify-between rounded-[12px] bg-paper px-4 text-[14.5px] font-semibold text-ink">
          Replay the introduction
          <ChevronRight className="size-4 text-ink-faint" strokeWidth={2.2} aria-hidden="true" />
        </Link>
        <Link to="/demo" className="flex min-h-12 items-center justify-between rounded-[12px] bg-paper px-4 text-[14.5px] font-semibold text-ink">
          Demo controls and developer panel
          <ChevronRight className="size-4 text-ink-faint" strokeWidth={2.2} aria-hidden="true" />
        </Link>
      </div>

      <ConceptNote className="mt-5 text-center" />
    </Screen>
  );
}
