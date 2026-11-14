/**
 * Draws the tracked hand over the camera picture (or, in the demonstration, on its own).
 *
 * Pure drawing: it is handed landmarks and a little state, and paints one frame.
 * The injured finger is picked out in mint; everything else is white. Nothing
 * here shows a number.
 */
import { FINGER_CHAIN, HAND_BONES, type HandFrame, type Point3 } from '../domain/exercise';
import type { Finger } from '../domain/types';

const MINT = '236, 180, 36';
const WHITE = '255, 255, 255';
const NAVY_FLESH = '52, 70, 107';

export interface DrawOptions {
  /** CSS pixel size of the canvas. */
  width: number;
  height: number;
  /** Size of the picture the landmarks refer to, in its own pixels. */
  sourceWidth: number;
  sourceHeight: number;
  /** 'cover' matches a camera picture shown with object-fit: cover. 'contain' keeps the whole drawn hand in view. */
  fit: 'cover' | 'contain';
  /** True for a selfie camera, which is shown flipped like a mirror. */
  mirrored: boolean;
  /** Draw a solid stylised hand under the skeleton. Used when there is no camera picture behind it. */
  solid: boolean;
  injured: Finger;
  /** 0..1, how closed the hand is. Drives the glow. */
  closure: number;
  /** False while the hand is in view but not yet counted (framing, settling). Drawn dimmer. */
  active: boolean;
  /** Milliseconds since the last completed repetition, or null. */
  sinceRep: number | null;
  now: number;
}

interface Pixel {
  x: number;
  y: number;
}

/** Landmarks to canvas pixels, matching a picture shown with `object-fit: cover`. */
function project(points: Point3[], options: DrawOptions): Pixel[] {
  const { width, height, sourceWidth, sourceHeight, mirrored, fit } = options;
  const scale =
    fit === 'contain' ? Math.min(width / sourceWidth, height / sourceHeight) : Math.max(width / sourceWidth, height / sourceHeight);
  const offsetX = (width - sourceWidth * scale) / 2;
  const offsetY = (height - sourceHeight * scale) / 2;
  return points.map((point) => {
    const x = offsetX + point.x * sourceWidth * scale;
    return { x: mirrored ? width - x : x, y: offsetY + point.y * sourceHeight * scale };
  });
}

function boneFinger(a: number, b: number): Finger | null {
  for (const finger of Object.keys(FINGER_CHAIN) as Finger[]) {
    const chain = FINGER_CHAIN[finger];
    if (chain.includes(a as never) && chain.includes(b as never)) return finger;
  }
  return null;
}

function line(ctx: CanvasRenderingContext2D, a: Pixel, b: Pixel): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export function drawHand(ctx: CanvasRenderingContext2D, frame: HandFrame | null, options: DrawOptions): void {
  const { width, height, injured, closure, active, sinceRep, now, solid } = options;
  ctx.clearRect(0, 0, width, height);
  if (!frame) return;

  const p = project(frame.image, options);
  const palm = [0, 5, 9, 13, 17].reduce((sum, index) => ({ x: sum.x + p[index].x / 5, y: sum.y + p[index].y / 5 }), { x: 0, y: 0 });
  // Wrist to the middle knuckle: a steady measure of how big the hand is on screen.
  const size = Math.max(24, Math.hypot(p[9].x - p[0].x, p[9].y - p[0].y));
  const strength = active ? 1 : 0.55;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // A soft light behind the hand that gathers as the fist closes.
  const glow = ctx.createRadialGradient(palm.x, palm.y, size * 0.1, palm.x, palm.y, size * (2.3 - closure * 0.7));
  glow.addColorStop(0, `rgba(${MINT}, ${(0.16 + closure * 0.2) * strength})`);
  glow.addColorStop(1, `rgba(${MINT}, 0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // A ring that opens out from the palm each time a repetition is completed.
  if (sinceRep !== null && sinceRep < 900) {
    const t = sinceRep / 900;
    ctx.strokeStyle = `rgba(${MINT}, ${0.75 * (1 - t)})`;
    ctx.lineWidth = Math.max(1.5, size * 0.05 * (1 - t));
    ctx.beginPath();
    ctx.arc(palm.x, palm.y, size * (0.6 + t * 2.2), 0, Math.PI * 2);
    ctx.stroke();
  }

  if (solid) {
    // The demonstration has no camera picture, so the hand is given some body.
    ctx.strokeStyle = `rgb(${NAVY_FLESH})`;
    ctx.fillStyle = `rgb(${NAVY_FLESH})`;
    ctx.beginPath();
    for (const [step, index] of [0, 1, 5, 9, 13, 17].entries()) {
      if (step === 0) ctx.moveTo(p[index].x, p[index].y);
      else ctx.lineTo(p[index].x, p[index].y);
    }
    ctx.closePath();
    ctx.lineWidth = size * 0.34;
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = size * 0.3;
    for (const [a, b] of HAND_BONES) if (boneFinger(a, b)) line(ctx, p[a], p[b]);
    ctx.lineWidth = size * 0.36;
    line(ctx, p[0], p[1]);
  } else {
    ctx.fillStyle = `rgba(${MINT}, ${0.1 * strength})`;
    ctx.beginPath();
    for (const [step, index] of [0, 1, 5, 9, 13, 17].entries()) {
      if (step === 0) ctx.moveTo(p[index].x, p[index].y);
      else ctx.lineTo(p[index].x, p[index].y);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Bones: a blurred pass for the glow, then a crisp pass on top.
  const core = Math.max(2, size * 0.045);
  for (const pass of ['glow', 'core'] as const) {
    for (const [a, b] of HAND_BONES) {
      const finger = boneFinger(a, b);
      const highlighted = finger === injured;
      const colour = highlighted ? MINT : WHITE;
      if (pass === 'glow') {
        ctx.shadowColor = `rgba(${colour}, ${0.9 * strength})`;
        ctx.shadowBlur = highlighted ? size * 0.28 : size * 0.16;
        ctx.strokeStyle = `rgba(${colour}, ${(highlighted ? 0.5 : 0.22) * strength})`;
        ctx.lineWidth = core * (highlighted ? 2.4 : 1.8);
      } else {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(${colour}, ${(highlighted ? 1 : finger ? 0.86 : 0.5) * strength})`;
        ctx.lineWidth = highlighted ? core * 1.25 : core;
      }
      line(ctx, p[a], p[b]);
    }
  }
  ctx.shadowBlur = 0;

  // Joints.
  for (let index = 0; index < p.length; index += 1) {
    const finger = (Object.keys(FINGER_CHAIN) as Finger[]).find((name) => FINGER_CHAIN[name].includes(index as never));
    const highlighted = finger === injured;
    const tip = index % 4 === 0 && index !== 0;
    ctx.fillStyle = `rgba(${highlighted ? MINT : WHITE}, ${strength})`;
    ctx.beginPath();
    ctx.arc(p[index].x, p[index].y, core * (tip ? 1.15 : 0.82), 0, Math.PI * 2);
    ctx.fill();
  }

  // A slow halo on the injured fingertip, so it is obvious which finger the app is watching.
  const tip = p[FINGER_CHAIN[injured][3]];
  const beat = (Math.sin(now / 420) + 1) / 2;
  ctx.strokeStyle = `rgba(${MINT}, ${(0.35 + beat * 0.45) * strength})`;
  ctx.lineWidth = Math.max(1.5, core * 0.5);
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, core * (2.3 + beat * 0.9), 0, Math.PI * 2);
  ctx.stroke();
}
