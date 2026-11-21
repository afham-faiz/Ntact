/**
 * Where a landmark lands on the screen.
 *
 * The model reports landmarks as fractions of the camera frame. The frame is then
 * shown in a box of a different shape, cropped (`cover`) or letterboxed
 * (`contain`), and flipped left to right when it is a selfie view. This maps one
 * to the other so the drawn skeleton sits exactly on the hand, whatever the
 * device's orientation or the box's shape. Pure arithmetic: tested without a camera.
 */

export interface Viewport {
  /** Size of the box the picture is shown in, in CSS pixels. */
  width: number;
  height: number;
  /** Size of the camera frame itself, in its own pixels. Changes when a phone is turned. */
  sourceWidth: number;
  sourceHeight: number;
  fit: 'cover' | 'contain';
  /** True when the picture is shown flipped, like a mirror. A display choice only: the model always sees the unflipped frame. */
  mirrored: boolean;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export function pictureScale(viewport: Viewport): number {
  const { width, height, sourceWidth, sourceHeight, fit } = viewport;
  if (sourceWidth <= 0 || sourceHeight <= 0) return 1;
  const horizontal = width / sourceWidth;
  const vertical = height / sourceHeight;
  return fit === 'contain' ? Math.min(horizontal, vertical) : Math.max(horizontal, vertical);
}

/** A normalised landmark (0..1 across the camera frame) to CSS pixels in the box. */
export function toScreen(point: { x: number; y: number }, viewport: Viewport): ScreenPoint {
  const scale = pictureScale(viewport);
  const offsetX = (viewport.width - viewport.sourceWidth * scale) / 2;
  const offsetY = (viewport.height - viewport.sourceHeight * scale) / 2;
  const x = offsetX + point.x * viewport.sourceWidth * scale;
  return { x: viewport.mirrored ? viewport.width - x : x, y: offsetY + point.y * viewport.sourceHeight * scale };
}

/** The inverse: a point in the box back to normalised camera-frame coordinates. */
export function toPicture(point: ScreenPoint, viewport: Viewport): { x: number; y: number } {
  const scale = pictureScale(viewport);
  const offsetX = (viewport.width - viewport.sourceWidth * scale) / 2;
  const offsetY = (viewport.height - viewport.sourceHeight * scale) / 2;
  const x = viewport.mirrored ? viewport.width - point.x : point.x;
  return { x: (x - offsetX) / (viewport.sourceWidth * scale), y: (point.y - offsetY) / (viewport.sourceHeight * scale) };
}

/**
 * The part of the camera frame that is actually visible in the box, as fractions
 * of the frame. With `cover`, a hand can be inside the camera frame but cropped
 * off the screen; this is what tells the two apart.
 */
export function visibleRegion(viewport: Viewport): { left: number; right: number; top: number; bottom: number } {
  const a = toPicture({ x: 0, y: 0 }, viewport);
  const b = toPicture({ x: viewport.width, y: viewport.height }, viewport);
  return {
    left: Math.max(0, Math.min(a.x, b.x)),
    right: Math.min(1, Math.max(a.x, b.x)),
    top: Math.max(0, Math.min(a.y, b.y)),
    bottom: Math.min(1, Math.max(a.y, b.y)),
  };
}
