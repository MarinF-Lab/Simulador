// Trenes de engranajes y poleas, portados del prototipo a 3D.
// - Piezas en el mismo eje giran juntas (y con el motor si están en su eje).
// - Engranajes engranan si sus ejes son paralelos, están en el mismo plano y la distancia
//   entre centros es la suma de sus radios primitivos: relación −r1/r2.
// - Correa normal: +r1/r2; cruzada: −r1/r2.
// - Traba: una cadena que pide dos velocidades distintas para la misma pieza.

import { findItem } from "../model/catalog";
import type { Belt, Part, Project } from "../model/project";
import type { Issue } from "../electrical/circuit";
import { coaxial, motorAxis, parallel, ROTORS, rotorAxis, separation, sub, dot, mul, len, type Axis } from "./axes";

export interface MeshPair { a: number; b: number }

export interface Train {
  /** RPM con signo de cada pieza que gira y de cada motor (+ = antihorario mirando el eje). */
  rpm: Record<number, number>;
  /** Relación con el motor que la mueve: RPM de la pieza / RPM del motor. */
  ratio: Record<number, number>;
  /** Qué sostiene a cada pieza: "motor", "eje", "engrane", "correa" o nada. */
  link: Record<number, string>;
  meshes: MeshPair[];
  issues: Issue[];
  flag: Record<number, "err" | "warn">;
  /** Correas con geometría válida. */
  beltOk: Record<number, boolean>;
  /** Eje de giro de cada pieza (para animarla). */
  axisOf: Record<number, Axis>;
}

interface Edge { to: number; f: number }

/** Geometría de una correa: válida si las poleas son paralelas, coplanares y no están montadas una en otra. */
export function beltValid(A: Axis, B: Axis, cross: boolean): boolean {
  if (!parallel(A.a, B.a)) return false;
  const { radial, axial } = separation(A, B);
  if (axial > 6) return false;
  return cross ? radial > A.r + B.r + 1 : radial > Math.abs(A.r - B.r) + 1 && radial > 1;
}

