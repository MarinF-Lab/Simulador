import { beforeAll, describe, expect, it } from "vitest";
import { alignedPairs } from "../core/model/holes";
import type { Part, Project } from "../core/model/project";
import { initPhysics, Sim } from "./world";

const P = (id: number, type: string, x: number, y: number, z = 0, rot: Part["rot"] = [0, 0, 0], props: Part["props"] = {}): Part => ({ id, type, x, y, z, rot, props });

beforeAll(async () => { await initPhysics(); });

const run = (sim: Sim, seconds: number, v: (id: number) => number = () => 0, props: (id: number) => Record<string, unknown> = () => ({})) => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    sim.step(1 / 60, { voltage: v, props });
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

import { holesOf } from "../core/model/holes";
/** Corre la pieza para que su agujero h quede sobre el punto p. */
function alignHole(part: Part, h: number, p: [number, number, number]): Part {
  const hole = holesOf(part)[h]!;
  return { ...part, x: part.x + p[0] - hole.p[0], y: part.y + p[1] - hole.p[1], z: part.z + p[2] - hole.p[2] };
}
/** Monta `part` en la punta de eje del actuador `act` (agujero de normal opuesta más cercano). */
function mount(act: Part, part: Part): { part: Part; joint: { a: { part: number; h: number }; b: { part: number; h: number } } } {
  const tipIdx = holesOf(act).findIndex((h) => h.shaft);
  const tip = holesOf(act)[tipIdx]!;
  // Entre los agujeros que miran hacia la punta, el que deja la pieza más arriba (sin tocar la placa).
  const cands = holesOf(part).map((h, i) => ({ h, i })).filter(({ h }) => h.n[0] * tip.n[0] + h.n[1] * tip.n[1] + h.n[2] * tip.n[2] < -0.99);
  const best = cands.map(({ i }) => ({ i, p: alignHole(part, i, tip.p) })).sort((a, b) => b.p.z - a.p.z)[0]!;
  const idx = best.i, placed = best.p;
  return { part: placed, joint: { a: { part: placed.id, h: idx }, b: { part: act.id, h: tipIdx } } };
}

describe("actuadores", () => {
  it("el servo lleva el eslabón al ángulo pedido", () => {
    const plate = P(1, "plate", 0, 0), servo = P(2, "servo", 0, 0, 6, [0, 0, 0], { target: 60, speed: 90 });
    const m = mount(servo, P(3, "link", 0, 0, 0, [0, 0, 0], { lx: 60 }));
    const project: Project = { parts: [plate, servo, m.part], cables: [], joints: [{ id: 9, kind: "revolute", ...m.joint }], nextId: 10 };
    const sim = new Sim(project);
    const props = (id: number) => project.parts.find((p) => p.id === id)!.props;
    run(sim, 2.5, () => 6, props);
    expect(sim.status({ voltage: () => 6, props }, 0).motors[2]!.angle).toBeCloseTo(60, -1);
    sim.free();
  });

  it("el paso a paso gira media vuelta en un segundo a 100 pasos/s con 200 pasos por vuelta", () => {
    const plate = P(1, "plate", 0, 0), st = P(2, "stepper", 0, 0, 6, [0, 0, 0], { steps: 200, sps: 100, torque: 0.4 });
    const m = mount(st, P(3, "link", 0, 0, 0, [0, 0, 0], { lx: 60 }));
    const project: Project = { parts: [plate, st, m.part], cables: [], joints: [{ id: 9, kind: "revolute", ...m.joint }], nextId: 10 };
    const sim = new Sim(project);
    const props = (id: number) => project.parts.find((p) => p.id === id)!.props;
    run(sim, 1, () => 12, props);
    const a = sim.status({ voltage: () => 12, props }, 0).motors[2]!.angle!;
    expect(Math.abs(Math.abs(a) - 180)).toBeLessThan(12);
    sim.free();
  });

  it("el actuador lineal empuja lo que tiene en la punta", () => {
    const plate = P(1, "plate", 0, 0, 0, [0, 0, 0], { lx: 300 }), act = P(2, "linear", -40, 0, 6, [0, 0, 0], { lspeed: 20, stroke: 100 });
    const m = mount(act, P(3, "link", 0, 0, 0, [0, 1, 0], { lx: 60 }));
    const project: Project = { parts: [plate, act, m.part], cables: [], joints: [{ id: 9, kind: "fixed", ...m.joint }], nextId: 10 };
    const sim = new Sim(project);
    const props = (id: number) => project.parts.find((p) => p.id === id)!.props;
    run(sim, 2, () => 12, props);
    const ext = sim.status({ voltage: () => 12, props }, 0).motors[2]!.ext!;
    expect(ext).toBeGreaterThan(30);
    expect(ext).toBeLessThan(50);
    sim.free();
  });

  it("el sensor de contacto se presiona cuando una pieza cae sobre él", () => {
    const plate = P(1, "plate", 0, 0), sensor = P(2, "sensorContact", 0, 0, 6), box = P(3, "profile60", 0, 0, 40);
    const sim = new Sim({ parts: [plate, sensor, box], cables: [], nextId: 4 });
    run(sim, 1);
    expect(sim.status(() => 0, 0).pressed[2]).toBe(true);
    sim.free();
  });
});

describe("brazo de servos del ejemplo", () => {
  it("cada servo lleva su articulación al ángulo pedido", () => {
    const st = useProject.getState();
    expect(st.structure.issues).toEqual([]);
    const project = st.project;
    const sim = new Sim(project);
    const props = (id: number) => project.parts.find((p) => p.id === id)?.props ?? {};
    const volt = (id: number) => st.circuit.readings[id]?.v ?? 0;
    expect(volt(31)).toBeGreaterThan(5);
    run(sim, 3, volt, props);
    const m = sim.status({ voltage: volt, props }, 0).motors;
    expect(m[31]!.angle).toBeCloseTo(30, 1);
    expect(m[33]!.angle).toBeCloseTo(-45, 1);
    // El eslabón 1 quedó girado 30° alrededor del brazo del servo 1 (en x −210, y −230).
    const c = sim.poses().get(32)!.p, r = (30 * Math.PI) / 180;
    expect(c[0]).toBeCloseTo(-210 + 33 * Math.cos(r), 0);
    expect(c[1]).toBeCloseTo(-230 + 33 * Math.sin(r), 0);
    sim.free();
  });
});
