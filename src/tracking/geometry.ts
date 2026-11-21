/**
 * Hand geometry: from 21 landmarks to joint-angle estimates.
 *
 * Everything here is deterministic geometry on the landmarks a tracking model
 * reports. Nothing here knows about cameras, filters, exercises or screens.
 *
 * What the numbers are, stated once and relied on everywhere else:
 *
 *  - Angles are computed from the model's 3-D "world" landmarks: a hand-shaped
 *    point set in metres whose axes are aligned with the camera. That point set is
 *    the model's ESTIMATE of the hand from one picture. Its depth is inferred, not
 *    measured, so an angle whose bend lies along the camera's line of sight depends
 *    on that inference. `inPlane` (below) says how much of a joint's bend is visible
 *    across the picture rather than along the line of sight.
 *  - Landmarks sit near joint centres as the model learned them, not on the bony
 *    landmarks a goniometer is aligned to. Agreement with goniometry is unknown
 *    until it is measured (see docs/VALIDATION_PLAN.md).
 *  - Flexion is positive. A negative value is extension past straight.
 */
import type { Finger, Hand } from '../domain/types';
import {
  CAMERA_AXIS,
  type Vec3,
  angleBetween,
  cross,
  dist,
  dot,
  mean,
  norm,
  rejectFrom,
  scale,
  sub,
  toDegrees,
  unit,
} from './vec';

// ---------- Topology ----------

export const LANDMARK_COUNT = 21;
export const WRIST = 0;

export const FINGERS: readonly Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];
export type LongFinger = Exclude<Finger, 'thumb'>;
export const LONG_FINGERS: readonly LongFinger[] = ['index', 'middle', 'ring', 'little'];

/**
 * Landmark indices along each digit, base to tip.
 * Fingers: MCP, PIP, DIP, tip. Thumb: CMC, MCP, IP, tip.
 */
export const CHAIN: Record<Finger, readonly [number, number, number, number]> = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  little: [17, 18, 19, 20],
};

export const BONES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** MCP, PIP and DIP for the fingers; MCP and IP for the thumb. */
export type JointId = 'mcp' | 'pip' | 'dip' | 'ip';

export const DIGIT_JOINTS: Record<Finger, readonly JointId[]> = {
  thumb: ['mcp', 'ip'],
  index: ['mcp', 'pip', 'dip'],
  middle: ['mcp', 'pip', 'dip'],
  ring: ['mcp', 'pip', 'dip'],
  little: ['mcp', 'pip', 'dip'],
};

/** The landmark a joint sits at. */
export function jointLandmark(finger: Finger, joint: JointId): number {
  const chain = CHAIN[finger];
  if (finger === 'thumb') return joint === 'mcp' ? chain[1] : chain[2];
  return joint === 'mcp' ? chain[0] : joint === 'pip' ? chain[1] : chain[2];
}

export function fingerOfLandmark(index: number): Finger | null {
  for (const finger of FINGERS) if ((CHAIN[finger] as readonly number[]).includes(index)) return finger;
  return null;
}

export const isHand = (points: readonly Vec3[] | null | undefined): points is Vec3[] =>
  Array.isArray(points) && points.length === LANDMARK_COUNT;

// ---------- Which hand ----------

/**
 * Left or right, from the shape alone.
 *
 * A flat hand seen palm-on and its mirror image seen from the back have the same
 * outline, so shape alone cannot always tell. Once the fingers are bent it can:
 * fingers only curl towards the palm, and the side the palm is on fixes which hand
 * it is. Returns null when the fingers are too straight to say.
 *
 * `curl` is the mean, over the four fingers, of sin(MCP) + sin(PIP) + sin(DIP),
 * signed as if this were a right hand: about +2.8 for a right fist, -2.8 for a
 * left one, 0 for a flat hand. A real camera's depth errors can make a flat hand
 * read as bent back by twenty or thirty degrees at a joint, so only a large value
 * (clearly curled fingers) is trusted.
 */
