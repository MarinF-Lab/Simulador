// Simulación eléctrica por análisis nodal (MNA solo con conductancias), portada del prototipo.
// Cada elemento une dos nodos: `a` es el borne − y `b` el borne +. v = V(b) − V(a).

import { fmt } from "../model/units";
import { solve } from "./solver";

export const RINT = 0.05; // Ω, resistencia interna de la pila
export const GC = 1000; // S, cable e interruptor cerrado
export const GL = 0.1; // S, LED encendido (10 Ω)
export const GMIN = 1e-9; // S, en cada nodo
export const GMETER = 1e-7; // S, voltímetro

export type ElemKind = "bat" | "res" | "sw" | "bulb" | "motor" | "led" | "meter";

export interface Elem {
  id: number;
  kind: ElemKind;
  name: string;
  a: number;
  b: number;
  /** bat: v · res: r · bulb/motor: vn · led: vf · sw: closed */
  v?: number;
  r?: number;
  vn?: number;
  vf?: number;
  closed?: boolean;
  burned?: boolean;
  burnV?: number;
}

export interface Wire {
  id: number;
  a: number;
  b: number;
}

export interface Reading {
  v: number;
  i: number;
}

export interface SimResult {
  readings: Record<number, Reading>;
  /** Estado final de los LED. */
  ledOn: Record<number, boolean>;
  /** Piezas que se quemaron en esta simulación, con el voltaje que recibieron. */
  burns: { id: number; v: number }[];
}

function cond(e: Elem, burned: boolean): number {
  switch (e.kind) {
    case "res": return 1 / Math.max(e.r ?? 100, 0.001);
    case "sw": return e.closed === false ? 0 : GC;
    case "meter": return GMETER;
    case "bulb": return burned ? 0 : 0.5 / (e.vn ?? 6) ** 2;
    case "motor": return burned ? 0 : 3 / (e.vn ?? 12) ** 2;
    default: return 0;
  }
}

export function simulate(nodes: number, elems: Elem[], wires: Wire[]): SimResult {
  const burned = new Map<number, number>(); // nuevos quemados: id → voltaje
  const isBurned = (e: Elem) => e.burned === true || burned.has(e.id);
  const on = new Map<number, boolean>();
  let R: Record<number, Reading> = {};

  for (let pass = 0; pass < 12; pass++) {
    const G = Array.from({ length: nodes }, () => new Float64Array(nodes));
    const I = new Float64Array(nodes);
    for (let i = 0; i < nodes; i++) G[i]![i]! += GMIN;
    const stamp = (a: number, b: number, g: number) => {
      G[a]![a]! += g; G[b]![b]! += g; G[a]![b]! -= g; G[b]![a]! -= g;
    };
    for (const e of elems) {
      if (e.a === e.b) continue;
      if (e.kind === "bat") {
        const v = e.v ?? 9;
        stamp(e.a, e.b, 1 / RINT);
        I[e.b]! += v / RINT;
        I[e.a]! -= v / RINT;
      } else if (e.kind === "led") {
        if (on.get(e.id) && !isBurned(e)) {
          const vf = e.vf ?? 2;
          stamp(e.a, e.b, GL);
          I[e.b]! += vf * GL;
          I[e.a]! -= vf * GL;
        }
      } else {
        const g = cond(e, isBurned(e));
        if (g > 0) stamp(e.a, e.b, g);
      }
    }
    for (const w of wires) if (w.a !== w.b) stamp(w.a, w.b, GC);
    const V = nodes ? solve(G, I, nodes) : new Float64Array(0);

    R = {};
    for (const e of elems) {
      const vd = V[e.b]! - V[e.a]!;
      let i: number;
      if (e.kind === "bat") i = ((e.v ?? 9) - vd) / RINT;
      else if (e.kind === "led") i = on.get(e.id) && !isBurned(e) ? GL * (vd - (e.vf ?? 2)) : 0;
      else i = vd * cond(e, isBurned(e));
      R[e.id] = { v: vd, i };
    }
    for (const w of wires) R[w.id] = { v: 0, i: w.a === w.b ? 0 : (V[w.a]! - V[w.b]!) * GC };

    let changed = false;
    for (const e of elems) {
      if (isBurned(e)) continue;
      const r = R[e.id]!;
      if ((e.kind === "bulb" || e.kind === "motor") && Math.abs(r.v) > 1.25 * (e.vn ?? 6)) {
        burned.set(e.id, Math.abs(r.v));
        changed = true;
      }
      if (e.kind === "led") {
        const lit = on.get(e.id) ?? false;
        if (lit && r.i > 0.04) { burned.set(e.id, r.v); on.set(e.id, false); changed = true; }
        else if (lit && r.i < 0) { on.set(e.id, false); changed = true; }
        else if (!lit && r.v > (e.vf ?? 2) + 1e-6) { on.set(e.id, true); changed = true; }
      }
    }
    if (!changed) break;
  }
  return {
    readings: R,
    ledOn: Object.fromEntries(elems.filter((e) => e.kind === "led").map((e) => [e.id, (on.get(e.id) ?? false) && !isBurned(e)])),
    burns: [...burned].map(([id, v]) => ({ id, v })),
  };
}

