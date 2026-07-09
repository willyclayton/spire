/**
 * Merge OSM geometry + Wikidata attributes + curated overlay → chicago.json
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OsmBuilding } from './fetch-osm.ts';
import type { WikidataRecord } from './fetch-wikidata.ts';
import type { Building } from '../src/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OSM_CACHE = join(__dirname, 'cache', 'osm.json');
const WIKIDATA_CACHE = join(__dirname, 'cache', 'wikidata.json');
const OVERLAY = join(__dirname, 'curated', 'chicago-overlay.json');
const OUT = join(__dirname, '..', 'public', 'data', 'chicago.json');

const HARD_CAP = 400;
// Chicago's tallest is Willis (442m). Anything meaningfully taller than that is bad OSM data.
const MAX_PLAUSIBLE_HEIGHT_M = 500;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function computeProminence(heightM: number): number {
  return clamp(Math.round(heightM / 60), 1, 10);
}

function main() {
  const osm: OsmBuilding[] = JSON.parse(readFileSync(OSM_CACHE, 'utf8'));
  const wikidata: Record<string, WikidataRecord> = JSON.parse(readFileSync(WIKIDATA_CACHE, 'utf8'));
  const overlay: Partial<Building>[] = existsSync(OVERLAY) ? JSON.parse(readFileSync(OVERLAY, 'utf8')) : [];

  // Overlay by id (slug) — curated takes precedence on every field.
  const overlayById = new Map<string, Partial<Building>>();
  for (const o of overlay) {
    if (o.id) overlayById.set(o.id, o);
  }

  const usedIds = new Set<string>();
  const buildings: Building[] = [];

  for (const b of osm) {
    const wd = b.wikidata ? wikidata[b.wikidata] : undefined;
    const name = wd?.label ?? b.name;
    if (!name) continue;

    let id = slugify(name);
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${slugify(name)}-${suffix++}`;
    }

    // Prefer OSM if Wikidata reports a suspiciously large height (likely wrong unit or wrong record).
    let heightM = (wd?.heightM && wd.heightM > 0) ? wd.heightM : b.heightM;
    if (heightM > MAX_PLAUSIBLE_HEIGHT_M && b.heightM > 0 && b.heightM <= MAX_PLAUSIBLE_HEIGHT_M) {
      heightM = b.heightM;
    }
    if (!heightM || heightM <= 0 || heightM > MAX_PLAUSIBLE_HEIGHT_M) continue;

    const rec: Building = {
      id,
      name,
      lat: b.lat,
      lon: b.lon,
      heightM: Math.round(heightM * 10) / 10,
      floors: b.levels ? Math.round(b.levels) : undefined,
      yearCompleted: wd?.yearCompleted,
      architect: wd?.architect,
      style: wd?.style,
      wikipediaUrl: wd?.wikipediaUrl,
      imageUrl: wd?.imageUrl,
      prominence: computeProminence(heightM),
    };

    usedIds.add(id);
    buildings.push(rec);
  }

  // Add overlay-only entries (curated but not in OSM output).
  for (const o of overlay) {
    if (!o.id) continue;
    if (usedIds.has(o.id)) continue;
    if (o.lat === undefined || o.lon === undefined || o.heightM === undefined || !o.name) continue;
    buildings.push({
      id: o.id,
      name: o.name,
      lat: o.lat,
      lon: o.lon,
      heightM: o.heightM,
      floors: o.floors,
      yearCompleted: o.yearCompleted,
      architect: o.architect,
      style: o.style,
      fact: o.fact,
      description: o.description,
      wikipediaUrl: o.wikipediaUrl,
      imageUrl: o.imageUrl,
      prominence: o.prominence ?? computeProminence(o.heightM),
    });
    usedIds.add(o.id);
  }

  // Apply overlay overrides.
  for (let i = 0; i < buildings.length; i++) {
    const o = overlayById.get(buildings[i].id);
    if (!o) continue;
    buildings[i] = { ...buildings[i], ...o } as Building;
  }

  // Dedupe near-duplicate coordinates (< 30m) — keep taller.
  const kept: Building[] = [];
  const R = 6371000;
  function distM(a: Building, b: Building) {
    const φ1 = (a.lat * Math.PI) / 180;
    const φ2 = (b.lat * Math.PI) / 180;
    const dφ = ((b.lat - a.lat) * Math.PI) / 180;
    const dλ = ((b.lon - a.lon) * Math.PI) / 180;
    const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  const sorted = [...buildings].sort((a, b) => b.heightM - a.heightM);
  for (const b of sorted) {
    // Very-near same-name: identical building.
    // Near duplicates within 15m and either name overlap or similar height: probably same building.
    const dupe = kept.find((k) => {
      const d = distM(k, b);
      if (d < 15) return true;
      if (d < 40 && k.name.toLowerCase() === b.name.toLowerCase()) return true;
      return false;
    });
    if (!dupe) kept.push(b);
  }

  kept.sort((a, b) => b.prominence - a.prominence || b.heightM - a.heightM);
  const final = kept.slice(0, HARD_CAP);

  writeFileSync(OUT, JSON.stringify(final, null, 2));
  console.log(`Wrote ${final.length} buildings → ${OUT}`);
  console.log(`  With Wikipedia link: ${final.filter((b) => b.wikipediaUrl).length}`);
  console.log(`  With architect: ${final.filter((b) => b.architect).length}`);
  console.log(`  With curated fact: ${final.filter((b) => b.fact).length}`);
  const payloadKB = Buffer.byteLength(JSON.stringify(final), 'utf8') / 1024;
  console.log(`  Payload: ${payloadKB.toFixed(1)} KB`);
}

main();
