import { useEffect, useRef, useState } from 'react';

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'streaming'
  | 'denied'
  | 'unavailable'
  | 'error';

interface CameraState {
  status: CameraStatus;
  errorMessage?: string;
  videoRef: React.RefObject<HTMLVideoElement>;
}

/**
 * Request the rear camera and pipe it into a <video> element.
 * Stops the stream on unmount or when `enabled` flips to false, and pauses
 * when the tab is hidden (battery). Denial is surfaced but not thrown —
 * callers should fall back to RadarView.
 */
export function useCamera(enabled: boolean): CameraState {
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      return;
    }

    let cancelled = false;
    setStatus('requesting');

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const el = videoRef.current;
        if (el) {
          el.srcObject = stream;
          el.setAttribute('playsinline', 'true');
          el.muted = true;
          try {
            await el.play();
          } catch {
            // iOS may need a user gesture — the caller's flow already gates on one.
          }
        }
        setStatus('streaming');
      } catch (err) {
        const e = err as DOMException;
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
          setStatus('denied');
        } else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
          setStatus('unavailable');
        } else {
          setStatus('error');
        }
        setErrorMessage(e.message);
      }
    })();

    function onVisibility() {
      const stream = streamRef.current;
      if (!stream) return;
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      track.enabled = document.visibilityState === 'visible';
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [enabled]);

  return { status, errorMessage, videoRef };
}
