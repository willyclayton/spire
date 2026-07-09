import { describe, it, expect } from 'vitest';
import { initialBearingDeg, wrap180, distanceM, circularMeanDeg } from './bearing';
import { elevationAngleDeg } from './elevation';
import { matchBuildings, cullOccluded, DEFAULT_FOV_DEG, MAX_LABELS } from './matcher';
import type { Building } from '../types';

// Fixed reference points around Chicago.
const BUCKINGHAM_FOUNTAIN = { lat: 41.8757, lon: -87.6189 };
const WILLIS_TOWER = { lat: 41.8789, lon: -87.6359 };

describe('bearing', () => {
  it('due north returns ~0°', () => {
    const b = initialBearingDeg({ lat: 41.87, lon: -87.63 }, { lat: 41.88, lon: -87.63 });
    // Result is normalized into [0, 360); either near 0 or near 360 is acceptable.
    const normalized = Math.min(b, 360 - b);
    expect(normalized).toBeLessThan(0.5);
  });

  it('due east returns ~90°', () => {
    const b = initialBearingDeg({ lat: 41.87, lon: -87.63 }, { lat: 41.87, lon: -87.62 });
    expect(b).toBeGreaterThan(89);
    expect(b).toBeLessThan(91);
  });

  it('due south returns ~180°', () => {
    const b = initialBearingDeg({ lat: 41.88, lon: -87.63 }, { lat: 41.87, lon: -87.63 });
    expect(b).toBeCloseTo(180, 0);
  });

  it('due west returns ~270°', () => {
    const b = initialBearingDeg({ lat: 41.87, lon: -87.63 }, { lat: 41.87, lon: -87.64 });
    expect(b).toBeGreaterThan(269);
    expect(b).toBeLessThan(271);
  });

  it('Willis Tower from Buckingham Fountain is roughly WNW (~285°)', () => {
    const b = initialBearingDeg(BUCKINGHAM_FOUNTAIN, WILLIS_TOWER);
    // Willis is west and slightly north of Buckingham Fountain — bearing ~285°.
    expect(b).toBeGreaterThan(280);
    expect(b).toBeLessThan(295);
  });

  it('distance Buckingham→Willis is ~1400m', () => {
    const d = distanceM(BUCKINGHAM_FOUNTAIN, WILLIS_TOWER);
    expect(d).toBeGreaterThan(1300);
    expect(d).toBeLessThan(1600);
  });
});

describe('wrap180', () => {
  it('handles the 359/0 seam', () => {
    expect(wrap180(1 - 359)).toBeCloseTo(2, 5); // going 359→1 is +2°
    expect(wrap180(359 - 1)).toBeCloseTo(-2, 5); // going 1→359 is -2°
  });

  it('returns 0 for identical inputs', () => {
    expect(wrap180(0)).toBe(0);
  });

  it('caps at ±180', () => {
    expect(wrap180(180)).toBe(180);
    expect(wrap180(-180)).toBe(-180);
    expect(wrap180(270)).toBe(-90);
    expect(wrap180(-270)).toBe(90);
  });
});

describe('circularMeanDeg', () => {
  it('averages across the 359/0 seam correctly', () => {
    const mean = circularMeanDeg([359, 1]);
    // arithmetic mean would be 180; circular mean should be near 0.
    expect(Math.abs(wrap180(mean))).toBeLessThan(1);
  });

  it('handles single input', () => {
    expect(circularMeanDeg([90])).toBeCloseTo(90, 3);
  });
});

describe('elevation', () => {
  it('is 45° when height matches distance (minus eye height)', () => {
    // heightM - 1.6 = distance → 45°
    expect(elevationAngleDeg(101.6, 100)).toBeCloseTo(45, 1);
  });

  it('increases as distance shrinks', () => {
    const near = elevationAngleDeg(200, 100);
    const far = elevationAngleDeg(200, 1000);
    expect(near).toBeGreaterThan(far);
  });
});

// ————————————————————————————————————————————————————————————
// Matcher / FOV
// ————————————————————————————————————————————————————————————

