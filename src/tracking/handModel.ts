/**
 * A kinematic hand: joint angles in, 21 landmarks out.
 *
 * SYNTHETIC. Nothing this file produces was observed from a person. It exists so
 * that the geometry, the filters and the assessment engine can be driven with
 * hands whose joint angles are known exactly, turned to the camera at a known
 * angle, and so that the instructional figures and the labelled backup
 * demonstration have something honest to draw. Everything built from it is marked
 * synthetic wherever it is stored or shown.
 *
 * The model is deliberately simple: straight bones and hinge joints. Its
 * proportions are those of the app's own hand illustration
 * (components/HandIllustration.tsx): a broad square palm, the four knuckles in a
 * level row, fingers that lean only slightly, and a short thumb leaving the palm
 * low on its side at about fifty degrees. It says nothing about how a real hand moves.
 */
import type { Hand } from '../domain/types';
import { CHAIN, LONG_FINGERS, type HandView, type LongFinger } from './geometry';
import type { HandObservation } from './stabiliser';
import { add, dist, lerp, norm, rejectFrom, rotateAbout, scale, sub, unit, v3, type Vec3 } from './vec';

export interface FingerPose {
  mcp: number;
  pip: number;
  dip: number;
  /** Spread in the plane of the palm, degrees. Positive is towards the thumb side. */
  spread?: number;
}

export interface HandPose {
  side: Hand;
  fingers: Record<LongFinger, FingerPose>;
  thumb: {
    /** 0 = resting beside the palm, 1 = tip brought to `toward`'s fingertip. */
    opposition: number;
    toward: LongFinger;
    /** 0 to 1: the thumb folded at its two joints across the front of the palm, beneath the curled fingertips, as it closes in a fist. */
    across?: number;
  };
  /** 1 is an average adult hand. */
  size?: number;
}

/**
 * Knuckle positions (thumb side, towards the fingers) and phalanx lengths, in metres.
 * Taken from the illustration at 0.705 mm to one of its units: knuckles 29 units apart on a
 * palm 122 wide, fingers standing 100, 120, 108 and 76 above it.
 */
const SHAPE: Record<LongFinger, { base: [number, number]; bones: [number, number, number] }> = {
  index: { base: [0.0303, 0.0804], bones: [0.033, 0.0205, 0.017] },
  middle: { base: [0.0099, 0.0804], bones: [0.0395, 0.0245, 0.0205] },
  ring: { base: [-0.0106, 0.0804], bones: [0.0355, 0.022, 0.0185] },
  little: { base: [-0.0296, 0.0804], bones: [0.025, 0.0155, 0.013] },
};

const THUMB = {
  /** CMC joint: thumb side, towards the fingers, out of the palm. Low in the palm, so only the thumb's last two bones stand clear of it. */
  base: [0.016, 0.002, 0.006] as [number, number, number],
  bones: [0.028, 0.031, 0.026] as [number, number, number],
  /**
   * Resting direction: fifty degrees out from the fingers and a little out of the palm,
   * the way the thumb of the illustration sits out to the side.
   */
  rest: [0.766, 0.643, 0.2] as [number, number, number],
  /** A resting thumb is very slightly bent at its two joints: its tip sits this fraction of its full length from its base. */
  restReach: 0.975,
};

/** How far the fingers of a relaxed open hand fan out: 1 would continue the line from the wrist through each knuckle. */
const FAN = 0.33;

/** Named postures, as joint angles in degrees. The tendon-gliding positions hand therapists use. */
export type Posture = 'open' | 'fist' | 'hook' | 'tabletop' | 'straight-fist';

const POSTURE: Record<Posture, FingerPose> = {
  open: { mcp: 0, pip: 0, dip: 0 },
  fist: { mcp: 85, pip: 100, dip: 60 },
  hook: { mcp: 0, pip: 95, dip: 60 },
  tabletop: { mcp: 80, pip: 0, dip: 0 },
  'straight-fist': { mcp: 85, pip: 95, dip: 0 },
};

