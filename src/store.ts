import { create } from 'zustand';
import type { Building } from './types';

type Stage = 'onboarding' | 'ready';

interface State {
  buildings: Building[];
  buildingsLoaded: boolean;
  loadBuildings: () => Promise<void>;

  stage: Stage;
  setStage: (stage: Stage) => void;

  calibrationOffsetDeg: number;
  bumpCalibration: (deltaDeg: number) => void;
  resetCalibration: () => void;

  view: 'radar' | 'camera';
  setView: (v: 'radar' | 'camera') => void;

  selectedBuildingId: string | null;
  selectBuilding: (id: string | null) => void;
}

const CALIB_KEY = 'spire.calibrationOffset';
function loadCalibration(): number {
  if (typeof localStorage === 'undefined') return 0;
  const raw = localStorage.getItem(CALIB_KEY);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
function persistCalibration(n: number) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(CALIB_KEY, String(n));
}

export const useStore = create<State>((set, get) => ({
  buildings: [],
  buildingsLoaded: false,
  loadBuildings: async () => {
    if (get().buildingsLoaded) return;
    const res = await fetch('/data/chicago.json');
    if (!res.ok) throw new Error(`Failed to load buildings: ${res.status}`);
    const data = (await res.json()) as Building[];
    set({ buildings: data, buildingsLoaded: true });
  },

  stage: 'onboarding',
  setStage: (stage) => set({ stage }),

  calibrationOffsetDeg: loadCalibration(),
  bumpCalibration: (deltaDeg) =>
    set((s) => {
      const next = ((s.calibrationOffsetDeg + deltaDeg + 540) % 360) - 180;
      persistCalibration(next);
      return { calibrationOffsetDeg: next };
    }),
  resetCalibration: () => {
    persistCalibration(0);
    set({ calibrationOffsetDeg: 0 });
  },

  view: 'radar',
  setView: (v) => set({ view: v }),

  selectedBuildingId: null,
  selectBuilding: (id) => set({ selectedBuildingId: id }),
}));
