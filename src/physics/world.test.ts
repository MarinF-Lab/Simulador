import { beforeAll, describe, expect, it } from "vitest";
import { alignedPairs } from "../core/model/holes";
import { extent, type Part, type Project } from "../core/model/project";
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
  it("la base gira, y el hombro y el codo suben y bajan al ángulo pedido", () => {
    const st = useProject.getState();
    expect(st.structure.issues).toEqual([]);
    const project = st.project;
    const part = (id: number) => project.parts.find((p) => p.id === id)!;
    const sim = new Sim(project);
    const props = (id: number) => part(id).props;
    const volt = (id: number) => st.circuit.readings[id]?.v ?? 0;
    for (const id of [31, 33, 44]) expect(volt(id)).toBeGreaterThan(5);
    run(sim, 3, volt, props);
    const m = sim.status({ voltage: volt, props }, 0).motors;
    expect(m[31]!.angle).toBeCloseTo(45, 1);
    expect(m[33]!.angle).toBeCloseTo(40, 1);
    expect(m[44]!.angle).toBeCloseTo(-60, 1);
    // Eslabón 1: sube 40° alrededor del brazo del servo 2 y todo gira 45° sobre la base.
    const S1 = holesOf(part(31))[2]!.p, H2 = holesOf(part(33))[2]!.p;
    const L1 = part(32), c0 = [L1.x, L1.y, L1.z + extent(L1)[2] / 2];
    const up = (40 * Math.PI) / 180, yaw = (45 * Math.PI) / 180;
    const dx = c0[0]! - H2[0];
    const lifted = [H2[0] + dx * Math.cos(up), c0[1]!, H2[2] + dx * Math.sin(up)];
    const rx = lifted[0]! - S1[0], ry = lifted[1]! - S1[1];
    const want = [S1[0] + rx * Math.cos(yaw) - ry * Math.sin(yaw), S1[1] + rx * Math.sin(yaw) + ry * Math.cos(yaw), lifted[2]!];
    const c = sim.poses().get(32)!.p;
    for (let k = 0; k < 3; k++) expect(c[k]).toBeCloseTo(want[k]!, 0);
    sim.free();
  });

  it("la base recorre 180°, de −90° a 90°", () => {
    const st = useProject.getState();
    const project = st.project;
    const volt = (id: number) => st.circuit.readings[id]?.v ?? 0;
    for (const target of [90, -90]) {
      const sim = new Sim(project);
      const props = (id: number) => (id === 31 ? { ...project.parts.find((p) => p.id === 31)!.props, target, speed: 120 } : project.parts.find((p) => p.id === id)?.props ?? {});
      run(sim, 2, volt, props);
      expect(sim.status({ voltage: volt, props }, 0).motors[31]!.angle).toBeCloseTo(target, 1);
      sim.free();
    }
  });
});

describe("auto del ejemplo", () => {
  it("avanza por la mesa con sus 4 ruedas", async () => {
    const { EXAMPLES } = await import("../core/persistence/examples");
    const { analyze } = await import("../core/electrical/analyze");
    const project = EXAMPLES.find((e) => e.id === "car")!.build();
    const c = analyze(project);
    const sim = new Sim(project);
    const props = (id: number) => project.parts.find((p) => p.id === id)?.props ?? {};
    const volt = (id: number) => c.readings[id]?.v ?? 0;
    for (const m of project.parts.filter((p) => p.type === "dcmotor")) expect(Math.abs(volt(m.id))).toBeGreaterThan(5);
    run(sim, 2, volt, props);
    const chassis = sim.poses().get(1)!.p;
    expect(chassis[0] - -300).toBeGreaterThan(50);
    expect(Math.abs(chassis[1])).toBeLessThan(30);
    expect(chassis[2]).toBeGreaterThan(5);
    sim.free();
  });
});

