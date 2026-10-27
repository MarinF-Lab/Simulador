import { describe, expect, it } from "vitest";
import { centered, gridInside, inside, isSimple, parseShape, regular, shapeText, signedArea, triangulate, type Pt } from "./polygon";

const L: Pt[] = [[0, 0], [60, 0], [60, 20], [20, 20], [20, 60], [0, 60]];
const U: Pt[] = [[0, 0], [60, 0], [60, 50], [45, 50], [45, 15], [15, 15], [15, 50], [0, 50]];
const areaOf = (pts: Pt[], tris: [number, number, number][]) =>
  tris.reduce((s, [a, b, c]) => s + Math.abs(signedArea([pts[a]!, pts[b]!, pts[c]!])), 0);

describe("polígonos", () => {
  it("lee y escribe la forma", () => {
    expect(parseShape(shapeText(L))).toEqual(L);
    expect(parseShape("1,2;3")).toEqual([]);
    expect(parseShape("1,2;3,4")).toEqual([]);
  });

  it("área, punto dentro y centrado", () => {
    expect(Math.abs(signedArea(L))).toBe(60 * 20 + 20 * 40);
    expect(inside([10, 50], L)).toBe(true);
    expect(inside([50, 50], L)).toBe(false);
    const c = centered(L);
    expect(c.off).toEqual([30, 30]);
    expect(c.pts[0]).toEqual([-30, -30]);
  });

  it("triangula una L y una U (cóncavas) sin perder área", () => {
    for (const s of [L, U, [...L].reverse()]) {
      const t = triangulate(s);
      expect(t).toHaveLength(s.length - 2);
      expect(areaOf(s, t)).toBeCloseTo(Math.abs(signedArea(s)), 6);
    }
  });

  it("rechaza lados cruzados y formas sin área", () => {
    expect(isSimple(L)).toBe(true);
    expect(isSimple(regular(12, 40))).toBe(true);
    expect(isSimple([[0, 0], [40, 40], [40, 0], [0, 40]])).toBe(false);
    expect(isSimple([[0, 0], [10, 0], [20, 0]])).toBe(false);
  });

  it("los agujeros de la grilla quedan solo dentro de la forma", () => {
    const holes = gridInside(L, 10);
    expect(holes.length).toBeGreaterThan(5);
    expect(holes.every((p) => inside(p, L))).toBe(true);
    expect(holes.some((p) => p[0] === 50 && p[1] === 50)).toBe(false);
  });
});
