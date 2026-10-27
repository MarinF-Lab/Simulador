// Polígonos para las piezas libres: forma en mm locales (plano XY de la pieza), sin React ni DOM.

export type Pt = [number, number];

/** Lee la forma guardada como "x,y;x,y;…". Devuelve [] si no sirve. */
export function parseShape(s: unknown): Pt[] {
  if (typeof s !== "string") return [];
  const pts: Pt[] = [];
  for (const pair of s.split(";")) {
    const [x, y] = pair.split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    pts.push([x!, y!]);
  }
  return pts.length >= 3 ? pts : [];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
export const shapeText = (pts: Pt[]): string => pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join(";");

/** Área con signo: positiva si los vértices van en sentido antihorario. */
export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[(i + 1) % pts.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function bounds(pts: Pt[]): { x0: number; y0: number; x1: number; y1: number } {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Corre la forma para que su caja quede centrada en 0. Devuelve también cuánto se corrió. */
export function centered(pts: Pt[]): { pts: Pt[]; off: Pt } {
  const b = bounds(pts);
  const off: Pt = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  return { pts: pts.map(([x, y]) => [x - off[0], y - off[1]]), off };
}

export function inside(p: Pt, pts: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Distancia de un punto al borde del polígono. */
export function edgeDistance(p: Pt, pts: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i]!, [bx, by] = pts[(i + 1) % pts.length]!;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    d = Math.min(d, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
  }
  return d;
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Forma válida: 3 vértices o más, con área y sin lados que se crucen ni vértices repetidos. */
export function isSimple(pts: Pt[]): boolean {
  const n = pts.length;
  if (n < 3 || Math.abs(signedArea(pts)) < 1) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5) return false;
    for (let j = i + 1; j < n; j++) {
      // Los lados vecinos comparten un vértice: no cuentan como cruce.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(a, b, pts[j]!, pts[(j + 1) % n]!)) return false;
    }
  }
  return true;
}

/** Triángulos de la forma (índices de vértices), por recorte de orejas. Sirve para formas cóncavas. */
export function triangulate(input: Pt[]): [number, number, number][] {
  const ccw = signedArea(input) > 0;
  const idx = input.map((_, i) => i);
  if (!ccw) idx.reverse();
  const out: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10_000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length]!, i1 = idx[k]!, i2 = idx[(k + 1) % idx.length]!;
      const a = input[i0]!, b = input[i1]!, c = input[i2]!;
      if (cross(a, b, c) <= 1e-9) continue; // vértice cóncavo
      const blocked = idx.some((j) => j !== i0 && j !== i1 && j !== i2 && cross(a, b, input[j]!) >= 0 && cross(b, c, input[j]!) >= 0 && cross(c, a, input[j]!) >= 0);
      if (blocked) continue;
      out.push([i0, i1, i2]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push([idx[0]!, idx[1]!, idx[2]!]);
  return out;
}

/** Polígono regular de n lados y radio r, centrado. */
export const regular = (n: number, r: number, rot = 0): Pt[] =>
  Array.from({ length: n }, (_, i) => [r * Math.cos(rot + (i * 2 * Math.PI) / n), r * Math.sin(rot + (i * 2 * Math.PI) / n)] as Pt);

/** Puntos de una grilla cada `step` mm dentro de la forma, a 4 mm o más del borde (para agujeros). */
export function gridInside(pts: Pt[], step: number): Pt[] {
  const b = bounds(pts), out: Pt[] = [];
  for (let x = Math.ceil(b.x0 / step) * step; x <= b.x1; x += step) {
    for (let y = Math.ceil(b.y0 / step) * step; y <= b.y1; y += step) {
      const p: Pt = [x, y];
      if (inside(p, pts) && edgeDistance(p, pts) >= 4) out.push(p);
    }
  }
  return out;
}

/** Lee los agujeros perforados ("x,y;x,y"). A diferencia de la forma, puede haber 0, 1 o 2. */
export function parseDrill(s: unknown): Pt[] {
  if (typeof s !== "string" || !s) return [];
  const out: Pt[] = [];
  for (const pair of s.split(";")) {
    const [x, y] = pair.split(",").map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([x!, y!]);
  }
  return out;
}

/** Agujeros de una pieza libre: los de la grilla elegida y los perforados que caen dentro de la forma. */
export function customHoles(props: Record<string, unknown> | undefined): Pt[] {
  const pts = parseShape(props?.shape);
  if (!pts.length) return [];
  const step = props?.holes === "Cada 20 mm" ? 20 : props?.holes === "Sin agujeros" ? 0 : 10;
  const out = step ? gridInside(pts, step) : [];
  for (const d of parseDrill(props?.drill)) {
    if (inside(d, pts) && edgeDistance(d, pts) >= 3 && !out.some((o) => Math.hypot(o[0] - d[0], o[1] - d[1]) < 6)) out.push(d);
  }
  return out;
}
