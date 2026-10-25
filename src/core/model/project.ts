// Modelo de la mesa: piezas, tamaños, ajuste a la cuadrícula y espacio libre.
// Unidades en mm. El piso es el plano XY y Z es la altura.

import { GRID_MM, snap } from "./units";

export type PropValue = number | string | boolean;
export type Axis = "x" | "y" | "z";
/** Vector de 3 números: x, y, z. */
export type Vec3 = [number, number, number];

export interface Part {
  id: number;
  /** id del catálogo, por ejemplo "gear40". */
  type: string;
  /** Centro de la pieza en el piso (mm). */
  x: number;
  y: number;
  /** Altura de la base de la pieza sobre la mesa (mm). */
  z: number;
  /** Cuartos de vuelta sobre X, Y y Z (0 a 3). */
  rot: Vec3;
  props: Record<string, PropValue>;
}

/** Punta de un cable: pegada a un borne de una pieza, o suelta en una posición. */
export interface CableEnd {
  att: { part: number; t: number } | null;
  x: number;
  y: number;
  z: number;
}

export interface Cable {
  id: number;
  ends: [CableEnd, CableEnd];
}

export interface Project {
  parts: Part[];
  cables: Cable[];
  /** Contador compartido: piezas y cables nunca repiten id. */
  nextId: number;
}

/** Mesa de 1200 × 800 mm centrada en el origen. */
export const TABLE = { w: 1200, d: 800, maxZ: 400 };

/** Tamaño de cada pieza sin girar: largo (X), ancho (Y) y alto (Z), en mm. */
export const SIZES: Record<string, Vec3> = {
  source: [60, 30, 30], resistor: [40, 10, 10], lamp: [30, 30, 46], led: [20, 10, 22],
  switch: [40, 20, 20], wire: [80, 10, 20], hbridge: [50, 40, 14],
  dcmotor: [60, 30, 30], stepper: [42, 42, 50], servo: [40, 20, 40], linear: [120, 24, 24],
  shaft: [120, 8, 8], gear10: [24, 24, 8], gear20: [44, 44, 8], gear40: [84, 84, 8],
  pulleyS: [20, 20, 12], pulleyM: [36, 36, 12], pulleyL: [56, 56, 12], belt: [100, 40, 6],
  bearing: [22, 22, 8], support: [40, 20, 40], link: [100, 14, 6], joint: [30, 20, 20],
  profile60: [60, 10, 10], profile120: [120, 10, 10], profile240: [240, 10, 10],
  plate: [160, 100, 6], bolt: [10, 10, 20],
  sensorAngle: [20, 20, 14], sensorContact: [20, 20, 14], meter: [40, 20, 50], text: [60, 4, 30],
};

export const sizeOf = (type: string): Vec3 => SIZES[type] ?? [40, 40, 20];

/** Gira un vector un cuarto de vuelta (sentido antihorario) sobre un eje. */
function quarter(v: Vec3, axis: Axis): Vec3 {
  const [x, y, z] = v;
  if (axis === "x") return [x, -z, y];
  if (axis === "y") return [z, y, -x];
  return [-y, x, z];
}

/** Gira un vector local según los cuartos de vuelta de la pieza (Euler XYZ de Three.js: Z, luego Y, luego X). */
export function rotateLocal(v: Vec3, rot: Vec3): Vec3 {
  let out: Vec3 = [...v];
  const order: [Axis, number][] = [["z", rot[2]], ["y", rot[1]], ["x", rot[0]]];
  for (const [axis, n] of order) for (let i = 0; i < ((n % 4) + 4) % 4; i++) out = quarter(out, axis);
  return out;
}

/** Tamaño de la caja que ocupa la pieza ya girada. */
export function extent(part: Pick<Part, "type" | "rot">): Vec3 {
  const [sx, sy, sz] = sizeOf(part.type);
  const ax = rotateLocal([sx, 0, 0], part.rot), ay = rotateLocal([0, sy, 0], part.rot), az = rotateLocal([0, 0, sz], part.rot);
  const sum = (k: number) => Math.abs(ax[k]!) + Math.abs(ay[k]!) + Math.abs(az[k]!);
  return [sum(0), sum(1), sum(2)];
}

/** Ajusta a la cuadrícula sin salir de [-h, h]. */
function fit(v: number, h: number): number {
  if (h <= 0) return 0;
  let s = snap(Math.min(h, Math.max(-h, v)));
  if (s > h) s -= GRID_MM;
  if (s < -h) s += GRID_MM;
  return s;
}

/** Ajusta el centro a la cuadrícula y lo mantiene dentro de la mesa. */
export function placeOnTable(part: Pick<Part, "type" | "rot">, x: number, y: number): { x: number; y: number } {
  const [ex, ey] = extent(part);
  return { x: fit(x, TABLE.w / 2 - ex / 2), y: fit(y, TABLE.d / 2 - ey / 2) };
}

export const clampZ = (z: number): number => Math.min(TABLE.maxZ, Math.max(0, snap(z)));

interface Box { x0: number; x1: number; y0: number; y1: number }
function boxOf(part: Part, x = part.x, y = part.y): Box {
  const [ex, ey] = extent(part);
  return { x0: x - ex / 2, x1: x + ex / 2, y0: y - ey / 2, y1: y + ey / 2 };
}
const overlaps = (a: Box, b: Box, gap: number) =>
  a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/**
 * Busca el lugar libre más cercano a (cx, cy) para la pieza, recorriendo anillos
 * cada 20 mm. Si la mesa está llena, devuelve el punto pedido ajustado.
 */
export function findFree(part: Part, others: Part[], cx: number, cy: number, gap = 10): { x: number; y: number } {
  const step = 20;
  for (let r = 0; r <= 600; r += step) {
    const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / step);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      const p = placeOnTable(part, cx + r * Math.cos(a), cy + r * Math.sin(a));
      const b = boxOf(part, p.x, p.y);
      if (others.every((o) => o.id === part.id || !overlaps(b, boxOf(o), gap))) return p;
    }
  }
  return placeOnTable(part, cx, cy);
}

export function newPart(project: Project, type: string, x = 0, y = 0): Part {
  return { id: project.nextId, type, x, y, z: 0, rot: [0, 0, 0], props: {} };
}

/** Caja que encierra todas las piezas (para "Ajustar"). */
export function bounds(parts: Part[]): { min: Vec3; max: Vec3 } | null {
  if (!parts.length) return null;
  const min: Vec3 = [Infinity, Infinity, 0], max: Vec3 = [-Infinity, -Infinity, 0];
  for (const p of parts) {
    const [ex, ey, ez] = extent(p);
    min[0] = Math.min(min[0], p.x - ex / 2); max[0] = Math.max(max[0], p.x + ex / 2);
    min[1] = Math.min(min[1], p.y - ey / 2); max[1] = Math.max(max[1], p.y + ey / 2);
    max[2] = Math.max(max[2], p.z + ez);
  }
  return { min, max };
}
