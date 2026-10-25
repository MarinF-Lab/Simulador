// Bornes de las piezas eléctricas. El borne 0 es el − y el borne 1 es el +.
// Posiciones locales en mm, medidas desde el centro de la caja de la pieza sin girar.

import { extent, rotateLocal, type Cable, type CableEnd, type Part, type Project, type Vec3 } from "./project";

export const TERMINALS: Record<string, [Vec3, Vec3]> = {
  source: [[-15, 9, 19], [10, 9, 19]],
  resistor: [[-20, 0, 0], [20, 0, 0]],
  lamp: [[-13, 0, -20], [13, 0, -20]],
  led: [[-7, 0, -11], [7, 0, -11]],
  switch: [[-20, 0, -5], [20, 0, -5]],
  meter: [[-10, -10, -20], [10, -10, -20]],
  dcmotor: [[-24, -7, 15], [-24, 7, 15]],
  sensorContact: [[-10, 0, -3], [10, 0, -3]],
};

/** Piezas con polaridad: su borne + se marca en rojo. */
export const POLAR = new Set(["source", "led", "dcmotor", "meter"]);

export const hasTerminals = (type: string): boolean => type in TERMINALS;

/** Posición de un borne en la mesa. */
export function termWorld(part: Part, t: number): Vec3 {
  const local = TERMINALS[part.type]?.[t];
  if (!local) return [part.x, part.y, part.z];
  const [dx, dy, dz] = rotateLocal(local, part.rot);
  const ez = extent(part)[2];
  return [part.x + dx, part.y + dy, part.z + ez / 2 + dz];
}

/** Clave de posición: lo que comparte clave queda conectado. */
export const posKey = (p: Vec3): string => p.map((v) => Math.round(v * 10) / 10).join(",");

/** Posición de una punta de cable (sigue a su borne si está pegada). */
export function endPos(project: Pick<Project, "parts">, e: CableEnd): Vec3 {
  if (e.att) {
    const part = project.parts.find((p) => p.id === e.att!.part);
    if (part) return termWorld(part, e.att.t);
  }
  return [e.x, e.y, e.z];
}

/** Busca el borne que está exactamente en una posición. */
export function termAt(project: Pick<Project, "parts">, p: Vec3): { part: number; t: number } | null {
  const k = posKey(p);
  for (const part of project.parts) {
    const n = TERMINALS[part.type]?.length ?? 0;
    for (let t = 0; t < n; t++) if (posKey(termWorld(part, t)) === k) return { part: part.id, t };
  }
  return null;
}

/** Suelta las puntas pegadas a una pieza, dejándolas en su posición actual. */
export function detachFrom(project: Project, partId: number): Cable[] {
  return project.cables.map((c) => {
    if (!c.ends.some((e) => e.att?.part === partId)) return c;
    const ends = c.ends.map((e) => {
      if (e.att?.part !== partId) return e;
      const [x, y, z] = endPos(project, e);
      return { att: null, x, y, z };
    }) as Cable["ends"];
    return { ...c, ends };
  });
}

/** Pega a un borne las puntas sueltas que quedaron justo encima de él. */
export function reattach(project: Project): Cable[] {
  return project.cables.map((c) => {
    if (c.ends.every((e) => e.att)) return c;
    const ends = c.ends.map((e) => (e.att ? e : { ...e, att: termAt(project, [e.x, e.y, e.z]) })) as Cable["ends"];
    return { ...c, ends };
  });
}
