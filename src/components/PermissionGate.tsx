import { useState } from 'react';
import { requestOrientationPermission } from '../sensors/useOrientation';

type Step = 'location' | 'motion' | 'camera';

interface Props {
  onComplete: (cameraOptIn: boolean) => void;
}

function StepCard({
  step,
  total,
  title,
  body,
  button,
  onClick,
  secondaryLabel,
  onSecondary,
  error,
  denied,
}: {
  step: number;
  total: number;
  title: string;
  body: string;
  button: string;
  onClick: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  error?: string;
  denied?: boolean;
}) {
  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <div className="mb-1 text-xs uppercase tracking-widest text-steel">
        Step {step} of {total}
      </div>
      <h2 className="mb-3 font-display text-2xl text-soft">{title}</h2>
      <p className="mb-6 text-sm leading-relaxed text-steel">{body}</p>
      {denied ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          Access was denied. Enable it in your browser settings and reload — or continue without it.
        </div>
      ) : (
        <button
          onClick={onClick}
          className="w-full rounded-full bg-amber py-3 font-semibold text-night transition active:scale-[0.98]"
        >
          {button}
        </button>
      )}
      {secondaryLabel && onSecondary && (
        <button
          onClick={onSecondary}
          className="mt-3 w-full rounded-full border border-white/10 py-3 text-sm text-steel transition active:scale-[0.98]"
        >
          {secondaryLabel}
        </button>
      )}
      {error && !denied && <p className="mt-3 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function PermissionGate({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('location');
  const [locDenied, setLocDenied] = useState(false);
  const [motionDenied, setMotionDenied] = useState(false);

  function askLocation() {
    if (!('geolocation' in navigator)) {
      setLocDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => setStep('motion'),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setLocDenied(true);
        else setStep('motion');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function askMotion() {
    const result = await requestOrientationPermission();
    if (result === 'granted' || result === 'unsupported') {
      setStep('camera');
      return;
    }
    setMotionDenied(true);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-night px-6">
      <h1 className="mb-1 font-display text-4xl text-amber">Spire</h1>
      <p className="mb-8 text-sm uppercase tracking-widest text-steel">Chicago skyline identifier</p>
      {step === 'location' && (
        <StepCard
          step={1}
          total={3}
          title="Where are you standing?"
          body="Your location lets Spire figure out which buildings you're looking at. We don't store or send it anywhere. Not needed to browse the Time Machine map."
          button="Share location"
          onClick={askLocation}
          denied={locDenied}
          secondaryLabel="Skip for now"
          onSecondary={() => setStep('motion')}
        />
      )}
      {step === 'motion' && (
        <StepCard
          step={2}
          total={3}
          title="Which way are you facing?"
          body="Your phone's compass tells Spire where to place labels on the skyline."
          button="Enable compass"
          onClick={askMotion}
          denied={motionDenied}
          secondaryLabel="Skip for now"
          onSecondary={() => setStep('camera')}
        />
      )}
      {step === 'camera' && (
        <StepCard
          step={3}
          total={3}
          title="See the buildings live?"
          body="Camera-on gives you the classic point-and-identify view. Prefer not to? Skip and Spire drops to a stylized skyline radar."
          button="Enable camera"
          onClick={() => onComplete(true)}
          secondaryLabel="Skip — use radar view"
          onSecondary={() => onComplete(false)}
        />
      )}

      {/* Always-available escape — get straight into the app to explore. */}
      <button
        onClick={() => onComplete(false)}
        className="mt-8 text-sm text-steel underline underline-offset-4 transition active:scale-95"
      >
        Just exploring? Enter without setup →
      </button>
    </div>
  );
}
