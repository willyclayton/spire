import { toDeg } from './bearing';

const EYE_HEIGHT_M = 1.6;

/**
 * Angle in degrees from horizontal to the top of a building of `heightM`
 * seen from `distanceM` away. Ignores Earth curvature (V1 simplification).
 */
export function elevationAngleDeg(heightM: number, distanceM: number): number {
  if (distanceM <= 0) return 90;
  return toDeg(Math.atan2(heightM - EYE_HEIGHT_M, distanceM));
}
