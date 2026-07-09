import { useEffect, useState } from 'react';

const KEY = 'spire.seenCalibrationHint';

export function CalibrationHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem(KEY) === '1') return;
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // ignore
    }
  }

  if (!visible) return null;
  return (
    <button
      onClick={dismiss}
      className="pointer-events-auto absolute inset-x-8 bottom-24 z-20 rounded-xl border border-amber/50 bg-night/90 p-4 text-left shadow-lg backdrop-blur"
    >
      <div className="mb-1 text-xs uppercase tracking-widest text-amber">Tip</div>
      <div className="text-sm leading-snug text-soft">
        Labels not lined up? Drag horizontally on the screen to nudge them into place.
      </div>
      <div className="mt-2 text-[11px] uppercase tracking-wide text-steel">Tap to dismiss</div>
    </button>
  );
}
