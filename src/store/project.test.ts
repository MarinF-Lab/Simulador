import { describe, expect, it } from "vitest";
import { useProject } from "./project";

describe("ejemplo inicial", () => {
  it("el circuito de la ampolleta funciona, el tren 10 → 40 gira y el brazo tiene sus juntas", () => {
    const s = useProject.getState();
    expect(Math.abs(s.circuit.readings[4]!.v)).toBeCloseTo(3.77, 2);
    const r = s.mech.rpm;
    expect(Math.abs(r[15]!)).toBeGreaterThan(29);
    expect(r[17]! / r[15]!).toBeCloseTo(-0.25);
    expect(s.project.joints).toHaveLength(7);
    expect(s.structure.issues).toEqual([]);
    expect(s.mech.issues.filter((i) => i.s === "err" || i.s === "warn")).toEqual([]);
  });

  it("borrar una pieza borra sus juntas y deshacer las devuelve", () => {
    const st = useProject.getState();
    st.remove(18);
    expect(useProject.getState().project.joints).toHaveLength(5);
    useProject.getState().undo();
    expect(useProject.getState().project.joints).toHaveLength(7);
  });
});

describe("diseño libre", async () => {
  const { parseShape } = await import("../core/model/polygon");
  const { parseProject, serialize } = await import("../core/persistence/file");
  const { rotateLocal, unrotateLocal } = await import("../core/model/project");

  it("el giro inverso deshace el giro", () => {
    for (const rot of [[1, 0, 0], [0, 3, 0], [1, 2, 3], [3, 1, 2]] as [number, number, number][]) {
      expect(unrotateLocal(rotateLocal([3, -5, 7], rot), rot)).toEqual([3, -5, 7]);
    }
  });

  it("dibujar por puntos crea una pieza libre centrada en su forma", () => {
    const st = useProject.getState();
    st.load({ parts: [], cables: [], belts: [], joints: [], nextId: 1 });
    st.addNear("draw", 0, 0);
    for (const [x, y] of [[100, 0], [200, 0], [200, 50], [150, 100], [100, 50]]) useProject.getState().drawAdd(x!, y!);
    expect(useProject.getState().drawFinish()).toBe(true);
    const p = useProject.getState().project.parts[0]!;
    expect(p.type).toBe("custom");
    expect([p.x, p.y]).toEqual([150, 50]);
    expect(parseShape(p.props.shape)[0]).toEqual([-50, -50]);
    expect(useProject.getState().drawMode).toBeNull();
  });

  it("los lados cruzados no se aceptan", () => {
    const st = useProject.getState();
    st.load({ parts: [], cables: [], belts: [], joints: [], nextId: 1 });
    st.addNear("draw", 0, 0);
    for (const [x, y] of [[0, 0], [40, 40], [40, 0], [0, 40]]) useProject.getState().drawAdd(x!, y!);
    expect(useProject.getState().drawFinish()).toBe(false);
    expect(useProject.getState().drawMode?.msg).toMatch(/se cruzan/);
  });

  it("mover un vértice recentra la pieza sin correrla en la mesa, y se deshace en un paso", () => {
    const st = useProject.getState();
    st.load({ parts: [{ id: 1, type: "custom", x: 0, y: 0, z: 0, rot: [0, 0, 0], props: { shape: "-40,-20;40,-20;40,20;-40,20", h: 6 } }], cables: [], nextId: 2 });
    const s = useProject.getState();
    s.beginShape(1);
    // El vértice de arriba a la derecha se estira 20 mm hacia la derecha.
    expect(s.shapeLive(1, [[-40, -20], [40, -20], [60, 20], [-40, 20]])).toBe(true);
    // Un cambio que cruza lados no se aplica.
    expect(s.shapeLive(1, [[-40, -20], [40, -20], [-40, 20], [40, 20]])).toBe(false);
    s.endShape(1);
    const p = useProject.getState().project.parts[0]!;
    expect(p.x).toBe(10);
    expect(parseShape(p.props.shape)).toEqual([[-50, -20], [30, -20], [50, 20], [-50, 20]]);
    useProject.getState().undo();
    const q = useProject.getState().project.parts[0]!;
    expect(q.x).toBe(0);
    expect(q.props.shape).toBe("-40,-20;40,-20;40,20;-40,20");
  });

  it("agregar y quitar vértices", () => {
    const st = useProject.getState();
    st.load({ parts: [{ id: 1, type: "custom", x: 0, y: 0, z: 0, rot: [0, 0, 0], props: { shape: "-40,-20;40,-20;40,20;-40,20", h: 6 } }], cables: [], nextId: 2 });
    useProject.getState().insertVertex(1, 0);
    expect(parseShape(useProject.getState().project.parts[0]!.props.shape)).toHaveLength(5);
    useProject.getState().removeVertex(1, 1);
    useProject.getState().removeVertex(1, 0);
    // Con 3 vértices ya no se quita otro.
    useProject.getState().removeVertex(1, 0);
    expect(parseShape(useProject.getState().project.parts[0]!.props.shape)).toHaveLength(3);
  });

  it("el pegamento une piezas que se tocan, avisa si se separan y se guarda en el archivo", () => {
    const a = { id: 1, type: "custom", x: 0, y: 0, z: 0, rot: [0, 0, 0] as [number, number, number], props: { shape: "-40,-20;40,-20;40,20;-40,20", h: 6 } };
    const b = { ...a, id: 2, z: 6 };
    const far = { ...a, id: 3, x: 300 };
    const st = useProject.getState();
    st.load({ parts: [a, b, far], cables: [], joints: [], nextId: 4 });
    st.addNear("glue", 0, 0);
    useProject.getState().glueTap(1);
    useProject.getState().glueTap(3);
    expect(useProject.getState().glueMode?.msg).toMatch(/no se tocan/);
    useProject.getState().glueTap(2);
    const s = useProject.getState();
    expect(s.project.joints).toEqual([{ id: 4, kind: "glue", a: { part: 1, h: -1 }, b: { part: 2, h: -1 } }]);
    expect(s.structure.issues).toEqual([]);
    const back = parseProject(serialize(s.project));
    expect(back.ok && back.project.joints).toEqual(s.project.joints);
    s.endDrag(2, { x: 0, y: 0 });
    useProject.getState().run({ kind: "update", id: 2, before: { x: 0 }, after: { x: 200 } });
    expect(useProject.getState().structure.issues.map((i) => i.h)).toContain("Pegamento sin contacto");
  });
});