function makeBuilding(overrides: Partial<Building> = {}): Building {
  return {
    id: 'test',
    name: 'Test',
    lat: 41.88,
    lon: -87.62,
    heightM: 100,
    prominence: 5,
    ...overrides,
  };
}

describe('FOV filter (boundary)', () => {
  const observer = { lat: 41.87, lon: -87.63 };
  // Building due east of observer.
  const east = makeBuilding({ id: 'east', lat: 41.87, lon: -87.62 });

  it('includes when bearing delta is within FOV/2 + 5°', () => {
    // Heading due east → delta 0 → included.
    const labels = matchBuildings({
      observer,
      headingDeg: 90,
      pitchDeg: 0,
      calibrationOffsetDeg: 0,
      buildings: [east],
      viewportWidth: 400,
      viewportHeight: 800,
    });
    expect(labels.length).toBe(1);
  });

  it('excludes when bearing delta > FOV/2 + 5°', () => {
    // Heading due north (0°) → delta from east is 90° → outside 60/2 + 5 = 35.
    const labels = matchBuildings({
      observer,
      headingDeg: 0,
      pitchDeg: 0,
      calibrationOffsetDeg: 0,
      buildings: [east],
      viewportWidth: 400,
      viewportHeight: 800,
    });
    expect(labels.length).toBe(0);
  });

  it('includes at the FOV/2 + 5° boundary', () => {
    // Heading such that delta ≈ 34° (just inside boundary).
    const labels = matchBuildings({
      observer,
      headingDeg: 90 - 34,
      pitchDeg: 0,
      calibrationOffsetDeg: 0,
      buildings: [east],
      viewportWidth: 400,
      viewportHeight: 800,
    });
    expect(labels.length).toBe(1);
  });

  it('excludes just past the boundary', () => {
    const labels = matchBuildings({
      observer,
      headingDeg: 90 - (DEFAULT_FOV_DEG / 2 + 6),
      pitchDeg: 0,
      calibrationOffsetDeg: 0,
      buildings: [east],
      viewportWidth: 400,
      viewportHeight: 800,
    });
    expect(labels.length).toBe(0);
  });

  it('respects calibration offset', () => {
    // Building is due east. Heading due north but calibration says "add 90° to heading".
    // → effective heading = 90° = due east → included.
    const labels = matchBuildings({
      observer,
      headingDeg: 0,
      pitchDeg: 0,
      calibrationOffsetDeg: 90,
      buildings: [east],
      viewportWidth: 400,
      viewportHeight: 800,
    });
    expect(labels.length).toBe(1);
  });
});

describe('Distance prefilter', () => {
  const observer = { lat: 41.87, lon: -87.63 };
  it('excludes buildings under 50m (the "you are here" special case)', () => {
    // Same coord → 0m.
    const under = makeBuilding({ id: 'under', lat: 41.87, lon: -87.63, heightM: 200 });
    const labels = matchBuildings({
      observer,
      headingDeg: 0,
      pitchDeg: 0,
      calibrationOffsetDeg: 0,
      buildings: [under],
    });
    expect(labels.length).toBe(0);
  });

  it('excludes buildings beyond 8km', () => {
    // ~9km north of observer.
    const far = makeBuilding({ id: 'far', lat: 41.87 + 0.081, lon: -87.63, heightM: 200 });
    const labels = matchBuildings({
      observer,
      headingDeg: 0,
      pitchDeg: 0,
      calibrationOffsetDeg: 0,
      buildings: [far],
    });
    expect(labels.length).toBe(0);
  });
});

// ————————————————————————————————————————————————————————————
// Occlusion
// ————————————————————————————————————————————————————————————

