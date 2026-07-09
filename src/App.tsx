import { useEffect, useMemo, useState } from 'react';
import { useStore } from './store';
import { useGeolocation } from './sensors/useGeolocation';
import { useOrientation } from './sensors/useOrientation';
import { useCamera } from './sensors/useCamera';
import { PermissionGate } from './components/PermissionGate';
import { RadarView } from './components/RadarView';
import { CameraView } from './components/CameraView';
import { ConfidenceDot } from './components/ConfidenceDot';
import { DetailCard } from './components/DetailCard';
import { CalibrationHint } from './components/CalibrationHint';
import { distanceM } from './geo/bearing';

const CHICAGO_FALLBACK = { lat: 41.882, lon: -87.629, accuracyM: 999 };

export default function App() {
  const stage = useStore((s) => s.stage);
  const setStage = useStore((s) => s.setStage);
  const loadBuildings = useStore((s) => s.loadBuildings);
  const buildings = useStore((s) => s.buildings);
  const selectedBuildingId = useStore((s) => s.selectedBuildingId);
  const selectBuilding = useStore((s) => s.selectBuilding);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const cameraOptIn = useStore((s) => s.cameraOptIn);
  const setCameraOptIn = useStore((s) => s.setCameraOptIn);

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadBuildings().catch((err) => setLoadError(err.message));
  }, [loadBuildings]);

  const geo = useGeolocation(stage === 'ready');
  const orient = useOrientation(stage === 'ready');
  const camera = useCamera(stage === 'ready' && cameraOptIn && view === 'camera');

  // If camera denied or unavailable, force radar.
  useEffect(() => {
    if (camera.status === 'denied' || camera.status === 'unavailable' || camera.status === 'error') {
      if (view === 'camera') setView('radar');
    }
  }, [camera.status, view, setView]);

  const observer = geo.position ?? CHICAGO_FALLBACK;
  const usingFallback = !geo.position;

  const selectedBuilding = useMemo(
    () => buildings.find((b) => b.id === selectedBuildingId) ?? null,
    [buildings, selectedBuildingId],
  );

  if (stage === 'onboarding') {
    return (
      <PermissionGate
        onComplete={(camIn) => {
          setCameraOptIn(camIn);
          setStage('ready');
        }}
      />
    );
  }

  return (
    <main className="relative h-full w-full overflow-hidden bg-night text-soft">
      {view === 'camera' && cameraOptIn ? (
        <CameraView
          observer={observer}
          headingDeg={orient.heading}
          pitchDeg={orient.pitch}
          headingAvailable={orient.available}
          videoRef={camera.videoRef}
        />
      ) : (
        <RadarView
          observer={observer}
          headingDeg={orient.heading}
          confidence={orient.confidence}
          headingAvailable={orient.available}
        />
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
        <div className="pointer-events-auto flex flex-col gap-1">
          <span className="font-display text-lg leading-none text-amber">Spire</span>
          <span className="text-[10px] uppercase tracking-widest text-steel">
            Chicago · {view === 'camera' ? 'Live' : 'Radar'}
          </span>
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
                  'Noisy = drag horizontally to align labels to what you actually see.',
              );
            }}
          />
          {usingFallback && (
            <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-danger backdrop-blur">
              Using downtown fallback
            </span>
          )}
          {camera.status === 'denied' && view === 'radar' && (
            <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-steel backdrop-blur">
              Camera denied — radar only
            </span>
          )}
        </div>
      </div>

      {/* Bottom bar: view toggle + status */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex items-center justify-center gap-3 px-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/50 px-3 py-2 text-xs text-steel backdrop-blur">
          <span className="tabular-nums">{Math.round((orient.heading + 360) % 360)}°</span>
          <span>·</span>
          <span>{buildings.length}</span>
          {geo.position && geo.position.accuracyM > 50 && (
            <>
              <span>·</span>
              <span>±{Math.round(geo.position.accuracyM)}m</span>
            </>
          )}
        </div>
        {(cameraOptIn && camera.status !== 'denied' && camera.status !== 'unavailable') && (
          <button
            onClick={() => setView(view === 'camera' ? 'radar' : 'camera')}
            className="pointer-events-auto rounded-full border border-amber/60 bg-night/70 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-amber backdrop-blur active:scale-95"
          >
            {view === 'camera' ? 'Radar' : 'Camera'}
          </button>
        )}
      </div>

      {view === 'camera' && <CalibrationHint />}

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
    <div className="pointer-events-none absolute inset-x-4 top-24 z-30 rounded-xl border border-amber/30 bg-black/70 p-3 text-center text-xs text-amber backdrop-blur">
      {message}
    </div>
  );
}