describe("juntas en dos toques", async () => {
  const { holesOf, alignTo } = await import("../core/model/holes");

  it("alignTo pone un agujero sobre otro, solo si las caras son opuestas", () => {
    const gear = { id: 1, type: "gear40", x: 0, y: 0, z: 0, rot: [0, 0, 0] as [number, number, number], props: {} };
    const link = { id: 2, type: "link", x: 200, y: 50, z: 0, rot: [0, 0, 0] as [number, number, number], props: { lx: 60 } };
    const top = holesOf(gear)[2]!; // anillo, cara de arriba
    const pos = alignTo(link, 1, top)!; // agujero del eslabón, cara de abajo
    expect(pos.z).toBe(8);
    const moved = holesOf({ ...link, ...pos })[1]!;
    expect(moved.p.map((v) => Math.round(v))).toEqual(top.p.map((v) => Math.round(v)));
    expect(alignTo(link, 0, top)).toBeNull(); // cara de arriba con cara de arriba: no
  });

  it("toca un agujero del engranaje y luego el eslabón: el eslabón se sube, se une y se deshace en un paso", () => {
    const gear = { id: 1, type: "gear40", x: 0, y: 0, z: 0, rot: [0, 0, 0] as [number, number, number], props: {} };
    const link = { id: 2, type: "link", x: 200, y: 50, z: 0, rot: [0, 0, 0] as [number, number, number], props: { lx: 60 } };
    const st = useProject.getState();
    st.load({ parts: [gear, link], cables: [], joints: [], nextId: 3 });
    st.addNear("joint", 0, 0);
    const ring = holesOf(gear)[2]!.p;
    useProject.getState().jointTap(1, [ring[0] + 1, ring[1], ring[2]]);
    expect(useProject.getState().jointFirst).toEqual({ part: 1, h: 2 });
    useProject.getState().jointTap(2, [200 - 23, 50, 0]);
    const s = useProject.getState();
    expect(s.project.joints).toHaveLength(1);
    expect(s.project.joints![0]!.kind).toBe("revolute");
    const moved = s.project.parts.find((p) => p.id === 2)!;
    expect(moved.z).toBe(8);
    expect(s.structure.issues).toEqual([]);
    expect(s.jointTool).toBeNull();
    s.undo();
    const back = useProject.getState();
    expect(back.project.joints).toHaveLength(0);
    expect(back.project.parts.find((p) => p.id === 2)!.x).toBe(200);
  });

  it("una pieza sin agujeros avisa que use Pegamento", () => {
    const st = useProject.getState();
    st.load({ parts: [{ id: 1, type: "source", x: 0, y: 0, z: 0, rot: [0, 0, 0], props: {} }], cables: [], joints: [], nextId: 2 });
    st.addNear("bolt", 0, 0);
    useProject.getState().jointTap(1, [0, 0, 30]);
    expect(useProject.getState().jointMsg).toMatch(/Pegamento/);
  });
});

