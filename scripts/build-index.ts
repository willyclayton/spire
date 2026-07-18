/**
 * build-index.ts — Time Machine pipeline stage 5.
 *
 * Consumes harvested candidates (Commons + LOC + enriched), dedupes near-identical
 * views, groups photos within 25m into pins with era stacks, validates required
 * rights fields, and emits public/data/chicago-pins.json.
 *
 * Deep-layer imageUrl points at a downscaled Commons render (Special:FilePath with
 * a width cap ≈ 1600px) rather than a bundled asset, matching how the base Spire
 * app references images — keeps the repo light while staying rights-clean. To fully
 * bundle for offline, pass --bundle (downloads into public/history/ and rewrites
 * imageUrl to /history/{id}.jpg).
 *
 *   npm run tm:index
 *
 * A curated overlay (scripts/curated/history-overlay.json) can add compassAngle,
 * standHint, caption, and featured flags to specific photos — matched by pageid or
 * a title substring — which is where AR-ready bearings enter the seed set.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommonsCandidate } from './harvest-commons.ts';
import type { HistoricalPhoto, Pin, PinIndex } from '../src/history/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMONS = join(__dirname, 'cache', 'commons.json');
// Geolocated HistoricalPhoto[] sources produced by the caption-geocoding harvesters.
const GEOLOCATED_SOURCES = [
  join(__dirname, 'cache', 'commons-categories.json'),
  join(__dirname, 'cache', 'loc.json'),
  join(__dirname, 'cache', 'ia.json'),
  join(__dirname, 'cache', 'loc-enriched.json'), // legacy Claude-enriched (optional)
];
const OVERLAY = join(__dirname, 'curated', 'history-overlay.json');
const OUT = join(__dirname, '..', 'public', 'data', 'chicago-pins.json');

const GROUP_RADIUS_M = 25;
const MAX_PHOTOS_PER_PIN = 12;
const R = 6371000;

/** Prefer featured, then higher-resolution renders (a proxy for "real photo" over
 *  a tiny thumbnail). Used to pick the best representatives when capping. */
function photoScore(p: HistoricalPhoto): number {
  return (p.featured ? 1e9 : 0) + p.width * p.height;
}

/** Cap a pin's photos to `max`, spread across eras (round-robin, best-first within
 *  each era) so the timeline keeps its range instead of one era swallowing the cap. */
function capPerPin(members: HistoricalPhoto[], max: number): HistoricalPhoto[] {
  if (members.length <= max) return [...members].sort((a, b) => a.era - b.era);
  const byEra = new Map<number, HistoricalPhoto[]>();
  for (const m of members) {
    const bucket = byEra.get(m.era) ?? [];
    bucket.push(m);
    byEra.set(m.era, bucket);
  }
  for (const arr of byEra.values()) arr.sort((a, b) => photoScore(b) - photoScore(a));
  const eras = [...byEra.keys()].sort((a, b) => a - b);
  const out: HistoricalPhoto[] = [];
  for (let round = 0; out.length < max; round++) {
    let added = false;
    for (const era of eras) {
      const pick = byEra.get(era)![round];
      if (pick) {
        out.push(pick);
        added = true;
        if (out.length >= max) break;
      }
    }
    if (!added) break;
  }
  return out.sort((a, b) => a.era - b.era);
}

