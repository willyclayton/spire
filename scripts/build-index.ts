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
const LOC = join(__dirname, 'cache', 'loc-enriched.json');
const OVERLAY = join(__dirname, 'curated', 'history-overlay.json');
const OUT = join(__dirname, '..', 'public', 'data', 'chicago-pins.json');

const GROUP_RADIUS_M = 25;
const R = 6371000;

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
  const locEnriched: HistoricalPhoto[] = existsSync(LOC)
    ? JSON.parse(readFileSync(LOC, 'utf8'))
    : [];
  const overlay: OverlayEntry[] = existsSync(OVERLAY)
    ? JSON.parse(readFileSync(OVERLAY, 'utf8'))
    : [];

  const usedIds = new Set<string>();
  let photos: HistoricalPhoto[] = [];

  // Track pageid so overlay can target Commons candidates precisely.
  const pageidById = new Map<string, number>();
  for (const c of commons) {
    const p = candidateToPhoto(c, usedIds);
    pageidById.set(p.id, c.pageid);
    photos.push(p);
  }
  for (const p of locEnriched) {
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

  // Dedupe near-identical views: same location within 8m AND same era → keep the
  // higher-resolution render.
  const byId = new Map(photos.map((p) => [p.id, p]));
  const sorted = [...photos].sort((a, b) => b.width * b.height - a.width * a.height);
  const kept: HistoricalPhoto[] = [];
  for (const p of sorted) {
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
    members.sort((a, b) => a.era - b.era);
    const lat = members.reduce((s, m) => s + m.lat, 0) / members.length;
    const lon = members.reduce((s, m) => s + m.lon, 0) / members.length;
    pins.push({
      id: `pin-${slugify(seed.id)}`,
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      photoIds: members.map((m) => m.id),
      eras: [...new Set(members.map((m) => m.era))].sort((a, b) => a - b),
      hasDeep: members.some((m) => m.layer === 'deep'),
      featured: members.some((m) => m.featured),
    });
  }

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
