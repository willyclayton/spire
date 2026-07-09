import type { Building, MatchLabel } from '../types';
import { distanceM, initialBearingDeg, wrap180, type LatLon } from './bearing';
import { elevationAngleDeg } from './elevation';

export const DEFAULT_FOV_DEG = 60;
export const MAX_LABELS = 7;
export const NEAR_LIMIT_M = 50;
export const FAR_LIMIT_M = 8000;

export interface MatcherInputs {
  observer: LatLon;
  headingDeg: number;
  pitchDeg: number;
  calibrationOffsetDeg: number;
  fovDeg?: number;
  buildings: Building[];
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface Candidate {
  building: Building;
  bearingDeg: number;
  distanceM: number;
  elevationAngleDeg: number;
  deltaFromHeading: number;
  score: number;
}

/**
 * Cheap FOV prefilter — anything outside the horizontal FOV (+ 5° margin) is dropped.
 */
function inFov(deltaDeg: number, fovDeg: number): boolean {
  return Math.abs(deltaDeg) <= fovDeg / 2 + 5;
}

/**
 * Occlusion heuristic: sort candidates by distance ascending; keep a building
 * only if its elevation angle is within 1.5° of, or greater than, the max
 * elevation angle of all nearer kept buildings within ±3° of the same bearing.
 * Crude but ships.
 */
export function cullOccluded(cands: Candidate[]): Candidate[] {
  const byDist = [...cands].sort((a, b) => a.distanceM - b.distanceM);
  const kept: Candidate[] = [];
  for (const c of byDist) {
    let maxNearerElev = -Infinity;
    for (const k of kept) {
      if (k.distanceM >= c.distanceM) continue;
      const bearingDelta = Math.abs(wrap180(k.bearingDeg - c.bearingDeg));
      if (bearingDelta <= 3) {
        if (k.elevationAngleDeg > maxNearerElev) maxNearerElev = k.elevationAngleDeg;
      }
    }
    if (maxNearerElev === -Infinity || c.elevationAngleDeg + 1.5 >= maxNearerElev) {
      kept.push(c);
    }
  }
  return kept;
}

/**
 * Full match pipeline: prefilter by distance and FOV, occlusion-cull, score,
 * layout screen positions, drop overlapping lower-score labels.
 */
export function matchBuildings(inputs: MatcherInputs): MatchLabel[] {
  const {
    observer,
    headingDeg,
    pitchDeg,
    calibrationOffsetDeg,
    fovDeg = DEFAULT_FOV_DEG,
    buildings,
    viewportWidth = 1,
    viewportHeight = 1,
  } = inputs;

  const effectiveHeading = (headingDeg + calibrationOffsetDeg + 360) % 360;
  const cands: Candidate[] = [];

  for (const b of buildings) {
    const d = distanceM(observer, { lat: b.lat, lon: b.lon });
    if (d < NEAR_LIMIT_M || d > FAR_LIMIT_M) continue;
    const bearing = initialBearingDeg(observer, { lat: b.lat, lon: b.lon });
    const delta = wrap180(bearing - effectiveHeading);
    if (!inFov(delta, fovDeg)) continue;

    const elev = elevationAngleDeg(b.heightM, d);
    const score = b.prominence * 2 - Math.abs(delta) / 10 - d / 2000;
    cands.push({
      building: b,
      bearingDeg: bearing,
      distanceM: d,
      elevationAngleDeg: elev,
      deltaFromHeading: delta,
      score,
    });
  }

  const visible = cullOccluded(cands).sort((a, b) => b.score - a.score);

  // Screen layout: x from Δ/FOV mapped to viewport width; y from (elevation - pitch)
  // mapped to viewport height (roughly using a vertical FOV proportional to horizontal).
  const verticalFovDeg = fovDeg * (viewportHeight / Math.max(viewportWidth, 1));
  const labels: MatchLabel[] = visible.map((c) => {
    const xNorm = 0.5 + c.deltaFromHeading / fovDeg;
    const yNorm = 0.5 - (c.elevationAngleDeg - pitchDeg) / verticalFovDeg;
    return {
      building: c.building,
      bearing: c.bearingDeg,
      distanceM: c.distanceM,
      elevationAngle: c.elevationAngleDeg,
      deltaFromHeading: c.deltaFromHeading,
      x: xNorm * viewportWidth,
      y: Math.max(24, Math.min(viewportHeight - 24, yNorm * viewportHeight)),
      score: c.score,
    };
  });

  // Greedy collision drop — labels within 100 px horizontally + 32 px vertically overlap.
  const COLLISION_X = 100;
  const COLLISION_Y = 32;
  const laidOut: MatchLabel[] = [];
  for (const label of labels) {
    if (laidOut.length >= MAX_LABELS) break;
    const collision = laidOut.some(
      (k) => Math.abs(k.x - label.x) < COLLISION_X && Math.abs(k.y - label.y) < COLLISION_Y,
    );
    if (!collision) laidOut.push(label);
  }

  return laidOut;
}
