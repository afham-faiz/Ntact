import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CaretLeft, ChartLineUp, Fingerprint, GearSix, HandPalm, House, Question } from '@phosphor-icons/react';
import { Unplug } from 'lucide-react';
import { useDevice } from '../../app/DeviceContext';
import { TestSessionProvider, useTestSession } from '../../app/TestSessionContext';
import { useActivePatient } from '../../app/hooks';
import { Modal } from '../../components/Modal';
import { ConceptNote, Spinner, cx } from '../../components/ui';
import { Wordmark } from '../../components/Wordmark';
import { isActivePhase } from '../../domain/testSession';
import { linkSummary } from './deviceCopy';

function useImmersive(): boolean {
  const { phase } = useTestSession();
  const location = useLocation();
  // A guided exercise or a movement assessment fills the screen: the camera picture needs the room.
  if (/^\/patient\/(exercise|movement)\/[^/]+\/live/.test(location.pathname)) return true;
  // While a test is running the chrome goes away: nothing should be easy to hit by accident.
  return location.pathname.startsWith('/patient/test') && isActivePhase(phase) && phase.name !== 'arming';
}

/** Phone status bar. Part of the desktop mock-up only; a real phone draws its own. */
function StatusBar({ dark }: { dark: boolean }) {
  const colour = dark ? 'text-white' : 'text-ink';
  return (
    <div className={cx('relative hidden h-[46px] shrink-0 items-center justify-between px-8 pt-1.5 frame:flex', colour)} aria-hidden="true">
      <span className="text-[15px] font-bold tracking-[-0.01em]">9:41</span>
      <span className="absolute left-1/2 top-[9px] h-[29px] w-[104px] -translate-x-1/2 rounded-full bg-black" />
      <span className="flex items-center gap-1.5">
        <svg viewBox="0 0 18 12" className="h-3 w-[18px]" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="0.8" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="0.8" />
          <rect x="10" y="3" width="3" height="9" rx="0.8" />
          <rect x="15" y="0" width="3" height="12" rx="0.8" />
        </svg>
        <svg viewBox="0 0 16 12" className="h-3 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M1.5 4.5a9.5 9.5 0 0 1 13 0" />
          <path d="M4 7.3a6 6 0 0 1 8 0" />
          <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" />
        </svg>
        <svg viewBox="0 0 27 12" className="h-3 w-[27px]" fill="none">
          <rect x="0.6" y="0.6" width="22.8" height="10.8" rx="3.4" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.2" />
          <rect x="2.2" y="2.2" width="16" height="7.6" rx="2" fill="currentColor" />
          <path d="M25 4v4" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  );
}

function PhoneScreen() {
  const location = useLocation();
  // A movement assessment sits on the app's light ground, with a dark camera picture; the other full-screen sessions are navy.
  const light = /^\/patient\/movement\/[^/]+\/live/.test(location.pathname);
  const immersive = useImmersive() && !light;
  // The home screen opens on a navy masthead, so the top of the phone is navy there.
  const home = location.pathname === '/patient' || location.pathname === '/patient/';
  return (
    <div
      className={cx(
        'relative flex min-h-dvh w-full flex-col frame:h-full frame:min-h-0 frame:overflow-hidden frame:rounded-[46px]',
        light ? 'ground' : immersive ? 'surface-test' : home ? 'ground-home' : 'ground',
      )}
    >
      <StatusBar dark={immersive || home} />
      <Outlet />
      <span
        className={cx(
          'pointer-events-none absolute bottom-[7px] left-1/2 hidden h-[5px] w-[130px] -translate-x-1/2 rounded-full frame:block',
          immersive ? 'bg-white/60' : 'bg-ink/80',
        )}
        aria-hidden="true"
      />
    </div>
  );
}

/**
 * Phone-sized stage for the patient app.
 * Below 640 px it fills the screen. Above that it sits in a phone mock-up, with
 * the demo affordances kept outside it so they are never mistaken for product UI.
 */
/** Where each screen was scrolled to, kept until the site is reloaded. */
const scrollMemory = new Map<string, number>();

/**
 * Going back to a screen returns you to where you were on it. Pressing a tab in
 * the bottom bar starts that screen from the top instead (see BottomNav).
 */
