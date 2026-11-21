/**
 * Hand geometry against hands whose joint angles are known exactly.
 *
 * The hands here come from the kinematic model in src/tracking/handModel.ts, so
 * these tests show that the geometry recovers the angles it was given, from any
 * viewing direction, for either hand. They say nothing about how well a camera
 * model's landmarks match a real hand: that needs reference measurements.
 */
import { describe, expect, it } from 'vitest';
import {
  CHAIN,
  DIGIT_JOINTS,
  FINGERS,
  LONG_FINGERS,
  chiralityFromCurl,
  compositeFlexion,
  framingOf,
  handView,
  jointAngles,
  jointEstimates,
  jointInPlane,
  occludedLandmarks,
  oppositionDistance,
  palmFrame,
  tipReach,
  type LongFinger,
} from '../src/tracking/geometry';
import { boneLengths, observePose, oppositionPose, poseLandmarks, postureOf, yawForView, type HandPose } from '../src/tracking/handModel';
import type { Hand } from '../src/domain/types';
import { angleBetween, dot, rotateAbout, v3, type Vec3 } from '../src/tracking/vec';

const SIDES: Hand[] = ['left', 'right'];

function pose(side: Hand, mcp: number, pip: number, dip: number, spread = 0): HandPose {
  const finger = () => ({ mcp, pip, dip, spread });
  return { side, fingers: { index: finger(), middle: finger(), ring: finger(), little: finger() }, thumb: { opposition: 0, toward: 'index' } };
}

function anglesOf(points: Vec3[], side: Hand) {
  return jointAngles(points, palmFrame(points, side));
}

describe('vectors', () => {
  it('measures angles between directions', () => {
    expect(angleBetween(v3(1, 0, 0), v3(1, 0, 0))).toBeCloseTo(0, 6);
    expect(angleBetween(v3(1, 0, 0), v3(0, 1, 0))).toBeCloseTo(90, 6);
    expect(angleBetween(v3(1, 0, 0), v3(-1, 0, 0))).toBeCloseTo(180, 6);
    expect(angleBetween(v3(0, 0, 0), v3(1, 0, 0))).toBe(0);
  });

  it('rotates by the right-hand rule', () => {
    const turned = rotateAbout(v3(1, 0, 0), v3(0, 0, 1), 90);
    expect(turned.x).toBeCloseTo(0, 9);
    expect(turned.y).toBeCloseTo(1, 9);
  });
});

describe('the kinematic hand', () => {
  it('keeps every bone the same length in every posture', () => {
    const open = boneLengths(poseLandmarks(postureOf('open', 'right')));
    for (const posture of ['fist', 'hook', 'tabletop', 'straight-fist'] as const) {
      const lengths = boneLengths(poseLandmarks(postureOf(posture, 'right')));
      lengths.forEach((length, index) => expect(length, posture).toBeCloseTo(open[index], 9));
    }
  });

  it('makes the left hand the mirror image of the right', () => {
    const right = poseLandmarks(postureOf('fist', 'right'));
    const left = poseLandmarks(postureOf('fist', 'left'));
    right.forEach((point, index) => {
      expect(left[index].x).toBeCloseTo(-point.x, 9);
      expect(left[index].y).toBeCloseTo(point.y, 9);
      expect(left[index].z).toBeCloseTo(point.z, 9);
    });
  });
});

