// Revisión de estructuras en diseño: juntas imposibles y piezas superpuestas.

import type { Issue } from "../electrical/circuit";
import { ROTORS } from "../mechanical/axes";
import { findItem } from "./catalog";
import { aligned, holeAt } from "./holes";
import { extent, type Part, type Project } from "./project";

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
  for (const j of project.joints ?? []) {
    const a = holeAt(project, j.a), b = holeAt(project, j.b);
    if (!a || !b || !aligned(a, b)) broken.add(j.id);
  }
  if (broken.size) {
    issues.push({ s: "warn", h: "Junta imposible", t: broken.size > 1 ? `${broken.size} juntas unen agujeros que ya no coinciden. Vuelve a alinear las piezas o elimina esas juntas.` : "Una junta une agujeros que ya no coinciden, porque una pieza se movió o cambió de tamaño. Vuelve a alinearla o elimina la junta.", ids: [...broken] });
    broken.forEach((id) => { flag[id] = "warn"; });
  }

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
