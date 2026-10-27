// Guardado automático del proyecto en este navegador.

import { create } from "zustand";
import { parseProject, serialize } from "../core/persistence/file";
import { useProject } from "./project";

const KEY = "kinetic:project:v1";

/** Cuándo se guardó por última vez y si el navegador deja guardar. */
export const useSave = create<{ savedAt: number | null; ok: boolean }>(() => ({ savedAt: null, ok: true }));

/** Carga el proyecto guardado, si hay uno válido. */
export function restoreSaved(): boolean {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return false;
    const r = parseProject(text);
    if (!r.ok) return false;
    useProject.getState().load(r.project);
    return true;
  } catch {
    return false;
  }
}

/** Guarda la mesa 600 ms después del último cambio. */
export function startAutosave(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  useProject.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, serialize(useProject.getState().project));
        useSave.setState({ savedAt: Date.now(), ok: true });
      } catch {
        useSave.setState({ ok: false });
      }
    }, 600);
  });
}
