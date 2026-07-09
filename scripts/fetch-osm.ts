/**
 * Fetch Chicago buildings from Overpass API.
 * Bbox: 41.85,-87.66,41.92,-87.60 (Loop + surroundings)
 * Filter: height >= 60m OR has wikidata tag.
 * Emits: scripts/cache/osm.json
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, 'cache', 'osm.json');
const RAW_CACHE = join(__dirname, 'cache', 'osm-raw.json');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const QUERY = `
[out:json][timeout:90];
(
  way["building"]["height"](41.85,-87.66,41.92,-87.60);
  way["building"]["building:levels"](41.85,-87.66,41.92,-87.60);
  way["building"]["wikidata"](41.85,-87.66,41.92,-87.60);
);
out center tags;
`;

interface OverpassElement {
  type: string;
  id: number;
  center?: { lat: number; lon: number };
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

export interface OsmBuilding {
  osmId: number;
  lat: number;
  lon: number;
  heightM: number;
  levels?: number;
  name?: string;
  wikidata?: string;
  addr?: string;
}

const MIN_HEIGHT_M = 60;

function parseHeight(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const val = Number(m[1]);
  if (!Number.isFinite(val) || val <= 0) return undefined;
  return val;
}

function parseLevels(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const val = Number(m[1]);
  if (!Number.isFinite(val) || val <= 0) return undefined;
  return val;
}

async function fetchRaw(): Promise<OverpassResponse> {
  if (existsSync(RAW_CACHE)) {
    console.log(`Using cached Overpass response: ${RAW_CACHE}`);
    return JSON.parse(readFileSync(RAW_CACHE, 'utf8'));
  }
  console.log('Querying Overpass API...');
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'SpireApp/0.1 (skyline identifier; contact github.com/spire)',
      Accept: 'application/json',
    },
    body: `data=${encodeURIComponent(QUERY)}`,
  });
  if (!res.ok) {
    throw new Error(`Overpass failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as OverpassResponse;
  mkdirSync(dirname(RAW_CACHE), { recursive: true });
  writeFileSync(RAW_CACHE, JSON.stringify(json));
  console.log(`Cached ${json.elements.length} raw elements`);
  return json;
}

async function main() {
  const raw = await fetchRaw();
  const buildings: OsmBuilding[] = [];

  for (const el of raw.elements) {
    if (el.type !== 'way') continue;
    const center = el.center ?? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : undefined);
    if (!center) continue;
    const tags = el.tags ?? {};

    const height = parseHeight(tags['height']);
    const levels = parseLevels(tags['building:levels']);
    const derivedHeight = height ?? (levels !== undefined ? levels * 3.5 : undefined);
    const hasWikidata = !!tags['wikidata'];

    if (derivedHeight === undefined && !hasWikidata) continue;
    if (derivedHeight !== undefined && derivedHeight < MIN_HEIGHT_M && !hasWikidata) continue;

    buildings.push({
      osmId: el.id,
      lat: center.lat,
      lon: center.lon,
      heightM: derivedHeight ?? 0,
      levels,
      name: tags['name'],
      wikidata: tags['wikidata'],
      addr: tags['addr:housenumber'] && tags['addr:street'] ? `${tags['addr:housenumber']} ${tags['addr:street']}` : undefined,
    });
  }

  buildings.sort((a, b) => b.heightM - a.heightM);
  writeFileSync(CACHE, JSON.stringify(buildings, null, 2));
  console.log(`Wrote ${buildings.length} candidate buildings → ${CACHE}`);
  console.log(`  With height: ${buildings.filter((b) => b.heightM > 0).length}`);
  console.log(`  With wikidata: ${buildings.filter((b) => b.wikidata).length}`);
  console.log(`  With name: ${buildings.filter((b) => b.name).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