export function postureOf(posture: Posture, side: Hand, amount = 1): HandPose {
  const target = POSTURE[posture];
  const finger = (): FingerPose => ({ mcp: target.mcp * amount, pip: target.pip * amount, dip: target.dip * amount });
  return {
    side,
    fingers: { index: finger(), middle: finger(), ring: finger(), little: finger() },
    // In a fist the thumb folds in across the palm.
    thumb: { opposition: 0, toward: 'middle', across: posture === 'fist' || posture === 'straight-fist' ? amount : 0 },
  };
}

/** How far each finger has to come in for the thumb to reach its tip, in this simple model. Degrees at MCP, PIP, DIP. */
const MEET: Record<LongFinger, FingerPose> = {
  index: { mcp: 58, pip: 58, dip: 28 },
  middle: { mcp: 58, pip: 60, dip: 30 },
  ring: { mcp: 68, pip: 70, dip: 35 },
  little: { mcp: 76, pip: 76, dip: 40 },
};

/** The thumb brought towards one fingertip, the finger coming in to meet it. `amount` 1 is tip to tip. */
export function oppositionPose(side: Hand, toward: LongFinger, amount = 1): HandPose {
  const pose = postureOf('open', side);
  const meet = MEET[toward];
  pose.fingers[toward] = { mcp: meet.mcp * amount, pip: meet.pip * amount, dip: meet.dip * amount };
  pose.thumb = { opposition: amount, toward };
  return pose;
}

/** A posture between two others, joint by joint. */
export function blendPose(a: HandPose, b: HandPose, t: number): HandPose {
  const mix = (x: number, y: number) => x + (y - x) * t;
  const fingers = {} as Record<LongFinger, FingerPose>;
  for (const finger of LONG_FINGERS) {
    fingers[finger] = {
      mcp: mix(a.fingers[finger].mcp, b.fingers[finger].mcp),
      pip: mix(a.fingers[finger].pip, b.fingers[finger].pip),
      dip: mix(a.fingers[finger].dip, b.fingers[finger].dip),
      spread: mix(a.fingers[finger].spread ?? 0, b.fingers[finger].spread ?? 0),
    };
  }
  return {
    side: b.side,
    fingers,
    thumb: {
      opposition: mix(a.thumb.opposition, b.thumb.opposition),
      toward: t < 0.5 ? a.thumb.toward : b.thumb.toward,
      across: mix(a.thumb.across ?? 0, b.thumb.across ?? 0),
    },
    size: mix(a.size ?? 1, b.size ?? 1),
  };
}

/** Three bones from `origin` that end at `target`, bowing towards `bulge` when the target is nearer than their length. */
function reachChain(origin: Vec3, target: Vec3, lengths: [number, number, number], bulge: Vec3): Vec3[] {
  const [l1, l2, l3] = lengths;
  const along = unit(sub(target, origin));
  const distance = dist(origin, target);
  const total = l1 + l2 + l3;
  if (distance >= total * 0.999) {
    return [add(origin, scale(along, l1)), add(origin, scale(along, l1 + l2)), add(origin, scale(along, total))];
  }
  const chord = (bend: number) => Math.hypot(l1 + l2 * Math.cos(bend) + l3 * Math.cos(2 * bend), l2 * Math.sin(bend) + l3 * Math.sin(2 * bend));
  let low = 0;
  let high = 2.2;
  for (let step = 0; step < 40; step += 1) {
    const mid = (low + high) / 2;
    if (chord(mid) > distance) low = mid;
    else high = mid;
  }
  const bend = (low + high) / 2;
  const flat = [
    [l1, 0],
    [l1 + l2 * Math.cos(bend), l2 * Math.sin(bend)],
    [l1 + l2 * Math.cos(bend) + l3 * Math.cos(2 * bend), l2 * Math.sin(bend) + l3 * Math.sin(2 * bend)],
  ];
  const tilt = Math.atan2(flat[2][1], flat[2][0]);
  const side = unit(rejectFrom(bulge, along));
  return flat.map(([x, y]) => {
    const u = x * Math.cos(tilt) + y * Math.sin(tilt);
    const w = -x * Math.sin(tilt) + y * Math.cos(tilt);
    // The middle joints fall on the negative side of the chord; that side is pointed at `bulge`.
    return add(origin, add(scale(along, u), scale(side, -w)));
  });
}

