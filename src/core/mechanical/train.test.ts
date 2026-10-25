import { describe, expect, it } from "vitest";
import type { Belt, Part, Project } from "../model/project";
import { solveTrain } from "./train";

let id = 1;
const P = (type: string, x: number, y: number, z = 0, rot: Part["rot"] = [0, 0, 0]): Part => ({ id: id++, type, x, y, z, rot, props: {} });
const proj = (parts: Part[], belts: Belt[] = []): Project => ({ parts, cables: [], belts, nextId: id });

/** Motor DC con un engranaje en su eje: el engranaje queda de canto (eje a lo largo de X). */
function motorWithGear(type: string, x = 0, y = 0) {
  const m = P("dcmotor", x, y, 30);
  // eje del motor: centro de la pieza (x, y, 45) + (25, 0, 0)
  const g = P(type, x + 25, y, 45 - (type === "gear10" ? 12 : type === "gear20" ? 22 : 42), [0, 1, 0]);
  return { m, g };
}

describe("trenes", () => {
  it("un engranaje en el eje del motor gira con el motor", () => {
    const { m, g } = motorWithGear("gear10");
    const t = solveTrain(proj([m, g]), { [m.id]: 120 });
    expect(t.rpm[g.id]).toBeCloseTo(120);
    expect(t.link[g.id]).toBe("motor");
  });

  it("engranaje de 10 dientes a 120 RPM mueve uno de 40 dientes a −30 RPM", () => {
    const { m, g } = motorWithGear("gear10");
    // engranaje de 40 de canto, paralelo y a 10 + 40 mm en Y, con el centro a la altura del eje
    const big = P("gear40", 25, 50, 45 - 42, [0, 1, 0]);
    const t = solveTrain(proj([m, g, big]), { [m.id]: 120 });
    expect(t.rpm[big.id]).toBeCloseTo(-30);
    expect(t.ratio[big.id]).toBeCloseTo(-0.25);
  });

  it("tres engranajes iguales en triángulo quedan trabados", () => {
    const s = 40; // 20 + 20
    const a = P("gear20", 0, 0), b = P("gear20", s, 0), c = P("gear20", s / 2, (s * Math.sqrt(3)) / 2);
    const t = solveTrain(proj([a, b, c]), {});
    expect(t.issues.some((i) => i.h === "Engranajes trabados")).toBe(true);
  });

  it("piezas en el mismo eje giran juntas y la correa une poleas coplanares", () => {
    const g = P("gear20", 0, 0), pu = P("pulleyS", 0, 0, 8); // polea encima del engranaje, mismo eje
    const pu2 = P("pulleyL", 0, 120, 8);
    const belt: Belt = { id: id++, a: pu.id, b: pu2.id, cross: false };
    const t = solveTrain(proj([g, pu, pu2], [belt]), {});
    expect(t.link[g.id]).toBe("eje");
    expect(t.link[pu.id]).toBe("correa");
    expect(t.beltOk[belt.id]).toBe(true);
    // a distinta altura la correa queda mal puesta
    const bad = solveTrain(proj([g, pu, { ...pu2, z: 40 }], [belt]), {});
    expect(bad.issues.some((i) => i.h === "Correa mal colocada")).toBe(true);
  });

  it("correa: normal +r1/r2, cruzada −r1/r2", () => {
    const { m, g } = motorWithGear("gear10");
    const small = P("pulleyS", 25 + 6, 0, 45 - 10, [0, 1, 0]); // en el eje del motor, junto al engranaje
    const large = P("pulleyL", 31, 120, 45 - 28, [0, 1, 0]);
    const b: Belt = { id: id++, a: small.id, b: large.id, cross: false };
    const t = solveTrain(proj([m, g, small, large], [b]), { [m.id]: 100 });
    expect(t.rpm[large.id]).toBeCloseTo((100 * 7) / 25);
    const tc = solveTrain(proj([m, g, small, large], [{ ...b, cross: true }]), { [m.id]: 100 });
    expect(tc.rpm[large.id]).toBeCloseTo((-100 * 7) / 25);
  });

  it("dos motores con velocidades distintas en el mismo tren lo traban", () => {
    const a = motorWithGear("gear10", 0, 0);
    const b = motorWithGear("gear40", 0, 50);
    b.g.z = 45 - 42;
    const t = solveTrain(proj([a.m, a.g, b.m, b.g]), { [a.m.id]: 120, [b.m.id]: 120 });
    expect(t.issues.some((i) => i.h === "Engranajes trabados")).toBe(true);
  });

  it("avisa engranajes superpuestos y piezas sueltas", () => {
    const a = P("gear40", 0, 0), b = P("gear40", 30, 0), c = P("gear10", 400, 0);
    const t = solveTrain(proj([a, b, c]), {});
    expect(t.issues.some((i) => i.h === "Engranajes superpuestos")).toBe(true);
    expect(t.issues.find((i) => i.h === "Pieza suelta")?.ids).toContain(c.id);
  });
});
