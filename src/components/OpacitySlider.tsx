import { useRef } from 'react';

/**
 * Ghost opacity slider (spec §3.3.3) — bottom of screen, default 50%, with a
 * snap-feel at 0 and 100 (values near the ends stick, so you can bottom/top out
 * the ghost without pixel-perfect aim).
 */
const SNAP_ZONE = 0.05;

export function OpacitySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const lastRef = useRef(value);

  function handle(v: number) {
    let next = v;
    if (next < SNAP_ZONE) next = 0;
    else if (next > 1 - SNAP_ZONE) next = 1;
    // Light haptic-ish feedback on hitting a snap end (best-effort).
    if ((next === 0 || next === 1) && lastRef.current !== next) {
      navigator.vibrate?.(8);
    }
    lastRef.current = next;
    onChange(next);
  }

  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-black/55 px-4 py-2.5 backdrop-blur">
      <span className="text-[10px] uppercase tracking-wider text-steel">Then</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => handle(Number(e.target.value))}
        aria-label="Ghost opacity"
        className="tm-slider h-1 w-44"
      />
      <span className="w-9 text-right text-[11px] tabular-nums text-sepia">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}
