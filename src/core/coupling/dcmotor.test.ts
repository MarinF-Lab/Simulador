import { describe, expect, it } from "vitest";
import { motorCurrent, motorParams, motorTorque, noLoadSpeed, toRpm } from "./dcmotor";

describe("motor DC", () => {
  const m = motorParams({ vnom: 12, rpm: 60, torque: 0.8 });
  it("en vacío a voltaje nominal gira a sus RPM y no hace par", () => {
    expect(toRpm(noLoadSpeed(m, 12))).toBeCloseTo(60);
    expect(motorTorque(m, 12, noLoadSpeed(m, 12))).toBeCloseTo(0);
  });
  it("detenido entrega el par de arranque", () => {
    expect(motorTorque(m, 12, 0)).toBeCloseTo(0.8);
    expect(motorCurrent(m, 12, 0)).toBeCloseTo(m.iStall);
  });
  it("a mitad de voltaje, mitad de velocidad y de par", () => {
    expect(toRpm(noLoadSpeed(m, 6))).toBeCloseTo(30);
    expect(motorTorque(m, 6, 0)).toBeCloseTo(0.4);
  });
  it("al frenarlo sube la corriente", () => {
    const w = noLoadSpeed(m, 12);
    expect(motorCurrent(m, 12, w * 0.5)).toBeGreaterThan(motorCurrent(m, 12, w * 0.9));
  });
});
