/**
 * harvest-commons.ts — Time Machine pipeline stage 1.
 *
 * Geosearch sweep over a grid covering the Chicago Loop / riverfront / lakefront
 * and near neighborhoods. Wikimedia Commons is the only source where location +
 * license + image arrive together (MediaWiki geosearch over namespace-6 image
 * files), so it is the primary automated source: output arrives pre-geolocated.
 *
 * Two phases, because asking geosearch for coordinates AND full extmetadata on
 * hundreds of files at once times out (504):
 *   A. cheap `list=geosearch` per grid cell → {pageid, title, lat, lon}
 *   B. batched `prop=imageinfo|extmetadata` (50 pageids/call) → license + date
 * License-filter and date-filter here; grouping happens in build-index.ts.
 *
 *   npm run tm:commons   →  scripts/cache/commons.json
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'cache', 'commons.json');
const HITS_CACHE = join(__dirname, 'cache', 'commons-hits.json');

// Inspect every geotagged file. Historical photos are spread across the grid, not
// concentrated at the Loop center, so we inspect in natural (grid-sweep) order.
// Incremental writes after every batch mean progress is never lost if the API
// throttles late in the run.
const MAX_INSPECT = Infinity;

const UA = 'SpireTimeMachine/0.1 (https://spire.app; historical photo harvest)';
const API = 'https://commons.wikimedia.org/w/api.php';

// Deep-layer window: 1890s–1980s per spec. Newer is "recent" territory (Mapillary
// handles that at runtime), so we drop it from the archival harvest.
const DEEP_MIN_YEAR = 1855;
const DEEP_MAX_YEAR = 1990;

const SEARCH_RADIUS_M = 3000; // list=geosearch max is 10km, but keep responses light
const SEARCH_LIMIT = 500;
const BATCH = 50; // MediaWiki pageids-per-request limit for anonymous callers

// Dense grid over the core where historical geotagged photos concentrate.
const GRID: Array<{ lat: number; lon: number }> = [];
{
  const latMin = 41.78, latMax = 41.95;
  const lonMin = -87.72, lonMax = -87.58;
  const step = 0.03; // ~3.3km lat / ~2.5km lon — overlaps at 3km radius
  for (let lat = latMin; lat <= latMax + 1e-9; lat += step) {
    for (let lon = lonMin; lon <= lonMax + 1e-9; lon += step) {
      GRID.push({ lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 });
    }
  }
}

export interface CommonsCandidate {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
  compassAngle?: number;
  era: number;
  capturedAt?: string;
  imageUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  source: string;
  license: string;
  sourceUrl: string;
  attribution?: string;
  caption?: string;
}

const ACCEPTABLE_LICENSE = [
  /public domain/i,
  /\bpd\b/i,
  /^cc0/i,
  /cc[- ]?by(?:[- ]?sa)?/i,
  /no known copyright/i,
  /no known restrictions/i,
];

function licenseOk(shortName: string | undefined): boolean {
  if (!shortName) return false;
  return ACCEPTABLE_LICENSE.some((re) => re.test(shortName));
}

function extractYear(...candidates: (string | undefined)[]): number | undefined {
  for (const c of candidates) {
    if (!c) continue;
    const text = c.replace(/<[^>]+>/g, ' ');
    const m = text.match(/\b(1[89]\d\d|20[0-2]\d)\b/);
    if (m) {
      const y = Number(m[1]);
      if (y >= 1826 && y <= new Date().getFullYear()) return y;
    }
  }
  return undefined;
}

function stripHtml(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return t.length ? t : undefined;
}

/** Downscaled render URL via Special:FilePath (keeps payload light; width-capped). */
function filePath(title: string, width: number): string {
  const file = title.replace(/^File:/, '');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
}

async function apiGet(params: Record<string, string>, tries = 3): Promise<any> {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '1', ...params })}`;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 504 || res.status === 429) throw new Error(`retryable ${res.status}`);
      if (!res.ok) throw new Error(`Commons API ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === tries) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

interface GeoHit {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
}

async function geosearchCell(center: { lat: number; lon: number }): Promise<GeoHit[]> {
  const data = await apiGet({
    action: 'query',
    list: 'geosearch',
    gsnamespace: '6',
    gsradius: String(SEARCH_RADIUS_M),
    gslimit: String(SEARCH_LIMIT),
    gscoord: `${center.lat}|${center.lon}`,
  });
  const hits = data?.query?.geosearch ?? [];
  return hits.map((h: any) => ({ pageid: h.pageid, title: h.title, lat: h.lat, lon: h.lon }));
}

