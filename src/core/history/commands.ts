// Historial de deshacer y rehacer basado en comandos. Puro, sin React.

import type { Part, Project, PropValue } from "../model/project";

/** Cambios a una pieza. Una propiedad en `undefined` se borra. */
export type Patch = Partial<Omit<Part, "id" | "props">> & { props?: Record<string, PropValue | undefined> };

function mergeProps(base: Record<string, PropValue>, patch?: Record<string, PropValue | undefined>): Record<string, PropValue> {
  if (!patch) return base;
  const out: Record<string, PropValue> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

export type Command =
  | { kind: "add"; part: Part }
  | { kind: "remove"; part: Part; index: number }
  | { kind: "update"; id: number; before: Patch; after: Patch; mergeKey?: string; t?: number };

export interface History {
  past: Command[];
  future: Command[];
}

export const emptyHistory = (): History => ({ past: [], future: [] });

/** Aplica un comando y devuelve el proyecto nuevo. */
export function apply(p: Project, c: Command): Project {
  switch (c.kind) {
    case "add":
      return { parts: [...p.parts, c.part], nextId: Math.max(p.nextId, c.part.id + 1) };
    case "remove":
      return { ...p, parts: p.parts.filter((x) => x.id !== c.part.id) };
    case "update":
      return { ...p, parts: p.parts.map((x) => (x.id === c.id ? { ...x, ...c.after, props: mergeProps(x.props, c.after.props) } : x)) };
  }
}

/** Devuelve el comando que deshace a `c`. */
export function invert(c: Command): Command {
  if (c.kind === "add") return { kind: "remove", part: c.part, index: -1 };
  if (c.kind === "remove") return { kind: "add", part: c.part };
  return { kind: "update", id: c.id, before: c.after, after: c.before };
}

function applyInverse(p: Project, c: Command): Project {
  if (c.kind === "remove") {
    // Reinsertar en su posición original para conservar el orden.
    const parts = [...p.parts];
    parts.splice(c.index < 0 ? parts.length : Math.min(c.index, parts.length), 0, c.part);
    return { ...p, parts };
  }
  return apply(p, invert(c));
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
  return [applyInverse(p, c), { past: h.past.slice(0, -1), future: [c, ...h.future] }];
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
