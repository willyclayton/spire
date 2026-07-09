# Skygazer for Skylines — Business Plan
*Working title: TBD (candidates: Spire, Lookup, Cityscope, Skygazer)*

## 1. One-liner

A stargazing app for city skylines. Point your phone at a city and it tells you what you're looking at — building names, heights, architects, and stories, overlaid live on your camera.

## 2. Problem

Standing in a city, looking at a skyline, and wondering "what is that building?" is a universal moment with no good answer today. Options are: ask a local, squint at Google Maps in 2D, take a photo and hope Google Lens guesses right, or pay $50 for an architecture boat tour. None of them work in the moment, hands-up, looking at the actual skyline.

## 3. Solution

Live AR identification. Hold the phone up; buildings in view get labeled. Tap a label for a detail card: height, year, architect, one genuinely interesting fact. When compass conditions are bad (urban canyons wreck magnetometers), the app degrades gracefully to a "radar" view — a stylized rotating skyline that tracks your heading.

The magic moment is the sweep: panning slowly across a skyline and watching names appear. That's the product. Everything else supports it.

## 4. Target users, in priority order

1. **Tourists in architecture-forward cities.** Chicago first — 55M+ visitors/year, an architecture-obsessed identity, and the river cruise proves people pay for exactly this content. NYC and SF next.
2. **Locals and commuters.** The "I've walked past that tower for 5 years and never knew its name" crowd. Lower urgency, higher retention potential.
3. **Architecture enthusiasts.** Small segment, disproportionate word-of-mouth. They will find data errors for free and evangelize if the app respects the subject.

## 5. Market context and competition

- **Google Lens / Apple Visual Look Up:** photo-based, one building at a time, hit-or-miss on non-landmarks. No live sweep experience. This is the main "why not just use…" objection; the answer is the continuous AR experience and curated content depth.
- **Stargazing apps (SkyView, Star Walk, Stellarium):** the proven interaction model and business model (paid app / freemium, tens of millions of downloads). This category is the existence proof that "point and identify" sells.
- **Architecture tour apps / audio guides:** static, route-based, city-specific. Potential partners more than competitors.
- No incumbent owns "live skyline identification." The moat is not the math (replicable) but data curation quality + experience polish + city coverage.

## 6. Product roadmap

**V1 (validate the magic):** Chicago only. ~200 notable buildings. Camera AR with radar fallback. Detail cards. No accounts, no backend, free.

**V2 (retention + willingness to pay):** second city (NYC), spotted-buildings collection ("40 of Chicago's 100 tallest"), share a labeled skyline photo, offline mode.

**V3 (expansion):** native app if web sensor limitations bite, historical mode (skyline by decade), walking tours, 10+ cities via the automated data pipeline.

## 7. Monetization

- **Free tier:** one city, live identify, basic cards.
- **Premium (~$19.99/yr or $4.99/city pack):** all cities, offline, historical mode, tours. Stargazing apps validate these price points.
- **B2B (possibly the real business):** white-label/licensed versions for architecture boat tours, hotel concierge tablets, tourism boards, real estate developers. One tourism board contract can exceed a year of consumer revenue. Pursue after consumer traction proves the experience.

## 8. Risks and honest mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Compass inaccuracy in urban canyons | **High — the #1 risk** | Prototype this first, before any UI polish. Drag-to-calibrate gesture, confidence indicator, radar fallback, prominence-weighted matching so tall/close buildings win ambiguity. |
| "Google Lens does this" | Medium | Differentiate on live sweep + curated storytelling, not raw ID accuracy. |
| Data thin beyond top ~50 buildings | Medium | Hybrid pipeline: automated OSM/Wikidata for geometry, hand-curated overlay for facts on marquee buildings. Quality over coverage in V1. |
| Web sensor APIs are flaky (esp. iOS) | Medium | Accept for validation phase; native app is the known fix if the concept proves out. |
| Novelty app: one wow, no retention | Medium | Fine for V1 — the test is the wow. Collections/tours are the retention play, added only after the wow is confirmed. |

## 9. Validation plan (90 days)

- **Weeks 1–2:** working prototype, 20 Loop buildings. Sole goal: does point-and-identify feel accurate and magical outdoors? Kill/adjust decision here.
- **Weeks 3–6:** full Chicago dataset (~200 buildings), polished UI, PWA shipped to a public URL.
- **Weeks 7–8:** field testing — hand the URL to strangers at the Riverwalk and Millennium Park. Watch, don't ask. Metrics: time-to-first-"whoa," identify accuracy rate, whether they pull out the phone unprompted a second time.
- **Weeks 9–12:** decide — native app, second city, B2B conversations, or kill.

**Success criteria for continuing:** ≥80% identify accuracy on prominent buildings in field tests, and unprompted "can I send this to someone" reactions.

## 10. Costs (V1)

Effectively zero marginal cost: static site hosting (Vercel free tier), no backend, no API costs at runtime (all data precomputed into static JSON), open data sources (OSM, Wikidata). The only spend is time and eventually an Apple Developer account ($99/yr) if/when going native.
