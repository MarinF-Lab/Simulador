// Agujeros de montaje de cada pieza, en su posición real (no siempre en múltiplos de 10 mm).
// Cada agujero pasante tiene dos caras: arriba (normal +Z local) y abajo (normal −Z local).
// Dos agujeros quedan alineados cuando coinciden en posición y sus normales son opuestas:
// por ejemplo, la cara de abajo de un perfil sobre la cara de arriba de una placa.

import { extent, rotateLocal, sizeOf, type Part, type Project, type Vec3 } from "./project";
import { gridInside, parseShape } from "./polygon";

export interface HoleRef {
  part: number;
  h: number;
}

export interface Hole {
  /** Punto en la cara de la pieza, en la mesa. */
  p: Vec3;
  /** Normal hacia afuera de la cara (unitaria). */
  n: Vec3;
  /** Punta del eje de un motor: lo que se monta ahí gira con el motor. */
  shaft?: boolean;
}

interface LocalHole { p: Vec3; n: Vec3; shaft?: boolean }

/** Agujeros pasantes verticales en (x, y), con cara arriba y abajo. */
function through(xy: [number, number][], h: number): LocalHole[] {
  return xy.flatMap(([x, y]) => [
    { p: [x, y, h / 2] as Vec3, n: [0, 0, 1] as Vec3 },
    { p: [x, y, -h / 2] as Vec3, n: [0, 0, -1] as Vec3 },
  ]);
}

function grid(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to + 0.01; v += step) out.push(Math.round(v * 10) / 10);
  return out;
}

const cache = new Map<string, LocalHole[]>();