/**
 * The 21 landmarks of a posed hand in the hand's canonical position: palm towards
 * the camera, fingers up, wrist at the origin. Metres, camera axes (x right, y down, z away).
 */
export function poseLandmarks(pose: HandPose): Vec3[] {
  const size = pose.size ?? 1;
  const distal = v3(0, -1, 0);
  const palmar = v3(0, 0, -1);
  const radial = v3(pose.side === 'right' ? 1 : -1, 0, 0);
  const local = (r: number, d: number, p = 0): Vec3 => add(add(scale(radial, r * size), scale(distal, d * size)), scale(palmar, p * size));

  const points = new Array<Vec3>(21);
  points[0] = v3(0, 0, 0);

  for (const finger of LONG_FINGERS) {
    const shape = SHAPE[finger];
    const angles = pose.fingers[finger];
    const base = local(shape.base[0], shape.base[1]);
    // A straight finger leans a little the way its knuckle sits off the middle of the hand, turned by any spread.
    const spreadSign = pose.side === 'right' ? -1 : 1;
    const straight = rotateAbout(unit(local(shape.base[0] * FAN, shape.base[1])), palmar, (angles.spread ?? 0) * spreadSign);
    const chain = CHAIN[finger];
    let position = base;
    let bend = 0;
    points[chain[0]] = position;
    const joints = [angles.mcp, angles.pip, angles.dip];
    for (let index = 0; index < 3; index += 1) {
      bend += joints[index];
      const radians = (bend * Math.PI) / 180;
      const direction = add(scale(straight, Math.cos(radians)), scale(palmar, Math.sin(radians)));
      position = add(position, scale(direction, shape.bones[index] * size));
      points[chain[index + 1]] = position;
    }
  }

  const cmc = local(THUMB.base[0], THUMB.base[1], THUMB.base[2]);
  const restDirection = unit(local(THUMB.rest[0], THUMB.rest[1], THUMB.rest[2]));
  const lengths = THUMB.bones.map((length) => length * size) as [number, number, number];
  const restTip = add(cmc, scale(restDirection, (lengths[0] + lengths[1] + lengths[2]) * THUMB.restReach));
  const fingertip = points[CHAIN[pose.thumb.toward][3]];
  // Pads touching leaves the two tip landmarks a little apart.
  const contact = add(fingertip, scale(unit(sub(cmc, fingertip)), 0.016 * size));
  let target = lerp(restTip, contact, Math.min(1, Math.max(0, pose.thumb.opposition)));
  const across = Math.min(1, Math.max(0, pose.thumb.across ?? 0));
  if (across > 0) {
    // Folded at its knuckle and last joint, its tip across the front of the palm just below the curled fingertips.
    // Below them, not over them: a thumb laid across the fingers would hide their joints from the camera.
    target = lerp(target, local(0.004, 0.033, 0.022), across);
  }
  // The thumb's knuckles bow out to its own side and forwards, out of the palm.
  const thumb = reachChain(cmc, target, lengths, add(radial, scale(palmar, 0.6)));
  points[1] = cmc;
  points[2] = thumb[0];
  points[3] = thumb[1];
  points[4] = thumb[2];
  return points;
}

// ---------- Turning the hand to the camera ----------

