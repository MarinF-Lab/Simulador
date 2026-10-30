import { create } from "zustand";
import { apply, cableDiff, emptyHistory, exec, record, redo, removeCableCmd, removeCmd, shapeOf, undo, updateCmd, type CableShape, type Command, type History, type Patch } from "../core/history/commands";
import { analyze, type Circuit } from "../core/electrical/analyze";
import { clampZ, extent, findFree, newPart, placeOnTable, RESIZABLE, rotateLocal, unrotateLocal, type Axis, type Cable, type CableEnd, type Part, type Project, type PropValue, type Vec3 } from "../core/model/project";
import { detachFrom, endPos, posKey, reattach, termWorld } from "../core/model/terminals";
import { snapRotor, snapToShaft } from "../core/mechanical/snap";
import { blockers, dropGroup, restOn, slide, slideGroup, sweep, sweepGroup } from "../core/model/footprint";
import { useUI } from "./ui";
import { coaxial, isRotor, motorAxis, rotorAxis } from "../core/mechanical/axes";
import { solveTrain, type Train } from "../core/mechanical/train";
import { alignedPairs, alignTo, holeAt, holesOf, nearestHole, snapHoles, type HoleRef } from "../core/model/holes";
import { GRID_MM } from "../core/model/units";
import { checkStructure, contactSpot, type StructureCheck } from "../core/model/structure";
import { centered, customHoles, edgeDistance, inside, isSimple, parseDrill, parseShape, shapeText, type Pt } from "../core/model/polygon";
import type { Joint } from "../core/model/project";
import { demoProject, wire } from "../core/persistence/examples";

/** Junta que se ofrece al soltar una pieza con un agujero alineado. */
export interface JointOffer {
  a: HoleRef;
  b: HoleRef;
  p: Vec3;
  /** Uno de los agujeros es la punta del eje de un motor. */
  shaft: boolean;
}

/** Pieza libre con su forma recentrada en su caja, sin moverse en la mesa. */
function recentered(p: Part, pts: Pt[]): { x: number; y: number; z: number; props: { shape: string; drill: string } } {
  const c = centered(pts);
  const shape = shapeText(c.pts);
  // Los agujeros perforados se corren con la forma, para no moverse en la mesa.
  const drill = shapeText(parseDrill(p.props.drill).map(([x, y]) => [x - c.off[0], y - c.off[1]]));
  const ez0 = extent(p)[2];
  const d = rotateLocal([c.off[0], c.off[1], 0], p.rot);
  const ez1 = extent({ ...p, props: { ...p.props, shape } })[2];
  const r = (v: number) => Math.round(v * 10) / 10;
  return { x: r(p.x + d[0]), y: r(p.y + d[1]), z: r(p.z + ez0 / 2 + d[2] - ez1 / 2), props: { shape, drill } };
}

/**
 * Proyecto con lo que pasa en vivo: los sensores que la simulación está presionando y los
 * botones del Mando que se mantienen apretados ("pieza:canal" → modo).
 */
