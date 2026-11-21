/**
 * Instructional figures: a drawn hand showing a movement, so that nobody has to
 * read a paragraph and guess.
 *
 *   MovementGuide   the movement, animated: start, move, hold, return, on a loop,
 *                   or following the stage a live session has reached
 *   HandDrawing     one still posture
 *
 * Both are drawn from the app's kinematic hand model in the view the person is
 * being asked for, mirrored the way a selfie view mirrors them. They are
 * illustrations: never a picture of a person, never a measurement.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { recommendedView, type ResolvedAssessment } from '../../assessment/definitions';
import type { CameraSetup } from '../../assessment/types';
import { usePrefersReducedMotion } from '../../app/hooks';
import { cx } from '../../components/ui';
import type { Finger, Hand } from '../../domain/types';
import type { HandView } from '../../tracking/geometry';
import { blendPose, observePose, oppositionPose, postureOf, yawForView, type HandPose } from '../../tracking/handModel';
import { ART_DARK, ART_LIGHT, colourOf, forearmEnd, handOps, type ArtPoint, type ArtStyle } from './handArt';

type FigureKey = ResolvedAssessment['definition']['figure']['start' | 'target'];

function poseFor(key: FigureKey, hand: Hand, setup: ResolvedAssessment): HandPose {
  if (key === 'opposition-open') return oppositionPose(hand, setup.focus, 0);
  if (key === 'opposition-touch') return oppositionPose(hand, setup.focus, 1);
  if (setup.definition.digits === 'one-finger' && key !== 'open') {
    // Only the chosen finger bends.
    const pose = postureOf('open', hand);
    pose.fingers[setup.focus] = { mcp: 68, pip: 88, dip: 44 };
    return pose;
  }
  return postureOf(key, hand);
}

/** How the hand is turned in the drawing: the view being asked for, eased off a touch from dead side-on so the far fingers show behind the near one. */
function cameraFor(view: HandView, hand: Hand): { yaw: number; pitch: number } {
  if (view === 'radial' || view === 'ulnar') return { yaw: yawForView(view, hand) * 0.94, pitch: 0 };
  if (view === 'oblique') return { yaw: yawForView('ulnar', hand) * 0.5, pitch: 0 };
  // Palm-on is drawn square to the viewer, like the app's other hand illustration.
  return { yaw: 0, pitch: 0 };
}

function project(pose: HandPose, camera: { yaw: number; pitch: number }, mirror: boolean): ArtPoint[] {
  // A long lens: the drawing is flat, like the app's other hand illustration, with no near-and-far distortion.
  const image = observePose(pose, { ...camera, aspect: 1, centreX: 0.5, centreY: 0.5, distance: 6, focal: 12 }).image;
  return image.map((point) => ({ x: mirror ? 1 - point.x : point.x, y: point.y, z: point.z }));
}

interface Box {
  minX: number;
  minY: number;
  span: number;
  offsetX: number;
  offsetY: number;
}

/** One frame for every posture of a movement, so the hand does not slide about as it moves. Leaves room for the forearm. */
function boxOf(sets: ArtPoint[][]): Box {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const points of sets) {
    for (const point of [...points, forearmEnd(points)]) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  return { minX, minY, span, offsetX: (span - (maxX - minX)) / 2, offsetY: (span - (maxY - minY)) / 2 };
}

const SIZE = 100;
const MARGIN = 9;
/** The ink line, in the drawing's units: about the weight of the app's other hand illustration at the sizes these are shown. */
const LINE = 0.85;

const place = (points: ArtPoint[], box: Box): ArtPoint[] =>
  points.map((point) => ({
    x: MARGIN + ((point.x - box.minX + box.offsetX) / box.span) * (SIZE - MARGIN * 2),
    y: MARGIN + ((point.y - box.minY + box.offsetY) / box.span) * (SIZE - MARGIN * 2),
    // Depth is scaled with the rest, so "in front of the palm" means the same at any size.
    z: (point.z / box.span) * (SIZE - MARGIN * 2),
  }));

