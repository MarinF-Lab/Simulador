// Volumen real de las piezas para el diseño: choques al arrastrar, apoyo y contacto del pegamento.
// Cada pieza es una o más partes convexas (prismas) en mm de la mesa; dos partes se comparan con
// ejes separadores (SAT). Así una pieza en L o un engranaje redondo ocupan lo que se ve, no su caja.

import { isMotor, isRotor } from "../mechanical/axes";
import { parseShape, regular, triangulate, type Pt } from "./polygon";
import { extent, rotateLocal, sizeOf, type Part, type Project, type Vec3 } from "./project";

export interface Hull {
  v: Vec3[];
  /** Normales de las caras. */
  axes: Vec3[];
  /** Direcciones de las aristas. */
  edges: Vec3[];
  lo: Vec3;
  hi: Vec3;
}

/** Cuánto pueden entrar dos piezas una en otra sin contar como choque (redondeo a 0,1 mm). */
export const TOL = 0.2;
/** Hasta esta distancia dos piezas se tocan (para el pegamento). */
export const TOUCH = 1;

type Local = Omit<Hull, "lo" | "hi">;
type Pos = { x: number; y: number; z: number };

const norm = (a: Vec3): Vec3 | null => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l < 1e-9 ? null : [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function addDir(list: Vec3[], d: Vec3 | null) {
  if (d && !list.some((u) => Math.abs(dot(u, d)) > 0.9999)) list.push(d);
}

/** Prisma: polígono convexo del plano XY local, de z0 a z1, girado con la pieza. */
function prism(poly: Pt[], z0: number, z1: number, rot: Vec3): Local {
  const v: Vec3[] = [], axes: Vec3[] = [], edges: Vec3[] = [];
  for (const [x, y] of poly) for (const z of [z0, z1]) v.push(rotateLocal([x, y, z], rot));
  const up = rotateLocal([0, 0, 1], rot);
  addDir(axes, up);
  addDir(edges, up);
  poly.forEach(([x0, y0], i) => {
    const [x1, y1] = poly[(i + 1) % poly.length]!;
    addDir(edges, norm(rotateLocal([x1 - x0, y1 - y0, 0], rot)));
    addDir(axes, norm(rotateLocal([y1 - y0, -(x1 - x0), 0], rot)));
  });
  return { v, axes, edges };
}

const rect = (hx: number, hy: number, cx = 0, cy = 0): Pt[] => [[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy]];

const ROUND = new Set(["wheel", "bearing", "gear10", "gear20", "gear40", "pulleyS", "pulleyM", "pulleyL"]);

/** Partes convexas de la pieza, centradas en su centro y ya giradas. */
function localSolids(part: Pick<Part, "type" | "rot" | "props">): Local[] {
  const [sx, sy, sz] = sizeOf(part.type, part.props);
  const r = part.rot;
  if (part.type === "text") return [];
  if (ROUND.has(part.type)) return [prism(regular(12, sx / 2), -sz / 2, sz / 2, r)];
  switch (part.type) {
    // El cilindro del pistón queda 6 mm bajo el perno (igual que en la simulación).
    case "piston":
      return [prism(rect(sx / 2, sy / 2), -sz / 2, sz / 2 - 6, r)];
    case "bracket":
      return [prism(rect(sx / 2, sy / 2), -sz / 2, -sz / 2 + 4, r), prism(rect(sx / 2, 2, 0, -sy / 2 + 2), -sz / 2, sz / 2, r)];
    case "custom": {
      const pts = parseShape(part.props.shape);
      const tris = pts.length ? triangulate(pts) : [];
      if (tris.length) return tris.map((t) => prism(t.map((i) => pts[i]!), -sz / 2, sz / 2, r));
      break;
    }
  }
  return [prism(rect(sx / 2, sy / 2), -sz / 2, sz / 2, r)];
}

const cache = new Map<string, Local[]>();
function solidsOf(part: Pick<Part, "type" | "rot" | "props">): Local[] {
  const key = `${part.type}|${part.rot.join()}|${sizeOf(part.type, part.props).join()}|${part.type === "custom" ? String(part.props.shape) : ""}`;
  let hit = cache.get(key);
  if (!hit) {
    if (cache.size > 500) cache.clear();
    hit = localSolids(part);
    cache.set(key, hit);
  }
  return hit;
}

/** Partes convexas de la pieza en la mesa (en su lugar, o en `at`). */
export function hullsOf(part: Part, at?: Pos): Hull[] {
  const p = at ?? part;
  const c: Vec3 = [p.x, p.y, p.z + extent(part)[2] / 2];
  return solidsOf(part).map((s) => {
    const v = s.v.map((q) => [q[0] + c[0], q[1] + c[1], q[2] + c[2]] as Vec3);
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const q of v) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, q[k]!); hi[k] = Math.max(hi[k]!, q[k]!); }
    return { v, axes: s.axes, edges: s.edges, lo, hi };
  });
}

