import { create } from "zustand";
import { CATEGORIES, type CategoryId } from "../core/model/catalog";

export type Tab = "design" | "simulation" | "analysis";
export type Sheet = "library" | "properties" | null;
export type PropValue = number | string | boolean;

interface UIState {
  tab: Tab;
  running: boolean;
  sheet: Sheet;
  search: string;
  collapsed: Record<CategoryId, boolean>;
  /** Pieza del catálogo seleccionada (en la etapa 2 será una pieza de la mesa). */
  selected: string | null;
  /** Valores editados en Propiedades, por pieza. */
  values: Record<string, Record<string, PropValue>>;
  setTab: (t: Tab) => void;
  toggleRun: () => void;
  openSheet: (s: Sheet) => void;
  setSearch: (q: string) => void;
  toggleCategory: (c: CategoryId) => void;
  select: (id: string | null) => void;
  setValue: (id: string, key: string, v: PropValue) => void;
}

export const useUI = create<UIState>((set) => ({
  tab: "design",
  running: false,
  sheet: null,
  search: "",
  collapsed: Object.fromEntries(CATEGORIES.map((c) => [c.id, false])) as Record<CategoryId, boolean>,
  selected: "dcmotor",
  values: {},
  setTab: (tab) => set({ tab }),
  toggleRun: () => set((s) => ({ running: !s.running, tab: !s.running && s.tab === "design" ? "simulation" : s.tab })),
  openSheet: (sheet) => set({ sheet }),
  setSearch: (search) => set({ search }),
  toggleCategory: (c) => set((s) => ({ collapsed: { ...s.collapsed, [c]: !s.collapsed[c] } })),
  select: (selected) => set({ selected }),
  setValue: (id, key, v) => set((s) => ({ values: { ...s.values, [id]: { ...s.values[id], [key]: v } } })),
}));
