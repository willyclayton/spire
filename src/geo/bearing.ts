/**
 * Great-circle bearing + distance.
 * Public API in degrees; internals in radians.
 */

const R_EARTH_M = 6371000;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * Haversine distance in meters between two lat/lon points.
 */
export function distanceM(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const dφ = toRad(b.lat - a.lat);
  const dλ = toRad(b.lon - a.lon);
  const s =
    Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(s));
}

/**
 * Initial great-circle bearing from `from` toward `to`, in degrees clockwise from true north.
 */
export function initialBearingDeg(from: LatLon, to: LatLon): number {
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lon - from.lon);
  const θ = Math.atan2(
    Math.sin(Δλ) * Math.cos(φ2),
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ),
  );
  return (toDeg(θ) + 360) % 360;
}

/**
 * Wrap an angle delta into [-180, 180].
 * Useful for finding the signed angular difference between two bearings that may cross 0/360.
 */
export function wrap180(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * Circular mean of an array of degree headings (needed to average across the 359→0 seam).
 */
export function circularMeanDeg(headings: number[]): number {
  if (headings.length === 0) return 0;
  let x = 0;
  let y = 0;
  for (const h of headings) {
    const r = toRad(h);
    x += Math.cos(r);
    y += Math.sin(r);
  }
  return (toDeg(Math.atan2(y / headings.length, x / headings.length)) + 360) % 360;
}
