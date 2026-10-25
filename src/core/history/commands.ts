// Historial de deshacer y rehacer basado en comandos. Puro, sin React.

import type { Cable, Part, Project, PropValue } from "../model/project";

/** Cambios a una pieza. Una propiedad en `undefined` se borra. */
export type Patch = Partial<Omit<Part, "id" | "props">> & { props?: Record<string, PropValue | undefined> };

export type Command =
  | { kind: "add"; part: Part }
  | { kind: "remove"; part: Part; index: number }
  | { kind: "update"; id: number; before: Patch; after: Patch; mergeKey?: string; t?: number }
  | { kind: "addCable"; cable: Cable }
  | { kind: "removeCable"; cable: Cable; index: number }
  | { kind: "updateCable"; id: number; before: CableShape; after: CableShape }
  /** Varias acciones que se deshacen juntas. */
  | { kind: "batch"; cmds: Command[] };

/** Forma de un cable: sus puntas y su punto de doblez. */
export type CableShape = Pick<Cable, "ends" | "bend">;

export const shapeOf = (c: Cable): CableShape => ({ ends: c.ends, bend: c.bend ?? null });

export interface History {
  past: Command[];
  future: Command[];
}

export const emptyHistory = (): History => ({ past: [], future: [] });

function mergeProps(base: Record<string, PropValue>, patch?: Record<string, PropValue | undefined>): Record<string, PropValue> {
  if (!patch) return base;
  const out: Record<string, PropValue> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

function insertAt<T>(list: T[], item: T, index: number): T[] {
  const out = [...list];
  out.splice(index < 0 ? out.length : Math.min(index, out.length), 0, item);
  return out;
}

/** Aplica un comando y devuelve el proyecto nuevo. */
export function apply(p: Project, c: Command): Project {
  switch (c.kind) {
    case "add":
      return { ...p, parts: [...p.parts, c.part], nextId: Math.max(p.nextId, c.part.id + 1) };
    case "remove":
      return { ...p, parts: p.parts.filter((x) => x.id !== c.part.id) };
    case "update":
      return { ...p, parts: p.parts.map((x) => (x.id === c.id ? { ...x, ...c.after, props: mergeProps(x.props, c.after.props) } : x)) };
    case "addCable":
      return { ...p, cables: [...p.cables, c.cable], nextId: Math.max(p.nextId, c.cable.id + 1) };
    case "removeCable":
      return { ...p, cables: p.cables.filter((x) => x.id !== c.cable.id) };
    case "updateCable":
      return { ...p, cables: p.cables.map((x) => (x.id === c.id ? { ...x, ends: c.after.ends, bend: c.after.bend ?? null } : x)) };
    case "batch":
      return c.cmds.reduce(apply, p);
  }
}

/** Deshace un comando. */
function unapply(p: Project, c: Command): Project {
  switch (c.kind) {
    case "add":
      return apply(p, { kind: "remove", part: c.part, index: -1 });
    case "remove":
      return { ...p, parts: insertAt(p.parts, c.part, c.index) };
    case "update":
      return apply(p, { kind: "update", id: c.id, before: c.after, after: c.before });
    case "addCable":
      return apply(p, { kind: "removeCable", cable: c.cable, index: -1 });
    case "removeCable":
      return { ...p, cables: insertAt(p.cables, c.cable, c.index) };
    case "updateCable":
      return apply(p, { kind: "updateCable", id: c.id, before: c.after, after: c.before });
    case "batch":
      return [...c.cmds].reverse().reduce(unapply, p);
  }
}

const MERGE_MS = 1000;

/** Agrega un comando ya aplicado al historial. Une ediciones seguidas del mismo campo. */
export function record(h: History, c: Command, now = Date.now()): History {
  const last = h.past[h.past.length - 1];
  if (c.kind === "update" && c.mergeKey && last?.kind === "update" && last.mergeKey === c.mergeKey && last.id === c.id && now - (last.t ?? 0) < MERGE_MS) {
    const merged: Command = { ...last, after: { ...last.after, ...c.after, props: { ...last.after.props, ...c.after.props } }, t: now };
    return { past: [...h.past.slice(0, -1), merged], future: [] };
  }
  return { past: [...h.past, c.kind === "update" ? { ...c, t: now } : c], future: [] };
}

/** Aplica y registra. */
export function exec(p: Project, h: History, c: Command, now = Date.now()): [Project, History] {
  return [apply(p, c), record(h, c, now)];
}

export function undo(p: Project, h: History): [Project, History] {
  const c = h.past[h.past.length - 1];
  if (!c) return [p, h];
  return [unapply(p, c), { past: h.past.slice(0, -1), future: [c, ...h.future] }];
}

export function redo(p: Project, h: History): [Project, History] {
  const c = h.future[0];
  if (!c) return [p, h];
  return [apply(p, c), { past: [...h.past, c], future: h.future.slice(1) }];
}

/** Comando para borrar una pieza, recordando su posición en la lista. */
export function removeCmd(p: Project, id: number): Command | null {
  const index = p.parts.findIndex((x) => x.id === id);
  const part = p.parts[index];
  return part ? { kind: "remove", part, index } : null;
}

export function removeCableCmd(p: Project, id: number): Command | null {
  const index = p.cables.findIndex((x) => x.id === id);
  const cable = p.cables[index];
  return cable ? { kind: "removeCable", cable, index } : null;
}

/** Comandos que llevan los cables de `before` a `after` (solo los que cambiaron). */
export function cableDiff(before: Cable[], after: Cable[]): Command[] {
  const out: Command[] = [];
  for (const a of after) {
    const b = before.find((x) => x.id === a.id);
    if (b && JSON.stringify(shapeOf(b)) !== JSON.stringify(shapeOf(a))) out.push({ kind: "updateCable", id: a.id, before: shapeOf(b), after: shapeOf(a) });
  }
  return out;
}

/** Comando de actualización que guarda los valores anteriores de los campos cambiados. */
export function updateCmd(p: Project, id: number, after: Patch, mergeKey?: string): Command | null {
  const part = p.parts.find((x) => x.id === id);
  if (!part) return null;
  const before: Patch = {};
  for (const k of Object.keys(after) as (keyof Patch)[]) {
    if (k === "props") {
      before.props = Object.fromEntries(Object.keys(after.props ?? {}).map((pk) => [pk, part.props[pk]]));
    } else (before as Record<string, unknown>)[k] = part[k];
  }
  return { kind: "update", id, before, after, mergeKey };
}
