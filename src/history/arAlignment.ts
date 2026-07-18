/**
 * AR ghost alignment math + manual-override state. See TIME_MACHINE_SPEC.md §3.3.
 *
 * The auto-offset slides the historical photo horizontally so that physically
 * rotating your body to face the photo's original bearing brings it to center —
 * teaching the interaction without a tutorial. The first manual gesture freezes
 * that auto-offset and hands control to the user (their alignment wins), persisted
 * per-photo so a good manual fit survives a reload.
 */
import { wrap180 } from '../geo/bearing';

/** Spire's camera horizontal field of view (spec §3.3.4). */
export const AR_FOV_DEG = 60;

export interface GhostTransform {
  /** Horizontal pan in pixels (0 = centered). */
  offsetX: number;
  /** Vertical pan in pixels. */
  offsetY: number;
  scale: number;
  rotationDeg: number;
}

export const IDENTITY_TRANSFORM: GhostTransform = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotationDeg: 0,
};

/**
 * Horizontal auto-offset in pixels.
 *
 * offsetX = wrap180(compassAngle − heading) / fovDeg × screenWidth
 *
 * Positive when the photo's bearing is clockwise (to the right) of where you face,
 * so the ghost sits to the right until you turn toward it. The wrap180 makes the
 * 359°→0° seam continuous: facing 359° at a 1° subject yields a small offset, not a
 * near-full-screen jump.
 */
export function autoOffsetX(
  compassAngle: number,
  headingDeg: number,
  screenWidth: number,
  fovDeg: number = AR_FOV_DEG,
): number {
  return (wrap180(compassAngle - headingDeg) / fovDeg) * screenWidth;
}

/** Auto transform: horizontal offset only, everything else identity. */
export function autoTransform(
  compassAngle: number,
  headingDeg: number,
  screenWidth: number,
  fovDeg: number = AR_FOV_DEG,
): GhostTransform {
  return { ...IDENTITY_TRANSFORM, offsetX: autoOffsetX(compassAngle, headingDeg, screenWidth, fovDeg) };
}

export interface EffectiveInput {
  /** Null when there is no bearing / no compass — ghost starts centered. */
  auto: {
    compassAngle: number;
    headingDeg: number;
    screenWidth: number;
    fovDeg?: number;
  } | null;
  /** Non-null once the user has taken manual control (their alignment wins). */
  manual: GhostTransform | null;
}

/**
 * The transform actually applied to the ghost. Manual override, once present,
 * fully replaces auto-tracking. Falls back to identity when neither is available.
 */
export function effectiveTransform({ auto, manual }: EffectiveInput): GhostTransform {
  if (manual) return manual;
  if (auto) return autoTransform(auto.compassAngle, auto.headingDeg, auto.screenWidth, auto.fovDeg);
  return IDENTITY_TRANSFORM;
}

/**
 * Freeze the current auto-offset as the seed of a manual transform. Called on the
 * first manual touch so the ghost does not jump — the user keeps exactly what they
 * saw and drags from there.
 */
export function freezeAuto(currentAutoOffsetX: number): GhostTransform {
  return { ...IDENTITY_TRANSFORM, offsetX: currentAutoOffsetX };
}

/** True once the transform differs from identity — gates the "Reset alignment" chip. */
export function isTransformed(t: GhostTransform | null): boolean {
  if (!t) return false;
  return (
    Math.abs(t.offsetX) > 0.5 ||
    Math.abs(t.offsetY) > 0.5 ||
    Math.abs(t.scale - 1) > 0.001 ||
    Math.abs(t.rotationDeg) > 0.1
  );
}

// ── Per-photo persistence ────────────────────────────────────────────────────

const KEY = (photoId: string) => `spire.ar.transform.${photoId}`;

export function loadTransform(photoId: string): GhostTransform | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(KEY(photoId));
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as GhostTransform;
    if (
      typeof t.offsetX === 'number' &&
      typeof t.offsetY === 'number' &&
      typeof t.scale === 'number' &&
      typeof t.rotationDeg === 'number'
    ) {
      return t;
    }
  } catch {
    /* ignore corrupt entry */
  }
  return null;
}

export function saveTransform(photoId: string, t: GhostTransform): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY(photoId), JSON.stringify(t));
}

/** Reset alignment: drop the manual transform so the ghost returns to auto-tracking. */
export function clearTransform(photoId: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY(photoId));
}
