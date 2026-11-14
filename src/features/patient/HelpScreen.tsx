import { Link } from 'react-router-dom';
import {
  CaretRight,
  ChartLineUp,
  ClipboardText,
  Fingerprint,
  HandPalm,
  HandTap,
  GearSix,
  House,
  type Icon,
} from '@phosphor-icons/react';
import { useActivePatient } from '../../app/hooks';
import { HandIllustration } from '../../components/HandIllustration';
import { Card, Explainer } from '../../components/ui';
import { Screen, SectionHeading, TopBar } from './PatientShell';

const PLACES: { to: string; title: string; line: string; icon: Icon }[] = [
  { to: '/patient', title: 'Today', line: 'Your three things to do each day.', icon: House },
  { to: '/patient/test', title: 'Sensation test', line: 'The 30-second test with your wristband.', icon: Fingerprint },
  { to: '/patient/exercise', title: 'Physio', line: 'Your hand exercises, guided by your camera.', icon: HandPalm },
  { to: '/patient/check-in', title: 'Check-in', line: 'Pain, skin and a note. Weekly questions too.', icon: ClipboardText },
  { to: '/patient/progress', title: 'Recovery', line: 'Your results over time.', icon: ChartLineUp },
  { to: '/patient/assist', title: 'Touch Assist', line: 'Turn the wrist feedback on or off.', icon: HandTap },
  { to: '/patient/settings', title: 'Settings', line: 'Connect your wearable and change your details.', icon: GearSix },
];

/** One page that says where everything is and what to do when something goes wrong. */
export function HelpScreen() {
  const patient = useActivePatient();
  const fingerName = patient.finger === 'thumb' ? 'thumb' : `${patient.finger} finger`;

  return (
    <Screen header={<TopBar title="Help" hideHelp />}>
      <p className="-mt-1 text-[15.5px] leading-6 text-ink-soft">
        Everything in the app, in one list. The five buttons along the bottom are always there too.
      </p>

      <section aria-labelledby="help-places" className="mt-5">
        <SectionHeading>
          <span id="help-places">Where things are</span>
        </SectionHeading>
        <Card className="mt-2.5 divide-y divide-line-soft px-4">
          {PLACES.map((place) => (
            <Link key={place.to} to={place.to} className="flex min-h-[64px] items-center gap-3.5 py-2.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-navy-50 text-ink">
                <place.icon size={20} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] font-bold leading-5 text-ink">{place.title}</span>
                <span className="block text-[13.5px] leading-5 text-ink-soft">{place.line}</span>
              </span>
              <CaretRight size={16} weight="bold" className="shrink-0 text-ink-faint" aria-hidden="true" />
            </Link>
          ))}
        </Card>
      </section>

      <section aria-labelledby="help-test" className="mt-6">
        <SectionHeading>
          <span id="help-test">Doing the sensation test</span>
        </SectionHeading>
        <Card className="mt-2.5 overflow-hidden">
          <HandIllustration
            hand={patient.hand}
            finger={patient.finger}
            mode="test"
            active={false}
            className="mx-auto block h-[210px] w-auto pt-1"
            title={`A ${patient.hand} hand seen from above. The wristband is off the wrist and lying flat, and the tip of the ${fingerName} rests on the round disc on the band.`}
          />
          <ol className="space-y-2.5 border-t border-line-soft px-5 py-4 text-[15px] leading-[22px] text-ink">
            <li className="flex gap-3">
              <span className="nums w-4 shrink-0 font-bold text-teal-600">1</span>
              <span>Take the band off your wrist and lay it flat.</span>
            </li>
            <li className="flex gap-3">
              <span className="nums w-4 shrink-0 font-bold text-teal-600">2</span>
              <span>Rest the tip of your {fingerName} on the round disc.</span>
            </li>
            <li className="flex gap-3">
              <span className="nums w-4 shrink-0 font-bold text-teal-600">3</span>
              <span>Press Start, then tap “I Feel It” the moment you feel a buzz.</span>
            </li>
            <li className="flex gap-3">
              <span className="nums w-4 shrink-0 font-bold text-teal-600">4</span>
              <span>Put the band back on your wrist afterwards.</span>
            </li>
          </ol>
        </Card>
      </section>

      <section aria-labelledby="help-problems" className="mt-6">
        <SectionHeading>
          <span id="help-problems">If something isn’t working</span>
        </SectionHeading>
        <Card className="mt-2.5 divide-y divide-line-soft px-5 py-1">
          <Explainer summary="The app says the device isn’t connected">
            <p>
              Go to Settings and press Connect. After any reconnect the wearable is idle, so turn Touch Assist back on, or start
              a test, when you are ready. A test that was running when the connection dropped is cancelled and is never resumed.
            </p>
          </Explainer>
          <Explainer summary="I can’t feel the taps at my wrist">
            <p>
              Check Touch Assist is on, that the band sits snugly on your wrist with the disc against your skin, and that the
              sleeve’s sensor pad is against the pad of your fingertip. A very light touch gives only an occasional tap.
            </p>
          </Explainer>
          <Explainer summary="The test won’t start">
            <p>
              The wearable has to be connected and has to confirm it is ready. If it reports a problem, the app tells you and
              nothing is saved. Try again, or contact your care team if it keeps happening.
            </p>
          </Explainer>
          <Explainer summary="Physio can’t see my hand">
            <p>
              Hold your hand up with the palm facing the screen, about an arm’s length away, in good light. If the camera was
              blocked, allow it in your browser’s site settings.
            </p>
          </Explainer>
          <Explainer summary="Something hurts, or looks wrong">
            <p>
              Say so in today’s check-in, and contact your care team directly. This prototype does not send alerts to anyone.
            </p>
          </Explainer>
        </Card>
      </section>

      <section aria-labelledby="help-about" className="mt-6">
        <SectionHeading>
          <span id="help-about">About this app</span>
        </SectionHeading>
        <Card className="mt-2.5 divide-y divide-line-soft px-5">
          <p className="py-3.5 text-[14px] leading-[22px] text-ink-soft">
            A concept prototype with fictional data, not a medical device. Everything is kept in this browser only. Camera
            video never leaves your device.
          </p>
          {[
            { to: '/onboarding', label: 'Replay the introduction' },
            { to: '/clinician', label: 'Open the clinician dashboard' },
            { to: '/demo', label: 'Demo controls' },
          ].map((link) => (
            <Link key={link.to} to={link.to} className="flex min-h-12 items-center justify-between gap-3 py-2 text-[14.5px] font-semibold text-ink">
              {link.label}
              <CaretRight size={16} weight="bold" className="text-ink-faint" aria-hidden="true" />
            </Link>
          ))}
        </Card>
      </section>
    </Screen>
  );
}
