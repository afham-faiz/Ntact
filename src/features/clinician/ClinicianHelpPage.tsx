import { Link } from 'react-router-dom';
import { CaretRight, Flag, ListChecks, SlidersHorizontal, UserCircle, type Icon } from '@phosphor-icons/react';
import { Panel } from '../../components/ui';
import { LEVEL_LABEL, ROUTE_LABEL, ROUTE_REASON } from '../../domain/triage';
import type { CareRoute, TriageLevel } from '../../domain/types';

const MARK_CLASS: Record<TriageLevel, string> = { RED: 'bg-wine-600', AMBER: 'bg-amber-400', GREEN: 'bg-green-500' };

const PLACES: { to: string; title: string; line: string; icon: Icon }[] = [
  { to: '/clinician', title: 'Patients', line: 'Everyone on the list, most urgent first. Click a row to open the record.', icon: ListChecks },
  { to: '/clinician/reviews', title: 'Flags to review', line: 'Every open flag in one place. Record a review, or reopen one.', icon: Flag },
  { to: '/clinician/rules', title: 'Rules', line: 'The plain conditions behind each flag, and their thresholds.', icon: SlidersHorizontal },
];

const LEVELS: { level: TriageLevel; meaning: string }[] = [
  { level: 'RED', meaning: 'A new skin problem, or severe or sharply rising pain. Look today.' },
  { level: 'AMBER', meaning: 'Sensation flat or worsening, missed tests or exercises, or movement falling.' },
  { level: 'GREEN', meaning: 'No rule is met. Can be considered for patient-initiated follow-up.' },
];

const ROUTES: CareRoute[] = ['same-day', 'surgeon', 'therapist'];

const RECORD_TABS = [
  { title: 'Overview', line: 'Why the record is flagged, the recovery curve, your notes and the clinical set-up.' },
  { title: 'Test results', line: 'Every sensation test, the illustrative return window and adherence.' },
  { title: 'Movement and check-ins', line: 'Camera-estimated finger movement, the exercise plan, daily check-ins and weekly questions.' },
];

/** Where everything is in the dashboard, and what the colours and labels mean. */
export function ClinicianHelpPage() {
  return (
    <div className="pb-6">
      <div className="pb-7 pt-9">
        <h1 className="serif text-[34px] leading-10 text-ink">Help</h1>
        <p className="mt-1 max-w-[70ch] text-[14.5px] leading-6 text-ink-soft">
          Where things are, and what the colours mean. The menu on the left is the same on every page.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel className="px-6 py-5">
          <h2 className="text-[17px] font-bold leading-6 tracking-[-0.02em] text-ink">Where things are</h2>
          <ul className="mt-2 divide-y divide-rule/70">
            {PLACES.map((place) => (
              <li key={place.to}>
                <Link to={place.to} className="flex min-h-[64px] items-center gap-3.5 py-2.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-navy-50 text-ink">
                    <place.icon size={20} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold leading-5 text-ink">{place.title}</span>
                    <span className="block text-[13.5px] leading-5 text-ink-soft">{place.line}</span>
                  </span>
                  <CaretRight size={16} weight="bold" className="shrink-0 text-ink-faint" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="px-6 py-5">
          <h2 className="text-[17px] font-bold leading-6 tracking-[-0.02em] text-ink">What the colours mean</h2>
          <ul className="mt-2 divide-y divide-rule/70">
            {LEVELS.map(({ level, meaning }) => (
              <li key={level} className="flex items-start gap-3 py-3">
                <span className={`mt-1.5 size-2.5 shrink-0 rounded-[2px] ${MARK_CLASS[level]}`} aria-hidden="true" />
                <span>
                  <span className="block text-[15px] font-bold leading-5 text-ink">{LEVEL_LABEL[level]}</span>
                  <span className="block text-[13.5px] leading-5 text-ink-soft">{meaning}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] leading-5 text-ink-soft">
            These come from plain, provisional rules, not a score. Green never means “recovering normally”.
          </p>
        </Panel>

        <Panel className="px-6 py-5">
          <h2 className="flex items-center gap-2.5 text-[17px] font-bold leading-6 tracking-[-0.02em] text-ink">
            <UserCircle size={21} aria-hidden="true" />
            Inside a patient record
          </h2>
          <ul className="mt-2 divide-y divide-rule/70">
            {RECORD_TABS.map((tab) => (
              <li key={tab.title} className="py-3">
                <span className="block text-[15px] font-bold leading-5 text-ink">{tab.title}</span>
                <span className="block text-[13.5px] leading-5 text-ink-soft">{tab.line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] leading-5 text-ink-soft">
            The buttons at the top of a record add a note, mark it for review, or record a review. Only you unlock an
            exercise or move a patient to patient-initiated follow-up.
          </p>
        </Panel>

        <Panel className="px-6 py-5">
          <h2 className="text-[17px] font-bold leading-6 tracking-[-0.02em] text-ink">Who each flag goes to</h2>
          <ul className="mt-2 divide-y divide-rule/70">
            {ROUTES.map((route) => (
              <li key={route} className="py-3">
                <span className="block text-[15px] font-bold leading-5 text-ink">{ROUTE_LABEL[route]}</span>
                <span className="block text-[13.5px] leading-5 text-ink-soft">{ROUTE_REASON[route]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] leading-5 text-ink-soft">
            Nothing is actually sent. Data lives in this browser only, so a patient’s tests appear here only when the patient
            app is used in the same browser.
          </p>
        </Panel>
      </div>
    </div>
  );
}
