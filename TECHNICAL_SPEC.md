# Technical Specification — Skyline Identifier (V1, Chicago)

This spec is written to be handed to Claude Code. Build in the milestone order at the bottom; Milestone 1 de-risks the whole project.

## 1. Stack decision

- **Platform:** Mobile-first PWA. Fastest path to field testing; no App Store friction; camera + orientation + geolocation all work in mobile browsers (with iOS caveats handled below).
- **Framework:** React 18 + Vite + TypeScript.
- **Styling:** Tailwind CSS.
- **State:** Zustand (small, no boilerplate; sensor data updates at 30–60Hz and Redux ceremony would hurt).
- **No backend.** All building data ships as static JSON. Deploy to Vercel.
- **Testing:** Vitest for the geometry math (this is the one part that MUST have unit tests).

## 2. Repository structure

```
skyline-app/
├── public/
│   └── data/
│       └── chicago.json          # generated building dataset
├── scripts/
│   ├── fetch-osm.ts              # Overpass API → raw building geometry
│   ├── fetch-wikidata.ts         # SPARQL → architect, year, height, names
│   ├── merge.ts                  # join + apply curated overlay → chicago.json
│   └── curated/
│       └── chicago-overlay.json  # hand-written facts/descriptions, top ~50
├── src/
│   ├── main.tsx
│   ├── App.tsx                   # view router: camera | radar | detail
│   ├── store.ts                  # Zustand: sensors, matches, UI state, calibration offset
│   ├── types.ts
│   ├── geo/
│   │   ├── bearing.ts            # haversine distance + initial bearing
│   │   ├── elevation.ts          # angular elevation to building top
│   │   ├── matcher.ts            # FOV filtering + scoring + label layout
│   │   └── matcher.test.ts       # REQUIRED unit tests
│   ├── sensors/
│   │   ├── useOrientation.ts     # deviceorientation w/ iOS permission flow
│   │   ├── useGeolocation.ts     # watchPosition wrapper
│   │   └── useCamera.ts          # getUserMedia rear camera
│   ├── components/
│   │   ├── CameraView.tsx        # video + label overlay layer
│   │   ├── RadarView.tsx         # canvas fallback view
│   │   ├── BuildingLabel.tsx
│   │   ├── DetailCard.tsx        # bottom sheet
│   │   ├── CalibrationHint.tsx   # drag-to-align UI
│   │   ├── PermissionGate.tsx    # onboarding: location → motion → camera
│   │   └── ConfidenceDot.tsx     # compass health indicator
│   └── styles/
└── index.html
```

## 3. Data

### 3.1 Building record schema (`types.ts`)

```typescript
interface Building {
  id: string;              // slug, e.g. "willis-tower"
  name: string;
  lat: number;             // centroid of footprint
  lon: number;
  heightM: number;         // architectural height, meters
  floors?: number;
  yearCompleted?: number;
  architect?: string;
  style?: string;          // "Art Deco", "International", ...
  fact?: string;           // ONE curated interesting sentence
  description?: string;    // 2–3 sentences for detail card
  wikipediaUrl?: string;
  prominence: number;      // 1–10, hand-tuned for top buildings, else derived from height
  imageUrl?: string;       // Wikimedia Commons, optional
}
```

### 3.2 Pipeline

**`fetch-osm.ts`** — Overpass API query for buildings in the Chicago bbox with `height` or `building:levels` tags, filtered to height ≥ 60m OR presence of a `wikidata` tag (catches short-but-notable buildings like the Rookery). Compute footprint centroid. Overpass endpoint: `https://overpass-api.de/api/interpreter`. Rate-limit friendly: one bbox query, cache the raw response to `scripts/cache/`.

```
[out:json][timeout:60];
(
  way["building"]["height"](41.85,-87.66,41.92,-87.60);
  way["building"]["building:levels"](41.85,-87.66,41.92,-87.60);
);
out center tags;
```

Parse `height` (may be "442 m" or "442"), fall back to `building:levels × 3.5m`. Keep the `wikidata` QID tag when present.

**`fetch-wikidata.ts`** — for each QID, SPARQL query (`https://query.wikidata.org/sparql`) for: label, architect (P84), inception (P571), height (P2048), architectural style (P149), image (P18), English Wikipedia sitelink. Batch QIDs in groups of ~50 per query.

