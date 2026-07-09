import type { Building } from '../types';

interface Props {
  building: Building;
  distanceM: number;
  onClose: () => void;
}

function metersToFeet(m: number): number {
  return Math.round(m * 3.28084);
}

export function DetailCard({ building, distanceM, onClose }: Props) {
  const b = building;
  return (
    <div
      className="fixed inset-0 z-30 flex items-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl border-t border-white/10 bg-night p-6 pb-10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '75vh', overflowY: 'auto' }}
      >
        <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-white/20" />
        {b.imageUrl && (
          <img
            src={b.imageUrl}
            alt={b.name}
            className="mb-4 max-h-48 w-full rounded-xl object-cover"
            loading="lazy"
          />
        )}
        <h2 className="font-display text-2xl leading-tight text-soft">{b.name}</h2>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs uppercase tracking-wider text-steel">
          <span>{Math.round(b.heightM)} m · {metersToFeet(b.heightM)} ft</span>
          {b.floors && <span>{b.floors} floors</span>}
          {b.yearCompleted && <span>{b.yearCompleted}</span>}
          <span>{formatDistance(distanceM)} away</span>
        </div>
        {b.architect && (
          <p className="mt-4 text-sm text-soft">
            <span className="text-steel">Architect: </span>
            {b.architect}
          </p>
        )}
        {b.style && (
          <p className="mt-1 text-sm text-soft">
            <span className="text-steel">Style: </span>
            {b.style}
          </p>
        )}
        {b.fact && (
          <div className="mt-5 rounded-xl border-l-4 border-amber bg-amber/10 p-4 font-display text-sm leading-relaxed text-soft">
            {b.fact}
          </div>
        )}
        {b.description && (
          <p className="mt-4 text-sm leading-relaxed text-soft/80">{b.description}</p>
        )}
        {b.wikipediaUrl && (
          <a
            href={b.wikipediaUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-block text-sm text-amber underline underline-offset-2"
          >
            Read more on Wikipedia →
          </a>
        )}
      </div>
    </div>
  );
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
