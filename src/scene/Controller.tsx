import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { bounds, extent, rotateLocal, sizeOf, TABLE, unrotateLocal, type Cable, type Part, type Vec3 } from "../core/model/project";
import { parseShape, type Pt } from "../core/model/polygon";
import { endPos, TERMINALS, termWorld } from "../core/model/terminals";
import { snap } from "../core/model/units";
import { useProject, type TermRef } from "../store/project";
import { useUI } from "../store/ui";
import { shapeOf, type CableShape } from "../core/history/commands";
import { cableMid } from "./cableCurve";
import { jointPoint } from "../core/model/structure";
import { overlay, sceneApi } from "./api";

// Cámara ortográfica libre y gestos de la mesa:
// - un dedo en el fondo desplaza; dos dedos: pellizco = zoom, giro = orbitar, subir o bajar juntos = inclinar
// - mouse: rueda = zoom, botón derecho o Mayús + arrastrar = orbitar
// - una pieza se arrastra sobre el piso con ajuste a la cuadrícula.

const ISO_EL = Math.atan(1 / Math.SQRT2); // 35,26°: elevación isométrica
const ISO_AZ = -Math.PI / 4;
const EL_MIN = (15 * Math.PI) / 180, EL_MAX = (89 * Math.PI) / 180;
const ORBIT_PX = 0.008, TILT_PX = 0.006; // radianes por píxel
const ZMIN = 0.15, ZMAX = 8;
const EDGE = 30, EDGE_SPEED = 9; // px
const SNAP_PX = 28; // radio del imán de bornes y puntas, en pantalla

