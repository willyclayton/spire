import { useEffect, useMemo, useState } from 'react';
import { useStore } from './store';
import { useGeolocation } from './sensors/useGeolocation';
import { useOrientation } from './sensors/useOrientation';
import { PermissionGate } from './components/PermissionGate';
import { RadarView } from './components/RadarView';
import { ConfidenceDot } from './components/ConfidenceDot';
import { DetailCard } from './components/DetailCard';
import { distanceM } from './geo/bearing';

// Downtown Chicago fallback so the radar shows something on desktop.
const CHICAGO_FALLBACK = { lat: 41.882, lon: -87.629, accuracyM: 999 };

export default function App() {
  const stage = useStore((s) => s.stage);
  const setStage = useStore((s) => s.setStage);
  const loadBuildings = useStore((s) => s.loadBuildings);
  const buildings = useStore((s) => s.buildings);
  const selectedBuildingId = useStore((s) => s.selectedBuildingId);
  const selectBuilding = useStore((s) => s.selectBuilding);

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadBuildings().catch((err) => setLoadError(err.message));
  }, [loadBuildings]);

  const geo = useGeolocation(stage === 'ready');
  const orient = useOrientation(stage === 'ready');

  const observer = geo.position ?? CHICAGO_FALLBACK;
  const usingFallback = !geo.position;

  const selectedBuilding = useMemo(
    () => buildings.find((b) => b.id === selectedBuildingId) ?? null,
    [buildings, selectedBuildingId],
  );

  if (stage === 'onboarding') {
    return <PermissionGate onComplete={() => setStage('ready')} />;
  }

  return (
    <main className="relative h-full w-full overflow-hidden bg-night text-soft">
      <RadarView
        observer={observer}
        headingDeg={orient.heading}
        confidence={orient.confidence}
        headingAvailable={orient.available}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4">
        <div className="pointer-events-auto flex flex-col gap-1">
          <span className="font-display text-lg leading-none text-amber">Spire</span>
          <span className="text-[10px] uppercase tracking-widest text-steel">Chicago · Radar</span>
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-1">
          <ConfidenceDot
            confidence={orient.confidence}
            available={orient.available}
            onClick={() => {
              alert(
                'Compass health.\n\n' +
                  'Steady = trust the labels.\n' +
                  'Drifting = give it a moment or move away from metal/large glass.\n' +
                  'Noisy = drag horizontally on the ribbon to align labels to what you actually see.',
              );
            }}
          />
          {usingFallback && (
            <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-danger backdrop-blur">
              Using downtown fallback
            </span>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex items-center justify-center gap-3 px-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/50 px-3 py-2 text-xs text-steel backdrop-blur">
          <span className="tabular-nums">{Math.round((orient.heading + 360) % 360)}°</span>
          <span>·</span>
          <span>{buildings.length} buildings</span>
          {geo.position && geo.position.accuracyM > 50 && (
            <>
              <span>·</span>
              <span>±{Math.round(geo.position.accuracyM)}m</span>
            </>
          )}
        </div>
      </div>

      {geo.status === 'denied' && <FatalOverlay message="Location access is required." />}
      {geo.status === 'timeout' && (
        <SoftOverlay message="Waiting for a location fix — step outside for a clearer signal." />
      )}
      {loadError && <FatalOverlay message={`Failed to load buildings: ${loadError}`} />}

      {selectedBuilding && (
        <DetailCard
          building={selectedBuilding}
          distanceM={distanceM(observer, { lat: selectedBuilding.lat, lon: selectedBuilding.lon })}
          onClose={() => selectBuilding(null)}
        />
      )}
    </main>
  );
}

function FatalOverlay({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-night/95 p-6 text-center">
      <div>
        <p className="mb-4 text-danger">{message}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-full bg-amber px-5 py-2 text-sm font-semibold text-night"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function SoftOverlay({ message }: { message: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-4 top-24 z-20 rounded-xl border border-amber/30 bg-black/70 p-3 text-center text-xs text-amber backdrop-blur">
      {message}
    </div>
  );
}