export function solveTrain(project: Project, motorRpm: Record<number, number>): Train {
  const parts = project.parts;
  const belts: Belt[] = project.belts ?? [];
  const rotors = parts.map(rotorAxis).filter((x): x is Axis => x !== null);
  const motors = parts.map(motorAxis).filter((x): x is Axis => x !== null);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const axisOf: Record<number, Axis> = Object.fromEntries(rotors.map((a) => [a.id, a]));

  // 1. Grupos por eje compartido (unión-búsqueda).
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const unite = (a: number, b: number) => parent.set(find(a), find(b));
  rotors.forEach((r) => parent.set(r.id, r.id));
  const link: Record<number, string> = {};
  // Qué se muestra como unión principal: motor > engrane > correa > eje.
  const RANK: Record<string, number> = { motor: 4, engrane: 3, correa: 2, eje: 1 };
  const setLink = (id: number, kind: string) => { if ((RANK[link[id] ?? ""] ?? 0) < RANK[kind]!) link[id] = kind; };
  for (let i = 0; i < rotors.length; i++) for (let j = i + 1; j < rotors.length; j++) {
    if (coaxial(rotors[i]!, rotors[j]!)) {
      unite(rotors[i]!.id, rotors[j]!.id);
      setLink(rotors[i]!.id, "eje");
      setLink(rotors[j]!.id, "eje");
    }
  }
  // Motores: la pieza en su eje queda en el grupo del motor.
  const motorOf = new Map<number, number[]>(); // raíz del grupo → motores
  const freeMotors: number[] = [];
  for (const m of motors) {
    const on = rotors.filter((r) => coaxial(m, r));
    if (!on.length) { freeMotors.push(m.id); continue; }
    on.forEach((r) => { unite(r.id, on[0]!.id); setLink(r.id, "motor"); });
  }
  for (const m of motors) {
    const on = rotors.find((r) => coaxial(m, r));
    if (!on) continue;
    const root = find(on.id);
    motorOf.set(root, [...(motorOf.get(root) ?? []), m.id]);
  }

  // 2. Engranes y correas: relaciones entre grupos.
  const adj = new Map<number, Edge[]>();
  const edge = (a: number, b: number, f: number) => adj.set(a, [...(adj.get(a) ?? []), { to: b, f }]);
  const meshes: MeshPair[] = [];
  const overlaps = new Set<number>();
  const gears = rotors.filter((r) => ROTORS[byId.get(r.id)!.type]?.gear);
  for (let i = 0; i < gears.length; i++) for (let j = i + 1; j < gears.length; j++) {
    const A = gears[i]!, B = gears[j]!;
    if (find(A.id) === find(B.id) || !parallel(A.a, B.a)) continue;
    const { radial, axial } = separation(A, B);
    if (axial > 4) continue;
    const s = A.r + B.r;
    if (Math.abs(radial - s) < 2) {
      edge(find(A.id), find(B.id), -A.r / B.r);
      edge(find(B.id), find(A.id), -B.r / A.r);
      meshes.push({ a: A.id, b: B.id });
      setLink(A.id, "engrane");
      setLink(B.id, "engrane");
    } else if (radial < s - 2) {
      overlaps.add(A.id);
      overlaps.add(B.id);
    }
  }
  const beltOk: Record<number, boolean> = {};
  for (const b of belts) {
    const A = axisOf[b.a], B = axisOf[b.b];
    const ok = !!A && !!B && find(A.id) !== find(B.id) && beltValid(A, B, b.cross);
    beltOk[b.id] = ok;
    if (!ok || !A || !B) continue;
    const sg = b.cross ? -1 : 1;
    edge(find(A.id), find(B.id), (sg * A.r) / B.r);
    edge(find(B.id), find(A.id), (sg * B.r) / A.r);
    setLink(A.id, "correa");
    setLink(B.id, "correa");
  }

  // 3. Propagar velocidades por cada componente conectado.
  const rpm: Record<number, number> = {};
  const ratio: Record<number, number> = {};
  const flag: Record<number, "err" | "warn"> = {};
  const issues: Issue[] = [];
  const roots = [...new Set(rotors.map((r) => find(r.id)))];
  const members = new Map<number, number[]>();
  for (const r of rotors) members.set(find(r.id), [...(members.get(find(r.id)) ?? []), r.id]);
  const seen = new Set<number>();
  let jams = 0, idle = 0;
  const jammedIds: number[] = [];
  for (const k0 of roots) {
    if (seen.has(k0)) continue;
    const comp = [k0];
    seen.add(k0);
    for (let q = 0; q < comp.length; q++) for (const e of adj.get(comp[q]!) ?? []) if (!seen.has(e.to)) { seen.add(e.to); comp.push(e.to); }
    const rel = new Map<number, number>([[k0, 1]]);
    let jam = false;
    const queue = [k0];
    while (queue.length) {
      const k = queue.shift()!;
      for (const e of adj.get(k) ?? []) {
        const v = rel.get(k)! * e.f;
        if (rel.has(e.to)) { if (Math.abs(rel.get(e.to)! - v) > 0.005 * Math.max(1, Math.abs(v))) jam = true; }
        else { rel.set(e.to, v); queue.push(e.to); }
      }
    }
    const sources = comp.filter((k) => motorOf.has(k));
    const w = new Map<number, number>();
    let drive = 0;
    if (sources.length && !jam) {
      const src = sources[0]!, m0 = motorOf.get(src)![0]!;
      drive = motorRpm[m0] ?? 0;
      const scale = drive / rel.get(src)!;
      comp.forEach((k) => w.set(k, rel.get(k)! * scale));
      for (const k of sources) for (const m of motorOf.get(k)!) {
        const exp = motorRpm[m] ?? 0;
        if (Math.abs(w.get(k)! - exp) > 0.5 + 0.01 * Math.abs(exp)) jam = true;
      }
    } else if (!sources.length && comp.length > 1) idle++;
    for (const k of comp) {
      for (const id of members.get(k) ?? []) {
        rpm[id] = jam ? 0 : (w.get(k) ?? 0);
        if (!jam && sources.length && drive) ratio[id] = w.get(k)! / drive;
        if (jam) { flag[id] = "err"; jammedIds.push(id); }
      }
      for (const m of motorOf.get(k) ?? []) {
        rpm[m] = jam ? 0 : (motorRpm[m] ?? 0);
        if (jam) { flag[m] = "err"; jammedIds.push(m); }
      }
    }
    if (jam) jams++;
  }
  for (const m of freeMotors) rpm[m] = motorRpm[m] ?? 0;

  if (jams) issues.push({ s: "err", h: "Engranajes trabados", t: "Una cadena de piezas obliga a girar en sentidos o velocidades opuestas al mismo tiempo, por eso no se mueve. Pasa, por ejemplo, con tres engranajes que se tocan formando un triángulo, o con dos motores moviendo la misma cadena.", ids: jammedIds });
  if (overlaps.size) {
    issues.push({ s: "warn", h: "Engranajes superpuestos", t: "Hay engranajes montados uno encima del otro. No engranan: sepáralos hasta que solo se toquen los dientes.", ids: [...overlaps] });
    overlaps.forEach((id) => { if (flag[id] !== "err") flag[id] = "warn"; });
  }
  const bad = belts.filter((b) => !beltOk[b.id]);
  if (bad.length) {
    issues.push({ s: "warn", h: "Correa mal colocada", t: "Las poleas unidas por una correa deben quedar paralelas, en el mismo plano y separadas. Muévelas para que la correa quede tensa.", ids: bad.map((b) => b.id) });
    bad.forEach((b) => { flag[b.id] = "warn"; });
  }
  const loose = rotors.filter((r) => !link[r.id]);
  if (loose.length) {
    const name = (id: number) => { const it = findItem(byId.get(id)!.type); return it ? `${it.name}${it.variant ? ` de ${it.variant}` : ""}` : "La pieza"; };
    issues.push({ s: "warn", h: "Pieza suelta", t: loose.length > 1 ? `${loose.length} piezas no están en el eje de un motor ni unidas a otra pieza.` : `${name(loose[0]!.id)} no está en el eje de un motor ni unida a otra pieza. Ponla sobre el eje del motor, hazla engranar o únela con una correa.`, ids: loose.map((r) => r.id) });
    loose.forEach((r) => { if (!flag[r.id]) flag[r.id] = "warn"; });
  }
  if (idle) issues.push({ s: "info", h: "Sin motor", t: "Hay piezas conectadas entre sí, pero ningún motor las mueve. Monta una de ellas sobre el eje de un motor.", ids: [] });

  return { rpm, ratio, link, meshes, issues, flag, beltOk, axisOf };
}

/** Punto del eje más cercano (para ubicar piezas sobre ejes). */
export function projectOnAxis(A: Axis, p: [number, number, number]): [number, number, number] {
  const t = dot(sub(p, A.c), A.a);
  const q = mul(A.a, t);
  return [A.c[0] + q[0], A.c[1] + q[1], A.c[2] + q[2]];
}

export const axisLen = len;
export type { Part };
