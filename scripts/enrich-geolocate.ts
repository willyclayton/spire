/**
 * enrich-geolocate.ts — Time Machine pipeline stage 3 (the leverage step).
 *
 * LOC/DPLA captions encode location AND bearing in prose:
 *   "State Street north from Madison" → position (State & Madison) + bearing (north).
 * We call Claude to parse each caption into {lat, lon, compassAngle?, era, confidence}.
 * Low-confidence parses are DROPPED, not agonized over — no pin is an acceptable
 * outcome (spec §6.4.3). Survivors go to a review queue that build-index consumes.
 *
 * Requires ANTHROPIC_API_KEY in the environment. Reads scripts/cache/loc-raw.json,
 * writes scripts/cache/loc-enriched.json (kept) + scripts/cache/review-queue.json.
 *
 *   ANTHROPIC_API_KEY=sk-... npm run tm:enrich
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HistoricalPhoto } from '../src/history/types.ts';

// Legacy alternate path: parse ambiguous captions with Claude when the offline
// grid geocoder (geocode-chicago.ts) can't place them. Reads a raw caption dump.
interface LocItem {
  id: string;
  title: string;
  date?: string;
  imageUrl?: string;
  source: string;
  license: string;
  sourceUrl: string;
  description?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN = join(__dirname, 'cache', 'loc-raw.json');
const OUT = join(__dirname, 'cache', 'loc-enriched.json');
const QUEUE = join(__dirname, 'cache', 'review-queue.json');

const MODEL = 'claude-opus-4-8';
const CONFIDENCE_FLOOR = 0.6;

interface Parsed {
  lat: number | null;
  lon: number | null;
  compassAngle: number | null;
  era: number | null;
  confidence: number;
  reasoning?: string;
}

const SYSTEM = `You geolocate historical Chicago photographs from their catalog captions.
Chicago's street grid is regular and well-documented; State & Madison is the origin (0,0).
Given a caption and date, return STRICT JSON:
{"lat": number|null, "lon": number|null, "compassAngle": number|null, "era": number|null, "confidence": 0..1, "reasoning": string}
- lat/lon: the CAMERA position (where the photographer stood), WGS84 decimal degrees.
- compassAngle: direction the camera faced, degrees clockwise from true north (0=N,90=E,180=S,270=W). "State Street north from Madison" means standing at Madison looking north → ~0. Null if the caption gives no direction.
- era: the 4-digit year the photo was taken.
- confidence: your calibrated confidence the coordinates are within ~50m. Be harsh; guessing is worse than null.
Return ONLY the JSON object.`;

async function parseCaption(item: LocItem): Promise<Parsed | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const user = `Caption: ${item.title}\n${item.description ? `Description: ${item.description}\n` : ''}Date: ${item.date ?? 'unknown'}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    console.warn(`  API ${res.status} for ${item.id}`);
    return null;
  }
  const data: any = await res.json();
  const text: string = data?.content?.[0]?.text ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Parsed;
  } catch {
    return null;
  }
}

async function main() {
  if (!existsSync(IN)) throw new Error(`Run tm:loc first — missing ${IN}`);
  const items: LocItem[] = JSON.parse(readFileSync(IN, 'utf8'));
  mkdirSync(dirname(OUT), { recursive: true });

  const kept: HistoricalPhoto[] = [];
  const queue: any[] = [];
  let i = 0;
  for (const item of items) {
    i++;
    let parsed: Parsed | null = null;
    try {
      parsed = await parseCaption(item);
    } catch (err) {
      console.error((err as Error).message);
      break;
    }
    if (
      !parsed ||
      parsed.lat == null ||
      parsed.lon == null ||
      parsed.era == null ||
      parsed.confidence < CONFIDENCE_FLOOR
    ) {
      if (i % 20 === 0) console.log(`  ${i}/${items.length} processed, ${kept.length} kept`);
      continue;
    }
    const photo: HistoricalPhoto = {
      id: item.id,
      layer: 'deep',
      lat: parsed.lat,
      lon: parsed.lon,
      compassAngle: parsed.compassAngle ?? undefined,
      era: parsed.era,
      capturedAt: item.date,
      imageUrl: item.imageUrl!,
      width: 0,
      height: 0,
      source: item.source,
      license: item.license,
      sourceUrl: item.sourceUrl,
      caption: item.title,
    };
    kept.push(photo);
    queue.push({ ...photo, confidence: parsed.confidence, reasoning: parsed.reasoning });
    await new Promise((r) => setTimeout(r, 150));
  }

  writeFileSync(OUT, JSON.stringify(kept, null, 2));
  writeFileSync(QUEUE, JSON.stringify(queue, null, 2));
  console.log(`\nEnriched ${kept.length}/${items.length} items (≥${CONFIDENCE_FLOOR} confidence) → ${OUT}`);
  console.log(`  Review queue (approve/nudge/reject in scripts/review-ui): ${QUEUE}`);
}

main();
