import { describe, expect, it } from "vitest";
import type { Cable, Part, Project } from "../model/project";
import { termWorld } from "../model/terminals";
import { analyze } from "./analyze";

let nid = 1;
const P = (type: string, x: number, y: number, props: Part["props"] = {}): Part => ({ id: nid++, type, x, y, z: 0, rot: [0, 0, 0], props });
/** Cable de borne a borne. */
const W = (a: Part, ta: number, b: Part, tb: number): Cable => {
  const [x0, y0, z0] = termWorld(a, ta), [x1, y1, z1] = termWorld(b, tb);
  return { id: nid++, ends: [{ att: { part: a.id, t: ta }, x: x0, y: y0, z: z0 }, { att: { part: b.id, t: tb }, x: x1, y: y1, z: z1 }] };
};
/** Lazo en serie: + de la pila → cada pieza entra por su + y sale por su − → − de la pila. */
function loop(bat: Part, ...loads: Part[]): Project {
  const chain = [bat, ...loads];
  const cables: Cable[] = [];
  for (let i = 0; i < chain.length; i++) {
    const a = chain[i]!, b = chain[(i + 1) % chain.length]!;
    cables.push(W(a, a === bat ? 1 : 0, b, b === bat ? 0 : 1));
  }
  return { parts: chain, cables, nextId: nid };
}
const has = (c: ReturnType<typeof analyze>, h: string) => c.issues.some((i) => i.h === h);

describe("casos del prototipo", () => {
  it("9 V + interruptor + 100 Ω + ampolleta de 6 V ≈ 3,77 V en la ampolleta", () => {
    const lamp = P("lamp", 0, 200, { vn: 6 });
    const c = analyze(loop(P("source", 0, 0, { v: 9 }), P("switch", 200, 0), P("resistor", 200, 200, { r: 100 }), lamp));
    expect(Math.abs(c.readings[lamp.id]!.v)).toBeCloseTo(3.77, 2);
    expect(has(c, "Circuito funcionando")).toBe(true);
  });

  it("9 V + 470 Ω + LED de 2 V ≈ 2,15 V en el LED", () => {
    const led = P("led", 200, 200, { vf: 2 });
    const c = analyze(loop(P("source", 0, 0, { v: 9 }), P("resistor", 200, 0, { r: 470 }), led));
    expect(c.readings[led.id]!.v).toBeCloseTo(2.15, 2);
    expect(c.ledOn[led.id]).toBe(true);
  });

  it("9 V + 100 Ω + LED: el LED se quema", () => {
    const led = P("led", 200, 200);
    const c = analyze(loop(P("source", 0, 0, { v: 9 }), P("resistor", 200, 0, { r: 100 }), led));
    expect(c.burns.map((b) => b.id)).toContain(led.id);
  });
});

describe("avisos", () => {
  it("cortocircuito: un cable entre los bornes de la pila", () => {
    const bat = P("source", 0, 0);
    const c = analyze({ parts: [bat], cables: [W(bat, 1, bat, 0)], nextId: nid });
    expect(has(c, "Cortocircuito")).toBe(true);
    expect(c.flag[bat.id]).toBe("err");
  });

  it("circuito abierto con el interruptor abierto", () => {
    const sw = P("switch", 200, 0, { closed: false });
    const c = analyze(loop(P("source", 0, 0), sw, P("lamp", 200, 200)));
    expect(has(c, "Circuito abierto")).toBe(true);
    expect(c.flag[sw.id]).toBe("warn");
  });

  it("el sensor de contacto cierra el circuito solo mientras está presionado", () => {
    const lamp = P("lamp", 200, 200, { vn: 9 });
    const free = analyze(loop(P("source", 0, 0), P("sensorContact", 200, 0), lamp));
    expect(Math.abs(free.readings[lamp.id]!.v)).toBeLessThan(0.01);
    const sensor = P("sensorContact", 200, 0, { pressed: true });
    const lamp2 = P("lamp", 200, 200, { vn: 9 });
    const pressed = analyze(loop(P("source", 0, 0), sensor, lamp2));
    expect(Math.abs(pressed.readings[lamp2.id]!.v)).toBeGreaterThan(8.9);
  });

  it("con dos circuitos, avisa el abierto aunque el otro funcione", () => {
    const a = loop(P("source", 0, 0), P("lamp", 200, 0, { vn: 9 }));
    const sw = P("switch", 200, 400, { closed: false });
    const b = loop(P("source", 0, 400), sw, P("lamp", 200, 600));
    const c = analyze({ parts: [...a.parts, ...b.parts], cables: [...a.cables, ...b.cables], nextId: nid });
    const open = c.issues.filter((i) => i.h === "Circuito abierto");
    expect(open).toHaveLength(1);
    expect(open[0]!.ids).toEqual([sw.id]);
    expect(c.issues.some((i) => i.h === "Circula corriente")).toBe(true);
  });

  it("LED invertido", () => {
    const bat = P("source", 0, 0), r = P("resistor", 200, 0, { r: 470 }), led = P("led", 200, 200);
    const c = analyze({ parts: [bat, r, led], cables: [W(bat, 1, r, 1), W(r, 0, led, 0), W(led, 1, bat, 0)], nextId: nid });
    expect(has(c, "LED invertido")).toBe(true);
  });

  it("ampolleta quemada por exceso de voltaje", () => {
    const lamp = P("lamp", 200, 0, { vn: 3 });
    const c = analyze(loop(P("source", 0, 0, { v: 12 }), lamp));
    expect(c.burns.map((b) => b.id)).toContain(lamp.id);
  });

  it("pilas en paralelo con distinto voltaje", () => {
    const a = P("source", 0, 0, { v: 9 }), b = P("source", 0, 100, { v: 3 });
    const c = analyze({ parts: [a, b], cables: [W(a, 1, b, 1), W(a, 0, b, 0)], nextId: nid });
    expect(has(c, "Pilas en paralelo con distinto voltaje")).toBe(true);
  });

  it("pilas en serie invertidas", () => {
    const a = P("source", 0, 0), b = P("source", 0, 100), lamp = P("lamp", 200, 0, { vn: 12 });
    const c = analyze({ parts: [a, b, lamp], cables: [W(a, 1, b, 1), W(b, 0, lamp, 1), W(lamp, 0, a, 0)], nextId: nid });
    expect(has(c, "Pilas en serie invertidas")).toBe(true);
  });

  it("componente desconectado y cable suelto", () => {
    const bat = P("source", 0, 0), lamp = P("lamp", 300, 0);
    const [x, y, z] = termWorld(bat, 1);
    const loose: Cable = { id: nid++, ends: [{ att: { part: bat.id, t: 1 }, x, y, z }, { att: null, x: x + 50, y, z: 0 }] };
    const c = analyze({ parts: [bat, lamp], cables: [loose], nextId: nid });
    expect(has(c, "Cable suelto")).toBe(true);
    expect(c.issues.some((i) => i.h === "Componente desconectado" && i.ids.includes(lamp.id))).toBe(true);
  });

  it("los cables del lado + y − se marcan", () => {
    const bat = P("source", 0, 0), lamp = P("lamp", 200, 0);
    const p = loop(bat, lamp);
    const c = analyze(p);
    expect(c.side[p.cables[0]!.id]).toBe("+");
    expect(c.side[p.cables[1]!.id]).toBe("-");
  });
});