export function chiralityFromCurl(points: readonly Vec3[], threshold = 0.9): { side: Hand | null; curl: number } {
  const wrist = points[WRIST];
  // For a right hand, (index knuckle - wrist) x (little knuckle - wrist) points out of the palm.
  const normal = unit(cross(sub(points[5], wrist), sub(points[17], wrist)));
  if (norm(normal) === 0) return { side: null, curl: 0 };
  let sum = 0;
  for (const finger of LONG_FINGERS) {
    const [mcp, pip, dip, tip] = CHAIN[finger];
    const metacarpal = unit(rejectFrom(sub(points[mcp], wrist), normal));
    const axis = unit(cross(metacarpal, normal));
    const proximal = unit(sub(points[pip], points[mcp]));
    const middle = unit(sub(points[dip], points[pip]));
    const distal = unit(sub(points[tip], points[dip]));
    sum += dot(cross(metacarpal, proximal), axis) + dot(cross(proximal, middle), axis) + dot(cross(middle, distal), axis);
  }
  const curl = sum / LONG_FINGERS.length;
  return { side: curl > threshold ? 'right' : curl < -threshold ? 'left' : null, curl };
}

// ---------- The palm's own axes ----------

export interface PalmFrame {
  origin: Vec3;
  /** Wrist towards the knuckles, in the plane of the palm. */
  distal: Vec3;
  /** Towards the thumb side, in the plane of the palm. */
  radial: Vec3;
  /** Out of the palm (the way the fingers curl). */
  palmar: Vec3;
  /** Wrist to the middle knuckle. The unit every relative distance is expressed in. */
  length: number;
  /** Index knuckle to little knuckle. */
  width: number;
}

export function palmFrame(points: readonly Vec3[], side: Hand): PalmFrame {
  const wrist = points[WRIST];
  const index = points[5];
  const little = points[17];
  const normal = unit(cross(sub(index, wrist), sub(little, wrist)));
  const palmar = side === 'right' ? normal : scale(normal, -1);
  const knuckles = mean([points[5], points[9], points[13], points[17]]);
  const distal = unit(rejectFrom(sub(knuckles, wrist), palmar));
  const radial = unit(rejectFrom(rejectFrom(sub(index, little), palmar), distal));
  return { origin: wrist, distal, radial, palmar, length: dist(wrist, points[9]), width: dist(index, little) };
}

// ---------- Joint angles ----------

export type JointAngles = Record<Finger, Partial<Record<JointId, number>>>;

/**
 * The axis a finger's joints hinge about: across the finger, in the plane of the palm.
 * Built from the wrist-to-knuckle direction, which stays well defined however far the finger is bent.
 */
export function flexionAxis(points: readonly Vec3[], frame: PalmFrame, finger: LongFinger): { metacarpal: Vec3; axis: Vec3 } {
  const metacarpal = unit(rejectFrom(sub(points[CHAIN[finger][0]], points[WRIST]), frame.palmar));
  return { metacarpal, axis: unit(cross(metacarpal, frame.palmar)) };
}

/** Angle between two bones, signed by which way the joint folds about `axis`. Positive is flexion. */
function signedBend(proximal: Vec3, distal: Vec3, axis: Vec3): number {
  const angle = angleBetween(proximal, distal);
  return dot(cross(proximal, distal), axis) < 0 ? -angle : angle;
}

/**
 * Flexion estimates for every joint, in degrees.
 *
 * MCP: how far the proximal phalanx is raised towards the palm relative to the
 *      finger's own metacarpal line (wrist to knuckle), measured in the finger's
 *      sagittal plane. Spreading the fingers apart does not change it.
 * PIP, DIP, thumb MCP and IP: the angle between the two bones that meet at the joint.
 *      For the fingers it is signed (hyperextension is negative); for the thumb it is
 *      unsigned, because the thumb's hinge direction is not fixed relative to the palm.
 */
