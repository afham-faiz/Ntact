/**
 * Turns 21 hand landmarks into a drawing of a hand in the app's own illustration
 * style: the white hand with a navy outline used on the sensation test and Touch
 * Assist screens (components/HandIllustration.tsx). Chunky rounded fingers that
 * nearly touch, a rounded palm, a short thick thumb, a forearm open at the
 * bottom, and one continuous outline.
 *
 * Every digit is drawn bone by bone through the same landmarks the tracker
 * reports, the thumb included (its base, knuckle, last joint and tip), with a
 * faint crease at each joint. So the drawing bends where the tracked hand bends.
 *
 * That illustration is a fixed drawing. This one has to move, and to be seen
 * from the side as well as palm-on, so it is built from the landmarks instead.
 * The hand is painted as one silhouette: every outline first, then every fill,
 * so that the fingers, thumb, palm and forearm share a single line with no seams.
 * Only two things are then drawn on top with a line of their own:
 *
 *   - the part of a finger that has folded back over itself (a curled fingertip)
 *   - a thumb that has come across in front of the palm
 *
 * Used for the instructional figures and for the drawn hand in the synthetic
 * replay. It is an illustration. It is never drawn over a camera picture, and it
 * never stands for a measurement.
 */
import type { Finger } from '../../domain/types';
import { CHAIN } from '../../tracking/geometry';

export interface ArtPoint {
  x: number;
  y: number;
  /** Depth, in the same units as x and y: larger is farther from the viewer. */
  z: number;
}

interface Flat {
  x: number;
  y: number;
}

/** One stroke of the drawing. Everything is a stroked line or a filled, stroked outline. */
export interface ArtOp {
  path: Flat[];
  width: number;
  /** outline: the ink line. skin: the hand. accent: an assessed digit. crease: a faint line on the palm. */
  role: 'outline' | 'skin' | 'accent' | 'crease';
  cap: 'round' | 'butt';
  /** Closed and filled as well as stroked: the palm. */
  closed: boolean;
  /** 0 to 1. Lets a fold line arrive gradually as a finger curls instead of popping in. */
  alpha?: number;
}

/**
 * Digit thickness as a share of the palm unit (the span of the knuckles, 85 of the fixed
 * illustration's units). Its fingers are 24 wide, the little finger 21 and the thumb 28.
 */
const THICKNESS: Record<Finger, number> = { thumb: 0.33, index: 0.282, middle: 0.282, ring: 0.282, little: 0.247 };

/** Corner radius of the palm, and half its thickness seen edge-on. The illustration's is 34 units; a little less here so the hand is not a slab side-on. */
const PALM_ROUND = 0.33;
/** How far out from the middle of the knuckle row the palm's straight edges run, before the rounded corners. Gives a palm 122 units wide. */
const PALM_INSET = 0.77;

/** The palm's size on the page. Edge-on its width collapses, so its length stands in. */
export function artUnit(points: readonly ArtPoint[]): number {
  const width = Math.hypot(points[5].x - points[17].x, points[5].y - points[17].y);
  const length = Math.hypot(points[9].x - points[0].x, points[9].y - points[0].y);
  return Math.max(width, length * 0.74, 1e-6);
}

const along = (from: Flat, to: Flat, distance: number): Flat => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) / length) * distance, y: from.y + ((to.y - from.y) / length) * distance };
};

const lengthOf = (a: Flat, b: Flat): number => Math.hypot(b.x - a.x, b.y - a.y);
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Where the forearm ends on the page, so a figure can leave room for it. */
export function forearmEnd(points: readonly ArtPoint[]): Flat {
  // Straight down from the wrist, away from the middle of the knuckle row.
  const top = { x: (points[5].x + points[17].x) / 2, y: (points[5].y + points[17].y) / 2 };
  return along(points[0], top, -artUnit(points) * 0.8);
}

/** A cubic curve as a run of short lines. */
function curve(a: Flat, b: Flat, c: Flat, d: Flat, steps = 10): Flat[] {
  const out: Flat[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
      y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
    });
  }
  return out;
}

interface Piece {
  path: Flat[];
  width: number;
  role: 'skin' | 'accent';
  cap: 'round' | 'butt';
  closed?: boolean;
}

/**
 * The strokes that draw the hand, in order. `outline` is the thickness of the ink
 * line in the drawing's units. `highlight` digits wear a gold sleeve on the
 * fingertip, as the assessed finger does in the fixed illustration.
 */
