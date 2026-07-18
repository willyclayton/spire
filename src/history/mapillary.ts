/**
 * Mapillary runtime service — the "recent" content layer (spec §5).
 *
 * Fetches street-level imagery around a pin at view time (too large to bundle),
 * filters to the best photo per (year, 30° bearing bucket), and returns them as
 * HistoricalPhoto records (layer: "recent") that merge into the pin's era timeline.
 *
 * Mapillary imagery is CC-BY-SA — callers MUST render "© Mapillary contributors"
 * whenever a recent photo is visible (spec §5, non-negotiable).
 *
 * Caching: in-memory for the session + localStorage with a 24h TTL.
 */
import type { HistoricalPhoto } from './types';
import { distanceM } from '../geo/bearing';

const TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN as string | undefined;
const GRAPH = 'https://graph.mapillary.com/images';

const BBOX_HALF_M = 60;
const MAX_DIST_M = 60;
const MIN_AGE_YEARS = 5;
const BEARING_BUCKET_DEG = 30;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = (pinId: string) => `spire.mapillary.${pinId}`;

interface MapillaryImage {
  id: string;
  computed_geometry?: { type: 'Point'; coordinates: [number, number] };
  geometry?: { type: 'Point'; coordinates: [number, number] };
  compass_angle?: number;
  captured_at?: number; // epoch ms
  thumb_2048_url?: string;
}

const memoryCache = new Map<string, HistoricalPhoto[]>();

export function mapillaryConfigured(): boolean {
  return typeof TOKEN === 'string' && TOKEN.length > 0;
}

/** Degrees of latitude/longitude covering ~`meters` at Chicago's latitude. */
function bboxAround(lat: number, lon: number, meters: number): [number, number, number, number] {
  const dLat = meters / 111_320;
  const dLon = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

function readCache(pinId: string): HistoricalPhoto[] | null {
  if (memoryCache.has(pinId)) return memoryCache.get(pinId)!;
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(CACHE_KEY(pinId));
  if (!raw) return null;
  try {
    const { at, photos } = JSON.parse(raw) as { at: number; photos: HistoricalPhoto[] };
    if (Date.now() - at > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY(pinId));
      return null;
    }
    memoryCache.set(pinId, photos);
    return photos;
  } catch {
    return null;
  }
}

function writeCache(pinId: string, photos: HistoricalPhoto[]): void {
  memoryCache.set(pinId, photos);
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY(pinId), JSON.stringify({ at: Date.now(), photos }));
  } catch {
    /* quota — in-memory cache still serves this session */
  }
}

/**
 * Reduce raw Mapillary images to the best one per (year, 30° bearing bucket):
 * within range, old enough, and — within a bucket — the newest survivor wins
 * (highest chance of a clean 2048px render).
 */
export function selectBestImages(
  images: MapillaryImage[],
  pin: { lat: number; lon: number },
): HistoricalPhoto[] {
  const nowYear = new Date().getFullYear();
  const best = new Map<string, { photo: HistoricalPhoto; capturedAt: number }>();

  for (const img of images) {
    const coords = (img.computed_geometry ?? img.geometry)?.coordinates;
    if (!coords || !img.thumb_2048_url || img.captured_at == null) continue;
    const [lon, lat] = coords;
    if (distanceM(pin, { lat, lon }) > MAX_DIST_M) continue;

    const year = new Date(img.captured_at).getFullYear();
    if (nowYear - year < MIN_AGE_YEARS) continue;

    const bearing = img.compass_angle ?? 0;
    const bucket = Math.round(bearing / BEARING_BUCKET_DEG);
    const key = `${year}:${bucket}`;

    const photo: HistoricalPhoto = {
      id: `mapillary-${img.id}`,
      layer: 'recent',
      lat,
      lon,
      compassAngle: img.compass_angle,
      era: year,
      capturedAt: new Date(img.captured_at).toISOString(),
      imageUrl: img.thumb_2048_url,
      width: 2048,
      height: 1152,
      fovDeg: 65,
      source: 'Mapillary',
      license: 'CC-BY-SA',
      sourceUrl: `https://www.mapillary.com/app/?pKey=${img.id}`,
      attribution: '© Mapillary contributors',
    };

    const existing = best.get(key);
    if (!existing || img.captured_at > existing.capturedAt) {
      best.set(key, { photo, capturedAt: img.captured_at });
    }
  }

  // Keep only a few of the most recent views — the timeline collapses these into a
  // single "Now" stop, so a dozen near-identical same-year frames are just clutter.
  return [...best.values()]
    .sort((a, b) => b.capturedAt - a.capturedAt)
    .slice(0, 3)
    .map((v) => v.photo)
    .sort((a, b) => a.era - b.era);
}

/**
 * Fetch + filter recent imagery around a pin. Returns [] when unconfigured or on
 * error (recent layer is optional; the deep layer stands alone).
 */
export async function fetchRecentForPin(pin: {
  id: string;
  lat: number;
  lon: number;
}): Promise<HistoricalPhoto[]> {
  const cached = readCache(pin.id);
  if (cached) return cached;
  if (!mapillaryConfigured()) return [];

  const [lonMin, latMin, lonMax, latMax] = bboxAround(pin.lat, pin.lon, BBOX_HALF_M);
  const url =
    `${GRAPH}?access_token=${TOKEN}` +
    `&fields=id,computed_geometry,compass_angle,captured_at,thumb_2048_url` +
    `&bbox=${lonMin},${latMin},${lonMax},${latMax}&limit=100`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: MapillaryImage[] };
    const photos = selectBestImages(data.data ?? [], pin);
    writeCache(pin.id, photos);
    return photos;
  } catch {
    return [];
  }
}
