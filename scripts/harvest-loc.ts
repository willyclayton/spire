/**
 * harvest-loc.ts — Time Machine pipeline: Library of Congress harvest.
 *
 * LOC holds ~8,000 Chicago-located photos with online images, but carries NO
 * coordinates — location lives in the title/caption text, which the Chicago grid
 * geocoder (geocode-chicago.ts) turns into lat/lon offline. So this harvester
 * fuses fetch + geocode + rights-gate and emits geolocated HistoricalPhoto records.
 *
 * Endpoint choice matters: LOC's `/search/` bucket throttles hard (HTTP 429 after
 * ~9 rapid hits, multi-minute block, no Retry-After). The `/photos/` and `/item/`
 * buckets are far more permissive, so we page `/photos/` and never touch /search/.
 *
 *   npm run tm:loc   →  scripts/cache/loc.json  (geolocated HistoricalPhoto[])
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HistoricalPhoto } from '../src/history/types.ts';
import { geocodeChicago } from './geocode-chicago.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'cache', 'loc.json');
const UA = 'SpireTimeMachine/0.1 (historical photo harvest; contact takedown@spire.app)';

// All LOC photos carrying structured Chicago location metadata AND an online image.
const BASE =
  'https://www.loc.gov/photos/?fa=location:chicago%7Conline-format:image&fo=json&at=results,pagination&c=50';

const DEEP_MAX_YEAR = 1990;
const THROTTLE_MS = 1800; // ~1 req / 1.8s; LOC throttles aggressively

function stripHtml(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return t.length ? t : undefined;
}

function extractYear(...vals: (string | undefined)[]): number | undefined {
  for (const v of vals) {
    if (!v) continue;
    const m = v.match(/\b(1[89]\d\d|20[0-2]\d)\b/);
    if (m) {
      const y = Number(m[1]);
      if (y >= 1840 && y <= new Date().getFullYear()) return y;
    }
  }
  return undefined;
}

function rightsClean(item: any): boolean {
  if (item.access_restricted === true) return false;
  const adv = (Array.isArray(item.rights_advisory) ? item.rights_advisory.join(' ') : item.rights_advisory) ?? '';
  const text = String(adv);
  if (/may be restricted|permission|copyright may|publication may/i.test(text)) return false;
  return /no known restrictions|public domain|u\.?s\.? government|no known copyright/i.test(text) ||
    // Blanket-clear collections still sometimes omit the advisory string.
    item.unrestricted === true;
}

/** Pick a ~1024px JPEG from the result's image_url ladder (ascending sizes). */
function pickImage(result: any): string | undefined {
  const urls: string[] = (result.image_url ?? []).filter((u: string) => /\.jpe?g/i.test(u.split('#')[0]));
  if (!urls.length) return undefined;
  // Prefer the ...v.jpg (~1024) tier if present, else the largest listed.
  const v = urls.find((u) => /v\.jpg/i.test(u.split('#')[0]));
  return (v ?? urls[urls.length - 1]).split('#')[0];
}

async function fetchPage(sp: number): Promise<{ results: any[]; totalPages: number }> {
  const url = `${BASE}&sp=${sp}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429) {
        const backoff = 20000 * attempt;
        console.warn(`  429 on page ${sp} — backing off ${backoff / 1000}s`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      if (!res.ok) throw new Error(`LOC ${res.status}`);
      const data: any = await res.json();
      const totalPages = data?.pagination?.total ?? data?.pagination?.last_page ?? 1;
      return { results: data?.results ?? [], totalPages };
    } catch (err) {
      // Network hiccup (socket terminated, timeout) — retry with backoff.
      if (attempt === 5) throw new Error(`LOC page ${sp} failed: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw new Error(`LOC page ${sp} failed after retries`);
}

function toPhoto(item: any): HistoricalPhoto | null {
  const title = Array.isArray(item.title) ? item.title[0] : item.title;
  const caption = stripHtml(title);
  if (!caption) return null;

  const era = extractYear(
    item.date,
    Array.isArray(item.created_published) ? item.created_published[0] : item.created_published,
    caption,
  );
  if (era === undefined || era > DEEP_MAX_YEAR) return null;

  const notes = Array.isArray(item.notes) ? item.notes.join(' ') : '';
  const subjects = [item.subjects, item.subject_headings].flat().filter(Boolean).join(' ');
  const geo = geocodeChicago(`${caption} ${subjects} ${notes}`, String(item.id ?? caption));
  if (!geo) return null;

  const imageUrl = pickImage(item);
  if (!imageUrl) return null;

  const id = `loc-${String(item.id ?? item.number_lccn ?? caption).split('/').filter(Boolean).pop()}`
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase();

  return {
    id,
    layer: 'deep',
    lat: geo.lat,
    lon: geo.lon,
    precision: geo.precision,
    geocodeSource: geo.source,
    compassAngle: geo.compassAngle,
    era,
    capturedAt: item.date,
    imageUrl,
    width: 1024,
    height: 800,
    source: 'Library of Congress',
    license: 'No known restrictions',
    sourceUrl: item.url ?? item.id ?? `https://www.loc.gov/item/${item.id}`,
    attribution: stripHtml(Array.isArray(item.contributor) ? item.contributor[0] : item.contributor),
    caption,
  };
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  const byId = new Map<string, HistoricalPhoto>();
  let stats = { seen: 0, rightsDropped: 0, geoDropped: 0 };

  const first = await fetchPage(1);
  const totalPages = Math.min(first.totalPages || 1, 170); // ~8k items / 50 per page
  console.log(`  LOC: ${totalPages} pages to sweep`);

  const flush = () => writeFileSync(OUT, JSON.stringify([...byId.values()], null, 2));

  for (let sp = 1; sp <= totalPages; sp++) {
    let results: any[];
    try {
      results = sp === 1 ? first.results : (await fetchPage(sp)).results;
    } catch (err) {
      console.warn(`  page ${sp}: ${(err as Error).message}`);
      continue;
    }
    for (const item of results) {
      stats.seen++;
      if (!rightsClean(item)) {
        stats.rightsDropped++;
        continue;
      }
      const photo = toPhoto(item);
      if (!photo) {
        stats.geoDropped++;
        continue;
      }
      byId.set(photo.id, photo);
    }
    if (sp % 5 === 0) {
      flush();
      console.log(`  page ${sp}/${totalPages}: ${byId.size} geolocated (${stats.rightsDropped} rights, ${stats.geoDropped} no-geo dropped)`);
    }
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }

  flush();
  const photos = [...byId.values()];
  console.log(`\nWrote ${photos.length} geolocated LOC photos → ${OUT}`);
  console.log(`  Exact: ${photos.filter((p) => p.precision === 'exact').length} · Approximate: ${photos.filter((p) => p.precision === 'approximate').length}`);
  console.log(`  With bearing (AR-capable): ${photos.filter((p) => p.compassAngle !== undefined).length}`);
}

main();
