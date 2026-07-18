/**
 * Then/Now segmented control (spec §3.2). Shown only when a recent-layer photo
 * exists at the pin; swaps between the historical photo and recent street view,
 * delivering time travel without being on-site.
 */
export function ThenNowToggle({
  mode,
  onChange,
}: {
  mode: 'then' | 'now';
  onChange: (m: 'then' | 'now') => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-white/10 bg-black/40 p-0.5 text-xs">
      {(['then', 'now'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          aria-pressed={mode === m}
          className={`rounded-full px-4 py-1 font-semibold uppercase tracking-wider transition-colors ${
            mode === m ? 'bg-sepia text-night' : 'text-steel'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
