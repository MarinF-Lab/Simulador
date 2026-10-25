// Ejes de giro de las piezas mecánicas y de los motores, en coordenadas de la mesa.

import { extent, rotateLocal, sizeOf, type Part, type Vec3 } from "../model/project";

export type V = Vec3;
export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);
export const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Datos de giro de una pieza: radio primitivo (engrane o correa) y grosor a lo largo del eje. */
export const ROTORS: Record<string, { r: number; t: number; local: "x" | "z"; gear?: boolean; pulley?: boolean }> = {
  gear10: { r: 10, t: 8, local: "z", gear: true },
  gear20: { r: 20, t: 8, local: "z", gear: true },
  gear40: { r: 40, t: 8, local: "z", gear: true },
  pulleyS: { r: 7, t: 12, local: "z", pulley: true },
  pulleyM: { r: 15, t: 12, local: "z", pulley: true },
  pulleyL: { r: 25, t: 12, local: "z", pulley: true },
  shaft: { r: 4, t: 120, local: "x" },
};

/** Eje de salida de los motores: centro local del tramo de eje, dirección local y largo. */
export const MOTOR_SHAFT: Record<string, { c: V; dir: V; t: number }> = {
  dcmotor: { c: [25, 0, 0], dir: [1, 0, 0], t: 10 },
};

export const isRotor = (type: string): boolean => type in ROTORS;
export const isMotor = (type: string): boolean => type in MOTOR_SHAFT;

/** Centro de la caja de la pieza en la mesa. */
export function centerOf(p: Part): V {
  return [p.x, p.y, p.z + extent(p)[2] / 2];
}

export interface Axis {
  id: number;
  /** Punto del eje (centro de la pieza o del tramo de eje del motor). */
  c: V;
  /** Dirección unitaria. */
  a: V;
  /** Largo a lo largo del eje. */
  t: number;
  r: number;
}

export function rotorAxis(p: Part): Axis | null {
  const spec = ROTORS[p.type];
  if (!spec) return null;
  const a = rotateLocal(spec.local === "z" ? [0, 0, 1] : [1, 0, 0], p.rot);
  // El eje tiene largo editable.
  const t = p.type === "shaft" ? sizeOf(p.type, p.props)[0] : spec.t;
  return { id: p.id, c: centerOf(p), a, t, r: spec.r };
}

export function motorAxis(p: Part): Axis | null {
  const spec = MOTOR_SHAFT[p.type];
  if (!spec) return null;
  return { id: p.id, c: add(centerOf(p), rotateLocal(spec.c, p.rot)), a: rotateLocal(spec.dir, p.rot), t: spec.t, r: 2 };
}

export const parallel = (a: V, b: V): boolean => len(cross(a, b)) < 0.01;

/** Distancia entre dos ejes paralelos, separada en radial (entre las líneas) y axial (a lo largo). */
export function separation(A: Axis, B: Axis): { radial: number; axial: number } {
  const d = sub(B.c, A.c);
  const axial = dot(d, A.a);
  const radial = len(sub(d, mul(A.a, axial)));
  return { radial, axial: Math.abs(axial) };
}

/** Dos ejes paralelos son el mismo eje si las líneas coinciden y las piezas se tocan a lo largo. */
export function coaxial(A: Axis, B: Axis): boolean {
  if (!parallel(A.a, B.a)) return false;
  const { radial, axial } = separation(A, B);
  return radial < 1 && axial <= (A.t + B.t) / 2 + 2;
}
