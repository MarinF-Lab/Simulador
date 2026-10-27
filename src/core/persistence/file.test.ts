import { describe, expect, it } from "vitest";
import { demoProject } from "./examples";
import { parseProject, serialize } from "./file";

describe("guardar y cargar", () => {
  it("lo exportado vuelve igual", () => {
    const p = demoProject();
    const r = parseProject(serialize(p));
    expect(r.ok && r.project).toEqual(p);
    expect(r.ok && r.dropped).toBe(0);
  });

  it("acepta el proyecto solo, sin el envoltorio del archivo", () => {
    const p = demoProject();
    const r = parseProject(JSON.stringify(p));
    expect(r.ok && r.project.parts.length).toBe(p.parts.length);
  });

  it("explica el error con un JSON roto o sin piezas", () => {
    const a = parseProject("{nada");
    expect(!a.ok && a.error).toMatch(/JSON válido/);
    const b = parseProject(JSON.stringify({ hola: 1 }));
    expect(!b.ok && b.error).toMatch(/faltan las piezas/);
  });

  it("descarta piezas desconocidas, ids repetidos y lo que apunta a piezas que no están", () => {
    const text = JSON.stringify({
      parts: [
        { id: 1, type: "source", x: 0, y: 0, z: 0, rot: [0, 0, 0], props: { v: 9 } },
        { id: 2, type: "nave espacial", x: 0, y: 0, z: 0, rot: [0, 0, 0], props: {} },
        { id: 1, type: "lamp", x: 50, y: 0, z: 0, rot: [0, 0, 0], props: {} },
        { id: 3, type: "lamp", x: 50, y: 0, z: 0, rot: [5, 0, 0], props: { vn: 6, mala: { x: 1 } } },
      ],
      cables: [{ id: 4, ends: [{ att: { part: 1, t: 0 }, x: 0, y: 0, z: 0 }, { att: { part: 2, t: 0 }, x: 1, y: 1, z: 0 }] }],
      belts: [{ id: 5, a: 1, b: 9, cross: false }],
      joints: [{ id: 6, kind: "fixed", a: { part: 1, h: 0 }, b: { part: 3, h: 1 } }],
      nextId: 2,
    });
    const r = parseProject(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.project.parts.map((p) => p.id)).toEqual([1, 3]);
    expect(r.project.parts[1]!.rot).toEqual([1, 0, 0]);
    expect(r.project.parts[1]!.props).toEqual({ vn: 6 });
    // El cable queda, pero su punta en la pieza 2 (descartada) queda suelta.
    expect(r.project.cables[0]!.ends[1].att).toBeNull();
    expect(r.project.belts).toEqual([]);
    expect(r.project.joints).toHaveLength(1);
    expect(r.project.nextId).toBe(7);
    expect(r.dropped).toBe(3);
  });
});
