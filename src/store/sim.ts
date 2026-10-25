import { create } from "zustand";
import type { Pose, SimStatus } from "../physics/world";

/** Poses de la simulación: se leen en cada cuadro, sin pasar por React. */
export const simPoses: { map: Map<number, Pose>; follow: Map<number, { holder: number; offset: [number, number, number] }>; start: Map<number, [number, number, number]> } = {
  map: new Map(),
  follow: new Map(),
  start: new Map(),
};

interface SimState {
  status: SimStatus | null;
  loading: boolean;
  error: string | null;
  setStatus: (s: SimStatus | null) => void;
}

export const useSim = create<SimState>((set) => ({
  status: null,
  loading: false,
  error: null,
  setStatus: (status) => set({ status }),
}));
