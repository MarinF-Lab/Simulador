import { describe, expect, it } from "vitest";
import { appendSample } from "./record";

describe("grabación", () => {
  it("alinea series que aparecen después con null", () => {
    let s = { t: [] as number[], series: {} as Record<string, (number | null)[]> };
    s = appendSample(s, 0, { "1:v": 9 });
    s = appendSample(s, 0.1, { "1:v": 8.9, "2:rpm": 30 });
    expect(s.t).toEqual([0, 0.1]);
    expect(s.series["1:v"]).toEqual([9, 8.9]);
    expect(s.series["2:rpm"]).toEqual([null, 30]);
  });
  it("guarda como máximo los últimos puntos", () => {
    let s = { t: [] as number[], series: {} as Record<string, (number | null)[]> };
    for (let i = 0; i < 10; i++) s = appendSample(s, i, { a: i }, 4);
    expect(s.t).toEqual([6, 7, 8, 9]);
    expect(s.series.a).toEqual([6, 7, 8, 9]);
  });
});
