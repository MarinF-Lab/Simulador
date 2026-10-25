import { create } from "zustand";
import { CATEGORIES, type CategoryId } from "../core/model/catalog";

export type Tab = "design" | "simulation" | "analysis";
export type Sheet = "library" | "properties" | null;

interface UIState {
  tab: Tab;
  running: boolean;
  sheet: Sheet;
  search: string;
  collapsed: Record<CategoryId, boolean>;
  setTab: (t: Tab) => void;
  toggleRun: () => void;
  openSheet: (s: Sheet) => void;
  setSearch: (q: string) => void;
  toggleCategory: (c: CategoryId) => void;
}

export const useUI = create<UIState>((set) => ({
  tab: "design",
  running: false,
  sheet: null,
  search: "",
  collapsed: Object.fromEntries(CATEGORIES.map((c) => [c.id, false])) as Record<CategoryId, boolean>,
  setTab: (tab) => set({ tab }),
  toggleRun: () => set((s) => ({ running: !s.running, tab: !s.running && s.tab === "design" ? "simulation" : s.tab })),
  openSheet: (sheet) => set({ sheet }),
  setSearch: (search) => set({ search }),
  toggleCategory: (c) => set((s) => ({ collapsed: { ...s.collapsed, [c]: !s.collapsed[c] } })),
}));
