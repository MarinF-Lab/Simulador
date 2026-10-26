// Proyectos de ejemplo. Datos puros, sin React: se arman con las mismas reglas de la mesa.

import { alignedPairs, holesOf } from "../model/holes";
import type { Cable, Joint, Part, Project, Vec3 } from "../model/project";
import { termWorld } from "../model/terminals";

export function wire(id: number, a: Part, ta: number, b: Part, tb: number): Cable {
  const [x0, y0, z0] = termWorld(a, ta), [x1, y1, z1] = termWorld(b, tb);
  return { id, ends: [{ att: { part: a.id, t: ta }, x: x0, y: y0, z: z0 }, { att: { part: b.id, t: tb }, x: x1, y: y1, z: z1 }] };
}

/** Corre la pieza para que su agujero h quede justo en el punto p. */
export function onHole(part: Part, h: number, p: Vec3): Part {
  const hole = holesOf(part)[h]!;
  return { ...part, x: part.x + p[0] - hole.p[0], y: part.y + p[1] - hole.p[1], z: part.z + p[2] - hole.p[2] };
}

/** Mesa de demostración: la ampolleta, un tren de engranajes con brazo y el brazo de 3 servos. */
export function demoProject(): Project {
  const P = (id: number, type: string, x: number, y: number, rz = 0, props: Part["props"] = {}, z = 0): Part => ({ id, type, x, y, z, rot: [0, 0, rz], props });
  const bat = P(1, "source", -220, 40, 0, { v: 9 });
  const sw = P(2, "switch", -90, 130);
  const res = P(3, "resistor", 30, 130, 0, { r: 100 });
  const lamp = P(4, "lamp", 60, 10, 0, { vn: 6 });
  // Motor de pie sobre una placa: en su eje, un engranaje de 10 que mueve uno de 40 y un brazo
  // de dos tramos (eslabón y perfil) unidos por juntas rotacionales.
  const plate = P(13, "plate", 200, -40, 0, { lx: 200, ly: 160 });
  const motor: Part = { id: 14, type: "dcmotor", x: 180, y: -40, z: 6, rot: [0, 3, 0], props: { rpm: 30, torque: 0.8, vnom: 12 } };
  const g10: Part = { id: 15, type: "gear10", x: 180, y: -40, z: 57, rot: [0, 0, 0], props: {} };
  const axle: Part = { id: 16, type: "shaft", x: 230, y: -40, z: 6, rot: [0, 3, 0], props: { lx: 60 } };
  const g40: Part = { id: 17, type: "gear40", x: 230, y: -40, z: 57, rot: [0, 0, 0], props: {} };
  const link: Part = { id: 18, type: "link", x: 203, y: -40, z: 66, rot: [0, 0, 0], props: { lx: 60 } };
  const arm: Part = { id: 19, type: "profile60", x: 251, y: -40, z: 72, rot: [0, 0, 0], props: {} };
  const bat2 = P(20, "source", 70, -120, 0, { v: 12 });
  const parts: Part[] = [bat, sw, res, lamp, P(8, "profile240", -60, -80), plate, motor, g10, axle, g40, link, arm, bat2];
  const cables = [wire(9, bat, 1, sw, 0), wire(10, sw, 1, res, 0), wire(11, res, 1, lamp, 1), wire(12, lamp, 0, bat, 0),
    wire(21, bat2, 1, motor, 1), wire(22, motor, 0, bat2, 0)];
  // Brazo robótico de 3 servos alimentado con 6 V: la base gira 180° sobre la placa, y una
  // escuadra lleva el hombro y el codo de lado, para que el brazo suba y baje.
  const plate2 = P(30, "plate", -200, -200, 0, { lx: 160, ly: 120 });
  const servo1: Part = { id: 31, type: "servo", x: -220, y: -190, z: 6, rot: [0, 0, 0], props: { target: 45, speed: 60, torque: 0.8 } };
  const side: Vec3 = [1, 0, 0]; // de lado: el brazo del servo mira hacia −Y y el ángulo positivo sube
  const bracket = onHole({ id: 43, type: "bracket", x: 0, y: 0, z: 0, rot: [0, 0, 0], props: {} }, 3, holesOf(servo1)[2]!.p);
  const servo2 = onHole({ id: 33, type: "servo", x: 0, y: 0, z: 0, rot: side, props: { target: 40, speed: 60, torque: 0.8 } }, 0, holesOf(bracket)[6]!.p);
  const link1 = onHole({ id: 32, type: "link", x: 0, y: 0, z: 0, rot: side, props: { lx: 90 } }, 1, holesOf(servo2)[2]!.p);
  const servo3 = onHole({ id: 44, type: "servo", x: 0, y: 0, z: 0, rot: side, props: { target: -60, speed: 60, torque: 0.8 } }, 0, holesOf(link1)[2]!.p);
  const link2 = onHole({ id: 34, type: "link", x: 0, y: 0, z: 0, rot: side, props: { lx: 80 } }, 1, holesOf(servo3)[2]!.p);
  const bat3 = P(35, "source", -330, -110, 0, { v: 6 });
  parts.push(plate2, servo1, bracket, servo2, link1, servo3, link2, bat3);
  cables.push(wire(36, bat3, 1, servo1, 1), wire(37, bat3, 0, servo1, 0), wire(38, servo1, 1, servo2, 1), wire(39, servo1, 0, servo2, 0),
    wire(45, servo2, 1, servo3, 1), wire(46, servo2, 0, servo3, 0));
  const base: Project = { parts, cables, belts: [], nextId: 47 };
  // Juntas: el eslabón en el eje del motor y el perfil sobre el otro extremo del eslabón.
  const onShaft = alignedPairs(base, 18).find((q) => q.shaft);
  const elbow = alignedPairs(base, 19).find((q) => q.b.part === 18);
  const joints: Joint[] = [];
  if (onShaft) joints.push({ id: 23, kind: "revolute", a: onShaft.a, b: onShaft.b });
  if (elbow) joints.push({ id: 24, kind: "revolute", a: elbow.a, b: elbow.b });
  joints.push(
    { id: 40, kind: "revolute", a: { part: 43, h: 3 }, b: { part: 31, h: 2 } }, // base: la escuadra gira sobre el servo 1
    { id: 41, kind: "fixed", a: { part: 33, h: 0 }, b: { part: 43, h: 6 } }, // servo 2 atornillado de lado a la escuadra
    { id: 42, kind: "revolute", a: { part: 32, h: 1 }, b: { part: 33, h: 2 } }, // hombro: eslabón 1 en el servo 2
    { id: 47, kind: "fixed", a: { part: 44, h: 0 }, b: { part: 32, h: 2 } }, // servo 3 atornillado al final del eslabón 1
    { id: 48, kind: "revolute", a: { part: 34, h: 1 }, b: { part: 44, h: 2 } }, // codo: eslabón 2 en el servo 3
  );
  return { ...base, joints, nextId: 49 };
}


