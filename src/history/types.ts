/**
 * Time Machine domain types. See TIME_MACHINE_SPEC.md §4.
 */

/**
 * How trustworthy the lat/lon is.
 * - `exact`: real coordinates (EXIF geotag / precise geocode of an address or
 *   intersection) — rendered as a yellow/gold dot.
 * - `approximate`: a best-guess / general-area placement (neighborhood centroid,
 *   vague caption) — rendered as a blue dot so it doesn't overpromise.
 */
export type LocationPrecision = 'exact' | 'approximate';

export interface HistoricalPhoto {
  id: string;
  layer: 'deep' | 'recent';
  lat: number;
  lon: number;
  /** Location trustworthiness (default 'exact' when absent, for geotagged sources). */
  precision?: LocationPrecision;
  /** How the location was derived, e.g. "geotag", "intersection: State & Madison", "neighborhood: Bronzeville". */
  geocodeSource?: string;
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
  /** 'exact' if any grouped photo has an exact location; else 'approximate' (blue dot). */
  precision: LocationPrecision;
}

/** The shape of public/data/chicago-pins.json. */
export interface PinIndex {
  pins: Pin[];
  photos: HistoricalPhoto[];
  generatedAt?: string;
}