function span(v: Vec3[], d: Vec3): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const q of v) { const s = dot(q, d); if (s < lo) lo = s; if (s > hi) hi = s; }
  return [lo, hi];
}

/**
 * Separación entre dos partes convexas: positiva = hay ese espacio entre ellas (al menos);
 * negativa = se meten una en otra esa profundidad.
 */
export function separation(a: Hull, b: Hull): number {
  let best = -Infinity;
  for (let k = 0; k < 3; k++) best = Math.max(best, b.lo[k]! - a.hi[k]!, a.lo[k]! - b.hi[k]!);
  if (best > TOUCH) return best;
  const test = (d: Vec3) => {
    const [a0, a1] = span(a.v, d), [b0, b1] = span(b.v, d);
    best = Math.max(best, b0 - a1, a0 - b1);
  };
  for (const d of a.axes) test(d);
  for (const d of b.axes) test(d);
  for (const ea of a.edges) for (const eb of b.edges) {
    const d = norm([ea[1] * eb[2] - ea[2] * eb[1], ea[2] * eb[0] - ea[0] * eb[2], ea[0] * eb[1] - ea[1] * eb[0]]);
    if (d) test(d);
  }
  return best;
}

/** Caja que encierra varias partes. */
function bbox(h: Hull[]): [Vec3, Vec3] {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of h) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, x.lo[k]!); hi[k] = Math.max(hi[k]!, x.hi[k]!); }
  return [lo, hi];
}

const boxGap = (a: Hull[], b: Hull[]) => {
  const [alo, ahi] = bbox(a), [blo, bhi] = bbox(b);
  let best = -Infinity;
  for (let k = 0; k < 3; k++) best = Math.max(best, blo[k]! - ahi[k]!, alo[k]! - bhi[k]!);
  return best;
};

/** Separación entre dos piezas (la de sus partes más cercanas). */
export function gapOf(a: Hull[], b: Hull[]): number {
  if (!a.length || !b.length) return Infinity;
  const g = boxGap(a, b);
  if (g > TOUCH) return g;
  let best = Infinity;
  for (const x of a) for (const y of b) best = Math.min(best, separation(x, y));
  return best;
}

/** Pares que pueden atravesarse: un eje pasa por engranajes, soportes y motores; los carteles no chocan. */
export function passes(a: Pick<Part, "type">, b: Pick<Part, "type">): boolean {
  if (a.type === "text" || b.type === "text" || a.type === "shaft" || b.type === "shaft") return true;
  const mount = (t: string) => isRotor(t) || isMotor(t) || t === "bearing" || t === "support";
  return (isRotor(a.type) && mount(b.type)) || (isRotor(b.type) && mount(a.type));
}

/** Zona donde dos piezas se tocan (mín. y máx. por eje), o null si están separadas más de 1 mm. */
export function contactRegion(a: Part, b: Part): { lo: Vec3; hi: Vec3 } | null {
  const A = hullsOf(a), B = hullsOf(b);
  if (!A.length || !B.length || boxGap(A, B) > TOUCH) return null;
  let best: { s: number; x: Hull; y: Hull } | null = null;
  for (const x of A) for (const y of B) {
    const s = separation(x, y);
    if (!best || s < best.s) best = { s, x, y };
  }
  if (!best || best.s > TOUCH) return null;
  const lo: number[] = [], hi: number[] = [];
  for (let k = 0; k < 3; k++) {
    const l = Math.max(best.x.lo[k]!, best.y.lo[k]!), h = Math.min(best.x.hi[k]!, best.y.hi[k]!);
    lo.push(Math.min(l, h));
    hi.push(Math.max(l, h));
  }
  return { lo: lo as Vec3, hi: hi as Vec3 };
}

