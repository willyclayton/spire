# Learnings

Running log of non-obvious things learned while building Spire. Append new entries; don't rewrite history.

---

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
