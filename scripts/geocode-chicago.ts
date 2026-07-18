/**
 * geocode-chicago.ts — offline geocoder for Chicago photo captions.
 *
 * Chicago's address grid is mathematical: State St (E/W = 0) and Madison St
 * (N/S = 0) is the origin, and 800 address units = 1 mile. So any intersection,
 * street address, or numbered cross-street can be converted to lat/lon with
 * arithmetic — no geocoding API, no rate limits. Named landmarks and neighborhood
 * centroids cover captions that don't give a grid position.
 *
 * Returns a precision tier that drives the map's yellow (exact) vs blue
 * (approximate / general area) dots.
 *
 * Data tables (streets/landmarks/neighborhoods) live in geocode-data.ts.
 */
import { GRID, STREETS, LANDMARKS, NEIGHBORHOODS } from './geocode-data.ts';

export interface GeocodeResult {
  lat: number;
  lon: number;
  precision: 'exact' | 'approximate';
  /** Human-readable derivation, e.g. "intersection: State & Madison". */
  source: string;
}

/** Signed grid units → lat/lon. East + / West −, North + / South −. */
export function gridToLatLon(ewSignedUnits: number, nsSignedUnits: number): { lat: number; lon: number } {
  return {
    lat: GRID.origin.lat + (nsSignedUnits / 800) * GRID.latPerMile,
    lon: GRID.origin.lon + (ewSignedUnits / 800) * GRID.lonPerMile,
  };
}

const STREET_SUFFIX = String.raw`(?:st(?:reet)?|ave(?:nue)?|blvd|boulevard|rd|road|dr(?:ive)?|pl(?:ace)?|pkwy|parkway|ct|court|ln|lane|ter(?:race)?|way)`;

interface GridStreet {
  grid: number;
  /** 'E'|'W' for N-S-running streets (numbered E/W); 'N'|'S' for E-W-running streets. */
  dir: 'N' | 'S' | 'E' | 'W';
  /** 'ns' = a north-south running street; 'ew' = an east-west running street. */
  axis: 'ns' | 'ew';
}

