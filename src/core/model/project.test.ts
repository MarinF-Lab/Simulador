import { describe, expect, it } from "vitest";
import { extent, findFree, placeOnTable, TABLE, type Part } from "./project";

const part = (over: Partial<Part> = {}): Part => ({ id: 1, type: "source", x: 0, y: 0, z: 0, rot: [0, 0, 0], props: {}, ...over });

describe("extent", () => {
  it("sin girar es el tamaño base", () => expect(extent(part())).toEqual([60, 30, 30]));
  it("un cuarto de vuelta en Z cambia largo por ancho", () => expect(extent(part({ rot: [0, 0, 1] }))).toEqual([30, 60, 30]));
  it("un cuarto de vuelta en Y pone la pieza de pie", () => expect(extent(part({ rot: [0, 1, 0] }))).toEqual([30, 30, 60]));
  it("media vuelta no cambia el tamaño", () => expect(extent(part({ type: "profile240", rot: [2, 0, 2] }))).toEqual([240, 10, 10]));
});

describe("placeOnTable", () => {
  it("ajusta a 10 mm", () => expect(placeOnTable(part(), 14, -26)).toEqual({ x: 10, y: -30 }));
  it("no deja salir la pieza de la mesa", () => {
    const p = placeOnTable(part(), 5000, -5000);
    expect(p.x + 30).toBeLessThanOrEqual(TABLE.w / 2);
    expect(p.y - 15).toBeGreaterThanOrEqual(-TABLE.d / 2);
  });
});

describe("findFree", () => {
  it("usa el punto pedido si está libre", () => expect(findFree(part({ id: 2 }), [], 0, 0)).toEqual({ x: 0, y: 0 }));
  it("busca otro lugar si está ocupado", () => {
    const busy = part({ id: 1 });
    const p = findFree(part({ id: 2 }), [busy], 0, 0);
    const sepX = Math.abs(p.x) >= 60 + 10, sepY = Math.abs(p.y) >= 30 + 10;
    expect(sepX || sepY).toBe(true);
  });
});