export function jointAngles(points: readonly Vec3[], frame: PalmFrame): JointAngles {
  const angles: JointAngles = { thumb: {}, index: {}, middle: {}, ring: {}, little: {} };

  for (const finger of LONG_FINGERS) {
    const [mcp, pip, dip, tip] = CHAIN[finger];
    const { metacarpal, axis } = flexionAxis(points, frame, finger);
    const proximal = sub(points[pip], points[mcp]);
    const middle = sub(points[dip], points[pip]);
    const distal = sub(points[tip], points[dip]);

    // How far a direction is raised out of the palm plane, towards the palm, in this finger's own sagittal plane.
    const raised = (vector: Vec3): number => {
      const direction = unit(vector);
      const inPlane = rejectFrom(direction, frame.palmar);
      const forward = dot(inPlane, metacarpal) >= 0 ? norm(inPlane) : -norm(inPlane);
      return toDegrees(Math.atan2(dot(direction, frame.palmar), forward));
    };
    // Measured against the finger's own metacarpal line (wrist to knuckle), not against the palm plane as a
    // whole: on a real hand the knuckles do not lie in one plane with the wrist, and a flat hand read as
    // 15 to 30 degrees away from zero when the plane was the reference.
    angles[finger].mcp = raised(proximal) - raised(sub(points[mcp], points[WRIST]));
    angles[finger].pip = signedBend(proximal, middle, axis);
    angles[finger].dip = signedBend(middle, distal, axis);
  }

  const [cmc, mcp, ip, tip] = CHAIN.thumb;
  angles.thumb.mcp = angleBetween(sub(points[mcp], points[cmc]), sub(points[ip], points[mcp]));
  angles.thumb.ip = angleBetween(sub(points[ip], points[mcp]), sub(points[tip], points[ip]));
  return angles;
}

/** MCP + PIP + DIP for a finger (MCP + IP for the thumb): the composite flexion a full fist is made of. */
export function compositeFlexion(angles: JointAngles, finger: Finger): number {
  let sum = 0;
  for (const joint of DIGIT_JOINTS[finger]) sum += angles[finger][joint] ?? 0;
  return sum;
}

/**
 * How far the fingertip is from its own knuckle, as a fraction of the finger's length.
 * Close to 1 with the finger straight, roughly 0.25 to 0.4 in a full fist. Has no unit
 * and does not depend on how big the hand is in the picture.
 */
export function tipReach(points: readonly Vec3[], finger: Finger): number {
  const [a, b, c, d] = CHAIN[finger];
  const length = dist(points[a], points[b]) + dist(points[b], points[c]) + dist(points[c], points[d]);
  return length < 1e-9 ? 0 : dist(points[a], points[d]) / length;
}

/** Thumb tip to a fingertip, in palm lengths. Landmarks sit inside the pads, so touching tips read about 0.15 to 0.25. */
export function oppositionDistance(points: readonly Vec3[], frame: PalmFrame, finger: LongFinger): number {
  return frame.length < 1e-9 ? 0 : dist(points[CHAIN.thumb[3]], points[CHAIN[finger][3]]) / frame.length;
}

// ---------- How the hand is turned to the camera ----------

/**
 * palmar / dorsal: the palm or the back of the hand faces the camera.
 * radial / ulnar:  the hand is seen edge-on, from the thumb side or the little-finger side.
 * oblique:         in between.
 * end-on:          the fingers point along the camera's line of sight.
 */
export type HandView = 'palmar' | 'dorsal' | 'radial' | 'ulnar' | 'oblique' | 'end-on';

export interface ViewInfo {
  kind: HandView;
  /** 1 when the palm (or the back of the hand) squarely faces the camera, 0 when it is edge-on. */
  facing: number;
  /** Positive when the palm side is towards the camera. */
  palmarToCamera: number;
  /** Positive when the thumb side is towards the camera. */
  radialToCamera: number;
  /** How far the hand's long axis lies along the line of sight, 0 to 1. */
  pointing: number;
}

export const VIEW_LIMITS = { endOn: 0.72, facing: 0.78, edge: 0.5 } as const;

export function handView(frame: PalmFrame): ViewInfo {
  const palmarToCamera = -dot(frame.palmar, CAMERA_AXIS);
  const radialToCamera = -dot(frame.radial, CAMERA_AXIS);
  const facing = Math.abs(palmarToCamera);
  const pointing = Math.abs(dot(frame.distal, CAMERA_AXIS));
  let kind: HandView;
  if (pointing >= VIEW_LIMITS.endOn) kind = 'end-on';
  else if (facing >= VIEW_LIMITS.facing) kind = palmarToCamera > 0 ? 'palmar' : 'dorsal';
  else if (facing <= VIEW_LIMITS.edge) kind = radialToCamera > 0 ? 'radial' : 'ulnar';
  else kind = 'oblique';
  return { kind, facing, palmarToCamera, radialToCamera, pointing };
}