function withPressed(p: Project, pressed: Record<number, boolean>, held: Record<string, string> = {}): Project {
  const keys = Object.keys(held);
  if (!Object.values(pressed).some(Boolean) && !keys.length) return p;
  return {
    ...p,
    parts: p.parts.map((x) => {
      let props = x.props;
      if (pressed[x.id]) props = { ...props, pressed: true };
      for (const k of keys) {
        const [id, ch] = k.split(":").map(Number);
        if (id === x.id) props = { ...props, [`m${ch! + 1}`]: held[k]! };
      }
      return props === x.props ? x : { ...x, props };
    }),
  };
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
  /** Agujero de la primera pieza tocada con la herramienta, y un aviso si algo no se pudo. */
  jointFirst: HoleRef | null;
  jointMsg: string | null;
  acceptJoint: (kind: Joint["kind"]) => void;
  dismissJoint: () => void;
  /** Toque en una pieza con la herramienta Unión o Junta rotacional. */
  jointTap: (id: number, at: Vec3) => void;
  setJointKind: (id: number, kind: Joint["kind"]) => void;
  /** Poniendo una correa: null = no; first = primera polea tocada. */
  beltMode: { first: number | null; rope?: boolean } | null;
  /** Posición de la pieza al empezar a arrastrarla (para deshacer). */
  dragFrom: Pick<Part, "x" | "y" | "z" | "rot"> | null;
  /** Toque en una pieza mientras se pone una correa. */
  beltTap: (id: number) => void;
  toggleCross: (id: number) => void;
  select: (id: number | null) => void;
  /** Modo Varias: tocar agrega o quita piezas del grupo; arrastrar una mueve todo el grupo. */
  multiMode: boolean;
  multi: number[];
  setMultiMode: (on: boolean) => void;
  toggleMulti: (id: number) => void;
  /** Agrega al grupo lo unido a él (juntas, pegamento y lo que gira en el mismo eje). */
  addLinked: () => void;
  /** Borra todas las piezas del grupo (se deshace en un paso). */
  removeGroup: () => void;
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
  /** Sube (+1) o baja (−1) la pieza un paso, sin atravesar otras piezas. */
  nudgeZ: (id: number, dir: 1 | -1) => void;
  /** Lleva la pieza a una altura escrita; se detiene si toca otra pieza. Devuelve la altura final. */
  moveZTo: (id: number, z: number) => number;
  setProp: (id: number, key: string, v: PropValue) => void;
  replace: (id: number) => void;
  /** Accionar: abre o cierra un interruptor, presiona o suelta un sensor de contacto. */
  actuate: (id: number) => void;
  /** Cambia el largo (lx) o el ancho (ly) de una estructura, de 10 en 10 mm. */
  setSize: (id: number, key: "lx" | "ly" | "lz", mm: number) => void;
  /** Sensores presionados por la simulación: cambian el circuito, no el diseño ni el historial. */
  pressed: Record<number, boolean>;
  /** Botones del Mando mantenidos ("pieza:canal" → modo): cambian el circuito mientras se apretan. */
  held: Record<string, string>;
  setHeld: (part: number, k: number, mode: string | null) => void;
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
  /** Dibujando una pieza libre: vértices puestos en la mesa (mm). */
  drawMode: { pts: Pt[]; msg?: string } | null;
  drawAdd: (x: number, y: number) => void;
  drawUndo: () => void;
  drawCancel: () => void;
  /** Cierra la forma y crea la pieza. Devuelve false si la forma no sirve. */
  drawFinish: () => boolean;
  /** Al dibujar: la pieza nueva sale con agujeros cada 10 mm o lisa. */
  drawHoles: boolean;
  setDrawHoles: (v: boolean) => void;
  /** Taladro activo, y un aviso si un toque no se pudo perforar. */
  drillMode: { msg?: string } | null;
  /** Toque con el Taladro: perfora la pieza libre en ese punto (o tapa un agujero perforado). */
  drillTap: (id: number, at: Vec3) => void;
  /** Pegando: la primera pieza tocada y, si hace falta, un aviso. */
  glueMode: { first: number | null; msg?: string } | null;
  glueTap: (id: number) => void;
  /** Qué hace arrastrar una pieza libre seleccionada: moverla o editar su forma. */
  shapeMode: "move" | "edit";
  setShapeMode: (m: "move" | "edit") => void;
  /** Vértice elegido de la pieza libre (para quitarlo). */
  selVertex: number | null;
  selectVertex: (i: number | null) => void;
  /** Forma y posición al empezar a editar (para deshacer). */
  shapeFrom: { x: number; y: number; z: number; shape: string; drill: string } | null;
  beginShape: (id: number) => void;
  /** Cambia la forma en vivo, sin historial. Devuelve false si los lados se cruzarían. */
  shapeLive: (id: number, pts: Pt[]) => boolean;
  endShape: (id: number) => void;
  /** Agrega un vértice en el medio del lado i. */
  insertVertex: (id: number, edge: number) => void;
  removeVertex: (id: number, i: number) => void;
  /** Cambia la forma de un cable en vivo, sin historial. */
  setCableLive: (id: number, shape: CableShape) => void;
  /** Deja el cable recto otra vez. */
  straighten: (id: number) => void;
  undo: () => void;
  redo: () => void;
  /** Reemplaza la mesa por otro proyecto (ejemplo, archivo o guardado). No se puede deshacer. */
  load: (project: Project) => void;
}

const isCable = (p: Project, id: number) => p.cables.some((c) => c.id === id);

