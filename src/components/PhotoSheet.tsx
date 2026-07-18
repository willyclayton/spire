import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoricalPhoto, Pin } from '../history/types';
import { arButtonEligible } from '../history/pinStore';
import { distanceM } from '../geo/bearing';
import { EraTimeline } from './EraTimeline';
import { ThenNowToggle } from './ThenNowToggle';
import { AttributionChip } from './AttributionChip';
import { ShareButton, composePhotoCard } from './ShareCapture';

interface Props {
  pin: Pin;
  photos: HistoricalPhoto[]; // deep (from index) + recent (fetched), era-sorted
  observer: { lat: number; lon: number };
  gpsAccuracyM: number;
  recentLoading: boolean;
  onOpenAR: (photo: HistoricalPhoto) => void;
  onClose: () => void;
}

const NOW_YEAR = new Date().getFullYear();

/**
 * Bottom sheet (~60% height, drag to expand/dismiss) — the browse payoff.
 * Photo + era timeline + attribution + then/now + AR entry + directions + share.
 * See TIME_MACHINE_SPEC.md §3.2.
 */
export function PhotoSheet({
  pin,
  photos,
  observer,
  gpsAccuracyM,
  recentLoading,
  onOpenAR,
  onClose,
}: Props) {
  const deepPhotos = useMemo(() => photos.filter((p) => p.layer === 'deep'), [photos]);
  const recentPhotos = useMemo(() => photos.filter((p) => p.layer === 'recent'), [photos]);
  const hasRecent = recentPhotos.length > 0;

  const [selectedId, setSelectedId] = useState(photos[0]?.id ?? '');
  const [mode, setMode] = useState<'then' | 'now'>('then');

  // Keep a valid selection as photos stream in (recent layer arrives late).
  useEffect(() => {
    if (!photos.some((p) => p.id === selectedId)) setSelectedId(photos[0]?.id ?? '');
  }, [photos, selectedId]);

  const selected = photos.find((p) => p.id === selectedId) ?? photos[0];

  // Then/Now picks representative photos of each layer around the selection.
  const nowPhoto = recentPhotos[recentPhotos.length - 1];
  const thenPhoto = deepPhotos[0] ?? selected;
  const shown = hasRecent ? (mode === 'then' ? thenPhoto : nowPhoto) : selected;

  // Drag-to-dismiss.
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  if (!shown) return null;

  const dist = distanceM(observer, { lat: shown.lat, lon: shown.lon });
  const arReady = arButtonEligible({ photo: shown, distanceM: dist, gpsAccuracyM });
  const farFromPin = dist > 75;

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '88vh', transform: `translateY(${dragY}px)` }}
        className="w-full rounded-t-3xl border-t border-sepia/25 bg-night p-5 pb-8 shadow-2xl transition-transform"
      >
        {/* Drag handle */}
        <div
          className="mx-auto mb-3 h-1 w-12 cursor-grab rounded-full bg-white/20"
          onPointerDown={(e) => {
            startY.current = e.clientY;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (startY.current === null) return;
            setDragY(Math.max(0, e.clientY - startY.current));
          }}
          onPointerUp={() => {
            if (dragY > 120) onClose();
            setDragY(0);
            startY.current = null;
          }}
        />

        <div className="overflow-y-auto" style={{ maxHeight: '80vh' }}>
          {/* Photo — letterboxed with blurred fill, never stretched (spec §3.2). */}
          <div className="tm-archival relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
            <img
              src={shown.imageUrl}
              alt={shown.caption ?? `Chicago, ${shown.era}`}
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl"
              aria-hidden
            />
            <img
              key={shown.id}
              src={shown.imageUrl}
              alt={shown.caption ?? `Chicago, ${shown.era}`}
              className="tm-ghost-in absolute inset-0 h-full w-full object-contain"
              loading="lazy"
            />
            <div className="absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold tabular-nums text-sepia backdrop-blur">
              {shown.era}
              {shown.layer === 'recent' && NOW_YEAR - shown.era <= 3 ? ' · Now' : ''}
            </div>
            {hasRecent && (
              <div className="absolute right-2 top-2">
                <ThenNowToggle mode={mode} onChange={setMode} />
              </div>
            )}
            <div className="absolute bottom-2 left-2">
              <AttributionChip photo={shown} />
            </div>
          </div>

          {/* Caption + meta */}
          <div className="mt-3">
            {shown.caption && (
              <p className="font-display text-lg leading-snug text-soft">{shown.caption}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-wider text-steel">
              <span className="tabular-nums text-sepia">{shown.era}</span>
              <span>{formatDistance(dist)} away</span>
              {recentLoading && <span className="text-steel/70">loading recent…</span>}
            </div>
          </div>

          {/* Era timeline (only with 2+ photos) */}
          <EraTimeline photos={photos} selectedId={shown.id} onSelect={(id) => {
            setSelectedId(id);
            setMode(photos.find((p) => p.id === id)?.layer === 'recent' ? 'now' : 'then');
          }} />

          {/* Actions */}
          <div className="mt-5 flex flex-wrap gap-2">
            {arReady ? (
              <button
                onClick={() => onOpenAR(shown)}
                className="flex-1 rounded-full bg-sepia px-5 py-3 text-sm font-semibold uppercase tracking-wider text-night active:scale-95"
              >
                View in AR
              </button>
            ) : farFromPin ? (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${shown.lat},${shown.lon}`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 rounded-full border border-sepia/50 px-5 py-3 text-center text-sm font-semibold uppercase tracking-wider text-sepia active:scale-95"
              >
                Directions
              </a>
            ) : null}
            <ShareButton
              compose={() => composePhotoCard(shown)}
              filename={`spire-${shown.era}-${pin.id}.jpg`}
              text={`Chicago, ${shown.era} — via Spire`}
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-semibold uppercase tracking-wider text-soft active:scale-95"
            >
              Share
            </ShareButton>
          </div>

          {shown.standHint && (
            <p className="mt-3 text-xs italic text-steel">Stand: {shown.standHint}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
