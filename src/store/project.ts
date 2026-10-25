import { create } from "zustand";
import { cableDiff, emptyHistory, exec, record, redo, removeCableCmd, removeCmd, undo, updateCmd, type Command, type History, type Patch } from "../core/history/commands";
import { analyze, type Circuit } from "../core/electrical/analyze";
import { clampZ, findFree, newPart, placeOnTable, type Axis, type Cable, type CableEnd, type Part, type Project, type PropValue, type Vec3 } from "../core/model/project";
import { detachFrom, endPos, posKey, reattach, termWorld } from "../core/model/terminals";

export interface TermRef {
  part: number;
  t: number;
}

interface ProjectState {
  project: Project;
  history: History;
  /** Pieza o cable seleccionado (comparten contador de id). */
  selected: number | null;
  rotAxis: Axis;
  /** Pieza o cable que se está arrastrando (no se registra cada paso). */
  dragging: number | null;
  /** Borne tocado, esperando el segundo para crear un cable. */
  pending: TermRef | null;
  circuit: Circuit;
  select: (id: number | null) => void;
  setRotAxis: (a: Axis) => void;
  run: (c: Command | null) => void;
  addNear: (type: string, x: number, y: number) => number;
  addTemp: (type: string, x: number, y: number) => number;
  commitTemp: (id: number) => void;
  dropTemp: (id: number) => void;
  moveLive: (id: number, x: number, y: number) => void;
  beginDrag: (id: number) => void;
  endDrag: (id: number, from: { x: number; y: number }) => void;
  rotate: (id: number, axis?: Axis) => void;
  flip: (id: number) => void;
  setZ: (id: number, z: number) => void;
  setProp: (id: number, key: string, v: PropValue) => void;
  replace: (id: number) => void;
  remove: (id: number) => void;
  /** Toque en un borne: el primero queda pendiente, el segundo crea el cable. */
  tapTerminal: (t: TermRef) => void;
  cancelPending: () => void;
  connect: (a: TermRef, b: TermRef) => void;
  /** Cable nuevo desde un borne, con la otra punta siguiendo el dedo. */
  startWire: (from: TermRef) => number;
  /** Mueve una punta en vivo; se pega a un borne si `att` viene. */
  moveEndLive: (id: number, i: 0 | 1, p: Vec3, att: TermRef | null) => void;
  /** Mueve un cable completo en vivo (arrastre desde la biblioteca). */
  moveCableLive: (id: number, x: number, y: number) => void;
  beginEndDrag: (id: number) => void;
  endEndDrag: (id: number, before: Cable["ends"]) => void;
  undo: () => void;
  redo: () => void;
}

const isCable = (p: Project, id: number) => p.cables.some((c) => c.id === id);

function wire(id: number, a: Part, ta: number, b: Part, tb: number): Cable {
  const [x0, y0, z0] = termWorld(a, ta), [x1, y1, z1] = termWorld(b, tb);
  return { id, ends: [{ att: { part: a.id, t: ta }, x: x0, y: y0, z: z0 }, { att: { part: b.id, t: tb }, x: x1, y: y1, z: z1 }] };
}

/** Ejemplo inicial: el circuito de la ampolleta y un tren de engranajes. */
function sample(): Project {
  const P = (id: number, type: string, x: number, y: number, rz = 0, props: Part["props"] = {}, z = 0): Part => ({ id, type, x, y, z, rot: [0, 0, rz], props });
  const bat = P(1, "source", -220, 40, 0, { v: 9 });
  const sw = P(2, "switch", -90, 130);
  const res = P(3, "resistor", 30, 130, 0, { r: 100 });
  const lamp = P(4, "lamp", 60, 10, 0, { vn: 6 });
  const parts = [bat, sw, res, lamp,
    P(5, "plate", 200, -40), P(6, "gear10", 160, -50, 0, {}, 6), P(7, "gear40", 210, -50, 0, {}, 6), P(8, "profile240", -60, -80)];
  const cables = [wire(9, bat, 1, sw, 0), wire(10, sw, 1, res, 0), wire(11, res, 1, lamp, 1), wire(12, lamp, 0, bat, 0)];
  return { parts, cables, nextId: 13 };
}

