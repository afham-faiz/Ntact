/**
 * Small 3-D vector helpers for the hand-tracking engine. Pure functions, no state.
 *
 * Coordinates throughout `src/tracking` follow the camera: x to the right of the
 * picture, y down the picture, z away from the camera. That is a right-handed
 * system, so cross products behave as usual.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
/** The direction the camera looks along. */
export const CAMERA_AXIS: Vec3 = { x: 0, y: 0, z: 1 };

export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: Vec3, b: Vec3): number => norm(sub(a, b));
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));

/** Unit vector, or the zero vector when `a` has no usable length. */
export function unit(a: Vec3): Vec3 {
  const length = norm(a);
  return length < 1e-12 ? ZERO : scale(a, 1 / length);
}

/** The part of `a` that is perpendicular to the unit vector `n`. */
export const rejectFrom = (a: Vec3, n: Vec3): Vec3 => sub(a, scale(n, dot(a, n)));

export const toDegrees = (radians: number): number => (radians * 180) / Math.PI;
export const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Unsigned angle between two directions, in degrees (0 to 180). Zero when either has no length. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const la = norm(a);
  const lb = norm(b);
  if (la < 1e-12 || lb < 1e-12) return 0;
  // atan2 of the cross and dot products keeps its precision near 0 and 180, where acos loses it.
  return toDegrees(Math.atan2(norm(cross(a, b)), dot(a, b)));
}

/** `a` rotated by `degrees` about the unit vector `axis` (right-hand rule). */
export function rotateAbout(a: Vec3, axis: Vec3, degrees: number): Vec3 {
  const angle = toRadians(degrees);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(a, c), scale(cross(axis, a), s)), scale(axis, dot(axis, a) * (1 - c)));
}

export function mean(points: readonly Vec3[]): Vec3 {
  if (points.length === 0) return ZERO;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
    z += point.z;
  }
  return v3(x / points.length, y / points.length, z / points.length);
}

export const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
