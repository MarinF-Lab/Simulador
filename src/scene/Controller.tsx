import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { bounds, extent, TABLE } from "../core/model/project";
import { useProject } from "../store/project";
import { overlay, sceneApi } from "./api";

// Cámara ortográfica isométrica y gestos de la mesa:
// un dedo en el fondo desplaza, dos dedos hacen zoom, la rueda acerca o aleja,
// y una pieza se arrastra sobre el piso con ajuste a la cuadrícula.

const EL = Math.atan(1 / Math.SQRT2); // 35,26°: elevación isométrica
const ZMIN = 0.15, ZMAX = 8;
const EDGE = 30, EDGE_SPEED = 9; // px

type Drag =
  | { kind: "pan"; pid: number; sx: number; sy: number; p0: THREE.Vector3; moved: boolean }
  | { kind: "part"; pid: number; sx: number; sy: number; id: number; off: { x: number; y: number }; from: { x: number; y: number }; moved: boolean }
  | { kind: "ext"; id: number };

const reduced = (() => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
})();

export function Controller() {
  const { camera, gl, size, scene, invalidate } = useThree();
  const cam = camera as THREE.OrthographicCamera;
  const view = useRef({ az: 0, azNow: 0, tx: 0, ty: 0, zoom: 1 });
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; z0: number; p0: THREE.Vector3 } | null>(null);
  const drag = useRef<Drag | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef({ id: 0, t: 0 });
  const edgeRaf = useRef(0);
  const ray = useRef(new THREE.Raycaster());
  const floor = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));

  const selected = useProject((s) => s.selected);
  const parts = useProject((s) => s.project.parts);
  const dragging = useProject((s) => s.dragging);

  // Cualquier cambio del modelo pide un cuadro nuevo.
  useEffect(() => invalidate(), [parts, selected, dragging, invalidate]);

  /** Coloca la cámara según la vista actual. */
  const applyCamera = () => {
    const v = view.current;
    const a = Math.PI / 4 + v.azNow * (Math.PI / 2) - Math.PI / 2;
    const R = 3000;
    cam.up.set(0, 0, 1);
    cam.position.set(v.tx + R * Math.cos(EL) * Math.cos(a), v.ty + R * Math.cos(EL) * Math.sin(a), R * Math.sin(EL));
    cam.lookAt(v.tx, v.ty, 0);
    cam.zoom = v.zoom;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  };

  const rect = () => gl.domElement.getBoundingClientRect();

  /** Punto del piso bajo un punto de la pantalla. */
  const ground = (cx: number, cy: number): THREE.Vector3 | null => {
    const r = rect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.current.setFromCamera(ndc, cam);
    const out = new THREE.Vector3();
    return ray.current.ray.intersectPlane(floor.current, out);
  };

  const clampView = () => {
    const v = view.current;
    v.zoom = Math.min(ZMAX, Math.max(ZMIN, v.zoom));
    v.tx = Math.min(TABLE.w / 2, Math.max(-TABLE.w / 2, v.tx));
    v.ty = Math.min(TABLE.d / 2, Math.max(-TABLE.d / 2, v.ty));
  };

  /** Mueve la vista para que el punto p0 del piso quede bajo (cx, cy). */
  const keepUnder = (p0: THREE.Vector3, cx: number, cy: number) => {
    applyCamera();
    const p = ground(cx, cy);
    if (!p) return;
    view.current.tx += p0.x - p.x;
    view.current.ty += p0.y - p.y;
    clampView();
    applyCamera();
  };

  const zoomAt = (cx: number, cy: number, factor: number) => {
    const p0 = ground(cx, cy);
    view.current.zoom *= factor;
    clampView();
    if (p0) keepUnder(p0, cx, cy);
    invalidate();
  };

  const fit = () => {
    const v = view.current;
    const b = bounds(useProject.getState().project.parts) ?? { min: [-TABLE.w / 2, -TABLE.d / 2, 0], max: [TABLE.w / 2, TABLE.d / 2, 0] };
    v.tx = (b.min[0] + b.max[0]) / 2;
    v.ty = (b.min[1] + b.max[1]) / 2;
    v.zoom = 1;
    applyCamera();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    // En celular hay paneles abajo: deja más margen vertical.
    const padY = size.width < 1024 ? 200 : 100;
    v.zoom = Math.min((size.width - 48) / Math.max(1, x1 - x0), (size.height - padY) / Math.max(1, y1 - y0), 4);
    clampView();
    applyCamera();
    invalidate();
  };

  const hitPart = (cx: number, cy: number): number | null => {
    const r = rect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.current.setFromCamera(ndc, cam);
    const group = scene.getObjectByName("parts");
    if (!group) return null;
    for (const h of ray.current.intersectObjects(group.children, true)) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.partId === undefined) o = o.parent;
      if (o) return o.userData.partId as number;
    }
    return null;
  };

  /** Lleva la pieza arrastrada bajo el dedo. */
  const followPointer = () => {
    const d = drag.current, l = last.current;
    if (!d || !l || d.kind === "pan") return;
    const g = ground(l.x, l.y);
    if (!g) return;
    const off = d.kind === "part" ? d.off : { x: 0, y: 0 };
    useProject.getState().moveLive(d.id, g.x + off.x, g.y + off.y);
  };

  /** Autodesplazamiento cerca del borde mientras se arrastra una pieza. */
  const edgeTick = () => {
    edgeRaf.current = 0;
    const d = drag.current, l = last.current;
    if (!d || d.kind === "pan" || (d.kind === "part" && !d.moved) || !l) return;
    const r = rect();
    const inside = l.x >= r.left && l.x <= r.right && l.y >= r.top && l.y <= r.bottom;
    if (inside) {
      let vx = 0, vy = 0;
      if (l.x < r.left + EDGE) vx = -EDGE_SPEED; else if (l.x > r.right - EDGE) vx = EDGE_SPEED;
      if (l.y < r.top + EDGE) vy = -EDGE_SPEED; else if (l.y > r.bottom - EDGE) vy = EDGE_SPEED;
      if (vx || vy) {
        const a = ground(l.x, l.y), b = ground(l.x + vx, l.y + vy);
        if (a && b) {
          view.current.tx += b.x - a.x;
          view.current.ty += b.y - a.y;
          clampView();
          applyCamera();
          followPointer();
          invalidate();
        }
      }
    }
    edgeRaf.current = requestAnimationFrame(edgeTick);
  };
  const startEdge = () => {
    if (!edgeRaf.current) edgeRaf.current = requestAnimationFrame(edgeTick);
  };

  useEffect(() => {
    const el = gl.domElement;
    const P = () => useProject.getState();

    const startPinch = () => {
      const [a, b] = [...ptrs.current.values()];
      if (!a || !b) return;
      const d = drag.current;
      if (d?.kind === "part" && d.moved) P().endDrag(d.id, d.from);
      drag.current = null;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const p0 = ground(mx, my);
      if (p0) pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: view.current.zoom, p0 };
    };

    const down = (e: PointerEvent) => {
      if (e.button > 0) return;
      try { el.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.current.size === 2) return startPinch();
      if (ptrs.current.size > 2) return;
      last.current = { x: e.clientX, y: e.clientY };
      const id = hitPart(e.clientX, e.clientY);
      const g = ground(e.clientX, e.clientY);
      if (id !== null && g) {
        const p = P().project.parts.find((q) => q.id === id)!;
        drag.current = { kind: "part", pid: e.pointerId, sx: e.clientX, sy: e.clientY, id, off: { x: p.x - g.x, y: p.y - g.y }, from: { x: p.x, y: p.y }, moved: false };
      } else if (g) {
        drag.current = { kind: "pan", pid: e.pointerId, sx: e.clientX, sy: e.clientY, p0: g, moved: false };
      }
    };

    const move = (e: PointerEvent) => {
      if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pc = pinch.current;
      if (pc) {
        const [a, b] = [...ptrs.current.values()];
        if (!a || !b) return;
        view.current.zoom = pc.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / pc.d0);
        clampView();
        keepUnder(pc.p0, (a.x + b.x) / 2, (a.y + b.y) / 2);
        invalidate();
        return;
      }
      const d = drag.current;
      if (!d || d.kind === "ext" || d.pid !== e.pointerId) return;
      last.current = { x: e.clientX, y: e.clientY };
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) {
        d.moved = true;
        if (d.kind === "part") P().beginDrag(d.id);
      }
      if (!d.moved) return;
      if (d.kind === "pan") {
        keepUnder(d.p0, e.clientX, e.clientY);
        invalidate();
      } else {
        followPointer();
        startEdge();
      }
    };

    const up = (e: PointerEvent) => {
      ptrs.current.delete(e.pointerId);
      if (pinch.current) {
        if (ptrs.current.size < 2) pinch.current = null;
        drag.current = null;
        return;
      }
      const d = drag.current;
      if (!d || d.kind === "ext" || d.pid !== e.pointerId) return;
      drag.current = null;
      const cancel = e.type === "pointercancel";
      if (d.kind === "pan") {
        if (!d.moved && !cancel) P().select(null);
      } else if (d.moved) {
        P().endDrag(d.id, d.from);
      } else if (!cancel) {
        const now = performance.now();
        if (lastTap.current.id === d.id && now - lastTap.current.t < 350) {
          lastTap.current = { id: 0, t: 0 };
          P().rotate(d.id);
        } else {
          lastTap.current = { id: d.id, t: now };
          P().select(d.id);
        }
      }
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    };

    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });

    sceneApi.screenToTable = (cx, cy) => {
      const r = rect();
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
      const g = ground(cx, cy);
      return g ? { x: g.x, y: g.y } : null;
    };
    sceneApi.viewCenter = () => ({ x: view.current.tx, y: view.current.ty });
    sceneApi.zoomBy = (f) => {
      const r = rect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
    };
    sceneApi.fit = fit;
    sceneApi.rotateView = (dir) => {
      view.current.az += dir;
      if (reduced) view.current.azNow = view.current.az;
      invalidate();
    };
    sceneApi.externalDrag = (id, cx, cy) => {
      if (id === null) {
        drag.current = null;
        return;
      }
      drag.current = { kind: "ext", id };
      if (cx !== undefined && cy !== undefined) {
        last.current = { x: cx, y: cy };
        followPointer();
        startEdge();
      }
    };

    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      if (edgeRaf.current) cancelAnimationFrame(edgeRaf.current);
    };
    // Las funciones internas leen refs; basta con registrarlas una vez por lienzo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, cam, size.width, size.height]);

  // Encuadre inicial.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !size.width) return;
    fitted.current = true;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width]);

  const tmp = useRef(new THREE.Vector3());
  useFrame(() => {
    const v = view.current;
    if (Math.abs(v.azNow - v.az) > 0.001) {
      v.azNow += (v.az - v.azNow) * 0.22;
      if (Math.abs(v.azNow - v.az) < 0.002) v.azNow = v.az;
      invalidate();
    }
    applyCamera();

    // Botón ⟳ junto a la pieza seleccionada.
    const btn = overlay.rotBtn;
    if (btn) {
      const st = useProject.getState();
      const p = st.project.parts.find((q) => q.id === st.selected);
      if (p && st.dragging === null) {
        const ez = extent(p)[2];
        tmp.current.set(p.x, p.y, p.z + ez).project(cam);
        const x = ((tmp.current.x + 1) / 2) * size.width, y = ((1 - tmp.current.y) / 2) * size.height;
        btn.style.transform = `translate(${Math.round(x + 18)}px, ${Math.round(y - 62)}px)`;
        btn.hidden = false;
      } else btn.hidden = true;
    }

    // Indicador de ejes según la cámara.
    const svg = overlay.axes;
    if (svg) {
      const inv = cam.quaternion.clone().invert();
      for (const [k, vec] of [["x", [1, 0, 0]], ["y", [0, 1, 0]], ["z", [0, 0, 1]]] as const) {
        const s = new THREE.Vector3(...vec).applyQuaternion(inv);
        const line = svg.querySelector(`[data-axis="${k}"]`);
        const label = svg.querySelector(`[data-label="${k}"]`);
        line?.setAttribute("x2", (32 + s.x * 22).toFixed(1));
        line?.setAttribute("y2", (32 - s.y * 22).toFixed(1));
        label?.setAttribute("x", (32 + s.x * 28 - 4).toFixed(1));
        label?.setAttribute("y", (32 - s.y * 28 + 4).toFixed(1));
      }
    }
  });

  return null;
}
