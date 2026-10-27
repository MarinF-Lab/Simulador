import { describe, expect, it } from "vitest";
import type { Cable, Part, Project } from "../model/project";
import { termWorld } from "../model/terminals";
import { analyze } from "./analyze";
import { channelId } from "./controller";

let nid = 1;
const P = (type: string, x: number, y: number, props: Part["props"] = {}): Part => ({ id: nid++, type, x, y, z: 0, rot: [0, 0, 0], props });
const W = (a: Part, ta: number, b: Part, tb: number): Cable => {
  const [x0, y0, z0] = termWorld(a, ta), [x1, y1, z1] = termWorld(b, tb);
  return { id: nid++, ends: [{ att: { part: a.id, t: ta }, x: x0, y: y0, z: z0 }, { att: { part: b.id, t: tb }, x: x1, y: y1, z: z1 }] };
};

/** Pila de 12 V → placa de control; en el canal 1 una resistencia de 12 Ω (salida A al −, B al +). */
function board(ch: Part["props"], extra: { parts?: Part[]; cables?: Cable[] } = {}) {
  const bat = P("source", -200, 0, { v: 12 });
  const ctl = P("controller", 0, 0, ch);
  const load = P("resistor", 0, 200, { r: 12 });
  const cables = [W(bat, 1, ctl, 1), W(bat, 0, ctl, 0), W(ctl, 3, load, 1), W(ctl, 2, load, 0), ...(extra.cables ?? [])];
  const project: Project = { parts: [bat, ctl, load, ...(extra.parts ?? [])], cables, nextId: nid };
  return { c: analyze(project), bat, ctl, load };
}

describe("placa de control", () => {
  it("Adelante entrega casi todo el voltaje; Atrás lo invierte; Freno y Apagado lo cortan", () => {
    const fwd = board({ m1: "Adelante" });
    expect(fwd.c.readings[fwd.load.id]!.v).toBeGreaterThan(11.5);
    const rev = board({ m1: "Atrás" });
    expect(rev.c.readings[rev.load.id]!.v).toBeLessThan(-11.5);
    for (const m of ["Freno", "Apagado"]) {
      const off = board({ m1: m });
      expect(Math.abs(off.c.readings[off.load.id]!.v)).toBeLessThan(0.01);
    }
  });

  it("al 50 % la salida es la mitad", () => {
    const { c, load } = board({ m1: "Adelante", p1: 50 });
    expect(c.readings[load.id]!.v).toBeCloseTo(6, 0);
  });

  it("la pila entrega la potencia que consumen los canales", () => {
    const { c, bat, load } = board({ m1: "Adelante", p1: 50 });
    const pin = c.readings[bat.id]!.v * c.readings[bat.id]!.i;
    const pout = c.readings[load.id]!.v * c.readings[load.id]!.i;
    expect(pout).toBeGreaterThan(2);
    // La placa pierde poco: su entrada de 10 kΩ y la resistencia de su salida.
    expect(pin).toBeGreaterThan(pout);
    expect(pin).toBeLessThan(pout * 1.05);
  });

  it("un sensor presionado detiene o invierte el canal", () => {
    const sensor = P("sensorContact", 300, 300, { pressed: true });
    const stop = board({ m1: "Adelante", s1: sensor.id, a1: "Detener" }, { parts: [sensor] });
    expect(Math.abs(stop.c.readings[stop.load.id]!.v)).toBeLessThan(0.01);
    const inv = board({ m1: "Adelante", s1: sensor.id, a1: "Invertir" }, { parts: [sensor] });
    expect(inv.c.readings[inv.load.id]!.v).toBeLessThan(-11.5);
    const loose = { ...sensor, props: { pressed: false } };
    const run = board({ m1: "Adelante", s1: loose.id, a1: "Detener" }, { parts: [loose] });
    expect(run.c.readings[run.load.id]!.v).toBeGreaterThan(11.5);
  });

  it("los canales sin usar no dan avisos y las lecturas del canal quedan en su id interno", () => {
    const { c, ctl } = board({ m1: "Adelante", m2: "Adelante" });
    expect(c.issues.filter((i) => i.s === "warn" || i.s === "err")).toEqual([]);
    expect(c.readings[channelId(ctl.id, 0)]!.v).toBeGreaterThan(11.5);
    expect(c.readings[channelId(ctl.id, 1)]).toBeUndefined();
  });
});

describe("repartidor", () => {
  it("lleva el voltaje de la entrada a sus 4 salidas sin avisos de bornes libres", () => {
    const bat = P("source", -200, 0, { v: 9 });
    const sp = P("splitter", 0, 0);
    const lamps = [0, 1].map((i) => P("lamp", 100 * i, 200, { vn: 9 }));
    const cables = [W(bat, 1, sp, 1), W(bat, 0, sp, 0), ...lamps.flatMap((l, i) => [W(sp, 3 + 2 * i, l, 1), W(sp, 2 + 2 * i, l, 0)])];
    const c = analyze({ parts: [bat, sp, ...lamps], cables, nextId: nid });
    for (const l of lamps) expect(c.readings[l.id]!.v).toBeGreaterThan(8.5);
    expect(c.issues.filter((i) => i.s === "warn" || i.s === "err")).toEqual([]);
  });
});
