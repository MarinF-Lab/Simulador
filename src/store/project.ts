import { create } from "zustand";
import { cableDiff, emptyHistory, exec, record, redo, removeCableCmd, removeCmd, shapeOf, undo, updateCmd, type CableShape, type Command, type History, type Patch } from "../core/history/commands";
import { analyze, type Circuit } from "../core/electrical/analyze";
import { clampZ, findFree, newPart, placeOnTable, RESIZABLE, type Axis, type Cable, type CableEnd, type Part, type Project, type PropValue, type Vec3 } from "../core/model/project";
import { detachFrom, endPos, posKey, reattach, termWorld } from "../core/model/terminals";
import { snapRotor } from "../core/mechanical/snap";
import { isRotor } from "../core/mechanical/axes";
import { solveTrain, type Train } from "../core/mechanical/train";
import { alignedPairs, holesOf, restHeight, snapHoles, type HoleRef } from "../core/model/holes";
import { checkStructure, type StructureCheck } from "../core/model/structure";
import type { Joint } from "../core/model/project";

/** Junta que se ofrece al soltar una pieza con un agujero alineado. */
export interface JointOffer {
  a: HoleRef;
  b: HoleRef;
  p: Vec3;
  /** Uno de los agujeros es la punta del eje de un motor. */
  shaft: boolean;
}

/** Proyecto con los sensores que la simulación está presionando. */
function withPressed(p: Project, pressed: Record<number, boolean>): Project {
  if (!Object.values(pressed).some(Boolean)) return p;
  return { ...p, parts: p.parts.map((x) => (pressed[x.id] ? { ...x, props: { ...x.props, pressed: true } } : x)) };
}

