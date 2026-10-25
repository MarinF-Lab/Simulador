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
});
