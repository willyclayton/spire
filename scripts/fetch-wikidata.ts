/**
 * Enrich OSM candidates with Wikidata properties.
 * Input: scripts/cache/osm.json
 * Output: scripts/cache/wikidata.json (keyed by QID)
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OsmBuilding } from './fetch-osm.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OSM_CACHE = join(__dirname, 'cache', 'osm.json');
const OUT = join(__dirname, 'cache', 'wikidata.json');
const RAW_CACHE = join(__dirname, 'cache', 'wikidata-raw.json');

const SPARQL_URL = 'https://query.wikidata.org/sparql';

export interface WikidataRecord {
  qid: string;
  label?: string;
  architect?: string;
  yearCompleted?: number;
  heightM?: number;
  style?: string;
  imageUrl?: string;
  wikipediaUrl?: string;
}

const BATCH = 50;

function buildQuery(qids: string[]): string {
  const values = qids.map((q) => `wd:${q}`).join(' ');
  return `
SELECT ?item ?itemLabel ?architectLabel ?inception ?height ?styleLabel ?image ?enwiki WHERE {
  VALUES ?item { ${values} }
  OPTIONAL { ?item wdt:P84 ?architect. }
  OPTIONAL { ?item wdt:P571 ?inception. }
  OPTIONAL { ?item wdt:P2048 ?height. }
  OPTIONAL { ?item wdt:P149 ?style. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL {
    ?enwiki schema:about ?item;
            schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`.trim();
}

type Binding = Record<string, { value: string } | undefined>;

interface SparqlResponse {
  results: { bindings: Binding[] };
}

async function fetchBatch(qids: string[]): Promise<SparqlResponse> {
  const url = `${SPARQL_URL}?format=json&query=${encodeURIComponent(buildQuery(qids))}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'SpireApp/0.1 (skyline identifier; contact via github)',
      Accept: 'application/sparql-results+json',
    },
  });
  if (!res.ok) {
    throw new Error(`Wikidata SPARQL failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as SparqlResponse;
}

function parseYear(inception: string | undefined): number | undefined {
  if (!inception) return undefined;
  const m = inception.match(/^(-?\d{1,4})/);
  return m ? Number(m[1]) : undefined;
}

async function main() {
  const osm: OsmBuilding[] = JSON.parse(readFileSync(OSM_CACHE, 'utf8'));
  const qids = Array.from(new Set(osm.map((b) => b.wikidata).filter((q): q is string => !!q && /^Q\d+$/.test(q))));
  console.log(`Fetching Wikidata for ${qids.length} QIDs in batches of ${BATCH}`);

  let allBindings: Binding[] = [];
  if (existsSync(RAW_CACHE)) {
    console.log(`Using cached SPARQL response: ${RAW_CACHE}`);
    allBindings = JSON.parse(readFileSync(RAW_CACHE, 'utf8'));
  } else {
    for (let i = 0; i < qids.length; i += BATCH) {
      const chunk = qids.slice(i, i + BATCH);
      const res = await fetchBatch(chunk);
      allBindings.push(...res.results.bindings);
      console.log(`  batch ${i / BATCH + 1}/${Math.ceil(qids.length / BATCH)}: ${res.results.bindings.length} rows`);
      // Be polite.
      if (i + BATCH < qids.length) await new Promise((r) => setTimeout(r, 1500));
    }
    mkdirSync(dirname(RAW_CACHE), { recursive: true });
    writeFileSync(RAW_CACHE, JSON.stringify(allBindings));
  }

  const records: Record<string, WikidataRecord> = {};
  for (const b of allBindings) {
    const itemUri = b.item?.value;
    if (!itemUri) continue;
    const qid = itemUri.split('/').pop();
    if (!qid) continue;
    const prev = records[qid] ?? { qid };
    const label = b.itemLabel?.value;
    const architect = b.architectLabel?.value;
    const inception = b.inception?.value;
    const height = b.height?.value;
    const style = b.styleLabel?.value;
    const image = b.image?.value;
    const enwiki = b.enwiki?.value;
    records[qid] = {
      qid,
      label: prev.label ?? label,
      architect: prev.architect ?? architect,
      yearCompleted: prev.yearCompleted ?? parseYear(inception),
      heightM: prev.heightM ?? (height ? Number(height) : undefined),
      style: prev.style ?? style,
      imageUrl: prev.imageUrl ?? image,
      wikipediaUrl: prev.wikipediaUrl ?? enwiki,
    };
  }

  writeFileSync(OUT, JSON.stringify(records, null, 2));
  console.log(`Wrote ${Object.keys(records).length} enriched records → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
