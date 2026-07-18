import type { AppMode } from '../store';

/**
 * Home screen after onboarding — pick an experience:
 *  - Building Gazer: the live point-and-identify skyline app.
 *  - Time Machine: the historical photo map + then/now.
 */
export function HomeMenu({ onSelect }: { onSelect: (m: AppMode) => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-night px-6 text-soft">
      <header className="mb-10 text-center">
        <h1 className="font-display text-5xl text-amber">Spire</h1>
        <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">Chicago</p>
      </header>

      <div className="flex w-full max-w-md flex-col gap-4">
        <ModeCard
          onClick={() => onSelect('gazer')}
          accent="amber"
          icon={<SkylineIcon />}
          title="Building Gazer"
          subtitle="Point your phone at the skyline to identify buildings, live."
        />
        <ModeCard
          onClick={() => onSelect('timeMachine')}
          accent="sepia"
          icon={<ClockIcon />}
          title="Time Machine"
          subtitle="A map of historical Chicago photos — then & now, with on-site AR."
        />
      </div>

      <p className="mt-10 max-w-md text-center text-[11px] leading-relaxed text-steel/70">
        You can switch anytime from the menu button in either mode.
      </p>
    </div>
  );
}

function ModeCard({
  onClick,
  accent,
  icon,
  title,
  subtitle,
}: {
  onClick: () => void;
  accent: 'amber' | 'sepia';
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  const ring = accent === 'amber' ? 'border-amber/40 text-amber' : 'border-sepia/40 text-sepia';
  const glow =
    accent === 'amber'
      ? 'hover:border-amber/70 hover:shadow-[0_0_24px_-6px_rgba(245,166,35,0.5)]'
      : 'hover:border-sepia/70 hover:shadow-[0_0_24px_-6px_rgba(201,162,39,0.5)]';
  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-4 rounded-2xl border ${ring} bg-white/[0.03] p-5 text-left transition-all active:scale-[0.98] ${glow}`}
    >
      <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border ${ring} bg-black/20`}>
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="font-display text-xl text-soft">{title}</h2>
        <p className="mt-0.5 text-sm leading-snug text-steel">{subtitle}</p>
      </div>
      <span className={`ml-auto shrink-0 text-2xl ${accent === 'amber' ? 'text-amber' : 'text-sepia'}`}>›</span>
    </button>
  );
}

function SkylineIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M3 21h18" strokeLinecap="round" />
      <path d="M5 21V11l3-2v12M11 21V6l3 2v13M17 21V12l2-1v10" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
