import { describe, expect, it } from "vitest";
import type { Part, Project } from "../model/project";
import { snapRotor } from "./snap";
import { solveTrain } from "./train";

const P = (id: number, type: string, x: number, y: number, z = 0, rot: Part["rot"] = [0, 0, 0]): Part => ({ id, type, x, y, z, rot, props: {} });
const proj = (parts: Part[]): Project => ({ parts, cables: [], belts: [], nextId: 99 });

describe("imán mecánico", () => {
  it("un engranaje cerca del eje del motor se monta y se orienta", () => {
    const m = P(1, "dcmotor", 0, 0, 30);
    const g = P(2, "gear10", 0, 0);
    const s = snapRotor(proj([m, g]), g, 28, 4)!;
    expect(s.rot).toEqual([0, 1, 0]);
    const t = solveTrain(proj([m, { ...g, ...s }]), { 1: 60 });
    expect(t.link[2]).toBe("motor");
  });

  it("un engranaje grande no se monta si atravesaría la mesa", () => {
    const m = P(1, "dcmotor", 0, 0, 0);
    expect(snapRotor(proj([m, P(2, "gear40", 0, 0)]), P(2, "gear40", 0, 0), 25, 0)).toBeNull();
  });

  it("engrana a la distancia exacta", () => {
    const a = P(1, "gear20", 0, 0);
    const s = snapRotor(proj([a]), P(2, "gear10", 0, 0), 27, 3)!;
    expect(Math.hypot(s.x, s.y)).toBeCloseTo(30, 0);
    const t = solveTrain(proj([a, { ...P(2, "gear10", 0, 0), ...s }]), {});
    expect(t.meshes).toHaveLength(1);
  });

  it("una polea sobre un engranaje queda en el mismo eje", () => {
    const a = P(1, "gear20", 50, 50);
    const s = snapRotor(proj([a]), P(2, "pulleyS", 0, 0), 55, 48)!;
    expect([s.x, s.y, s.z]).toEqual([50, 50, 8]);
  });

  it("un eje corto soltado sobre un engranaje lo atraviesa y quedan unidos", () => {
    const m = P(1, "dcmotor", -200, 0, 0);
    const g = P(2, "gear20", 0, 0);
    const shaft: Part = { ...P(3, "shaft", 0, 0), props: { lx: 40 } };
    const s = snapRotor(proj([m, g, shaft]), shaft, 3, -2)!;
    expect(s.rot).toEqual([0, 1, 0]);
    expect([s.x, s.y, s.z]).toEqual([0, 0, 0]);
    const t = solveTrain(proj([m, g, { ...shaft, ...s }]), {});
    expect(t.link[2]).toBe("eje");
    expect(t.link[3]).toBe("eje");
    expect(t.issues.some((i) => i.h === "Pieza suelta")).toBe(false);
  });
});

describe("eje por agujeros", async () => {
  const { snapToShaft } = await import("./snap");
  const { holesOf } = await import("../model/holes");
  const { rotorAxis, motorAxis, coaxial, sub, dot, len, mul } = await import("./axes");
  // Pared vertical (pieza libre de 80 × 40, girada para quedar en el plano YZ) con un agujero taladrado.
  const wall = (id: number, x: number, y: number, z: number, drill: string): Part => ({ id, type: "custom", x, y, z, rot: [0, 1, 0], props: { shape: "-20,-40;20,-40;20,40;-20,40", h: 6, holes: "Sin agujeros", drill } });
  const dist = (p: number[], A: { c: number[]; a: number[] }) => { const w = sub(p as never, A.c as never); return len(sub(w, mul(A.a as never, dot(w, A.a as never)))); };

  it("un eje cerca del agujero de una pared la atraviesa, alineado con el agujero", () => {
    const w1 = wall(1, 0, 0, 0, "0,10");
    const h = holesOf(w1)[0]!;
    expect(Math.abs(h.n[0])).toBeCloseTo(1);
    const shaft = { ...P(2, "shaft", 0, 0), props: { lx: 120 } };
    const s = snapRotor(proj([w1]), shaft, h.p[0] + 20, h.p[1] + 3, 16)!;
    const A = rotorAxis({ ...shaft, ...s })!;
    expect(Math.abs(A.a[0])).toBeCloseTo(1);
    expect(dist(h.p, A)).toBeLessThan(0.1);
  });

  it("una segunda pared se centra sobre el eje, y un motor se monta en su punta y lo mueve", () => {
    const w1 = wall(1, 0, 0, 0, "0,10");
    const h = holesOf(w1)[0]!;
    const shaft0 = { ...P(2, "shaft", 0, 0), props: { lx: 120 } };
    const shaft = { ...shaft0, ...snapRotor(proj([w1]), shaft0, h.p[0] + 30, h.p[1], 16)! };
    const A = rotorAxis(shaft)!;
    // Segunda pared 1,5 mm corrida en Y y 1 mm en Z.
    const w2 = wall(3, 40, 1.5, 1, "0,10");
    const at = snapToShaft(proj([w1, shaft, w2]), w2, 40, 1.5, 4)!;
    expect(dist(holesOf({ ...w2, ...at })[0]!.p, A)).toBeLessThan(0.1);
    // Motor de eje +X a la izquierda, a otra altura: se corre hasta la punta del eje.
    const m = P(4, "dcmotor", A.c[0] - 90, A.c[1] + 3, 0);
    const mm = snapToShaft(proj([w1, shaft, w2, m]), m, m.x, m.y, 16)!;
    const M = motorAxis({ ...m, ...mm })!;
    expect(coaxial(M, A)).toBe(true);
    const t = solveTrain(proj([w1, shaft, { ...w2, ...at }, { ...m, ...mm }]), { 4: 60 });
    expect(t.source[2]).toBe(4);
    expect(t.rpm[2]).toBeCloseTo(60);
  });

  it("un eje cerca de un motor queda en su punta, coaxial", () => {
    const m = P(1, "dcmotor", 0, 0, 30);
    const shaft = { ...P(2, "shaft", 0, 0), props: { lx: 80 } };
    const s = snapRotor(proj([m]), shaft, 60, 3, 16)!;
    expect(coaxial(motorAxis(m)!, rotorAxis({ ...shaft, ...s })!)).toBe(true);
    expect(solveTrain(proj([m, { ...shaft, ...s }]), { 1: 60 }).link[2]).toBe("motor");
  });
});
