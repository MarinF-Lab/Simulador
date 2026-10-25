import { describe, expect, it } from "vitest";
import { CATALOG, CATEGORIES, searchCatalog } from "./catalog";

describe("catálogo", () => {
  it("cada pieza tiene id único y categoría válida", () => {
    const ids = new Set(CATALOG.map((i) => i.id));
    expect(ids.size).toBe(CATALOG.length);
    const cats = new Set(CATEGORIES.map((c) => c.id));
    expect(CATALOG.every((i) => cats.has(i.category))).toBe(true);
  });
  it("busca sin importar tildes ni mayúsculas", () => {
    expect(searchCatalog("lampara").map((i) => i.id)).toEqual(["lamp"]);
    expect(searchCatalog("ARTICULACION").map((i) => i.id)).toEqual(["joint"]);
  });
  it("busca por variante y combina palabras", () => {
    expect(searchCatalog("engranaje 40").map((i) => i.id)).toEqual(["gear40"]);
    expect(searchCatalog("xyz")).toEqual([]);
  });
});
