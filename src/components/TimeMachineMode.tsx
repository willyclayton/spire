import { useEffect, useMemo, useState } from 'react';
import { useHistoryStore } from '../history/pinStore';
import { fetchRecentForPin } from '../history/mapillary';
import type { HistoricalPhoto } from '../history/types';
import { HistoryMapView } from './HistoryMapView';
import { HistoryListView } from './HistoryListView';
import { PhotoSheet } from './PhotoSheet';
import { ARGhostView } from './ARGhostView';

interface Props {
  observer: { lat: number; lon: number };
  gpsAccuracyM: number;
  usingFallback: boolean;
  headingDeg: number;
  headingAvailable: boolean;
  confidence: 'high' | 'medium' | 'low';
  onExitMode: () => void;
}

/**
 * Time Machine orchestrator (spec §2, §3): the map is the front door; tapping a pin
 * opens the Photo Sheet; the AR button (when on-site) opens the Ghost view. Owns
 * pin selection, the recent-layer fetch, and the AR photo.
 */
export function TimeMachineMode({
  observer,
  gpsAccuracyM,
  usingFallback,
  headingDeg,
  headingAvailable,
  confidence,
  onExitMode,
}: Props) {
  const status = useHistoryStore((s) => s.status);
  const error = useHistoryStore((s) => s.error);
  const loadIndex = useHistoryStore((s) => s.loadIndex);
  const index = useHistoryStore((s) => s.index);
  const getPhoto = useHistoryStore((s) => s.getPhoto);
  const addRecentPhotos = useHistoryStore((s) => s.addRecentPhotos);
  const selectedPinId = useHistoryStore((s) => s.selectedPinId);
  const selectPin = useHistoryStore((s) => s.selectPin);

  const [recentForPin, setRecentForPin] = useState<HistoricalPhoto[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [arPhoto, setArPhoto] = useState<HistoricalPhoto | null>(null);
  const [tmView, setTmView] = useState<'map' | 'list'>('map');

  useEffect(() => {
    loadIndex();
  }, [loadIndex]);

  const selectedPin = useMemo(
    () => index?.pins.find((p) => p.id === selectedPinId) ?? null,
    [index, selectedPinId],
  );

  // Fetch the recent (Mapillary) layer when a pin opens; merge into its timeline.
  useEffect(() => {
    setRecentForPin([]);
    if (!selectedPin) return;
    let cancelled = false;
    setRecentLoading(true);
    fetchRecentForPin(selectedPin)
      .then((photos) => {
        if (cancelled) return;
        addRecentPhotos(photos);
        setRecentForPin(photos);
      })
      .finally(() => !cancelled && setRecentLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedPin, addRecentPhotos]);

  const sheetPhotos = useMemo(() => {
    if (!selectedPin) return [];
    const deep = selectedPin.photoIds
      .map((id) => getPhoto(id))
      .filter((p): p is HistoricalPhoto => Boolean(p));
    return [...deep, ...recentForPin].sort((a, b) => a.era - b.era);
  }, [selectedPin, recentForPin, getPhoto]);

  return (
    <div className="absolute inset-0 z-40 bg-night">
      {tmView === 'map' ? (
        <HistoryMapView observer={usingFallback ? null : observer} onSelectPin={selectPin} />
      ) : (
        <HistoryListView observer={usingFallback ? null : observer} onSelectPin={selectPin} />
      )}

      {/* Exit back to menu */}
      <button
        onClick={onExitMode}
        className="absolute bottom-5 left-4 z-20 flex items-center gap-1.5 rounded-full border border-white/15 bg-night/80 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-soft backdrop-blur active:scale-95"
      >
        ← Menu
      </button>

      {/* Map / List toggle */}
      <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 rounded-full border border-white/15 bg-night/80 p-0.5 backdrop-blur">
        {(['map', 'list'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setTmView(v)}
            aria-pressed={tmView === v}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
              tmView === v ? 'bg-sepia text-night' : 'text-steel'
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-x-0 top-24 z-20 text-center text-xs text-steel">
          Loading history…
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-x-4 top-24 z-20 rounded-xl border border-danger/40 bg-black/80 p-3 text-center text-xs text-danger">
          Couldn’t load the history index{error ? `: ${error}` : ''}.
        </div>
      )}

      {selectedPin && sheetPhotos.length > 0 && !arPhoto && (
        <PhotoSheet
          pin={selectedPin}
          photos={sheetPhotos}
          observer={observer}
          gpsAccuracyM={gpsAccuracyM}
          recentLoading={recentLoading}
          onOpenAR={setArPhoto}
          onClose={() => selectPin(null)}
        />
      )}

      {arPhoto && (
        <ARGhostView
          photo={arPhoto}
          headingDeg={headingDeg}
          headingAvailable={headingAvailable}
          confidence={confidence}
          onExit={() => setArPhoto(null)}
        />
      )}
    </div>
  );
}