**`merge.ts`** — join OSM geometry with Wikidata attributes; overlay `chicago-overlay.json` (curated file wins every field conflict); compute `prominence = clamp(round(heightM / 60), 1, 10)` unless hand-set; drop records with no name; emit sorted `public/data/chicago.json`. Target ~200 records, hard cap 400 (payload stays under ~150KB).

**`chicago-overlay.json`** — hand-written entries for the top ~50 (Willis, Hancock/875 N Michigan, Tribune Tower, Wrigley Building, Marina City, Aqua, St. Regis, Aon, Merchandise Mart, etc.) with quality `fact`, `description`, and tuned `prominence`.

## 4. Sensor layer

### 4.1 Orientation (`useOrientation.ts`)

- **iOS:** `DeviceOrientationEvent.requestPermission()` MUST be called from a user gesture (button tap in PermissionGate). Use `deviceorientation` event; heading = `event.webkitCompassHeading` (degrees clockwise from north, already true-north on iOS).
- **Android:** use `deviceorientationabsolute` when available; heading = `(360 - event.alpha) % 360`. Note Android alpha is relative to an arbitrary origin unless the `absolute` variant fires — if only relative orientation is available, force radar-unavailable state and rely on calibration offset.
- Also read `event.beta` (pitch) for vertical label placement.
- **Smoothing:** exponential moving average with circular-mean handling for the 359°→0° wraparound: convert headings to unit vectors, average vectors, convert back. Smoothing factor α ≈ 0.15 at 60Hz.
- **Confidence:** track heading variance over a 2s window. Variance > ~15° → low confidence → surface ConfidenceDot warning + offer radar view.
- Expose: `{ heading, pitch, confidence, available }`.

### 4.2 Geolocation (`useGeolocation.ts`)

`navigator.geolocation.watchPosition` with `enableHighAccuracy: true`. Buildings are far away, so GPS error of 10–20m barely moves bearings — don't over-engineer. Cache last fix; show accuracy radius in UI only if > 50m.

### 4.3 Camera (`useCamera.ts`)

`getUserMedia({ video: { facingMode: "environment" } })` into a full-screen `<video playsinline muted>`. Assume horizontal field of view ≈ **60°** for the default 1x lens as a starting constant; expose as a calibratable setting later. If camera permission is denied, drop straight to RadarView — the app still works.

## 5. The matching math (`geo/`)

All angles in degrees in the public API, radians internally.

### 5.1 Bearing and distance (`bearing.ts`)

Haversine distance and initial great-circle bearing from user `(φ1, λ1)` to building `(φ2, λ2)`:

```
θ = atan2( sin(Δλ)·cos(φ2), cos(φ1)·sin(φ2) − sin(φ1)·cos(φ2)·cos(Δλ) )
bearing = (θ·180/π + 360) % 360
```

At skyline distances (< 10km) this is exact enough; no need for anything fancier.

### 5.2 Angular elevation (`elevation.ts`)

```
elevationAngle = atan2(heightM − observerEyeHeight, distanceM) · 180/π
```

Use `observerEyeHeight = 1.6m`. Ignore Earth curvature and observer altitude in V1 (error is negligible under 10km; note as a known simplification).

### 5.3 Matching and scoring (`matcher.ts`)

Inputs: user position, smoothed heading, pitch, calibration offset, FOV (60°), building list.