export function handOps(points: readonly ArtPoint[], highlight: readonly Finger[], outline: number): ArtOp[] {
  const unit = artUnit(points);
  const flat = (index: number): Flat => ({ x: points[index].x, y: points[index].y });
  const depthOf = (indices: readonly number[]) => indices.reduce((sum, index) => sum + points[index].z, 0) / indices.length;
  const ops: ArtOp[] = [];
  const ink = (piece: Piece, alpha?: number) => ops.push({ path: piece.path, width: piece.width + outline * 2, role: 'outline', cap: piece.cap, closed: piece.closed ?? false, alpha });
  const fill = (piece: Piece) => ops.push({ path: piece.path, width: piece.width, role: piece.role, cap: piece.cap, closed: piece.closed ?? false });
  /** Several pieces as one shape with one outline. */
  const merged = (pieces: Piece[]) => {
    pieces.forEach((piece) => ink(piece));
    pieces.forEach(fill);
  };
  const skin = (path: Flat[], width: number, cap: 'round' | 'butt' = 'round'): Piece => ({ path, width, role: 'skin', cap });

  // ---------- The palm's own axes on the page ----------
  const wrist = flat(0);
  const index5 = flat(5);
  const little17 = flat(17);
  const top = { x: (index5.x + little17.x) / 2, y: (index5.y + little17.y) / 2 };
  const up = along({ x: 0, y: 0 }, { x: top.x - wrist.x, y: top.y - wrist.y }, 1);
  const span = lengthOf(wrist, top);
  const half = { x: (index5.x - little17.x) / 2, y: (index5.y - little17.y) / 2 };
  const tilt = half.x * up.x + half.y * up.y;
  const across = { x: half.x - up.x * tilt, y: half.y - up.y * tilt };
  const acrossLength = Math.hypot(across.x, across.y);
  /** 1 looking at the palm or the back of the hand, 0 looking at its edge. */
  const facing = clamp01((acrossLength / unit - 0.17) / 0.14);
  const stacked = facing === 0;
  const radius = unit * PALM_ROUND;
  const at = (origin: Flat, sideways: number, upward: number, tilted = 0): Flat => ({
    x: origin.x + across.x * sideways + up.x * (upward + tilt * tilted),
    y: origin.y + across.y * sideways + up.y * (upward + tilt * tilted),
  });

  // A rounded rectangle, top edge on the knuckle line: drawn inset with a wide round stroke, which
  // rounds its corners and gives the palm its thickness when it is seen edge-on.
  const palm: Piece = {
    path: [at(top, PALM_INSET, -radius, PALM_INSET), at(top, -PALM_INSET, -radius, -PALM_INSET), at(wrist, -PALM_INSET, radius - unit * 0.05), at(wrist, PALM_INSET, radius - unit * 0.05)],
    width: radius * 2,
    role: 'skin',
    cap: 'round',
    closed: true,
  };
  const palmDepth = depthOf([0, 5, 9, 13, 17]);

  // The forearm: straight sides, open at the bottom, like the fixed illustration's.
  const forearm = skin([along(wrist, top, radius * 0.4), forearmEnd(points)], acrossLength * PALM_INSET + radius * 1.4, 'butt');

  // ---------- The digits ----------
  interface Digit {
    finger: Finger;
    width: number;
    depth: number;
    /** The part that joins the palm. */
    body: Piece;
    /** A part that has folded back over the body, or come across in front of the palm, with how strongly to ink it. */
    over: { piece: Piece; strength: number; depth: number } | null;
    /** For a thumb crossing the palm: paints out the line where the part on top leaves the part underneath. */
    join: Piece | null;
    /** The gold fingertip sleeve of an assessed digit. */
    sleeve: Piece | null;
    /** The joints along the digit, for their creases. `over` says the joint lies in the part drawn on top. */
    joints: { before: Flat; here: Flat; after: Flat; over: boolean }[];
  }

  /** A faint line across a joint, where the bones either side of it are long enough on the page to carry one. */
  const creases = (digit: Digit, over: boolean) => {
    for (const joint of digit.joints) {
      if (joint.over !== over) continue;
      if (lengthOf(joint.before, joint.here) < digit.width * 0.45 || lengthOf(joint.here, joint.after) < digit.width * 0.45) continue;
      const direction = along({ x: 0, y: 0 }, { x: joint.after.x - joint.before.x, y: joint.after.y - joint.before.y }, 1);
      const half = digit.width * 0.27;
      ops.push({
        path: [
          { x: joint.here.x - direction.y * half, y: joint.here.y + direction.x * half },
          { x: joint.here.x + direction.y * half, y: joint.here.y - direction.x * half },
        ],
        width: outline * 0.75,
        role: 'crease',
        cap: 'round',
        closed: false,
      });
    }
  };

  const sleeveOf = (finger: Finger, path: Flat[], width: number): Piece | null =>
    highlight.includes(finger) ? { path, width: width + outline * 0.6, role: 'accent', cap: 'round' } : null;

  const fingerDigit = (finger: Exclude<Finger, 'thumb'>): Digit => {
    const chain = CHAIN[finger];
    const width = unit * THICKNESS[finger];
    const joints = chain.map(flat);
    const firstBone = lengthOf(joints[0], joints[1]);
    // Tucked under the palm, as the fixed illustration's fingers are, when the finger stands up out of it.
    const tuck = width * 0.9 * facing * clamp01((firstBone - width * 0.5) / width);
    const path = tuck > 0 ? [along(joints[0], joints[1], -tuck), ...joints] : joints;
    const offset = path.length - joints.length;

    // Where the finger first doubles back on the page: from there on it is lying over itself.
    let fold = -1;
    let heading: Flat = firstBone > width * 0.15 ? { x: joints[1].x - joints[0].x, y: joints[1].y - joints[0].y } : up;
    for (let joint = 1; joint < joints.length - 1 && !stacked; joint += 1) {
      const next = { x: joints[joint + 1].x - joints[joint].x, y: joints[joint + 1].y - joints[joint].y };
      if (heading.x * next.x + heading.y * next.y < 0) {
        fold = joint;
        break;
      }
      if (Math.hypot(next.x, next.y) > width * 0.15) heading = next;
    }

    const depth = depthOf(chain.slice(1));
    // The sleeve covers the end of the finger, and never reaches back across a fold.
    const middle = { x: (joints[1].x + joints[2].x) / 2, y: (joints[1].y + joints[2].y) / 2 };
    const sleeve = sleeveOf(finger, fold === 2 ? [joints[2], joints[3]] : [middle, joints[2], joints[3]], width);
    const joint = (index: number, over: boolean) => ({ before: joints[index - 1], here: joints[index], after: joints[index + 1], over });
    // Edge-on, a curling finger really is that shape on the page, so it stays in one piece.
    if (fold < 0) return { finger, width, depth, body: skin(path, width), over: null, join: null, sleeve, joints: [joint(1, false), joint(2, false)] };
    const folded = joints.slice(fold);
    let reach = 0;
    for (let joint = 1; joint < folded.length; joint += 1) reach += lengthOf(folded[joint - 1], folded[joint]);
    return {
      finger,
      width,
      depth,
      body: skin(path.slice(0, fold + offset + 1), width),
      over: { piece: skin(folded, width), strength: clamp01(reach / (width * 0.7)), depth: depthOf(chain.slice(fold)) },
      join: null,
      sleeve,
      // The joint at the fold is the fold itself; the other one gets its crease.
      joints: fold === 1 ? [joint(2, true)] : [joint(1, false)],
    };
  };

  const thumbDigit = (): Digit => {
    const chain = CHAIN.thumb;
    const width = unit * THICKNESS.thumb;
    // Base, knuckle, last joint, tip: the four points the tracker reports, joined by straight bones.
    const path = chain.map(flat);
    const depth = depthOf(chain.slice(1));
    // From two thirds of the way to the last joint, to the tip.
    const sleeve = sleeveOf('thumb', [{ x: path[1].x + (path[2].x - path[1].x) * 0.66, y: path[1].y + (path[2].y - path[1].y) * 0.66 }, path[2], path[3]], width);
    const knuckle = (over: boolean) => ({ before: path[0], here: path[1], after: path[2], over });
    const last = (over: boolean) => ({ before: path[1], here: path[2], after: path[3], over });
    // Clearly nearer than the palm: it has come across in front of it.
    const lift = (palmDepth - depthOf(chain.slice(2))) / unit;
    if (lift < 0.14 || stacked) return { finger: 'thumb', width, depth, body: skin(path, width), over: null, join: null, sleeve, joints: [knuckle(false), last(false)] };
    // The first bone stays part of the palm; the rest of the thumb lies on top with its own line.
    const root = path.slice(0, 2);
    const rest = path.slice(1);
    // The join is opened along the first bone, wherever that points: bent at the knuckle, the two parts still read as one thumb.
    const back = along(path[1], path[0], width / 2 + outline);
    return {
      finger: 'thumb',
      width,
      depth,
      body: skin(root, width),
      over: { piece: skin(rest, width), strength: 1, depth: depthOf(chain.slice(2)) },
      join: skin([back, rest[0]], Math.max(0, width - outline * 0.3), 'butt'),
      sleeve,
      joints: [last(true)],
    };
  };

  const fingers = (['index', 'middle', 'ring', 'little'] as const).map(fingerDigit);
  const thumb = thumbDigit();
  const digits = [thumb, ...fingers];
  const sleeved = (digit: Digit) => {
    if (digit.sleeve) merged([digit.sleeve]);
  };

  // Edge-on the four fingers lie over each other: the nearest is drawn in front of the other three,
  // and the thumb in front of the palm or behind it, whichever side of the hand is towards the viewer.
  const nearest = stacked ? fingers.reduce((best, digit) => (digit.depth < best.depth ? digit : best)) : null;
  const thumbOnTop = stacked && thumb.depth <= palmDepth;

  const silhouette: Piece[] = [forearm];
  for (const digit of digits) {
    if (digit === nearest || (digit === thumb && thumbOnTop)) continue;
    silhouette.push(digit.body);
  }
  silhouette.push(palm);
  merged(silhouette);

  // Two faint creases, only when the palm is square to the viewer.
  if (facing === 1 && Math.abs(points[5].z - points[17].z) < unit * 0.2) {
    // Placed as they are on the fixed illustration: s runs from the little-finger edge (-1) to the thumb edge (1), t from wrist to knuckles.
    const reach = PALM_INSET + radius / acrossLength;
    const spot = (s: number, t: number): Flat => at(wrist, s * reach, span * t);
    const crease = (path: Flat[]) => ops.push({ path, width: outline * 0.7, role: 'crease', cap: 'round', closed: false });
    crease(curve(spot(0.68, 0.5), spot(0.32, 0.65), spot(-0.22, 0.65), spot(-0.7, 0.56)));
    crease(curve(spot(0.44, 0.17), spot(0.41, 0.37), spot(0.18, 0.49), spot(-0.12, 0.54)));
  }

  // Joint creases and sleeves on digits that are part of the silhouette. Edge-on, only the nearest finger shows its joints.
  for (const digit of digits) {
    if (digit === nearest || (digit === thumb && thumbOnTop)) continue;
    if (!stacked || digit === thumb) creases(digit, false);
    if (!digit.over) sleeved(digit);
  }

  if (nearest) {
    merged([nearest.body]);
    // The palm's fill again, so the finger grows out of the palm instead of sitting on it.
    fill(palm);
    creases(nearest, false);
    sleeved(nearest);
  }
  if (thumbOnTop) {
    merged([thumb.body]);
    // Open at its base, where it leaves the palm.
    const start = thumb.body.path[0];
    fill(skin([along(start, thumb.body.path[1], -(thumb.width / 2 + outline)), start], Math.max(0, thumb.width - outline * 0.3), 'butt'));
    creases(thumb, false);
    sleeved(thumb);
  }

  // Whatever lies on top, farthest first.
  const overs = digits.filter((digit) => digit.over).sort((a, b) => b.over!.depth - a.over!.depth);
  for (const digit of overs) {
    const over = digit.over!;
    ink(over.piece, over.strength);
    fill(over.piece);
    if (digit.join) fill(digit.join);
    creases(digit, true);
    sleeved(digit);
  }
  return ops;
}

