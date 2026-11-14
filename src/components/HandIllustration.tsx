/**
 * Original line illustration: a hand seen from the palm, a sleeve with a
 * pressure sensor on the affected fingertip, a band at the wrist, and the path
 * the signal takes between them.
 *
 * It is a concept drawing, not a schematic. It shows what V3 Normal mode does
 * (pressure at the fingertip, feedback at the wrist) and nothing about where the
 * Rehab test stimulus sits, which the hardware team has not confirmed.
 */
import { usePrefersReducedMotion } from '../app/hooks';
import type { Finger, Hand } from '../domain/types';
import { C } from './palette';

const INK = C.ink;
const SEA = C.teal600;
const MINT = C.mint;
const SKIN = C.paper;

interface FingerShape {
  /** Base centre, where the finger meets the palm. */
  x: number;
  y: number;
  length: number;
  width: number;
  /** Degrees, clockwise. Drawn for a left hand seen from the palm. */
  angle: number;
}

const FINGERS: Record<Finger, FingerShape> = {
  thumb: { x: 100, y: 238, length: 80, width: 28, angle: -50 },
  index: { x: 110, y: 164, length: 112, width: 24, angle: -6 },
  middle: { x: 139, y: 158, length: 126, width: 24, angle: -1.5 },
  ring: { x: 168, y: 160, length: 116, width: 24, angle: 3.5 },
  little: { x: 195, y: 170, length: 90, width: 21, angle: 9 },
};

const ORDER: Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];

/** Signal path control points for each finger, for a left hand. [c1x, c1y, c2x, c2y, endX, endY] */
const ROUTES: Record<Finger, [number, number, number, number, number, number]> = {
  thumb: [6, 214, 14, 292, 106, 305],
  index: [-44, 100, -34, 272, 106, 305],
  middle: [40, -34, -64, 250, 106, 305],
  ring: [300, 80, 292, 272, 198, 305],
  little: [292, 112, 284, 282, 198, 305],
};

const VIEW = { x: -62, y: -30, width: 364, height: 372 };
const MIRROR_AXIS = VIEW.x * 2 + VIEW.width; // x' = MIRROR_AXIS - x keeps the drawing inside the same view box

