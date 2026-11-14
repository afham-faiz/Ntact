import { Link } from 'react-router-dom';
import { ChevronRight, Unplug, Watch } from 'lucide-react';
import { useDevice } from '../../app/DeviceContext';
import { useActivePatient } from '../../app/hooks';
import { Button, Card, ConceptNote, Explainer, IconChip, SimulatedBadge, Spinner, cx } from '../../components/ui';
import { formatDateFull } from '../../domain/dates';
import type { DeviceMode } from '../../domain/types';
import { injurySite } from '../clinician/parts';
import { Screen, SectionHeading, TopBar } from './PatientShell';

const MODE_LABEL: Record<DeviceMode, string> = {
  NORMAL: 'Touch Assist',
  REHAB: 'Sensation test',
  IDLE: 'Idle',
};

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
  const name = device.simulated ? 'Demo device' : device.label;

  return (
    <Screen header={<TopBar title="Device" />}>
      <Card className="overflow-hidden">
        <div className={cx('flex items-center gap-3.5 px-5 py-5', connected ? 'border-b border-rule bg-paper' : 'border-b border-rule bg-amber-50')}>
          <IconChip icon={connected ? Watch : Unplug} tone={connected ? 'teal' : 'amber'} size="lg" round className="bg-paper" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-bold leading-6 tracking-[-0.02em] text-ink" aria-live="polite">
              {name} {connecting ? 'connecting' : connected ? 'connected' : 'disconnected'}
            </h2>
            <p className="mt-0.5 text-[13.5px] leading-5 text-ink-soft">Simulated. No Bluetooth is used in this prototype.</p>
          </div>
        </div>
        <div className="divide-y divide-line-soft px-5">
          <Row label="Link">
            <SimulatedBadge>Simulated</SimulatedBadge>
          </Row>
          <Row label="Current mode">{connected ? (device.mode ? MODE_LABEL[device.mode] : 'Checking') : 'Not available'}</Row>
          <Row label="Wearable">Fingertip sleeve and wristband</Row>
        </div>
        <div className="px-5 pb-5 pt-2">
          {connected ? (
            <Button variant="outline" size="md" block onClick={device.disconnect}>
              Disconnect demo device
            </Button>
          ) : (
            <Button variant="primary" size="md" block onClick={device.connect} disabled={connecting}>
              {connecting ? (
                <>
                  <Spinner /> Reconnecting
                </>
              ) : (
                'Reconnect demo device'
              )}
            </Button>
          )}
          {!connected && !connecting ? (
            <p className="mt-3 text-[13.5px] leading-5 text-ink-soft">
              After reconnecting, the wearable is idle. Turn Touch Assist back on, or start a test, when you are ready.
            </p>
          ) : null}
        </div>
      </Card>

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
          <Explainer summary="The app says “disconnected”">
            <p>
              Tap Reconnect above. With the current firmware the wearable goes idle whenever the connection drops, so Touch
              Assist stays off until you turn it back on. A test that was running is cancelled and is never resumed.
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
        </Card>
      </section>


      <div className="mt-6 flex flex-col gap-2">
        <Link to="/onboarding" className="flex min-h-12 items-center justify-between rounded-[12px] bg-paper px-4 text-[14.5px] font-semibold text-ink">
          Replay the introduction
          <ChevronRight className="size-4 text-ink-faint" strokeWidth={2.2} aria-hidden="true" />
        </Link>
        <Link to="/demo" className="flex min-h-12 items-center justify-between rounded-[12px] bg-paper px-4 text-[14.5px] font-semibold text-ink">
          Demo controls
          <ChevronRight className="size-4 text-ink-faint" strokeWidth={2.2} aria-hidden="true" />
        </Link>
      </div>

      <ConceptNote className="mt-5 text-center" />
    </Screen>
  );
}