describe('joint angles', () => {
  it('reads a straight finger as zero at every joint', () => {
    for (const side of SIDES) {
      const angles = anglesOf(poseLandmarks(pose(side, 0, 0, 0)), side);
      for (const finger of LONG_FINGERS) {
        expect(angles[finger].mcp, `${side} ${finger}`).toBeCloseTo(0, 5);
        expect(angles[finger].pip, `${side} ${finger}`).toBeCloseTo(0, 5);
        expect(angles[finger].dip, `${side} ${finger}`).toBeCloseTo(0, 5);
      }
    }
  });

  it('recovers the MCP, PIP and DIP angles a hand was posed with, for both hands', () => {
    const cases: [number, number, number][] = [
      [30, 0, 0],
      [0, 45, 0],
      [0, 0, 60],
      [80, 0, 0],
      [0, 95, 60],
      [85, 100, 60],
      [45, 60, 20],
      [100, 110, 70],
    ];
    for (const side of SIDES) {
      for (const [mcp, pip, dip] of cases) {
        const angles = anglesOf(poseLandmarks(pose(side, mcp, pip, dip)), side);
        for (const finger of LONG_FINGERS) {
          const label = `${side} ${finger} ${mcp}/${pip}/${dip}`;
          expect(angles[finger].mcp, label).toBeCloseTo(mcp, 4);
          expect(angles[finger].pip, label).toBeCloseTo(pip, 4);
          expect(angles[finger].dip, label).toBeCloseTo(dip, 4);
        }
      }
    }
  });

  it('gives the same angles from every viewing direction', () => {
    const posed = pose('right', 55, 70, 35);
    for (const yaw of [0, 40, 90, 150, 180, -90]) {
      for (const pitch of [0, 25, -30]) {
        for (const roll of [0, 60, -120]) {
          const observation = observePose(posed, { yaw, pitch, roll });
          const angles = anglesOf(observation.world as Vec3[], 'right');
          for (const finger of LONG_FINGERS) {
            const label = `${finger} yaw ${yaw} pitch ${pitch} roll ${roll}`;
            expect(angles[finger].mcp, label).toBeCloseTo(55, 4);
            expect(angles[finger].pip, label).toBeCloseTo(70, 4);
            expect(angles[finger].dip, label).toBeCloseTo(35, 4);
          }
        }
      }
    }
  });

  it('does not mistake spreading the fingers for bending the knuckles', () => {
    for (const side of SIDES) {
      for (const spread of [-20, 15, 25]) {
        const angles = anglesOf(poseLandmarks(pose(side, 40, 50, 30, spread)), side);
        for (const finger of LONG_FINGERS) {
          expect(angles[finger].mcp, `${side} ${finger} spread ${spread}`).toBeCloseTo(40, 4);
          expect(angles[finger].pip, `${side} ${finger} spread ${spread}`).toBeCloseTo(50, 4);
        }
      }
    }
  });

  it('reads extension past straight as a negative angle', () => {
    for (const side of SIDES) {
      const angles = anglesOf(poseLandmarks(pose(side, -15, -8, 0)), side);
      expect(angles.index.mcp).toBeCloseTo(-15, 4);
      expect(angles.index.pip).toBeCloseTo(-8, 4);
    }
  });

  it('gives a mirrored set of landmarks the same angles once it is called the other hand', () => {
    // What a mirrored picture does to a right hand: x is flipped, and it is now a left hand.
    const right = poseLandmarks(pose('right', 62, 81, 44));
    const mirrored = right.map((point) => v3(-point.x, point.y, point.z));
    const angles = anglesOf(mirrored, 'left');
    expect(angles.middle.mcp).toBeCloseTo(62, 4);
    expect(angles.middle.pip).toBeCloseTo(81, 4);
    expect(angles.middle.dip).toBeCloseTo(44, 4);
    // Called the wrong hand, flexion comes out as extension: which hand it is matters.
    expect(anglesOf(mirrored, 'right').middle.mcp).toBeCloseTo(-62, 4);
  });

  it('adds the three joints into a composite, and reads the thumb as two joints', () => {
    const points = poseLandmarks(postureOf('fist', 'right'));
    const angles = anglesOf(points, 'right');
    expect(compositeFlexion(angles, 'index')).toBeCloseTo(245, 3);
    expect(DIGIT_JOINTS.thumb).toEqual(['mcp', 'ip']);
    expect(angles.thumb.mcp).toBeGreaterThanOrEqual(0);
    expect(angles.thumb.ip).toBeGreaterThanOrEqual(0);
    expect(angles.thumb.pip).toBeUndefined();
  });

  it('reports fingertip reach near 1 for a straight finger and well below for a fist', () => {
    expect(tipReach(poseLandmarks(postureOf('open', 'right')), 'index')).toBeCloseTo(1, 6);
    expect(tipReach(poseLandmarks(postureOf('fist', 'right')), 'index')).toBeLessThan(0.5);
  });
});