describe("biela y pistón del ejemplo", () => {
  it("el émbolo va y viene unas 2 veces el radio de la manivela", async () => {
    const { EXAMPLES } = await import("../core/persistence/examples");
    const { analyze } = await import("../core/electrical/analyze");
    const project = EXAMPLES.find((e) => e.id === "crank")!.build();
    const c = analyze(project);
    const sim = new Sim(project);
    const props = (id: number) => project.parts.find((p) => p.id === id)?.props ?? {};
    const volt = (id: number) => c.readings[id]?.v ?? 0;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 300; i++) {
      sim.step(1 / 60, { voltage: volt, props });
      const e = sim.extensions().get(5)!;
      lo = Math.min(lo, e); hi = Math.max(hi, e);
    }
    // Manivela de 26 mm: el émbolo recorre 52 mm, desde el punto muerto de diseño hacia atrás.
    expect(hi - lo).toBeGreaterThan(45);
    expect(hi - lo).toBeLessThan(58);
    expect(hi).toBeLessThan(3);
    sim.free();
  });
});

describe("grúa del ejemplo", () => {
  it("la polea enrolla la cuerda y levanta la pesa", async () => {
    const { EXAMPLES } = await import("../core/persistence/examples");
    const { analyze } = await import("../core/electrical/analyze");
    const { solveTrain } = await import("../core/mechanical/train");
    const { motorSpeeds } = await import("../store/project");
    const project = EXAMPLES.find((e) => e.id === "crane")!.build();
    const c = analyze(project);
    const rpm = solveTrain(project, motorSpeeds(project, c)).rpm;
    expect(Math.abs(rpm[6] ?? 0)).toBeGreaterThan(15);
    const sim = new Sim(project);
    const props = (id: number) => project.parts.find((p) => p.id === id)?.props ?? {};
    const env = { voltage: (id: number) => c.readings[id]?.v ?? 0, props, rpm: (id: number) => rpm[id] ?? 0 };
    for (let i = 0; i < 120; i++) sim.step(1 / 60, env);
    const z = sim.poses().get(7)!.p[2];
    expect(z).toBeGreaterThan(15 + 40);
    sim.free();
  });
});

describe("placa de control del ejemplo", () => {
  it("el actuador avanza hasta tocar el sensor y la placa lo detiene", async () => {
    const { EXAMPLES } = await import("../core/persistence/examples");
    const { analyze } = await import("../core/electrical/analyze");
    const project = EXAMPLES.find((e) => e.id === "controller")!.build();
    const warn = analyze(project).issues.filter((i) => i.s === "warn" || i.s === "err");
    expect(warn).toEqual([]);
    const sim = new Sim(project);
    const props = (id: number) => project.parts.find((p) => p.id === id)?.props ?? {};
    let c = analyze(project);
    const env = { voltage: (id: number) => c.readings[id]?.v ?? 0, props };
    expect(env.voltage(14)).toBeGreaterThan(5);
    let touched = -1;
    for (let i = 0; i < 360; i++) {
      sim.step(1 / 60, env);
      if (i % 6 === 0) {
        // Como en la app: los sensores presionados cambian el circuito.
        const pressed = sim.status(env, 0.1).pressed;
        c = analyze({ ...project, parts: project.parts.map((p) => (pressed[p.id] ? { ...p, props: { ...p.props, pressed: true } } : p)) });
        if (pressed[19] && touched < 0) touched = i;
      }
    }
    expect(touched).toBeGreaterThan(0);
    expect(Math.abs(env.voltage(14))).toBeLessThan(0.05);
    const ext = sim.extensions().get(14)!;
    // La paleta estaba a 40 mm del sensor: se detuvo cerca de ahí, lejos del final de la carrera.
    expect(ext).toBeGreaterThan(30);
    expect(ext).toBeLessThan(60);
    sim.free();
  });
});

