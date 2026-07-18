/**
 * Time Machine domain types. See TIME_MACHINE_SPEC.md §4.
 */

export interface HistoricalPhoto {
  id: string;
  layer: 'deep' | 'recent';
  lat: number;
  lon: number;
  /** Direction the camera faced, degrees true. Absence hides the AR button. */
  compassAngle?: number;
  /** Display year, e.g. 1912. */
  era: number;
  /** Full date when known (ISO-ish string). */
  capturedAt?: string;
  /** deep: bundled or archival URL; recent: Mapillary thumb URL. */
  imageUrl: string;
  width: number;
  height: number;
  /** Horizontal field of view; default 65 if unknown. */
  fovDeg?: number;
  source: string;
  license: string;
  sourceUrl: string;
  /** Display string when the license requires it. */
  attribution?: string;
  caption?: string;
  standHint?: string;
  featured?: boolean;
}

export interface Pin {
  id: string;
  lat: number;
  lon: number;
  /** Photo ids within ~25m, sorted by era ascending. */
  photoIds: string[];
  eras: number[];
  hasDeep: boolean;
  featured: boolean;
}

/** The shape of public/data/chicago-pins.json. */
export interface PinIndex {
  pins: Pin[];
  photos: HistoricalPhoto[];
  generatedAt?: string;
}