export function HandIllustration({
  hand,
  finger,
  active,
  showBand = true,
  showPath = true,
  className,
  title,
}: {
  hand: Hand;
  finger: Finger;
  /** Animate a pulse along the path. Purely illustrative; it is not driven by the device. */
  active: boolean;
  showBand?: boolean;
  showPath?: boolean;
  className?: string;
  title: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  // The base drawing is a left hand. A right hand is its mirror image.
  const mirror = hand === 'right';
  const mx = (x: number) => (mirror ? MIRROR_AXIS - x : x);
  const sign = mirror ? -1 : 1;

  const tipOf = (shape: FingerShape, inset: number) => {
    const reach = shape.length - inset;
    const radians = (shape.angle * Math.PI) / 180;
    return { x: mx(shape.x + reach * Math.sin(radians)), y: shape.y - reach * Math.cos(radians) };
  };

  const affected = FINGERS[finger];
  const pad = tipOf(affected, 17);
  const route = ROUTES[finger];
  const pathD = `M ${pad.x.toFixed(1)} ${pad.y.toFixed(1)} C ${mx(route[0])} ${route[1]}, ${mx(route[2])} ${route[3]}, ${mx(route[4])} ${route[5]}`;
  const motor = { x: mx(152), y: 305 };

  const fingerRect = (name: Finger) => {
    const shape = FINGERS[name];
    const left = mx(shape.x) - shape.width / 2;
    const rotation = `rotate(${shape.angle * sign} ${mx(shape.x)} ${shape.y})`;
    return { shape, left, rotation };
  };

  return (
    <svg
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
      className={className}
      role="img"
      aria-label={title}
      fill="none"
    >
      {/* Forearm, open at the bottom */}
      <path
        d={`M ${mx(116)} 372 V 250 H ${mx(188)} V 372`}
        fill={SKIN}
        stroke={INK}
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Fingers, drawn long enough to tuck under the palm */}
      {ORDER.map((name) => {
        const { shape, left, rotation } = fingerRect(name);
        return (
          <rect
            key={name}
            x={left}
            y={shape.y - shape.length}
            width={shape.width}
            height={shape.length + 26}
            rx={shape.width / 2}
            fill={SKIN}
            stroke={INK}
            strokeWidth={2}
            transform={rotation}
          />
        );
      })}

      {/* Palm */}
      <rect x={mx(92) - (mirror ? 122 : 0)} y={152} width={122} height={118} rx={34} fill={SKIN} stroke={INK} strokeWidth={2} />

      {/* Erase the seams where fingers and forearm meet the palm, so the hand reads as one outline */}
      {ORDER.map((name) => {
        const { shape, left, rotation } = fingerRect(name);
        const inset = 1.6;
        return (
          <rect
            key={`seam-${name}`}
            x={left + inset}
            y={shape.y - 14}
            width={shape.width - inset * 2}
            height={40}
            fill={SKIN}
            transform={rotation}
          />
        );
      })}
      <rect x={Math.min(mx(117.6), mx(186.4))} y={246} width={68.8} height={30} fill={SKIN} />

      {/* Palm creases, kept faint */}
      <path
        d={`M ${mx(112)} 214 C ${mx(134)} 196, ${mx(166)} 196, ${mx(196)} 206`}
        stroke={INK}
        strokeOpacity={0.18}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      <path
        d={`M ${mx(126)} 250 C ${mx(128)} 226, ${mx(142)} 212, ${mx(160)} 206`}
        stroke={INK}
        strokeOpacity={0.18}
        strokeWidth={1.4}
        strokeLinecap="round"
      />

      {/* Sleeve on the affected fingertip, with the sensor pad */}
      {(() => {
        const { shape, rotation } = fingerRect(finger);
        const half = shape.width / 2 + 1.6;
        const centre = mx(shape.x);
        const top = shape.y - shape.length - 1.6;
        const bottom = top + 50;
        return (
          <g transform={rotation}>
            <path
              d={`M ${centre - half} ${bottom} V ${top + half} A ${half} ${half} 0 0 1 ${centre + half} ${top + half} V ${bottom} Z`}
              fill={MINT}
              stroke={INK}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {active ? <circle cx={centre} cy={top + 18.6} r={11} fill={SEA} fillOpacity={0.18} /> : null}
            <circle cx={centre} cy={top + 18.6} r={6.2} fill={SEA} />
            <circle cx={centre} cy={top + 18.6} r={2.1} fill={MINT} />
          </g>
        );
      })()}

      {/* Wristband with the vibration site */}
      {showBand ? (
        <g>
          <rect x={mx(106) - (mirror ? 92 : 0)} y={291} width={92} height={28} rx={9} fill={INK} />
          <circle cx={motor.x} cy={motor.y} r={6} fill={MINT} />
          {active ? (
            <g stroke={MINT} strokeWidth={1.5} strokeLinecap="round" opacity={0.85}>
              <path d={`M ${motor.x - 13} ${motor.y - 6} a 9 9 0 0 0 0 12`} />
              <path d={`M ${motor.x + 13} ${motor.y - 6} a 9 9 0 0 1 0 12`} />
            </g>
          ) : null}
        </g>
      ) : null}

      {/* The bridge: where the signal goes */}
      {showPath && showBand ? (
        <g>
          <path d={pathD} stroke={C.teal500} strokeWidth={2.2} strokeLinecap="round" strokeDasharray="1.5 7" opacity={active ? 1 : 0.4} />
          {active && !reducedMotion ? (
            <circle r={4} fill={SEA}>
              <animateMotion dur="2.8s" repeatCount="indefinite" path={pathD} calcMode="spline" keyTimes="0;1" keySplines="0.45 0 0.3 1" />
            </circle>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}
