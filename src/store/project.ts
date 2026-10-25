import { create } from "zustand";
import { cableDiff, emptyHistory, exec, record, redo, removeCableCmd, removeCmd, shapeOf, undo, updateCmd, type CableShape, type Command, type History, type Patch } from "../core/history/commands";
import { analyze, type Circuit } from "../core/electrical/analyze";
import { clampZ, findFree, newPart, placeOnTable, RESIZABLE, type Axis, type Cable, type CableEnd, type Part, type Project, type PropValue, type Vec3 } from "../core/model/project";
import { detachFrom, endPos, posKey, reattach, termWorld } from "../core/model/terminals";
import { snapRotor } from "../core/mechanical/snap";
import { isRotor } from "../core/mechanical/axes";
import { solveTrain, type Train } from "../core/mechanical/train";

/** RPM de cada motor según el voltaje que recibe: RPM nominal × V / V nominal. */
export function motorSpeeds(project: Project, circuit: Circuit): Record<number, number> {
  const out: Record<number, number> = {};
  for (const p of project.parts) {
    if (p.type !== "dcmotor") continue;
    const v = circuit.readings[p.id]?.v ?? 0;
    const rpmN = typeof p.props.rpm === "number" ? p.props.rpm : 60;
    const vn = typeof p.props.vnom === "number" ? p.props.vnom : 12;
    out[p.id] = p.props.burned === true ? 0 : (rpmN * v) / vn;
  }
  return out;
}

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
  mech: Train;
  /** Poniendo una correa: null = no; first = primera polea tocada. */
  beltMode: { first: number | null } | null;
  /** Posición de la pieza al empezar a arrastrarla (para deshacer). */
  dragFrom: Pick<Part, "x" | "y" | "z" | "rot"> | null;
  /** Toque en una pieza mientras se pone una correa. */
  beltTap: (id: number) => void;
  toggleCross: (id: number) => void;
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
  /** Accionar: abre o cierra un interruptor, presiona o suelta un sensor de contacto. */
  actuate: (id: number) => void;
  /** Cambia el largo (lx) o el ancho (ly) de una estructura, de 10 en 10 mm. */
  setSize: (id: number, key: "lx" | "ly", mm: number) => void;
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
  /** Cierra una edición de cable (punta, mover o doblar) y la registra si cambió algo. */
  endEndDrag: (id: number, before: CableShape) => void;
  /** Qué hace arrastrar el cuerpo de un cable seleccionado. */
  cableMode: "move" | "bend";
  setCableMode: (m: "move" | "bend") => void;
  /** Cambia la forma de un cable en vivo, sin historial. */
  setCableLive: (id: number, shape: CableShape) => void;
  /** Deja el cable recto otra vez. */
  straighten: (id: number) => void;
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
  // Tren 10 → 40 con correa, movido por un motor de 12 V (como el ejemplo del prototipo).
  const bat2 = P(13, "source", 120, 150, 0, { v: 12 });
  const motor: Part = { id: 14, type: "dcmotor", x: 140, y: 60, z: 30, rot: [0, 0, 0], props: { rpm: 120 } };
  const g10: Part = { id: 15, type: "gear10", x: 165, y: 60, z: 33, rot: [0, 1, 0], props: {} };
  const g40: Part = { id: 16, type: "gear40", x: 165, y: 110, z: 3, rot: [0, 1, 0], props: {} };
  const pS: Part = { id: 17, type: "pulleyS", x: 175, y: 110, z: 35, rot: [0, 1, 0], props: {} };
  const pL: Part = { id: 18, type: "pulleyL", x: 175, y: 220, z: 17, rot: [0, 1, 0], props: {} };
  const parts = [bat, sw, res, lamp, P(8, "profile240", -60, -80), bat2, motor, g10, g40, pS, pL];
  const cables = [wire(9, bat, 1, sw, 0), wire(10, sw, 1, res, 0), wire(11, res, 1, lamp, 1), wire(12, lamp, 0, bat, 0),
    wire(19, bat2, 1, motor, 1), wire(20, motor, 0, bat2, 0)];
  return { parts, cables, belts: [{ id: 21, a: 17, b: 18, cross: false }], nextId: 22 };
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
  const initialCircuit = analyze(initial);

  return {
    project: initial,
    history: emptyHistory(),
    selected: 4,
    rotAxis: "z",
    dragging: null,
    pending: null,
    circuit: initialCircuit,
    mech: solveTrain(initial, motorSpeeds(initial, initialCircuit)),
    beltMode: null,
    dragFrom: null,
    beltTap: (id) => {
      const s = get();
      const bm = s.beltMode;
      const p = part(id);
      if (!bm || !p || !p.type.startsWith("pulley")) return;
      if (bm.first === null) { set({ beltMode: { first: id }, selected: id }); return; }
      if (bm.first === id) return;
      const belts = s.project.belts ?? [];
      const exists = belts.some((b) => (b.a === bm.first && b.b === id) || (b.a === id && b.b === bm.first));
      const bid = s.project.nextId;
      if (!exists) commit({ kind: "addBelt", belt: { id: bid, a: bm.first, b: id, cross: false } });
      set({ beltMode: null, selected: exists ? id : bid });
    },
    toggleCross: (id) => {
      const b = (get().project.belts ?? []).find((x) => x.id === id);
      if (b) commit({ kind: "updateBelt", id, before: b.cross, after: !b.cross });
    },
    select: (selected) => set({ selected, pending: null, beltMode: null }),
    setRotAxis: (rotAxis) => set({ rotAxis }),
    run: commit,

    addNear: (type, x, y) => {
      const s = get();
      if (type === "belt") {
        set({ beltMode: { first: null }, selected: null, pending: null });
        return -1;
      }
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
      set({ project: { ...s.project, parts: [...s.project.parts, { ...p, ...at }], nextId: id + 1 }, selected: id, dragging: id, dragFrom: { x: at.x, y: at.y, z: 0, rot: [0, 0, 0] } });
      return id;
    },
    commitTemp: (id) => {
      const s = get();
      const p = part(id);
      if (p) {
        const project = { ...s.project, cables: reattach(s.project) };
        set({ project, history: record(s.history, { kind: "add", part: p }), dragging: null, dragFrom: null });
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
      // Engranajes y poleas: imán al eje de un motor, a otro eje o a la distancia de engrane.
      const o = s.dragFrom ?? p;
      const snapped = isRotor(p.type) ? snapRotor(s.project, { ...p, rot: o.rot, z: o.z }, x, y) : null;
      const next = snapped ?? { ...placeOnTable({ ...p, rot: o.rot }, x, y), z: o.z, rot: o.rot };
      if (next.x === p.x && next.y === p.y && next.z === p.z && next.rot.join() === p.rot.join()) return;
      set({ project: { ...s.project, parts: s.project.parts.map((q) => (q.id === id ? { ...q, ...next } : q)) } });
    },
    beginDrag: (id) => {
      const p = part(id);
      set({ dragging: id, selected: id, pending: null, dragFrom: p ? { x: p.x, y: p.y, z: p.z, rot: p.rot } : null });
    },
    endDrag: (id, fromXY) => {
      const s = get();
      const p = part(id);
      const from = s.dragFrom ?? { ...fromXY, z: p?.z ?? 0, rot: p?.rot ?? [0, 0, 0] };
      set({ dragging: null, dragFrom: null });
      if (!p || (p.x === from.x && p.y === from.y && p.z === from.z && p.rot.join() === from.rot.join())) return;
      // Las puntas sueltas que quedaron sobre un borne se pegan a él.
      const cables = reattach(s.project);
      const move: Command = { kind: "update", id, before: { x: from.x, y: from.y, z: from.z, rot: from.rot }, after: { x: p.x, y: p.y, z: p.z, rot: p.rot } };
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
    setSize: (id, key, mm) => {
      const p = part(id);
      const range = p && RESIZABLE[p.type]?.[key];
      if (!p || !range) return;
      const v = Math.min(range[1], Math.max(range[0], Math.round(mm / 10) * 10));
      const next = { ...p, props: { ...p.props, [key]: v } };
      const at = placeOnTable(next, p.x, p.y);
      commit(updateCmd(get().project, id, { props: { [key]: v }, ...at }, `${id}:${key}`));
    },
    actuate: (id) => {
      const p = part(id);
      if (!p) return;
      if (p.type === "switch") commit(updateCmd(get().project, id, { props: { closed: p.props.closed === false } }));
      else if (p.type === "sensorContact") commit(updateCmd(get().project, id, { props: { pressed: p.props.pressed !== true } }));
    },
    remove: (id) => {
      const s = get();
      const belts = s.project.belts ?? [];
      const bi = belts.findIndex((b) => b.id === id);
      if (bi >= 0) commit({ kind: "removeBelt", belt: belts[bi]!, index: bi });
      else if (isCable(s.project, id)) commit(removeCableCmd(s.project, id));
      else {
        const rm = removeCmd(s.project, id);
        if (!rm) return;
        const detach = cableDiff(s.project.cables, detachFrom(s.project, id));
        // Las correas de una polea borrada se van con ella.
        const gone: Command[] = belts.flatMap((b, index) => (b.a === id || b.b === id ? [{ kind: "removeBelt", belt: b, index } as Command] : []));
        const all = [...detach, ...gone.reverse(), rm];
        commit(all.length > 1 ? { kind: "batch", cmds: all } : rm);
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
      // Las puntas sueltas que quedaron sobre un borne se pegan por posición.
      const cables = reattach(s.project);
      const done = cables.find((x) => x.id === id)!;
      if (JSON.stringify(before) === JSON.stringify(shapeOf(done))) return;
      set({ project: { ...s.project, cables }, history: record(s.history, { kind: "updateCable", id, before, after: shapeOf(done) }) });
    },
    cableMode: "move",
    setCableMode: (cableMode) => set({ cableMode }),
    setCableLive: (id, shape) => setCables(get().project.cables.map((c) => (c.id === id ? { ...c, ends: shape.ends, bend: shape.bend ?? null } : c))),
    straighten: (id) => {
      const c = cable(id);
      if (!c?.bend) return;
      commit({ kind: "updateCable", id, before: shapeOf(c), after: { ends: c.ends, bend: null } });
    },

    undo: () => {
      const s = get();
      const [project, history] = undo(s.project, s.history);
      const alive = (id: number | null) => id !== null && (project.parts.some((p) => p.id === id) || project.cables.some((c) => c.id === id) || (project.belts ?? []).some((b) => b.id === id));
      set({ project, history, selected: alive(s.selected) ? s.selected : null, pending: null });
    },
    redo: () => {
      const s = get();
      const [project, history] = redo(s.project, s.history);
      const alive = (id: number | null) => id !== null && (project.parts.some((p) => p.id === id) || project.cables.some((c) => c.id === id) || (project.belts ?? []).some((b) => b.id === id));
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
  useProject.setState({ circuit: c, mech: solveTrain(s.project, motorSpeeds(s.project, c)) });
});

/** Posición actual de una punta de cable. */
export const cableEndPos = (project: Project, e: CableEnd): Vec3 => endPos(project, e);
