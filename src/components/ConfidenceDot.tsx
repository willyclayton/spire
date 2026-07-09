interface Props {
  confidence: 'high' | 'medium' | 'low';
  available: boolean;
  onClick?: () => void;
}

const COLOR: Record<Props['confidence'], string> = {
  high: 'bg-emerald-400',
  medium: 'bg-amber',
  low: 'bg-danger',
};

const LABEL: Record<Props['confidence'], string> = {
  high: 'Compass steady',
  medium: 'Compass drifting',
  low: 'Compass noisy',
};

export function ConfidenceDot({ confidence, available, onClick }: Props) {
  const color = available ? COLOR[confidence] : 'bg-steel/60';
  const label = available ? LABEL[confidence] : 'No compass';
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-xs text-soft backdrop-blur transition active:scale-95"
      aria-label={label}
    >
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="tracking-wide">{label}</span>
    </button>
  );
}
