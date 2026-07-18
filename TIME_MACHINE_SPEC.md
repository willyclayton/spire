# Spire — Time Machine Mode (Complete Spec)

Extends TECHNICAL_SPEC.md (the base Spire app). Same repo, same stack: React 18 + Vite + TypeScript + Tailwind + Zustand PWA, no backend, deployed on Vercel. Reuses Spire's sensor hooks (`useOrientation`, `useGeolocation`, `useCamera`) and geo utilities.

## 1. Concept

A map of Chicago with pins wherever geolocated historical photos exist. Tap a pin to see what that spot looked like across eras. If you're physically standing near a pin, you can open an AR view that ghosts the historical photo over your live camera with an opacity slider.

The map is the front door — browsable from anywhere, honest about coverage (a pin means "we have history here"; no pin promises nothing). AR is the on-site payoff that pulls people to walk to the actual corner.

Two content layers, same experience:
- **Deep layer (1890s–1980s):** harvested + curated archival photos, bundled with the app.
- **Recent layer (~2014+):** Mapillary street-level imagery, fetched at runtime, powering "then/now" comparisons.

## 2. Mode entry

Clock icon in Spire's top bar toggles Time Machine mode → opens the History Map.

## 3. UX spec

### 3.1 History Map (home of the mode)

- Full-screen map: **MapLibre GL JS** with free OSM-based vector tiles (no Google SDK, no billing). User location dot from `useGeolocation`.
- Pins for every photo location. **Clustering is mandatory** — Loop density is extreme. Use **Supercluster** client-side: clusters with counts at city zoom, splitting as you zoom in.
- Pin styling: gold = deep layer, steel = recent-only. Pins with multiple eras show a small stacked-count badge.
- Top filter bar: era range slider (1890 ─── now) filters visible pins; "near me" chip re-centers and sorts.
- Tap pin (or cluster leaf) → Photo Sheet.

### 3.2 Photo Sheet (bottom sheet, ~60% height, drag to expand/dismiss)

- Historical photo full-width. Letterbox tall/odd aspect ratios with a blurred fill; never stretch.
- **Era timeline** beneath the photo when the pin has multiple photos: one dot per era (gold deep / steel recent / white "now"), tap or drag to switch.
- Caption, year, and **attribution** (source + license, always visible; tap expands full record with link to the original archival page).
- **Then/Now toggle:** if a recent-layer photo exists at this pin, a segmented control swipes between historical and recent street view. This delivers time travel without being on-site.
- **"View in AR"** button — rendered only when BOTH: user within **75m** of the pin AND selected photo has a `compassAngle`. Launches the AR Ghost view (§3.3).
- Directions link (opens native maps) when the pin is farther than 75m.
- **Share** button: composites the current photo card (image + "SPIRE · {year}" + location) to a canvas → shareable image. This is the growth loop; do not cut.

### 3.3 AR Ghost view (on-site experience)