export interface CameraPose {
  /** Turn about the hand's long axis, degrees. 0 is palm to camera; +90 turns a right hand's thumb side to the camera. */
  yaw: number;
  /** Tip forwards or backwards, degrees. Positive tips the fingertips away from the camera. */
  pitch: number;
  /** Turn in the plane of the picture, degrees. */
  roll: number;
  /** Camera to wrist, metres. */
  distance: number;
  /** Where the middle of the hand sits in the picture, 0 to 1. */
  centreX: number;
  centreY: number;
  /** Picture width divided by height. */
  aspect: number;
  /** Focal length in picture heights. About 1 for a laptop webcam. */
  focal: number;
}

export const DEFAULT_CAMERA: CameraPose = { yaw: 0, pitch: 0, roll: 0, distance: 0.42, centreX: 0.5, centreY: 0.52, aspect: 4 / 3, focal: 1 };

/** The yaw that presents a given view of the hand to the camera. */
export function yawForView(view: Extract<HandView, 'palmar' | 'dorsal' | 'radial' | 'ulnar'>, side: Hand): number {
  const sign = side === 'right' ? 1 : -1;
  return view === 'palmar' ? 0 : view === 'dorsal' ? 180 : view === 'radial' ? 90 * sign : -90 * sign;
}

const X = v3(1, 0, 0);
const Y = v3(0, 1, 0);
const Z = v3(0, 0, 1);

/** A posed hand as the tracking model would report it from the given camera position: picture and 3-D landmarks. */
export function observePose(pose: HandPose, camera: Partial<CameraPose> = {}): HandObservation {
  const view: CameraPose = { ...DEFAULT_CAMERA, ...camera };
  const canonical = poseLandmarks(pose);
  const middle = canonical[9];
  const pivot = scale(middle, 0.5);
  const turned = canonical.map((point) => {
    let p = sub(point, pivot);
    p = rotateAbout(p, Y, view.yaw);
    p = rotateAbout(p, X, -view.pitch);
    p = rotateAbout(p, Z, view.roll);
    return p;
  });

  const depthOfWrist = view.distance + turned[0].z;
  const image = turned.map((point) => {
    const depth = view.distance + point.z;
    return v3(
      view.centreX + ((view.focal / view.aspect) * point.x) / depth,
      view.centreY + (view.focal * point.y) / depth,
      // The model reports depth relative to the wrist, on the same scale as x.
      ((view.focal / view.aspect) * (depth - depthOfWrist)) / view.distance,
    );
  });
  return { image, world: turned, label: pose.side === 'right' ? 'Right' : 'Left', score: 0.98 };
}

// ---------- Deterministic noise ----------

/** A small seeded generator, so synthetic sequences are the same on every run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** Independent noise on every landmark. `sigma` is in palm lengths, applied to the picture and 3-D landmarks alike. */
export function withNoise(observation: HandObservation, sigma: number, random: () => number): HandObservation {
  if (sigma <= 0) return observation;
  const imagePalm = Math.hypot(observation.image[9].x - observation.image[0].x, observation.image[9].y - observation.image[0].y);
  const jiggle = (points: Vec3[], amount: number) =>
    points.map((point) => v3(point.x + gaussian(random) * amount, point.y + gaussian(random) * amount, point.z + gaussian(random) * amount));
  const world = observation.world;
  return {
    ...observation,
    image: jiggle(observation.image, sigma * imagePalm),
    world: world ? jiggle(world, sigma * norm(sub(world[9], world[0]))) : null,
  };
}

/** The whole hand shifted in the picture, as a shaking camera would shift it. The hand's own shape is untouched. */
export function shifted(observation: HandObservation, dx: number, dy: number): HandObservation {
  return { ...observation, image: observation.image.map((point) => v3(point.x + dx, point.y + dy, point.z)) };
}

/** Sanity check used by the tests: every bone of a posed hand has the length the model gave it. */
export function boneLengths(points: readonly Vec3[]): number[] {
  const lengths: number[] = [];
  for (const finger of LONG_FINGERS) {
    const chain = CHAIN[finger];
    for (let index = 0; index < 3; index += 1) lengths.push(dist(points[chain[index]], points[chain[index + 1]]));
  }
  return lengths;
}
