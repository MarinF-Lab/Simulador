import { describe, expect, it } from "vitest";
import { alignedPairs, holesOf, restHeight, snapHoles } from "./holes";
import type { Part } from "./project";

const P = (id: number, type: string, x: number, y: number, z = 0, props: Part["props"] = {}, rot: Part["rot"] = [0, 0, 0]): Part => ({ id, type, x, y, z, rot, props });

describe("agujeros", () => {
  it("un perfil de 60 mm tiene 6 agujeros cada 10 mm (con cara arriba y abajo)", () => {
    const h = holesOf(P(1, "profile60", 0, 0));
    expect(h).toHaveLength(12);
    expect(h.filter((x) => x.n[2] > 0).map((x) => x.p[0])).toEqual([-25, -15, -5, 5, 15, 25]);
  });

  it("los agujeros cambian con el largo", () => {
    expect(holesOf(P(1, "profile60", 0, 0, 0, { lx: 100 })).length).toBe(20);
  });

  it("el motor tiene agujeros fuera de la cuadrícula de 10 mm", () => {
    const xs = holesOf(P(1, "dcmotor", 0, 0)).filter((h) => !h.shaft).map((h) => h.p[0]);
    expect(xs).toContain(-17);
    expect(xs).toContain(3);
  });

  it("el imán apoya un perfil sobre la placa con los agujeros alineados", () => {
    const plate = P(1, "plate", 0, 0);
    const prof = P(2, "profile60", 0, 0);
    const s = snapHoles({ parts: [plate, prof] }, prof, 3, 13)!;
    expect(s.z).toBe(6);
    const placed = { ...prof, ...s };
    expect(alignedPairs({ parts: [plate, placed] }, 2).length).toBeGreaterThan(0);
  });

  it("un motor se apoya sobre la placa con sus agujeros propios", () => {
    const plate = P(1, "plate", 0, 0);
    const m = P(2, "dcmotor", 0, 0);
    const s = snapHoles({ parts: [plate, m] }, m, 2, 4)!;
    expect(s).not.toBeNull();
    const placed = { ...m, ...s };
    // el agujero (−17, −7) del motor cae sobre un agujero de la placa
    expect(alignedPairs({ parts: [plate, placed] }, 2).length).toBeGreaterThan(0);
    expect(s.x % 10).not.toBe(0);
  });

  it("altura de apoyo sobre lo que hay debajo", () => {
    const plate = P(1, "plate", 0, 0);
    expect(restHeight({ parts: [plate] }, P(2, "source", 0, 0), 10, 10)).toBe(6);
    expect(restHeight({ parts: [plate] }, P(2, "source", 0, 0), 400, 300)).toBe(0);
  });
});

import { checkStructure } from "./structure";
describe("revisión de estructuras", () => {
  it("avisa juntas imposibles y piezas superpuestas", () => {
    const plate = P(1, "plate", 0, 0), prof = P(2, "profile60", 5, 10, 6);
    const ok = checkStructure({ parts: [plate, prof], cables: [], joints: [{ id: 9, kind: "fixed", a: { part: 2, h: 1 }, b: { part: 1, h: 0 } }], nextId: 10 });
    // el agujero 1 del perfil (abajo, x −20) no coincide con el agujero 0 de la placa (arriba, esquina)
    expect(ok.broken.has(9)).toBe(true);
    const over = checkStructure({ parts: [plate, P(3, "source", 0, 0, 2)], cables: [], nextId: 10 });
    expect(over.issues.some((i) => i.h === "Piezas superpuestas")).toBe(true);
    const stacked = checkStructure({ parts: [plate, P(3, "source", 0, 0, 6)], cables: [], nextId: 10 });
    expect(stacked.issues).toEqual([]);
  });
});