function ScrollMemory() {
  const { pathname } = useLocation();
  useEffect(() => {
    const saved = scrollMemory.get(pathname) ?? 0;
    const frame = requestAnimationFrame(() => window.scrollTo(0, saved));
    const onScroll = () => scrollMemory.set(pathname, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [pathname]);
  return null;
}

export function PatientFrame() {
  const patient = useActivePatient();
  const device = useDevice();
  return (
    <TestSessionProvider>
      <ScrollMemory />
      <div className="ground-wide min-h-dvh frame:grid frame:place-items-center frame:px-6 frame:py-5 lg:grid-cols-[1fr_auto_1fr] lg:gap-14">
        <aside className="hidden max-w-[260px] justify-self-end lg:block">
          <Wordmark />
          <p className="mt-7 text-[22px] font-bold leading-7 tracking-[-0.02em] text-ink">Patient app</p>
          <p className="mt-2 text-[14.5px] leading-6 text-ink-soft">
            Shown as {patient.name}, a fictional person.{' '}
            {device.simulated
              ? 'The wearable is simulated: nothing here uses Bluetooth.'
              : 'Set to use the physical wearable over Bluetooth.'}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Link
              to="/demo"
              className="glass inline-flex min-h-11 items-center justify-between rounded-[14px] px-4 text-[14px] font-semibold text-ink hover:bg-white"
            >
              Demo controls
              <span aria-hidden="true" className="text-ink-faint">
                ›
              </span>
            </Link>
            <Link
              to="/clinician"
              className="glass inline-flex min-h-11 items-center justify-between rounded-[14px] px-4 text-[14px] font-semibold text-ink hover:bg-white"
            >
              Clinician dashboard
              <span aria-hidden="true" className="text-ink-faint">
                ›
              </span>
            </Link>
          </div>
          <ConceptNote className="mt-6" />
        </aside>

        <div className="relative min-h-dvh w-full frame:h-[min(868px,calc(100dvh-40px))] frame:min-h-0 frame:w-[410px] frame:rounded-[56px] frame:bg-navy-950 frame:p-[10px] frame:shadow-frame">
          <PhoneScreen />
        </div>

        <div className="hidden lg:block" aria-hidden="true" />
      </div>
    </TestSessionProvider>
  );
}

/** Icons are Phosphor (open source, MIT): outline at rest, filled when the tab is open. */
const TABS = [
  { to: '/patient', label: 'Today', icon: House, end: true },
  { to: '/patient/test', label: 'Test', icon: Fingerprint, end: false },
  { to: '/patient/exercise', label: 'Physio', icon: HandPalm, end: false },
  { to: '/patient/progress', label: 'Recovery', icon: ChartLineUp, end: false },
  { to: '/patient/settings', label: 'Settings', icon: GearSix, end: false },
] as const;

/** Height the floating tab bar takes up at the bottom of a phone screen, including its gap. */
export const TAB_BAR_SPACE = 'calc(86px+env(safe-area-inset-bottom))';

function BottomNav() {
  return (
    <nav
      aria-label="Patient app"
      className="glass-bar fixed inset-x-3 bottom-[max(10px,env(safe-area-inset-bottom))] z-30 rounded-[28px] px-1.5 frame:static frame:z-auto frame:mx-3 frame:mb-4 frame:mt-1 frame:shrink-0"
    >
      <ul className="grid grid-cols-5">
        {TABS.map(({ to, label, end, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={() => {
                // A tab press always opens that screen fresh, from the top.
                scrollMemory.delete(to);
                window.scrollTo(0, 0);
              }}
              className="flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-[22px]"
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cx(
                      'grid h-8 w-[50px] place-items-center rounded-full transition-colors duration-200',
                      isActive ? 'bg-ink text-mint shadow-button' : 'text-ink-soft',
                    )}
                  >
                    <Icon size={21} weight={isActive ? 'fill' : 'regular'} aria-hidden="true" />
                  </span>
                  <span className={cx('text-[11.5px] leading-4', isActive ? 'font-bold text-ink' : 'font-medium text-ink-soft')}>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Tab container: the four main destinations plus their sub-screens. */
export function PatientTabs() {
  const immersive = useImmersive();
  const location = useLocation();
  const navigate = useNavigate();
  // Swipe left or right to move between the four tabs. Only on the tab screens themselves.
  // Dragging sideways moves the screen with the finger. Past a threshold it carries on to the
  // next tab; short of it, the screen settles back. Graphs, sliders and text fields opt out.
  const pane = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; mode: 'h' | 'v' | null } | null>(null);
  const currentIndex = TABS.findIndex((tab) => tab.to === location.pathname.replace(/\/$/, ''));
  const neighbour = (dx: number) => (currentIndex === -1 ? undefined : TABS[currentIndex + (dx < 0 ? 1 : -1)]);

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    if (immersive || currentIndex === -1 || event.touches.length !== 1 || target?.closest('input, textarea, select, [data-own-swipe]')) {
      drag.current = null;
      return;
    }
    drag.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, mode: null };
  };

  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const state = drag.current;
    const element = pane.current;
    if (!state || !element) return;
    const dx = event.touches[0].clientX - state.x;
    const dy = event.touches[0].clientY - state.y;
    if (state.mode === null) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) state.mode = 'h';
      else if (Math.abs(dy) > 10) state.mode = 'v';
    }
    if (state.mode !== 'h') return;
    // No tab on that side: the screen resists.
    const offset = neighbour(dx) ? dx : dx * 0.22;
    element.style.transition = 'none';
    element.style.left = `${offset}px`;
    element.style.opacity = String(1 - Math.min(0.45, (Math.abs(offset) / window.innerWidth) * 0.7));
  };

  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const state = drag.current;
    const element = pane.current;
    drag.current = null;
    if (!state || state.mode !== 'h' || !element) return;
    const dx = event.changedTouches[0].clientX - state.x;
    const next = neighbour(dx);
    const far = Math.abs(dx) > Math.min(110, window.innerWidth * 0.26);
    if (next && far) {
      element.style.transition = 'left 150ms ease-out, opacity 150ms ease-out';
      element.style.left = `${dx < 0 ? -window.innerWidth : window.innerWidth}px`;
      element.style.opacity = '0.3';
      window.setTimeout(() => {
        scrollMemory.delete(next.to);
        window.scrollTo(0, 0);
        navigate(next.to);
      }, 140);
    } else {
      element.style.transition = 'left 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms';
      element.style.left = '0px';
      element.style.opacity = '1';
    }
  };
  // Which way the new tab comes in from: the right when moving forward, the left when moving back.
  const tabIndex = TABS.findIndex((tab) => tab.to === location.pathname.replace(/\/$/, ''));
  const previousTab = useRef(tabIndex);
  const slide = tabIndex !== -1 && previousTab.current !== -1 && tabIndex !== previousTab.current
    ? tabIndex > previousTab.current ? 'slide-from-right' : 'slide-from-left'
    : '';
  const lastSlide = useRef('');
  if (tabIndex !== previousTab.current) {
    lastSlide.current = slide;
    previousTab.current = tabIndex;
  }
  return (
    <>
      {/* Room for the fixed tab bar on phones. */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className={cx('flex flex-1 touch-pan-y flex-col overflow-x-clip frame:min-h-0 frame:pb-0', !immersive && 'pb-[calc(86px+env(safe-area-inset-bottom))]')}
      >
        <div key={location.pathname} ref={pane} className={cx('relative flex flex-1 flex-col frame:min-h-0', lastSlide.current)}>
          <Outlet />
        </div>
      </div>
      {immersive ? null : <BottomNav />}
    </>
  );
}

const SWITCH_LINKS = [
  { to: '/clinician', title: 'Clinician portal', note: 'The therapist’s view: worklist and records' },
  { to: '/patient', title: 'Patient app', note: 'Back to the home screen' },
  { to: '/demo', title: 'Demo controls', note: 'Scenarios, reset and the guided demo' },
  { to: '/onboarding', title: 'Introduction', note: 'Replay the three-step welcome' },
];

/** One place to jump between the patient app, the clinician portal and the demo controls. */
export function PrototypeTag({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          '-mr-1 inline-flex min-h-11 items-center px-1 text-[14px] font-semibold leading-5 underline underline-offset-4',
          tone === 'dark' ? 'text-white decoration-navy-rule' : 'text-ink decoration-rule',
        )}
      >
        Switch view
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Switch view" description="This is a prototype with fictional data.">
        <ul className="divide-y divide-rule">
          {SWITCH_LINKS.map((link) => (
            <li key={link.to}>
              <Link to={link.to} onClick={() => setOpen(false)} className="flex min-h-[60px] items-center justify-between gap-4 py-2">
                <span>
                  <span className="block text-[16px] font-bold leading-6 text-ink">{link.title}</span>
                  <span className="block text-[13.5px] leading-5 text-ink-soft">{link.note}</span>
                </span>
                <span className="text-[20px] text-ink-faint" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

/** Every screen below the home screen has a back button that returns to where you came from. */
export function TopBar({ title, hideHelp = false }: { title: string; back?: string; hideHelp?: boolean }) {
  const navigate = useNavigate();
  const goBack = () => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index > 0) navigate(-1);
    else navigate('/patient');
  };
  return (
    <header className="flex min-h-[60px] shrink-0 items-center gap-3 px-5 pt-[max(8px,env(safe-area-inset-top))] frame:pt-1">
      <button
        type="button"
        onClick={goBack}
        aria-label="Back"
        className="glass -ml-1 grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-white"
      >
        <CaretLeft size={20} weight="bold" aria-hidden="true" />
      </button>
      <h1 className="min-w-0 flex-1 truncate text-[20px] font-bold leading-7 tracking-[-0.025em] text-ink">{title}</h1>
      {hideHelp ? null : <HelpButton />}
    </header>
  );
}

/** The same button on every screen: a way to the page that says where everything is. */
export function HelpButton({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <Link
      to="/patient/help"
      aria-label="Help: where to find things"
      className={cx(
        '-mr-1 grid size-11 shrink-0 place-items-center rounded-full',
        tone === 'dark' ? 'glass-dark text-white hover:bg-white/[0.14]' : 'glass text-ink hover:bg-white',
      )}
    >
      <Question size={21} weight="bold" aria-hidden="true" />
    </Link>
  );
}

export function Screen({
  header,
  children,
  className,
  footer,
}: {
  header?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Pinned under the scroll area, above the tab bar. For a screen's primary action. */
  footer?: ReactNode;
}) {
  return (
    <>
      {header}
      <div className="relative flex flex-1 flex-col frame:min-h-0">
        <main className={cx('screen-in no-scrollbar flex-1 px-5 frame:min-h-0 frame:overflow-y-auto', footer ? 'pb-24' : 'pb-5', className)}>{children}</main>
        {/* The action floats over the page; only the button itself covers content. */}
        {footer ? <div className="pointer-events-none fixed inset-x-0 bottom-[calc(86px+env(safe-area-inset-bottom))] z-20 px-5 pb-2 frame:absolute frame:bottom-0 [&>*]:pointer-events-auto">{footer}</div> : null}
      </div>
    </>
  );
}

/** Link state, always worded so it cannot be mistaken for a real pairing. */
export function DevicePill({ className }: { className?: string }) {
  const device = useDevice();
  const connected = device.connection === 'connected';
  const connecting = device.connection === 'connecting';
  return (
    <Link
      to="/patient/settings"
      className={cx(
        'inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 text-[13.5px] font-semibold leading-5 shadow-soft',
        connected ? 'bg-paper text-ink' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-400/50',
        className,
      )}
    >
      {connecting ? (
        <Spinner className="size-3.5" />
      ) : connected ? (
        <span className="relative grid size-2.5 place-items-center" aria-hidden="true">
          <span className="absolute size-2.5 rounded-full bg-teal-400/40" />
          <span className="size-1.5 rounded-full bg-teal-600" />
        </span>
      ) : (
        <Unplug className="size-4" strokeWidth={2} aria-hidden="true" />
      )}
      <span>{linkSummary(device)}</span>
    </Link>
  );
}

export function SectionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[18px] font-bold leading-6 tracking-[-0.02em] text-ink">{children}</h2>
      {action}
    </div>
  );
}
