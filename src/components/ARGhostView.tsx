import { useEffect, useRef, useState } from 'react';
import type { HistoricalPhoto } from '../history/types';
import { useCamera } from '../sensors/useCamera';
import {
  AR_FOV_DEG,
  autoOffsetX,
  effectiveTransform,
  isTransformed,
  loadTransform,
  saveTransform,
  clearTransform,
  type GhostTransform,
} from '../history/arAlignment';
import { GhostOverlay } from './GhostOverlay';
import { OpacitySlider } from './OpacitySlider';
import { AttributionChip } from './AttributionChip';
import { ShareButton, composeArBlend } from './ShareCapture';

interface Props {
  photo: HistoricalPhoto;
  headingDeg: number;
  headingAvailable: boolean;
  confidence: 'high' | 'medium' | 'low';
  onExit: () => void;
}

const AUTO_THROTTLE_MS = 100;

/** AR Ghost view (spec §3.3) — live camera + ghosted photo + alignment + share. */
export function ARGhostView({ photo, headingDeg, headingAvailable, confidence, onExit }: Props) {
  const camera = useCamera(true);
  const cameraFailed =
    camera.status === 'denied' || camera.status === 'unavailable' || camera.status === 'error';

  // Auto-alignment is only trustworthy with a bearing + a working, confident compass.
  const autoAvailable =
    photo.compassAngle !== undefined && headingAvailable && confidence !== 'low';

  const [screenW, setScreenW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 375));
  useEffect(() => {
    const onResize = () => setScreenW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Throttled (100ms) auto horizontal offset from the smoothed heading.
  const [autoOff, setAutoOff] = useState(0);
  const lastAuto = useRef(0);
  useEffect(() => {
    if (!autoAvailable) {
      setAutoOff(0);
      return;
    }
    const now = performance.now();
    if (now - lastAuto.current < AUTO_THROTTLE_MS) return;
    lastAuto.current = now;
    setAutoOff(autoOffsetX(photo.compassAngle!, headingDeg, screenW, AR_FOV_DEG));
  }, [autoAvailable, headingDeg, screenW, photo.compassAngle]);

  // Manual transform, persisted per-photo.
  const [manual, setManual] = useState<GhostTransform | null>(() => loadTransform(photo.id));
  useEffect(() => setManual(loadTransform(photo.id)), [photo.id]);

  const [opacity, setOpacity] = useState(0.5);

  function onManualChange(t: GhostTransform) {
    setManual(t);
    saveTransform(photo.id, t);
  }
  function onReset() {
    clearTransform(photo.id);
    setManual(null);
  }

  const effective = effectiveTransform({
    auto: autoAvailable ? { compassAngle: photo.compassAngle!, headingDeg, screenWidth: screenW } : null,
    manual,
  });

  // ── Degraded: camera denied → static side-by-side (spec §3.4) ────────────────
  if (cameraFailed) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-night">
        <TopBar onExit={onExit} label="Side-by-side" />
        <div className="tm-archival relative flex-1 overflow-hidden bg-black">
          <img src={photo.imageUrl} alt={`Chicago, ${photo.era}`} className="h-full w-full object-contain" />
        </div>
        <div className="p-6 text-center">
          <p className="text-sm text-soft">
            Camera unavailable — {photo.standHint ? `face ${photo.standHint}` : 'stand where the photographer stood and compare.'}
          </p>
          <div className="mt-3 flex justify-center">
            <AttributionChip photo={photo} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-black">
      {/* Live rear camera */}
      <video
        ref={camera.videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* The ghost */}
      <GhostOverlay
        imageUrl={photo.imageUrl}
        era={photo.era}
        opacity={opacity}
        autoOffsetX={autoOff}
        manual={manual}
        onManualChange={onManualChange}
      />

      <TopBar onExit={onExit} label={photo.layer === 'recent' ? `${photo.era} · recent` : String(photo.era)} />

      {/* Guidance when auto-alignment is off */}
      {!autoAvailable && (
        <div className="pointer-events-none absolute inset-x-6 top-20 z-10 rounded-xl border border-sepia/30 bg-black/70 p-3 text-center text-xs text-sepia backdrop-blur">
          {photo.compassAngle === undefined
            ? 'No bearing for this photo — drag to align by eye.'
            : 'Compass unsteady — drag to align the ghost yourself.'}
        </div>
      )}

      {/* Reset chip (only once transformed) */}
      {isTransformed(effective) && manual && (
        <button
          onClick={onReset}
          className="absolute right-3 top-16 z-10 rounded-full border border-white/20 bg-black/55 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-soft backdrop-blur"
        >
          Reset alignment
        </button>
      )}

      {/* Attribution bottom-left */}
      <div className="absolute bottom-24 left-3 z-10">
        <AttributionChip photo={photo} />
      </div>

      {/* Opacity slider + share, bottom */}
      <div className="absolute inset-x-0 bottom-6 z-10 flex flex-col items-center gap-3 px-4">
        <OpacitySlider value={opacity} onChange={setOpacity} />
        <ShareButton
          compose={() => composeArBlend(camera.videoRef.current!, photo, effective, opacity)}
          filename={`spire-ar-${photo.era}.jpg`}
          text={`Then & now — Chicago ${photo.era}, via Spire`}
          className="pointer-events-auto rounded-full border border-sepia/50 bg-night/70 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-sepia backdrop-blur active:scale-95"
        >
          Share this blend
        </ShareButton>
      </div>
    </div>
  );
}

function TopBar({ onExit, label }: { onExit: () => void; label: string }) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3">
      <button
        onClick={onExit}
        className="pointer-events-auto rounded-full bg-black/55 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-soft backdrop-blur active:scale-95"
      >
        ← Back
      </button>
      <span className="rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold tabular-nums text-sepia backdrop-blur">
        {label}
      </span>
    </div>
  );
}
