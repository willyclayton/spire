import type { HistoricalPhoto } from '../history/types';

export interface TimelineStop {
  key: string;
  label: string;
  layer: 'deep' | 'recent';
  photos: HistoricalPhoto[];
}

const NOW_YEAR = new Date().getFullYear();

/**
 * Collapse a pin's photos into meaningful timeline stops: one per distinct
 * historical year, plus a single "Now" for all recent street-level views. This is
 * what keeps the timeline honest — a dozen same-year Mapillary frames become one
 * "Now" dot, not a dozen identical "2016"s.
 */
export function buildStops(photos: HistoricalPhoto[]): TimelineStop[] {
  const deepByEra = new Map<number, HistoricalPhoto[]>();
  const recent: HistoricalPhoto[] = [];
  for (const p of photos) {
    if (p.layer === 'recent') {
      recent.push(p);
    } else {
      const bucket = deepByEra.get(p.era) ?? [];
      bucket.push(p);
      deepByEra.set(p.era, bucket);
    }
  }
  const stops: TimelineStop[] = [...deepByEra.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([era, ph]) => ({
      key: `y${era}`,
      label: String(era),
      layer: 'deep' as const,
      // Best (highest-res) representative first.
      photos: ph.sort((a, b) => b.width * b.height - a.width * a.height),
    }));
  if (recent.length) {
    stops.push({
      key: 'now',
      label: 'Now',
      layer: 'recent',
      photos: recent.sort((a, b) => b.era - a.era),
    });
  }
  return stops;
}

/** Dot color by stop: gold = historical era, white = now (spec §3.2, §8). */
function dotClasses(stop: TimelineStop, active: boolean): string {
  const isNow = stop.layer === 'recent';
  const base = isNow ? 'bg-soft' : 'bg-sepia';
  return `${base} ${active ? 'scale-150 ring-2 ring-white/70' : 'opacity-70'}`;
}

/**
 * The era timeline beneath the photo — one dot per stop, tap to switch. Rendered
 * only when the pin spans more than one stop.
 */
export function EraTimeline({
  stops,
  selectedKey,
  onSelect,
}: {
  stops: TimelineStop[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  if (stops.length < 2) return null;

  return (
    <div className="mt-4 select-none">
      <div className="relative flex items-center justify-between px-1">
        <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-white/15" />
        {stops.map((stop) => {
          const active = stop.key === selectedKey;
          const multi = stop.photos.length > 1;
          return (
            <button
              key={stop.key}
              onClick={() => onSelect(stop.key)}
              aria-label={`${stop.label}${multi ? ` (${stop.photos.length} photos)` : ''}`}
              aria-pressed={active}
              className="relative flex flex-col items-center gap-1.5 px-1 py-1"
            >
              <span className={`relative h-2.5 w-2.5 rounded-full transition-transform ${dotClasses(stop, active)}`}>
                {multi && active && (
                  <span className="absolute -right-2 -top-2 flex h-3 items-center justify-center rounded-full bg-night px-1 text-[8px] font-semibold text-steel">
                    {stop.photos.length > 9 ? '9+' : stop.photos.length}
                  </span>
                )}
              </span>
              <span className={`text-[10px] tabular-nums transition-colors ${active ? 'text-soft' : 'text-steel'}`}>
                {stop.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { NOW_YEAR };
