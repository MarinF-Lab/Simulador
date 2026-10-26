import { describe, expect, it } from "vitest";
import { analyze } from "../electrical/analyze";
import { solveTrain } from "../mechanical/train";
import { checkStructure } from "../model/structure";
import { motorSpeeds } from "../../store/project";
import { EXAMPLES } from "./examples";

const build = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();

describe("ejemplos", () => {
  it("todos cargan sin errores de estructura ni de transmisión", () => {
    for (const ex of EXAMPLES) {
      const p = ex.build();
      const c = analyze(p);
      expect(checkStructure(p).issues, ex.id).toEqual([]);
      expect(solveTrain(p, motorSpeeds(p, c)).issues.filter((i) => i.s === "err"), ex.id).toEqual([]);
      expect(c.issues.filter((i) => i.s === "err"), ex.id).toEqual([]);
      const ids = [...p.parts, ...p.cables, ...(p.belts ?? []), ...(p.joints ?? [])].map((x) => x.id);
      expect(new Set(ids).size, ex.id).toBe(ids.length);
      expect(p.nextId, ex.id).toBeGreaterThan(Math.max(...ids));
    }
  });

  it("la ampolleta recibe unos 3,77 V", () => {
    const p = build("bulb");
    const lamp = p.parts.find((x) => x.type === "lamp")!;
    expect(Math.abs(analyze(p).readings[lamp.id]!.v)).toBeCloseTo(3.77, 2);
  });

  it("el motor a 120 RPM mueve el de 40 a −30 RPM y la correa lleva el giro a la polea grande", () => {
    const p = build("gears");
    const rpm = solveTrain(p, motorSpeeds(p, analyze(p))).rpm;
    expect(Math.abs(rpm[3]!)).toBeGreaterThan(118); // un poco menos de 120 por la resistencia interna de la pila
    expect(rpm[5]! / rpm[3]!).toBeCloseTo(-0.25);
    expect(rpm[6]).toBeCloseTo(rpm[5]!);
    expect(rpm[8]! / rpm[6]!).toBeCloseTo(7 / 25);
  });
});