export type Severity = "err" | "warn" | "info" | "ok";
export interface Issue {
  s: Severity;
  h: string;
  t: string;
  ids: number[];
}

export interface DiagnoseInput {
  elems: Elem[];
  wires: Wire[];
  readings: Record<number, Reading>;
  /** Cuántos bornes y puntas hay en cada nodo. */
  occ: number[];
  /** Nodos de las dos puntas de cada cable. */
  wireEnds: Record<number, [number, number]>;
  empty: boolean;
}

/** Avisos del circuito, ordenados: errores, advertencias, información y ok. */
export function diagnose(d: DiagnoseInput): { issues: Issue[]; flag: Record<number, "err" | "warn"> } {
  const { elems, readings: R, occ } = d;
  const issues: Issue[] = [];
  const flag: Record<number, "err" | "warn"> = {};
  const mark = (id: number, s: "err" | "warn") => { if (flag[id] !== "err") flag[id] = s; };
  const bats = elems.filter((e) => e.kind === "bat");
  const rd = (id: number) => R[id] ?? { v: 0, i: 0 };

  if (d.empty) issues.push({ s: "info", h: "Mesa vacía", t: "Agrega una pila y otros componentes para empezar.", ids: [] });
  else if (!bats.length && elems.length) issues.push({ s: "info", h: "Sin energía", t: "Agrega una pila para dar voltaje al circuito.", ids: [] });

  // Grupos de nodos unidos por cables: para revisar cómo están conectadas las pilas.
  const parent = occ.map((_, i) => i);
  const find = (n: number): number => (parent[n] === n ? n : (parent[n] = find(parent[n]!)));
  for (const w of d.wires) parent[find(w.a)] = find(w.b);
  const ga = (e: Elem) => find(e.a), gb = (e: Elem) => find(e.b);

  const handled = new Set<number>();
  for (let i = 0; i < bats.length; i++) for (let j = i + 1; j < bats.length; j++) {
    const A = bats[i]!, B = bats[j]!;
    if (ga(A) === gb(A) || ga(B) === gb(B)) continue;
    if (ga(A) === ga(B) && gb(A) === gb(B) && A.v !== B.v) {
      issues.push({ s: "err", h: "Pilas en paralelo con distinto voltaje", t: `Una pila de ${fmt(A.v ?? 9)} V y otra de ${fmt(B.v ?? 9)} V están en paralelo. La de mayor voltaje descarga a la otra y ambas se calientan. En paralelo usa pilas del mismo voltaje.`, ids: [A.id, B.id] });
      for (const e of [A, B]) { mark(e.id, "err"); handled.add(e.id); }
    } else if (ga(A) === gb(B) && gb(A) === ga(B)) {
      issues.push({ s: "err", h: "Pilas en paralelo invertidas", t: "El + de una pila está unido al − de la otra por ambos lados. Es un cortocircuito: invierte la polaridad de una de las pilas.", ids: [A.id, B.id] });
      for (const e of [A, B]) { mark(e.id, "err"); handled.add(e.id); }
    }
  }

  const shorted = bats.filter((e) => !handled.has(e.id) && Math.abs(rd(e.id).i) * RINT > 0.3 * (e.v ?? 9));
  if (shorted.length) {
    const who = shorted.length > 1 ? `${shorted.length} pilas están conectadas` : `La pila de ${fmt(shorted[0]!.v ?? 9)} V está conectada`;
    issues.push({ s: "err", h: "Cortocircuito", t: `${who} sin resistencia ni carga entre sus bornes, y su voltaje cae casi a 0 V. La pila se calentaría. Agrega una resistencia o una carga en el camino.`, ids: shorted.map((e) => e.id) });
    shorted.forEach((e) => mark(e.id, "err"));
  }

  for (const e of elems.filter((x) => x.burned)) {
    const got = fmt(e.burnV ?? 0);
    const txt: Partial<Record<ElemKind, [string, string]>> = {
      bulb: ["Ampolleta quemada", `Recibió ${got} V y solo soporta ${fmt(e.vn ?? 6)} V. Reemplázala desde Propiedades y baja el voltaje o agrega una resistencia en serie.`],
      motor: ["Motor quemado", `Recibió ${got} V y solo soporta ${fmt(e.vn ?? 12)} V. Reemplázalo desde Propiedades y baja el voltaje de la pila.`],
      led: ["LED quemado", `Recibió ${got} V y soporta como máximo ${fmt((e.vf ?? 2) + 0.4)} V. Reemplázalo y agrega una resistencia en serie, por ejemplo de 470 Ω.`],
    };
    const [h, t] = txt[e.kind] ?? ["Componente quemado", `Recibió ${got} V.`];
    issues.push({ s: "err", h, t, ids: [e.id] });
    mark(e.id, "err");
  }

  for (const e of elems.filter((x) => x.kind === "led" && !x.burned && rd(x.id).v < -0.5)) {
    issues.push({ s: "warn", h: "LED invertido", t: "El LED está conectado al revés y no enciende. Su lado + (ánodo, borne rojo) debe ir hacia el + de la pila. Usa Invertir polaridad.", ids: [e.id] });
    mark(e.id, "warn");
  }

  // Pilas en serie unidas por el mismo polo: un grupo con solo esos dos bornes.
  const at = new Map<number, { e: Elem; t: number }[]>();
  for (const e of elems) for (const [t, n] of [[0, ga(e)], [1, gb(e)]] as const) at.set(n, [...(at.get(n) ?? []), { e, t }]);
  for (const g of at.values()) {
    if (g.length === 2 && g[0]!.e.kind === "bat" && g[1]!.e.kind === "bat" && g[0]!.e !== g[1]!.e && g[0]!.t === g[1]!.t) {
      issues.push({ s: "warn", h: "Pilas en serie invertidas", t: `Dos pilas están unidas ${g[0]!.t ? "+ con +" : "− con −"}, así sus voltajes se restan en vez de sumarse. Para sumarlos, une el + de una con el − de la otra.`, ids: [g[0]!.e.id, g[1]!.e.id] });
      mark(g[0]!.e.id, "warn");
      mark(g[1]!.e.id, "warn");
    }
  }

  const active = bats.filter((e) => Math.abs(rd(e.id).i) >= 1e-4);
  if (bats.length && !shorted.length && !handled.size && !active.length) {
    const openSw = elems.filter((e) => e.kind === "sw" && e.closed === false);
    let t = "No circula corriente, así que ningún componente recibe voltaje. ";
    if (openSw.length) t += "Hay un interruptor abierto: ciérralo desde Propiedades.";
    else if (elems.some((e) => e.burned)) t += "Un componente quemado dejó el camino cortado.";
    else t += "Revisa que exista un camino cerrado desde el + de la pila, pasando por los componentes, hasta su −.";
    issues.push({ s: "warn", h: "Circuito abierto", t, ids: openSw.map((e) => e.id) });
    openSw.forEach((e) => mark(e.id, "warn"));
  }

  const loose = elems.filter((e) => (occ[e.a] ?? 0) < 2 || (occ[e.b] ?? 0) < 2);
  loose.forEach((e) => mark(e.id, "warn"));
  if (loose.length > 2) {
    issues.push({ s: "warn", h: "Componentes desconectados", t: `${loose.length} componentes tienen bornes sin conectar. Están marcados en amarillo.`, ids: loose.map((e) => e.id) });
  } else {
    for (const e of loose) {
      const free = Number((occ[e.a] ?? 0) < 2) + Number((occ[e.b] ?? 0) < 2);
      issues.push({ s: "warn", h: "Componente desconectado", t: `${e.name} tiene ${free === 2 ? "sus dos bornes libres" : "un borne sin conectar"}.`, ids: [e.id] });
    }
  }

  const looseW = d.wires.filter((w) => (d.wireEnds[w.id] ?? [w.a, w.b]).some((n) => (occ[n] ?? 0) < 2));
  looseW.forEach((w) => mark(w.id, "warn"));
  if (looseW.length) {
    issues.push({ s: "warn", h: "Cable suelto", t: looseW.length > 1 ? `${looseW.length} cables tienen puntas sin conectar. Arrastra cada punta hasta un borne.` : "Un cable tiene una punta sin conectar. Arrastra la punta hasta un borne.", ids: looseW.map((w) => w.id) });
  }

  if (active.length && !issues.some((x) => x.s === "err")) {
    const clean = !issues.some((x) => x.s === "warn");
    const vt = Math.max(...active.map((e) => Math.abs(rd(e.id).v)));
    issues.push({ s: "ok", h: clean ? "Circuito funcionando" : "Circula corriente", t: `${clean ? "El circuito está cerrado. " : ""}Voltaje en bornes de la pila: ${fmt(vt)} V.`, ids: [] });
  }

  const order: Record<Severity, number> = { err: 0, warn: 1, info: 2, ok: 3 };
  issues.sort((x, y) => order[x.s] - order[y.s]);
  return { issues, flag };
}
