/**
 * harvest-ia.ts — Time Machine pipeline: Internet Archive harvest.
 *
 * IA is key-free, CORS-clean, and holds ~5,900 pre-1929 Chicago photos that carry
 * a `coverage` place hierarchy + geocodable `title` captions (but essentially no
 * lat/lon). We fuse search → geocode → image-resolve and emit geolocated
 * HistoricalPhoto records. Pre-1929 date gate = public domain.
 *
 *   npm run tm:ia   →  scripts/cache/ia.json  (geolocated HistoricalPhoto[])
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HistoricalPhoto } from '../src/history/types.ts';
import { geocodeChicago } from './geocode-chicago.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'cache', 'ia.json');
const UA = 'SpireTimeMachine/0.1 (historical photo harvest; contact takedown@spire.app)';

const SEARCH = 'https://archive.org/advancedsearch.php';
// Pre-1929 (public domain by date) Chicago images that carry place metadata.
const QUERY = 'chicago AND mediatype:image AND coverage:* AND date:[1850-01-01 TO 1928-12-31]';
const ROWS = 100;
const THROTTLE_MS = 250;

interface IaDoc {
  identifier: string;
  title?: string | string[];
  date?: string;
  coverage?: string | string[];
  collection?: string | string[];
  licenseurl?: string;
  rights?: string;
}

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
function joinAll(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v.join(' ');
  return v ?? '';
}

function extractYear(...vals: (string | string[] | undefined)[]): number | undefined {
  for (const raw of vals) {
    const v = Array.isArray(raw) ? raw.join(' ') : raw;
    if (!v || typeof v !== 'string') continue;
    const m = v.match(/\b(1[89]\d\d|20[0-2]\d)\b/);
    if (m) {
      const y = Number(m[1]);
      if (y >= 1840 && y <= 1928) return y;
    }
  }
  return undefined;
}

async function fetchPage(page: number): Promise<{ docs: IaDoc[]; numFound: number }> {
  const url =
    `${SEARCH}?q=${encodeURIComponent(QUERY)}` +
    ['identifier', 'title', 'date', 'coverage', 'collection', 'licenseurl', 'rights']
      .map((f) => `&fl[]=${f}`)
      .join('') +
    `&rows=${ROWS}&page=${page}&output=json`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(40000) });
      // IA 503s under load — back off hard rather than give up.
      if (res.status === 503 || res.status === 429) throw new Error(String(res.status));
      if (!res.ok) throw new Error(`IA search ${res.status}`);
      const data: any = await res.json();
      return { docs: data?.response?.docs ?? [], numFound: data?.response?.numFound ?? 0 };
    } catch (err) {
      if (attempt === 6) throw new Error(`IA search failed: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, Math.min(4000 * attempt, 20000)));
    }
  }
  return { docs: [], numFound: 0 };
}

/** Resolve the best display JPEG for an item via its metadata (files + server/dir). */
async function resolveImage(id: string): Promise<{ url: string; w: number; h: number } | null> {
  try {
    const res = await fetch(`https://archive.org/metadata/${id}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const meta: any = await res.json();
    const files: any[] = meta?.files ?? [];
    const dir = meta?.dir;
    const server = meta?.server;
    if (!dir || !server) return null;
    // Prefer a reasonably sized derived JPEG (not the multi-MB master, not the tiny thumb).
    const jpegs = files
      .filter((f) => /\.jpe?g$/i.test(f.name) && !/__ia_thumb/i.test(f.name))
      .map((f) => ({ name: f.name as string, size: Number(f.size ?? 0), w: Number(f.width ?? 0), h: Number(f.height ?? 0) }))
      .sort((a, b) => a.size - b.size);
    // Take the largest JPEG under ~1.5MB, else the smallest available.
    const pick = [...jpegs].reverse().find((f) => f.size > 0 && f.size < 1_500_000) ?? jpegs[jpegs.length - 1];
    if (!pick) return null;
    return {
      url: `https://${server}${dir}/${encodeURIComponent(pick.name)}`,
      w: pick.w || 1024,
      h: pick.h || 768,
    };
  } catch {
    return null;
  }
}

function slug(id: string): string {
  return `ia-${id}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 60);
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  const byId = new Map<string, HistoricalPhoto>();
  const stats = { seen: 0, geoDropped: 0, imgDropped: 0 };

  const firstPage = await fetchPage(1);
  const totalPages = Math.min(Math.ceil(firstPage.numFound / ROWS), 70);
  console.log(`  IA: ${firstPage.numFound} candidates, ${totalPages} pages`);

  const flush = () => writeFileSync(OUT, JSON.stringify([...byId.values()], null, 2));

  for (let page = 1; page <= totalPages; page++) {
    let docs: IaDoc[];
    try {
      docs = page === 1 ? firstPage.docs : (await fetchPage(page)).docs;
    } catch (err) {
      console.warn(`  page ${page}: ${(err as Error).message}`);
      continue;
    }
    for (const doc of docs) {
      stats.seen++;
      const title = first(doc.title) ?? '';
      const coverage = joinAll(doc.coverage);
      const era = extractYear(doc.date, title);
      if (era === undefined) continue;
      // Geocode from title first (has intersections), then coverage hierarchy.
      const geo = geocodeChicago(`${title} ${coverage}`, doc.identifier);
      if (!geo) {
        stats.geoDropped++;
        continue;
      }
      const img = await resolveImage(doc.identifier);
      if (!img) {
        stats.imgDropped++;
        continue;
      }
      byId.set(doc.identifier, {
        id: slug(doc.identifier),
        layer: 'deep',
        lat: geo.lat,
        lon: geo.lon,
        precision: geo.precision,
        geocodeSource: geo.source,
        compassAngle: geo.compassAngle,
        era,
        capturedAt: doc.date,
        imageUrl: img.url,
        width: img.w,
        height: img.h,
        source: 'Internet Archive',
        license: doc.licenseurl ? 'CC / see source' : 'Public Domain (pre-1929)',
        sourceUrl: `https://archive.org/details/${doc.identifier}`,
        caption: title,
      });
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }
    flush();
    console.log(`  page ${page}/${totalPages}: ${byId.size} geolocated (${stats.geoDropped} no-geo, ${stats.imgDropped} no-img)`);
  }

  flush();
  const photos = [...byId.values()];
  console.log(`\nWrote ${photos.length} geolocated IA photos → ${OUT}`);
  console.log(`  Exact: ${photos.filter((p) => p.precision === 'exact').length} · Approximate: ${photos.filter((p) => p.precision === 'approximate').length}`);
}

main();
