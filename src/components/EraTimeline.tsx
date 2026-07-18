import type { HistoricalPhoto } from '../history/types';

const NOW_YEAR = new Date().getFullYear();

/** Dot color by layer/era: gold deep, steel recent, white "now" (spec §3.2, §8). */
function dotClasses(photo: HistoricalPhoto, active: boolean): string {
  const isNow = photo.layer === 'recent' && NOW_YEAR - photo.era <= 3;
  const base = isNow
    ? 'bg-soft'
    : photo.layer === 'recent'
      ? 'bg-steel'
      : 'bg-sepia';
  return `${base} ${active ? 'scale-150 ring-2 ring-white/70' : 'opacity-70'}`;
}

/**
 * The era timeline beneath the photo — one dot per era, tap or drag to switch
 * (spec §3.2). Rendered only when the pin has more than one photo.
 */
export function EraTimeline({
  photos,
  selectedId,
  onSelect,
}: {
  photos: HistoricalPhoto[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (photos.length < 2) return null;

  return (
    <div className="mt-4 select-none">
      <div className="relative flex items-center justify-between px-1">
        {/* Track */}
        <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-white/15" />
        {photos.map((p) => {
          const active = p.id === selectedId;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              aria-label={`${p.era}${p.layer === 'recent' ? ' (recent)' : ''}`}
              aria-pressed={active}
              className="relative flex flex-col items-center gap-1.5 px-1 py-1"
            >
              <span
                className={`h-2.5 w-2.5 rounded-full transition-transform ${dotClasses(p, active)}`}
              />
              <span
                className={`text-[10px] tabular-nums transition-colors ${
                  active ? 'text-soft' : 'text-steel'
                }`}
              >
                {p.era}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
