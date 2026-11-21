/**
 * Draws the tracked hand over the camera picture.
 *
 * Pure drawing: it is handed one tracked frame and paints it. Every mark comes
 * from that frame's landmarks; when there is no hand, nothing is drawn. How a
 * joint is drawn says how it was seen:
 *
 *   filled gold ring   seen across the picture (grade: direct)
 *   open gold ring     visible, but its bend lies along the line of sight (grade: inferred)
 *   small grey dot     hidden behind another part of the hand (grade: unavailable)
 */
import type { Finger } from '../domain/types';
import { BONES, CHAIN, DIGIT_JOINTS, fingerOfLandmark, jointLandmark, type Grade, type JointId } from '../tracking/geometry';
import type { TrackedFrame } from '../tracking/tracker';
import { pictureScale, toScreen, type ScreenPoint, type Viewport } from './viewport';

const GOLD = '236, 180, 36';
const WHITE = '255, 255, 255';
const SHADE = '8, 14, 28';
const CYAN = '110, 220, 255';

export interface OverlayOptions {
  viewport: Viewport;
  /** Digits whose estimates are in use. Drawn in gold. */
  digits: readonly Finger[];
  /** The digit whose joints carry angle labels. */
  focus: Finger | null;
  /** Joints to label on the focus digit. */
  joints: readonly JointId[];
  /** Write the angle beside each labelled joint. */
  labels: boolean;
  /** Also draw the model's raw landmarks and mark the ones the occlusion check thinks are hidden. */
  debug: boolean;
  /** False while the frame is not usable for a measurement: drawn fainter. */
  active: boolean;
  now: number;
  /** When the last repetition was recorded, for a brief acknowledgement. */
  pulseAt: number | null;
  /** Painted first, under the skeleton: the drawn hand of a synthetic replay, which has no camera picture behind it. */
  underlay?(ctx: CanvasRenderingContext2D, points: { x: number; y: number; z: number }[]): void;
}

function line(ctx: CanvasRenderingContext2D, a: ScreenPoint, b: ScreenPoint): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, tone: Grade): void {
  ctx.font = `700 ${size}px "Manrope Variable", Manrope, system-ui, sans-serif`;
  const width = ctx.measureText(text).width + size * 0.9;
  const height = size * 1.55;
  const radius = height / 2;
  const left = x - width / 2;
  const top = y - height / 2;
  ctx.beginPath();
  ctx.moveTo(left + radius, top);
  ctx.arcTo(left + width, top, left + width, top + height, radius);
  ctx.arcTo(left + width, top + height, left, top + height, radius);
  ctx.arcTo(left, top + height, left, top, radius);
  ctx.arcTo(left, top, left + width, top, radius);
  ctx.closePath();
  ctx.fillStyle = `rgba(${SHADE}, 0.82)`;
  ctx.fill();
  if (tone === 'direct') {
    ctx.strokeStyle = `rgba(${GOLD}, 0.95)`;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  } else {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = `rgba(${GOLD}, 0.7)`;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = `rgb(${WHITE})`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + size * 0.04);
}

