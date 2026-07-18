import { useState } from 'react';
import type { HistoricalPhoto } from '../history/types';

/**
 * Always-visible source + license, tap to expand the full record with a link to
 * the original archival page (spec §3.2, §3.3.6). Mapillary's CC-BY-SA credit is
 * non-negotiable whenever a recent photo is visible (spec §5).
 */
export function AttributionChip({
  photo,
  className = '',
}: {
  photo: HistoricalPhoto;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const credit = photo.attribution ?? photo.source;

  return (
    <div className={`pointer-events-auto max-w-[80%] ${className}`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-left text-[10px] leading-tight text-soft/80 backdrop-blur"
      >
        <span className="truncate">
          {photo.source} · {photo.license}
        </span>
        <span className="text-steel">{expanded ? '▾' : 'ⓘ'}</span>
      </button>
      {expanded && (
        <div className="mt-1 rounded-xl border border-white/10 bg-black/80 p-3 text-[11px] leading-relaxed text-soft/90 backdrop-blur">
          {credit && (
            <p className="mb-1">
              <span className="text-steel">Credit: </span>
              {credit}
            </p>
          )}
          <p className="mb-1">
            <span className="text-steel">License: </span>
            {photo.license}
          </p>
          <a
            href={photo.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sepia underline underline-offset-2"
          >
            View original record →
          </a>
          <p className="mt-2 text-[10px] text-steel">
            Rights issue?{' '}
            <a href="mailto:takedown@spire.app" className="underline">
              takedown@spire.app
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