describe("molino del ejemplo", () => {
  it("las aspas pegadas giran con el disco", async () => {
    const { EXAMPLES } = await import("../core/persistence/examples");
    const { analyze } = await import("../core/electrical/analyze");
    const { checkStructure } = await import("../core/model/structure");
    const project = EXAMPLES.find((e) => e.id === "windmill")!.build();
    expect(checkStructure(project).issues).toEqual([]);
    const c = analyze(project);
    const sim = new Sim(project);
    const props = (id: number) => project.parts.find((p) => p.id === id)?.props ?? {};
    const angle = () => { const p = sim.poses().get(4)!.p; return Math.atan2(p[1], p[0]); };
    const a0 = angle(), d0 = Math.hypot(...(sim.poses().get(4)!.p.slice(0, 2) as [number, number]));
    run(sim, 0.5, (id) => c.readings[id]?.v ?? 0, props);
    let da = angle() - a0;
    while (da < -Math.PI) da += 2 * Math.PI;
    while (da > Math.PI) da -= 2 * Math.PI;
    // 30 RPM: media vuelta por segundo, unos 90° en 0,5 s. El aspa sigue a la misma distancia del eje.
    expect(Math.abs(da)).toBeGreaterThan((60 * Math.PI) / 180);
    expect(Math.hypot(...(sim.poses().get(4)!.p.slice(0, 2) as [number, number]))).toBeCloseTo(d0, 0);
    expect(sim.poses().get(4)!.p[2]).toBeGreaterThan(60);
    sim.free();
  });
});

describe("piezas sobre engranajes y poleas", () => {
  const spinSetup = async (top: (gear: Part) => { part: Part; joint: Project["joints"] }) => {
    const { analyze } = await import("../core/electrical/analyze");
    const { solveTrain } = await import("../core/mechanical/train");
    const { motorSpeeds } = await import("../store/project");
    const { termWorld } = await import("../core/model/terminals");
    const plate = P(1, "plate", 0, 0, 0, [0, 0, 0], { lx: 200, ly: 200 });
    const motor = P(2, "dcmotor", 0, 0, 6, [0, 3, 0], { rpm: 60, vnom: 6 });
    const bat = P(3, "source", 0, 150, 0, [0, 0, 0], { v: 6 });
    const gear = P(4, "gear40", 0, 0, 57);
    const t = top(gear);
    const cable = (id: number, a: Part, ta: number, b: Part, tb: number) => {
      const [x0, y0, z0] = termWorld(a, ta), [x1, y1, z1] = termWorld(b, tb);
      return { id, ends: [{ att: { part: a.id, t: ta }, x: x0, y: y0, z: z0 }, { att: { part: b.id, t: tb }, x: x1, y: y1, z: z1 }] as Project["cables"][number]["ends"] };
    };
    const project: Project = { parts: [plate, motor, bat, gear, t.part], cables: [cable(10, bat, 1, motor, 1), cable(11, motor, 0, bat, 0)], joints: t.joint, nextId: 20 };
    const c = analyze(project);
    const rpm = solveTrain(project, motorSpeeds(project, c)).rpm;
    return { project, rpm, c };
  };
  const angleAt = (p: number[]) => Math.atan2(p[1]!, p[0]!);

  it("un eslabón unido a un agujero del engranaje da vueltas con él", async () => {
    const { project, rpm, c } = await spinSetup((gear) => {
      const link = alignHole(P(5, "link", 0, 0, 0, [0, 0, 0], { lx: 40 }), 1, holesOf(gear)[2]!.p);
      return { part: link, joint: [{ id: 6, kind: "fixed", a: { part: 5, h: 1 }, b: { part: 4, h: 2 } }] };
    });
    expect(Math.abs(rpm[4] ?? 0)).toBeGreaterThan(50);
    const sim = new Sim(project);
    const env = { voltage: (id: number) => c.readings[id]?.v ?? 0, props: (id: number) => project.parts.find((p) => p.id === id)?.props ?? {}, rpm: (id: number) => rpm[id] ?? 0 };
    const a0 = angleAt(sim.poses().get(5)!.p);
    for (let i = 0; i < 15; i++) sim.step(1 / 60, env); // 0,25 s a ~60 RPM: un cuarto de vuelta
    let da = angleAt(sim.poses().get(5)!.p) - a0;
    while (da < -Math.PI) da += 2 * Math.PI;
    while (da > Math.PI) da -= 2 * Math.PI;
    expect(Math.abs(da)).toBeGreaterThan((60 * Math.PI) / 180);
    expect(Math.abs(da)).toBeLessThan((120 * Math.PI) / 180);
    // El engranaje no aparece entre las poses: se dibuja girando con el tren.
    expect(sim.poses().has(4)).toBe(false);
    sim.free();
  });

  it("una pieza pegada encima del engranaje gira con él", async () => {
    const { project, rpm, c } = await spinSetup((gear) => {
      const piece: Part = { id: 5, type: "custom", x: 20, y: 0, z: gear.z + 8, rot: [0, 0, 0], props: { shape: "-20,-6;20,-6;20,6;-20,6", h: 4, holes: "Sin agujeros" } };
      return { part: piece, joint: [{ id: 6, kind: "glue", a: { part: 5, h: -1 }, b: { part: 4, h: -1 } }] };
    });
    const sim = new Sim(project);
    const env = { voltage: (id: number) => c.readings[id]?.v ?? 0, props: (id: number) => project.parts.find((p) => p.id === id)?.props ?? {}, rpm: (id: number) => rpm[id] ?? 0 };
    for (let i = 0; i < 15; i++) sim.step(1 / 60, env);
    const p = sim.poses().get(5)!.p;
    expect(Math.abs(angleAt(p))).toBeGreaterThan((60 * Math.PI) / 180);
    expect(p[2]).toBeGreaterThan(60);
    sim.free();
  });
});