export function drawOverlay(ctx: CanvasRenderingContext2D, frame: TrackedFrame | null, options: OverlayOptions): void {
  const { viewport, digits, focus, joints, labels, debug, active, now, pulseAt } = options;
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  if (!frame || !frame.image) return;

  const p = frame.image.map((point) => toScreen(point, viewport));
  // Depth is handed over on the same scale as the screen positions, so "in front of the palm" means the same at any size.
  const depthScale = pictureScale(viewport) * viewport.sourceWidth;
  options.underlay?.(ctx, p.map((point, index) => ({ x: point.x, y: point.y, z: (frame.image as { z: number }[])[index].z * depthScale })));
  const palm = { x: (p[0].x + p[5].x + p[9].x + p[13].x + p[17].x) / 5, y: (p[0].y + p[5].y + p[9].y + p[13].y + p[17].y) / 5 };
  const size = Math.max(28, Math.hypot(p[9].x - p[0].x, p[9].y - p[0].y), Math.hypot(p[5].x - p[17].x, p[5].y - p[17].y));
  const held = frame.status === 'holding';
  const strength = held ? 0.35 : active ? 1 : 0.62;
  const core = Math.min(4.5, Math.max(1.6, size * 0.032));
  const assessed = new Set<Finger>(digits);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // A ring that opens out from the palm when a repetition is recorded.
  if (pulseAt !== null && now - pulseAt < 800) {
    const t = (now - pulseAt) / 800;
    ctx.strokeStyle = `rgba(${GOLD}, ${0.8 * (1 - t)})`;
    ctx.lineWidth = Math.max(1.5, core * 1.6 * (1 - t));
    ctx.beginPath();
    ctx.arc(palm.x, palm.y, size * (0.5 + t * 1.9), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Bones: a dark underlay so the line reads over any background, then the line itself.
  for (const pass of ['under', 'over'] as const) {
    for (const [a, b] of BONES) {
      const finger = fingerOfLandmark(a) === fingerOfLandmark(b) ? fingerOfLandmark(b) : null;
      const gold = finger !== null && assessed.has(finger);
      if (pass === 'under') {
        ctx.strokeStyle = `rgba(${SHADE}, ${0.55 * strength})`;
        ctx.lineWidth = core + 2.5;
      } else {
        ctx.strokeStyle = `rgba(${gold ? GOLD : WHITE}, ${(gold ? 0.98 : finger ? 0.86 : 0.55) * strength})`;
        ctx.lineWidth = gold ? core * 1.15 : core;
      }
      line(ctx, p[a], p[b]);
    }
  }

  // Joints.
  for (let index = 0; index < p.length; index += 1) {
    const finger = fingerOfLandmark(index);
    const gold = finger !== null && assessed.has(finger);
    const hidden = frame.hidden?.[index] ?? false;
    const tip = index !== 0 && index % 4 === 0;
    const radius = core * (tip ? 1.05 : 0.95);
    ctx.beginPath();
    ctx.arc(p[index].x, p[index].y, radius + 1.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${SHADE}, ${0.6 * strength})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p[index].x, p[index].y, radius, 0, Math.PI * 2);
    ctx.fillStyle = hidden ? `rgba(160, 170, 190, ${0.75 * strength})` : `rgba(${gold ? GOLD : WHITE}, ${strength})`;
    ctx.fill();
  }

  // The focus digit's joints: a ring whose style says how the joint was seen, and its angle.
  if (focus && frame.joints) {
    const labelSize = Math.min(15, Math.max(11, size * 0.085));
    const ring = core * 2.4;
    const wanted: { at: ScreenPoint; text: string; grade: Grade }[] = [];
    for (const joint of joints) {
      if (!DIGIT_JOINTS[focus].includes(joint)) continue;
      const estimate = frame.joints[focus][joint];
      if (!estimate) continue;
      const at = p[jointLandmark(focus, joint)];
      if (estimate.grade !== 'unavailable') {
        ctx.beginPath();
        ctx.arc(at.x, at.y, ring, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1.5, core * 0.7);
        ctx.strokeStyle = `rgba(${GOLD}, ${strength})`;
        if (estimate.grade === 'inferred') ctx.setLineDash([core * 1.4, core * 1.2]);
        ctx.stroke();
        ctx.setLineDash([]);
        wanted.push({ at, text: `${joint.toUpperCase()} ${Math.round(estimate.deg)}°`, grade: estimate.grade });
      }
    }
    if (labels && !held && wanted.length > 0) {
      // The angles are written in a column beside the hand, joined to their joints by a rule. In a fist the
      // joints sit on top of one another; a label at each joint would too.
      let minX = Infinity;
      let maxX = -Infinity;
      for (const point of p) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
      }
      const digitX = wanted.reduce((sum, item) => sum + item.at.x, 0) / wanted.length;
      const gap = labelSize * 3.4;
      const roomRight = viewport.width - maxX > gap * 1.7;
      const roomLeft = minX > gap * 1.7;
      const toRight = roomRight && (digitX >= palm.x || !roomLeft);
      const columnX = toRight ? maxX + gap : minX - gap;
      const spacing = labelSize * 2;
      const ordered = [...wanted].sort((a, b) => a.at.y - b.at.y);
      const middle = ordered.reduce((sum, item) => sum + item.at.y, 0) / ordered.length;
      const first = Math.min(viewport.height - 14 - spacing * (ordered.length - 1), Math.max(14, middle - (spacing * (ordered.length - 1)) / 2));
      ordered.forEach((item, index) => {
        const y = first + index * spacing;
        const x = Math.min(viewport.width - 34, Math.max(34, columnX));
        ctx.strokeStyle = `rgba(${GOLD}, 0.85)`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(item.at.x + (toRight ? ring : -ring), item.at.y);
        ctx.lineTo(x + (toRight ? -labelSize * 2 : labelSize * 2), y);
        ctx.stroke();
        pill(ctx, item.text, x, y, labelSize, item.grade);
      });
    }
  }

  if (debug) {
    // What the model reported this frame, before smoothing.
    if (frame.raw && frame.raw.image.length === 21) {
      ctx.fillStyle = `rgba(${CYAN}, 0.95)`;
      for (const point of frame.raw.image) {
        const at = toScreen(point, viewport);
        ctx.fillRect(at.x - 1.5, at.y - 1.5, 3, 3);
      }
    }
    // Landmarks the occlusion check thinks are hidden.
    ctx.strokeStyle = 'rgba(255, 120, 110, 0.95)';
    ctx.lineWidth = 1.5;
    for (const finger of Object.keys(CHAIN) as Finger[]) {
      for (const index of CHAIN[finger]) {
        if (!frame.hidden?.[index]) continue;
        const r = core * 1.8;
        line(ctx, { x: p[index].x - r, y: p[index].y - r }, { x: p[index].x + r, y: p[index].y + r });
        line(ctx, { x: p[index].x - r, y: p[index].y + r }, { x: p[index].x + r, y: p[index].y - r });
      }
    }
  }
}
