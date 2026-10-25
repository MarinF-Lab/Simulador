import { describe, expect, it } from "vitest";
import type { Part, Project } from "../model/project";
import { emptyHistory, exec, record, redo, removeCmd, undo, updateCmd } from "./commands";

const part = (id: number, x = 0): Part => ({ id, type: "gear10", x, y: 0, z: 0, rot: [0, 0, 0], props: {} });
const base = (): Project => ({ parts: [part(1), part(2, 100), part(3, 200)], nextId: 4 });

describe("historial", () => {
  it("agregar, deshacer y rehacer", () => {
    let [p, h] = exec(base(), emptyHistory(), { kind: "add", part: part(4, 300) });
    expect(p.parts).toHaveLength(4);
    expect(p.nextId).toBe(5);
    [p, h] = undo(p, h);
    expect(p.parts.map((x) => x.id)).toEqual([1, 2, 3]);
    [p, h] = redo(p, h);
    expect(p.parts.map((x) => x.id)).toEqual([1, 2, 3, 4]);
  });

  it("deshacer un borrado devuelve la pieza a su lugar", () => {
    const b = base();
    let [p, h] = exec(b, emptyHistory(), removeCmd(b, 2)!);
    expect(p.parts.map((x) => x.id)).toEqual([1, 3]);
    [p, h] = undo(p, h);
    expect(p.parts.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(h.future).toHaveLength(1);
  });

  it("mover y girar se deshacen con los valores anteriores", () => {
    const b = base();
    let [p, h] = exec(b, emptyHistory(), updateCmd(b, 1, { x: 50, rot: [0, 0, 1] })!);
    expect(p.parts[0]).toMatchObject({ x: 50, rot: [0, 0, 1] });
    [p] = undo(p, h);
    expect(p.parts[0]).toMatchObject({ x: 0, rot: [0, 0, 0] });
  });

  it("une ediciones seguidas del mismo campo en un solo paso", () => {
    let p = base();
    let h = emptyHistory();
    for (const v of [1, 2, 3]) [p, h] = exec(p, h, updateCmd(p, 1, { props: { v } }, "1:v")!, 1000 + v * 100);
    expect(h.past).toHaveLength(1);
    [p] = undo(p, h);
    expect(p.parts[0]!.props.v).toBeUndefined();
  });

  it("una acción nueva borra lo que se podía rehacer", () => {
    let [p, h] = exec(base(), emptyHistory(), { kind: "add", part: part(4) });
    [p, h] = undo(p, h);
    h = record(h, { kind: "add", part: part(5) });
    expect(h.future).toHaveLength(0);
    expect(p.parts).toHaveLength(3);
  });
});