// ---------- How well each joint can be seen ----------

/**
 * direct:      the joint folds mostly across the picture, so the angle is visible in the image itself.
 * inferred:    the joint folds mostly along the line of sight; the angle rests on the model's depth estimate.
 * unavailable: a landmark of this joint is hidden behind another part of the hand, or tracking is not usable.
 */
export type Grade = 'direct' | 'inferred' | 'unavailable';

export const GRADE_RANK: Record<Grade, number> = { unavailable: 0, inferred: 1, direct: 2 };

export interface JointEstimate {
  /** Flexion estimate in degrees. Present even when the grade is `unavailable`, for the developer view only. */
  deg: number;
  grade: Grade;
  /** 0 to 1: how much of this joint's bend lies across the picture. A geometric fact about the view, not a probability. */
  inPlane: number;
  /** True when the occlusion heuristic thinks a landmark of this joint is hidden. */
  occluded: boolean;
}

export type JointEstimates = Record<Finger, Partial<Record<JointId, JointEstimate>>>;

/** A joint counts as seen `direct` when at least this much of its bend lies across the picture (about 41 degrees off-plane). */
export const DIRECT_IN_PLANE = 0.75;

/**
 * How much of a joint's bend lies across the picture.
 *
 * For the fingers this is how closely the hinge axis lines up with the camera's
 * line of sight: looking straight down the hinge (a side view of the finger) shows
 * the whole bend. For the thumb the hinge is taken from the two bones themselves
 * when it is bent enough to define one, and from the palm otherwise, since a
 * straight thumb folds roughly across the palm.
 */
export function jointInPlane(points: readonly Vec3[], frame: PalmFrame, finger: Finger, joint: JointId): number {
  if (finger !== 'thumb') return Math.abs(dot(flexionAxis(points, frame, finger).axis, CAMERA_AXIS));
  const [cmc, mcp, ip, tip] = CHAIN.thumb;
  const [a, b, c] = joint === 'mcp' ? [cmc, mcp, ip] : [mcp, ip, tip];
  const first = sub(points[b], points[a]);
  const second = sub(points[c], points[b]);
  if (angleBetween(first, second) > 15) return Math.abs(dot(unit(cross(first, second)), CAMERA_AXIS));
  return Math.abs(dot(frame.palmar, CAMERA_AXIS));
}

// ---------- Occlusion heuristic (image space) ----------

interface Pixel {
  x: number;
  y: number;
  z: number;
}

/** Distance from p to the segment a-b in the picture, and the depth of the nearest point on it. */
function nearestOnSegment(p: Pixel, a: Pixel, b: Pixel): { distance: number; z: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  const t = lengthSquared < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared));
  const x = a.x + abx * t;
  const y = a.y + aby * t;
  return { distance: Math.hypot(p.x - x, p.y - y), z: a.z + (b.z - a.z) * t };
}

