import { describe, it, expect } from 'vitest';
import {
  eraInRange,
  filterPinsByEra,
  arButtonEligible,
  groupPhotosWithin,
  AR_DISTANCE_M,
  AR_DISTANCE_LOOSE_M,
} from './pinStore';
import type { HistoricalPhoto, Pin } from './types';

function pin(partial: Partial<Pin> & { eras: number[] }): Pin {
  return {
    id: 'p',
    lat: 41.88,
    lon: -87.62,
    photoIds: [],
    hasDeep: true,
    featured: false,
    ...partial,
  };
}

function photo(partial: Partial<HistoricalPhoto> & { id: string; lat: number; lon: number }): HistoricalPhoto {
  return {
    layer: 'deep',
    era: 1900,
    imageUrl: 'x.jpg',
    width: 100,
    height: 100,
    source: 'Wikimedia Commons',
    license: 'Public Domain',
    sourceUrl: 'https://example.org',
    ...partial,
  };
}

describe('era filtering', () => {
  it('matches when any era falls in range', () => {
    expect(eraInRange(pin({ eras: [1905, 1978] }), 1970, 1980)).toBe(true);
    expect(eraInRange(pin({ eras: [1905, 1978] }), 1910, 1920)).toBe(false);
  });

  it('includes boundary years', () => {
    expect(eraInRange(pin({ eras: [1950] }), 1950, 1960)).toBe(true);
    expect(eraInRange(pin({ eras: [1960] }), 1950, 1960)).toBe(true);
  });

  it('filterPinsByEra keeps only pins overlapping the range', () => {
    const pins = [
      pin({ id: 'a', eras: [1900] }),
      pin({ id: 'b', eras: [1965, 2018] }),
      pin({ id: 'c', eras: [1930] }),
    ];
    const out = filterPinsByEra(pins, 1960, 2020).map((p) => p.id);
    expect(out).toEqual(['b']);
  });

  it('a full-width range returns every pin unchanged', () => {
    const pins = [pin({ id: 'a', eras: [1900] }), pin({ id: 'b', eras: [2020] })];
    expect(filterPinsByEra(pins, 1890, new Date().getFullYear())).toHaveLength(2);
  });
});

describe('AR-button eligibility', () => {
  const withAngle = photo({ id: 'x', lat: 41.88, lon: -87.62, compassAngle: 270 });
  const noAngle = photo({ id: 'y', lat: 41.88, lon: -87.62 });

  it('requires a compassAngle on the photo', () => {
    expect(arButtonEligible({ photo: noAngle, distanceM: 10, gpsAccuracyM: 10 })).toBe(false);
    expect(arButtonEligible({ photo: withAngle, distanceM: 10, gpsAccuracyM: 10 })).toBe(true);
  });

  it('gates on the 75m radius with a good GPS fix', () => {
    expect(arButtonEligible({ photo: withAngle, distanceM: AR_DISTANCE_M - 1, gpsAccuracyM: 10 })).toBe(true);
    expect(arButtonEligible({ photo: withAngle, distanceM: AR_DISTANCE_M + 1, gpsAccuracyM: 10 })).toBe(false);
  });

  it('loosens to 150m when GPS accuracy is worse than 40m', () => {
    expect(arButtonEligible({ photo: withAngle, distanceM: 120, gpsAccuracyM: 60 })).toBe(true);
    expect(arButtonEligible({ photo: withAngle, distanceM: AR_DISTANCE_LOOSE_M + 1, gpsAccuracyM: 60 })).toBe(false);
    // ...but at 120m with a good fix it is still out of range.
    expect(arButtonEligible({ photo: withAngle, distanceM: 120, gpsAccuracyM: 10 })).toBe(false);
  });
});

describe('25m grouping', () => {
  it('groups photos within 25m into one pin and splits those beyond', () => {
    const photos = [
      // Cluster near State & Madison across three eras (all within a few meters).
      photo({ id: 'a', lat: 41.8819, lon: -87.6278, era: 1905 }),
      photo({ id: 'b', lat: 41.88191, lon: -87.62782, era: 1940 }),
      photo({ id: 'c', lat: 41.88192, lon: -87.62779, era: 2016, layer: 'recent' }),
      // ~300m away → its own pin.
      photo({ id: 'd', lat: 41.8846, lon: -87.6278, era: 1912 }),
    ];
    const pins = groupPhotosWithin(photos, 25);
    expect(pins).toHaveLength(2);

    const big = pins.find((p) => p.photoIds.length === 3)!;
    expect(big.photoIds).toEqual(['a', 'b', 'c']); // era-sorted
    expect(big.eras).toEqual([1905, 1940, 2016]);
    expect(big.hasDeep).toBe(true);

    const lone = pins.find((p) => p.photoIds.length === 1)!;
    expect(lone.photoIds).toEqual(['d']);
  });

  it('marks a pin featured when any member is featured', () => {
    const photos = [
      photo({ id: 'a', lat: 41.88, lon: -87.62, era: 1900 }),
      photo({ id: 'b', lat: 41.880001, lon: -87.620001, era: 1950, featured: true }),
    ];
    const pins = groupPhotosWithin(photos, 25);
    expect(pins).toHaveLength(1);
    expect(pins[0].featured).toBe(true);
  });

  it('a recent-only cluster reports hasDeep = false', () => {
    const photos = [photo({ id: 'r', lat: 41.88, lon: -87.62, era: 2019, layer: 'recent' })];
    expect(groupPhotosWithin(photos, 25)[0].hasDeep).toBe(false);
  });
});