describe('occlusion heuristic', () => {
  const observer = { lat: 41.87, lon: -87.63 };

  it('culls a shorter far building hidden behind a tall near building at same bearing', () => {
    // Two buildings due north; near is 300m at 400m, far is 100m at 2000m — same bearing.
    // The near building's elevation angle >> the far one's. Far should be culled.
    const near = makeBuilding({ id: 'near', lat: 41.87 + 400 / 111111, lon: -87.63, heightM: 300, prominence: 8 });
    const far = makeBuilding({ id: 'far', lat: 41.87 + 2000 / 111111, lon: -87.63, heightM: 100, prominence: 5 });

    // Compute directly through cullOccluded to keep the test focused.
    const cands = [near, far].map((b) => ({
      building: b,
      bearingDeg: 0,
      distanceM: distanceM(observer, { lat: b.lat, lon: b.lon }),
      elevationAngleDeg: elevationAngleDeg(b.heightM, distanceM(observer, { lat: b.lat, lon: b.lon })),
      deltaFromHeading: 0,
      score: 0,
    }));

    const kept = cullOccluded(cands);
    expect(kept.map((k) => k.building.id)).toEqual(['near']);
  });

  it('does NOT cull when bearings differ by more than 3°', () => {
    // Near due north; far due NNE (bearing ~10° from observer, which is > 3° from near's bearing).
    const near = makeBuilding({ id: 'near', lat: 41.87 + 400 / 111111, lon: -87.63, heightM: 300 });
    // Offset ~10° east at 2km — big enough to clear the 3° window.
    const far = makeBuilding({ id: 'far', lat: 41.87 + 0.018, lon: -87.63 + 0.004, heightM: 100 });

    const cands = [near, far].map((b) => ({
      building: b,
      bearingDeg: initialBearingDeg(observer, { lat: b.lat, lon: b.lon }),
      distanceM: distanceM(observer, { lat: b.lat, lon: b.lon }),
      elevationAngleDeg: elevationAngleDeg(b.heightM, distanceM(observer, { lat: b.lat, lon: b.lon })),
      deltaFromHeading: 0,
      score: 0,
    }));

    const kept = cullOccluded(cands);
    expect(kept).toHaveLength(2);
  });
});

// ————————————————————————————————————————————————————————————
// Label cap + collision
// ————————————————————————————————————————————————————————————

describe('label cap and collision drop', () => {
  const observer = { lat: 41.87, lon: -87.63 };

  it('caps at MAX_LABELS', () => {
    // 20 buildings in a fan due east, spread across the FOV.
    const buildings: Building[] = [];
    for (let i = 0; i < 20; i++) {
      // Small angular offsets → different screen positions.
      const dLat = (Math.random() - 0.5) * 0.001;
      const dLon = 0.005 + i * 0.001;
      buildings.push(
        makeBuilding({
          id: `b${i}`,
          lat: observer.lat + dLat,
          lon: observer.lon + dLon,
          heightM: 100 + i * 20,
          prominence: 5 + (i % 5),
        }),
      );
    }
    const labels = matchBuildings({
      observer,
      headingDeg: 90,
      pitchDeg: 0,
      calibrationOffsetDeg: 0,
      buildings,
      viewportWidth: 2000,
      viewportHeight: 800,
    });
    expect(labels.length).toBeLessThanOrEqual(MAX_LABELS);
  });

  it('drops the lower-scored label when two collide', () => {
    // Two buildings at almost identical bearings + distances → same screen x,y.
    // High prominence must survive.
    const highScore = makeBuilding({
      id: 'high',
      lat: observer.lat + 400 / 111111,
      lon: observer.lon,
      heightM: 200,
      prominence: 10,
    });
    const lowScore = makeBuilding({
      id: 'low',
      // Almost identical position — same screen anchor.
      lat: observer.lat + 400 / 111111,
      lon: observer.lon + 0.00001,
      heightM: 200,
      prominence: 3,
    });

    const labels = matchBuildings({
      observer,
      headingDeg: 0,
      pitchDeg: 0,
      calibrationOffsetDeg: 0,
      buildings: [highScore, lowScore],
      viewportWidth: 400,
      viewportHeight: 800,
    });
    expect(labels.length).toBe(1);
    expect(labels[0].building.id).toBe('high');
  });
});
