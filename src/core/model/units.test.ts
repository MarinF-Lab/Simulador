import { describe, expect, it } from "vitest";
import { fmt, fmtA, fmtV, parseDecimal, snap } from "./units";

describe("units", () => {
  it("ajusta a la cuadrícula de 10 mm", () => {
    expect(snap(14)).toBe(10);
    expect(snap(15)).toBe(20);
    expect(snap(-4)).toBe(0);
  });
  it("formatea con coma decimal", () => {
    expect(fmt(3.768)).toBe("3,77");
    expect(fmtV(-2.15)).toBe("2,15 V");
    expect(fmtA(0.0145)).toBe("0,015 A");
  });
  it("lee coma o punto decimal", () => {
    expect(parseDecimal("4,5")).toBe(4.5);
    expect(parseDecimal("12.3")).toBe(12.3);
    expect(parseDecimal("abc")).toBeNull();
  });
});