describe('which hand', () => {
  it('cannot tell from a flat hand', () => {
    expect(chiralityFromCurl(poseLandmarks(postureOf('open', 'right'))).side).toBeNull();
    expect(chiralityFromCurl(poseLandmarks(postureOf('open', 'left'))).side).toBeNull();
  });

  it('can tell once the fingers are bent, from any direction', () => {
    for (const side of SIDES) {
      for (const posture of ['fist', 'hook', 'tabletop'] as const) {
        for (const yaw of [0, 90, 180, -90]) {
          const world = observePose(postureOf(posture, side), { yaw, pitch: 20, roll: 30 }).world as Vec3[];
          expect(chiralityFromCurl(world).side, `${side} ${posture} yaw ${yaw}`).toBe(side);
        }
      }
    }
  });
});

describe('palm axes and view', () => {
  it('points the palm axis out of the palm for both hands', () => {
    for (const side of SIDES) {
      const frame = palmFrame(poseLandmarks(postureOf('open', side)), side);
      // The canonical hand has its palm towards the camera, which is -z.
      expect(frame.palmar.z).toBeCloseTo(-1, 6);
      expect(frame.distal.y).toBeLessThan(-0.99);
      expect(Math.sign(frame.radial.x)).toBe(side === 'right' ? 1 : -1);
      expect(dot(frame.palmar, frame.distal)).toBeCloseTo(0, 9);
      expect(dot(frame.radial, frame.distal)).toBeCloseTo(0, 9);
    }
  });

  it('names the view the hand is seen from', () => {
    for (const side of SIDES) {
      for (const view of ['palmar', 'dorsal', 'radial', 'ulnar'] as const) {
        const world = observePose(postureOf('open', side), { yaw: yawForView(view, side) }).world as Vec3[];
        expect(handView(palmFrame(world, side)).kind, `${side} ${view}`).toBe(view);
      }
      const oblique = observePose(postureOf('open', side), { yaw: 45 }).world as Vec3[];
      expect(handView(palmFrame(oblique, side)).kind).toBe('oblique');
      const endOn = observePose(postureOf('open', side), { pitch: 70 }).world as Vec3[];
      expect(handView(palmFrame(endOn, side)).kind).toBe('end-on');
    }
  });

  it('says how much of a finger bend lies across the picture: all of it side-on, none of it palm-on', () => {
    const side: Hand = 'right';
    const palmOn = observePose(postureOf('hook', side), { yaw: 0 }).world as Vec3[];
    const sideOn = observePose(postureOf('hook', side), { yaw: 90 }).world as Vec3[];
    expect(jointInPlane(palmOn, palmFrame(palmOn, side), 'middle', 'pip')).toBeLessThan(0.1);
    expect(jointInPlane(sideOn, palmFrame(sideOn, side), 'middle', 'pip')).toBeGreaterThan(0.95);
  });

  it('grades a side-on finger as direct and a palm-on finger as inferred', () => {
    const side: Hand = 'right';
    const palmOn = observePose(postureOf('hook', side), { yaw: 0 });
    const sideOn = observePose(postureOf('hook', side), { yaw: 90 });
    const front = jointEstimates(palmOn.world as Vec3[], palmFrame(palmOn.world as Vec3[], side), occludedLandmarks(palmOn.image, 4 / 3));
    const lateral = jointEstimates(sideOn.world as Vec3[], palmFrame(sideOn.world as Vec3[], side), occludedLandmarks(sideOn.image, 4 / 3));
    expect(front.index.pip?.grade).toBe('inferred');
    expect(front.index.pip?.deg).toBeCloseTo(95, 3);
    expect(lateral.index.pip?.grade).toBe('direct');
    expect(lateral.index.pip?.deg).toBeCloseTo(95, 3);
  });
});