export interface ArtStyle {
  skin: string;
  outline: string;
  /** Fill for the digits being assessed. */
  accent: string;
  crease: string;
}

/** The app's hand: white with a navy line. `ART_DARK` is its navy-surface form, used on the dark stage of a replay. */
export const ART_LIGHT: ArtStyle = { skin: '#FFFFFF', outline: '#14213D', accent: '#ECB424', crease: 'rgba(20, 33, 61, 0.3)' };
export const ART_DARK: ArtStyle = { skin: '#26365A', outline: '#FFFFFF', accent: '#ECB424', crease: 'rgba(255, 255, 255, 0.38)' };

export const colourOf = (op: ArtOp, style: ArtStyle): string => style[op.role];

/** Paints the hand on a canvas. `highlight` are the digits picked out in the accent colour. */
export function paintHand(ctx: CanvasRenderingContext2D, points: readonly ArtPoint[], style: ArtStyle, highlight: readonly Finger[] = [], alpha = 1): void {
  ctx.save();
  ctx.lineJoin = 'round';
  for (const op of handOps(points, highlight, Math.max(1.2, artUnit(points) * 0.02))) {
    const colour = colourOf(op, style);
    ctx.globalAlpha = alpha * (op.alpha ?? 1);
    ctx.beginPath();
    op.path.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    if (op.closed) ctx.closePath();
    ctx.lineCap = op.cap;
    ctx.strokeStyle = colour;
    ctx.lineWidth = op.width;
    if (op.closed) {
      ctx.fillStyle = colour;
      ctx.fill();
    }
    ctx.stroke();
  }
  ctx.restore();
}
