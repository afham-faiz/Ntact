import { useMemo } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useDemoState, useToday } from '../../app/hooks';
import { cx } from '../../components/ui';
import { deriveFlags } from '../../domain/triage';

/**
 * Clinician portal frame: a navy sidebar for navigation and an off-white work
 * surface. Collapses to a top bar below 1024 px.
 */
export function ClinicianShell() {
  const state = useDemoState();
  const today = useToday();
  const pendingCount = useMemo(
    () => deriveFlags(state, today).filter((flag) => flag.status === 'pending').length,
    [state, today],
  );

  const items = [
    { to: '/clinician', label: 'Worklist', end: true, count: null as number | null },
    { to: '/clinician/reviews', label: 'Review flags', end: false, count: pendingCount },
    { to: '/clinician/rules', label: 'Provisional rules', end: false, count: null as number | null },
  ];

  return (
    <div className="min-h-dvh bg-floor text-[15px] leading-6 text-ink lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="on-dark flex flex-col bg-ink text-white lg:sticky lg:top-0 lg:h-dvh">
        <Link to="/clinician" className="block px-7 pb-2 pt-7" aria-label="Ntact clinician portal, worklist">
          <span className="block text-[19px] font-bold leading-6 tracking-[-0.03em]">Ntact</span>
          <span className="block text-[13px] leading-5 text-mist">Clinician portal</span>
        </Link>

        <nav aria-label="Clinician portal" className="px-4 py-4 lg:mt-4 lg:py-0">
          <ul className="flex gap-1 lg:flex-col">
            {items.map(({ to, label, end, count }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cx(
                      'flex min-h-11 items-center justify-between gap-3 whitespace-nowrap rounded-[10px] px-3 text-[14.5px]',
                      isActive ? 'bg-white/10 font-bold text-white shadow-[inset_3px_0_0_0_#b93349]' : 'font-medium text-mist hover:bg-white/5 hover:text-white',
                    )
                  }
                >
                  {label}
                  {count !== null && count > 0 ? <span className="nums text-[13px] font-semibold text-mint">{count}</span> : null}
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
                  className="flex min-h-11 items-center justify-between gap-3 whitespace-nowrap rounded-[10px] px-3 text-[14.5px] font-medium text-mist hover:bg-white/5 hover:text-white"
                >
                  {link.label}
                  <span aria-hidden="true">›</span>
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
        <div className="mx-auto w-full max-w-[1360px] flex-1 px-6 lg:px-10">
          <Outlet />
        </div>
        <footer className="mx-auto flex w-full max-w-[1360px] flex-wrap justify-between gap-x-8 gap-y-1 px-6 py-6 text-[13px] leading-5 text-ink-soft lg:px-10">
          <span>Interactive concept. Demonstration data, not a medical device.</span>
          <span>Actions are saved in this browser only. Nothing is sent anywhere.</span>
        </footer>
      </div>
    </div>
  );
}
