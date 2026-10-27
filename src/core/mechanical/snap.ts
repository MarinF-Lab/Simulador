// Imán mecánico al arrastrar engranajes y poleas:
// 1. sobre el eje de un motor (la pieza se orienta sola),
// 2. sobre el eje de otra pieza (apilada o deslizando por un eje),
// 3. engranando a la distancia exacta con otro engranaje.

import { extent, type Part, type Project, type Vec3 } from "../model/project";
import { add, isRotor, motorAxis, mul, ROTORS, rotorAxis, sub, dot, len, type Axis, type V } from "./axes";

const TOL = 16; // mm en el piso

/** Cuartos de vuelta que dejan el eje local de la pieza a lo largo de `a`. */
function rotFor(type: string, a: V): Vec3 {
  const local = ROTORS[type]?.local ?? "z";
  const ax = Math.abs(a[0]) > 0.9 ? "x" : Math.abs(a[1]) > 0.9 ? "y" : "z";
  if (local === "z") return ax === "z" ? [0, 0, 0] : ax === "x" ? [0, 1, 0] : [1, 0, 0];
  return ax === "x" ? [0, 0, 0] : ax === "y" ? [0, 0, 1] : [0, 1, 0];
}

export interface Snap {
  x: number;
  y: number;
  z: number;
  rot: Vec3;
}

/** Ubica la pieza con su centro en `c`; null si quedaría bajo la mesa. */
function at(part: Part, rot: Vec3, c: V): Snap | null {
  const ez = extent({ type: part.type, rot, props: part.props })[2];
  const z = Math.round((c[2] - ez / 2) * 10) / 10;
  if (z < -0.01) return null;
  return { x: Math.round(c[0] * 10) / 10, y: Math.round(c[1] * 10) / 10, z: Math.max(0, z), rot };
}

const planar = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function snapRotor(project: Project, part: Part, x: number, y: number, tol = TOL): Snap | null {
  if (!isRotor(part.type)) return null;
  const me = ROTORS[part.type]!;
  // Largo real a lo largo del eje (un eje puede estar acortado).
  const meT = rotorAxis(part)?.t ?? me.t;
  const others = project.parts.filter((p) => p.id !== part.id);
  let best: { s: Snap; d: number } | null = null;
  const offer = (s: Snap | null, d: number) => { if (s && d < tol && (!best || d < best.d)) best = { s, d }; };

  for (const o of others) {
    // 1. Eje de motor
    const m = motorAxis(o);
    if (m && me.local === "z") {
      offer(at(part, rotFor(part.type, m.a), m.c), planar([x, y, 0], m.c));
      continue;
    }
    const A = rotorAxis(o);
    if (!A) continue;
    const rot = rotFor(part.type, A.a);
    const vertical = Math.abs(A.a[2]) > 0.9;
    // 2. Mismo eje
    if (o.type === "shaft") {
      // Desliza a lo largo del eje, a la altura del dedo proyectada.
      const t = Math.max(-A.t / 2, Math.min(A.t / 2, dot(sub([x, y, A.c[2]], A.c), A.a)));
      const c = add(A.c, mul(A.a, Math.round(t / 2) * 2));
      offer(at(part, rot, c), vertical ? planar([x, y, 0], A.c) : len(sub([x, y, A.c[2]], c)));
    } else if (part.type === "shaft") {
      // Un eje atraviesa el engranaje o la polea: centrado en ella y, si sobra hacia abajo, apoyado en la mesa.
      const c: V = [...A.c];
      if (vertical) c[2] = Math.max(c[2], meT / 2);
      offer(at(part, rot, c), planar([x, y, 0], A.c));
    } else if (vertical) {
      // Apilada encima de la otra pieza.
      const c: V = [A.c[0], A.c[1], o.z + extent(o)[2] + meT / 2];
      offer(at(part, rot, c), planar([x, y, 0], A.c));
    } else {
      const side = dot(sub([x, y, A.c[2]], A.c), A.a) >= 0 ? 1 : -1;
      const c = add(A.c, mul(A.a, side * (A.t / 2 + meT / 2)));
      offer(at(part, rot, c), planar([x, y, 0], c));
    }
    // 3. Engranar
    if (me.gear && ROTORS[o.type]?.gear) {
      const s = A.r + me.r;
      const p: V = [x, y, A.c[2]];
      const w0 = sub(p, A.c);
      const w = sub(w0, mul(A.a, dot(w0, A.a)));
      const wl = len(w);
      if (wl > 1) {
        const c = add(A.c, mul(w, s / wl));
        offer(at(part, rot, c), Math.abs(wl - s));
      }
    }
  }
  return best ? (best as { s: Snap }).s : null;
}

export type { Axis };