export const useProject = create<ProjectState>((set, get) => {
  const commit = (c: Command | null) => {
    if (!c) return;
    const s = get();
    const [project, history] = exec(s.project, s.history, c);
    set({ project, history });
  };
  const part = (id: number) => get().project.parts.find((p) => p.id === id);
  const cable = (id: number) => get().project.cables.find((c) => c.id === id);
  const setCables = (cables: Cable[]) => set({ project: { ...get().project, cables } });
  const initial = sample();

  return {
    project: initial,
    history: emptyHistory(),
    selected: 4,
    rotAxis: "z",
    dragging: null,
    pending: null,
    circuit: analyze(initial),
    select: (selected) => set({ selected, pending: null }),
    setRotAxis: (rotAxis) => set({ rotAxis }),
    run: commit,

    addNear: (type, x, y) => {
      const s = get();
      if (type === "wire") {
        const id = s.project.nextId;
        const e = (dx: number): CableEnd => ({ att: null, x: Math.round(x + dx), y: Math.round(y), z: 0 });
        commit({ kind: "addCable", cable: { id, ends: [e(-40), e(40)] } });
        set({ selected: id });
        return id;
      }
      const p = newPart(s.project, type);
      const at = findFree(p, s.project.parts, x, y);
      commit({ kind: "add", part: { ...p, ...at } });
      set({ selected: p.id });
      return p.id;
    },
    addTemp: (type, x, y) => {
      const s = get();
      const id = s.project.nextId;
      if (type === "wire") {
        const e = (dx: number): CableEnd => ({ att: null, x: Math.round(x + dx), y: Math.round(y), z: 0 });
        set({ project: { ...s.project, cables: [...s.project.cables, { id, ends: [e(-40), e(40)] }], nextId: id + 1 }, selected: id, dragging: id });
        return id;
      }
      const p = newPart(s.project, type);
      const at = placeOnTable(p, x, y);
      set({ project: { ...s.project, parts: [...s.project.parts, { ...p, ...at }], nextId: id + 1 }, selected: id, dragging: id });
      return id;
    },
    commitTemp: (id) => {
      const s = get();
      const p = part(id);
      if (p) {
        const project = { ...s.project, cables: reattach(s.project) };
        set({ project, history: record(s.history, { kind: "add", part: p }), dragging: null });
        return;
      }
      const c = cable(id);
      if (c) {
        const cables = reattach(s.project);
        const done = cables.find((x) => x.id === id)!;
        set({ project: { ...s.project, cables }, history: record(s.history, { kind: "addCable", cable: done }), dragging: null });
      }
    },
    dropTemp: (id) => {
      const s = get();
      set({
        project: { ...s.project, parts: s.project.parts.filter((p) => p.id !== id), cables: s.project.cables.filter((c) => c.id !== id) },
        selected: null, dragging: null,
      });
    },
    moveLive: (id, x, y) => {
      const s = get();
      const p = part(id);
      if (!p) return;
      const at = placeOnTable(p, x, y);
      if (at.x === p.x && at.y === p.y) return;
      set({ project: { ...s.project, parts: s.project.parts.map((q) => (q.id === id ? { ...q, ...at } : q)) } });
    },
    beginDrag: (id) => set({ dragging: id, selected: id, pending: null }),
    endDrag: (id, from) => {
      const s = get();
      const p = part(id);
      set({ dragging: null });
      if (!p || (p.x === from.x && p.y === from.y)) return;
      // Las puntas sueltas que quedaron sobre un borne se pegan a él.
      const cables = reattach(s.project);
      const move: Command = { kind: "update", id, before: { x: from.x, y: from.y }, after: { x: p.x, y: p.y } };
      const extra = cableDiff(s.project.cables, cables);
      set({ project: { ...s.project, cables }, history: record(s.history, extra.length ? { kind: "batch", cmds: [move, ...extra] } : move) });
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
    flip: (id) => {
      // Invertir polaridad: media vuelta en Z y los cables cambian de borne.
      const s = get();
      const p = part(id);
      if (!p) return;
      const rot = [p.rot[0], p.rot[1], (p.rot[2] + 2) % 4] as Part["rot"];
      const cables = s.project.cables.map((c) => ({
        ...c,
        ends: c.ends.map((e) => (e.att?.part === id ? { ...e, att: { part: id, t: 1 - e.att.t } } : e)) as Cable["ends"],
      }));
      const upd = updateCmd(s.project, id, { rot });
      if (upd) commit({ kind: "batch", cmds: [upd, ...cableDiff(s.project.cables, cables)] });
    },
    setZ: (id, z) => commit(updateCmd(get().project, id, { z: clampZ(z) }, `${id}:z`)),
    setProp: (id, key, v) => commit(updateCmd(get().project, id, { props: { [key]: v } } as Patch, `${id}:${key}`)),
    replace: (id) => commit(updateCmd(get().project, id, { props: { burned: undefined, burnV: undefined } })),
    remove: (id) => {
      const s = get();
      if (isCable(s.project, id)) commit(removeCableCmd(s.project, id));
      else {
        const rm = removeCmd(s.project, id);
        if (!rm) return;
        const detach = cableDiff(s.project.cables, detachFrom(s.project, id));
        commit(detach.length ? { kind: "batch", cmds: [...detach, rm] } : rm);
      }
      if (get().selected === id) set({ selected: null });
      set({ pending: null });
    },

    tapTerminal: (t) => {
      const pend = get().pending;
      if (pend && (pend.part !== t.part || pend.t !== t.t)) {
        get().connect(pend, t);
        set({ pending: null });
      } else if (pend) set({ pending: null });
      else set({ pending: t, selected: null });
    },
    cancelPending: () => set({ pending: null }),
    connect: (a, b) => {
      const s = get();
      const A = part(a.part), B = part(b.part);
      if (!A || !B) return;
      const pa = termWorld(A, a.t), pb = termWorld(B, b.t);
      if (posKey(pa) === posKey(pb)) return;
      const same = s.project.cables.some((c) => {
        const [x, y] = [c.ends[0].att, c.ends[1].att];
        return x && y && ((x.part === a.part && x.t === a.t && y.part === b.part && y.t === b.t) || (x.part === b.part && x.t === b.t && y.part === a.part && y.t === a.t));
      });
      if (same) return;
      commit({ kind: "addCable", cable: wire(s.project.nextId, A, a.t, B, b.t) });
    },
    startWire: (from) => {
      const s = get();
      const A = part(from.part)!;
      const [x, y, z] = termWorld(A, from.t);
      const id = s.project.nextId;
      const c: Cable = { id, ends: [{ att: from, x, y, z }, { att: null, x, y, z }] };
      set({ project: { ...s.project, cables: [...s.project.cables, c], nextId: id + 1 }, dragging: id, pending: null, selected: null });
      return id;
    },
    moveEndLive: (id, i, p, att) => {
      const s = get();
      set({
        project: {
          ...s.project,
          cables: s.project.cables.map((c) => {
            if (c.id !== id) return c;
            const ends = [...c.ends] as Cable["ends"];
            ends[i] = { att, x: Math.round(p[0]), y: Math.round(p[1]), z: Math.round(p[2]) };
            return { ...c, ends };
          }),
        },
      });
    },
    moveCableLive: (id, x, y) => {
      const s = get();
      setCables(s.project.cables.map((c) => (c.id === id
        ? { ...c, ends: [{ att: null, x: Math.round(x - 40), y: Math.round(y), z: 0 }, { att: null, x: Math.round(x + 40), y: Math.round(y), z: 0 }] }
        : c)));
    },
    beginEndDrag: (id) => set({ dragging: id, selected: id, pending: null }),
    endEndDrag: (id, before) => {
      const s = get();
      const c = cable(id);
      set({ dragging: null });
      if (!c) return;
      // Si la punta quedó suelta sobre otra punta o un borne, se pega por posición.
      const ends = c.ends.map((e) => (e.att ? e : { ...e, att: null })) as Cable["ends"];
      if (JSON.stringify(before) === JSON.stringify(ends)) return;
      const cables = reattach(s.project);
      const done = cables.find((x) => x.id === id)!;
      set({ project: { ...s.project, cables }, history: record(s.history, { kind: "updateCable", id, before, after: done.ends }) });
    },

    undo: () => {
      const s = get();
      const [project, history] = undo(s.project, s.history);
      const alive = (id: number | null) => id !== null && (project.parts.some((p) => p.id === id) || project.cables.some((c) => c.id === id));
      set({ project, history, selected: alive(s.selected) ? s.selected : null, pending: null });
    },
    redo: () => {
      const s = get();
      const [project, history] = redo(s.project, s.history);
      const alive = (id: number | null) => id !== null && (project.parts.some((p) => p.id === id) || project.cables.some((c) => c.id === id));
      set({ project, history, selected: alive(s.selected) ? s.selected : null, pending: null });
    },
  };
});

// El circuito se recalcula con cada cambio de la mesa. Si algo se quema, queda marcado
// en la pieza (fuera del historial, como pasaría en la realidad) y se vuelve a calcular.
useProject.subscribe((s, prev) => {
  if (s.project === prev.project) return;
  const c = analyze(s.project);
  if (c.burns.length) {
    const burnt = new Map(c.burns.map((b) => [b.id, b.v]));
    useProject.setState({
      project: {
        ...s.project,
        parts: s.project.parts.map((p) => (burnt.has(p.id) ? { ...p, props: { ...p.props, burned: true, burnV: Math.round(burnt.get(p.id)! * 100) / 100 } } : p)),
      },
    });
    return;
  }
  useProject.setState({ circuit: c });
});

/** Posición actual de una punta de cable. */
export const cableEndPos = (project: Project, e: CableEnd): Vec3 => endPos(project, e);
