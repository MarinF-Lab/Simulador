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
  /** Biblioteca en lista con descripciones. */
  showDesc: boolean;
  /** Recuadro "¿Qué es?" abierto en Propiedades. */
  showInfo: boolean;
  /** Imán al mover piezas: cuadrícula de 10 mm, agujeros y apoyo encima. Apagado, movimiento libre de 1 mm. */
  magnet: boolean;
  setMagnet: (v: boolean) => void;
  setShowDesc: (v: boolean) => void;
  setShowInfo: (v: boolean) => void;
  setTab: (t: Tab) => void;
  toggleRun: () => void;
  openSheet: (s: Sheet) => void;
  setSearch: (q: string) => void;
  toggleCategory: (c: CategoryId) => void;
}

// Preferencias de vista de cada persona: si el navegador no deja guardarlas, se usa el valor por defecto.
function load(key: string, d: boolean): boolean {
  try { const v = localStorage.getItem(key); return v === null ? d : v === "1"; } catch { return d; }
}
function save(key: string, v: boolean): void {
  try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* sin almacenamiento */ }
}

export const useUI = create<UIState>((set) => ({
  tab: "design",
  running: false,
  sheet: null,
  search: "",
  collapsed: Object.fromEntries(CATEGORIES.map((c) => [c.id, false])) as Record<CategoryId, boolean>,
  showDesc: load("kinetic.showDesc", false),
  showInfo: load("kinetic.showInfo", true),
  magnet: load("kinetic.magnet", false),
  setMagnet: (magnet) => { save("kinetic.magnet", magnet); set({ magnet }); },
  setShowDesc: (showDesc) => { save("kinetic.showDesc", showDesc); set({ showDesc }); },
  setShowInfo: (showInfo) => { save("kinetic.showInfo", showInfo); set({ showInfo }); },
  setTab: (tab) => set({ tab }),
  toggleRun: () => set((s) => ({ running: !s.running, tab: !s.running && s.tab === "design" ? "simulation" : s.tab })),
  openSheet: (sheet) => set({ sheet }),
  setSearch: (search) => set({ search }),
  toggleCategory: (c) => set((s) => ({ collapsed: { ...s.collapsed, [c]: !s.collapsed[c] } })),
}));
