// Revisión de estructuras en diseño: juntas imposibles y piezas superpuestas.

import type { Issue } from "../electrical/circuit";
import { ROTORS } from "../mechanical/axes";
import { findItem } from "./catalog";
import { aligned, holeAt } from "./holes";
import { extent, type Joint, type Part, type Project, type Vec3 } from "./project";

/** Zona donde dos piezas se tocan (mín. y máx. por eje), o null si están separadas más de 1 mm. */
function contactBox(a: Part, b: Part): { lo: Vec3; hi: Vec3 } | null {
  const box = (p: Part) => {
    const [ex, ey, ez] = extent(p);
    return [[p.x - ex / 2, p.x + ex / 2], [p.y - ey / 2, p.y + ey / 2], [p.z, p.z + ez]] as const;
  };
  const A = box(a), B = box(b), lo: number[] = [], hi: number[] = [];
  for (let k = 0; k < 3; k++) {
    lo.push(Math.max(A[k]![0], B[k]![0]));
    hi.push(Math.min(A[k]![1], B[k]![1]));
    if (lo[k]! > hi[k]! + 1) return null;
  }
  return { lo: lo as Vec3, hi: hi as Vec3 };
}

/** Centro de la zona donde dos piezas se tocan, o null si están separadas más de 1 mm. */
export function contactSpot(a: Part, b: Part): Vec3 | null {
  const c = contactBox(a, b);
  return c && [(c.lo[0] + c.hi[0]) / 2, (c.lo[1] + c.hi[1]) / 2, (c.lo[2] + c.hi[2]) / 2];
}

/** Dónde se dibuja una junta: su agujero, o el centro del contacto si es pegamento. */
export function jointPoint(project: Pick<Project, "parts">, j: Joint): Vec3 | null {
  if (j.kind === "glue") {
    const a = project.parts.find((p) => p.id === j.a.part), b = project.parts.find((p) => p.id === j.b.part);
    // La gota va en el borde −Y del contacto, que se ve desde la vista inicial (no queda tapada).
    const c = a && b ? contactBox(a, b) : null;
    return c && [(c.lo[0] + c.hi[0]) / 2, Math.min(c.lo[1], c.hi[1]), (c.lo[2] + c.hi[2]) / 2];
  }
  return holeAt(project, j.a)?.p ?? null;
}

export interface StructureCheck {
  issues: Issue[];
  flag: Record<number, "err" | "warn">;
  /** Juntas cuyos agujeros ya no coinciden. */
  broken: Set<number>;
}

const name = (p: Part) => {
  const it = findItem(p.type);
  return it ? `${it.name}${it.variant ? ` ${it.variant}` : ""}` : "una pieza";
};

export function checkStructure(project: Project): StructureCheck {
  const issues: Issue[] = [];
  const flag: Record<number, "err" | "warn"> = {};
  const broken = new Set<number>();
  const unglued: number[] = [];
  for (const j of project.joints ?? []) {
    if (j.kind === "glue") {
      if (!jointPoint(project, j)) { broken.add(j.id); unglued.push(j.id); }
      continue;
    }
    const a = holeAt(project, j.a), b = holeAt(project, j.b);
    if (!a || !b || !aligned(a, b)) broken.add(j.id);
  }
  if (unglued.length) {
    issues.push({ s: "warn", h: "Pegamento sin contacto", t: "Un pegamento une piezas que ya no se tocan, así que no las sostiene. Vuelve a juntarlas o elimina el pegamento.", ids: unglued });
  }
  if (broken.size > unglued.length) {
    const holes = broken.size - unglued.length;
    issues.push({ s: "warn", h: "Junta imposible", t: holes > 1 ? `${holes} juntas unen agujeros que ya no coinciden. Vuelve a alinear las piezas o elimina esas juntas.` : "Una junta une agujeros que ya no coinciden, porque una pieza se movió o cambió de tamaño. Vuelve a alinearla o elimina la junta.", ids: [...broken].filter((id) => !unglued.includes(id)) });
  }
  broken.forEach((id) => { flag[id] = "warn"; });

  // Piezas que se atraviesan (no cuentan las que solo se tocan, ni engranajes y poleas, que van en ejes).
  const solid = project.parts.filter((p) => !ROTORS[p.type]);
  const over: [Part, Part][] = [];
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const A = solid[i]!, B = solid[j]!;
    const [ax, ay, az] = extent(A), [bx, by, bz] = extent(B);
    const ox = (ax + bx) / 2 - Math.abs(A.x - B.x), oy = (ay + by) / 2 - Math.abs(A.y - B.y);
    const oz = Math.min(A.z + az, B.z + bz) - Math.max(A.z, B.z);
    if (ox > 1 && oy > 1 && oz > 1) over.push([A, B]);
  }
  if (over.length) {
    const [A, B] = over[0]!;
    issues.push({ s: "warn", h: "Piezas superpuestas", t: over.length > 1 ? `${over.length} pares de piezas se atraviesan. Al simular se empujarían entre sí: sepáralas o apóyalas una sobre otra.` : `${name(A)} y ${name(B).toLowerCase()} se atraviesan. Al simular se empujarían entre sí: sepáralas o apoya una sobre la otra.`, ids: over.flat().map((p) => p.id) });
    over.flat().forEach((p) => { if (!flag[p.id]) flag[p.id] = "warn"; });
  }
  return { issues, flag, broken };
}
