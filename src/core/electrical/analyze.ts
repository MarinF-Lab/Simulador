// Convierte la mesa en un circuito: nodos por posición de bornes y puntas de cable.

import { findItem } from "../model/catalog";
import type { Part, Project } from "../model/project";
import { endPos, posKey, TERMINALS, termWorld } from "../model/terminals";
import { fmt } from "../model/units";
import { diagnose, simulate, type Elem, type ElemKind, type Issue, type Reading, type Wire } from "./circuit";
import { channelId, channelOf, CHANNELS, effectiveMode, gainOf } from "./controller";

const KIND: Record<string, ElemKind> = {
  source: "bat", resistor: "res", switch: "sw", sensorContact: "sw", lamp: "bulb", dcmotor: "motor", led: "led", meter: "meter",
  servo: "motor", stepper: "motor", linear: "motor",
};

/** Valores por defecto de las piezas eléctricas. Los usa también el panel de Propiedades. */
export const ELEC_DEFAULTS: Record<string, Record<string, number | boolean>> = {
  source: { v: 9 }, resistor: { r: 100 }, lamp: { vn: 6 }, led: { vf: 2 }, switch: { closed: true }, dcmotor: { vnom: 12 },
  sensorContact: { pressed: false },
};

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function elemName(type: string, props: Record<string, unknown>): string {
  const p = (k: string) => num(props[k], num(ELEC_DEFAULTS[type]?.[k], 0));
  switch (type) {
    case "source": return `La pila de ${fmt(p("v"))} V`;
    case "resistor": return `La resistencia de ${p("r") >= 1000 ? `${fmt(p("r") / 1000)} kΩ` : `${fmt(p("r"))} Ω`}`;
    case "lamp": return `La ampolleta de ${fmt(p("vn"))} V`;
    case "led": return "El LED";
    case "switch": return "El interruptor";
    case "sensorContact": return "El sensor de contacto";
    case "servo": return "El servo";
    case "stepper": return "El motor paso a paso";
    case "linear": return "El actuador lineal";
    case "hbridge": return "El puente H";
    case "controller": return "La placa de control";
    case "dcmotor": return "El motor";
    case "meter": return "El voltímetro";
    default: return findItem(type)?.name ?? "La pieza";
  }
}

export interface Circuit {
  readings: Record<number, Reading>;
  ledOn: Record<number, boolean>;
  burns: { id: number; v: number }[];
  issues: Issue[];
  flag: Record<number, "err" | "warn">;
  /** Lado de cada cable: "+" si toca el + de una pila, "-" si toca el −. */
  side: Record<number, "+" | "-" | null>;
  /** Cuántas cosas hay en la posición de cada borne o punta (para marcar las sueltas). */
  occAt: (key: string) => number;
}

