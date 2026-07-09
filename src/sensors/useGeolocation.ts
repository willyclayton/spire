import { useEffect, useState } from 'react';
import type { GeoPosition } from '../types';

type GeoStatus = 'idle' | 'requesting' | 'watching' | 'denied' | 'unavailable' | 'timeout';

interface GeoState {
  position: GeoPosition | null;
  status: GeoStatus;
  errorMessage?: string;
}

const TIMEOUT_MS = 15000;

export function useGeolocation(enabled: boolean): GeoState {
  const [state, setState] = useState<GeoState>({ position: null, status: 'idle' });

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setState({ position: null, status: 'unavailable' });
      return;
    }
    setState((s) => ({ ...s, status: 'requesting' }));

    let firstFix = false;
    const timeoutId = window.setTimeout(() => {
      if (!firstFix) setState((s) => ({ ...s, status: 'timeout' }));
    }, TIMEOUT_MS);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        firstFix = true;
        setState({
          position: {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracyM: pos.coords.accuracy,
          },
          status: 'watching',
        });
      },
      (err) => {
        firstFix = true;
        const status: GeoStatus = err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable';
        setState({ position: null, status, errorMessage: err.message });
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );

    return () => {
      window.clearTimeout(timeoutId);
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled]);

  return state;
}
