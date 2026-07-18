# Learnings

Running log of non-obvious things learned while building Spire. Append new entries; don't rewrite history.

---

## 2026-07-18 (pt 2) — Scaling the photo dataset (166 → 815 pins)

### The real bottleneck is geolocation, not finding photos
- Archives have tens of thousands of Chicago photos but almost **none carry coordinates** (LOC/IA lat-long fields are empty; Commons geotags are mostly modern GPS). The whole game is turning caption text into lat/lon.
- **Chicago's address grid makes offline geocoding trivially accurate.** State & Madison = origin (41.8820, -87.6278), 800 address units = 1 mile, `lat = 41.8820 + (NS/800)*0.0144893`, `lon = -87.6278 + (EW/800)*0.0193888`. Any "X St & Y St", "720 S Michigan", or "29th St" (numbered streets are arithmetic: N*100 South) geocodes with no API, no rate limit. A ~150-street dictionary + landmark + neighborhood gazetteer covered most captions. This is the single highest-leverage thing in the whole feature.
- Precision tiers fall out naturally: intersection/address/landmark → **exact (yellow dot)**; neighborhood centroid → **approximate (blue dot)** with a deterministic hash-jitter (~260m) so area photos scatter instead of stacking on one point.

### Per-source yield (Chicago, rights-clean, geolocatable-by-caption)
- **Wikimedia Commons categories** = the big win (~2,300). `categorymembers` does NOT recurse — you must BFS `cmtype=subcat`. My BFS found 24k files (more than the estimate). ~19% geocoded.
- **LOC** = ~8k Chicago photos but **throttles brutally** — 429 after ~9 rapid hits on `/search/`, multi-minute blocks, no `Retry-After`. `/photos/` and `/item/` are more permissive buckets. Even at 1.8s/req it 429'd; got ~200 before stalling. Not worth fighting.
- **Internet Archive** = key-free, CORS-clean, but **low geo-yield** (~2% — its captions are mostly city-level "Illinois--Chicago", which the geocoder correctly rejects). 108 from ~6k.
- DPLA/Flickr both hard-require API keys. A research subagent auto-registered a DPLA key against the user's email — watch for subagents taking side-effectful signup actions.

### Operational gotchas
- **Don't run multiple heavy harvests in parallel** — 3 at once caused Commons 429s and IA 503s (network + rate-limit contention). Run sequentially, or at least one-per-host.
- Long network jobs MUST write output incrementally and wrap every `fetch` in try/catch with backoff — a single "socket terminated" / 503 otherwise kills the whole run and loses everything.
- IA/LOC fields are sometimes arrays (`date`, `title`) — coerce before `.match()`.
- `AbortSignal.timeout(ms)` on fetch prevents one hung request from stalling a long harvest.

### Data-model / UX
- **One timeline dot per meaningful era, not per photo.** Mapillary returns ~12 same-year street views (best-per-bearing-bucket); drawn one-dot-per-photo they became "2016" ×9. Fix: collapse to stops (one per historical year + a single "Now"), cap recent to 3, cycle within a stop.
- **Cap photos-per-pin (12) with era-diversity round-robin.** A HABS survey stacks 180 shots of one building; uncapped it's unbrowsable AND doubles payload. Capping + pruning orphaned photos cut raw payload 2.4MB→1.5MB. Note: JSON gzips ~10× (2.7MB→263KB), so gzip is the number that matters, not raw.
- Skipping proximity-dedup for caption-geocoded photos matters: they snap to a shared grid point, so "within 8m" means "same corner", not "same photo" — only dedup real geotags.

## 2026-07-18 — Time Machine mode build

### Wikimedia Commons harvesting
- **Combining geosearch with `extmetadata` on many files times out (HTTP 504).** Asking `generator=geosearch` for coordinates *and* full `iiprop=extmetadata` on 500 files in one call reliably fails. Split into two phases: (A) cheap `list=geosearch` → `{pageid, title, lat, lon}`, then (B) batched `prop=imageinfo|extmetadata` at **50 pageids/call** (the anonymous limit).
- **Commons throttles sustained heavy metadata batches** — mid-run it dropped to ~100s/batch. Mitigations that worked: cache Phase-A hits to disk so re-runs skip geosearch, **write output incrementally after every batch** (a killed/throttled run keeps its progress), and add retry-with-backoff on 429/504.
- **A pipeline that only writes on completion is fragile** — when I `pkill`ed a throttled run, all in-memory candidates were lost. Always flush incrementally for long network jobs.
- **Historical geotagged photos are sparse and spatially spread**, not concentrated at the Loop center. Sorting the inspection queue by distance-to-center *hurt* yield (48 vs 140 accepted). Natural grid-sweep order was better. Over the whole city core: ~10k geotagged files → only ~264 passed the pre-1990 + rights-clean filter.
- **Few Commons photos carry a camera bearing** (`GPSImgDirection` in extmetadata) — 0 of 264 here. AR bearings had to be authored by hand into a curated overlay keyed by pageid, reading direction from captions ("Looking north from…" → 0°).
- `Special:FilePath/{file}?width=N` gives a downscaled render with **CORS enabled** (`upload.wikimedia.org`), so it's canvas-safe for the share compositor. Referencing these URLs keeps the repo light vs. bundling images (matches how base Spire already handles building photos).

### Vite / TypeScript
- With `"types": ["vitest/globals"]` in tsconfig, `import.meta.env` is untyped. Fix: add `src/vite-env.d.ts` with `/// <reference types="vite/client" />` and an `ImportMetaEnv` interface for the `VITE_*` vars.
- **Lazy-load heavy mode-specific deps.** `React.lazy(() => import('./TimeMachineMode'))` pulled MapLibre (~800 KB) into its own chunk — base bundle dropped from 1.26 MB to 175 KB. Vite auto-splits and emits a separate CSS chunk too.

### Map / rendering
- **OpenFreeMap** (`https://tiles.openfreemap.org/styles/positron`) gives free, no-key, detailed vector tiles. `positron` is light/desaturated — good when custom pins should carry the view. `demotiles.maplibre.org` is too low-detail for street level.
- Supercluster + manual `maplibregl.Marker` reconciliation (diff against viewport on `moveend`) works cleanly for a few hundred pins; `getClusterExpansionZoom` for click-to-zoom.
- Dual-thumb range slider: overlap two native `<input type=range>`, set the base `pointer-events: none` and re-enable only on `::-webkit-slider-thumb` / `::-moz-range-thumb` so both thumbs stay grabbable.

### Verifying browser apps in this environment
- No `chromium-cli`/Playwright here, but the **claude-in-chrome** integration drives the user's real Chrome. `browser_batch` several actions per round-trip.
- **Onboarding/permission gates block automation** (native geolocation prompt). Cleanest bypass: a **DEV-only `window` hook** on the store (`if (import.meta.env.DEV) window.__spire = useStore`) to set state directly — never ships to prod.
- A store that loads inside a lazy chunk isn't on `window` until that chunk loads — toggle the mode first, then wait, then read the hook.
- **Desktop Chrome geolocation returns the real machine location**, not a fallback. To test on-site/distance-gated UI, read the live position via `getCurrentPosition` (permission already granted) and move the test fixture to *that* point, rather than assuming the app's hardcoded fallback is in use.
- Desktop has no compass/orientation → good for exercising **degraded states** (manual-align guidance) for free.