type Drag =
  | { kind: "orbit"; pid: number; lx: number; ly: number }
  | { kind: "pan"; pid: number; sx: number; sy: number; p0: THREE.Vector3; moved: boolean; tapCable: number | null }
  /** Desde un borne: tocar = dejarlo pendiente; arrastrar = cable nuevo. */
  | { kind: "term"; pid: number; sx: number; sy: number; ref: TermRef; moved: boolean; wire: number | null }
  /** Punta de un cable existente. */
  | { kind: "end"; pid: number; sx: number; sy: number; id: number; i: 0 | 1; before: CableShape; moved: boolean }
  /** Cable completo (modo Mover). */
  | { kind: "cmove"; pid: number; sx: number; sy: number; id: number; before: CableShape; p0: THREE.Vector3; moved: boolean }
  /** Punto de doblez (modo Doblar), sobre un plano horizontal a la altura h. */
  | { kind: "bend"; pid: number; sx: number; sy: number; id: number; before: CableShape; h: number; moved: boolean; onHandle: boolean }
  | { kind: "part"; pid: number; sx: number; sy: number; id: number; off: { x: number; y: number }; from: { x: number; y: number }; moved: boolean }
  | { kind: "ext"; id: number }
  /** Vértice de una pieza libre (Editar forma). */
  | { kind: "vtx"; pid: number; sx: number; sy: number; id: number; i: number; moved: boolean }
  /** Lado de una pieza libre: se mueve entero desde donde se tomó. */
  | { kind: "edge"; pid: number; sx: number; sy: number; id: number; i: number; l0: Pt; base: Pt[]; moved: boolean };

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
  /** az y el: ángulos actuales; azGoal y elGoal: destino de una animación (girar 90°, isométrica). */
  const view = useRef({ az: ISO_AZ, el: ISO_EL, azGoal: ISO_AZ, elGoal: ISO_EL, tx: 0, ty: 0, zoom: 1 });
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; ang: number; my: number; mx0: number; my0: number; p0: THREE.Vector3 } | null>(null);
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
    const R = 3000;
    cam.up.set(0, 0, 1);
    cam.position.set(v.tx + R * Math.cos(v.el) * Math.cos(v.az), v.ty + R * Math.cos(v.el) * Math.sin(v.az), R * Math.sin(v.el));
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
    v.el = Math.min(EL_MAX, Math.max(EL_MIN, v.el));
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

  type Hit = { kind: "vtx"; i: number } | { kind: "edge"; i: number } | { kind: "end"; id: number; i: 0 | 1 } | { kind: "bend"; id: number } | { kind: "term"; ref: TermRef } | { kind: "part"; id: number } | { kind: "cable"; id: number } | { kind: "belt"; id: number } | { kind: "joint"; id: number };

  /** Qué hay bajo el dedo. Prioridad: puntas de cable, bornes (si no están tapados), piezas y cables. */
  const hitAny = (cx: number, cy: number): Hit | null => {
    const r = rect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.current.setFromCamera(ndc, cam);
    const first = (name: string) => {
      const g = scene.getObjectByName(name);
      return g ? ray.current.intersectObjects(g.children, true)[0] : undefined;
    };
    const sh = first("shape");
    if (sh?.object.userData.shapeV !== undefined) return { kind: "vtx", i: sh.object.userData.shapeV as number };
    if (sh?.object.userData.shapeE !== undefined) return { kind: "edge", i: sh.object.userData.shapeE as number };
    const end = first("ends");
    if (end?.object.userData.cableEnd) return { kind: "end", ...(end.object.userData.cableEnd as { id: number; i: 0 | 1 }) };
    const jh = first("joints");
    if (jh?.object.userData.joint !== undefined) return { kind: "joint", id: jh.object.userData.joint as number };
    const bh = first("bend");
    if (bh?.object.userData.bendHandle !== undefined) return { kind: "bend", id: bh.object.userData.bendHandle as number };
    const term = first("terms"), part = first("parts"), cab = first("cables");
    if (term && (!part || term.distance <= part.distance + 15)) return { kind: "term", ref: term.object.userData.term as TermRef };
    if (part && (!cab || part.distance <= cab.distance)) {
      let o: THREE.Object3D | null = part.object;
      while (o && o.userData.partId === undefined) o = o.parent;
      if (o) return { kind: "part", id: o.userData.partId as number };
    }
    const belt = first("belts");
    if (belt?.object.userData.belt !== undefined && (!cab || belt.distance <= cab.distance)) return { kind: "belt", id: belt.object.userData.belt as number };
    if (cab) {
      let o: THREE.Object3D | null = cab.object;
      while (o && o.userData.cable === undefined) o = o.parent;
      if (o) return { kind: "cable", id: o.userData.cable as number };
    }
    return null;
  };

  /** Punto de la superficie de una pieza bajo el dedo. */
  const partPoint = (cx: number, cy: number): Vec3 | null => {
    const r = rect();
    ray.current.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), cam);
    const g = scene.getObjectByName("parts");
    const hit = g ? ray.current.intersectObjects(g.children, true)[0] : undefined;
    return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
  };

  const tmpV = new THREE.Vector3();
  const toScreen = (p: Vec3) => {
    const r = rect();
    tmpV.set(p[0], p[1], p[2]).project(cam);
    return { x: r.left + ((tmpV.x + 1) / 2) * r.width, y: r.top + ((1 - tmpV.y) / 2) * r.height };
  };

  /** Imán: borne o punta de otro cable cerca del dedo; si no hay, el piso ajustado a 10 mm. */
  const snapAt = (cx: number, cy: number, cableId: number): { p: Vec3; att: TermRef | null } | null => {
    const pr = useProject.getState().project;
    let best: { p: Vec3; att: TermRef | null } | null = null, bd = SNAP_PX;
    for (const part of pr.parts) {
      const n = TERMINALS[part.type]?.length ?? 0;
      for (let t = 0; t < n; t++) {
        const w = termWorld(part, t), s2 = toScreen(w), d = Math.hypot(s2.x - cx, s2.y - cy);
        if (d < bd) { bd = d; best = { p: w, att: { part: part.id, t } }; }
      }
    }
    for (const c of pr.cables) {
      if (c.id === cableId) continue;
      for (const e of c.ends) {
        const w = endPos(pr, e), s2 = toScreen(w), d = Math.hypot(s2.x - cx, s2.y - cy);
        if (d < bd) { bd = d; best = { p: w, att: e.att }; }
      }
    }
    if (best) return best;
    const g = ground(cx, cy);
    if (!g) return null;
    const hx = TABLE.w / 2 - 10, hy = TABLE.d / 2 - 10;
    return { p: [Math.min(hx, Math.max(-hx, snap(g.x))), Math.min(hy, Math.max(-hy, snap(g.y))), 0], att: null };
  };

  /** Punto bajo el dedo en la cara de arriba de una pieza, en mm locales (ajustado a 5 mm). */
  const localOnTop = (cx: number, cy: number, p: Part): Pt | null => {
    const r = rect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.current.setFromCamera(ndc, cam);
    const h = extent(p)[2], c = new THREE.Vector3(p.x, p.y, p.z + h / 2);
    const n = new THREE.Vector3(...rotateLocal([0, 0, 1], p.rot));
    const top = c.clone().addScaledVector(n, sizeOf(p.type, p.props)[2] / 2);
    const hit = ray.current.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, top), new THREE.Vector3());
    if (!hit) return null;
    const l = unrotateLocal([hit.x - c.x, hit.y - c.y, hit.z - c.z], p.rot);
    return [Math.round(l[0] / 5) * 5, Math.round(l[1] / 5) * 5];
  };

  /** Lleva lo arrastrado (pieza, punta o cable nuevo) bajo el dedo. */
  const followPointer = () => {
    const d = drag.current, l = last.current;
    if (!d || !l || d.kind === "pan" || d.kind === "orbit") return;
    const st = useProject.getState();
    if (d.kind === "vtx" || d.kind === "edge") {
      const p = st.project.parts.find((q) => q.id === d.id);
      const at = p && localOnTop(l.x, l.y, p);
      if (!p || !at) return;
      if (d.kind === "vtx") {
        const pts = parseShape(p.props.shape);
        pts[d.i] = at;
        st.shapeLive(d.id, pts);
      } else {
        const dx = at[0] - d.l0[0], dy = at[1] - d.l0[1];
        const j = (d.i + 1) % d.base.length;
        st.shapeLive(d.id, d.base.map((q, k) => (k === d.i || k === j ? [q[0] + dx, q[1] + dy] : q)));
      }
      return;
    }
    if (d.kind === "cmove") {
      const g = ground(l.x, l.y);
      if (!g) return;
      const dx = snap(g.x - d.p0.x), dy = snap(g.y - d.p0.y);
      const ends = d.before.ends.map((e) => {
        const [x, y, z] = endPos(st.project, e);
        return { att: null, x: Math.round(x + dx), y: Math.round(y + dy), z: Math.round(z) };
      }) as Cable["ends"];
      const bend = d.before.bend ? ([d.before.bend[0] + dx, d.before.bend[1] + dy, d.before.bend[2]] as Vec3) : null;
      st.setCableLive(d.id, { ends, bend });
      return;
    }
    if (d.kind === "bend") {
      const r = rect();
      const ndc = new THREE.Vector2(((l.x - r.left) / r.width) * 2 - 1, -((l.y - r.top) / r.height) * 2 + 1);
      ray.current.setFromCamera(ndc, cam);
      const hit = ray.current.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -d.h), new THREE.Vector3());
      if (!hit) return;
      const c = st.project.cables.find((q) => q.id === d.id);
      if (c) st.setCableLive(d.id, { ends: c.ends, bend: [Math.round(hit.x), Math.round(hit.y), Math.round(d.h)] });
      return;
    }
    if (d.kind === "term" || d.kind === "end") {
      const id = d.kind === "term" ? d.wire : d.id;
      if (id === null) return;
      const sn = snapAt(l.x, l.y, id);
      if (sn) st.moveEndLive(id, d.kind === "term" ? 1 : d.i, sn.p, sn.att);
      return;
    }
    const g = ground(l.x, l.y);
    if (!g) return;
    if (d.kind === "ext" && st.project.cables.some((c) => c.id === d.id)) {
      st.moveCableLive(d.id, g.x, g.y);
      return;
    }
    const off = d.kind === "part" ? d.off : { x: 0, y: 0 };
    st.moveLive(d.id, g.x + off.x, g.y + off.y);
  };

  /** Autodesplazamiento cerca del borde mientras se arrastra una pieza. */
  const edgeTick = () => {
    edgeRaf.current = 0;
    const d = drag.current, l = last.current;
    if (!d || d.kind === "pan" || d.kind === "orbit" || (d.kind !== "ext" && !d.moved) || !l) return;
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
      if (p0) pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, ang: Math.atan2(b.y - a.y, b.x - a.x), my, mx0: mx, my0: my, p0 };
    };

    /** Orbita alrededor del centro de la vista. */
    const orbit = (dAz: number, dEl: number) => {
      const v = view.current;
      v.az += dAz;
      v.el += dEl;
      clampView();
      v.azGoal = v.az;
      v.elGoal = v.el;
      applyCamera();
      invalidate();
    };

    /** Toque en modo dibujo: cerca del primer punto cierra la forma; si no, agrega un vértice. */
    const drawTap = (cx: number, cy: number) => {
      const st = P(), pts = st.drawMode?.pts ?? [];
      if (pts.length >= 3) {
        const f = toScreen([pts[0]![0], pts[0]![1], 0]);
        if (Math.hypot(f.x - cx, f.y - cy) < 22) { st.drawFinish(); return; }
      }
      const g = ground(cx, cy);
      if (!g) return;
      const hx = TABLE.w / 2, hy = TABLE.d / 2;
      st.drawAdd(Math.min(hx, Math.max(-hx, Math.round(g.x / 5) * 5)), Math.min(hy, Math.max(-hy, Math.round(g.y / 5) * 5)));
    };

    const down = (e: PointerEvent) => {
      if (e.button === 2) {
        try { el.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
        drag.current = { kind: "orbit", pid: e.pointerId, lx: e.clientX, ly: e.clientY };
        return;
      }
      if (e.button > 0) return;
      try { el.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.current.size === 2) return startPinch();
      if (ptrs.current.size > 2) return;
      last.current = { x: e.clientX, y: e.clientY };
      if (e.pointerType === "mouse" && e.shiftKey) {
        drag.current = { kind: "orbit", pid: e.pointerId, lx: e.clientX, ly: e.clientY };
        return;
      }
      let hit = hitAny(e.clientX, e.clientY);
      // Durante la simulación no se edita: tocar solo selecciona (para ver lecturas o accionar).
      if (useUI.getState().running && hit && hit.kind !== "cable" && hit.kind !== "belt") {
        const id = hit.kind === "term" ? hit.ref.part : hit.kind === "end" || hit.kind === "bend" || hit.kind === "joint" || hit.kind === "part" ? hit.id : null;
        hit = id !== null ? { kind: "cable", id } : null;
      }
      const g = ground(e.clientX, e.clientY);
      const base = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
      const st = P();
      // Dibujando: tocar la mesa pone un vértice (arrastrar sigue moviendo la vista).
      if (st.drawMode) {
        if (g) drag.current = { kind: "pan", ...base, p0: g, tapCable: null };
        return;
      }
      const sp = st.selected !== null ? st.project.parts.find((q) => q.id === st.selected) : undefined;
      if ((hit?.kind === "vtx" || hit?.kind === "edge") && sp) {
        if (hit.kind === "vtx") drag.current = { kind: "vtx", ...base, id: sp.id, i: hit.i };
        else {
          const l0 = localOnTop(e.clientX, e.clientY, sp);
          if (l0) drag.current = { kind: "edge", ...base, id: sp.id, i: hit.i, l0, base: parseShape(sp.props.shape) };
        }
        return;
      }
      // En Editar forma, arrastrar el cuerpo de la pieza mueve la vista (no la pieza).
      if (hit?.kind === "part" && sp && hit.id === sp.id && sp.type === "custom" && st.shapeMode === "edit" && g) {
        drag.current = { kind: "pan", ...base, p0: g, tapCable: sp.id };
        return;
      }
      const selCable = hit?.kind === "cable" && st.selected === hit.id ? st.project.cables.find((q) => q.id === hit.id) : undefined;
      if (hit?.kind === "end") {
        const c = st.project.cables.find((q) => q.id === hit.id)!;
        drag.current = { kind: "end", ...base, id: hit.id, i: hit.i, before: shapeOf(c) };
      } else if (hit?.kind === "bend" || (selCable && st.cableMode === "bend")) {
        const id = hit!.kind === "bend" || hit!.kind === "cable" ? hit!.id : -1;
        const c = st.project.cables.find((q) => q.id === id)!;
        drag.current = { kind: "bend", ...base, id, before: shapeOf(c), h: cableMid(st.project, c)[2], onHandle: hit?.kind === "bend" };
      } else if (selCable && g) {
        drag.current = { kind: "cmove", ...base, id: selCable.id, before: shapeOf(selCable), p0: g };
      } else if (hit?.kind === "term") {
        drag.current = { kind: "term", ...base, ref: hit.ref, wire: null };
      } else if (hit?.kind === "part" && g) {
        const p = P().project.parts.find((q) => q.id === hit.id)!;
        drag.current = { kind: "part", ...base, id: hit.id, off: { x: p.x - g.x, y: p.y - g.y }, from: { x: p.x, y: p.y } };
      } else if (g) {
        drag.current = { kind: "pan", ...base, p0: g, tapCable: hit?.kind === "cable" || hit?.kind === "belt" || hit?.kind === "joint" ? hit.id : null };
      }
    };

    const move = (e: PointerEvent) => {
      if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pc = pinch.current;
      if (pc) {
        const [a, b] = [...ptrs.current.values()];
        if (!a || !b) return;
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const my = (a.y + b.y) / 2;
        let dAng = ang - pc.ang;
        if (dAng > Math.PI) dAng -= 2 * Math.PI;
        if (dAng < -Math.PI) dAng += 2 * Math.PI;
        orbit(dAng, (my - pc.my) * TILT_PX);
        view.current.zoom *= dist / pc.d;
        clampView();
        keepUnder(pc.p0, pc.mx0, pc.my0);
        pc.d = dist;
        pc.ang = ang;
        pc.my = my;
        invalidate();
        return;
      }
      const d = drag.current;
      if (!d || d.kind === "ext" || d.pid !== e.pointerId) return;
      if (d.kind === "orbit") {
        orbit(-(e.clientX - d.lx) * ORBIT_PX, (e.clientY - d.ly) * TILT_PX);
        d.lx = e.clientX;
        d.ly = e.clientY;
        return;
      }
      last.current = { x: e.clientX, y: e.clientY };
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) {
        d.moved = true;
        if (d.kind === "part") P().beginDrag(d.id);
        if (d.kind === "term") d.wire = P().startWire(d.ref);
        if (d.kind === "end" || d.kind === "cmove" || d.kind === "bend") P().beginEndDrag(d.id);
        if (d.kind === "vtx" || d.kind === "edge") P().beginShape(d.id);
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
      if (d.kind === "orbit") return;
      const cancel = e.type === "pointercancel";
      if (d.kind === "vtx" || d.kind === "edge") {
        if (d.moved) P().endShape(d.id);
        else if (!cancel) {
          if (d.kind === "vtx") P().selectVertex(P().selVertex === d.i ? null : d.i);
          else P().insertVertex(d.id, d.i);
        }
        return;
      }
      if (d.kind === "pan") {
        if (!d.moved && !cancel && P().drawMode) {
          drawTap(e.clientX, e.clientY);
        } else if (!d.moved && !cancel) {
          if (d.tapCable !== null) P().select(d.tapCable);
          else { P().select(null); P().cancelPending(); }
        }
      } else if (d.kind === "term") {
        if (!d.moved) { if (!cancel) P().tapTerminal(d.ref); }
        else if (d.wire !== null) {
          const c = P().project.cables.find((q) => q.id === d.wire);
          const back = c?.ends[1].att && c.ends[1].att.part === d.ref.part && c.ends[1].att.t === d.ref.t;
          if (cancel || back) P().dropTemp(d.wire);
          else P().commitTemp(d.wire);
        }
      } else if (d.kind === "end" || d.kind === "cmove" || d.kind === "bend") {
        if (d.moved) P().endEndDrag(d.id, d.before);
        else if (!cancel && d.kind === "bend" && d.onHandle) {
          // Doble toque en el punto de doblez: cable recto otra vez.
          const now = performance.now();
          if (lastTap.current.id === -d.id && now - lastTap.current.t < 350) {
            lastTap.current = { id: 0, t: 0 };
            P().straighten(d.id);
          } else lastTap.current = { id: -d.id, t: now };
        } else if (!cancel) P().select(d.id);
      } else if (d.moved) {
        P().endDrag(d.id, d.from);
      } else if (!cancel) {
        const now = performance.now();
        if (P().jointTool) {
          // El punto tocado sobre la pieza (su cara), para elegir el agujero de esa cara.
          const hp = partPoint(e.clientX, e.clientY);
          const g2 = ground(e.clientX, e.clientY);
          P().jointTap(d.id, hp ?? (g2 ? [g2.x, g2.y, g2.z] : [0, 0, 0]));
        } else if (P().beltMode) {
          P().beltTap(d.id);
        } else if (P().glueMode) {
          P().glueTap(d.id);
        } else if (P().drillMode) {
          const hp = partPoint(e.clientX, e.clientY);
          if (hp) P().drillTap(d.id, hp);
        } else if (lastTap.current.id === d.id && now - lastTap.current.t < 350) {
          lastTap.current = { id: 0, t: 0 };
          P().rotate(d.id);
        } else {
          lastTap.current = { id: d.id, t: now };
          P().select(d.id);
        }
      }
    };

    // Trackpad o rueda del mouse:
    // - pellizco del trackpad (llega con ctrlKey) = zoom
    // - dos dedos = desplazar; con Mayús = orbitar (horizontal) e inclinar (vertical)
    // - rueda del mouse = zoom, como antes
    let padUntil = 0;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
        return;
      }
      // Un trackpad manda desplazamientos en píxeles, finos y a veces en X; la rueda, saltos grandes.
      const now = performance.now();
      const fine = e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40);
      if (fine) padUntil = now + 400;
      const pad = fine || now < padUntil;
      if (!pad) {
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
        return;
      }
      if (e.shiftKey) {
        // Con Mayús algunos navegadores pasan el desplazamiento vertical a X: se usa el mayor.
        const dx = e.deltaX, dy = e.deltaY;
        orbit(-dx * ORBIT_PX * 0.6, dy * TILT_PX * 0.6);
        return;
      }
      const a = ground(e.clientX, e.clientY), b = ground(e.clientX + e.deltaX, e.clientY + e.deltaY);
      if (!a || !b) return;
      view.current.tx += b.x - a.x;
      view.current.ty += b.y - a.y;
      clampView();
      applyCamera();
      invalidate();
    };

    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    const noMenu = (e: Event) => e.preventDefault();
    el.addEventListener("contextmenu", noMenu);

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
    sceneApi.toScreen = toScreen;
    sceneApi.renderInfo = () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures });
    sceneApi.rotateView = (dir) => {
      const v = view.current;
      // Lleva a la siguiente vista isométrica (45° + múltiplos de 90°).
      const q = Math.PI / 2;
      const k = Math.round((v.azGoal - ISO_AZ) / q);
      v.azGoal = ISO_AZ + (k + dir) * q;
      if (reduced) v.az = v.azGoal;
      invalidate();
    };
    sceneApi.isoView = () => {
      const v = view.current;
      const q = Math.PI / 2;
      v.azGoal = ISO_AZ + Math.round((v.az - ISO_AZ) / q) * q;
      v.elGoal = ISO_EL;
      if (reduced) { v.az = v.azGoal; v.el = v.elGoal; }
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
      el.removeEventListener("contextmenu", noMenu);
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
    for (const [k, g] of [["az", "azGoal"], ["el", "elGoal"]] as const) {
      if (Math.abs(v[k] - v[g]) > 0.002) {
        v[k] += (v[g] - v[k]) * 0.22;
        invalidate();
      } else v[k] = v[g];
    }
    applyCamera();

    // Botones flotantes junto a la pieza o el cable seleccionado.
    const st = useProject.getState();
    const place = (el: HTMLElement | null, at: Vec3 | null, dx: number, dy: number) => {
      if (!el) return;
      if (!at || st.dragging !== null) { el.hidden = true; return; }
      tmp.current.set(at[0], at[1], at[2]).project(cam);
      const x = ((tmp.current.x + 1) / 2) * size.width, y = ((1 - tmp.current.y) / 2) * size.height;
      // Quedan dentro de la mesa visible aunque la pieza esté cerca del borde.
      const w = el.offsetWidth || 100, h = el.offsetHeight || 44;
      const px = Math.min(size.width - w - 8, Math.max(8, x + dx)), py = Math.min(size.height - h - 8, Math.max(8, y + dy));
      el.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
      el.hidden = false;
    };
    const sp = st.project.parts.find((q) => q.id === st.selected);
    place(overlay.partTools, sp ? [sp.x, sp.y, sp.z + extent(sp)[2]] : null, 16, -62);
    const sc = st.project.cables.find((q) => q.id === st.selected);
    place(overlay.cableTools, sc ? cableMid(st.project, sc) : null, -(overlay.cableTools?.offsetWidth ?? 160) / 2, -70);
    const sj = (st.project.joints ?? []).find((q) => q.id === st.selected);
    const jp = sj && jointPoint(st.project, sj);
    place(overlay.jointTools, jp ?? null, -(overlay.jointTools?.offsetWidth ?? 160) / 2, -70);
    place(overlay.offerTools, st.jointOffer ? st.jointOffer.p : null, -(overlay.offerTools?.offsetWidth ?? 200) / 2, 24);
    const sb = (st.project.belts ?? []).find((q) => q.id === st.selected);
    const A = sb && st.mech.axisOf[sb.a], B = sb && st.mech.axisOf[sb.b];
    place(overlay.beltTools, A && B ? [(A.c[0] + B.c[0]) / 2, (A.c[1] + B.c[1]) / 2, (A.c[2] + B.c[2]) / 2] : null, -(overlay.beltTools?.offsetWidth ?? 160) / 2, -70);

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