export function analyze(project: Project): Circuit {
  const idx = new Map<string, number>();
  const occ: number[] = [];
  const node = (k: string) => {
    let n = idx.get(k);
    if (n === undefined) { n = idx.size; idx.set(k, n); occ.push(0); }
    return n;
  };
  const elems: Elem[] = [];
  // Ids internos del circuito → pieza que los muestra (entrada del puente H, canales).
  const owner = new Map<number, number>();
  // Repartidor: sus salidas son el mismo nodo que su entrada (− con −, + con +). Va primero para
  // que lo que toque sus bornes caiga en ese nodo.
  for (const part of project.parts.filter((p) => p.type === "splitter")) {
    const pin = [node(posKey(termWorld(part, 0))), node(posKey(termWorld(part, 1)))];
    for (let t = 0; t < (TERMINALS.splitter?.length ?? 0); t++) {
      const k = posKey(termWorld(part, t));
      if (t > 1 && !idx.has(k)) idx.set(k, pin[t % 2]!);
      occ[idx.get(k)!]!++;
    }
  }
  // Canales de las placas de control: se agregan después de los cables, solo si su salida está usada.
  const pending: { part: number; k: number; a: number; b: number; ca: number; cb: number; gain: number; off: boolean }[] = [];
  const pressed = new Set(project.parts.filter((p) => p.type === "sensorContact" && p.props.pressed === true).map((p) => p.id));
  // Sensores que usa algún canal: avisan a la placa sin cables, así que sin cables no cuentan como sueltos.
  const linked = new Set(project.parts.filter((p) => p.type === "controller").flatMap((p) => Array.from({ length: CHANNELS }, (_, k) => channelOf(p, k).sensor)));
  const later: Part[] = [];
  for (const part of project.parts) {
    if (part.type === "splitter") continue;
    // Placa de control: la entrada es una carga de 10 kΩ y cada canal una fuente controlada
    // que toma de la entrada la corriente que entrega.
    if (part.type === "controller") {
      const n = Array.from({ length: 2 + 2 * CHANNELS }, (_, t) => node(posKey(termWorld(part, t))));
      n.forEach((x) => occ[x]!++);
      elems.push({ id: part.id, kind: "res", a: n[0]!, b: n[1]!, r: 10_000, name: elemName(part.type, part.props) });
      for (let k = 0; k < CHANNELS; k++) {
        const c = channelOf(part, k);
        const mode = effectiveMode(c, pressed.has(c.sensor));
        pending.push({ part: part.id, k, a: n[2 + 2 * k]!, b: n[3 + 2 * k]!, ca: n[0]!, cb: n[1]!, gain: gainOf(mode, c.power), off: mode === "Apagado" });
      }
      continue;
    }
    // Puente H: la entrada es una carga de 1 kΩ y la salida, una fuente que copia el voltaje de
    // entrada con el signo del sentido elegido (Adelante +1, Atrás −1, Freno 0).
    if (part.type === "hbridge") {
      const n = [0, 1, 2, 3].map((t) => node(posKey(termWorld(part, t))));
      n.forEach((x) => occ[x]!++);
      const dir = part.props.dir;
      const gain = dir === "Atrás" ? -1 : dir === "Freno" ? 0 : 1;
      const name = elemName(part.type, part.props);
      elems.push({ id: -part.id, kind: "res", a: n[0]!, b: n[1]!, r: 1000, name });
      owner.set(-part.id, part.id);
      elems.push({ id: part.id, kind: "src", a: n[2]!, b: n[3]!, gain, ca: n[0]!, cb: n[1]!, name });
      continue;
    }
    if (part.type === "sensorContact" && linked.has(part.id)) { later.push(part); continue; }
    addElem(part);
  }
  function addElem(part: Part) {
    const kind = KIND[part.type];
    if (!kind || !TERMINALS[part.type]) return;
    const a = node(posKey(termWorld(part, 0))), b = node(posKey(termWorld(part, 1)));
    occ[a]!++; occ[b]!++;
    const pr = part.props, d = ELEC_DEFAULTS[part.type] ?? {};
    elems.push({
      id: part.id, kind, a, b, name: elemName(part.type, pr),
      v: num(pr.v, num(d.v, 9)),
      r: num(pr.r, num(d.r, 100)),
      vn: kind === "motor" ? num(pr.vnom, part.type === "servo" ? 6 : 12) : num(pr.vn, num(d.vn, 6)),
      vf: num(pr.vf, num(d.vf, 2)),
      // El sensor de contacto es un pulsador: cierra solo mientras está presionado.
      closed: part.type === "sensorContact" ? pr.pressed === true : pr.closed !== false,
      burned: pr.burned === true,
      burnV: num(pr.burnV, 0),
    });
  }
  const wires: Wire[] = [];
  const wireEnds: Record<number, [number, number]> = {};
  for (const c of project.cables) {
    const a = node(posKey(endPos(project, c.ends[0]))), b = node(posKey(endPos(project, c.ends[1])));
    occ[a]!++; occ[b]!++;
    wires.push({ id: c.id, a, b });
    wireEnds[c.id] = [a, b];
  }
  for (const part of later) {
    if ([0, 1].some((t) => idx.has(posKey(termWorld(part, t))))) addElem(part);
  }
  // Un canal Apagado deja su salida abierta; uno sin nada conectado no cuenta como pieza suelta.
  for (const c of pending) {
    if (c.off || ((occ[c.a] ?? 0) < 2 && (occ[c.b] ?? 0) < 2)) continue;
    const id = channelId(c.part, c.k);
    owner.set(id, c.part);
    elems.push({ id, kind: "src", a: c.a, b: c.b, gain: c.gain, ca: c.ca, cb: c.cb, draw: true, name: `El canal ${c.k + 1} de la placa de control` });
  }

  const sim = simulate(idx.size, elems, wires);
  const { issues, flag } = diagnose({
    elems, wires, readings: sim.readings, occ, wireEnds,
    empty: !project.parts.length && !project.cables.length,
  });

  // Lado de cada cable: se propaga por cables desde los bornes de las pilas.
  const pol = new Map<number, "+" | "-">();
  for (const e of elems) if (e.kind === "bat") { pol.set(e.b, "+"); pol.set(e.a, "-"); }
  const side: Record<number, "+" | "-" | null> = {};
  let grew = true;
  while (grew) {
    grew = false;
    for (const w of wires) {
      const pa = pol.get(w.a), pb = pol.get(w.b);
      if (pa && !pb) { pol.set(w.b, pa); grew = true; }
      else if (pb && !pa) { pol.set(w.a, pb); grew = true; }
    }
  }
  for (const w of wires) side[w.id] = pol.get(w.a) ?? pol.get(w.b) ?? null;

  // Los ids internos (entrada del puente H, canales) se muestran en su pieza.
  const own = (id: number) => owner.get(id) ?? id;
  const fixedIssues = issues.map((i) => ({ ...i, ids: [...new Set(i.ids.map(own))] }));
  const seen = new Set<string>();
  const uniq = fixedIssues.filter((i) => { const k = i.h + i.t; if (seen.has(k)) return false; seen.add(k); return true; });
  const fixedFlag: Record<number, "err" | "warn"> = {};
  for (const [id, f] of Object.entries(flag)) { const k = own(+id); if (fixedFlag[k] !== "err") fixedFlag[k] = f; }
  return { ...sim, issues: uniq, flag: fixedFlag, side, occAt: (k) => occ[idx.get(k) ?? -1] ?? 0 };
}

/** Brillo de 0 a 1 de una ampolleta o un LED. */
export function brightness(type: string, props: Record<string, unknown>, r: Reading | undefined): number {
  if (!r || props.burned === true) return 0;
  if (type === "led") return Math.min(1, Math.max(0, r.i / 0.02));
  if (type === "lamp") return Math.min(1, (r.v / num(props.vn, 6)) ** 2);
  return 0;
}
