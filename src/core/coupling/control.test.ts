import { describe, expect, it } from "vitest";
import { atLimit, clampTarget, servoRamp } from "./control";

describe("servo", () => {
  const spec = { amin: -90, amax: 90, speed: 120 };
  it("la rampa respeta la velocidad máxima y llega al objetivo", () => {
    let a = 0;
    a = servoRamp(spec, a, 45, 0.1);
    expect(a).toBeCloseTo(12);
    for (let i = 0; i < 20; i++) a = servoRamp(spec, a, 45, 0.1);
    expect(a).toBe(45);
  });
  it("no pasa de sus límites y avisa el tope", () => {
    expect(clampTarget(spec, 150)).toBe(90);
    let a = 0;
    for (let i = 0; i < 30; i++) a = servoRamp(spec, a, 150, 0.1);
    expect(a).toBe(90);
    expect(atLimit(spec, 150, a)).toBe(true);
    expect(atLimit(spec, 45, 45)).toBe(false);
  });
});
