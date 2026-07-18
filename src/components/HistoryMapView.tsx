import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Supercluster from 'supercluster';
import { useHistoryStore, filterPinsByEra, pinsToFeatures, ERA_MIN, ERA_NOW } from '../history/pinStore';
import type { PinFeatureProps } from '../history/pinStore';

// Free, no-key vector tiles (OpenFreeMap). Positron is light/desaturated so the
// gold pins carry the view (spec §8). Override with VITE_MAP_STYLE if desired.
const MAP_STYLE =
  (import.meta.env.VITE_MAP_STYLE as string | undefined) ??
  'https://tiles.openfreemap.org/styles/positron';

const CHICAGO: [number, number] = [-87.6298, 41.8781];
const reducedMotion =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Props {
  observer: { lat: number; lon: number } | null;
  onSelectPin: (pinId: string) => void;
}

/** Full-screen history map: MapLibre + client-side Supercluster + era filter. */
export function HistoryMapView({ observer, onSelectPin }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string | number, maplibregl.Marker>>(new Map());
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [ready, setReady] = useState(false);

  const index = useHistoryStore((s) => s.index);
  const eraRange = useHistoryStore((s) => s.eraRange);
  const setEraRange = useHistoryStore((s) => s.setEraRange);
  const setMapView = useHistoryStore((s) => s.setMapView);

  const filteredPins = useMemo(
    () => (index ? filterPinsByEra(index.pins, eraRange[0], eraRange[1]) : []),
    [index, eraRange],
  );

  // Publish the current camera + viewport bounds so the list can follow the map.
  const publishView = () => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const b = map.getBounds();
    setMapView({
      center: [c.lng, c.lat],
      zoom: map.getZoom(),
      bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
    });
  };

  // Init map once — restoring the last camera so map⇄list toggling keeps your view.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const restored = useHistoryStore.getState().mapView;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: restored?.center ?? CHICAGO,
      zoom: restored?.zoom ?? 12.5,
      attributionControl: { compact: true },
    });
    map.getCanvas().classList.add('tm-map-canvas');
    map.on('load', () => {
      setReady(true);
      publishView();
    });
    map.on('moveend', () => {
      renderClustersRef.current?.();
      publishView();
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Supercluster index rebuilt when the filtered set changes.
  const superRef = useRef<Supercluster<PinFeatureProps> | null>(null);
  useEffect(() => {
    if (!ready) return;
    const sc = new Supercluster<PinFeatureProps>({ radius: 60, maxZoom: 16, minPoints: 3 });
    sc.load(pinsToFeatures(filteredPins) as GeoJSON.Feature<GeoJSON.Point, PinFeatureProps>[]);
    superRef.current = sc;
    renderClustersRef.current?.();
  }, [ready, filteredPins]);

  // Marker reconciliation against the current viewport + zoom.
  const renderClustersRef = useRef<() => void>();
  renderClustersRef.current = () => {
    const map = mapRef.current;
    const sc = superRef.current;
    if (!map || !sc) return;
    const b = map.getBounds();
    const bbox: [number, number, number, number] = [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth(),
    ];
    const zoom = Math.round(map.getZoom());
    const clusters = sc.getClusters(bbox, zoom);

    const live = markersRef.current;
    const seen = new Set<string | number>();

    for (const c of clusters) {
      const [lon, lat] = c.geometry.coordinates;
      const props = c.properties as Supercluster.ClusterProperties & PinFeatureProps;
      const key = props.cluster ? `c${props.cluster_id}` : `p${props.pinId}`;
      seen.add(key);
      if (live.has(key)) {
        live.get(key)!.setLngLat([lon, lat]);
        continue;
      }
      const el = props.cluster
        ? clusterEl(props.point_count, () => {
            const z = Math.min(sc.getClusterExpansionZoom(props.cluster_id), 18);
            map[reducedMotion ? 'jumpTo' : 'easeTo']({ center: [lon, lat], zoom: z });
          })
        : pinEl(props, () => onSelectPin(props.pinId));
      const marker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
      live.set(key, marker);
    }

    // Drop markers no longer present.
    for (const [key, marker] of live) {
      if (!seen.has(key)) {
        marker.remove();
        live.delete(key);
      }
    }
  };

  // User location dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !observer) return;
    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.className =
        'h-4 w-4 rounded-full border-2 border-white bg-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.3)]';
      userMarkerRef.current = new maplibregl.Marker({ element: el });
    }
    userMarkerRef.current.setLngLat([observer.lon, observer.lat]).addTo(map);
  }, [observer, ready]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      <FilterBar
        eraRange={eraRange}
        onEraRange={setEraRange}
        onNearMe={() => {
          const map = mapRef.current;
          if (map && observer) {
            map[reducedMotion ? 'jumpTo' : 'flyTo']({ center: [observer.lon, observer.lat], zoom: 15 });
          }
        }}
        canNearMe={!!observer}
        count={filteredPins.length}
      />
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-20 left-3 z-10 flex flex-col gap-1 rounded-xl border border-white/10 bg-night/80 px-3 py-2 text-[10px] text-steel backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: EXACT_COLOR, border: '1px solid rgba(0,0,0,0.3)' }} />
        <span>Exact spot</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: APPROX_COLOR, border: '1px dashed rgba(255,255,255,0.55)', boxShadow: `0 0 0 2px ${APPROX_COLOR}33` }}
        />
        <span>General area</span>
      </div>
    </div>
  );
}

