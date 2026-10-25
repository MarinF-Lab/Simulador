import { beforeAll, describe, expect, it } from "vitest";
import { alignedPairs } from "../core/model/holes";
import type { Part, Project } from "../core/model/project";
import { initPhysics, Sim } from "./world";

const P = (id: number, type: string, x: number, y: number, z = 0, rot: Part["rot"] = [0, 0, 0], props: Part["props"] = {}): Part => ({ id, type, x, y, z, rot, props });

beforeAll(async () => { await initPhysics(); });

const run = (sim: Sim, seconds: number, v: (id: number) => number = () => 0) => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    sim.step(1 / 60, v);
    sim.status(v, 1 / 60);
  }
};

describe("física", () => {
  it("una pieza sin apoyo cae y se avisa", () => {
    const project: Project = { parts: [P(1, "profile120", 0, 0, 100)], cables: [], nextId: 2 };
    const sim = new Sim(project);
    run(sim, 1);
    expect(sim.poses().get(1)!.p[2]).toBeLessThan(20);
    expect(sim.status(() => 0, 0).issues.some((i) => i.h === "Estructura que se derrumba")).toBe(true);
    sim.free();
  });

  it("una pieza sobre la placa se queda quieta", () => {
    const project: Project = { parts: [P(1, "plate", 0, 0), P(2, "profile120", 0, 0, 6)], cables: [], nextId: 3 };
    const sim = new Sim(project);
    run(sim, 1);
    expect(sim.poses().get(2)!.p[2]).toBeCloseTo(11, 0);
    sim.free();
  });

  it("un eslabón montado en el eje del motor gira cerca de la velocidad en vacío", () => {
    const motor = P(1, "dcmotor", 0, 0, 0, [0, 3, 0], { vnom: 12, rpm: 60, torque: 0.8 });
    const link = P(2, "link", 43, 0, 60);
    const base: Project = { parts: [motor, link], cables: [], nextId: 3 };
    const pair = alignedPairs(base, 2).find((q) => q.shaft)!;
    expect(pair).toBeDefined();
    const project: Project = { ...base, joints: [{ id: 9, kind: "revolute", a: pair.a, b: pair.b }] };
    const sim = new Sim(project);
    run(sim, 1.5, () => 12);
    const st = sim.status(() => 12, 0);
    expect(Math.abs(st.motors[1]!.rpm)).toBeGreaterThan(40);
    expect(Math.abs(st.motors[1]!.rpm)).toBeLessThan(70);
    sim.free();
  });
});

import { useProject } from "../store/project";
describe("ejemplo inicial en física", () => {
  it("el brazo gira con el motor y nada se derrumba", () => {
    const project = useProject.getState().project;
    const sim = new Sim(project);
    run(sim, 2, (id) => (id === 14 ? 12 : 0));
    const st = sim.status((id) => (id === 14 ? 12 : 0), 0);
    expect(Math.abs(st.motors[14]!.rpm)).toBeGreaterThan(20);
    expect(st.issues.map((i) => i.h)).not.toContain("Estructura que se derrumba");
    sim.free();
  });
});