/** RPM de cada motor según el voltaje que recibe: RPM nominal × V / V nominal. */
export function motorSpeeds(project: Project, circuit: Circuit): Record<number, number> {
  const out: Record<number, number> = {};
  for (const p of project.parts) {
    const v = circuit.readings[p.id]?.v ?? 0;
    if (p.type === "stepper") {
      // Paso a paso: pasos por segundo ÷ pasos por vuelta, si recibe al menos 3 V.
      const spr = typeof p.props.steps === "number" ? p.props.steps : 200;
      const sps = typeof p.props.sps === "number" ? p.props.sps : 100;
      out[p.id] = Math.abs(v) >= 3 && p.props.burned !== true ? (Math.sign(v) * sps * 60) / spr : 0;
      continue;
    }
    if (p.type !== "dcmotor") continue;
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
  structure: StructureCheck;
  jointOffer: JointOffer | null;
  /** Poniendo una unión o una junta desde la biblioteca. */
  jointTool: Joint["kind"] | null;
  acceptJoint: (kind: Joint["kind"]) => void;
  dismissJoint: () => void;
  /** Toque en una pieza con la herramienta Unión o Junta rotacional. */
  jointTap: (id: number, at: Vec3) => void;
  setJointKind: (id: number, kind: Joint["kind"]) => void;
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
  /** Sensores presionados por la simulación: cambian el circuito, no el diseño ni el historial. */
  pressed: Record<number, boolean>;
  setPressed: (p: Record<number, boolean>) => void;
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
/** Corre la pieza para que su agujero h quede justo en el punto p. */
function onHole(part: Part, h: number, p: Vec3): Part {
  const hole = holesOf(part)[h]!;
  return { ...part, x: part.x + p[0] - hole.p[0], y: part.y + p[1] - hole.p[1], z: part.z + p[2] - hole.p[2] };
}

function sample(): Project {
  const P = (id: number, type: string, x: number, y: number, rz = 0, props: Part["props"] = {}, z = 0): Part => ({ id, type, x, y, z, rot: [0, 0, rz], props });
  const bat = P(1, "source", -220, 40, 0, { v: 9 });
  const sw = P(2, "switch", -90, 130);
  const res = P(3, "resistor", 30, 130, 0, { r: 100 });
  const lamp = P(4, "lamp", 60, 10, 0, { vn: 6 });
  // Motor de pie sobre una placa: en su eje, un engranaje de 10 que mueve uno de 40 y un brazo
  // de dos tramos (eslabón y perfil) unidos por juntas rotacionales.
  const plate = P(13, "plate", 200, -40, 0, { lx: 200, ly: 160 });
  const motor: Part = { id: 14, type: "dcmotor", x: 180, y: -40, z: 6, rot: [0, 3, 0], props: { rpm: 30, torque: 0.8, vnom: 12 } };
  const g10: Part = { id: 15, type: "gear10", x: 180, y: -40, z: 57, rot: [0, 0, 0], props: {} };
  const axle: Part = { id: 16, type: "shaft", x: 230, y: -40, z: 6, rot: [0, 3, 0], props: { lx: 60 } };
  const g40: Part = { id: 17, type: "gear40", x: 230, y: -40, z: 57, rot: [0, 0, 0], props: {} };
  const link: Part = { id: 18, type: "link", x: 203, y: -40, z: 66, rot: [0, 0, 0], props: { lx: 60 } };
  const arm: Part = { id: 19, type: "profile60", x: 251, y: -40, z: 72, rot: [0, 0, 0], props: {} };
  const bat2 = P(20, "source", 70, -120, 0, { v: 12 });
  const parts: Part[] = [bat, sw, res, lamp, P(8, "profile240", -60, -80), plate, motor, g10, axle, g40, link, arm, bat2];
  const cables = [wire(9, bat, 1, sw, 0), wire(10, sw, 1, res, 0), wire(11, res, 1, lamp, 1), wire(12, lamp, 0, bat, 0),
    wire(21, bat2, 1, motor, 1), wire(22, motor, 0, bat2, 0)];
  // Brazo robótico de 3 servos alimentado con 6 V: la base gira 180° sobre la placa, y una
  // escuadra lleva el hombro y el codo de lado, para que el brazo suba y baje.
  const plate2 = P(30, "plate", -200, -200, 0, { lx: 160, ly: 120 });
  const servo1: Part = { id: 31, type: "servo", x: -220, y: -190, z: 6, rot: [0, 0, 0], props: { target: 45, speed: 60, torque: 0.8 } };
  const side: Vec3 = [1, 0, 0]; // de lado: el brazo del servo mira hacia −Y y el ángulo positivo sube
  const bracket = onHole({ id: 43, type: "bracket", x: 0, y: 0, z: 0, rot: [0, 0, 0], props: {} }, 3, holesOf(servo1)[2]!.p);
  const servo2 = onHole({ id: 33, type: "servo", x: 0, y: 0, z: 0, rot: side, props: { target: 40, speed: 60, torque: 0.8 } }, 0, holesOf(bracket)[6]!.p);
  const link1 = onHole({ id: 32, type: "link", x: 0, y: 0, z: 0, rot: side, props: { lx: 90 } }, 1, holesOf(servo2)[2]!.p);
  const servo3 = onHole({ id: 44, type: "servo", x: 0, y: 0, z: 0, rot: side, props: { target: -60, speed: 60, torque: 0.8 } }, 0, holesOf(link1)[2]!.p);
  const link2 = onHole({ id: 34, type: "link", x: 0, y: 0, z: 0, rot: side, props: { lx: 80 } }, 1, holesOf(servo3)[2]!.p);
  const bat3 = P(35, "source", -330, -110, 0, { v: 6 });
  parts.push(plate2, servo1, bracket, servo2, link1, servo3, link2, bat3);
  cables.push(wire(36, bat3, 1, servo1, 1), wire(37, bat3, 0, servo1, 0), wire(38, servo1, 1, servo2, 1), wire(39, servo1, 0, servo2, 0),
    wire(45, servo2, 1, servo3, 1), wire(46, servo2, 0, servo3, 0));
  const base: Project = { parts, cables, belts: [], nextId: 47 };
  // Juntas: el eslabón en el eje del motor y el perfil sobre el otro extremo del eslabón.
  const onShaft = alignedPairs(base, 18).find((q) => q.shaft);
  const elbow = alignedPairs(base, 19).find((q) => q.b.part === 18);
  const joints: Joint[] = [];
  if (onShaft) joints.push({ id: 23, kind: "revolute", a: onShaft.a, b: onShaft.b });
  if (elbow) joints.push({ id: 24, kind: "revolute", a: elbow.a, b: elbow.b });
  joints.push(
    { id: 40, kind: "revolute", a: { part: 43, h: 3 }, b: { part: 31, h: 2 } }, // base: la escuadra gira sobre el servo 1
    { id: 41, kind: "fixed", a: { part: 33, h: 0 }, b: { part: 43, h: 6 } }, // servo 2 atornillado de lado a la escuadra
    { id: 42, kind: "revolute", a: { part: 32, h: 1 }, b: { part: 33, h: 2 } }, // hombro: eslabón 1 en el servo 2
    { id: 47, kind: "fixed", a: { part: 44, h: 0 }, b: { part: 32, h: 2 } }, // servo 3 atornillado al final del eslabón 1
    { id: 48, kind: "revolute", a: { part: 34, h: 1 }, b: { part: 44, h: 2 } }, // codo: eslabón 2 en el servo 3
  );
  return { ...base, joints, nextId: 49 };
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
  /** Tras soltar una pieza: si quedó un agujero alineado sin junta, se ofrece una. */
  const offerJoint = (id: number) => {
    const s = get();
    const taken = new Set((s.project.joints ?? []).flatMap((j) => [`${j.a.part}:${j.a.h}`, `${j.b.part}:${j.b.h}`]));
    const pairs = alignedPairs(s.project, id).filter((q) => !taken.has(`${q.a.part}:${q.a.h}`) && !taken.has(`${q.b.part}:${q.b.h}`));
    if (!pairs.length) { set({ jointOffer: null }); return; }
    const best = pairs.find((q) => q.shaft) ?? pairs[0]!;
    set({ jointOffer: best });
  };
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
    structure: checkStructure(initial),
    jointOffer: null,
    jointTool: null,
    acceptJoint: (kind) => {
      const o = get().jointOffer;
      if (!o) return;
      const id = get().project.nextId;
      commit({ kind: "addJoint", joint: { id, kind, a: o.a, b: o.b } });
      set({ jointOffer: null, selected: id });
    },
    dismissJoint: () => set({ jointOffer: null }),
    jointTap: (id, at) => {
      const s = get();
      const kind = s.jointTool;
      if (!kind) return;
      const taken = new Set((s.project.joints ?? []).flatMap((j) => [`${j.a.part}:${j.a.h}`, `${j.b.part}:${j.b.h}`]));
      const pairs = alignedPairs(s.project, id).filter((q) => !taken.has(`${q.a.part}:${q.a.h}`) && !taken.has(`${q.b.part}:${q.b.h}`));
      if (!pairs.length) { set({ selected: id }); return; }
      const d = (p: Vec3) => Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]);
      const best = pairs.reduce((m, q) => (d(q.p) < d(m.p) ? q : m));
      const jid = s.project.nextId;
      commit({ kind: "addJoint", joint: { id: jid, kind, a: best.a, b: best.b } });
      set({ jointTool: null, selected: jid });
    },
    setJointKind: (id, kind) => {
      const j = (get().project.joints ?? []).find((x) => x.id === id);
      if (j && j.kind !== kind) commit({ kind: "updateJoint", id, before: j.kind, after: kind });
    },
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
    select: (selected) => set({ selected, pending: null, beltMode: null, jointTool: null, jointOffer: null }),
    setRotAxis: (rotAxis) => set({ rotAxis }),
    run: commit,

    addNear: (type, x, y) => {
      const s = get();
      if (type === "belt") {
        set({ beltMode: { first: null }, selected: null, pending: null, jointTool: null });
        return -1;
      }
      if (type === "bolt" || type === "joint") {
        set({ jointTool: type === "bolt" ? "fixed" : "revolute", beltMode: null, selected: null, pending: null });
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
        offerJoint(id);
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
      let next: Pick<Part, "x" | "y" | "z" | "rot">;
      if (isRotor(p.type)) {
        const snapped = snapRotor(s.project, { ...p, rot: o.rot, z: o.z }, x, y);
        next = snapped ?? { ...placeOnTable({ ...p, rot: o.rot }, x, y), z: o.z, rot: o.rot };
      } else {
        // Imán de agujeros primero; si no, la pieza se apoya sobre lo que tenga debajo (o la mesa).
        const base = { ...p, rot: o.rot };
        const h = snapHoles(s.project, base, x, y);
        if (h) next = { ...h, rot: o.rot };
        else {
          const at = placeOnTable(base, x, y);
          next = { ...at, z: restHeight(s.project, base, at.x, at.y), rot: o.rot };
        }
      }
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
      offerJoint(id);
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
    pressed: {},
    setPressed: (p) => {
      const cur = get().pressed;
      const same = Object.keys(p).length === Object.keys(cur).length && Object.entries(p).every(([k, v]) => cur[+k] === v);
      if (same) return;
      set({ pressed: p });
      const s = get();
      const c = analyze(withPressed(s.project, p));
      set({ circuit: c, mech: solveTrain(s.project, motorSpeeds(s.project, c)) });
    },
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
      else if (p.type === "hbridge") {
        const order = ["Adelante", "Atrás", "Freno"];
        const cur = typeof p.props.dir === "string" ? order.indexOf(p.props.dir) : 0;
        commit(updateCmd(get().project, id, { props: { dir: order[(Math.max(0, cur) + 1) % 3]! } }));
      }
    },
    remove: (id) => {
      const s = get();
      const belts = s.project.belts ?? [];
      const bi = belts.findIndex((b) => b.id === id);
      const joints = s.project.joints ?? [];
      const ji = joints.findIndex((j) => j.id === id);
      if (ji >= 0) commit({ kind: "removeJoint", joint: joints[ji]!, index: ji });
      else if (bi >= 0) commit({ kind: "removeBelt", belt: belts[bi]!, index: bi });
      else if (isCable(s.project, id)) commit(removeCableCmd(s.project, id));
      else {
        const rm = removeCmd(s.project, id);
        if (!rm) return;
        const detach = cableDiff(s.project.cables, detachFrom(s.project, id));
        // Las correas de una polea borrada y las juntas de la pieza se van con ella.
        const gone: Command[] = [
          ...belts.flatMap((b, index) => (b.a === id || b.b === id ? [{ kind: "removeBelt", belt: b, index } as Command] : [])),
          ...(s.project.joints ?? []).flatMap((j, index) => (j.a.part === id || j.b.part === id ? [{ kind: "removeJoint", joint: j, index } as Command] : [])),
        ];
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
      const alive = (id: number | null) => id !== null && (project.parts.some((p) => p.id === id) || project.cables.some((c) => c.id === id) || (project.belts ?? []).some((b) => b.id === id) || (project.joints ?? []).some((j) => j.id === id));
      set({ project, history, selected: alive(s.selected) ? s.selected : null, pending: null, jointOffer: null });
    },
    redo: () => {
      const s = get();
      const [project, history] = redo(s.project, s.history);
      const alive = (id: number | null) => id !== null && (project.parts.some((p) => p.id === id) || project.cables.some((c) => c.id === id) || (project.belts ?? []).some((b) => b.id === id) || (project.joints ?? []).some((j) => j.id === id));
      set({ project, history, selected: alive(s.selected) ? s.selected : null, pending: null, jointOffer: null });
    },
  };
});

// El circuito se recalcula con cada cambio de la mesa. Si algo se quema, queda marcado
// en la pieza (fuera del historial, como pasaría en la realidad) y se vuelve a calcular.
useProject.subscribe((s, prev) => {
  if (s.project === prev.project) return;
  const c = analyze(withPressed(s.project, s.pressed));
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
  useProject.setState({ circuit: c, mech: solveTrain(s.project, motorSpeeds(s.project, c)), structure: checkStructure(s.project) });
});

/** Posición actual de una punta de cable. */
export const cableEndPos = (project: Project, e: CableEnd): Vec3 => endPos(project, e);
