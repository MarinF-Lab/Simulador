import { describe, expect, it } from "vitest";
import { useProject } from "./project";

describe("ejemplo inicial", () => {
  it("el circuito de la ampolleta funciona y el tren 10 → 40 con correa gira", () => {
    const s = useProject.getState();
    expect(Math.abs(s.circuit.readings[4]!.v)).toBeCloseTo(3.77, 2);
    const r = s.mech.rpm;
    expect(r[15]).toBeGreaterThan(119);
    expect(r[16]! / r[15]!).toBeCloseTo(-0.25);
    expect(r[17]).toBeCloseTo(r[16]!);
    expect(r[18]! / r[17]!).toBeCloseTo(7 / 25);
    expect(s.mech.issues.filter((i) => i.s === "err" || i.s === "warn")).toEqual([]);
  });

  it("borrar una polea borra su correa y deshacer la devuelve", () => {
    const st = useProject.getState();
    st.remove(17);
    expect(useProject.getState().project.belts).toHaveLength(0);
    useProject.getState().undo();
    expect(useProject.getState().project.belts).toHaveLength(1);
  });
});