/** Piezas que chocan con `part` puesta en `at` (sin contar las que pueden atravesarse). */
export function blockers(project: Pick<Project, "parts">, part: Part, at?: Pos): number[] {
  const mine = hullsOf(part, at);
  return project.parts.filter((o) => o.id !== part.id && !passes(part, o) && gapOf(mine, hullsOf(o)) < -TOL).map((o) => o.id);
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Lleva la pieza de `from` a `to` en línea recta y se detiene justo al tocar otra pieza.
 * Las piezas con las que ya chocaba en `from` no la detienen (así puede salir de ellas).
 */
export function sweep(project: Pick<Project, "parts">, part: Part, from: Pos, to: Pos): Pos {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return to;
  const base = hullsOf(part, from);
  const [blo, bhi] = bbox(base);
  const d = [dx, dy, dz];
  // Solo cuentan las piezas cerca del recorrido.
  const near = project.parts.filter((o) => o.id !== part.id && !passes(part, o)).map((o) => hullsOf(o)).filter((h) => {
    if (!h.length) return false;
    const [olo, ohi] = bbox(h);
    for (let k = 0; k < 3; k++) {
      if (olo[k]! > Math.max(bhi[k]!, bhi[k]! + d[k]!) + 1 || ohi[k]! < Math.min(blo[k]!, blo[k]! + d[k]!) - 1) return false;
    }
    return true;
  });
  const shift = (t: number): Hull[] => base.map((h) => {
    const o: Vec3 = [dx * t, dy * t, dz * t];
    return { v: h.v.map((q) => [q[0] + o[0], q[1] + o[1], q[2] + o[2]] as Vec3), axes: h.axes, edges: h.edges, lo: [h.lo[0] + o[0], h.lo[1] + o[1], h.lo[2] + o[2]], hi: [h.hi[0] + o[0], h.hi[1] + o[1], h.hi[2] + o[2]] };
  });
  const others = near.filter((o) => gapOf(base, o) >= -TOL);
  if (!others.length) return to;
  // Se detiene casi sin meterse (0,05 mm), para que al redondear a 0,1 mm siga sin chocar.
  const free = (t: number) => { const m = shift(t); return others.every((o) => gapOf(m, o) >= -0.05); };
  // Pasos de 2,5 mm: ninguna pieza es tan delgada como para saltarla entera.
  const n = Math.ceil(dist / 2.5);
  let ok = 0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (free(t)) { ok = t; continue; }
    let lo = ok, hi = t;
    for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (free(m)) lo = m; else hi = m; }
    return { x: r1(from.x + dx * lo), y: r1(from.y + dy * lo), z: Math.max(0, r1(from.z + dz * lo)) };
  }
  return to;
}

/** Como `sweep`, pero si choca intenta seguir deslizando a lo largo de la otra pieza (en X y en Y). */
export function slide(project: Pick<Project, "parts">, part: Part, from: Pos, to: Pos): Pos {
  const a = sweep(project, part, from, to);
  if (a.x === to.x && a.y === to.y && a.z === to.z) return a;
  const tryOrder = (first: "x" | "y"): Pos => {
    const second = first === "x" ? "y" : "x";
    const b = sweep(project, part, a, { ...a, [first]: to[first] });
    return sweep(project, part, b, { ...b, [second]: to[second] });
  };
  const bx = tryOrder("x"), by = tryOrder("y");
  const d = (p: Pos) => Math.hypot(p.x - to.x, p.y - to.y);
  return d(bx) <= d(by) ? bx : by;
}

/**
 * Altura donde se apoya la pieza en (x, y): la cara de arriba más alta que tenga debajo,
 * sin pasar de `zMax` (lo que esté más arriba no la sostiene). Sin nada debajo, la mesa.
 */
export function restOn(project: Pick<Project, "parts">, part: Part, x: number, y: number, zMax = Infinity): number {
  let top = 0;
  for (const o of project.parts) {
    if (o.id === part.id || o.type === "text" || o.type === "shaft") continue;
    for (const h of hullsOf(o)) {
      const z = h.hi[2];
      if (z > zMax + 0.5 || z <= top) continue;
      // Metida 0,5 mm en esa cara: si la pisa en planta, se meten una en otra.
      if (gapOf(hullsOf(part, { x, y, z: z - 0.5 }), [h]) < -0.3) top = z;
    }
  }
  return r1(top);
}