// ── Marker elements ───────────────────────────────────────────────────────────

function clusterEl(count: number, onClick: () => void): HTMLElement {
  const el = document.createElement('button');
  const size = count < 25 ? 34 : count < 150 ? 44 : 56;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.className =
    'flex items-center justify-center rounded-full border border-sepia/60 bg-night/85 text-xs font-semibold text-sepia backdrop-blur transition-transform active:scale-95';
  el.textContent = String(count);
  el.onclick = onClick;
  return el;
}

// Dot color encodes LOCATION PRECISION: yellow/gold = exact spot, blue = best
// guess / general area. Approximate pins also get a soft halo so they read as
// "somewhere around here" rather than a precise point.
const EXACT_COLOR = '#C9A227'; // sepia-gold
const APPROX_COLOR = '#4C9BE8'; // blue

function pinEl(props: PinFeatureProps, onClick: () => void): HTMLElement {
  const approximate = props.precision === 'approximate';
  const color = approximate ? APPROX_COLOR : EXACT_COLOR;
  const size = props.featured ? 20 : 15;

  const el = document.createElement('button');
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.setAttribute('aria-label', approximate ? 'Approximate location' : 'Exact location');
  el.className = 'relative rounded-full transition-transform active:scale-90';
  el.style.background = color;
  if (approximate) {
    // Fuzzy edge + wide halo = "general area".
    el.style.border = '1px dashed rgba(255,255,255,0.55)';
    el.style.boxShadow = `0 0 0 6px ${color}22, 0 0 10px 2px ${color}55`;
    el.style.opacity = '0.9';
  } else {
    el.style.border = '1px solid rgba(0,0,0,0.3)';
    if (props.featured) el.style.boxShadow = `0 0 10px 2px ${color}88`;
  }
  // Stacked-era count badge.
  if (props.count > 1) {
    const badge = document.createElement('span');
    badge.textContent = String(props.count);
    badge.className =
      'absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-night px-1 text-[9px] font-bold text-soft';
    el.appendChild(badge);
  }
  el.onclick = onClick;
  return el;
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({
  eraRange,
  onEraRange,
  onNearMe,
  canNearMe,
  count,
}: {
  eraRange: [number, number];
  onEraRange: (r: [number, number]) => void;
  onNearMe: () => void;
  canNearMe: boolean;
  count: number;
}) {
  const [lo, hi] = eraRange;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3">
      <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/10 bg-night/80 px-3 py-2 backdrop-blur">
        <div className="flex-1">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-steel">
            <span className="tabular-nums text-sepia">{lo}</span>
            <span>{count} pins</span>
            <span className="tabular-nums text-sepia">{hi >= ERA_NOW ? 'now' : hi}</span>
          </div>
          <div className="relative mt-1 h-4">
            <input
              type="range"
              min={ERA_MIN}
              max={ERA_NOW}
              value={lo}
              onChange={(e) => onEraRange([Math.min(Number(e.target.value), hi), hi])}
              className="tm-range absolute inset-x-0 top-1 w-full"
              aria-label="Earliest era"
            />
            <input
              type="range"
              min={ERA_MIN}
              max={ERA_NOW}
              value={hi}
              onChange={(e) => onEraRange([lo, Math.max(Number(e.target.value), lo)])}
              className="tm-range absolute inset-x-0 top-1 w-full"
              aria-label="Latest era"
            />
          </div>
        </div>
        <button
          onClick={onNearMe}
          disabled={!canNearMe}
          className="shrink-0 rounded-full border border-sepia/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sepia disabled:opacity-40"
        >
          Near me
        </button>
      </div>
    </div>
  );
}