describe("el motor se detiene si no puede mover la carga", () => {
  const train = async (project: Project) => {
    const { solveTrain } = await import("../core/mechanical/train");
    const motors = Object.fromEntries(project.parts.filter((p) => p.type === "dcmotor").map((p) => [p.id, 60]));
    return solveTrain(project, motors);
  };
  const envOf = (project: Project, t: Awaited<ReturnType<typeof train>>, v: () => number) => ({
    voltage: (id: number) => (project.parts.find((p) => p.id === id)?.type === "dcmotor" ? v() : 0),
    props: (id: number) => project.parts.find((p) => p.id === id)?.props ?? {},
    rpm: (id: number) => t.rpm[id] ?? 0,
    source: (id: number) => t.source[id],
    ratio: (id: number) => t.ratio[id] ?? 0,
    stages: (id: number) => t.stages[id] ?? 0,
  });
  const arm = (id: number, gx: number, gz: number): Part => ({ id, type: "custom", x: gx, y: 25, z: gz, rot: [0, 0, 0], props: { shape: "-5,-20;5,-20;5,20;-5,20", h: 4, holes: "Sin agujeros" } });

  it("dos garras pegadas a engranajes se detienen al juntarse y se sueltan al invertir", async () => {
    const plate = P(1, "plate", 40, 0, 0, [0, 0, 0], { lx: 240, ly: 200 });
    const motor = P(2, "dcmotor", 0, 0, 6, [0, 3, 0], { rpm: 60, vnom: 6, torque: 0.8 });
    const g1 = P(4, "gear40", 0, 0, 57), g2 = P(5, "gear40", 80, 0, 57);
    // Brazos de 40 mm que salen hacia +Y desde 5 mm del centro: al girar se cruzan entre los ejes.
    const a1 = arm(6, 0, 65), a2 = arm(7, 80, 65);
    const project: Project = {
      parts: [plate, motor, g1, g2, a1, a2], cables: [], nextId: 20,
      joints: [{ id: 8, kind: "glue", a: { part: 6, h: -1 }, b: { part: 4, h: -1 } }, { id: 9, kind: "glue", a: { part: 7, h: -1 }, b: { part: 5, h: -1 } }],
    };
    const t = await train(project);
    expect(t.source[4]).toBe(2);
    expect(t.ratio[5]).toBeCloseTo(-1);
    let v = 6;
    const env = envOf(project, t, () => v);
    const sim = new Sim(project);
    // Rectángulos reales de los brazos (10 × 40 mm) y su separación con ejes separadores.
    const rects = () => {
      const s = sim.spins();
      return [[0, s.get(4)!], [80, s.get(5)!]].map(([cx, th]) => [[-5, 5], [5, 5], [5, 45], [-5, 45]].map(([x, y]) => [cx! + x! * Math.cos(th!) - y! * Math.sin(th!), x! * Math.sin(th!) + y! * Math.cos(th!)]));
    };
    const sep = (a: number[][], b: number[][]) => {
      let best = -Infinity;
      for (const poly of [a, b]) for (let i = 0; i < 4; i++) {
        const [x0, y0] = poly[i]!, [x1, y1] = poly[(i + 1) % 4]!, l = Math.hypot(x1! - x0!, y1! - y0!);
        const n = [(y1! - y0!) / l, -(x1! - x0!) / l];
        const pa = a.map((p) => p[0]! * n[0]! + p[1]! * n[1]!), pb = b.map((p) => p[0]! * n[0]! + p[1]! * n[1]!);
        best = Math.max(best, Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
      }
      return best;
    };
    let minD = Infinity;
    for (let i = 0; i < 150; i++) { sim.step(1 / 60, env); const [r1, r2] = rects(); minD = Math.min(minD, sep(r1!, r2!)); }
    // Nunca se atraviesan (se meten menos de 1,5 mm).
    expect(minD).toBeGreaterThan(-1.5);
    const st = sim.status(env, 0.3);
    expect(st.issues.map((i) => i.h)).toContain("Motor detenido por un choque");
    expect(Math.abs(st.motors[2]!.rpm)).toBeLessThan(5);
    const th = sim.spins().get(4)!;
    // Al invertir, vuelve a girar en el otro sentido.
    v = -6;
    for (let i = 0; i < 30; i++) sim.step(1 / 60, env);
    expect(Math.abs(sim.spins().get(4)! - th)).toBeGreaterThan(0.5);
    sim.free();
  });

  it("una garra que gira libre sigue girando", async () => {
    const plate = P(1, "plate", 0, 0, 0, [0, 0, 0], { lx: 200, ly: 200 });
    const motor = P(2, "dcmotor", 0, 0, 6, [0, 3, 0], { rpm: 60, vnom: 6, torque: 0.8 });
    const g1 = P(4, "gear40", 0, 0, 57);
    const project: Project = { parts: [plate, motor, g1, arm(6, 0, 65)], cables: [], nextId: 20, joints: [{ id: 8, kind: "glue", a: { part: 6, h: -1 }, b: { part: 4, h: -1 } }] };
    const t = await train(project);
    const env = envOf(project, t, () => 6);
    const sim = new Sim(project);
    for (let i = 0; i < 60; i++) sim.step(1 / 60, env);
    // 60 RPM: una vuelta por segundo.
    expect(Math.abs(sim.spins().get(4)!)).toBeGreaterThan(1.6 * Math.PI);
    expect(sim.status(env, 0.3).issues.map((i) => i.h)).not.toContain("Motor detenido por un choque");
    sim.free();
  });

  it("levantar un brazo pesado depende del voltaje y de la reducción", async () => {
    const { snapRotor } = await import("../core/mechanical/snap");
    // Motor de eje horizontal (+X) sobre una placa elevada y anclada.
    const build = (reduce: boolean): Project => {
      const plate = P(1, "plate", 0, 0, 134, [0, 0, 0], { lx: 60, ly: 60 });
      const motor = P(2, "dcmotor", 0, 0, 140, [0, 0, 0], { rpm: 60, vnom: 6, torque: 0.02 });
      const base: Project = { parts: [plate, motor], cables: [], nextId: 20 };
      const small = P(3, reduce ? "gear10" : "gear40", 0, 0, 0);
      const s1 = snapRotor(base, small, 25, 0)!;
      const g1 = { ...small, ...s1 };
      base.parts.push(g1);
      let big = g1;
      if (reduce) {
        // Engranaje de 40 engranando arriba del de 10: 4 veces más lento y fuerte.
        big = { ...P(4, "gear40", 0, 0, 0), x: g1.x, y: g1.y, z: g1.z + extent(g1)[2] / 2 + 50 - 42, rot: g1.rot };
        base.parts.push(big);
      }
      const cz = big.z + extent(big)[2] / 2;
      // Barra de aluminio de 100 × 10 × 20 mm pegada a la cara del engranaje, horizontal.
      const bar: Part = { id: 9, type: "custom", x: big.x + 4 + 10, y: 60, z: cz - 5, rot: [0, 1, 0], props: { shape: "-5,-50;5,-50;5,50;-5,50", h: 20, holes: "Sin agujeros", color: "Aluminio" } };
      base.parts.push(bar);
      return { ...base, joints: [{ id: 10, kind: "glue", a: { part: 9, h: -1 }, b: { part: big.id, h: -1 } }] };
    };
    const turn = async (project: Project, v: number, seconds: number) => {
      const t = await train(project);
      const env = envOf(project, t, () => v);
      const sim = new Sim(project);
      const id = project.parts.find((p) => p.id === 4) ? 4 : 3;
      for (let i = 0; i < seconds * 60; i++) sim.step(1 / 60, env);
      const out = { angle: Math.abs(sim.spins().get(id)!), issues: sim.status(env, 0.3).issues.map((i) => i.h) };
      sim.free();
      return out;
    };
    // Directo, a 6 V: no puede dar la vuelta con la barra.
    const weak = await turn(build(false), 6, 3);
    expect(weak.angle).toBeLessThan(2 * Math.PI);
    expect(weak.issues).toContain("Motor sin fuerza suficiente");
    // Con el doble de voltaje tiene el doble de fuerza: da más de una vuelta.
    const strong = await turn(build(false), 12, 3);
    expect(strong.angle).toBeGreaterThan(2 * Math.PI);
    // Con reducción 10 → 40, a 6 V, la mueve (más lento).
    const geared = await turn(build(true), 6, 6);
    expect(geared.angle).toBeGreaterThan(1.2 * Math.PI);
  });
});

describe("garras del usuario", () => {
  it("dos garras que empiezan tocándose se detienen al cerrarse, sin atravesarse", async () => {
    const { solveTrain } = await import("../core/mechanical/train");
    const parts: Part[] = [
      P(13, "plate", 196, -47, 0, [0, 0, 0], { lx: 200, ly: 160, lz: 4 }),
      P(14, "dcmotor", 180, -40, 4, [0, 3, 0], { rpm: 30, torque: 0.8, vnom: 9 }),
      P(15, "gear10", 179.7, -40.3, 54),
      P(61, "gear20", 200.4, -18.8, 57),
      P(62, "gear20", 240.4, -18.9, 57),
      P(65, "custom", 240, -51, 65, [0, 0, 0], { shape: "-10,45;20,25;20,-25;-10,-45;-20,-45;-20,-15;-10,-15;0,-5;0,5;-10,15", h: 6, color: "Madera", holes: "Cada 10 mm" }),
      P(66, "custom", 200, -51, 65, [0, 2, 0], { shape: "-20,-45;-10,-45;20,-25;20,25;-10,45;-10,15;0,5;0,-5;-10,-15;-20,-15", h: 6, color: "Madera", holes: "Cada 10 mm" }),
    ];
    const project: Project = { parts, cables: [], nextId: 90, joints: [
      { id: 69, kind: "fixed", a: { part: 62, h: 8 }, b: { part: 65, h: 11 } },
      { id: 70, kind: "fixed", a: { part: 61, h: 8 }, b: { part: 66, h: 10 } },
    ] };
    const t = solveTrain(project, { 14: -30 });
    const pos = () => { const p = sim.poses().get(65)!.p; return [p[0], p[1]]; };
    const env = (v: number) => ({
      voltage: (id: number) => (id === 14 ? v : 0), props: (id: number) => parts.find((p) => p.id === id)?.props ?? {},
      rpm: (id: number) => t.rpm[id] ?? 0, source: (id: number) => t.source[id], ratio: (id: number) => t.ratio[id] ?? 0, stages: (id: number) => t.stages[id] ?? 0,
    });
    // Cerrando: ya se tocan, así que no avanzan.
    let sim = new Sim(project);
    const p0 = pos();
    for (let i = 0; i < 120; i++) sim.step(1 / 60, env(-3.7));
    expect(Math.hypot(pos()[0]! - p0[0]!, pos()[1]! - p0[1]!)).toBeLessThan(1);
    expect(sim.status(env(-3.7), 0.3).issues.map((i) => i.h)).toContain("Motor detenido por un choque");
    sim.free();
    // Abriendo: dan media vuelta y chocan por el otro lado (no dan la vuelta completa).
    sim = new Sim(project);
    for (let i = 0; i < 900; i++) sim.step(1 / 60, env(3.7));
    expect(Math.abs(sim.spins().get(62)!)).toBeLessThan(Math.PI * 1.2);
    expect(Math.abs(sim.spins().get(62)!)).toBeGreaterThan(Math.PI * 0.7);
    sim.free();
  });
});
