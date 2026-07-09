import { useEffect, useMemo, useRef, useState } from 'react';
import type { Building } from '../types';
import { distanceM, initialBearingDeg, wrap180 } from '../geo/bearing';
import { useStore } from '../store';
import { NEAR_LIMIT_M, FAR_LIMIT_M } from '../geo/matcher';

interface Props {
  observer: { lat: number; lon: number };
  headingDeg: number;
  confidence: 'high' | 'medium' | 'low';
  headingAvailable: boolean;
}

interface RadarBuilding {
  building: Building;
  bearing: number;
  distanceM: number;
  screenHeight: number;
}

const FIELD_DEG = 140; // width of the visible ribbon centered on current heading
const BAND_HEIGHT_FRACTION = 0.55; // ribbon occupies this fraction of screen

export function RadarView({ observer, headingDeg, confidence, headingAvailable }: Props) {
  const buildings = useStore((s) => s.buildings);
  const calibrationOffsetDeg = useStore((s) => s.calibrationOffsetDeg);
  const bumpCalibration = useStore((s) => s.bumpCalibration);
  const resetCalibration = useStore((s) => s.resetCalibration);
  const selectBuilding = useStore((s) => s.selectBuilding);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragStartRef = useRef<{ x: number; offsetStart: number; targetTouches?: number } | null>(null);
  const [pointerX, setPointerX] = useState<number | null>(null);
  const [dims, setDims] = useState({ w: 0, h: 0, dpr: 1 });

  // Precompute per-building bearing + distance.
  const enriched = useMemo<RadarBuilding[]>(() => {
    return buildings
      .map((b) => {
        const d = distanceM(observer, { lat: b.lat, lon: b.lon });
        if (d < NEAR_LIMIT_M || d > FAR_LIMIT_M) return null;
        const bearing = initialBearingDeg(observer, { lat: b.lat, lon: b.lon });
        return {
          building: b,
          bearing,
          distanceM: d,
          // Height on the ribbon = f(prominence, height, distance).
          screenHeight: 0,
        } as RadarBuilding;
      })
      .filter((x): x is RadarBuilding => x !== null);
  }, [buildings, observer.lat, observer.lon]);

  // Handle canvas sizing.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    function resize() {
      if (!el) return;
      const parent = el.parentElement!;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      setDims({ w, h, dpr });
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Draw loop.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || dims.w === 0) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const { w, h, dpr } = dims;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Background gradient (dusk sky).
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0B1424');
    grad.addColorStop(0.55, '#141B2D');
    grad.addColorStop(1, '#1F2A44');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Horizon line.
    const horizonY = h * (1 - BAND_HEIGHT_FRACTION * 0.35);
    ctx.strokeStyle = 'rgba(245, 166, 35, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(w, horizonY);
    ctx.stroke();

    // Effective heading includes calibration offset.
    const effectiveHeading = (headingDeg + calibrationOffsetDeg + 360) % 360;

    // Compass ticks at 15° intervals within the field.
    ctx.fillStyle = 'rgba(138, 147, 166, 0.9)';
    ctx.font = "500 11px 'Space Grotesk', system-ui, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = -Math.round(FIELD_DEG / 2); t <= Math.round(FIELD_DEG / 2); t += 15) {
      const bearing = (effectiveHeading + t + 360) % 360;
      const x = w / 2 + (t / FIELD_DEG) * w;
      const isCardinal = Math.abs(((bearing + 22.5) % 90) - 22.5) < 2;
      ctx.fillStyle = isCardinal ? '#F5A623' : 'rgba(138,147,166,0.6)';
      ctx.fillRect(x - 0.5, horizonY, 1, isCardinal ? 10 : 5);
      const dirLabel = cardinalLabel(bearing);
      if (dirLabel) {
        ctx.fillText(dirLabel, x, horizonY + 12);
      } else if (t % 30 === 0) {
        ctx.fillText(`${Math.round(bearing)}°`, x, horizonY + 12);
      }
    }

    // Building silhouettes.
    const inField = enriched
      .map((r) => {
        const delta = wrap180(r.bearing - effectiveHeading);
        return { r, delta };
      })
      .filter(({ delta }) => Math.abs(delta) <= FIELD_DEG / 2)
      // Draw far → near so nearer ones can cover farther silhouettes.
      .sort((a, b) => b.r.distanceM - a.r.distanceM);

    for (const { r, delta } of inField) {
      const x = w / 2 + (delta / FIELD_DEG) * w;
      // Distance scaling: closer/taller buildings loom larger.
      const distKm = r.distanceM / 1000;
      const relHeight = r.building.heightM / (distKm * 22 + 8);
      const silhouetteH = Math.min(horizonY * 0.88, relHeight);
      const widthPx = Math.max(6, Math.min(48, 24 / (distKm * 0.4 + 0.5)));

      // Silhouette body.
      const alpha = Math.max(0.35, 1 - distKm / 8);
      ctx.fillStyle = `rgba(20, 27, 45, ${alpha})`;
      ctx.strokeStyle = `rgba(245, 166, 35, ${Math.min(0.55, alpha * 0.7)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const left = x - widthPx / 2;
      const right = x + widthPx / 2;
      const top = horizonY - silhouetteH;
      ctx.moveTo(left, horizonY);
      ctx.lineTo(left, top + widthPx * 0.15);
      ctx.lineTo(x, top);
      ctx.lineTo(right, top + widthPx * 0.15);
      ctx.lineTo(right, horizonY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // "Lit window" flecks for prominent buildings.
      if (r.building.prominence >= 6) {
        ctx.fillStyle = `rgba(245, 166, 35, ${0.35 * alpha})`;
        const rows = Math.floor(silhouetteH / 6);
        for (let i = 1; i < rows; i++) {
          const wy = horizonY - i * 6;
          const wx1 = left + widthPx * 0.3;
          const wx2 = right - widthPx * 0.3;
          if ((i * (Math.floor(x) + 1)) % 3 === 0) ctx.fillRect(wx1, wy, 1.5, 2);
          if ((i * (Math.floor(x) + 1)) % 4 === 0) ctx.fillRect(wx2, wy, 1.5, 2);
        }
      }
    }

    // Label the top 3 prominent-in-field with names, above the horizon.
    const labeled = [...inField]
      .sort((a, b) => b.r.building.prominence - a.r.building.prominence || Math.abs(a.delta) - Math.abs(b.delta))
      .slice(0, 3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const { r, delta } of labeled) {
      const x = w / 2 + (delta / FIELD_DEG) * w;
      const distKm = r.distanceM / 1000;
      const relHeight = r.building.heightM / (distKm * 22 + 8);
      const silhouetteH = Math.min(horizonY * 0.88, relHeight);
      const y = horizonY - silhouetteH - 8;
      ctx.font = "600 12px 'Space Grotesk', system-ui, sans-serif";
      const name = r.building.name;
      const nameWidth = ctx.measureText(name).width;
      // Leader line from label to silhouette top.
      ctx.strokeStyle = 'rgba(245, 166, 35, 0.5)';
      ctx.beginPath();
      ctx.moveTo(x, y + 4);
      ctx.lineTo(x, y - 10);
      ctx.stroke();
      // Nameplate background.
      ctx.fillStyle = 'rgba(11, 20, 36, 0.85)';
      ctx.strokeStyle = 'rgba(245, 166, 35, 0.6)';
      ctx.beginPath();
      const padX = 8;
      const bgW = nameWidth + padX * 2;
      const bgH = 22;
      const bgX = x - bgW / 2;
      const bgY = y - 10 - bgH;
      ctx.rect(bgX, bgY, bgW, bgH);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#F5A623';
      ctx.fillText(name, x, bgY + bgH - 5);
    }

    // Center crosshair — where the phone is pointed.
    ctx.strokeStyle = 'rgba(245, 166, 35, 0.5)';
    ctx.beginPath();
    ctx.moveTo(w / 2, horizonY - 14);
    ctx.lineTo(w / 2, horizonY + 14);
    ctx.stroke();

    // Available? Overlay.
    if (!headingAvailable) {
      ctx.fillStyle = 'rgba(11, 20, 36, 0.7)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#F4F6FB';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = "600 15px 'Space Grotesk', system-ui, sans-serif";
      ctx.fillText('Compass unavailable — drag horizontally to look around', w / 2, h / 2);
    }
  }, [
    dims,
    enriched,
    headingDeg,
    calibrationOffsetDeg,
    headingAvailable,
    confidence,
  ]);

  // Drag: horizontal on the ribbon adjusts calibration offset.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    function onPointerDown(e: PointerEvent) {
      dragStartRef.current = {
        x: e.clientX,
        offsetStart: useStore.getState().calibrationOffsetDeg,
      };
      el!.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      setPointerX(e.clientX);
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      // 1 screen width = FIELD_DEG.
      const dTheta = (dx / dims.w) * FIELD_DEG;
      const desired = start.offsetStart - dTheta;
      const current = useStore.getState().calibrationOffsetDeg;
      const delta = desired - current;
      if (Math.abs(delta) > 0.05) bumpCalibration(delta);
    }
    function onPointerUp(e: PointerEvent) {
      dragStartRef.current = null;
      try {
        el!.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    function onTap(e: MouseEvent) {
      // If not a drag (dragStart cleared but tiny movement), select nearest labeled building.
      const rect = el!.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const effectiveHeading =
        (headingDeg + useStore.getState().calibrationOffsetDeg + 360) % 360;
      const tapDelta = ((localX - dims.w / 2) / dims.w) * FIELD_DEG;
      const tapBearing = (effectiveHeading + tapDelta + 360) % 360;
      // Nearest by angular delta among labelable buildings.
      let best: RadarBuilding | null = null;
      let bestScore = Infinity;
      for (const r of enriched) {
        const bd = Math.abs(wrap180(r.bearing - tapBearing));
        if (bd > 8) continue;
        // Angular delta weighted by prominence.
        const score = bd - r.building.prominence * 0.3;
        if (score < bestScore) {
          bestScore = score;
          best = r;
        }
      }
      if (best) selectBuilding(best.building.id);
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('click', onTap);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('click', onTap);
    };
  }, [dims, bumpCalibration, headingDeg, enriched, selectBuilding]);

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full touch-none" />
      {calibrationOffsetDeg !== 0 && (
        <button
          onClick={resetCalibration}
          className="absolute right-4 top-16 rounded-full bg-black/50 px-3 py-1 text-xs text-soft backdrop-blur"
        >
          Reset calibration ({calibrationOffsetDeg > 0 ? '+' : ''}
          {Math.round(calibrationOffsetDeg)}°)
        </button>
      )}
      <PointerHint visible={pointerX === null} />
    </div>
  );
}

function PointerHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-steel backdrop-blur">
      Drag to align if labels look off
    </div>
  );
}

function cardinalLabel(bearing: number): string | null {
  const cardinals: [number, string][] = [
    [0, 'N'],
    [45, 'NE'],
    [90, 'E'],
    [135, 'SE'],
    [180, 'S'],
    [225, 'SW'],
    [270, 'W'],
    [315, 'NW'],
  ];
  for (const [deg, label] of cardinals) {
    if (Math.abs(wrap180(bearing - deg)) < 2) return label;
  }
  return null;
}