/** A single posture laid out in the drawing's 100 by 100 box, landmark by landmark, for figures that add their own labels. */
export function posePoints(pose: HandPose, camera: { yaw: number; pitch: number }, mirror = true): ArtPoint[] {
  const points = project(pose, camera, mirror);
  return place(points, boxOf([points]));
}

export function HandSvg({
  points,
  style,
  highlight,
  label,
  className,
  children,
}: {
  points: ArtPoint[];
  style: ArtStyle;
  highlight: readonly Finger[];
  label: string;
  className?: string;
  /** Drawn on top of the hand, in the same 100 by 100 units. */
  children?: ReactNode;
}) {
  const ops = handOps(points, highlight, LINE);
  const d = (path: { x: number; y: number }[], closed: boolean) => `${path.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')}${closed ? ' Z' : ''}`;
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={cx('block aspect-square w-full', className)} role="img" aria-label={`${label}. Illustration.`}>
      {ops.map((op, index) => {
        const colour = colourOf(op, style);
        return <path key={index} d={d(op.path, op.closed)} fill={op.closed ? colour : 'none'} stroke={colour} strokeWidth={op.width} strokeOpacity={op.alpha} strokeLinecap={op.cap} strokeLinejoin="round" />;
      })}
      {children}
    </svg>
  );
}

function highlightOf(setup: ResolvedAssessment): Finger[] {
  if (setup.definition.primary === 'opposition') return ['thumb', setup.focus];
  return setup.definition.digits === 'one-finger' ? [setup.focus] : [];
}

/** One still posture of the movement. */
export function HandDrawing({ setup, hand, which, camera = 'laptop', tone = 'light', className }: { setup: ResolvedAssessment; hand: Hand; which: 'start' | 'target'; camera?: CameraSetup; tone?: 'light' | 'dark'; className?: string }) {
  const points = useMemo(() => {
    const view = cameraFor(recommendedView(setup.definition, setup.focus, camera), hand);
    const start = project(poseFor(setup.definition.figure.start, hand, setup), view, true);
    const target = project(poseFor(setup.definition.figure.target, hand, setup), view, true);
    return place(which === 'start' ? start : target, boxOf([start, target]));
  }, [setup, hand, which, camera]);
  return <HandSvg points={points} style={tone === 'dark' ? ART_DARK : ART_LIGHT} highlight={highlightOf(setup)} label={which === 'start' ? 'Start position' : 'Target position'} className={className} />;
}

export type GuideStage = 'start' | 'move' | 'hold' | 'return';

const ease = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** The loop: wait at the start, move, hold, move back. Seconds. */
const LOOP = { start: 0.9, move: 1.1, hold: 1.5, back: 1.1 };
const LOOP_TOTAL = LOOP.start + LOOP.move + LOOP.hold + LOOP.back;

function loopAt(seconds: number): { amount: number; stage: GuideStage } {
  const t = seconds % LOOP_TOTAL;
  if (t < LOOP.start) return { amount: 0, stage: 'start' };
  if (t < LOOP.start + LOOP.move) return { amount: ease((t - LOOP.start) / LOOP.move), stage: 'move' };
  if (t < LOOP.start + LOOP.move + LOOP.hold) return { amount: 1, stage: 'hold' };
  return { amount: 1 - ease((t - LOOP.start - LOOP.move - LOOP.hold) / LOOP.back), stage: 'return' };
}

const STAGE_WORD: Record<GuideStage, string> = { start: 'Start', move: 'Move', hold: 'Hold', return: 'Return' };

/**
 * The movement, animated.
 *
 * With no `stage`, it loops through the whole movement. With one, it shows what
 * to do at that stage of a live session: the start position, the movement into
 * the target (repeating), the held target, or the movement back.
 *
 * With reduced motion switched on it shows the start and target side by side.
 */