1. **Prefilter:** distance between 50m and 8000m. (< 50m: you're inside/under it — special-case "You're at {name}" chip.)
2. **FOV filter:** angular delta `Δ = wrap180(bearing − (heading + calibrationOffset))`; keep `|Δ| ≤ FOV/2 + 5°` (5° margin so labels slide in/out smoothly at edges).
3. **Visibility heuristic (occlusion-lite):** sort candidates by distance; a building is kept if its elevation angle is within 1.5° of, or greater than, the max elevation angle of all nearer kept buildings within ±3° of the same bearing. This crudely culls short buildings hidden behind tall near ones. Known imperfection; ship it.
4. **Score:** `score = prominence × 2 − |Δ|/10 − distanceKm/2`. Sort descending.
5. **Label layout:** screen-x from `Δ/FOV`, screen-y from elevation angle vs pitch. Cap at **7 labels**; greedy collision pass — if two labels overlap, drop the lower-scored one. Return list of `{ building, x, y, score }`.

Recompute at most every 100ms (throttle), not per sensor event.

### 5.4 Required unit tests (`matcher.test.ts`)

- Bearing: known pairs (e.g., due-north pair returns ~0°, Willis Tower from Buckingham Fountain ≈ known value; assert ±1°).
- wrap180 correctness across the 359/0 seam.
- FOV filter includes/excludes at boundary ±(FOV/2+5).
- Occlusion: tall near building culls short far building at same bearing; does NOT cull when bearings differ by > 3°.
- Label cap and collision-drop behavior.

## 6. Views and UX flow

### 6.1 PermissionGate (first launch)

Three sequential cards, each with one button, requesting in order: location → motion/orientation (the iOS gesture requirement lives here) → camera. Each card states plainly why ("Your heading tells us which buildings you're facing"). Camera denial is non-fatal → radar mode. Location denial IS fatal → explain and stop.

### 6.2 CameraView (primary)

Full-screen video. Labels rendered as absolutely-positioned divs in an overlay layer (no canvas needed for V1). Label = building name + height chip, connected by a 1px leader line to its anchor point. Tap → DetailCard. Top corner: ConfidenceDot (green/amber/red from heading confidence) — tapping it explains calibration. Bottom corner: toggle to RadarView.

**Calibration:** horizontal one-finger drag on the video adjusts `calibrationOffset` (degrees, persisted to localStorage). First-run hint: "Labels misaligned? Drag to line them up." This single gesture is the pragmatic answer to compass drift — do not skip it.

### 6.3 RadarView (fallback + toggle)

Canvas rendering a stylized 360° skyline ribbon: buildings as simple extruded silhouettes positioned by bearing, height-scaled, current heading centered, sweeping as the user turns. Works even with garbage compass (user can drag-rotate manually). Same tap-for-detail behavior.

### 6.4 DetailCard

Bottom sheet (~55% height, drag to expand/dismiss): name, hero image if available, height (ft + m), year, architect, style, the one curated `fact` styled distinctly, `description`, Wikipedia link, "distance from you."

## 7. Design direction

Subject: architecture at dusk — the hour skylines are actually admired. Not a generic dark app and not a cream-paper default.

- **Palette:** deep blue-slate night sky (#141B2D), warm sodium-lamp amber accent (#F5A623) for labels/leader lines (reads as city lights at night, legible over video), soft white text (#F4F6FB), muted steel (#8A93A6) for secondary, danger/low-confidence red-orange (#E4572E).
- **Type:** a geometric/architectural display face for building names (e.g., Archivo or Space Grotesk) — buildings deserve nameplates, not body text; Inter for UI/body.
- **Signature element:** the labels themselves — rendered like brass building plaques / surveyor's marks with the leader line, so the AR layer feels like an architect's annotated drawing over the real city.
- **Motion:** labels fade+rise 150ms as buildings enter FOV; otherwise restrained. Respect `prefers-reduced-motion`.

## 8. Edge cases and rules

- Indoors / no GPS fix in 10s → friendly "step outside" state.
- Zero matches in FOV → subtle "no notable buildings this way — try turning toward downtown" after 3s, with an arrow toward the highest-prominence cluster.
- Desktop browser → static explainer page with a QR code to open on a phone.
- Night use works by definition (labels don't depend on image recognition) — worth stating in marketing.
- All sensor listeners cleaned up on unmount; camera stream stopped when tab hidden (battery).
- PWA manifest + service worker caching app shell + chicago.json (offline radar works; camera view works offline too since no network calls at runtime).

## 9. Milestones (build order for Claude Code)

1. **M1 — Math + Radar (de-risk):** data pipeline producing chicago.json with ≥ 20 Loop buildings, geo module with passing tests, RadarView driven by real sensors. *Field-test outdoors before proceeding.*
2. **M2 — Camera AR:** CameraView, labels, calibration drag, confidence indicator, PermissionGate.
3. **M3 — Content:** full ~200-building dataset, curated overlay for top 50, DetailCard.
4. **M4 — Polish:** design pass per §7, PWA/offline, empty/error states, Vercel deploy.

## 10. Known V1 simplifications (accepted)

Fixed 60° FOV constant; no zoom-lens awareness; occlusion heuristic is crude; no terrain elevation; single city hardcoded; no analytics (add a privacy-respecting counter like Plausible in M4 if desired).
