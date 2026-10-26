import { create } from "zustand";

// Grabación de la simulación para la pestaña Análisis.
// Cada serie se identifica como "<id>:<medida>" (medidas: v, i, rpm, torque, angle).
// Todas las series comparten el eje de tiempo; donde una serie no tiene dato va null.

export const MAX_POINTS = 1200; // 2 minutos a 10 muestras por segundo

export type Metric = "v" | "i" | "rpm" | "torque" | "angle";

interface RecordState {
  t: number[];
  series: Record<string, (number | null)[]>;
  paused: boolean;
  /** Cambia en cada muestra: los gráficos se redibujan con él. */
  version: number;
  push: (t: number, values: Record<string, number>) => void;
  setPaused: (p: boolean) => void;
  clear: () => void;
}

/** Agrega una muestra a la grabación (función pura, para probarla sin React). */
export function appendSample(
  state: { t: number[]; series: Record<string, (number | null)[]> },
  t: number,
  values: Record<string, number>,
  max = MAX_POINTS,
): { t: number[]; series: Record<string, (number | null)[]> } {
  const n = state.t.length;
  const series: Record<string, (number | null)[]> = {};
  const keys = new Set([...Object.keys(state.series), ...Object.keys(values)]);
  for (const k of keys) {
    const prev = state.series[k] ?? new Array<number | null>(n).fill(null);
    const v = values[k];
    series[k] = [...prev, v === undefined || !Number.isFinite(v) ? null : v];
  }
  let tt = [...state.t, t];
  if (tt.length > max) {
    const cut = tt.length - max;
    tt = tt.slice(cut);
    for (const k of keys) series[k] = series[k]!.slice(cut);
  }
  return { t: tt, series };
}

export const useRecord = create<RecordState>((set, get) => ({
  t: [],
  series: {},
  paused: false,
  version: 0,
  push: (t, values) => {
    const s = get();
    if (s.paused) return;
    set({ ...appendSample(s, t, values), version: s.version + 1 });
  },
  setPaused: (paused) => set({ paused }),
  clear: () => set({ t: [], series: {}, version: get().version + 1 }),
}));