describe("piezas lisas y perforables", async () => {
  const { holesOf } = await import("../core/model/holes");
  const { parseDrill } = await import("../core/model/polygon");
  const custom = () => useProject.getState().project.parts.find((p) => p.type === "custom")!;

  it("la Pieza libre lisa nace sin agujeros", () => {
    useProject.getState().load({ parts: [], cables: [], joints: [], nextId: 1 });
    useProject.getState().addNear("customPlain", 0, 0);
    expect(custom().type).toBe("custom");
    expect(holesOf(custom())).toHaveLength(0);
  });

  it("dibujar en modo Lisa crea la pieza sin agujeros", () => {
    const st = useProject.getState();
    st.load({ parts: [], cables: [], joints: [], nextId: 1 });
    st.setDrawHoles(false);
    st.addNear("draw", 0, 0);
    for (const [x, y] of [[0, 0], [80, 0], [80, 60], [0, 60]]) useProject.getState().drawAdd(x!, y!);
    useProject.getState().drawFinish();
    expect(holesOf(custom())).toHaveLength(0);
    useProject.getState().setDrawHoles(true);
  });

  it("el Taladro perfora donde se toca, tapa al tocar de nuevo y se deshace", () => {
    const st = useProject.getState();
    st.load({ parts: [{ id: 1, type: "custom", x: 100, y: 0, z: 0, rot: [0, 0, 0], props: { shape: "-40,-20;40,-20;40,20;-40,20", h: 6, holes: "Sin agujeros" } }], cables: [], joints: [], nextId: 2 });
    st.addNear("drill", 0, 0);
    useProject.getState().drillTap(1, [112, 5, 6]);
    expect(parseDrill(custom().props.drill)).toEqual([[12, 5]]);
    expect(holesOf(custom()).map((h) => h.p.slice(0, 2))).toContainEqual([112, 5]);
    // Muy cerca del borde: no perfora.
    useProject.getState().drillTap(1, [139, 0, 6]);
    expect(useProject.getState().drillMode?.msg).toMatch(/borde/);
    useProject.getState().drillTap(1, [113, 4, 6]);
    expect(custom().props.drill).toBeUndefined();
    useProject.getState().undo();
    expect(parseDrill(custom().props.drill)).toEqual([[12, 5]]);
  });

  it("los agujeros perforados no se mueven en la mesa al editar la forma", () => {
    const st = useProject.getState();
    st.load({ parts: [{ id: 1, type: "custom", x: 0, y: 0, z: 0, rot: [0, 0, 0], props: { shape: "-40,-20;40,-20;40,20;-40,20", h: 6, holes: "Sin agujeros", drill: "10,0" } }], cables: [], joints: [], nextId: 2 });
    const s = useProject.getState();
    s.beginShape(1);
    s.shapeLive(1, [[-40, -20], [80, -20], [80, 20], [-40, 20]]);
    s.endShape(1);
    const hole = holesOf(custom()).find((h) => h.n[2] > 0)!;
    expect(hole.p.slice(0, 2)).toEqual([10, 0]);
  });
});

