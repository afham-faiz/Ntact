import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDevice } from '../../app/DeviceContext';
import { useDemoState, useToday } from '../../app/hooks';
import { useToast } from '../../components/Toast';
import { Button, Panel, Segmented, cx } from '../../components/ui';
import type { DeviceSource } from '../../devices/source';
import { HISTORY_PRESET_LABEL, type HistoryPreset } from '../../demo/seed';
import { demoStore, seedAgeDays } from '../../demo/store';
import { formatTime } from '../../domain/dates';
import { BLE_PROFILE, REHAB_LEVELS } from '../../domain/firmware';
import { LEVEL_LABEL, triageSummaries } from '../../domain/triage';
import type { RehabLevel } from '../../domain/types';
import { PROBLEM_COPY, linkHeadline } from '../patient/deviceCopy';

const SCENES = [
  { title: 'Touch Assist', to: '/patient/assist', text: 'Pressure at a numb fingertip becomes feedback at the wrist. Pause and enable the mode.' },
  { title: 'Blinded daily test', to: '/patient/test', text: 'Start the test. The screen never shows the level. Tap “I Feel It” after a few seconds.' },
  { title: 'Recovery curve', to: '/patient/progress', text: 'The new point is on the curve. Gaps and not-felt days stay honest.' },
  { title: 'Guided exercise', to: '/patient/exercise', text: 'The camera follows the fingers, counts repetitions and coaches in real time. Use the demonstration hand if there is no camera.' },
  { title: 'Daily check-in', to: '/patient/check-in', text: 'Four quick answers. Report a new skin issue to see it reach the clinician.' },
  { title: 'Clinician triage', to: '/clinician', text: 'The worklist is ordered by review status. Open a record, read why it is flagged, record a review.' },
];

