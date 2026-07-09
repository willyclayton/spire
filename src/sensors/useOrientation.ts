import { useEffect, useRef, useState } from 'react';
import { circularMeanDeg, toRad, toDeg, wrap180 } from '../geo/bearing';

/**
 * Read device orientation → smoothed compass heading + pitch + a confidence signal.
 *
 * iOS reports true-north heading directly on `webkitCompassHeading`.
 * Android exposes `alpha` on `deviceorientationabsolute`; if only relative
 * orientation fires, we mark heading unavailable.
 */

type WebkitDeviceOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type PermissionResult = 'granted' | 'denied' | 'unsupported';

interface OrientationState {
  heading: number;
  pitch: number;
  confidence: 'high' | 'medium' | 'low';
  available: boolean;
  needsPermission: boolean;
}

const SMOOTHING_ALPHA = 0.15;
const CONFIDENCE_WINDOW_MS = 2000;

function anyEventHasWebkit(): boolean {
  // iOS Safari (any WebKit)
  return typeof DeviceOrientationEvent !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (DeviceOrientationEvent as any).requestPermission === 'function';
}

export async function requestOrientationPermission(): Promise<PermissionResult> {
  if (typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
  if (!anyEventHasWebkit()) return 'granted'; // Android — no gesture-gated permission
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (DeviceOrientationEvent as any).requestPermission();
    return result === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export function useOrientation(enabled: boolean): OrientationState {
  const [state, setState] = useState<OrientationState>({
    heading: 0,
    pitch: 0,
    confidence: 'medium',
    available: false,
    needsPermission: anyEventHasWebkit(),
  });

  const smoothedRef = useRef<{ x: number; y: number } | null>(null);
  const historyRef = useRef<{ heading: number; t: number }[]>([]);
  const latestRef = useRef<{ heading: number; pitch: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    function handle(ev: DeviceOrientationEvent) {
      const wev = ev as WebkitDeviceOrientationEvent;
      let rawHeading: number | undefined;

      // iOS
      if (typeof wev.webkitCompassHeading === 'number' && !Number.isNaN(wev.webkitCompassHeading)) {
        rawHeading = wev.webkitCompassHeading;
      } else if (ev.absolute && typeof ev.alpha === 'number') {
        rawHeading = (360 - ev.alpha) % 360;
      }
      const pitch = typeof ev.beta === 'number' ? ev.beta - 90 : 0;

      if (rawHeading === undefined) {
        setState((s) => (s.available ? s : { ...s, available: false }));
        return;
      }

      // Exponential moving average on the unit vector (handles the 0/360 seam).
      const r = toRad(rawHeading);
      const target = { x: Math.cos(r), y: Math.sin(r) };
      const prev = smoothedRef.current;
      const next = prev
        ? {
            x: prev.x + SMOOTHING_ALPHA * (target.x - prev.x),
            y: prev.y + SMOOTHING_ALPHA * (target.y - prev.y),
          }
        : target;
      smoothedRef.current = next;
      const smoothedHeading = (toDeg(Math.atan2(next.y, next.x)) + 360) % 360;

      const now = performance.now();
      historyRef.current.push({ heading: rawHeading, t: now });
      const cutoff = now - CONFIDENCE_WINDOW_MS;
      while (historyRef.current.length && historyRef.current[0].t < cutoff) {
        historyRef.current.shift();
      }
      // Variance via circular mean of recent readings.
      let confidence: OrientationState['confidence'] = 'high';
      if (historyRef.current.length >= 4) {
        const mean = circularMeanDeg(historyRef.current.map((h) => h.heading));
        const rms = Math.sqrt(
          historyRef.current.reduce((sum, h) => sum + wrap180(h.heading - mean) ** 2, 0) /
            historyRef.current.length,
        );
        if (rms > 15) confidence = 'low';
        else if (rms > 6) confidence = 'medium';
      }

      latestRef.current = { heading: smoothedHeading, pitch };

      setState((s) => {
        if (s.available && s.confidence === confidence) {
          // Only rerender via RAF to avoid 60 setStates/sec.
          return s;
        }
        return { ...s, available: true, confidence };
      });
    }

    async function attach() {
      // iOS gesture requirement — caller must have already requested permission from a tap.
      window.addEventListener('deviceorientationabsolute', handle as EventListener, true);
      window.addEventListener('deviceorientation', handle as EventListener, true);
    }
    attach();

    // 30Hz publish loop to avoid rerender storms from 60Hz sensor events.
    function tick() {
      const l = latestRef.current;
      if (l) {
        setState((s) => {
          if (Math.abs(wrap180(l.heading - s.heading)) < 0.25 && Math.abs(l.pitch - s.pitch) < 0.25) {
            return s;
          }
          return { ...s, heading: l.heading, pitch: l.pitch };
        });
      }
      rafRef.current = window.setTimeout(tick, 1000 / 30);
    }
    tick();

    return () => {
      window.removeEventListener('deviceorientationabsolute', handle as EventListener, true);
      window.removeEventListener('deviceorientation', handle as EventListener, true);
      if (rafRef.current !== null) clearTimeout(rafRef.current);
      smoothedRef.current = null;
      historyRef.current = [];
      latestRef.current = null;
    };
  }, [enabled]);

  return state;
}
