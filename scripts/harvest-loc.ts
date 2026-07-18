/**
 * harvest-loc.ts — Time Machine pipeline stage 2.
 *
 * Pulls Chicago items from the Library of Congress — the deepest rights-clean pool.
 * Target collections carry named buildings / addresses and clean rights:
 *   - Detroit Publishing Co. (1890s–1920s city views, "no known restrictions")
 *   - HABS (government architectural surveys, public domain)
 *   - FSA/OWI (1930s–40s, government, public domain)
 *
 * LOC has a free JSON API (no key): append fo=json to any search URL. Records
 * carry image URLs + rights but NO coordinates — enrich-geolocate.ts parses the
 * captions into lat/lon/bearing afterward. This stage just caches raw items.
 *
 *   npm run tm:loc   →  scripts/cache/loc-raw.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'cache', 'loc-raw.json');
const UA = 'SpireTimeMachine/0.1 (historical photo harvest)';

// LOC search endpoints. c=100 items/page; fa filters by partof (collection).
const QUERIES = [
  'https://www.loc.gov/photos/?q=chicago&fa=partof:detroit+publishing+company&fo=json&c=100',
  'https://www.loc.gov/photos/?q=chicago+illinois&fa=partof:historic+american+buildings+survey&fo=json&c=100',
  'https://www.loc.gov/photos/?q=chicago&fa=partof:farm+security+administration&fo=json&c=100',
];

export interface LocItem {
  id: string;
  title: string;
  date?: string;
  imageUrl?: string;
  source: string;
  license: string;
  sourceUrl: string;
  description?: string;
}

function pickImage(item: any): string | undefined {
  const urls: string[] = item.image_url ?? [];
  // Prefer a mid-size render; LOC lists ascending sizes.
  return urls[Math.min(2, urls.length - 1)] ?? urls[urls.length - 1];
}

async function fetchPage(url: string): Promise<LocItem[]> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`LOC ${res.status}`);
  const data: any = await res.json();
  const results: any[] = data?.results ?? [];
  const out: LocItem[] = [];
  for (const r of results) {
    if (r.access_restricted) continue;
    const rights = (Array.isArray(r.rights) ? r.rights.join(' ') : r.rights) ?? '';
    // Ingestion rule: only "no known restrictions" or clearly government/PD works.
    const clean = /no known restrictions|public domain|no known copyright/i.test(rights);
    out.push({
      id: `loc-${String(r.id).split('/').filter(Boolean).pop()}`,
      title: Array.isArray(r.title) ? r.title[0] : r.title,
      date: r.date,
      imageUrl: pickImage(r),
      source: 'Library of Congress',
      license: clean ? 'No known restrictions' : 'Review required',
      sourceUrl: r.id ?? r.url,
      description: Array.isArray(r.description) ? r.description[0] : r.description,
    });
  }
  return out;
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  const byId = new Map<string, LocItem>();
  for (const url of QUERIES) {
    try {
      const items = await fetchPage(url);
      for (const it of items) byId.set(it.id, it);
      console.log(`  ${items.length} items from ${url.split('fa=')[1]?.split('&')[0] ?? url}`);
    } catch (err) {
      console.warn(`  query failed: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const items = [...byId.values()].filter((i) => i.imageUrl && i.license !== 'Review required');
  writeFileSync(OUT, JSON.stringify(items, null, 2));
  console.log(`\nWrote ${items.length} rights-clean LOC items → ${OUT}`);
  console.log('  Next: npm run tm:enrich  (parse captions → coordinates)');
}

main();
