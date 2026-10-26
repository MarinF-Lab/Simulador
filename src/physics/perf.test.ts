import { beforeAll, describe, expect, it } from "vitest";
import { analyze } from "../core/electrical/analyze";
import { solveTrain } from "../core/mechanical/train";
import type { Project } from "../core/model/project";
import { EXAMPLES } from "../core/persistence/examples";
import { motorSpeeds } from "../store/project";
import { initPhysics, Sim } from "./world";

beforeAll(async () => {
  await initPhysics();
});

/** Corre un proyecto (dx, dy) y le suma `base` a todos sus ids, para juntar varios en una mesa. */
function shift(p: Project, dx: number, dy: number, base: number): Project {
  const id = (n: number) => n + base;
  return {
    parts: p.parts.map((x) => ({ ...x, id: id(x.id), x: x.x + dx, y: x.y + dy })),
    cables: p.cables.map((c) => ({
      ...c,
      id: id(c.id),
      ends: c.ends.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy, att: e.att && { ...e.att, part: id(e.att.part) } })) as typeof c.ends,
    })),
    belts: (p.belts ?? []).map((b) => ({ ...b, id: id(b.id), a: id(b.a), b: id(b.b) })),
    joints: (p.joints ?? []).map((j) => ({ ...j, id: id(j.id), a: { ...j.a, part: id(j.a.part) }, b: { ...j.b, part: id(j.b.part) } })),
    nextId: p.nextId + base,
  };
}

describe("rendimiento", () => {
  it("una mesa con unas 45 piezas avanza un paso de física en pocos milisegundos", () => {
    const by = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
    // Cinco mecanismos en distintas zonas de la mesa.
    const parts = [
      shift(by("arm"), -450, -150, 0),
      shift(by("crank"), 250, -250, 100),
      shift(by("crane"), 400, 150, 200),
      shift(by("gears"), -100, 220, 300),
      shift(by("bulb"), -350, 250, 400),
      shift(by("car"), 0, -300, 500),
    ];
    const project: Project = {
      parts: parts.flatMap((p) => p.parts), cables: parts.flatMap((p) => p.cables),
      belts: parts.flatMap((p) => p.belts ?? []), joints: parts.flatMap((p) => p.joints ?? []), nextId: 600,
    };
    expect(project.parts.length).toBeGreaterThanOrEqual(40);
    const c = analyze(project);
    const rpm = solveTrain(project, motorSpeeds(project, c)).rpm;
    const env = { voltage: (id: number) => c.readings[id]?.v ?? 0, props: (id: number) => project.parts.find((p) => p.id === id)?.props ?? {}, rpm: (id: number) => rpm[id] ?? 0 };
    const sim = new Sim(project);
    for (let i = 0; i < 30; i++) sim.step(1 / 60, env); // calentar
    const n = 300, t0 = performance.now();
    for (let i = 0; i < n; i++) { sim.step(1 / 60, env); sim.poses(); sim.status(env, 1 / 60); }
    const ms = (performance.now() - t0) / n;
    console.log(`${project.parts.length} piezas: ${ms.toFixed(2)} ms por cuadro de física`);
    expect(ms).toBeLessThan(5);
    sim.free();
  });
});
