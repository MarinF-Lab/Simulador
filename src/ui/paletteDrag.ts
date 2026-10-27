// Arrastre desde la biblioteca hasta la mesa.
// - Tocar sin mover: coloca la pieza en un lugar libre cerca del centro de la vista.
// - Mover hacia un lado, o mantener presionado y mover: arrastra la pieza a la mesa.
// - Mover hacia arriba o abajo sin esperar: desplaza la lista (no arrastra).

import { sceneApi } from "../scene/api";
import { useProject } from "../store/project";
import { useUI } from "../store/ui";

const HOLD_MS = 250, SLOP = 8;
let active = false;

/** true mientras una pieza viaja desde la biblioteca: la lista no debe desplazarse. */
export const paletteDragging = () => active;

export function startPaletteGesture(e: React.PointerEvent, type: string) {
  if (e.button > 0) return;
  // La correa no se arrastra: se elige y después se tocan dos poleas.
  if (type === "belt" || type === "rope" || type === "bolt" || type === "joint" || type === "draw" || type === "glue" || type === "drill") {
    const done = () => {
      useProject.getState().addNear(type, 0, 0);
      useUI.getState().openSheet(null);
      window.removeEventListener("pointerup", done);
    };
    window.addEventListener("pointerup", done);
    return;
  }
  const pid = e.pointerId, sx = e.clientX, sy = e.clientY, t0 = performance.now();
  const mouse = e.pointerType === "mouse";
  let state: "wait" | "drag" | "scroll" = "wait";
  let temp: number | null = null;

  const placeAt = (cx: number, cy: number) => {
    const at = sceneApi.screenToTable(cx, cy);
    const st = useProject.getState();
    if (at && temp === null) {
      temp = st.addTemp(type, at.x, at.y);
      sceneApi.externalDrag(temp, cx, cy);
    } else if (at && temp !== null) {
      sceneApi.externalDrag(temp, cx, cy);
    }
  };

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== pid) return;
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (state === "wait" && Math.hypot(dx, dy) > SLOP) {
      if (mouse || performance.now() - t0 > HOLD_MS || Math.abs(dx) >= Math.abs(dy)) {
        state = "drag";
        active = true;
        useUI.getState().openSheet(null);
      } else {
        state = "scroll";
        cleanup();
        return;
      }
    }
    if (state === "drag") placeAt(ev.clientX, ev.clientY);
  };

  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== pid) return;
    const cancel = ev.type === "pointercancel";
    if (state === "drag") {
      const over = sceneApi.screenToTable(ev.clientX, ev.clientY);
      const st = useProject.getState();
      if (temp !== null) {
        if (over && !cancel) st.commitTemp(temp);
        else st.dropTemp(temp);
      }
      sceneApi.externalDrag(null);
    } else if (state === "wait" && !cancel) {
      const c = sceneApi.viewCenter();
      useProject.getState().addNear(type, c.x, c.y);
      useUI.getState().openSheet(null);
    }
    cleanup();
  };

  const touchMove = (ev: TouchEvent) => {
    if (state === "drag" && ev.cancelable) ev.preventDefault();
  };

  function cleanup() {
    active = false;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    window.removeEventListener("touchmove", touchMove);
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("touchmove", touchMove, { passive: false });
}