1. Live rear camera full-screen (reuse `useCamera`; `getUserMedia` facingMode "environment", `<video playsinline muted>`).
2. The historical photo rendered above the video in a CSS-transformed container ("the ghost").
3. **Opacity slider** — bottom of screen, default 50%, snap-feel at 0 and 100.
4. **Auto-alignment:** initial horizontal offset = `wrap180(photo.compassAngle − smoothedHeading) / fovDeg × screenWidth` with `fovDeg = 60` (Spire's camera FOV constant). Turning your body slides the ghost toward center — physically rotating to face the photo's original bearing aligns it, which teaches the interaction without a tutorial. Recompute throttled at 100ms.
5. **Manual alignment:** one-finger drag pans the ghost, two-finger pinch scales, two-finger rotate rotates. First manual touch **freezes** auto-offset (user's alignment wins). "Reset alignment" chip appears once transformed. Persist per-photo transform to localStorage keyed by photo id.
6. Attribution chip stays visible bottom-left.
7. Same share compositor, now blending live camera frame + ghost at current opacity, watermarked "SPIRE · {year}/{currentYear}".
8. Exit returns to the Photo Sheet.

### 3.4 Degraded states

- Camera permission denied → AR button opens a static side-by-side: photo on top, "face {standHint}" guidance below.
- No orientation sensor / low compass confidence (reuse Spire's confidence tracking) → skip auto-alignment, start ghost centered, manual gestures only.
- Offline → deep layer fully works (bundled); recent layer shows "recent imagery unavailable." Map tiles: cache last-viewed tiles via the service worker; if cold-offline, fall back to a bundled lightweight Chicago basemap image with pins absolutely positioned (acceptable ugliness).
- GPS accuracy > 40m → banner: distance-gating for the AR button loosens to 150m and warns alignment may be off.

## 4. Data model

```typescript
interface HistoricalPhoto {
  id: string;
  layer: "deep" | "recent";
  lat: number; lon: number;        // camera position
  compassAngle?: number;           // direction camera faced, degrees true. OPTIONAL — absence just hides the AR button
  era: number;                     // display year, e.g. 1912
  capturedAt?: string;             // full date when known
  imageUrl: string;                // deep: /history/{id}.jpg (bundled); recent: Mapillary thumb URL
  width: number; height: number;
  fovDeg?: number;                 // default 65 if unknown
  source: string;                  // "Library of Congress", "Wikimedia Commons", "Mapillary", ...
  license: string;                 // REQUIRED: "Public Domain", "No known restrictions", "CC-BY-SA", ...
  sourceUrl: string;               // link to original archival record
  attribution?: string;            // display string when license requires it
  caption?: string;
  standHint?: string;              // "NE corner of State & Madison, face west"
  featured?: boolean;              // editorial picks get map prominence
}

interface Pin {
  id: string;
  lat: number; lon: number;        // centroid of grouped photos
  photoIds: string[];              // photos within ~25m, sorted by era
  eras: number[];
  hasDeep: boolean;
  featured: boolean;
}
```

- **Pin index** (`public/data/chicago-pins.json`): all pins + all deep-layer photo metadata. A few thousand records ≈ a few hundred KB gzipped. Loaded at mode entry, cached by the service worker.
- **Deep-layer images:** bundled under `public/history/`, downscaled to max 1600px (~150KB each).
- **Recent layer:** fetched live from Mapillary per viewed pin (too large to bundle), cached in-memory + localStorage (24h TTL).

## 5. Runtime service — Mapillary (`src/history/mapillary.ts`)

- Graph API: `https://graph.mapillary.com/images?access_token={TOKEN}&fields=id,computed_geometry,compass_angle,captured_at,thumb_2048_url&bbox={lonMin},{latMin},{lonMax},{latMax}&limit=100`
- Free public-tier token from a Mapillary developer account; `.env` as `VITE_MAPILLARY_TOKEN` (client-exposed is fine at this tier; note rate limits).
- Query a ~60m bbox around a pin when its sheet opens. Filter: prefer photos ≥ 5 years old; keep best photo per (year, 30° bearing bucket); drop anything > 60m from the pin.
- Mapillary imagery is CC-BY-SA: render "© Mapillary contributors" whenever a recent photo is visible. Non-negotiable.
- Recent results merge into the open pin's era timeline at view time (they are not in the static index).

## 6. Photo sourcing pipeline (offline scripts, produce the pin index)

The pipeline's product is **pins**: `{lat, lon, era, imageUrl, license, source, sourceUrl, caption, compassAngle?}`. Location earns a pin; `compassAngle` is a bonus that unlocks AR.

### 6.1 Sources — build on these (programmatic + rights-clean)

**Wikimedia Commons (primary automated source).** MediaWiki API geosearch over image files:
`https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggsnamespace=6&ggsradius=500&ggscoord={lat}|{lon}&prop=imageinfo&iiprop=url,extmetadata&format=json`
Returns image URLs + machine-readable license in `extmetadata` — filter in code to Public Domain / CC0 / CC-BY / CC-BY-SA, and to historical dates. Some files include camera coordinates and even heading — pre-made records. The only source where location + license + image come from one call.

**Library of Congress (deepest rights-clean pool).** Free JSON API, no key:
`https://www.loc.gov/photos/?q=chicago&fo=json&c=100` (+ facets for collection/date).
Target collections: **Detroit Publishing Co.** (1890s–1920s city views, "no known restrictions"), **HABS** (government architectural surveys, named buildings + addresses, public domain), **FSA/OWI** (1930s–40s, government, PD). Ingestion rule: only collections marked "no known restrictions" or US-government works; anything published pre-1931 is public domain regardless. No coordinates in metadata → enrichment step below.

**DPLA (discovery layer).** REST API `https://api.dp.la/v2/items` (free key by email) + bulk downloads. Filter items by open rightsstatements.org URIs in the `rights` field, then fetch from the owning institution. One query surfaces material across many archives.

**Internet Archive + Flickr Commons (supplemental).** Open APIs. Pre-1931 postcards are the sleeper asset: street-level, landmark-focused, public domain.

### 6.2 Sources — do NOT ingest

- **Chicago History Museum** (incl. Chicago Daily News 1902–33, Hedrich-Blessing): paid per-image licensing operation. Don't ingest, don't scrape their scans even of PD-era originals. Future B2B partnership candidate only.
- **Google Street View historical imagery:** no API access exists. Never scrape.
- **Commercial stock (Getty/Alamy):** licensing model incompatible.
- **Chicago Public Library / Explore Chicago Collections / university archives:** rich but no API and per-collection rights — use manually for leads and partnership outreach, not automated ingestion.

### 6.3 Rights rules (encode in the pipeline)

- Published before 1931 → public domain (rule advances a year each January).
- US government works → public domain regardless of date.
- "No known copyright restrictions" (LOC / Flickr Commons designation) → acceptable with attribution.
- Post-1930 → restricted unless explicitly tagged open; when in doubt, drop.
- Every record MUST carry `license` + `sourceUrl`; the merge script rejects records without them. App shows attribution and a takedown contact.

### 6.4 Pipeline stages (`scripts/`)

1. **`harvest-commons.ts`** — geosearch sweep over a grid covering Chicago (500m radius per point, dedupe overlaps), license + date filtered. Output arrives pre-geolocated: instant pin candidates.
2. **`harvest-loc.ts`** — pull Detroit Publishing / HABS / FSA Chicago items: metadata + image URLs. Cache raw responses.
3. **`enrich-geolocate.ts`** — the leverage step. LOC/DPLA captions encode locations ("State Street north from Madison" = position AND bearing). Call Claude via the Anthropic API to parse each caption → `{lat, lon, compassAngle?, era, confidence}`. Write results to a review queue file. Low-confidence parses are dropped, not agonized over — no pin is an acceptable outcome.
4. **`review-ui`** — tiny local web page (can live in scripts/) showing each candidate on a map with its photo: approve / nudge pin / reject. Human review as an approval queue, not per-photo research.
5. **`build-index.ts`** — dedupe (same view from multiple sources → best resolution + cleanest rights), downscale images to 1600px, group photos within 25m into pins with era stacks, validate required fields, emit `chicago-pins.json` + `public/history/` assets.

**Expected yield:** low thousands of usable pins, weighted 1890s–1940s, concentrated in the Loop / riverfront / lakefront — exactly where tourists stand. 500 good pins is a real launch; 2,000 is a rich one.

## 7. File structure (new files)

```
scripts/
├── harvest-commons.ts
├── harvest-loc.ts
├── enrich-geolocate.ts
├── review-ui/                  # local-only approval queue page
└── build-index.ts
public/
├── data/chicago-pins.json
└── history/*.jpg
src/
├── history/
│   ├── mapillary.ts            # runtime fetch + filter + cache
│   ├── pinStore.ts             # load index, cluster feed, era filtering
│   ├── arAlignment.ts          # offset math, manual-override state
│   └── arAlignment.test.ts
├── components/
│   ├── HistoryMapView.tsx      # MapLibre + Supercluster + filters
│   ├── PhotoSheet.tsx          # bottom sheet, timeline, then/now, AR entry
│   ├── EraTimeline.tsx
│   ├── ThenNowToggle.tsx
│   ├── ARGhostView.tsx         # camera + ghost + opacity slider
│   ├── GhostOverlay.tsx        # transform container + gestures
│   ├── OpacitySlider.tsx
│   ├── AttributionChip.tsx
│   └── ShareCapture.tsx        # canvas compositor (card + AR blend modes)
```

### Required unit tests
- `arAlignment.test.ts`: offset formula correctness incl. the 359°→0° bearing wrap; manual-override freeze; reset behavior.
- `pinStore` tests: era filtering, 25m grouping, AR-button eligibility (distance + compassAngle presence).

## 8. Design notes (extends Spire's design system)

- Time Machine accent: **sepia-gold #C9A227** (distinct from Spire's amber) — a different temperature, not a different app.
- Deep-layer photos get a subtle vignette + faint grain so archival images feel material.
- Map: muted/desaturated basemap style so gold pins carry the view; featured pins slightly larger with a soft glow.
- Timeline dots: gold deep / steel recent / white now.
- Ghost photos fade in 150ms. Respect `prefers-reduced-motion` everywhere (incl. pin cluster animations).
- Attribution chip: small, always legible, tap to expand.

## 9. Build order

1. **TM1 — Map + pins end-to-end (de-risk data):** run harvest-commons for a Loop-area grid, build a first `chicago-pins.json` (even 30 pins), HistoryMapView with clustering + PhotoSheet with era timeline. *Proves the data pipeline and the browse experience with zero sensor risk.*
2. **TM2 — Recent layer:** Mapillary service, then/now toggle, attribution.
3. **TM3 — AR Ghost:** ARGhostView, auto-alignment + gestures + freeze logic, tests, share compositor. Field-test on-site.
4. **TM4 — Scale the data:** harvest-loc + Claude geolocation enrichment + review UI; grow to 500+ pins; featured curation pass.
5. **TM5 — Polish:** design pass, offline behavior, degraded states, share cards.

## 10. Cut from V1 (explicitly)

Automatic image alignment via computer vision (feature matching / homography), user-uploaded photos, video ghosts, 3D reconstruction, cities beyond Chicago, accounts, any Google Street View integration.
