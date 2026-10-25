import { describe, expect, it } from "vitest";
import { useProject } from "./project";

describe("ejemplo inicial", () => {
  it("el circuito de la ampolleta funciona, el tren 10 → 40 gira y el brazo tiene sus juntas", () => {
    const s = useProject.getState();
    expect(Math.abs(s.circuit.readings[4]!.v)).toBeCloseTo(3.77, 2);
    const r = s.mech.rpm;
    expect(Math.abs(r[15]!)).toBeGreaterThan(29);
    expect(r[17]! / r[15]!).toBeCloseTo(-0.25);
    expect(s.project.joints).toHaveLength(2);
    expect(s.structure.issues).toEqual([]);
    expect(s.mech.issues.filter((i) => i.s === "err" || i.s === "warn")).toEqual([]);
  });

  it("borrar una pieza borra sus juntas y deshacer las devuelve", () => {
    const st = useProject.getState();
    st.remove(18);
    expect(useProject.getState().project.joints).toHaveLength(0);
    useProject.getState().undo();
    expect(useProject.getState().project.joints).toHaveLength(2);
  });
});
