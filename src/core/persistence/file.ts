// Guardar y cargar el proyecto como JSON. Al cargar se revisa todo: lo que no sirve se descarta.

import { SIZES, type Belt, type Cable, type CableEnd, type Joint, type Part, type Project, type PropValue, type Vec3 } from "../model/project";

export const FILE_VERSION = 1;

export function serialize(project: Project): string {
  return JSON.stringify({ app: "kinetic", version: FILE_VERSION, project });
}

export type ParseResult = { ok: true; project: Project; dropped: number } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);

function part(v: unknown): Part | null {
  if (!isObj(v) || !isId(v.id) || typeof v.type !== "string" || !(v.type in SIZES)) return null;
  if (!isNum(v.x) || !isNum(v.y) || !isNum(v.z) || !isVec(v.rot)) return null;
  const props: Record<string, PropValue> = {};
  if (isObj(v.props)) for (const [k, x] of Object.entries(v.props)) if (isNum(x) || typeof x === "string" || typeof x === "boolean") props[k] = x;
  return { id: v.id, type: v.type, x: v.x, y: v.y, z: v.z, rot: v.rot.map((n) => ((Math.round(n) % 4) + 4) % 4) as Vec3, props };
}

function end(v: unknown, alive: Set<number>): CableEnd | null {
  if (!isObj(v) || !isNum(v.x) || !isNum(v.y) || !isNum(v.z)) return null;
  const a = v.att;
  const att = isObj(a) && isId(a.part) && Number.isInteger(a.t) && alive.has(a.part) ? { part: a.part, t: a.t as number } : null;
  return { att, x: v.x, y: v.y, z: v.z };
}

function cable(v: unknown, alive: Set<number>): Cable | null {
  if (!isObj(v) || !isId(v.id) || !Array.isArray(v.ends) || v.ends.length !== 2) return null;
  const a = end(v.ends[0], alive), b = end(v.ends[1], alive);
  if (!a || !b) return null;
  return isVec(v.bend) ? { id: v.id, ends: [a, b], bend: v.bend } : { id: v.id, ends: [a, b] };
}

function belt(v: unknown, alive: Set<number>): Belt | null {
  if (!isObj(v) || !isId(v.id) || !isId(v.a) || !isId(v.b) || !alive.has(v.a) || !alive.has(v.b)) return null;
  return { id: v.id, a: v.a, b: v.b, cross: v.cross === true };
}

function joint(v: unknown, alive: Set<number>): Joint | null {
  const ref = (r: unknown) => (isObj(r) && isId(r.part) && Number.isInteger(r.h) && (r.h as number) >= 0 && alive.has(r.part) ? { part: r.part, h: r.h as number } : null);
  if (!isObj(v) || !isId(v.id) || (v.kind !== "revolute" && v.kind !== "fixed")) return null;
  const a = ref(v.a), b = ref(v.b);
  return a && b ? { id: v.id, kind: v.kind, a, b } : null;
}

/** Lee un proyecto de KINETIC. Acepta el archivo exportado o el proyecto solo. */
export function parseProject(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "El archivo no es un JSON válido. Exporta el proyecto otra vez desde KINETIC." };
  }
  const p = isObj(raw) && isObj(raw.project) ? raw.project : raw;
  if (!isObj(p) || !Array.isArray(p.parts) || !Array.isArray(p.cables)) {
    return { ok: false, error: "El archivo no tiene un proyecto de KINETIC: faltan las piezas o los cables." };
  }
  const used = new Set<number>();
  let dropped = 0;
  // Cada id se usa una sola vez entre piezas, cables, correas y juntas.
  const take = <T extends { id: number }>(list: unknown[], read: (v: unknown) => T | null): T[] => {
    const out: T[] = [];
    for (const v of list) {
      const x = read(v);
      if (!x || used.has(x.id)) { dropped++; continue; }
      used.add(x.id);
      out.push(x);
    }
    return out;
  };
  const parts = take(p.parts, part);
  const alive = new Set(parts.map((x) => x.id));
  const cables = take(p.cables, (v) => cable(v, alive));
  const belts = take(Array.isArray(p.belts) ? p.belts : [], (v) => belt(v, alive));
  const joints = take(Array.isArray(p.joints) ? p.joints : [], (v) => joint(v, alive));
  const max = Math.max(0, ...used);
  const nextId = isId(p.nextId) && p.nextId > max ? p.nextId : max + 1;
  return { ok: true, project: { parts, cables, belts, joints, nextId }, dropped };
}