describe("colocación sin imán", async () => {
  const { useUI } = await import("./ui");
  const sq = (id: number, x: number, y: number, z = 0, h = 6) => ({ id, type: "custom", x, y, z, rot: [0, 0, 0] as [number, number, number], props: { shape: "-20,-20;20,-20;20,20;-20,20", h, holes: "Sin agujeros" } });

  it("arrastrar no atraviesa: queda pegada a la otra pieza, y se mueve de a 1 mm", () => {
    useUI.getState().setMagnet(false);
    const st = useProject.getState();
    st.load({ parts: [sq(1, 0, 0), sq(2, -100, 3)], cables: [], belts: [], joints: [], nextId: 3 });
    st.beginDrag(2);
    useProject.getState().moveLive(2, -73, 3);
    expect(useProject.getState().project.parts[1]!.x).toBe(-73);
    useProject.getState().moveLive(2, 30, 3);
    const p = useProject.getState().project.parts[1]!;
    expect(p.x).toBeGreaterThan(-40.5);
    expect(p.x).toBeLessThanOrEqual(-39.8);
    useProject.getState().endDrag(2, { x: -100, y: 3 });
    expect(useProject.getState().structure.issues.some((i) => i.h === "Piezas superpuestas")).toBe(false);
  });

  it("una pieza pasa bajo otra elevada y al soltar sobre una pieza baja cae encima de ella", () => {
    const st = useProject.getState();
    st.load({ parts: [sq(1, 0, 0, 30), sq(2, -100, 0), sq(3, 100, 0, 0, 10)], cables: [], belts: [], joints: [], nextId: 4 });
    st.beginDrag(2);
    useProject.getState().moveLive(2, 0, 0);
    useProject.getState().endDrag(2, { x: -100, y: 0 });
    expect(useProject.getState().project.parts[1]).toMatchObject({ x: 0, y: 0, z: 0 });
    // Subirla con ↑ la detiene bajo la pieza de arriba (30 mm − 6 de alto = 24).
    for (let i = 0; i < 40; i++) useProject.getState().nudgeZ(2, 1);
    expect(useProject.getState().project.parts[1]!.z).toBeCloseTo(24, 0);
    // Una pieza en el aire, arrastrada sobre otra baja, se apoya encima al soltar.
    const s2 = useProject.getState();
    s2.load({ parts: [sq(2, -100, 0, 20), sq(3, 100, 0, 0, 10)], cables: [], belts: [], joints: [], nextId: 4 });
    s2.beginDrag(2);
    useProject.getState().moveLive(2, 100, 0);
    useProject.getState().endDrag(2, { x: -100, y: 0 });
    expect(useProject.getState().project.parts[0]).toMatchObject({ x: 100, z: 10 });
  });

  it("con imán vuelve la cuadrícula de 10 mm", () => {
    useUI.getState().setMagnet(true);
    const st = useProject.getState();
    st.load({ parts: [sq(2, -100, 0)], cables: [], belts: [], joints: [], nextId: 3 });
    st.beginDrag(2);
    useProject.getState().moveLive(2, -73, 4);
    expect(useProject.getState().project.parts[0]).toMatchObject({ x: -70, y: 0 });
    useProject.getState().endDrag(2, { x: -100, y: 0 });
    useUI.getState().setMagnet(false);
  });
});