async function fetchMetaBatch(hits: GeoHit[]): Promise<CommonsCandidate[]> {
  const data = await apiGet({
    action: 'query',
    pageids: hits.map((h) => h.pageid).join('|'),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size',
    iilimit: '1',
  });
  const pages = data?.query?.pages ?? {};
  const byId = new Map(hits.map((h) => [h.pageid, h]));
  const out: CommonsCandidate[] = [];

  for (const page of Object.values(pages) as any[]) {
    const hit = byId.get(page.pageid);
    const ii = page.imageinfo?.[0];
    if (!hit || !ii) continue;
    const meta = ii.extmetadata ?? {};
    const license = stripHtml(meta.LicenseShortName?.value) ?? stripHtml(meta.UsageTerms?.value);
    if (!licenseOk(license)) continue;

    const era = extractYear(
      meta.DateTimeOriginal?.value,
      meta.DateTime?.value,
      meta.ImageDescription?.value,
      meta.ObjectName?.value,
      page.title,
    );
    if (era === undefined || era < DEEP_MIN_YEAR || era > DEEP_MAX_YEAR) continue;

    const dirRaw = stripHtml(meta.GPSImgDirection?.value);
    const compassAngle = dirRaw && /^\d/.test(dirRaw) ? ((Number(dirRaw) % 360) + 360) % 360 : undefined;
    const caption = stripHtml(meta.ImageDescription?.value) ?? stripHtml(meta.ObjectName?.value);
    const credit = stripHtml(meta.Credit?.value);

    out.push({
      pageid: page.pageid,
      title: page.title,
      lat: hit.lat,
      lon: hit.lon,
      compassAngle: Number.isFinite(compassAngle) ? compassAngle : undefined,
      era,
      capturedAt: stripHtml(meta.DateTimeOriginal?.value) ?? stripHtml(meta.DateTime?.value),
      imageUrl: filePath(page.title, 2048),
      thumbUrl: filePath(page.title, 1600),
      width: ii.width ?? 0,
      height: ii.height ?? 0,
      source: credit && /library of congress|detroit publishing/i.test(credit)
        ? 'Library of Congress / Wikimedia Commons'
        : 'Wikimedia Commons',
      license: license!,
      sourceUrl: `https://commons.wikimedia.org/?curid=${page.pageid}`,
      attribution: stripHtml(meta.Artist?.value),
      caption,
    });
  }
  return out;
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });

  // Phase A — cheap geosearch to collect coordinates + pageids. Cached so re-runs
  // (which resume the throttle-prone Phase B) skip it.
  let allHits: GeoHit[];
  if (existsSync(HITS_CACHE)) {
    allHits = JSON.parse(readFileSync(HITS_CACHE, 'utf8'));
    console.log(`  [A] loaded ${allHits.length} cached geotagged files\n`);
  } else {
    const hitsById = new Map<number, GeoHit>();
    let cell = 0;
    for (const center of GRID) {
      try {
        for (const h of await geosearchCell(center)) hitsById.set(h.pageid, h);
      } catch (err) {
        console.warn(`  geosearch ${center.lat},${center.lon}: ${(err as Error).message}`);
      }
      if (++cell % 10 === 0) console.log(`  [A] ${cell}/${GRID.length} cells, ${hitsById.size} geotagged files`);
      await new Promise((r) => setTimeout(r, 100));
    }
    allHits = [...hitsById.values()];
    writeFileSync(HITS_CACHE, JSON.stringify(allHits));
    console.log(`  [A] done: ${allHits.length} geotagged files (cached)\n`);
  }

  const toInspect = Number.isFinite(MAX_INSPECT) ? allHits.slice(0, MAX_INSPECT) : allHits;

  // Phase B — batched metadata + license/date filter. Write after every batch.
  const byId = new Map<number, CommonsCandidate>();
  const flush = () => {
    const candidates = [...byId.values()].sort((a, b) => a.era - b.era);
    writeFileSync(OUT, JSON.stringify(candidates, null, 2));
  };
  for (let i = 0; i < toInspect.length; i += BATCH) {
    const batch = toInspect.slice(i, i + BATCH);
    try {
      for (const c of await fetchMetaBatch(batch)) byId.set(c.pageid, c);
      flush();
    } catch (err) {
      console.warn(`  [B] batch ${i / BATCH}: ${(err as Error).message}`);
    }
    if ((i / BATCH) % 5 === 0) {
      console.log(`  [B] ${Math.min(i + BATCH, toInspect.length)}/${toInspect.length} inspected, ${byId.size} accepted`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  flush();
  const candidates = [...byId.values()];
  console.log(`\nWrote ${candidates.length} deep-layer candidates → ${OUT}`);
  console.log(`  With compassAngle (AR-ready): ${candidates.filter((c) => c.compassAngle !== undefined).length}`);
  const years = candidates.map((c) => c.era);
  if (years.length) console.log(`  Era range: ${Math.min(...years)}–${Math.max(...years)}`);
}

main();