export const useProject = create<ProjectState>((set, get) => {
  const commit = (c: Command | null) => {
    if (!c) return;
    const s = get();
    const [project, history] = exec(s.project, s.history, c);
    set({ project, history });
  };
  const part = (id: number) => get().project.parts.find((p) => p.id === id);
  const stepNow = () => (useUI.getState().magnet ? GRID_MM : 1);
  /** Si mover la pieza a `at` deja sus juntas y pegamentos funcionando. */
  const keepsJoints = (project: Project, id: number, at: { x: number; y: number; z: number }) => {
    const mine = (project.joints ?? []).filter((j) => j.a.part === id || j.b.part === id);
    if (!mine.length) return true;
    const moved = { ...project, parts: project.parts.map((q) => (q.id === id ? { ...q, ...at } : q)) };
    const before = checkStructure(project).broken, after = checkStructure(moved).broken;
    return mine.every((j) => before.has(j.id) || !after.has(j.id));
  };
  /** Posición de cada pieza del grupo al empezar a arrastrarlo (null si se arrastra una sola). */
  let groupFrom: Map<number, Pick<Part, "x" | "y" | "z" | "rot">> | null = null;
  /** Al soltar sin imán, la pieza cae hasta apoyarse en lo que tenga debajo (o la mesa). */
  const drop = (id: number) => {
    const s = get();
    const p = part(id);
    if (!p || useUI.getState().magnet || isRotor(p.type) || p.type === "text") return;
    // Las piezas unidas con juntas o pegamento se quedan donde están (las sostiene la unión).
    if ((s.project.joints ?? []).some((j) => j.a.part === id || j.b.part === id)) return;
    // Centrada en un eje: el eje la sostiene.
    const sh = snapToShaft(s.project, p, p.x, p.y, 0.3);
    if (sh && Math.abs(sh.x - p.x) < 0.3 && Math.abs(sh.y - p.y) < 0.3 && Math.abs(sh.z - p.z) < 0.3) return;
    const z = restOn(s.project, p, p.x, p.y, p.z);
    if (z < p.z - 0.05) set({ project: { ...s.project, parts: s.project.parts.map((q) => (q.id === id ? { ...q, z } : q)) } });
  };
  const cable = (id: number) => get().project.cables.find((c) => c.id === id);
  const setCables = (cables: Cable[]) => set({ project: { ...get().project, cables } });
  const initial = demoProject();
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
    load: (project) =>
      set({ project, history: emptyHistory(), selected: null, dragging: null, dragFrom: null, pending: null, jointOffer: null, jointTool: null, beltMode: null, pressed: {}, held: {}, drawMode: null, glueMode: null, selVertex: null, shapeFrom: null, jointFirst: null, jointMsg: null, drillMode: null, multi: [], multiMode: false }),
    jointFirst: null,
    jointMsg: null,
    jointTap: (id, at) => {
      const s = get();
      const kind = s.jointTool;
      if (!kind) return;
      const taken = new Set((s.project.joints ?? []).flatMap((j) => [`${j.a.part}:${j.a.h}`, `${j.b.part}:${j.b.h}`]));
      const me = part(id);
      if (!me) return;
      const done = (cmds: Command[], jid: number) => {
        commit(cmds.length > 1 ? { kind: "batch", cmds } : cmds[0]!);
        set({ jointTool: null, jointFirst: null, jointMsg: null, selected: jid });
      };
      const first = s.jointFirst;
      if (!first || first.part === id) {
        // Primer toque: si ya hay un agujero alineado con otra pieza cerca del toque, se une de una vez.
        const d = (p: Vec3) => Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]);
        const pairs = alignedPairs(s.project, id).filter((q) => !taken.has(`${q.a.part}:${q.a.h}`) && !taken.has(`${q.b.part}:${q.b.h}`) && d(q.p) < 25);
        if (pairs.length && !first) {
          const best = pairs.reduce((m, q) => (d(q.p) < d(m.p) ? q : m));
          done([{ kind: "addJoint", joint: { id: s.project.nextId, kind, a: best.a, b: best.b } }], s.project.nextId);
          return;
        }
        const h = nearestHole(me, at);
        if (h < 0) {
          set({ jointMsg: "Esta pieza no tiene agujeros. Para unirla igual, usa Pegamento.", selected: id });
          return;
        }
        set({ jointFirst: { part: id, h }, jointMsg: null, selected: id });
        return;
      }
      // Segundo toque: el agujero de cara opuesta más cercano, y una de las dos piezas se mueve sola.
      const other = part(first.part), target = holeAt(s.project, first);
      if (!other || !target) { set({ jointFirst: null }); return; }
      const hb = nearestHole(me, at, target.n);
      if (hb < 0) {
        set({ jointMsg: holesOf(me).length ? "Los agujeros de estas piezas no quedan paralelos: gira una (botón ⟳) para que miren igual y vuelve a intentarlo." : "Esta pieza no tiene agujeros. Para unirla igual, usa Pegamento." });
        return;
      }
      // Se mueve la segunda pieza, salvo que sea una base, un motor o algo que gira en un eje.
      const anchorLike = (p: Part) => p.type === "plate" || isRotor(p.type) || p.type === "dcmotor" || p.type === "stepper" || p.type === "servo";
      const moveFirst = anchorLike(me) && !anchorLike(other);
      const mover = moveFirst ? other : me;
      const pos = moveFirst ? alignTo(other, first.h, holesOf(me)[hb]!) : alignTo(me, hb, target);
      if (!pos) return;
      if (pos.z < -0.01) {
        set({ jointMsg: "Así quedaría bajo la mesa: sube la otra pieza (Altura en Propiedades) y vuelve a intentarlo." });
        return;
      }
      const jid = s.project.nextId;
      const move = updateCmd(s.project, mover.id, { x: pos.x, y: pos.y, z: Math.max(0, pos.z) });
      const joint: Command = { kind: "addJoint", joint: { id: jid, kind, a: first, b: { part: id, h: hb } } };
      done(move ? [move, joint] : [joint], jid);
    },
    setJointKind: (id, kind) => {
      const j = (get().project.joints ?? []).find((x) => x.id === id);
      if (j && j.kind !== kind) commit({ kind: "updateJoint", id, before: j.kind, after: kind });
    },
    beltTap: (id) => {
      const s = get();
      const bm = s.beltMode;
      const p = part(id);
      if (!bm || !p) return;
      // La cuerda va de una polea tambor a cualquier pieza que no gire con el tren.
      if (bm.first === null) { if (p.type.startsWith("pulley")) set({ beltMode: { ...bm, first: id }, selected: id }); return; }
      if (bm.first === id) return;
      if (bm.rope) {
        if (isRotor(p.type)) return;
        const rid = s.project.nextId;
        commit({ kind: "addBelt", belt: { id: rid, a: bm.first, b: id, cross: false, rope: true } });
        set({ beltMode: null, selected: rid });
        return;
      }
      if (!p.type.startsWith("pulley")) return;
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
    multiMode: false,
    multi: [],
    setMultiMode: (on) => {
      const s = get();
      const sel = s.selected !== null && s.project.parts.some((p) => p.id === s.selected) ? [s.selected] : [];
      set({ multiMode: on, multi: on ? sel : [], selected: on && sel.length ? s.selected : null, beltMode: null, jointTool: null, glueMode: null, drillMode: null, drawMode: null, pending: null });
    },
    toggleMulti: (id) => {
      const m = get().multi;
      set({ multi: m.includes(id) ? m.filter((x) => x !== id) : [...m, id], selected: m.includes(id) ? null : id });
    },
    addLinked: () => {
      const s = get();
      const have = new Set(s.multi);
      const axes = new Map(s.project.parts.map((p) => [p.id, rotorAxis(p) ?? motorAxis(p)]));
      for (let grew = true; grew;) {
        grew = false;
        // Juntas y pegamento, engranajes que engranan y poleas con correa o cuerda.
        const pairs: [number, number][] = [
          ...(s.project.joints ?? []).map((j): [number, number] => [j.a.part, j.b.part]),
          ...s.mech.meshes.map((m): [number, number] => [m.a, m.b]),
          ...(s.project.belts ?? []).map((b): [number, number] => [b.a, b.b]),
        ];
        for (const [x, y] of pairs) {
          const a = have.has(x), b = have.has(y);
          if (a !== b) { have.add(a ? y : x); grew = true; }
        }
        for (const p of s.project.parts) {
          if (have.has(p.id)) continue;
          const A = axes.get(p.id);
          if (A && [...have].some((h) => { const B = axes.get(h); return !!B && coaxial(A, B); })) { have.add(p.id); grew = true; }
        }
      }
      set({ multi: s.project.parts.filter((p) => have.has(p.id)).map((p) => p.id) });
    },
    removeGroup: () => {
      const ids = get().multi;
      const n0 = get().history.past.length;
      for (const id of ids) get().remove(id);
      const h = get().history, added = h.past.slice(n0);
      if (added.length > 1) set({ history: { past: [...h.past.slice(0, n0), { kind: "batch", cmds: added }], future: [] } });
      set({ multi: [], selected: null });
    },
    select: (selected) => set({ selected, pending: null, beltMode: null, jointTool: null, jointFirst: null, jointMsg: null, jointOffer: null, glueMode: null, drillMode: null, selVertex: null }),
    setRotAxis: (rotAxis) => set({ rotAxis }),
    run: commit,

    addNear: (type, x, y) => {
      const s = get();
      if (type === "drill") {
        set({ drillMode: {}, drawMode: null, glueMode: null, beltMode: null, jointTool: null, jointFirst: null, pending: null });
        return -1;
      }
      if (type === "draw") {
        set({ drawMode: { pts: [] }, glueMode: null, beltMode: null, jointTool: null, selected: null, pending: null });
        return -1;
      }
      if (type === "glue") {
        set({ glueMode: { first: null }, drawMode: null, beltMode: null, jointTool: null, selected: null, pending: null });
        return -1;
      }
      if (type === "belt" || type === "rope") {
        set({ beltMode: { first: null, rope: type === "rope" }, selected: null, pending: null, jointTool: null });
        return -1;
      }
      if (type === "bolt" || type === "joint") {
        set({ jointTool: type === "bolt" ? "fixed" : "revolute", jointFirst: null, jointMsg: null, beltMode: null, glueMode: null, drawMode: null, selected: null, pending: null });
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
      if (part(id)) drop(id);
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
      if (groupFrom && groupFrom.has(id)) {
        // Grupo: se mueve rígido según la pieza tocada, sin atravesar lo de afuera.
        const f = groupFrom.get(id)!, step = stepNow();
        const want = { x: Math.round((x - f.x) / step) * step - (p.x - f.x), y: Math.round((y - f.y) / step) * step - (p.y - f.y), z: 0 };
        const members = s.project.parts.filter((q) => groupFrom!.has(q.id));
        // Sin salir de la mesa.
        for (const q of members) {
          const at = placeOnTable(q, q.x + want.x, q.y + want.y, 0.1);
          want.x += at.x - (q.x + want.x);
          want.y += at.y - (q.y + want.y);
        }
        const d = slideGroup(s.project, members, want);
        if (!d.x && !d.y) return;
        set({ project: { ...s.project, parts: s.project.parts.map((q) => (groupFrom!.has(q.id) ? { ...q, x: Math.round((q.x + d.x) * 10) / 10, y: Math.round((q.y + d.y) * 10) / 10 } : q)) } });
        return;
      }
      const magnet = useUI.getState().magnet;
      const o = s.dragFrom ?? p;
      const base = { ...p, rot: o.rot };
      // Lo que ya atravesaba al empezar no la frena (así puede salir de ahí).
      let now: Set<number> | null = null;
      const free = (n: { x: number; y: number; z: number }) => {
        now ??= new Set(blockers(s.project, base, p));
        const start = now;
        return blockers(s.project, base, n).every((b) => start.has(b));
      };
      let next: { x: number; y: number; z: number } | null = null;
      if (isRotor(p.type)) {
        // Engranajes y poleas: imán al eje de un motor, a otro eje o a la distancia de engrane.
        const snapped = snapRotor(s.project, base, x, y, magnet ? 16 : 4);
        if (snapped) {
          if (snapped.x !== p.x || snapped.y !== p.y || snapped.z !== p.z || snapped.rot.join() !== p.rot.join()) {
            set({ project: { ...s.project, parts: s.project.parts.map((q) => (q.id === id ? { ...q, ...snapped } : q)) } });
          }
          return;
        }
      }
      // Un agujero de la pieza (o el eje de un motor) cerca de un eje suelto: se centra en él.
      let onShaft = !isRotor(p.type) ? snapToShaft(s.project, base, x, y, magnet ? 16 : 4) : null;
      // Sin romper sus uniones: si centrarla en altura despega su pegamento, solo se centra en planta
      // (los agujeros tienen juego: medio milímetro no impide que el eje pase).
      if (onShaft && keepsJoints(s.project, id, onShaft) === false) {
        const flat = { ...onShaft, z: p.z };
        onShaft = keepsJoints(s.project, id, flat) ? flat : null;
      }
      if (onShaft && free(onShaft)) next = onShaft;
      else if (!isRotor(p.type) && magnet) {
        // Con imán: agujeros primero; si no, la pieza se apoya sobre lo que tenga debajo.
        const h = snapHoles(s.project, base, x, y);
        if (h && free(h)) next = h;
        else {
          const at = placeOnTable(base, x, y, GRID_MM);
          const on = { ...at, z: restOn(s.project, base, at.x, at.y) };
          if (free(on)) next = on;
        }
      }
      if (!next) {
        // Sin imán (o si el imán choca): se mueve a su altura y se detiene al tocar otra pieza.
        const at = placeOnTable(base, x, y, magnet ? GRID_MM : 1);
        next = slide(s.project, base, p, { ...at, z: p.z });
        if (magnet && !isRotor(p.type)) next = { ...next, z: restOn(s.project, base, next.x, next.y, next.z) };
      }
      if (next.x === p.x && next.y === p.y && next.z === p.z && o.rot.join() === p.rot.join()) return;
      const n = next;
      set({ project: { ...s.project, parts: s.project.parts.map((q) => (q.id === id ? { ...q, ...n, rot: o.rot } : q)) } });
    },
    beginDrag: (id) => {
      const p = part(id);
      const s = get();
      groupFrom = s.multiMode && s.multi.includes(id) && s.multi.length > 1
        ? new Map(s.project.parts.filter((q) => s.multi.includes(q.id)).map((q) => [q.id, { x: q.x, y: q.y, z: q.z, rot: q.rot }]))
        : null;
      set({ dragging: id, selected: id, pending: null, dragFrom: p ? { x: p.x, y: p.y, z: p.z, rot: p.rot } : null });
    },
    endDrag: (id, fromXY) => {
      if (groupFrom) {
        const from = groupFrom;
        groupFrom = null;
        set({ dragging: null, dragFrom: null });
        let s = get();
        // Sin imán, el grupo baja junto hasta apoyarse (si nada de afuera lo sostiene con juntas).
        const members = s.project.parts.filter((q) => from.has(q.id));
        const heldOut = (s.project.joints ?? []).some((j) => from.has(j.a.part) !== from.has(j.b.part));
        if (!useUI.getState().magnet && !heldOut) {
          const dz = dropGroup(s.project, members);
          if (dz > 0.05) set({ project: { ...s.project, parts: s.project.parts.map((q) => (from.has(q.id) ? { ...q, z: Math.round((q.z - dz) * 10) / 10 } : q)) } });
        }
        s = get();
        const moves: Command[] = s.project.parts.filter((q) => from.has(q.id)).flatMap((q) => {
          const f = from.get(q.id)!;
          return q.x === f.x && q.y === f.y && q.z === f.z ? [] : [{ kind: "update", id: q.id, before: { x: f.x, y: f.y, z: f.z }, after: { x: q.x, y: q.y, z: q.z } } as Command];
        });
        if (!moves.length) return;
        const cables = reattach(s.project);
        const extra = cableDiff(s.project.cables, cables);
        set({ project: { ...s.project, cables }, history: record(s.history, { kind: "batch", cmds: [...moves, ...extra] }) });
        return;
      }
      let s = get();
      let p = part(id);
      const from = s.dragFrom ?? { ...fromXY, z: p?.z ?? 0, rot: p?.rot ?? [0, 0, 0] };
      set({ dragging: null, dragFrom: null });
      if (p) drop(id);
      p = part(id);
      if (!p || (p.x === from.x && p.y === from.y && p.z === from.z && p.rot.join() === from.rot.join())) return;
      s = get();
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
      const at = placeOnTable({ ...p, rot }, p.x, p.y, stepNow());
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
    nudgeZ: (id, dir) => {
      const p = part(id);
      if (!p) return;
      const step = useUI.getState().magnet ? GRID_MM : 1;
      const s0 = get();
      if (s0.multiMode && s0.multi.length > 1 && s0.multi.includes(id)) {
        const members = s0.project.parts.filter((q) => s0.multi.includes(q.id));
        const low = Math.min(...members.map((q) => q.z));
        const want = Math.max(-low, dir * step);
        const d = sweepGroup(s0.project, members, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: want });
        if (Math.abs(d.z) < 0.05) return;
        commit({ kind: "batch", cmds: members.map((q) => updateCmd(s0.project, q.id, { z: clampZ(q.z + d.z) })).filter((c): c is Command => c !== null) });
        return;
      }
      const to = sweep(get().project, p, p, { x: p.x, y: p.y, z: clampZ(p.z + dir * step) });
      if (to.z !== p.z) commit(updateCmd(get().project, id, { z: clampZ(to.z) }, `${id}:z`));
    },
    moveZTo: (id, z) => {
      const p = part(id);
      if (!p) return 0;
      const to = clampZ(sweep(get().project, p, p, { x: p.x, y: p.y, z: clampZ(z) }).z);
      if (to !== p.z) commit(updateCmd(get().project, id, { z: to }, `${id}:z`));
      return to;
    },
    setProp: (id, key, v) => commit(updateCmd(get().project, id, { props: { [key]: v } } as Patch, `${id}:${key}`)),
    replace: (id) => commit(updateCmd(get().project, id, { props: { burned: undefined, burnV: undefined } })),
    pressed: {},
    held: {},
    setHeld: (id, k, mode) => {
      const key = `${id}:${k}`;
      const cur = get().held;
      if ((cur[key] ?? null) === mode) return;
      const held = { ...cur };
      if (mode === null) delete held[key]; else held[key] = mode;
      set({ held });
      const s = get();
      const c = analyze(withPressed(s.project, s.pressed, held));
      set({ circuit: c, mech: solveTrain(s.project, motorSpeeds(s.project, c)) });
    },
    setPressed: (p) => {
      const cur = get().pressed;
      const same = Object.keys(p).length === Object.keys(cur).length && Object.entries(p).every(([k, v]) => cur[+k] === v);
      if (same) return;
      set({ pressed: p });
      const s = get();
      const c = analyze(withPressed(s.project, p, s.held));
      set({ circuit: c, mech: solveTrain(s.project, motorSpeeds(s.project, c)) });
    },
    setSize: (id, key, mm) => {
      const p = part(id);
      const range = p && RESIZABLE[p.type]?.[key];
      if (!p || !range) return;
      const step = key === "lz" ? 1 : 10;
      const v = Math.min(range[1], Math.max(range[0], Math.round(mm / step) * step));
      const next = { ...p, props: { ...p.props, [key]: v } };
      const at = placeOnTable(next, p.x, p.y, stepNow());
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
      if (get().multi.includes(id)) set({ multi: get().multi.filter((x) => x !== id) });
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

    drawMode: null,
    drawAdd: (x, y) => {
      const d = get().drawMode;
      if (d) set({ drawMode: { pts: [...d.pts, [x, y]] } });
    },
    drawUndo: () => {
      const d = get().drawMode;
      if (d) set({ drawMode: { pts: d.pts.slice(0, -1) } });
    },
    drawCancel: () => set({ drawMode: null }),
    drawFinish: () => {
      const s = get(), d = s.drawMode;
      if (!d) return false;
      if (d.pts.length < 3 || !isSimple(d.pts)) {
        set({ drawMode: { pts: d.pts, msg: d.pts.length < 3 ? "Pon al menos 3 puntos." : "Los lados se cruzan: quita el último punto y prueba otro camino." } });
        return false;
      }
      const c = centered(d.pts);
      const p = newPart(s.project, s.drawHoles ? "custom" : "customPlain", c.off[0], c.off[1]);
      p.props = { ...p.props, shape: shapeText(c.pts) };
      commit({ kind: "add", part: p });
      set({ drawMode: null, selected: p.id, shapeMode: "move" });
      return true;
    },

    drawHoles: true,
    setDrawHoles: (drawHoles) => set({ drawHoles }),
    drillMode: null,
    drillTap: (id, at) => {
      const p = part(id);
      if (!get().drillMode || !p) return;
      if (p.type !== "custom") { set({ drillMode: { msg: "El Taladro solo perfora piezas libres." }, selected: id }); return; }
      const ez = extent(p)[2];
      const l = unrotateLocal([at[0] - p.x, at[1] - p.y, at[2] - (p.z + ez / 2)], p.rot);
      const q: Pt = [Math.round(l[0]), Math.round(l[1])];
      const drill = parseDrill(p.props.drill);
      // Tocar un agujero perforado lo tapa.
      const near = drill.findIndex((d) => Math.hypot(d[0] - q[0], d[1] - q[1]) < 6);
      let next: Pt[];
      if (near >= 0) next = drill.filter((_, i) => i !== near);
      else {
        const pts = parseShape(p.props.shape);
        if (!inside(q, pts) || edgeDistance(q, pts) < 3) { set({ drillMode: { msg: "Muy cerca del borde: perfora un poco más adentro." }, selected: id }); return; }
        if (customHoles(p.props).some((h) => Math.hypot(h[0] - q[0], h[1] - q[1]) < 6)) { set({ drillMode: { msg: "Ya hay un agujero ahí." }, selected: id }); return; }
        next = [...drill, q];
      }
      commit(updateCmd(get().project, id, { props: { drill: next.length ? shapeText(next) : undefined } }));
      set({ drillMode: {}, selected: id });
    },

    glueMode: null,
    glueTap: (id) => {
      const s = get(), g = s.glueMode;
      if (!g) return;
      if (g.first === null || g.first === id) { set({ glueMode: { first: id }, selected: id }); return; }
      const a = part(g.first), b = part(id);
      if (!a || !b) return;
      if (!contactSpot(a, b)) {
        set({ glueMode: { first: g.first, msg: "Esas piezas no se tocan: júntalas y vuelve a intentarlo." } });
        return;
      }
      const same = (s.project.joints ?? []).find((j) => j.kind === "glue" && ((j.a.part === a.id && j.b.part === b.id) || (j.a.part === b.id && j.b.part === a.id)));
      const jid = same?.id ?? s.project.nextId;
      if (!same) commit({ kind: "addJoint", joint: { id: jid, kind: "glue", a: { part: a.id, h: -1 }, b: { part: b.id, h: -1 } } });
      set({ glueMode: null, selected: jid });
    },

    shapeMode: "move",
    setShapeMode: (shapeMode) => set({ shapeMode, selVertex: null }),
    selVertex: null,
    selectVertex: (selVertex) => set({ selVertex }),
    shapeFrom: null,
    beginShape: (id) => {
      const p = part(id);
      if (p) set({ shapeFrom: { x: p.x, y: p.y, z: p.z, shape: String(p.props.shape), drill: String(p.props.drill ?? "") } });
    },
    shapeLive: (id, pts) => {
      if (!isSimple(pts)) return false;
      const s = get();
      set({ project: { ...s.project, parts: s.project.parts.map((p) => (p.id === id ? { ...p, props: { ...p.props, shape: shapeText(pts) } } : p)) } });
      return true;
    },
    endShape: (id) => {
      const s = get(), p = part(id), from = s.shapeFrom;
      set({ shapeFrom: null });
      if (!p || !from) return;
      const after = recentered(p, parseShape(p.props.shape));
      if (from.shape === after.props.shape && from.x === after.x && from.y === after.y && from.z === after.z) return;
      const opt = (v: string) => v || undefined;
      const cmd: Command = {
        kind: "update", id,
        before: { x: from.x, y: from.y, z: from.z, props: { shape: from.shape, drill: opt(from.drill) } },
        after: { x: after.x, y: after.y, z: after.z, props: { shape: after.props.shape, drill: opt(after.props.drill) } },
      };
      set({ project: apply({ ...s.project, parts: s.project.parts.map((q) => (q.id === id ? { ...q, x: from.x, y: from.y, z: from.z, props: { ...q.props, shape: from.shape } } : q)) }, cmd), history: record(s.history, cmd) });
    },
    insertVertex: (id, edge) => {
      const p = part(id);
      const pts = p ? parseShape(p.props.shape) : [];
      if (!p || !pts.length) return;
      const a = pts[edge]!, b = pts[(edge + 1) % pts.length]!;
      const next = [...pts.slice(0, edge + 1), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Pt, ...pts.slice(edge + 1)];
      commit(updateCmd(get().project, id, { props: { shape: shapeText(next) } }));
      set({ selVertex: edge + 1 });
    },
    removeVertex: (id, i) => {
      const p = part(id);
      const pts = p ? parseShape(p.props.shape) : [];
      if (!p || pts.length <= 3) return;
      const next = pts.filter((_, k) => k !== i);
      if (!isSimple(next)) return;
      const r = recentered(p, next);
      commit(updateCmd(get().project, id, { x: r.x, y: r.y, z: r.z, props: { shape: r.props.shape, drill: r.props.drill || undefined } }));
      set({ selVertex: null });
    },
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
  const c = analyze(withPressed(s.project, s.pressed, s.held));
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