function insidePolygon(p: Pixel, polygon: Pixel[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const OCCLUSION = {
  /** Two parts overlap in the picture when their centre lines are closer than this many palm widths. */
  overlap: 0.17,
  /** ...and the one in front must be nearer the camera by at least this many palm widths. */
  depthMargin: 0.1,
} as const;

/**
 * Which landmarks are probably hidden behind another finger or behind the palm.
 *
 * A heuristic, and labelled as one wherever it is shown: it uses the model's
 * relative depth to decide which of two overlapping parts is in front, and that
 * depth is itself an estimate. It errs towards marking a joint hidden.
 *
 * `image` is the model's normalised picture landmarks; `aspect` is picture width / height.
 */
export function occludedLandmarks(image: readonly Vec3[], aspect: number): boolean[] {
  // Work in units of picture height, so distances mean the same in x and y. z shares x's scale.
  const pixels: Pixel[] = image.map((point) => ({ x: point.x * aspect, y: point.y, z: point.z * aspect }));
  const palmWidth = Math.hypot(pixels[5].x - pixels[17].x, pixels[5].y - pixels[17].y);
  const palmLength = Math.hypot(pixels[9].x - pixels[0].x, pixels[9].y - pixels[0].y);
  // Edge-on, the palm's width collapses in the picture; its length does not at the same time.
  const reference = Math.max(palmWidth, palmLength * 0.8);
  const overlap = reference * OCCLUSION.overlap;
  const margin = reference * OCCLUSION.depthMargin;
  const hidden = new Array<boolean>(LANDMARK_COUNT).fill(false);

  const palm = [pixels[0], pixels[1], pixels[5], pixels[9], pixels[13], pixels[17]];
  const palmDepth = (pixels[0].z + pixels[5].z + pixels[9].z + pixels[13].z + pixels[17].z) / 5;

  for (const finger of FINGERS) {
    const chain = CHAIN[finger];
    // The base of each digit is part of the palm and is never tested.
    for (const index of chain.slice(1)) {
      const point = pixels[index];
      for (const other of FINGERS) {
        if (other === finger || hidden[index]) continue;
        const otherChain = CHAIN[other];
        for (let segment = 0; segment < 3; segment += 1) {
          const near = nearestOnSegment(point, pixels[otherChain[segment]], pixels[otherChain[segment + 1]]);
          if (near.distance < overlap && near.z < point.z - margin) {
            hidden[index] = true;
            break;
          }
        }
      }
      // Behind the palm: a fist seen from the back of the hand.
      if (!hidden[index] && point.z > palmDepth + margin * 1.5 && insidePolygon(point, palm)) hidden[index] = true;
    }
  }
  return hidden;
}

/** Whether a joint's own landmark, or the one beyond it, is marked hidden. */
export function jointOccluded(hidden: readonly boolean[], finger: Finger, joint: JointId): boolean {
  const chain = CHAIN[finger];
  const at = jointLandmark(finger, joint);
  const position = (chain as readonly number[]).indexOf(at);
  const beyond = chain[Math.min(3, position + 1)];
  return hidden[at] || hidden[beyond];
}

/** Angle, view geometry and occlusion combined into one graded estimate per joint. */
export function jointEstimates(
  world: readonly Vec3[],
  frame: PalmFrame,
  hidden: readonly boolean[] | null,
): JointEstimates {
  const angles = jointAngles(world, frame);
  const estimates: JointEstimates = { thumb: {}, index: {}, middle: {}, ring: {}, little: {} };
  for (const finger of FINGERS) {
    for (const joint of DIGIT_JOINTS[finger]) {
      const inPlane = jointInPlane(world, frame, finger, joint);
      const occluded = hidden ? jointOccluded(hidden, finger, joint) : false;
      estimates[finger][joint] = {
        deg: angles[finger][joint] as number,
        inPlane,
        occluded,
        grade: occluded ? 'unavailable' : inPlane >= DIRECT_IN_PLANE ? 'direct' : 'inferred',
      };
    }
  }
  return estimates;
}

// ---------- Picture-space measures ----------

export type Framing = 'ok' | 'too-far' | 'too-close' | 'clipped';

export const FRAMING = { edge: 0.02, minSize: 0.16, maxSize: 0.86 } as const;

/** Whether the whole hand is comfortably inside the picture. `size` is the larger side of its bounding box, 0 to 1. */
export function framingOf(image: readonly Vec3[]): { framing: Framing; size: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of image) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const size = Math.max(maxX - minX, maxY - minY);
  if (minX < FRAMING.edge || maxX > 1 - FRAMING.edge || minY < FRAMING.edge || maxY > 1 - FRAMING.edge) return { framing: 'clipped', size };
  if (size < FRAMING.minSize) return { framing: 'too-far', size };
  if (size > FRAMING.maxSize) return { framing: 'too-close', size };
  return { framing: 'ok', size };
}

/** The palm's size in the picture, in units of picture height. Never zero. */
export function imagePalmSize(image: readonly Vec3[], aspect: number): number {
  const length = Math.hypot((image[9].x - image[0].x) * aspect, image[9].y - image[0].y);
  const width = Math.hypot((image[5].x - image[17].x) * aspect, image[5].y - image[17].y);
  return Math.max(length, width, 1e-6);
}