function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const dφ = ((b.lat - a.lat) * Math.PI) / 180;
  const dλ = ((b.lon - a.lon) * Math.PI) / 180;
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^file:/, '')
    .replace(/\.[a-z]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

interface OverlayEntry {
  pageid?: number;
  match?: string; // case-insensitive substring of the file title
  compassAngle?: number;
  standHint?: string;
  caption?: string;
  featured?: boolean;
  fovDeg?: number;
}

function candidateToPhoto(c: CommonsCandidate, usedIds: Set<string>): HistoricalPhoto {
  let id = slugify(c.title) || `c-${c.pageid}`;
  let n = 2;
  while (usedIds.has(id)) id = `${slugify(c.title)}-${n++}`;
  usedIds.add(id);
  return {
    id,
    layer: 'deep',
    lat: c.lat,
    lon: c.lon,
    precision: 'exact', // Commons geosearch candidates carry real geotags
    geocodeSource: 'geotag',
    compassAngle: c.compassAngle,
    era: c.era,
    capturedAt: c.capturedAt,
    imageUrl: c.thumbUrl,
    width: c.width,
    height: c.height,
    source: c.source,
    license: c.license,
    sourceUrl: c.sourceUrl,
    attribution: c.attribution,
    caption: c.caption,
  };
}

function main() {
  const commons: CommonsCandidate[] = existsSync(COMMONS)
    ? JSON.parse(readFileSync(COMMONS, 'utf8'))
    : [];
  const geolocated: HistoricalPhoto[] = GEOLOCATED_SOURCES.flatMap((f) =>
    existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as HistoricalPhoto[]) : [],
  );
  const overlay: OverlayEntry[] = existsSync(OVERLAY)
    ? JSON.parse(readFileSync(OVERLAY, 'utf8'))
    : [];

  const usedIds = new Set<string>();
  let photos: HistoricalPhoto[] = [];

  // Track pageid so overlay can target Commons geosearch candidates precisely.
  const pageidById = new Map<string, number>();
  for (const c of commons) {
    const p = candidateToPhoto(c, usedIds);
    pageidById.set(p.id, c.pageid);
    photos.push(p);
  }
  console.log(`  sources: ${commons.length} geotagged + ${geolocated.length} caption-geocoded`);
  for (const p of geolocated) {
    if (usedIds.has(p.id)) continue;
    usedIds.add(p.id);
    photos.push(p);
  }

  // Reject records missing required rights fields (spec §6.3).
  const before = photos.length;
  photos = photos.filter((p) => p.license && p.sourceUrl && p.imageUrl);
  if (photos.length !== before) {
    console.log(`  dropped ${before - photos.length} record(s) missing license/sourceUrl`);
  }

  // Apply curated overlay (adds bearings, hints, featured flags, captions).
  let enriched = 0;
  for (const p of photos) {
    const pageid = pageidById.get(p.id);
    const match = overlay.find(
      (o) =>
        (o.pageid !== undefined && o.pageid === pageid) ||
        (o.match && p.id.includes(slugify(o.match))),
    );
    if (!match) continue;
    if (match.compassAngle !== undefined) p.compassAngle = match.compassAngle;
    if (match.standHint) p.standHint = match.standHint;
    if (match.caption) p.caption = match.caption;
    if (match.fovDeg) p.fovDeg = match.fovDeg;
    if (match.featured) p.featured = true;
    enriched++;
  }

  // Dedupe near-identical views among REAL geotags only (same spot within 8m AND
  // same era → keep the higher-res render). Caption-geocoded photos are skipped:
  // they snap to a shared grid point (an intersection/landmark), so proximity there
  // means "same corner", not "same photo" — those stay distinct and stack in the pin.
  const byId = new Map(photos.map((p) => [p.id, p]));
  const geotags = photos
    .filter((p) => p.geocodeSource === 'geotag')
    .sort((a, b) => b.width * b.height - a.width * a.height);
  const kept: HistoricalPhoto[] = [];
  for (const p of geotags) {
    const dupe = kept.find((k) => k.era === p.era && distM(k, p) < 8);
    if (dupe) byId.delete(p.id);
    else kept.push(p);
  }
  photos = [...byId.values()];

  // Group into pins within 25m (greedy, seeded by featured then era spread).
  const pins: Pin[] = [];
  const assigned = new Set<string>();
  const order = [...photos].sort((a, b) => Number(b.featured) - Number(a.featured) || a.era - b.era);
  for (const seed of order) {
    if (assigned.has(seed.id)) continue;
    const members = photos.filter(
      (p) => !assigned.has(p.id) && distM(seed, p) <= GROUP_RADIUS_M,
    );
    for (const m of members) assigned.add(m.id);
    const centroidLat = members.reduce((s, m) => s + m.lat, 0) / members.length;
    const centroidLon = members.reduce((s, m) => s + m.lon, 0) / members.length;
    // Cap to a browsable set with era diversity — a HABS survey can stack 180 shots
    // of one building; nobody wants to page through all of them.
    const kept = capPerPin(members, MAX_PHOTOS_PER_PIN);
    pins.push({
      id: `pin-${slugify(seed.id)}`,
      lat: Math.round(centroidLat * 1e6) / 1e6,
      lon: Math.round(centroidLon * 1e6) / 1e6,
      photoIds: kept.map((m) => m.id),
      eras: [...new Set(kept.map((m) => m.era))].sort((a, b) => a - b),
      hasDeep: kept.some((m) => m.layer === 'deep'),
      featured: kept.some((m) => m.featured),
      precision: kept.some((m) => (m.precision ?? 'exact') === 'exact') ? 'exact' : 'approximate',
    });
  }

  // Prune photos no pin references anymore (the per-pin cap can orphan many).
  const referenced = new Set(pins.flatMap((p) => p.photoIds));
  photos = photos.filter((p) => referenced.has(p.id));

  const index: PinIndex = {
    pins: pins.sort((a, b) => Number(b.featured) - Number(a.featured)),
    photos,
    generatedAt: new Date().toISOString(),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(index, null, 2));

  const payloadKB = Buffer.byteLength(JSON.stringify(index), 'utf8') / 1024;
  console.log(`\nWrote ${pins.length} pins / ${photos.length} photos → ${OUT}`);
  console.log(`  Overlay-enriched: ${enriched}`);
  console.log(`  AR-ready photos (compassAngle): ${photos.filter((p) => p.compassAngle !== undefined).length}`);
  console.log(`  Featured pins: ${pins.filter((p) => p.featured).length}`);
  console.log(`  Payload: ${payloadKB.toFixed(1)} KB`);
}

main();
