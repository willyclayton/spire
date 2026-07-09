import type { MatchLabel } from '../types';

interface Props {
  label: MatchLabel;
  onTap: (id: string) => void;
  reducedMotion: boolean;
}

/**
 * Brass-plate style building nameplate + leader line to anchor point.
 * Positioned absolutely by matcher-provided x, y (already in viewport pixels).
 * The label sits ABOVE its anchor; the leader drops down to (x, y).
 */
export function BuildingLabel({ label, onTap, reducedMotion }: Props) {
  const { building, x, y, distanceM } = label;
  const leaderLength = 42;
  const plateY = y - leaderLength;

  return (
    <button
      onClick={() => onTap(building.id)}
      className="pointer-events-auto absolute z-10 flex select-none flex-col items-center"
      style={{
        left: 0,
        top: 0,
        transform: `translate(${x}px, ${plateY}px) translate(-50%, -100%)`,
        animation: reducedMotion ? undefined : 'spire-label-in 150ms ease-out',
        willChange: 'transform, opacity',
      }}
    >
      <div
        className="rounded-md border border-amber/70 bg-night/90 px-3 py-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.5)] backdrop-blur"
        style={{
          background: 'linear-gradient(180deg, rgba(20,27,45,0.92) 0%, rgba(11,20,36,0.92) 100%)',
        }}
      >
        <div className="font-display text-xs font-semibold leading-tight tracking-wide text-amber">
          {building.name}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-steel">
          <span>{Math.round(building.heightM)}m</span>
          <span className="text-amber/40">·</span>
          <span>{formatDistance(distanceM)}</span>
        </div>
      </div>
      {/* Anchor point + leader line */}
      <svg
        width="1"
        height={leaderLength}
        className="overflow-visible"
        style={{ marginTop: -1 }}
        aria-hidden
      >
        <line
          x1="0.5"
          y1="0"
          x2="0.5"
          y2={leaderLength - 4}
          stroke="rgba(245, 166, 35, 0.75)"
          strokeWidth="1"
        />
        <circle cx="0.5" cy={leaderLength - 2} r="2.5" fill="#F5A623" />
      </svg>
    </button>
  );
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
