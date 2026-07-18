import { useRef } from 'react';
import { freezeAuto, type GhostTransform } from '../history/arAlignment';

/**
 * The ghost: the historical photo in a CSS-transformed container over the live
 * camera (spec §3.3.2, §3.3.5). One-finger drag pans, two-finger pinch scales,
 * two-finger twist rotates. The FIRST manual touch freezes the auto-offset — the
 * user's alignment wins from then on. Gesture math lives here; the parent owns the
 * manual transform + persistence.
 */
interface Props {
  imageUrl: string;
  era: number;
  opacity: number;
  /** Live auto horizontal offset from heading (used until frozen). */
  autoOffsetX: number;
  /** Non-null once the user has taken control. */
  manual: GhostTransform | null;
  onManualChange: (t: GhostTransform) => void;
}

interface Ptr {
  x: number;
  y: number;
}

export function GhostOverlay({ imageUrl, era, opacity, autoOffsetX, manual, onManualChange }: Props) {
  const pointers = useRef<Map<number, Ptr>>(new Map());
  // Transform + gesture geometry captured at gesture start.
  const start = useRef<{
    transform: GhostTransform;
    centroid: Ptr;
    dist: number;
    angle: number;
  } | null>(null);

  const effective: GhostTransform = manual ?? {
    offsetX: autoOffsetX,
    offsetY: 0,
    scale: 1,
    rotationDeg: 0,
  };

  function centroidOf(pts: Ptr[]): Ptr {
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  }

  function beginGesture() {
    const pts = [...pointers.current.values()];
    const centroid = centroidOf(pts);
    let dist = 0;
    let angle = 0;
    if (pts.length >= 2) {
      const [a, b] = pts;
      dist = Math.hypot(b.x - a.x, b.y - a.y);
      angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    }
    // Freeze auto-offset into a manual transform on the very first touch.
    const base = manual ?? freezeAuto(autoOffsetX);
    start.current = { transform: base, centroid, dist, angle };
    if (!manual) onManualChange(base);
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginGesture(); // re-baseline whenever the pointer count changes
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = start.current;
    if (!s) return;
    const pts = [...pointers.current.values()];
    const centroid = centroidOf(pts);

    let next: GhostTransform = {
      ...s.transform,
      offsetX: s.transform.offsetX + (centroid.x - s.centroid.x),
      offsetY: s.transform.offsetY + (centroid.y - s.centroid.y),
    };

    if (pts.length >= 2 && s.dist > 0) {
      const [a, b] = pts;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      next.scale = clamp(s.transform.scale * (dist / s.dist), 0.3, 4);
      next.rotationDeg = s.transform.rotationDeg + (angle - s.angle);
    }
    onManualChange(next);
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) beginGesture();
    else start.current = null;
  }

  return (
    <div
      className="absolute inset-0 touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <img
        key={imageUrl}
        src={imageUrl}
        alt={`Chicago, ${era}`}
        draggable={false}
        className="tm-archival tm-ghost-in absolute left-1/2 top-1/2 max-w-none select-none"
        style={{
          width: '100vw',
          opacity,
          transform: `translate(-50%, -50%) translate(${effective.offsetX}px, ${effective.offsetY}px) rotate(${effective.rotationDeg}deg) scale(${effective.scale})`,
          willChange: 'transform, opacity',
        }}
      />
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
