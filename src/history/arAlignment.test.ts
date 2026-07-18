import { describe, it, expect, beforeEach } from 'vitest';
import {
  AR_FOV_DEG,
  autoOffsetX,
  autoTransform,
  effectiveTransform,
  freezeAuto,
  isTransformed,
  loadTransform,
  saveTransform,
  clearTransform,
  IDENTITY_TRANSFORM,
  type GhostTransform,
} from './arAlignment';

const W = 360; // screen width

describe('autoOffsetX — offset formula', () => {
  it('is zero when the camera faces the photo bearing exactly', () => {
    expect(autoOffsetX(90, 90, W)).toBe(0);
  });

  it('places the ghost to the right when its bearing is clockwise of heading', () => {
    // Subject 30° to the right, FOV 60° → half the FOV → +W/2.
    expect(autoOffsetX(120, 90, W)).toBeCloseTo(W / 2, 5);
  });

  it('places the ghost to the left when its bearing is counter-clockwise', () => {
    expect(autoOffsetX(60, 90, W)).toBeCloseTo(-W / 2, 5);
  });

  it('scales linearly with the delta over the FOV', () => {
    // 15° delta of a 60° FOV → quarter width.
    expect(autoOffsetX(105, 90, W)).toBeCloseTo(W / 4, 5);
  });

  it('honors a custom FOV', () => {
    // 30° delta over a 120° FOV → quarter width.
    expect(autoOffsetX(120, 90, W, 120)).toBeCloseTo(W / 4, 5);
  });

  it('uses AR_FOV_DEG = 60 by default', () => {
    expect(AR_FOV_DEG).toBe(60);
    expect(autoOffsetX(120, 90, W)).toBeCloseTo(autoOffsetX(120, 90, W, 60), 10);
  });
});

describe('autoOffsetX — 359°→0° bearing wrap', () => {
  it('treats 359° subject / 1° heading as a small negative offset, not a full swing', () => {
    // Delta is -2°, not +358°. Over 60° FOV → -2/60 * W.
    const off = autoOffsetX(359, 1, W);
    expect(off).toBeCloseTo((-2 / 60) * W, 5);
    expect(Math.abs(off)).toBeLessThan(W / 10);
  });

  it('treats 1° subject / 359° heading as a small positive offset', () => {
    const off = autoOffsetX(1, 359, W);
    expect(off).toBeCloseTo((2 / 60) * W, 5);
  });

  it('is continuous across the seam', () => {
    const justBelow = autoOffsetX(0.5, 0, W);
    const justAbove = autoOffsetX(359.5, 0, W); // = -0.5° delta
    expect(justBelow).toBeCloseTo(-justAbove, 5);
  });
});

describe('effectiveTransform — auto vs manual', () => {
  it('returns auto offset when no manual override exists', () => {
    const t = effectiveTransform({
      auto: { compassAngle: 120, headingDeg: 90, screenWidth: W },
      manual: null,
    });
    expect(t.offsetX).toBeCloseTo(W / 2, 5);
    expect(t).toEqual(autoTransform(120, 90, W));
  });

  it('returns identity when neither auto nor manual is available (no compass)', () => {
    expect(effectiveTransform({ auto: null, manual: null })).toEqual(IDENTITY_TRANSFORM);
  });

  it('manual override fully replaces auto-tracking', () => {
    const manual: GhostTransform = { offsetX: 12, offsetY: -4, scale: 1.3, rotationDeg: 5 };
    const t = effectiveTransform({
      auto: { compassAngle: 200, headingDeg: 10, screenWidth: W },
      manual,
    });
    expect(t).toBe(manual);
  });
});

describe('freeze on first manual touch', () => {
  it('seeds the manual transform with the current auto-offset so the ghost does not jump', () => {
    const auto = { compassAngle: 105, headingDeg: 90, screenWidth: W };
    const currentAuto = autoOffsetX(auto.compassAngle, auto.headingDeg, auto.screenWidth);
    const frozen = freezeAuto(currentAuto);

    // At the instant of freeze the effective transform is unchanged...
    const before = effectiveTransform({ auto, manual: null }).offsetX;
    const after = effectiveTransform({ auto, manual: frozen }).offsetX;
    expect(after).toBeCloseTo(before, 5);

    // ...and thereafter heading changes no longer move the ghost.
    const movedHeading = { ...auto, headingDeg: 30 };
    expect(effectiveTransform({ auto: movedHeading, manual: frozen }).offsetX).toBe(frozen.offsetX);
  });
});

describe('isTransformed — gates the reset chip', () => {
  it('is false for identity / null', () => {
    expect(isTransformed(IDENTITY_TRANSFORM)).toBe(false);
    expect(isTransformed(null)).toBe(false);
  });
  it('is true once panned, scaled, or rotated', () => {
    expect(isTransformed({ ...IDENTITY_TRANSFORM, offsetX: 3 })).toBe(true);
    expect(isTransformed({ ...IDENTITY_TRANSFORM, scale: 1.2 })).toBe(true);
    expect(isTransformed({ ...IDENTITY_TRANSFORM, rotationDeg: 2 })).toBe(true);
  });
});

describe('per-photo persistence + reset', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a transform keyed by photo id', () => {
    const t: GhostTransform = { offsetX: 20, offsetY: 5, scale: 1.1, rotationDeg: -3 };
    saveTransform('photo-a', t);
    expect(loadTransform('photo-a')).toEqual(t);
    expect(loadTransform('photo-b')).toBeNull(); // isolated per id
  });

  it('reset clears the manual transform so alignment falls back to auto', () => {
    saveTransform('photo-a', { offsetX: 20, offsetY: 5, scale: 1.1, rotationDeg: -3 });
    clearTransform('photo-a');
    expect(loadTransform('photo-a')).toBeNull();

    // With the manual override gone, effective alignment is auto again.
    const manual = loadTransform('photo-a');
    const t = effectiveTransform({
      auto: { compassAngle: 120, headingDeg: 90, screenWidth: W },
      manual,
    });
    expect(t.offsetX).toBeCloseTo(W / 2, 5);
  });

  it('ignores corrupt localStorage entries', () => {
    localStorage.setItem('spire.ar.transform.bad', '{not json');
    expect(loadTransform('bad')).toBeNull();
  });
});