function localHoles(part: Pick<Part, "type" | "props">): LocalHole[] {
  const [lx, ly, h] = sizeOf(part.type, part.props);
  const key = part.type === "custom" ? `custom:${String(part.props.shape)}:${String(part.props.holes)}:${h}` : `${part.type}:${lx}:${ly}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out: LocalHole[] = [];
  switch (part.type) {
    case "profile60": case "profile120": case "profile240":
      out = through(grid(-lx / 2 + 5, lx / 2 - 5, 10).map((x) => [x, 0]), h);
      break;
    case "plate": {
      const xs = grid(-lx / 2 + 10, lx / 2 - 10, 20), ys = grid(-ly / 2 + 10, ly / 2 - 10, 20);
      out = through(xs.flatMap((x) => ys.map((y) => [x, y] as [number, number])), h);
      break;
    }
    // Escuadra (L): agujeros verticales en la base y horizontales en el ala, para montar un servo de lado.
    case "bracket":
      out = [
        ...through([[-20, 2], [0, 2], [20, 2]], h).map((x) => ({ ...x, p: [x.p[0], x.p[1], x.n[2] > 0 ? -h / 2 + 4 : -h / 2] as Vec3 })),
        ...[-24, 24].flatMap((x) => [
          { p: [x, -ly / 2, 4] as Vec3, n: [0, -1, 0] as Vec3 },
          { p: [x, -ly / 2 + 4, 4] as Vec3, n: [0, 1, 0] as Vec3 },
        ]),
      ];
      break;
    // Pistón: el perno del émbolo, arriba. Al simular, el émbolo se desliza a lo largo del cilindro.
    case "piston":
      out = [{ p: [25, 0, h / 2], n: [0, 0, 1] }];
      break;
    // Pesa: un gancho arriba para colgarla de una cuerda o unirla.
    case "weight":
      out = [{ p: [0, 0, h / 2], n: [0, 0, 1] }];
      break;
    case "link":
      out = through([[-(lx / 2 - 7), 0], [lx / 2 - 7, 0]], h);
      break;
    // Pieza libre: agujeros de la grilla elegida que caen dentro de su forma.
    case "custom": {
      const step = part.props.holes === "Cada 20 mm" ? 20 : part.props.holes === "Sin agujeros" ? 0 : 10;
      out = step ? through(gridInside(parseShape(part.props.shape), step), h) : [];
      break;
    }
    case "bearing":
    case "wheel":
      out = through([[0, 0]], h);
      break;
    case "support":
      out = through([[-14, 0], [14, 0]], h);
      break;
    case "hbridge":
      out = through([[-21, -16], [21, -16], [-21, 16], [21, 16]], h);
      break;
    // Motores: agujeros de su base (no caen en múltiplos de 10 mm) y la punta del eje.
    case "dcmotor":
      out = [
        ...through([[-17, -7], [-17, 7], [3, -7], [3, 7]], h).filter((x) => x.n[2] < 0),
        { p: [30, 0, 0], n: [1, 0, 0], shaft: true },
      ];
      break;
    case "stepper":
      out = [
        ...through([[-15.5, -15.5], [15.5, -15.5], [-15.5, 15.5], [15.5, 15.5]], h).filter((x) => x.n[2] < 0),
        { p: [0, 0, h / 2], n: [0, 0, 1], shaft: true },
      ];
      break;
    // Servo: agujeros de su pestaña y el brazo (horn) arriba, que gira al ángulo pedido.
    case "servo":
      out = [...through([[-24, 0], [24, 0]], h).filter((x) => x.n[2] < 0), { p: [10, 0, h / 2], n: [0, 0, 1], shaft: true }];
      break;
    // Actuador lineal: la punta del vástago empuja o tira de lo que se monte ahí.
    case "linear":
      out = [{ p: [lx / 2, 0, 0], n: [1, 0, 0], shaft: true }];
      break;
  }
  cache.set(key, out);
  return out;
}

/** Agujeros de una pieza en coordenadas de la mesa. */
export function holesOf(part: Part): Hole[] {
  const c: Vec3 = [part.x, part.y, part.z + extent(part)[2] / 2];
  return localHoles(part).map((l) => {
    const d = rotateLocal(l.p, part.rot);
    return { p: [c[0] + d[0], c[1] + d[1], c[2] + d[2]], n: rotateLocal(l.n, part.rot), shaft: l.shaft };
  });
}

const near = (a: Vec3, b: Vec3, tol: number) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < tol;
const opposite = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < -0.99;

export function aligned(a: Hole, b: Hole): boolean {
  return near(a.p, b.p, 0.6) && opposite(a.n, b.n);
}

/** Pares de agujeros alineados entre una pieza y las demás. */
export function alignedPairs(project: Pick<Project, "parts">, id: number): { a: HoleRef; b: HoleRef; p: Vec3; shaft: boolean }[] {
  const me = project.parts.find((p) => p.id === id);
  if (!me) return [];
  const mine = holesOf(me);
  const out: { a: HoleRef; b: HoleRef; p: Vec3; shaft: boolean }[] = [];
  for (const o of project.parts) {
    if (o.id === id) continue;
    const theirs = holesOf(o);
    mine.forEach((hm, i) => theirs.forEach((ho, j) => {
      if (aligned(hm, ho)) out.push({ a: { part: id, h: i }, b: { part: o.id, h: j }, p: hm.p, shaft: !!(hm.shaft || ho.shaft) });
    }));
  }
  return out;
}

export function holeAt(project: Pick<Project, "parts">, r: HoleRef): Hole | null {
  const p = project.parts.find((x) => x.id === r.part);
  return p ? (holesOf(p)[r.h] ?? null) : null;
}

/**
 * Imán de agujeros al arrastrar: si una cara de abajo de la pieza queda cerca (en el piso) de
 * una cara de arriba de otra pieza, la pieza se corre para que coincidan y se apoya encima.
 */
export function snapHoles(project: Pick<Project, "parts">, moving: Part, x: number, y: number, tol = 8): { x: number; y: number; z: number } | null {
  const trial = { ...moving, x, y };
  const mine = holesOf(trial).filter((h) => h.n[2] < -0.99);
  if (!mine.length) return null;
  let best: { x: number; y: number; z: number; d: number } | null = null;
  for (const o of project.parts) {
    if (o.id === moving.id) continue;
    for (const ho of holesOf(o)) {
      if (ho.n[2] < 0.99) continue;
      for (const hm of mine) {
        const dx = ho.p[0] - hm.p[0], dy = ho.p[1] - hm.p[1], d = Math.hypot(dx, dy);
        if (d >= tol || (best && d >= best.d)) continue;
        const z = Math.round((moving.z + ho.p[2] - hm.p[2]) * 10) / 10;
        if (z < 0) continue;
        best = { x: Math.round((x + dx) * 10) / 10, y: Math.round((y + dy) * 10) / 10, z, d };
      }
    }
  }
  return best && { x: best.x, y: best.y, z: best.z };
}

/** Altura de apoyo: la cara de arriba más alta de lo que hay bajo la pieza (o la mesa). */
export function restHeight(project: Pick<Project, "parts">, moving: Part, x: number, y: number): number {
  const [ex, ey] = extent(moving);
  let top = 0;
  for (const o of project.parts) {
    if (o.id === moving.id) continue;
    const [ox, oy, oz] = extent(o);
    const overlap = Math.abs(o.x - x) < (ex + ox) / 2 - 0.5 && Math.abs(o.y - y) < (ey + oy) / 2 - 0.5;
    if (overlap) top = Math.max(top, o.z + oz);
  }
  return Math.round(top * 10) / 10;
}
