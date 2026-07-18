/**
 * pinStore — loads the pin index, feeds the clusterer, filters by era, and answers
 * AR-button eligibility. Pure helpers (exported for tests) + a small Zustand store
 * for the loaded index and the map's filter/selection state.
 * See TIME_MACHINE_SPEC.md §3.1, §4, §7.
 */
import { create } from 'zustand';
import type { HistoricalPhoto, LocationPrecision, Pin, PinIndex } from './types';
import { distanceM } from '../geo/bearing';

// AR distance gating (spec §3.2, §3.4). Loosens when GPS is coarse.
export const AR_DISTANCE_M = 75;
export const AR_DISTANCE_LOOSE_M = 150;
export const GPS_LOOSE_ACCURACY_M = 40;

/** Photo grouping radius — must match the pipeline's build-index value (spec §4). */
export const GROUP_RADIUS_M = 25;

export const ERA_MIN = 1890;
export const ERA_NOW = new Date().getFullYear();

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** A pin passes the era filter if any of its eras falls inside the range. */
export function eraInRange(pin: Pin, min: number, max: number): boolean {
  return pin.eras.some((e) => e >= min && e <= max);
}

export function filterPinsByEra(pins: Pin[], min: number, max: number): Pin[] {
  if (min <= ERA_MIN && max >= ERA_NOW) return pins;
  return pins.filter((p) => eraInRange(p, min, max));
}

/**
 * The AR button shows only when the photo carries a bearing AND the user is close
 * enough. The threshold loosens from 75m to 150m when the GPS fix is coarse
 * (>40m accuracy), where distance itself is uncertain (spec §3.4).
 */
export function arButtonEligible(opts: {
  photo: HistoricalPhoto;
  distanceM: number;
  gpsAccuracyM: number;
}): boolean {
  if (opts.photo.compassAngle === undefined) return false;
  // Approximate (blue) placements can't support precise ghost alignment.
  if ((opts.photo.precision ?? 'exact') === 'approximate') return false;
  const threshold = opts.gpsAccuracyM > GPS_LOOSE_ACCURACY_M ? AR_DISTANCE_LOOSE_M : AR_DISTANCE_M;
  return opts.distanceM <= threshold;
}

/**
 * Greedy spatial grouping of photos into pins within `radiusM`. Used to fold
 * runtime-fetched recent photos into an existing pin (and exercised by the pipeline
 * logic in tests). Photos already sorted by era on the way in stay era-ordered.
 */
export function groupPhotosWithin(photos: HistoricalPhoto[], radiusM = GROUP_RADIUS_M): Pin[] {
  const assigned = new Set<string>();
  const pins: Pin[] = [];
  const seeds = [...photos].sort((a, b) => Number(b.featured) - Number(a.featured) || a.era - b.era);
  for (const seed of seeds) {
    if (assigned.has(seed.id)) continue;
    const members = photos.filter((p) => !assigned.has(p.id) && distanceM(seed, p) <= radiusM);
    for (const m of members) assigned.add(m.id);
    members.sort((a, b) => a.era - b.era);
    pins.push({
      id: `pin-${seed.id}`,
      lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
      lon: members.reduce((s, m) => s + m.lon, 0) / members.length,
      photoIds: members.map((m) => m.id),
      eras: [...new Set(members.map((m) => m.era))].sort((a, b) => a - b),
      hasDeep: members.some((m) => m.layer === 'deep'),
      featured: members.some((m) => Boolean(m.featured)),
      // A pin is exact if ANY grouped photo has an exact location; blue only when
      // every member is a best-guess placement.
      precision: members.some((m) => (m.precision ?? 'exact') === 'exact') ? 'exact' : 'approximate',
    });
  }
  return pins;
}

export interface PinFeatureProps {
  pinId: string;
  hasDeep: boolean;
  featured: boolean;
  count: number;
  precision: LocationPrecision;
}

/** GeoJSON point features for Supercluster (spec §3.1 clustering). */
export function pinsToFeatures(pins: Pin[]): GeoJSON.Feature<GeoJSON.Point, PinFeatureProps>[] {
  return pins.map((p) => ({
    type: 'Feature',
    properties: {
      pinId: p.id,
      hasDeep: p.hasDeep,
      featured: p.featured,
      count: p.photoIds.length,
      precision: p.precision ?? 'exact',
    },
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
  }));
}

// ── Store ───────────────────────────────────────────────────────────────────

interface HistoryState {
  index: PinIndex | null;
  photosById: Map<string, HistoricalPhoto>;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  loadIndex: () => Promise<void>;

  /** Recent (Mapillary) photos folded in at view time, keyed by photo id. */
  recentPhotos: Map<string, HistoricalPhoto>;
  addRecentPhotos: (photos: HistoricalPhoto[]) => void;

  eraRange: [number, number];
  setEraRange: (range: [number, number]) => void;

  selectedPinId: string | null;
  selectPin: (id: string | null) => void;

  selectedPhotoId: string | null;
  selectPhoto: (id: string | null) => void;

  getPhoto: (id: string) => HistoricalPhoto | undefined;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  index: null,
  photosById: new Map(),
  status: 'idle',
  loadIndex: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading' });
    try {
      const res = await fetch('/data/chicago-pins.json');
      if (!res.ok) throw new Error(`pin index ${res.status}`);
      const index = (await res.json()) as PinIndex;
      const photosById = new Map(index.photos.map((p) => [p.id, p]));
      set({ index, photosById, status: 'ready' });
    } catch (err) {
      set({ status: 'error', error: (err as Error).message });
    }
  },

  recentPhotos: new Map(),
  addRecentPhotos: (photos) =>
    set((s) => {
      const next = new Map(s.recentPhotos);
      for (const p of photos) next.set(p.id, p);
      return { recentPhotos: next };
    }),

  eraRange: [ERA_MIN, ERA_NOW],
  setEraRange: (eraRange) => set({ eraRange }),

  selectedPinId: null,
  selectPin: (selectedPinId) => set({ selectedPinId }),

  selectedPhotoId: null,
  selectPhoto: (selectedPhotoId) => set({ selectedPhotoId }),

  getPhoto: (id) => get().photosById.get(id) ?? get().recentPhotos.get(id),
}));

// Dev-only hook for automated smoke tests (see store.ts).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __spireHistory?: typeof useHistoryStore }).__spireHistory = useHistoryStore;
}