function Group({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <Panel className="px-6 py-5">
      <h3 className="text-[16px] font-bold leading-6 tracking-[-0.02em] text-ink">{title}</h3>
      {note ? <p className="mt-0.5 text-[13px] leading-5 text-ink-soft">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </Panel>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange(value: boolean): void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1.5 text-[14px] leading-[22px] text-ink">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 size-4 accent-[#14213D]" />
      <span>{children}</span>
    </label>
  );
}

const SOURCE_OPTIONS: { value: DeviceSource; label: string }[] = [
  { value: 'hardware', label: 'Physical device' },
  { value: 'simulation', label: 'Demonstration' },
];

const selectClass = 'h-10 rounded-[10px] border border-rule bg-paper px-3 text-[14px] font-semibold text-ink hover:border-ink/30';

/** Clearly separate from the product: launchers, a guided demo and every simulation control. */
export function DemoPage() {
  const state = useDemoState();
  const today = useToday();
  const device = useDevice();
  const toast = useToast();
  const [logLevel, setLogLevel] = useState<RehabLevel>(4);

  const patient = state.patients.find((item) => item.id === state.activePatientId) ?? state.patients[0];
  const level = triageSummaries(state, today).get(patient.id)?.level ?? 'GREEN';
  const scenario = state.scenario;
  const scripted = scenario.result.kind === 'scripted' ? scenario.result.level : null;
  const age = seedAgeDays(state);
  const done = (message: string) => toast.show(message);
  const hardware = !device.simulated;
  const blocked = hardware && !device.bluetooth.supported ? device.bluetooth.reason : null;
  const linkProblem = hardware ? (device.problem ?? blocked) : null;

  return (
    <div className="ground-wide min-h-dvh text-ink">
      <header className="on-dark surface-test text-white">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-baseline justify-between gap-4 px-6 py-5 lg:px-10">
          <span className="text-[19px] font-bold tracking-[-0.03em]">Ntact</span>
          <span className="text-[13.5px] text-mist">Demo controls. Not part of the product.</span>
        </div>
      </header>

      <main className="mx-auto max-w-[1240px] px-6 pb-16 lg:px-10">
        <div className="pb-8 pt-10">
          <h1 className="serif max-w-[22ch] text-[40px] leading-[1.1] text-ink">
            A working prototype of the <span className="underline decoration-mint decoration-[3px] underline-offset-[10px] [text-decoration-skip-ink:none]">patient app</span> and clinician portal.
          </h1>
          <p className="mt-5 max-w-[70ch] text-[16px] leading-7 text-ink-soft">
            Ntact uses wearable feedback to help people with fingertip sensory loss perceive touch and track changes in
            sensation while they recover. It runs as a demonstration unless you choose the physical wearable below. There is
            no server and no real patient data.
          </p>
        </div>

        {/* Launchers */}
        <div className="grid gap-6 md:grid-cols-2">
          <Panel className="flex flex-col px-6 py-6">
            <h2 className="serif text-[24px] leading-8 text-ink">Patient app</h2>
            <p className="mt-1 text-[14.5px] leading-6 text-ink-soft">Mobile first. Shown as {patient.name}, a fictional person.</p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link to="/patient" className="btn-primary inline-flex min-h-12 items-center rounded-[12px] px-5 text-[15px] font-semibold text-white">
                View patient app
              </Link>
              <Link to="/onboarding" className="inline-flex min-h-12 items-center rounded-[12px] border border-ink/30 px-5 text-[15px] font-semibold text-ink hover:border-ink">
                Start with the introduction
              </Link>
            </div>
          </Panel>
          <Panel className="flex flex-col px-6 py-6">
            <h2 className="serif text-[24px] leading-8 text-ink">Clinician portal</h2>
            <p className="mt-1 text-[14.5px] leading-6 text-ink-soft">Desktop first. Triage worklist, clinical records, review flags and the provisional rules.</p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link to="/clinician" className="btn-primary inline-flex min-h-12 items-center rounded-[12px] px-5 text-[15px] font-semibold text-white">
                View clinician portal
              </Link>
              <Link to={`/clinician/patients/${patient.id}`} className="inline-flex min-h-12 items-center rounded-[12px] border border-ink/30 px-5 text-[15px] font-semibold text-ink hover:border-ink">
                Open {patient.firstName}’s record
              </Link>
            </div>
          </Panel>
        </div>

        {/* Guided demo */}
        <section className="mt-12">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
            <div>
              <h2 className="serif text-[28px] leading-9 text-ink">Six-scene judge demo</h2>
              <p className="mt-1 text-[14.5px] leading-6 text-ink-soft">Load the preset first: it resets the data and makes the next test report level 4, after yesterday’s level 5.</p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                demoStore.reset('judge-demo');
                done('Judge-demo preset loaded.');
              }}
            >
              Load judge-demo preset
            </Button>
          </div>
          <ol className="divide-y divide-rule">
            {SCENES.map((scene, index) => (
              <li key={scene.to} className="grid items-baseline gap-x-8 gap-y-1 py-4 md:grid-cols-[40px_220px_minmax(0,1fr)_auto]">
                <span className="serif nums text-[24px] leading-8 text-teal-600">{index + 1}</span>
                <span className="text-[16px] font-bold leading-6 text-ink">{scene.title}</span>
                <span className="text-[14.5px] leading-6 text-ink-soft">{scene.text}</span>
                <Link to={scene.to} className="text-[14.5px] font-semibold text-ink underline decoration-mint decoration-2 underline-offset-4">
                  Open
                </Link>
              </li>
            ))}
          </ol>
        </section>

        {/* Simulation controls */}
        <section className="mt-12">
          <h2 className="serif border-b border-rule pb-4 text-[28px] leading-9 text-ink">Simulation controls</h2>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Group
              title="Which device"
              note="A deliberate choice, kept for this tab. A failed Bluetooth connection never switches to the demonstration by itself."
            >
              <div className="flex flex-wrap items-center gap-3">
                <Segmented<DeviceSource>
                  options={SOURCE_OPTIONS}
                  value={device.source}
                  onChange={device.chooseSource}
                  label="Which device this app uses"
                  size="sm"
                />
                <span className="text-[14px] font-semibold text-ink" aria-live="polite">
                  {linkHeadline(device)}
                  {device.connection === 'connected' && device.mode ? `, mode ${device.mode}` : ''}
                </span>
              </div>
              {hardware ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-2.5">
                    {device.connection === 'connected' ? (
                      <Button variant="outline" size="sm" onClick={device.disconnect}>
                        Disconnect
                      </Button>
                    ) : (
                      <Button variant="primary" size="sm" onClick={device.connect} disabled={device.connection === 'connecting' || blocked !== null}>
                        {device.connection === 'connecting' ? device.words.connecting : device.words.connect}
                      </Button>
                    )}
                    {device.connection === 'connecting' ? (
                      <Button variant="outline" size="sm" onClick={device.disconnect}>
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                  {linkProblem && device.connection === 'disconnected' ? (
                    <p className="mt-3 text-[13.5px] leading-5 text-ink" role="status">
                      <span className="font-bold">{PROBLEM_COPY[linkProblem].title}</span>
                      {linkProblem === 'lost' ? ' ' : '. '}
                      {PROBLEM_COPY[linkProblem].body}
                    </p>
                  ) : null}
                  <p className="mt-3 text-[12.5px] leading-5 text-ink-soft">
                    Needs Chrome or Edge on Windows or Android, on an https:// address or localhost. The wearable appears in the
                    browser’s list as {BLE_PROFILE.advertisedName}. The link belongs to this tab; results it reports are saved as
                    “Wearable” in the clinician record. Not yet verified against a physical board: see HARDWARE_INTEGRATION.md.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-[12.5px] leading-5 text-ink-soft">
                  A built-in stand-in for the wearable. Everything it produces is saved and labelled as demonstration data.
                </p>
              )}
            </Group>

            <Group title="Fictional patient" note="Who the patient app is shown as.">
              <div className="flex flex-wrap items-center gap-3">
                <select value={patient.id} onChange={(event) => demoStore.setActivePatient(event.target.value)} className={selectClass} aria-label="Active fictional patient">
                  {state.patients.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.demoId})
                    </option>
                  ))}
                </select>
                <span className={cx('text-[14px] font-semibold', level === 'RED' ? 'text-teal-600' : level === 'AMBER' ? 'text-amber-700' : 'text-ink-soft')}>
                  {LEVEL_LABEL[level]}
                </span>
              </div>
            </Group>

            <Group title="Simulated device" note="Always labelled “Demo device” in the app. Disconnecting cancels a running test and is never auto-resumed.">
              {hardware ? (
                <p className="text-[14px] leading-[22px] text-ink">
                  These controls act on the demonstration device only. Choose Demonstration above to use them.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[14px] font-semibold text-ink">
                    {device.connection === 'connected' ? 'Connected' : device.connection === 'connecting' ? 'Connecting' : 'Disconnected'}
                    {device.mode ? `, mode ${device.mode}` : ''}
                  </span>
                  {device.connection === 'connected' ? (
                    <Button variant="outline" size="sm" onClick={device.disconnect}>
                      Disconnect now
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={device.connect} disabled={device.connection === 'connecting'}>
                      Reconnect
                    </Button>
                  )}
                </div>
              )}
              <div className="mt-3">
                <Check checked={scenario.dropLinkOnNextTest} onChange={(value) => demoStore.setScenario({ dropLinkOnNextTest: value })}>
                  Drop the connection 4 seconds into the next test (one time)
                </Check>
                <Check checked={scenario.driverFault} onChange={(value) => demoStore.setScenario({ driverFault: value })}>
                  Answer START with <span className="font-mono text-[12.5px]">ERR,DRIVER</span> until switched off
                </Check>
              </div>
            </Group>

            <Group
              title="Next test"
              note={
                hardware
                  ? 'Demonstration only. With the physical wearable connected, the firmware alone decides the result.'
                  : 'Timed follows the firmware: the result is the level active when “I Feel It” is tapped.'
              }
            >
              <div className="flex flex-wrap items-center gap-3">
                <Segmented<'timed' | 'scripted'>
                  options={[
                    { value: 'timed', label: 'Timed' },
                    { value: 'scripted', label: 'Scripted level' },
                  ]}
                  value={scripted === null ? 'timed' : 'scripted'}
                  onChange={(value) => demoStore.setScenario({ result: value === 'timed' ? { kind: 'timed' } : { kind: 'scripted', level: scripted ?? 4 } })}
                  label="How the next result is decided"
                  size="sm"
                />
                {scripted !== null ? (
                  <select
                    value={scripted}
                    onChange={(event) => demoStore.setScenario({ result: { kind: 'scripted', level: Number(event.target.value) as RehabLevel } })}
                    className={selectClass}
                    aria-label="Scripted level"
                  >
                    {REHAB_LEVELS.map((step) => (
                      <option key={step} value={step}>
                        Level {step}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="text-[13.5px] text-ink-soft">Speed</span>
                <Segmented<'1' | '6'>
                  options={[
                    { value: '1', label: 'Firmware timing, 31 s' },
                    { value: '6', label: 'Fast preview, ×6' },
                  ]}
                  value={String(scenario.speed) as '1' | '6'}
                  onChange={(value) => demoStore.setScenario({ speed: value === '6' ? 6 : 1 })}
                  label="Test speed"
                  size="sm"
                />
              </div>
              <p className="mt-2 text-[12.5px] leading-5 text-ink-soft">Fast preview is for rehearsals only. To see “not felt”, start a test and don’t tap.</p>
            </Group>

            <Group title="Log a result for today" note="Adds a demonstration record without running the test. Never labelled as coming from the wearable.">
              <div className="flex flex-wrap items-center gap-2.5">
                <select value={logLevel} onChange={(event) => setLogLevel(Number(event.target.value) as RehabLevel)} className={selectClass} aria-label="Level to log">
                  {REHAB_LEVELS.map((step) => (
                    <option key={step} value={step}>
                      Level {step}
                    </option>
                  ))}
                </select>
                <Button variant="outline" size="sm" onClick={() => { demoStore.logScriptedResult(patient.id, { kind: 'FELT', level: logLevel }); done(`Felt at level ${logLevel} logged.`); }}>
                  Felt
                </Button>
                <Button variant="outline" size="sm" onClick={() => { demoStore.logScriptedResult(patient.id, { kind: 'NO_FELT' }); done('Not-felt test logged.'); }}>
                  Not felt
                </Button>
                <Button variant="outline" size="sm" onClick={() => { demoStore.logScriptedResult(patient.id, { kind: 'STOPPED' }); done('Cancelled test logged.'); }}>
                  Cancelled
                </Button>
              </div>
            </Group>

            <Group title="Recovery history" note={`Replaces ${patient.firstName}’s test history with a pattern ending yesterday.`}>
              <ul className="divide-y divide-rule/70">
                {(Object.keys(HISTORY_PRESET_LABEL) as HistoryPreset[]).map((preset) => (
                  <li key={preset} className="flex items-center justify-between gap-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-[14.5px] font-semibold leading-5 text-ink">{HISTORY_PRESET_LABEL[preset].title}</span>
                      <span className="block text-[13px] leading-5 text-ink-soft">{HISTORY_PRESET_LABEL[preset].detail}</span>
                    </span>
                    <Button variant="outline" size="sm" onClick={() => { demoStore.applyHistoryPreset(patient.id, preset); done('History replaced.'); }}>
                      Apply
                    </Button>
                  </li>
                ))}
              </ul>
            </Group>

            <Group title="Trigger a provisional review flag" note={`Changes ${patient.firstName}’s records so that one rule is met.`}>
              <div className="flex flex-wrap gap-2.5">
                <Button variant="outline" size="sm" onClick={() => { demoStore.simulateMissedTests(patient.id, 3); done('Last three days of tests removed.'); }}>
                  Three missed tests
                </Button>
                <Button variant="outline" size="sm" onClick={() => { demoStore.simulateRisingReadings(patient.id); done('Rising readings written.'); }}>
                  Two rising readings
                </Button>
                <Button variant="outline" size="sm" onClick={() => { demoStore.simulateCheckInTrigger(patient.id, 'skin'); done('Skin-issue check-in saved.'); }}>
                  Skin issue check-in
                </Button>
                <Button variant="outline" size="sm" onClick={() => { demoStore.simulateCheckInTrigger(patient.id, 'pain'); done('Pain-increase check-in saved.'); }}>
                  Pain increase check-in
                </Button>
                <Button variant="outline" size="sm" onClick={() => { demoStore.applyHistoryPreset(patient.id, 'plateau'); done('Flat history applied.'); }}>
                  Flat for five weeks
                </Button>
                <Button variant="outline" size="sm" onClick={() => { demoStore.simulateMissedExercises(patient.id, 3); done('Last three days of exercises removed.'); }}>
                  Three missed exercise days
                </Button>
                <Button variant="outline" size="sm" onClick={() => { demoStore.simulateMovementDecline(patient.id); done('Falling movement written.'); }}>
                  Finger movement falling
                </Button>
              </div>
            </Group>

            <Group title="Reset" note={age > 0 ? `The example data was generated ${age} ${age === 1 ? 'day' : 'days'} ago. Resetting re-anchors it on today.` : 'Example data is anchored on today.'}>
              <div className="flex flex-wrap gap-2.5">
                <Button variant="outline" size="sm" onClick={() => { demoStore.reset('default'); done('Example data reset.'); }}>
                  Reset example data
                </Button>
                <Button variant="outline" size="sm" onClick={() => { demoStore.reset('judge-demo'); done('Judge-demo preset loaded.'); }}>
                  Load judge-demo preset
                </Button>
              </div>
            </Group>

            <Group title="Where the data lives" note="No server, no account.">
              <p className="text-[14px] leading-[22px] text-ink">
                Everything is kept in this browser’s local storage. Tabs of the same browser stay in step. A phone and a laptop
                do <span className="font-bold">not</span> share data: a test done on one will not appear on the other.
              </p>
            </Group>
          </div>
        </section>

        {/* Developer panel */}
        <section className="mt-12" id="developer-panel">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
            <div>
              <h2 className="serif text-[28px] leading-9 text-ink">Developer panel</h2>
              <p className="mt-1 max-w-[80ch] text-[14.5px] leading-6 text-ink-soft">
                Every command, notification and connection event, newest first. “BLE” lines crossed the Bluetooth link to the
                physical wearable; “demo” lines are the built-in demonstration. The patient screens never show these.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => demoStore.clearDeviceLog()}>
              Clear log
            </Button>
          </div>
          <div className="on-dark quiet-scroll mt-5 max-h-[300px] overflow-y-auto rounded-[14px] bg-ink px-5 py-4 font-mono text-[13px] leading-6 text-mist">
            {state.deviceLog.length === 0 ? (
              <p>No messages yet. Open the patient app or run a test.</p>
            ) : (
              <ul>
                {[...state.deviceLog].reverse().map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="flex gap-4">
                    <span className="text-mist/60">{formatTime(entry.at)}</span>
                    <span className="w-10 shrink-0 text-mist/60">{entry.via === 'ble' ? 'BLE' : 'demo'}</span>
                    <span className="w-16 shrink-0">{entry.direction === 'app' ? 'app →' : entry.direction === 'device' ? '← device' : 'link'}</span>
                    <span className={entry.direction === 'device' ? 'text-mint' : 'text-white'}>{entry.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <dl className="mt-4 grid gap-x-8 gap-y-1 font-mono text-[12.5px] leading-6 text-ink-soft sm:grid-cols-[max-content_minmax(0,1fr)]">
          <dt>Expected device name</dt>
          <dd>{BLE_PROFILE.advertisedName}{hardware && device.connection === 'connected' ? ` (connected: ${device.label})` : ''}</dd>
          <dt>Service</dt>
          <dd>{BLE_PROFILE.serviceUuid}</dd>
          <dt>RX, app to device</dt>
          <dd>{BLE_PROFILE.rxWriteUuid} · write with response</dd>
          <dt>TX, device to app</dt>
          <dd>{BLE_PROFILE.txNotifyUuid} · notify</dd>
        </dl>

        <p className="mt-12 text-[13.5px] leading-6 text-ink-soft">
          Interactive concept. Demonstration data, not a medical device. Concept prototype • Fictional data
        </p>
      </main>
    </div>
  );
}
