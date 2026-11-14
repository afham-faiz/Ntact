import { useMemo } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { CaretRight, Flag, ListChecks, Question, SlidersHorizontal, type Icon } from '@phosphor-icons/react';
import { useDemoState, useToday } from '../../app/hooks';
import { cx } from '../../components/ui';
import { deriveFlags } from '../../domain/triage';

/**
 * Clinician dashboard frame: a navy sidebar with four destinations, and a light,
 * softly lit work surface. Collapses to a top bar below 1024 px.
 */
export function ClinicianShell() {
  const state = useDemoState();
  const today = useToday();
  const pendingCount = useMemo(
    () => deriveFlags(state, today).filter((flag) => flag.status === 'pending').length,
    [state, today],
  );

  const items: { to: string; label: string; end: boolean; count: number | null; icon: Icon }[] = [
    { to: '/clinician', label: 'Patients', end: true, count: null, icon: ListChecks },
    { to: '/clinician/reviews', label: 'Flags to review', end: false, count: pendingCount, icon: Flag },
    { to: '/clinician/rules', label: 'Rules', end: false, count: null, icon: SlidersHorizontal },
    { to: '/clinician/help', label: 'Help', end: false, count: null, icon: Question },
  ];

  return (
    <div className="ground-wide min-h-dvh text-[15px] leading-6 text-ink lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="on-dark surface-test flex flex-col text-white lg:sticky lg:top-0 lg:h-dvh">
        <Link to="/clinician" className="block px-7 pb-2 pt-7" aria-label="Ntact clinician dashboard, patients">
          <span className="block text-[20px] font-bold leading-6 tracking-[-0.03em]">Ntact</span>
          <span className="block text-[13px] leading-5 text-mist">Clinician dashboard</span>
        </Link>

        <nav aria-label="Clinician dashboard" className="px-4 py-4 lg:mt-4 lg:py-0">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {items.map(({ to, label, end, count, icon: ItemIcon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cx(
                      'flex min-h-12 items-center gap-3 whitespace-nowrap rounded-[14px] px-3 text-[14.5px] transition-colors duration-150',
                      isActive ? 'glass-dark font-bold text-white' : 'font-medium text-mist hover:bg-white/5 hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <ItemIcon size={20} weight={isActive ? 'fill' : 'regular'} className={isActive ? 'text-mint' : undefined} aria-hidden="true" />
                      <span className="flex-1">{label}</span>
                      {count !== null && count > 0 ? (
                        <span className="nums rounded-full bg-mint px-2 py-0.5 text-[12px] font-bold leading-4 text-ink">{count}</span>
                      ) : null}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
          <p className="mt-6 hidden px-3 text-[12.5px] leading-5 text-mist lg:block">Switch view</p>
          <ul className="mt-1 flex gap-1 lg:flex-col">
            {[
              { to: '/patient', label: 'Patient app' },
              { to: '/demo', label: 'Demo controls' },
            ].map((link) => (
              <li key={link.to}>
                <Link
                  to={link.to}
                  className="flex min-h-11 items-center justify-between gap-3 whitespace-nowrap rounded-[14px] px-3 text-[14.5px] font-medium text-mist hover:bg-white/5 hover:text-white"
                >
                  {link.label}
                  <CaretRight size={14} weight="bold" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-auto hidden px-7 pb-7 text-[13px] leading-5 text-mist lg:block">
          <p className="font-semibold text-white">Demo clinician</p>
          <p>Hand therapy clinic (fictional)</p>
          <p className="mt-5">Concept prototype • Fictional data</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="mx-auto w-full max-w-[1280px] flex-1 px-6 lg:px-10">
          <Outlet />
        </div>
        <footer className="mx-auto flex w-full max-w-[1280px] flex-wrap justify-between gap-x-8 gap-y-1 px-6 py-6 text-[13px] leading-5 text-ink-soft lg:px-10">
          <span>Interactive concept. Demonstration data, not a medical device.</span>
          <span>Actions are saved in this browser only. Nothing is sent anywhere.</span>
        </footer>
      </div>
    </div>
  );
}