/** Copia solo las piezas pedidas (con sus cables, correas y juntas) y las corre (dx, dy) en la mesa. */
function pick(src: Project, ids: number[], dx: number, dy: number): Project {
  const keep = new Set(ids);
  const parts = src.parts.filter((p) => keep.has(p.id)).map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  const cables = src.cables
    .filter((c) => c.ends.every((e) => e.att && keep.has(e.att.part)))
    .map((c) => ({
      ...c,
      ends: c.ends.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy })) as Cable["ends"],
      bend: c.bend ? ([c.bend[0] + dx, c.bend[1] + dy, c.bend[2]] as Vec3) : c.bend,
    }));
  const belts = (src.belts ?? []).filter((b) => keep.has(b.a) && keep.has(b.b));
  const joints = (src.joints ?? []).filter((j) => keep.has(j.a.part) && keep.has(j.b.part));
  const all = [...parts, ...cables, ...belts, ...joints].map((x) => x.id);
  return { parts, cables, belts, joints, nextId: Math.max(0, ...all) + 1 };
}

/** Brazo robótico de 3 servos: base que gira 180°, hombro y codo que suben y bajan. */
function armExample(): Project {
  return pick(demoProject(), [30, 31, 43, 33, 32, 44, 34, 35], 220, 200);
}

/** Circuito de la ampolleta: 9 V, interruptor, 100 Ω y ampolleta de 6 V. */
function bulbExample(): Project {
  return pick(demoProject(), [1, 2, 3, 4], 80, -60);
}

/** Tren 10 → 40 con correa, como el ejemplo del prototipo. */
function gearBeltExample(): Project {
  const plate: Part = { id: 1, type: "plate", x: 40, y: 0, z: 0, rot: [0, 0, 0], props: { lx: 260, ly: 140 } };
  // Motor de pie: su eje sube y lleva el engranaje de 10, que mueve el de 40 (centros a 10 + 40 mm).
  const motor: Part = { id: 2, type: "dcmotor", x: -40, y: 0, z: 6, rot: [0, 3, 0], props: { rpm: 120, torque: 0.8, vnom: 6 } };
  const g10: Part = { id: 3, type: "gear10", x: -40, y: 0, z: 57, rot: [0, 0, 0], props: {} };
  const axle1: Part = { id: 4, type: "shaft", x: 10, y: 0, z: 6, rot: [0, 3, 0], props: { lx: 60 } };
  const g40: Part = { id: 5, type: "gear40", x: 10, y: 0, z: 57, rot: [0, 0, 0], props: {} };
  // En el mismo eje del de 40, una polea chica; la correa la une a una polea grande en otro eje.
  const pS: Part = { id: 6, type: "pulleyS", x: 10, y: 0, z: 30, rot: [0, 0, 0], props: {} };
  const axle2: Part = { id: 7, type: "shaft", x: 120, y: 0, z: 6, rot: [0, 3, 0], props: { lx: 60 } };
  const pL: Part = { id: 8, type: "pulleyL", x: 120, y: 0, z: 30, rot: [0, 0, 0], props: {} };
  const bat: Part = { id: 9, type: "source", x: -60, y: 140, z: 0, rot: [0, 0, 0], props: { v: 6 } };
  const sw: Part = { id: 10, type: "switch", x: 60, y: 140, z: 0, rot: [0, 0, 0], props: {} };
  const parts = [plate, motor, g10, axle1, g40, pS, axle2, pL, bat, sw];
  const cables = [wire(11, bat, 1, sw, 0), wire(12, sw, 1, motor, 1), wire(13, motor, 0, bat, 0)];
  return { parts, cables, belts: [{ id: 14, a: 6, b: 8, cross: false }], joints: [], nextId: 15 };
}

export interface Example {
  id: string;
  name: string;
  desc: string;
  build: () => Project;
}

export const EXAMPLES: Example[] = [
  { id: "arm", name: "Brazo robótico", desc: "Tres servos: la base gira 180° y el hombro y el codo suben y bajan. Muévelos con los deslizadores θ.", build: armExample },
  { id: "bulb", name: "Circuito de la ampolleta", desc: "Pila de 9 V, interruptor, resistencia de 100 Ω y ampolleta de 6 V. Abre y cierra el interruptor.", build: bulbExample },
  { id: "gears", name: "Tren 10 → 40 con correa", desc: "El motor mueve un engranaje de 10 dientes, que mueve uno de 40, y una correa pasa el giro a otra polea.", build: gearBeltExample },
];