describe('occlusion heuristic', () => {
  const hiddenFingers = (posture: 'open' | 'hook' | 'fist' | 'tabletop', view: 'palmar' | 'dorsal' | 'radial' | 'ulnar', side: Hand = 'right') => {
    const observation = observePose(postureOf(posture, side), { yaw: yawForView(view, side) });
    const hidden = occludedLandmarks(observation.image, 4 / 3);
    return Object.fromEntries(LONG_FINGERS.map((finger) => [finger, CHAIN[finger].slice(1).some((index) => hidden[index])])) as Record<LongFinger, boolean>;
  };

  it('finds nothing hidden on an open hand seen palm-on or from the back', () => {
    for (const side of SIDES) {
      for (const view of ['palmar', 'dorsal'] as const) {
        const hidden = hiddenFingers('open', view, side);
        for (const finger of LONG_FINGERS) expect(hidden[finger], `${side} ${view} ${finger}`).toBe(false);
      }
    }
  });

  it('from the thumb side, keeps the index finger and marks the fingers behind it hidden', () => {
    for (const side of SIDES) {
      for (const posture of ['open', 'hook', 'tabletop'] as const) {
        const hidden = hiddenFingers(posture, 'radial', side);
        // In a tabletop the index finger swings in behind the resting thumb, which is why that side is not the one asked for.
        if (posture !== 'tabletop') expect(hidden.index, `${side} ${posture}`).toBe(false);
        expect(hidden.middle, `${side} ${posture}`).toBe(true);
        expect(hidden.ring, `${side} ${posture}`).toBe(true);
      }
    }
  });

  it('from the little-finger side nothing is in front of the little finger, in any of the positions', () => {
    for (const side of SIDES) {
      for (const posture of ['open', 'hook', 'tabletop', 'fist'] as const) {
        const hidden = hiddenFingers(posture, 'ulnar', side);
        expect(hidden.little, `${side} ${posture}`).toBe(false);
        expect(hidden.index, `${side} ${posture}`).toBe(true);
      }
    }
  });

  it('from the little-finger side, keeps the little finger', () => {
    const hidden = hiddenFingers('hook', 'ulnar');
    expect(hidden.little).toBe(false);
    expect(hidden.ring).toBe(true);
  });

  it('keeps the fingertips of a fist seen palm-on, and hides them when seen from the back', () => {
    const front = hiddenFingers('fist', 'palmar');
    const back = hiddenFingers('fist', 'dorsal');
    expect(front.middle).toBe(false);
    expect(back.middle).toBe(true);
  });
});

describe('framing and distances', () => {
  it('accepts a hand in the middle of the picture and rejects one that is cut off, tiny or too close', () => {
    const open = postureOf('open', 'right');
    expect(framingOf(observePose(open).image).framing).toBe('ok');
    expect(framingOf(observePose(open, { centreX: 0.95 }).image).framing).toBe('clipped');
    expect(framingOf(observePose(open, { distance: 2.2 }).image).framing).toBe('too-far');
    expect(framingOf(observePose(open, { distance: 0.19, centreY: 0.5 }).image).framing).not.toBe('ok');
  });

  it('brings the thumb tip to the chosen fingertip as opposition increases', () => {
    for (const side of SIDES) {
      for (const toward of LONG_FINGERS) {
        let previous = Infinity;
        for (const opposition of [0, 0.25, 0.5, 0.75, 1]) {
          const points = poseLandmarks(oppositionPose(side, toward, opposition));
          const distance = oppositionDistance(points, palmFrame(points, side), toward);
          expect(distance, `${side} ${toward} ${opposition}`).toBeLessThan(previous + 1e-9);
          previous = distance;
        }
        expect(previous, `${side} ${toward} touching`).toBeLessThan(0.25);
      }
    }
  });

  it('lists every digit and its joints', () => {
    expect(FINGERS).toHaveLength(5);
    for (const finger of LONG_FINGERS) expect(DIGIT_JOINTS[finger]).toEqual(['mcp', 'pip', 'dip']);
  });
});
