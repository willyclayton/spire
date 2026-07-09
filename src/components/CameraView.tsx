import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { matchBuildings, DEFAULT_FOV_DEG } from '../geo/matcher';
import { useStore } from '../store';
import { BuildingLabel } from './BuildingLabel';
import type { MatchLabel } from '../types';

interface Props {
  observer: { lat: number; lon: number };
  headingDeg: number;
  pitchDeg: number;
  headingAvailable: boolean;
  videoRef: RefObject<HTMLVideoElement>;
}

const MATCH_THROTTLE_MS = 100;

export function CameraView({ observer, headingDeg, pitchDeg, headingAvailable, videoRef }: Props) {
  const buildings = useStore((s) => s.buildings);
  const calibrationOffsetDeg = useStore((s) => s.calibrationOffsetDeg);
  const bumpCalibration = useStore((s) => s.bumpCalibration);
  const selectBuilding = useStore((s) => s.selectBuilding);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [labels, setLabels] = useState<MatchLabel[]>([]);
  const [reducedMotion] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  // Layout size observer.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Throttled match recompute.
  const lastMatchRef = useRef(0);
  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    const now = performance.now();
    if (now - lastMatchRef.current < MATCH_THROTTLE_MS) return;
    lastMatchRef.current = now;
    const next = matchBuildings({
      observer,
      headingDeg,
      pitchDeg,
      calibrationOffsetDeg,
      fovDeg: DEFAULT_FOV_DEG,
      buildings,
      viewportWidth: size.w,
      viewportHeight: size.h,
    });
    setLabels(next);
  }, [observer.lat, observer.lon, headingDeg, pitchDeg, calibrationOffsetDeg, buildings, size.w, size.h]);

  // Horizontal drag → calibration.
  const dragRef = useRef<{ x: number; offsetStart: number } | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onDown(e: PointerEvent) {
      // Ignore drags initiated on labels (they handle their own taps).
      if ((e.target as HTMLElement).closest('[data-label]')) return;
      dragRef.current = { x: e.clientX, offsetStart: useStore.getState().calibrationOffsetDeg };
      el!.setPointerCapture(e.pointerId);
    }
    function onMove(e: PointerEvent) {
      const start = dragRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dTheta = (dx / size.w) * DEFAULT_FOV_DEG;
      const desired = start.offsetStart - dTheta;
      const current = useStore.getState().calibrationOffsetDeg;
      const delta = desired - current;
      if (Math.abs(delta) > 0.05) bumpCalibration(delta);
    }
    function onUp(e: PointerEvent) {
      dragRef.current = null;
      try {
        el!.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [size.w, bumpCalibration]);

  const noMatches = labels.length === 0;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none overflow-hidden bg-black"
    >
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
        style={{ backgroundColor: '#000' }}
      />
      {/* Faint horizon line for pitch reference */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-amber/10" />
      {/* Crosshair */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="h-4 w-px bg-amber/40" />
      </div>

      {labels.map((label) => (
        <div key={label.building.id} data-label>
          <BuildingLabel
            label={label}
            onTap={(id) => selectBuilding(id)}
            reducedMotion={reducedMotion}
          />
        </div>
      ))}

      {!headingAvailable && (
        <div className="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-xl border border-amber/30 bg-black/70 p-4 text-center text-sm text-soft backdrop-blur">
          Compass unavailable — switch to Radar or try outdoors.
        </div>
      )}

      {headingAvailable && noMatches && (
        <NoMatchesHint />
      )}
    </div>
  );
}

function NoMatchesHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShow(true), 3000);
    return () => clearTimeout(id);
  }, []);
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-x-6 bottom-24 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-center text-xs text-steel backdrop-blur">
      No notable buildings this way — try turning toward downtown.
    </div>
  );
}