function normalizeStreet(name: string): string {
  return name
    .toLowerCase()
    .replace(new RegExp(`\\s+${STREET_SUFFIX}\\.?\\s*$`, 'i'), '')
    .replace(/\bn(orth)?\.?\s+|\bs(outh)?\.?\s+|\be(ast)?\.?\s+|\bw(est)?\.?\s+/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/** Numbered E-W streets are arithmetic: "29th" → 2900 South. */
function numberedStreet(token: string): GridStreet | null {
  const m = token.match(/^(\d{1,3})(?:st|nd|rd|th)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 138) return null; // 138th St is the far south edge
  return { grid: n * 100, dir: 'S', axis: 'ew' };
}

function lookupStreet(name: string): GridStreet | null {
  const norm = normalizeStreet(name);
  if (!norm) return null;
  const numbered = numberedStreet(norm);
  if (numbered) return numbered;
  const entry = (STREETS as Record<string, GridStreet>)[norm];
  return entry ?? null;
}

function signedUnits(s: GridStreet): { ew: number | null; ns: number | null } {
  const v = s.dir === 'W' || s.dir === 'S' ? -s.grid : s.grid;
  return s.axis === 'ns' ? { ew: v, ns: null } : { ew: null, ns: v };
}

/** "State & Madison", "Wabash Ave and 29th Street", "Clark St at Lake". */
export function parseIntersection(text: string): GeocodeResult | null {
  const t = text.replace(/\s+/g, ' ');
  const re = new RegExp(
    String.raw`\b([A-Za-z0-9.'\- ]{2,28}?)\s+(?:and|&|at|near|corner of|along|just (?:north|south|east|west) of)\s+([A-Za-z0-9.'\- ]{2,28}?)\b`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const a = lookupStreet(m[1]);
    const b = lookupStreet(m[2]);
    if (!a || !b) continue;
    const ua = signedUnits(a);
    const ub = signedUnits(b);
    // Need one N-S street and one E-W street to fix a point.
    const ew = ua.ew ?? ub.ew;
    const ns = ua.ns ?? ub.ns;
    if (ew === null || ns === null) continue;
    return { ...gridToLatLon(ew, ns), precision: 'exact', source: `intersection: ${m[1].trim()} & ${m[2].trim()}` };
  }
  return null;
}

/** "179 N State Street", "720 S Michigan Avenue". */
export function parseAddress(text: string): GeocodeResult | null {
  const re = new RegExp(
    String.raw`\b(\d{1,5})\s+(N|S|E|W|north|south|east|west)\.?\s+([A-Za-z0-9.'\- ]{2,28}?)\s+${STREET_SUFFIX}\b`,
    'i',
  );
  const m = text.match(re);
  if (!m) return null;
  const num = Number(m[1]);
  const dir = m[2][0].toUpperCase() as 'N' | 'S' | 'E' | 'W';
  const street = lookupStreet(m[3]);
  if (!street) return null;
  // The house number gives the position ALONG the named street's axis; the street's
  // own grid gives the perpendicular offset.
  const along = dir === 'W' || dir === 'S' ? -num : num;
  const cross = signedUnits(street);
  let ew: number, ns: number;
  if (street.axis === 'ns') {
    // Named street runs N-S → its grid is the E/W position; house number runs N/S.
    ew = cross.ew!;
    ns = along;
  } else {
    ns = cross.ns!;
    ew = along;
  }
  return { ...gridToLatLon(ew, ns), precision: 'exact', source: `address: ${m[0].trim()}` };
}

export function parseLandmark(text: string): GeocodeResult | null {
  const lower = text.toLowerCase();
  for (const lm of LANDMARKS) {
    if (lm.aliases.some((a) => lower.includes(a))) {
      return { lat: lm.lat, lon: lm.lon, precision: 'exact', source: `landmark: ${lm.name}` };
    }
  }
  return null;
}

/** Stable pseudo-random offset (up to ~radiusM) so area photos scatter, not stack. */
function jitter(seed: string, lat: number, lon: number, radiusM: number): { lat: number; lon: number } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const r = ((h >>> 0) / 0xffffffff) * radiusM;
  const theta = (((Math.imul(h, 2654435761) >>> 0) / 0xffffffff) * 2 - 1) * Math.PI;
  const dLat = (r * Math.cos(theta)) / 111_320;
  const dLon = (r * Math.sin(theta)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}

export function parseNeighborhood(text: string, seed = ''): GeocodeResult | null {
  const lower = text.toLowerCase();
  // Longest alias first so "near north side" beats "north".
  const sorted = [...NEIGHBORHOODS].sort(
    (a, b) => Math.max(...b.aliases.map((x) => x.length)) - Math.max(...a.aliases.map((x) => x.length)),
  );
  for (const n of sorted) {
    if (n.aliases.some((a) => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower))) {
      const j = jitter(seed || text, n.lat, n.lon, 260);
      return { lat: j.lat, lon: j.lon, precision: 'approximate', source: `neighborhood: ${n.name}` };
    }
  }
  return null;
}

/** Direction the camera faced, from "looking north" / "facing SE" etc. */
export function parseBearing(text: string): number | undefined {
  const m = text.match(/\b(?:looking|facing|view(?:\s+looking)?)\s+(north|south|east|west|n\.?e\.?|n\.?w\.?|s\.?e\.?|s\.?w\.?|northeast|northwest|southeast|southwest)\b/i);
  if (!m) return undefined;
  const d = m[1].toLowerCase().replace(/\./g, '');
  const map: Record<string, number> = {
    north: 0, n: 0, northeast: 45, ne: 45, east: 90, e: 90, southeast: 135, se: 135,
    south: 180, s: 180, southwest: 225, sw: 225, west: 270, w: 270, northwest: 315, nw: 315,
  };
  return map[d];
}

/**
 * Full geocode: try the most precise interpretation first. Returns null when the
 * caption yields nothing placeable (dropped — no pin is an acceptable outcome).
 */
export function geocodeChicago(text: string, seed = ''): (GeocodeResult & { compassAngle?: number }) | null {
  if (!text) return null;
  const bearing = parseBearing(text);
  const result =
    parseIntersection(text) ??
    parseAddress(text) ??
    parseLandmark(text) ??
    parseNeighborhood(text, seed);
  if (!result) return null;
  return bearing !== undefined ? { ...result, compassAngle: bearing } : result;
}