/**
 * Grupo de piezas que se mueven juntas, rígidas: lleva el desplazamiento de `d0` a `d1` (desde
 * donde están ahora) y se detiene al tocar una pieza de afuera. Las del grupo no chocan entre sí.
 */
export function sweepGroup(project: Pick<Project, "parts">, group: Part[], d0: Pos, d1: Pos): Pos {
  const dx = d1.x - d0.x, dy = d1.y - d0.y, dz = d1.z - d0.z, dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return d1;
  const ids = new Set(group.map((p) => p.id));
  const mem = group.map((p) => ({ p, h: hullsOf(p, { x: p.x + d0.x, y: p.y + d0.y, z: p.z + d0.z }) })).filter((m) => m.h.length);
  if (!mem.length) return d1;
  const [blo, bhi] = bbox(mem.flatMap((m) => m.h));
  const d = [dx, dy, dz];
  const outside = project.parts.filter((o) => !ids.has(o.id)).map((o) => ({ o, h: hullsOf(o) })).filter(({ h }) => {
    if (!h.length) return false;
    const [olo, ohi] = bbox(h);
    for (let k = 0; k < 3; k++) {
      if (olo[k]! > Math.max(bhi[k]!, bhi[k]! + d[k]!) + 1 || ohi[k]! < Math.min(blo[k]!, blo[k]! + d[k]!) - 1) return false;
    }
    return true;
  });
  // Pares que cuentan: los que pueden chocar y no se atravesaban ya al empezar.
  const pairs: [number, Hull[]][] = [];
  mem.forEach((m, i) => { for (const { o, h } of outside) if (!passes(m.p, o) && gapOf(m.h, h) >= -TOL) pairs.push([i, h]); });
  if (!pairs.length) return d1;
  const shift = (hs: Hull[], t: number): Hull[] => hs.map((h) => {
    const o: Vec3 = [dx * t, dy * t, dz * t];
    return { v: h.v.map((q) => [q[0] + o[0], q[1] + o[1], q[2] + o[2]] as Vec3), axes: h.axes, edges: h.edges, lo: [h.lo[0] + o[0], h.lo[1] + o[1], h.lo[2] + o[2]], hi: [h.hi[0] + o[0], h.hi[1] + o[1], h.hi[2] + o[2]] };
  });
  const free = (t: number) => { const moved = mem.map((m) => shift(m.h, t)); return pairs.every(([i, h]) => gapOf(moved[i]!, h) >= -0.05); };
  const n = Math.ceil(dist / 2.5);
  let ok = 0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (free(t)) { ok = t; continue; }
    let lo = ok, hi = t;
    for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (free(m)) lo = m; else hi = m; }
    return { x: r1(d0.x + dx * lo), y: r1(d0.y + dy * lo), z: r1(d0.z + dz * lo) };
  }
  return d1;
}

/** Como `sweepGroup`, pero si choca sigue deslizando el grupo a lo largo de la otra pieza. */
export function slideGroup(project: Pick<Project, "parts">, group: Part[], d1: Pos): Pos {
  const zero = { x: 0, y: 0, z: 0 };
  const a = sweepGroup(project, group, zero, d1);
  if (a.x === d1.x && a.y === d1.y && a.z === d1.z) return a;
  const tryOrder = (first: "x" | "y"): Pos => {
    const second = first === "x" ? "y" : "x";
    const b = sweepGroup(project, group, a, { ...a, [first]: d1[first] });
    return sweepGroup(project, group, b, { ...b, [second]: d1[second] });
  };
  const bx = tryOrder("x"), by = tryOrder("y");
  const dd = (p: Pos) => Math.hypot(p.x - d1.x, p.y - d1.y);
  return dd(bx) <= dd(by) ? bx : by;
}

/** Cuánto puede bajar el grupo hasta que una de sus piezas se apoye en algo de afuera (o en la mesa). */
export function dropGroup(project: Pick<Project, "parts">, group: Part[]): number {
  const ids = new Set(group.map((p) => p.id));
  const others = { parts: project.parts.filter((o) => !ids.has(o.id)) };
  let drop = Infinity;
  for (const p of group) drop = Math.min(drop, p.z - restOn(others, p, p.x, p.y, p.z));
  return Number.isFinite(drop) ? Math.max(0, r1(drop)) : 0;
}
