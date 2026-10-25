import { create } from "zustand";
import { emptyHistory, exec, record, redo, removeCmd, undo, updateCmd, type Command, type History, type Patch } from "../core/history/commands";
import { clampZ, findFree, newPart, placeOnTable, type Axis, type Part, type Project, type PropValue } from "../core/model/project";

interface ProjectState {
  project: Project;
  history: History;
  selected: number | null;
  rotAxis: Axis;
  /** Pieza que se está arrastrando (para no registrar cada paso en el historial). */
  dragging: number | null;
  select: (id: number | null) => void;
  setRotAxis: (a: Axis) => void;
  run: (c: Command | null) => void;
  /** Agrega una pieza en el lugar libre más cercano a (x, y) y la selecciona. */
  addNear: (type: string, x: number, y: number) => number;
  /** Agrega una pieza sin registrarla todavía (arrastre desde la biblioteca). */
  addTemp: (type: string, x: number, y: number) => number;
  commitTemp: (id: number) => void;
  dropTemp: (id: number) => void;
  /** Mueve en vivo sin historial. */
  moveLive: (id: number, x: number, y: number) => void;
  beginDrag: (id: number) => void;
  /** Cierra un arrastre y registra el movimiento si hubo cambio. */
  endDrag: (id: number, from: { x: number; y: number }) => void;
  rotate: (id: number, axis?: Axis) => void;
  setZ: (id: number, z: number) => void;
  setProp: (id: number, key: string, v: PropValue) => void;
  remove: (id: number) => void;
  undo: () => void;
  redo: () => void;
}

const SAMPLE: Part[] = [
  { id: 1, type: "plate", x: 0, y: 0, z: 0, rot: [0, 0, 0], props: {} },
  { id: 2, type: "dcmotor", x: -50, y: 25, z: 6, rot: [0, 0, 0], props: {} },
  { id: 3, type: "gear10", x: -10, y: -10, z: 6, rot: [0, 0, 0], props: {} },
  { id: 4, type: "gear40", x: 40, y: -10, z: 6, rot: [0, 0, 0], props: {} },
  { id: 5, type: "source", x: -180, y: 120, z: 0, rot: [0, 0, 1], props: {} },
  { id: 6, type: "profile240", x: 120, y: 140, z: 0, rot: [0, 0, 0], props: {} },
  { id: 7, type: "lamp", x: -100, y: 140, z: 0, rot: [0, 0, 0], props: {} },
];

export const useProject = create<ProjectState>((set, get) => {
  const commit = (c: Command | null) => {
    if (!c) return;
    const s = get();
    const [project, history] = exec(s.project, s.history, c);
    set({ project, history });
  };
  const part = (id: number) => get().project.parts.find((p) => p.id === id);

  return {
    project: { parts: SAMPLE, nextId: 8 },
    history: emptyHistory(),
    selected: 4,
    rotAxis: "z",
    dragging: null,
    select: (selected) => set({ selected }),
    setRotAxis: (rotAxis) => set({ rotAxis }),
    run: commit,
    addNear: (type, x, y) => {
      const s = get();
      const p = newPart(s.project, type);
      const at = findFree(p, s.project.parts, x, y);
      commit({ kind: "add", part: { ...p, ...at } });
      set({ selected: p.id });
      return p.id;
    },
    addTemp: (type, x, y) => {
      const s = get();
      const p = newPart(s.project, type);
      const at = placeOnTable(p, x, y);
      set({ project: { parts: [...s.project.parts, { ...p, ...at }], nextId: p.id + 1 }, selected: p.id, dragging: p.id });
      return p.id;
    },
    commitTemp: (id) => {
      const p = part(id);
      if (p) set({ history: record(get().history, { kind: "add", part: p }), dragging: null });
    },
    dropTemp: (id) => {
      const s = get();
      set({ project: { ...s.project, parts: s.project.parts.filter((p) => p.id !== id) }, selected: null, dragging: null });
    },
    moveLive: (id, x, y) => {
      const s = get();
      const p = part(id);
      if (!p) return;
      const at = placeOnTable(p, x, y);
      if (at.x === p.x && at.y === p.y) return;
      set({ project: { ...s.project, parts: s.project.parts.map((q) => (q.id === id ? { ...q, ...at } : q)) } });
    },
    beginDrag: (id) => set({ dragging: id, selected: id }),
    endDrag: (id, from) => {
      const p = part(id);
      set({ dragging: null });
      if (!p || (p.x === from.x && p.y === from.y)) return;
      const c: Command = { kind: "update", id, before: { x: from.x, y: from.y }, after: { x: p.x, y: p.y } };
      set({ history: record(get().history, c) });
    },
    rotate: (id, axis) => {
      const p = part(id);
      if (!p) return;
      const a = axis ?? get().rotAxis;
      const k = a === "x" ? 0 : a === "y" ? 1 : 2;
      const rot = [...p.rot] as Part["rot"];
      rot[k] = (rot[k] + 1) % 4;
      const at = placeOnTable({ ...p, rot }, p.x, p.y);
      commit(updateCmd(get().project, id, { rot, ...at }));
    },
    setZ: (id, z) => commit(updateCmd(get().project, id, { z: clampZ(z) }, `${id}:z`)),
    setProp: (id, key, v) => commit(updateCmd(get().project, id, { props: { [key]: v } } as Patch, `${id}:${key}`)),
    remove: (id) => {
      commit(removeCmd(get().project, id));
      if (get().selected === id) set({ selected: null });
    },
    undo: () => {
      const s = get();
      const [project, history] = undo(s.project, s.history);
      set({ project, history, selected: project.parts.some((p) => p.id === s.selected) ? s.selected : null });
    },
    redo: () => {
      const s = get();
      const [project, history] = redo(s.project, s.history);
      set({ project, history, selected: project.parts.some((p) => p.id === s.selected) ? s.selected : null });
    },
  };
});
