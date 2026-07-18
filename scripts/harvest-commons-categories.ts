/**
 * harvest-commons-categories.ts — Time Machine pipeline: Commons category sweep.
 *
 * The geosearch harvest (harvest-commons.ts) only finds files that already carry
 * coordinates (~264). Commons holds ~10k MORE historical Chicago photos in
 * CATEGORIES, with no coordinates but geocodable captions (HABS addresses, Daily
 * News community areas, "State & Madison" intersections, landmark postcards).
 *
 * `categorymembers` does NOT recurse, so we BFS subcategories (cmtype=subcat) to
 * reach the files (cmtype=file), then batch metadata (50 pageids/call), date/rights
 * filter, and geocode offline via the Chicago grid.
 *
 *   npm run tm:cats   →  scripts/cache/commons-categories.json (geolocated HistoricalPhoto[])
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HistoricalPhoto } from '../src/history/types.ts';
import { geocodeChicago } from './geocode-chicago.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'cache', 'commons-categories.json');
const GEOTAGGED = join(__dirname, 'cache', 'commons.json'); // to dedup by pageid
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'SpireTimeMachine/0.1 (historical photo harvest; contact takedown@spire.app)';

const DEEP_MAX_YEAR = 1990;
const BATCH = 50;
const MAX_DEPTH = 4;

// Rich historical roots (skip Newberry "Chicago and the Midwest collection" — ephemera).
const ROOTS = [
  'Category:Photographs of Chicago',
  'Category:Postcards of Chicago',
  'Category:Historic American Buildings Survey of Chicago, Illinois',
  'Category:Historic American Engineering Record of Chicago',
  'Category:Chicago Daily News negatives collection',
  'Category:DOCUMERICA photographs of Chicago',
  'Category:Stereo cards of Chicago',
  'Category:Historical images of State Street, Chicago',
  'Category:NARA images of Chicago',
  'Category:Photographs of Chicago in the Rijksmuseum Amsterdam',
];

// Categories whose contents aren't geolocatable street scenes — don't descend.
const SKIP = /midwest collection|maps|newspapers|logos|coats of arms|flags|people of|mayors|sportspeople|by year$|documents/i;

const ACCEPTABLE_LICENSE = [/public domain/i, /\bpd\b/i, /^cc0/i, /cc[- ]?by(?:[- ]?sa)?/i, /no known/i];
function licenseOk(s: string | undefined): boolean {
  return !!s && ACCEPTABLE_LICENSE.some((re) => re.test(s));
}

function stripHtml(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return t.length ? t : undefined;
}

function extractYear(...vals: (string | undefined)[]): number | undefined {
  for (const v of vals) {
    if (!v) continue;
    const m = v.replace(/<[^>]+>/g, ' ').match(/\b(1[789]\d\d|20[0-2]\d)\b/);
    if (m) {
      const y = Number(m[1]);
      if (y >= 1840 && y <= new Date().getFullYear()) return y;
    }
  }
  return undefined;
}

async function apiGet(params: Record<string, string>, tries = 6): Promise<any> {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '1', ...params })}`;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (res.status === 429) throw new Error('429');
      if (!res.ok) throw new Error(String(res.status));
      return await res.json();
    } catch (err) {
      if (attempt === tries) throw err;
      // 429 needs real backoff; grow to ~16s.
      await new Promise((r) => setTimeout(r, Math.min(1500 * attempt, 16000)));
    }
  }
}

/** BFS the category tree, collecting file {pageid,title}. */
async function crawl(): Promise<Map<number, string>> {
  const files = new Map<number, string>();
  const visited = new Set<string>();
  let frontier: Array<{ cat: string; depth: number }> = ROOTS.map((c) => ({ cat: c, depth: 0 }));

  while (frontier.length) {
    const next: Array<{ cat: string; depth: number }> = [];
    for (const { cat, depth } of frontier) {
      if (visited.has(cat)) continue;
      visited.add(cat);

      // A failure on one category must not abort the whole crawl.
      try {
        // Files in this category.
        let cmcontinue: string | undefined;
        do {
          const data = await apiGet({
            action: 'query',
            list: 'categorymembers',
            cmtitle: cat,
            cmtype: 'file',
            cmlimit: '500',
            ...(cmcontinue ? { cmcontinue } : {}),
          });
          for (const m of data?.query?.categorymembers ?? []) files.set(m.pageid, m.title);
          cmcontinue = data?.continue?.cmcontinue;
          await new Promise((r) => setTimeout(r, 200));
        } while (cmcontinue);

        // Subcategories (unless too deep).
        if (depth < MAX_DEPTH) {
          const sub = await apiGet({
            action: 'query',
            list: 'categorymembers',
            cmtitle: cat,
            cmtype: 'subcat',
            cmlimit: '500',
          });
          for (const m of sub?.query?.categorymembers ?? []) {
            const title: string = m.title;
            if (!SKIP.test(title)) next.push({ cat: title, depth: depth + 1 });
          }
        }
      } catch (err) {
        console.warn(`  crawl skip "${cat}": ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log(`  crawl: ${files.size} files, frontier ${next.length}`);
    frontier = next;
  }
  return files;
}

function existingPageids(): Set<number> {
  if (!existsSync(GEOTAGGED)) return new Set();
  try {
    const arr = JSON.parse(readFileSync(GEOTAGGED, 'utf8')) as { pageid: number }[];
    return new Set(arr.map((c) => c.pageid));
  } catch {
    return new Set();
  }
}

function filePath(title: string, width: number): string {
  const file = title.replace(/^File:/, '');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
}

async function processBatch(pageids: number[], titleById: Map<number, string>): Promise<HistoricalPhoto[]> {
  const data = await apiGet({
    action: 'query',
    pageids: pageids.join('|'),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size',
    iilimit: '1',
  });
  const out: HistoricalPhoto[] = [];
  for (const page of Object.values(data?.query?.pages ?? {}) as any[]) {
    const ii = page.imageinfo?.[0];
    if (!ii) continue;
    const meta = ii.extmetadata ?? {};
    const license = stripHtml(meta.LicenseShortName?.value) ?? stripHtml(meta.UsageTerms?.value);
    if (!licenseOk(license)) continue;

    const objectName = stripHtml(meta.ObjectName?.value);
    const description = stripHtml(meta.ImageDescription?.value);
    const title = (titleById.get(page.pageid) ?? page.title ?? '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '');

    const era = extractYear(meta.DateTimeOriginal?.value, description, objectName, title, meta.DateTime?.value);
    if (era === undefined || era > DEEP_MAX_YEAR) continue;

    // Geocode from the richest text available.
    const text = [objectName, description, title].filter(Boolean).join(' . ');
    const geo = geocodeChicago(text, String(page.pageid));
    if (!geo) continue;

    out.push({
      id: `cc-${page.pageid}`,
      layer: 'deep',
      lat: geo.lat,
      lon: geo.lon,
      precision: geo.precision,
      geocodeSource: geo.source,
      compassAngle: geo.compassAngle,
      era,
      capturedAt: stripHtml(meta.DateTimeOriginal?.value) ?? stripHtml(meta.DateTime?.value),
      imageUrl: filePath(page.title, 1600),
      width: ii.width ?? 0,
      height: ii.height ?? 0,
      source: 'Wikimedia Commons',
      license: license!,
      sourceUrl: `https://commons.wikimedia.org/?curid=${page.pageid}`,
      attribution: stripHtml(meta.Artist?.value),
      caption: description ?? objectName ?? title,
    });
  }
  return out;
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  console.log('  crawling category tree…');
  const filesMap = await crawl();
  const existing = existingPageids();
  const pageids = [...filesMap.keys()].filter((id) => !existing.has(id));
  console.log(`  ${filesMap.size} files crawled, ${pageids.length} net-new after dedup\n`);

  const byId = new Map<string, HistoricalPhoto>();
  const flush = () => writeFileSync(OUT, JSON.stringify([...byId.values()], null, 2));

  for (let i = 0; i < pageids.length; i += BATCH) {
    const batch = pageids.slice(i, i + BATCH);
    try {
      for (const p of await processBatch(batch, filesMap)) byId.set(p.id, p);
    } catch (err) {
      console.warn(`  batch ${i / BATCH}: ${(err as Error).message}`);
    }
    if ((i / BATCH) % 5 === 0) {
      flush();
      console.log(`  ${Math.min(i + BATCH, pageids.length)}/${pageids.length} inspected, ${byId.size} geolocated`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  flush();
  const photos = [...byId.values()];
  console.log(`\nWrote ${photos.length} geolocated category photos → ${OUT}`);
  console.log(`  Exact: ${photos.filter((p) => p.precision === 'exact').length} · Approximate: ${photos.filter((p) => p.precision === 'approximate').length}`);
  console.log(`  With bearing: ${photos.filter((p) => p.compassAngle !== undefined).length}`);
}

main();