export function MovementGuide({
  setup,
  hand,
  camera = 'laptop',
  stage,
  tone = 'light',
  caption = true,
  className,
}: {
  setup: ResolvedAssessment;
  hand: Hand;
  camera?: CameraSetup;
  stage?: GuideStage;
  tone?: 'light' | 'dark';
  caption?: boolean;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [seconds, setSeconds] = useState(0);
  const started = useRef<number | null>(null);

  useEffect(() => {
    if (reduced || stage === 'start' || stage === 'hold') return;
    let request = 0;
    started.current = null;
    const tick = (now: number) => {
      if (started.current === null) started.current = now;
      setSeconds((now - started.current) / 1000);
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [reduced, stage]);

  const frames = useMemo(() => {
    const view = cameraFor(recommendedView(setup.definition, setup.focus, camera), hand);
    const from = poseFor(setup.definition.figure.start, hand, setup);
    const to = poseFor(setup.definition.figure.target, hand, setup);
    const box = boxOf([project(from, view, true), project(to, view, true)]);
    return { view, from, to, box };
  }, [setup, hand, camera]);

  const style = tone === 'dark' ? ART_DARK : ART_LIGHT;
  const soft = tone === 'dark' ? 'text-mist' : 'text-ink-soft';
  const strong = tone === 'dark' ? 'text-white' : 'text-ink';
  const highlight = highlightOf(setup);

  if (reduced) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2">
          <figure className="min-w-0 flex-1">
            <HandDrawing setup={setup} hand={hand} which="start" camera={camera} tone={tone} />
            <figcaption className={cx('text-center text-[12.5px] font-semibold', soft)}>Start</figcaption>
          </figure>
          <figure className="min-w-0 flex-1">
            <HandDrawing setup={setup} hand={hand} which="target" camera={camera} tone={tone} />
            <figcaption className={cx('text-center text-[12.5px] font-semibold', soft)}>Hold</figcaption>
          </figure>
        </div>
      </div>
    );
  }

  let amount: number;
  let showing: GuideStage;
  if (stage === 'start') {
    amount = 0;
    showing = 'start';
  } else if (stage === 'hold') {
    amount = 1;
    showing = 'hold';
  } else if (stage === 'move') {
    // Start, into the target, a beat there, and again.
    const t = seconds % 2.6;
    amount = t < 0.5 ? 0 : t < 1.6 ? ease((t - 0.5) / 1.1) : 1;
    showing = 'move';
  } else if (stage === 'return') {
    const t = seconds % 2.6;
    amount = t < 0.5 ? 1 : t < 1.6 ? 1 - ease((t - 0.5) / 1.1) : 0;
    showing = 'return';
  } else {
    const at = loopAt(seconds);
    amount = at.amount;
    showing = at.stage;
  }

  const points = place(project(blendPose(frames.from, frames.to, amount), frames.view, true), frames.box);
  const order: GuideStage[] = ['start', 'move', 'hold', 'return'];

  return (
    <div className={className}>
      <HandSvg points={points} style={style} highlight={highlight} label={`${setup.definition.title}: ${STAGE_WORD[showing].toLowerCase()}`} />
      {caption ? (
        <ol className="mt-1 flex justify-center gap-1.5" aria-hidden="true">
          {order.map((item) => (
            <li
              key={item}
              className={cx(
                'rounded-full px-2.5 py-0.5 text-[11.5px] font-bold leading-5 transition-colors duration-200',
                item === showing ? (tone === 'dark' ? 'bg-mint text-ink' : 'bg-ink text-mint') : cx(soft, 'bg-transparent'),
              )}
            >
              {STAGE_WORD[item]}
            </li>
          ))}
        </ol>
      ) : null}
      {caption ? <p className={cx('mt-1.5 text-center text-[11.5px] leading-4', soft)}>An illustration drawn by the app, shown as a mirror would show you. <span className={cx('sr-only-live', strong)}>Not a picture of your hand.</span></p> : null}
    </div>
  );
}

/** The old name, kept for the places that only need the movement shown. */
export function MovementFigure({ setup, hand, tone = 'light', className }: { setup: ResolvedAssessment; hand: Hand; tone?: 'dark' | 'light'; className?: string }) {
  return <MovementGuide setup={setup} hand={hand} tone={tone} className={className} />;
}
