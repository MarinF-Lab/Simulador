import { describe, expect, it } from "vitest";
import { blockers, gapOf, hullsOf, restOn, slide } from "./footprint";
import { contactSpot } from "./structure";
import type { Part } from "./project";

const custom = (id: number, shape: string, x = 0, y = 0, z = 0, h = 6): Part => ({ id, type: "custom", x, y, z, rot: [0, 0, 0], props: { shape, h, holes: "Sin agujeros" } });
// L de 60 × 60 con brazos de 20: su caja es 60 × 60 pero la esquina de arriba a la derecha está vacía.
const L = "-30,-30;30,-30;30,-10;-10,-10;-10,30;-30,30";
const block = (id: number, x: number, y: number, z = 0) => custom(id, "-10,-10;10,-10;10,10;-10,10", x, y, z);

describe("forma real de las piezas", () => {
  it("un bloque en el hueco de la L no la atraviesa aunque esté dentro de su caja", () => {
    const l = custom(1, L), b = block(2, 15, 15);
    expect(gapOf(hullsOf(l), hullsOf(b))).toBeGreaterThan(4);
    expect(blockers({ parts: [l, b] }, b)).toEqual([]);
  });

  it("una L junto a un bloque: se tocan sin chocar y el pegamento ve el contacto", () => {
    const l = custom(1, L), b = block(2, 10, 0);
    const g = gapOf(hullsOf(l), hullsOf(b));
    expect(g).toBeGreaterThanOrEqual(-0.2);
    expect(g).toBeLessThanOrEqual(1);
    expect(contactSpot(l, b)).not.toBeNull();
    // Con la L antigua (su caja), el bloque dentro del hueco parecía tocarla.
    expect(contactSpot(l, block(3, 15, 15))).toBeNull();
  });

  it("un engranaje junto a una caja: en la esquina no se tocan aunque las cajas sí", () => {
    const g: Part = { id: 1, type: "gear40", x: 0, y: 0, z: 0, rot: [0, 0, 0], props: {} };
    const corner = block(2, 52, 52);
    expect(contactSpot(g, corner)).toBeNull();
    expect(contactSpot(g, block(3, 52, 0))).not.toBeNull();
  });

  it("una pieza bajo otra elevada no choca, y el apoyo no la sube", () => {
    const top = block(1, 0, 0, 30), low = block(2, 0, 0, 0);
    const parts = [top, low];
    expect(blockers({ parts }, low)).toEqual([]);
    expect(restOn({ parts }, low, 0, 0, 0)).toBe(0);
    // Sin tope de altura, se apoya encima.
    expect(restOn({ parts }, low, 0, 0)).toBe(36);
    // Una pieza a 40 mm cae sobre la de arriba, no sobre la mesa.
    expect(restOn({ parts }, low, 0, 0, 40)).toBe(36);
  });

  it("arrastrar contra una pieza la deja tocándola, sin atravesarla, y desliza a lo largo", () => {
    const wall = custom(1, "-5,-50;5,-50;5,50;-5,50"), b = block(2, -60, 0);
    const parts = [wall, b];
    const at = slide({ parts }, b, b, { x: 60, y: 0, z: 0 });
    expect(at.x).toBeLessThan(-14.7);
    expect(at.x).toBeGreaterThan(-15.5);
    // En diagonal: se queda pegada a la pared y sigue en Y.
    const d = slide({ parts }, b, b, { x: 60, y: 30, z: 0 });
    expect(d.x).toBeCloseTo(-15, 0);
    expect(d.y).toBe(30);
    // Por encima de la pared (más alta que ella) pasa sin chocar.
    const high = { ...b, z: 10 };
    expect(slide({ parts: [wall, high] }, high, high, { x: 60, y: 0, z: 10 }).x).toBe(60);
  });
});
