import { useMemo, useState } from 'react';
import { useHistoryStore, filterPinsByEra } from '../history/pinStore';
import type { HistoricalPhoto, Pin } from '../history/types';
import { distanceM } from '../geo/bearing';

type SortKey = 'name' | 'year' | 'distance';

interface Props {
  observer: { lat: number; lon: number } | null;
  onSelectPin: (pinId: string) => void;
}

interface Row {
  pin: Pin;
  photo: HistoricalPhoto;
  name: string;
  year: number;
  dist: number | null;
}

/** Shrink a Commons Special:FilePath render to a list thumbnail; leave others as-is. */
function thumb(url: string): string {
  return url.replace(/([?&]width=)\d+/, '$1200');
}

/**
 * List view — a lost-friendly alternative to the map. Since many locations are only
 * approximate, a sortable list (name / year / distance) lets you browse without a
 * dot implying more precision than we have. Tapping a row opens the same Photo Sheet.
 */
export function HistoryListView({ observer, onSelectPin }: Props) {
  const index = useHistoryStore((s) => s.index);
  const eraRange = useHistoryStore((s) => s.eraRange);
  const getPhoto = useHistoryStore((s) => s.getPhoto);
  const mapView = useHistoryStore((s) => s.mapView);

  const [sortKey, setSortKey] = useState<SortKey>(observer ? 'distance' : 'year');
  const [asc, setAsc] = useState(true);
  // Follow the map's zoomed region by default; "all" shows every pin.
  const [scope, setScope] = useState<'area' | 'all'>('area');

  const rows = useMemo<Row[]>(() => {
    if (!index) return [];
    let pins = filterPinsByEra(index.pins, eraRange[0], eraRange[1]);
    if (scope === 'area' && mapView) {
      const [w, s, e, n] = mapView.bounds;
      pins = pins.filter((p) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n);
    }
    const built: Row[] = [];
    for (const pin of pins) {
      // Representative = earliest deep photo (fallback: first).
      const photo = pin.photoIds.map((id) => getPhoto(id)).find(Boolean);
      if (!photo) continue;
      built.push({
        pin,
        photo,
        name: photo.caption?.trim() || `Chicago, ${pin.eras[0]}`,
        year: pin.eras[0],
        dist: observer ? distanceM(observer, { lat: pin.lat, lon: pin.lon }) : null,
      });
    }
    const dir = asc ? 1 : -1;
    const sortName = (s: string) => s.replace(/^[^a-z0-9]+/i, '').toLowerCase();
    built.sort((a, b) => {
      if (sortKey === 'name') return dir * sortName(a.name).localeCompare(sortName(b.name));
      if (sortKey === 'year') return dir * (a.year - b.year);
      return dir * ((a.dist ?? Infinity) - (b.dist ?? Infinity));
    });
    return built;
  }, [index, eraRange, getPhoto, observer, sortKey, asc, scope, mapView]);

  return (
    <div className="absolute inset-0 flex flex-col bg-night">
      {/* Header: scope (map area vs all) + sort */}
      <div className="z-10 flex flex-col gap-2 border-b border-white/10 bg-night/95 px-3 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wider text-steel">
            {rows.length} {rows.length === 1 ? 'place' : 'places'}
          </span>
          <div className="flex rounded-full border border-white/15 p-0.5 text-[10px] font-semibold uppercase tracking-wider">
            {(['area', 'all'] as const).map((sc) => (
              <button
                key={sc}
                onClick={() => setScope(sc)}
                disabled={sc === 'area' && !mapView}
                aria-pressed={scope === sc}
                className={`rounded-full px-3 py-1 transition-colors disabled:opacity-30 ${
                  scope === sc ? 'bg-sepia text-night' : 'text-steel'
                }`}
              >
                {sc === 'area' ? 'This area' : 'All Chicago'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {(['name', 'year', 'distance'] as const).map((k) => {
            const active = sortKey === k;
            const label = k === 'name' ? 'Name' : k === 'year' ? 'Year' : 'Distance';
            const disabled = k === 'distance' && !observer;
            return (
              <button
                key={k}
                disabled={disabled}
                onClick={() => {
                  if (active) setAsc((v) => !v);
                  else {
                    setSortKey(k);
                    setAsc(true); // new key defaults ascending: A–Z, oldest, nearest
                  }
                }}
                className={`flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-30 ${
                  active ? 'bg-sepia text-night' : 'border border-white/15 text-steel'
                }`}
              >
                {label}
                {active && <span className="text-[10px]">{asc ? '▲' : '▼'}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto pb-24">
        {rows.map(({ pin, photo, name, year, dist }) => {
          const approximate = pin.precision === 'approximate';
          return (
            <button
              key={pin.id}
              onClick={() => onSelectPin(pin.id)}
              className="flex w-full items-center gap-3 border-b border-white/5 px-3 py-2.5 text-left active:bg-white/5"
            >
              <img
                src={thumb(photo.imageUrl)}
                alt=""
                loading="lazy"
                className="h-14 w-14 shrink-0 rounded-lg bg-black/40 object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-soft">{name}</p>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] uppercase tracking-wider text-steel">
                  <span className="tabular-nums text-sepia">
                    {year}
                    {pin.eras.length > 1 ? `–${pin.eras[pin.eras.length - 1]}` : ''}
                  </span>
                  {dist !== null && <span>{formatDistance(dist)}</span>}
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background: approximate ? '#4C9BE8' : '#C9A227',
                      border: approximate ? '1px dashed rgba(255,255,255,0.5)' : 'none',
                    }}
                    title={approximate ? 'General area' : 'Exact spot'}
                  />
                  {pin.photoIds.length > 1 && <span>{pin.photoIds.length} photos</span>}
                </div>
              </div>
              <span className="shrink-0 text-lg text-steel">›</span>
            </button>
          );
        })}
        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-steel">No photos in this era range.</p>
        )}
      </div>
    </div>
  );
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
