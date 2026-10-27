// Adaptador de Rapier: crea el mundo físico desde el modelo y lo avanza.
// El modelo sigue siendo la única fuente de verdad: al detener, se descarta el mundo.
//
// Unidades: Rapier trabaja en metros y kilogramos; el modelo, en mm.
// Todos los cuerpos empiezan sin girar y sus formas llevan el giro de la pieza; así los ejes
// de las juntas se expresan igual en ambos cuerpos.

import RAPIER from "@dimforge/rapier3d-compat";
import { holeAt } from "../core/model/holes";
import type { Joint } from "../core/model/project";
import { extent, rotateLocal, sizeOf, type Part, type Project, type Vec3 } from "../core/model/project";
import { ROTORS, ropeDrop, rotorAxis } from "../core/mechanical/axes";
import { parseShape, triangulate } from "../core/model/polygon";
import { checkStructure, jointPoint } from "../core/model/structure";
import { motorCurrent, motorParams, motorTorque, noLoadSpeed, type MotorParams } from "../core/coupling/dcmotor";
import type { Issue } from "../core/electrical/circuit";
import { atLimit, servoRamp } from "../core/coupling/control";

const S = 0.001; // mm → m
const STEP = 1 / 120;

let ready: Promise<void> | null = null;
export const initPhysics = (): Promise<void> => (ready ??= RAPIER.init());

/** Densidad aproximada (kg/m³) según el tipo: los perfiles son huecos. */
/** Densidad del material de una pieza libre (kg/m³). */
const CUSTOM_DENSITY: Record<string, number> = { Madera: 600, Aluminio: 2700, Acrílico: 1190, Cartón: 300 };

function density(type: string, props: Record<string, unknown> = {}): number {
  if (type === "custom") return CUSTOM_DENSITY[String(props.color)] ?? 600;
  if (type.startsWith("profile") || type === "link" || type === "plate" || type === "bracket") return 900;
  if (type === "dcmotor" || type === "stepper" || type === "servo") return 2500;
  if (type === "weight") return 7800;
  return 1200;
}

/** Formas de choque de una pieza, en el marco de su cuerpo (que empieza sin girar). */
function colliderShapes(part: Part): RAPIER.ColliderDesc[] {
  const [sx, sy, sz] = sizeOf(part.type, part.props);
  const q = partQuat(part.rot);
  const rot = (r: number[]) => ({ x: r[0]!, y: r[1]!, z: r[2]!, w: r[3]! });
  const box = (h: Vec3, o: Vec3 = [0, 0, 0]) => {
    const t = rotateLocal(o, part.rot);
    return RAPIER.ColliderDesc.cuboid(h[0] * S, h[1] * S, h[2] * S).setTranslation(t[0] * S, t[1] * S, t[2] * S).setRotation(rot(q));
  };
  switch (part.type) {
    // La rueda es un cilindro: Rapier lo hace a lo largo de Y y la pieza lo tiene en Z.
    case "wheel":
      return [RAPIER.ColliderDesc.cylinder((sz / 2) * S, (sx / 2) * S).setRotation(rot(qmul(q, [Math.SQRT1_2, 0, 0, Math.SQRT1_2])))];
    // El cilindro del pistón llega 6 mm por debajo del perno: la biela pasa por encima sin rozarlo.
    case "piston":
      return [box([sx / 2, sy / 2, sz / 2 - 3], [0, 0, -3])];
    // Pieza libre: un prisma convexo por cada triángulo de su forma (sirve para formas cóncavas).
    case "custom": {
      const pts = parseShape(part.props.shape);
      const tris = pts.length ? triangulate(pts) : [];
      const out = tris.map((t) => {
        const v = new Float32Array(18);
        t.forEach((i, k) => {
          for (const [s, z] of [[0, -sz / 2], [9, sz / 2]] as const) {
            const w = rotateLocal([pts[i]![0], pts[i]![1], z], part.rot);
            v.set([w[0] * S, w[1] * S, w[2] * S], s + 3 * k);
          }
        });
        return RAPIER.ColliderDesc.convexHull(v);
      }).filter((d): d is RAPIER.ColliderDesc => d !== null);
      return out.length ? out : [box([sx / 2, sy / 2, sz / 2])];
    }
    // La escuadra es una L: la base y el ala, sin llenar el hueco entre ellas.
    case "bracket":
      return [box([sx / 2, sy / 2, 2], [0, 0, -sz / 2 + 2]), box([sx / 2, 2, sz / 2], [0, -sy / 2 + 2, 0])];
    default:
      return [box([sx / 2, sy / 2, sz / 2])];
  }
}

export interface Pose {
  /** Centro de la pieza en mm. */
  p: Vec3;
  /** Giro del cuerpo desde el inicio (x, y, z, w). */
  q: [number, number, number, number];
}

export interface MotorState {
  rpm: number;
  current: number;
  torque: number;
  /** Ángulo del eje respecto del inicio, en grados (servo y paso a paso). */
  angle?: number;
  /** Salida del vástago del actuador lineal, en mm. */
  ext?: number;
}

export interface SimStatus {
  issues: Issue[];
  flag: Record<number, "err" | "warn">;
  motors: Record<number, MotorState>;
  /** Ángulo de cada junta rotacional, en grados. */
  jointAngle: Record<number, number>;
  /** Sensores de contacto que alguna pieza está tocando. */
  pressed: Record<number, boolean>;
  t: number;
}

/** Lo que la simulación lee del diseño mientras corre: voltajes del circuito y propiedades. */
export interface SimEnv {
  voltage: (id: number) => number;
  props: (id: number) => Record<string, unknown>;
  /** RPM de cada polea según el tren (para enrollar las cuerdas). */
  rpm?: (id: number) => number;
}

/** Cuerda de un tambor a una carga: su largo cambia con el giro del tambor. */
interface Rope {
  drum: number;
  r: number;
  load: RAPIER.RigidBody;
  /** Puntas de la unión: en la mesa (fija) y en la carga. */
  a: RAPIER.Vector3;
  b: RAPIER.Vector3;
  L0: number;
  L: number;
  joint: RAPIER.ImpulseJoint;
}

type DriveKind = "dc" | "servo" | "stepper" | "linear";

interface Drive {
  kind: DriveKind;
  joint: RAPIER.RevoluteImpulseJoint | RAPIER.PrismaticImpulseJoint;
  motor: number;
  driven: number;
  axis: Vec3;
  params: MotorParams;
  slow: number;
  heavy: number;
  /** Pasos acumulados (paso a paso) y fracción pendiente. */
  steps: number;
  frac: number;
  /** Ángulo continuo medido (grados) y offset inicial del actuador. */
  angle: number;
  limit: number;
  d0: Vec3;
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const qmul = (a: number[], b: number[]): [number, number, number, number] => [
  a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
  a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
  a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
  a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!,
];
const conj = (q: { x: number; y: number; z: number; w: number }) => [-q.x, -q.y, -q.z, q.w];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** Gira el vector v con el cuaternión q. */
function rot3(q: number[], v: Vec3): Vec3 {
  const [x, y, z, w] = q as [number, number, number, number];
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
const arr = (q: { x: number; y: number; z: number; w: number }) => [q.x, q.y, q.z, q.w];

/** Ángulo (grados) del cuerpo B respecto de A, alrededor de un eje que empezó igual en ambos. */
function relAngle(A: RAPIER.RigidBody, B: RAPIER.RigidBody, axis: Vec3): number {
  let r = qmul(conj(A.rotation()), arr(B.rotation()));
  // q y −q son el mismo giro: se usa el de w ≥ 0 para que el ángulo quede entre −180° y 180°.
  if (r[3] < 0) r = [-r[0], -r[1], -r[2], -r[3]];
  return (2 * Math.atan2(r[0] * axis[0] + r[1] * axis[1] + r[2] * axis[2], r[3]) * 180) / Math.PI;
}

/** Giro de una pieza como cuaternión (Euler XYZ en cuartos de vuelta). */
export function partQuat(rot: Vec3): [number, number, number, number] {
  const [x, y, z] = rot.map((n) => (n * Math.PI) / 4); // mitades de ángulo
  const cx = Math.cos(x!), sx = Math.sin(x!), cy = Math.cos(y!), sy = Math.sin(y!), cz = Math.cos(z!), sz = Math.sin(z!);
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
}

export class Sim {
  private world: RAPIER.World;
  private bodies = new Map<number, RAPIER.RigidBody>();
  private start = new Map<number, Vec3>();
  private drives: Drive[] = [];
  /** Émbolo de cada pistón: un cuerpo propio que se desliza en el cilindro. */
  private sliders = new Map<number, { body: RAPIER.RigidBody; axis: Vec3 }>();
  private ropes: Rope[] = [];
  private table!: RAPIER.RigidBody;
  private acc = 0;
  private fallen = new Set<number>();
  private revs: { id: number; A: RAPIER.RigidBody; B: RAPIER.RigidBody; axis: Vec3 }[] = [];
  private sensors: { id: number; collider: RAPIER.Collider; ignore: Set<number> }[] = [];
  private partOf = new Map<number, number>();
  private kinEdges: { parent: number; child: number; joint: number; servo: boolean; pivot: Vec3; axis: Vec3 }[] = [];
  /** Servos que mueven piezas por cinemática: ángulo pedido (rampa) y ángulo actual. */
  private servos = new Map<number, { cmd: number; limit: number }>();
  t = 0;

  constructor(project: Project) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: -9.81 });
    this.world.timestep = STEP;
    // Las piezas miden centímetros: las tolerancias de contacto se ajustan a esa escala.
    this.world.integrationParameters.lengthUnit = 0.01;
    // Mesa
    const table = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, -0.01));
    this.table = table;
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.6, 0.4, 0.01).setFriction(0.8), table);

    // Brazos con servos: lo que cuelga de un servo (por su brazo y por uniones fijas) se mueve
    // por cinemática, siguiendo los ángulos de los servos. Así varios servos encadenados quedan
    // exactos y estables; esas piezas igual empujan a las demás.
    const broken0 = checkStructure(project).broken;
    const typeOf = new Map(project.parts.map((p) => [p.id, p.type]));
    const kin = new Set<number>();
    const edges: { parent: number; child: number; joint: number; servo: boolean; pivot: Vec3; axis: Vec3 }[] = [];
    const servoEdge = (j: Joint) => {
      const ha = holeAt(project, j.a), hb = holeAt(project, j.b);
      if (!ha || !hb) return null;
      const shaftA = ha.shaft && typeOf.get(j.a.part) === "servo", shaftB = hb.shaft && typeOf.get(j.b.part) === "servo";
      if (!shaftA && !shaftB) return null;
      return { parent: shaftA ? j.a.part : j.b.part, child: shaftA ? j.b.part : j.a.part, pivot: ha.p as Vec3, axis: (shaftA ? ha.n : hb.n) as Vec3 };
    };
    const okJoints = (project.joints ?? []).filter((j) => !broken0.has(j.id));
    const queue: number[] = [];
    for (const j of okJoints) {
      const e = servoEdge(j);
      if (e && !kin.has(e.child)) { edges.push({ ...e, joint: j.id, servo: true }); kin.add(e.child); queue.push(e.child); }
    }
    while (queue.length) {
      const id = queue.shift()!;
      for (const j of okJoints) {
        if (j.a.part !== id && j.b.part !== id) continue;
        const other = j.a.part === id ? j.b.part : j.a.part;
        if (kin.has(other) || typeOf.get(other) === "plate") continue;
        const e = servoEdge(j);
        if (e && e.parent === id) { edges.push({ ...e, joint: j.id, servo: true }); kin.add(other); queue.push(other); continue; }
        if ((j.kind === "fixed" || j.kind === "glue") && !e) {
          // Unión fija o pegamento: el hijo va pegado al padre (sin giro, el pivote no importa).
          const pivot = jointPoint(project, j);
          if (!pivot) continue;
          edges.push({ parent: id, child: other, joint: j.id, servo: false, pivot, axis: [0, 0, 1] });
          kin.add(other);
          queue.push(other);
        }
      }
    }
    this.kinEdges = edges;

    // Placa sobre la que se apoya cada pieza (su cara de abajo en la cara de arriba de la placa).
    const plates = project.parts.filter((p) => p.type === "plate");
    const restOn = (part: Part): Part | undefined => plates.find((plate) => {
      if (part.id === plate.id || kin.has(part.id)) return false;
      const [px, py, pz] = extent(plate), [ex, ey] = extent(part);
      return Math.abs(part.z - (plate.z + pz)) <= 0.5 && Math.abs(part.x - plate.x) <= (px + ex) / 2 - 1 && Math.abs(part.y - plate.y) <= (py + ey) / 2 - 1;
    });
    const anchored = (p: Part | undefined) => !!p && p.type === "plate" && p.props.anchored !== false;

    for (const part of project.parts) {
      // Engranajes, poleas y ejes siguen el cálculo de transmisiones: no son cuerpos libres.
      if (ROTORS[part.type]) continue;
      const ez = extent(part)[2];
      const c: Vec3 = [part.x, part.y, part.z + ez / 2];
      // La placa base queda anclada a la mesa, salvo que se suelte para usarla como chasis. Lo que
      // se apoya en una placa anclada queda fijo como ella (más estable que unirlo con una junta).
      const fixed = anchored(part) || (!ROTORS[part.type] && anchored(restOn(part)));
      const base = fixed ? RAPIER.RigidBodyDesc.fixed() : kin.has(part.id) ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic();
      const desc = base.setTranslation(c[0] * S, c[1] * S, c[2] * S);
      const body = this.world.createRigidBody(desc);
      // Una pieza puede tener varios colisionadores (la escuadra es una L); todos llevan a la pieza.
      colliderShapes(part).forEach((shape, i) => {
        const col = this.world.createCollider(shape.setDensity(density(part.type, part.props)).setFriction(part.type === "wheel" ? 1.2 : 0.7), body);
        this.partOf.set(col.handle, part.id);
        if (i === 0 && part.type === "sensorContact") this.sensors.push({ id: part.id, collider: col, ignore: new Set() });
      });
      this.bodies.set(part.id, body);
      this.start.set(part.id, c);
    }

    // Émbolos: un cuerpo que se desliza a lo largo del cilindro, desde el perno hacia atrás.
    for (const part of project.parts.filter((p) => p.type === "piston")) {
      const H = this.bodies.get(part.id);
      if (!H) continue;
      const c = this.start.get(part.id)!;
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(c[0] * S, c[1] * S, c[2] * S));
      const q = partQuat(part.rot), off = rotateLocal([25, 0, 19], part.rot);
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(12 * S, 11 * S, 14 * S).setTranslation(off[0] * S, off[1] * S, off[2] * S)
          .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }).setDensity(1200).setFriction(0.3),
        body,
      );
      const axis = rotateLocal([1, 0, 0], part.rot);
      const j = this.world.createImpulseJoint(RAPIER.JointData.prismatic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: axis[0], y: axis[1], z: axis[2] }), H, body, true) as RAPIER.PrismaticImpulseJoint;
      j.setLimits(-60 * S, 5 * S);
      j.setContactsEnabled(false);
      this.sliders.set(part.id, { body, axis });
    }

    // Cuerdas: van del borde del tambor (un punto fijo) al gancho de la carga, tirantes al empezar.
    for (const b of (project.belts ?? []).filter((x) => x.rope)) {
      const drum = project.parts.find((p) => p.id === b.a), load = this.bodies.get(b.b), lp = project.parts.find((p) => p.id === b.b);
      const ax = drum && rotorAxis(drum);
      if (!ax || !load || !lp) continue;
      const drop = ropeDrop(ax), c = this.start.get(b.b)!, top: Vec3 = [c[0], c[1], c[2] + extent(lp)[2] / 2];
      const L0 = Math.hypot(drop[0] - top[0], drop[1] - top[1], drop[2] - top[2]);
      const a = { x: drop[0] * S, y: drop[1] * S, z: drop[2] * S + 0.01 }, bb = { x: 0, y: 0, z: (extent(lp)[2] / 2) * S };
      const joint = this.world.createImpulseJoint(RAPIER.JointData.rope(L0 * S, a, bb), this.table, load, true);
      this.ropes.push({ drum: b.a, r: ax.r, load, a, b: bb, L0, L: L0, joint });
    }

    // Lo que se apoya sobre una placa suelta (un chasis) queda unido a ella, como atornillado.
    for (const part of project.parts) {
      const plate = restOn(part);
      const P0 = plate && this.bodies.get(plate.id), B = this.bodies.get(part.id);
      if (!plate || anchored(plate) || !P0 || !B) continue;
      {
        const a = this.start.get(plate.id)!, b = this.start.get(part.id)!;
        const anchor = { x: (b[0] - a[0]) * S, y: (b[1] - a[1]) * S, z: (b[2] - a[2]) * S };
        const j = this.world.createImpulseJoint(RAPIER.JointData.fixed(anchor, { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }), P0, B, true);
        j.setContactsEnabled(false);
      }
    }

    const broken = checkStructure(project).broken;
    const kinJoint = new Set(edges.map((e) => e.joint));
    for (const j of project.joints ?? []) {
      if (broken.has(j.id) || kinJoint.has(j.id)) continue;
      // Lo que se une a un pistón se une a su émbolo.
      const A = this.sliders.get(j.a.part)?.body ?? this.bodies.get(j.a.part), B = this.sliders.get(j.b.part)?.body ?? this.bodies.get(j.b.part);
      // Pegamento: unión fija en el centro del contacto.
      if (j.kind === "glue") {
        const spot = jointPoint(project, j);
        if (!A || !B || !spot) continue;
        const pa = this.start.get(j.a.part)!, pb = this.start.get(j.b.part)!;
        const la = { x: (spot[0] - pa[0]) * S, y: (spot[1] - pa[1]) * S, z: (spot[2] - pa[2]) * S };
        const lb = { x: (spot[0] - pb[0]) * S, y: (spot[1] - pb[1]) * S, z: (spot[2] - pb[2]) * S };
        const g = this.world.createImpulseJoint(RAPIER.JointData.fixed(la, { x: 0, y: 0, z: 0, w: 1 }, lb, { x: 0, y: 0, z: 0, w: 1 }), A, B, true);
        g.setContactsEnabled(false);
        continue;
      }
      const ha = holeAt(project, j.a), hb = holeAt(project, j.b);
      if (!A || !B || !ha || !hb) continue;
      const pa = this.start.get(j.a.part)!, pb = this.start.get(j.b.part)!;
      const la = { x: (ha.p[0] - pa[0]) * S, y: (ha.p[1] - pa[1]) * S, z: (ha.p[2] - pa[2]) * S };
      const lb = { x: (ha.p[0] - pb[0]) * S, y: (ha.p[1] - pb[1]) * S, z: (ha.p[2] - pb[2]) * S };
      const axis = { x: ha.n[0], y: ha.n[1], z: ha.n[2] };
      const shaft = ha.shaft || hb.shaft;
      const motorId = ha.shaft ? j.a.part : j.b.part;
      const motorPart = shaft ? project.parts.find((p) => p.id === motorId)! : null;
      const kind: DriveKind | null = !motorPart ? null : motorPart.type === "servo" ? "servo" : motorPart.type === "stepper" ? "stepper" : motorPart.type === "linear" ? "linear" : "dc";
      // El eje (o el vástago) apunta hacia afuera del actuador: es el sentido positivo.
      const dir = (ha.shaft ? ha.n : hb.n) as Vec3;
      // En la junta deslizante, el avance positivo es el del segundo cuerpo respecto del primero:
      // si el actuador es el segundo, el eje va al revés para que "salir" siga siendo positivo.
      const sg = motorId === j.a.part ? 1 : -1;
      const data = kind === "linear"
        ? RAPIER.JointData.prismatic(la, lb, { x: sg * dir[0], y: sg * dir[1], z: sg * dir[2] })
        : j.kind === "fixed" && !shaft
          ? RAPIER.JointData.fixed(la, { x: 0, y: 0, z: 0, w: 1 }, lb, { x: 0, y: 0, z: 0, w: 1 })
          : RAPIER.JointData.revolute(la, lb, axis);
      const joint = this.world.createImpulseJoint(data, A, B, true);
      joint.setContactsEnabled(false);
      if (j.kind === "revolute" || shaft) this.revs.push({ id: j.id, A, B, axis: ha.n as Vec3 });
      if (kind && motorPart) {
        const drv = joint as RAPIER.RevoluteImpulseJoint | RAPIER.PrismaticImpulseJoint;
        // El actuador lineal mueve piezas livianas contra topes y sensores: su motor va por aceleración
        // (no depende de la masa) para quedar estable al chocar. Los demás, por fuerza.
        drv.configureMotorModel(kind === "linear" ? RAPIER.MotorModel.AccelerationBased : RAPIER.MotorModel.ForceBased);
        if (kind === "linear") {
          // El vástago sale desde su posición de diseño hasta la carrera.
          (drv as RAPIER.PrismaticImpulseJoint).setLimits(0, num(motorPart.props.stroke, 100) * S);
        }
        const driven = motorId === j.a.part ? j.b.part : j.a.part;
        const pm = this.start.get(motorId)!, pd = this.start.get(driven)!;
        this.drives.push({
          kind, joint: drv, motor: motorId, driven, axis: dir, params: motorParams(motorPart.props),
          slow: 0, heavy: 0, steps: 0, frac: 0, angle: 0, limit: 0, d0: [pd[0] - pm[0], pd[1] - pm[1], pd[2] - pm[2]],
        });
      }
    }
    // Un sensor de contacto no se presiona con lo que lo sostiene ni con lo que está unido a él.
    for (const sn of this.sensors) {
      const me = project.parts.find((p) => p.id === sn.id)!;
      for (const o of project.parts) {
        const [ox, oy, oz] = extent(o), [ex, ey] = extent(me);
        const below = Math.abs(o.z + oz - me.z) < 0.6 && Math.abs(o.x - me.x) < (ox + ex) / 2 && Math.abs(o.y - me.y) < (oy + ey) / 2;
        if (below) sn.ignore.add(o.id);
      }
      for (const j of project.joints ?? []) {
        if (j.a.part === sn.id) sn.ignore.add(j.b.part);
        if (j.b.part === sn.id) sn.ignore.add(j.a.part);
      }
    }
  }

  /** Avanza la simulación con paso fijo. */
  step(dt: number, env: SimEnv): void {
    this.acc += Math.min(dt, 0.05);
    let n = 0;
    while (this.acc >= STEP && n < 6) {
      for (const d of this.drives) this.drive(d, env);
      this.kinematics(env);
      this.reel(env);
      this.world.step();
      this.acc -= STEP;
      this.t += STEP;
      n++;
    }
  }

  /** Enrolla o suelta cada cuerda según el giro de su tambor. */
  private reel(env: SimEnv): void {
    for (const r of this.ropes) {
      const w = ((env.rpm?.(r.drum) ?? 0) / 60) * 2 * Math.PI;
      // Entre 8 mm (la carga llega al tambor) y 400 mm más que el largo de diseño.
      const L = Math.min(r.L0 + 400, Math.max(8, r.L - w * r.r * STEP));
      if (Math.abs(L - r.L) < 0.05) continue;
      r.L = L;
      // Rapier no cambia el largo de una cuerda: se reemplaza la unión.
      this.world.removeImpulseJoint(r.joint, true);
      r.joint = this.world.createImpulseJoint(RAPIER.JointData.rope(L * S, r.a, r.b), this.table, r.load, true);
    }
  }

  /** Ubica las piezas que cuelgan de servos según sus ángulos (cinemática directa). */
  private kinematics(env: SimEnv): void {
    if (!this.kinEdges.length) return;
    const pose = new Map<number, { t: Vec3; q: [number, number, number, number] }>();
    const get = (id: number) => {
      const b = this.bodies.get(id)!;
      if (!pose.has(id)) {
        const t = b.translation(), r = b.rotation();
        pose.set(id, { t: [t.x / S, t.y / S, t.z / S], q: [r.x, r.y, r.z, r.w] });
      }
      return pose.get(id)!;
    };
    for (const e of this.kinEdges) {
      if (!this.bodies.has(e.parent) || !this.bodies.has(e.child)) continue;
      let ang = 0;
      if (e.servo) {
        const pr = env.props(e.parent);
        const st = this.servos.get(e.parent) ?? { cmd: 0, limit: 0 };
        const spec = { amin: num(pr.amin, -90), amax: num(pr.amax, 90), speed: Math.max(1, num(pr.speed, 45)) };
        if (Math.abs(env.voltage(e.parent)) >= 4) {
          st.cmd = servoRamp(spec, st.cmd, num(pr.target, 0), STEP);
          st.limit = atLimit(spec, num(pr.target, 0), st.cmd) ? st.limit + STEP : 0;
        }
        this.servos.set(e.parent, st);
        ang = (st.cmd * Math.PI) / 180;
      }
      // Pose del hijo = pose del padre · giro alrededor del pivote · desplazamiento inicial.
      const P = get(e.parent);
      const p0 = this.start.get(e.parent)!, c0 = this.start.get(e.child)!;
      const pivot: Vec3 = [e.pivot[0] - p0[0], e.pivot[1] - p0[1], e.pivot[2] - p0[2]];
      const off: Vec3 = [c0[0] - e.pivot[0], c0[1] - e.pivot[1], c0[2] - e.pivot[2]];
      const h = ang / 2, sn = Math.sin(h);
      const qj: [number, number, number, number] = [e.axis[0] * sn, e.axis[1] * sn, e.axis[2] * sn, Math.cos(h)];
      const local = add3(pivot, rot3(qj, off)); // en el marco del padre
      const t = add3(P.t, rot3(P.q, local));
      const q = qmul(P.q, qj);
      pose.set(e.child, { t, q });
      const b = this.bodies.get(e.child)!;
      b.setNextKinematicTranslation({ x: t[0] * S, y: t[1] * S, z: t[2] * S });
      b.setNextKinematicRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
    }
  }

  private drive(d: Drive, env: SimEnv): void {
    const v = env.voltage(d.motor);
    const pr = env.props(d.motor);
    const M = this.bodies.get(d.motor)!, D = this.bodies.get(d.driven)!;
    if (d.kind === "dc") {
      // Motor DC como motor de velocidad de la junta: par = c · (ω0 − ω), con ω0 = V / Ke
      // y c = Kt · Ke / R. Es exactamente Kt · (V − Ke · ω) / R, resuelto de forma estable.
      const m = d.params;
      d.joint.configureMotorVelocity(v / m.ke, (m.kt * m.ke) / m.r);
    } else if (d.kind === "stepper") {
      // Paso a paso: avanza de a un paso fijo y lo sostiene con su par de retención.
      const spr = Math.max(4, num(pr.steps, 200)), sps = num(pr.sps, 100);
      if (Math.abs(v) >= 3) {
        d.frac += sps * STEP * Math.sign(v);
        const whole = Math.trunc(d.frac);
        d.steps += whole;
        d.frac -= whole;
      }
      const target = (d.steps * 2 * Math.PI) / spr;
      const k = num(pr.torque, 0.4) / ((2 * Math.PI) / spr);
      (d.joint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(target, k, k * 0.02);
      d.angle = relAngle(M, D, d.axis);
    } else {
      // Actuador lineal: el vástago sale (+) o entra (−) según la polaridad, a su velocidad.
      const speed = num(pr.lspeed, 20) * S;
      const dir = Math.abs(v) >= 1 ? Math.sign(v) : 0;
      // Llega a su velocidad en unos 50 ms.
      d.joint.configureMotorVelocity(dir * speed, 20);
    }
  }

  /** Salida de cada actuador lineal (mm), para dibujar el vástago en cada cuadro. */
  extensions(): Map<number, number> {
    const out = new Map<number, number>();
    for (const d of this.drives) {
      if (d.kind !== "linear") continue;
      const pm = this.bodies.get(d.motor)!.translation(), pd = this.bodies.get(d.driven)!.translation();
      const rel: Vec3 = [(pd.x - pm.x) / S - d.d0[0], (pd.y - pm.y) / S - d.d0[1], (pd.z - pm.z) / S - d.d0[2]];
      out.set(d.motor, rel[0] * d.axis[0] + rel[1] * d.axis[1] + rel[2] * d.axis[2]);
    }
    for (const [id, s] of this.sliders) {
      const h = this.bodies.get(id)!.translation(), t = s.body.translation();
      out.set(id, ((t.x - h.x) * s.axis[0] + (t.y - h.y) * s.axis[1] + (t.z - h.z) * s.axis[2]) / S);
    }
    return out;
  }

  poses(): Map<number, Pose> {
    const out = new Map<number, Pose>();
    for (const [id, b] of this.bodies) {
      const t = b.translation(), r = b.rotation();
      out.set(id, { p: [t.x / S, t.y / S, t.z / S], q: [r.x, r.y, r.z, r.w] });
    }
    return out;
  }

  /** Estado para mostrar: motores, derrumbes, motores atascados o sobrecargados. */
  status(env: SimEnv | ((id: number) => number), dtSinceLast: number): SimStatus {
    const voltage = typeof env === "function" ? env : env.voltage;
    const issues: Issue[] = [];
    const flag: Record<number, "err" | "warn"> = {};
    const motors: Record<number, MotorState> = {};
    for (const d of this.drives) {
      const M = this.bodies.get(d.motor)!, D = this.bodies.get(d.driven)!;
      const v = voltage(d.motor);
      if (d.kind === "linear") {
        const pm = M.translation(), pd = D.translation();
        const rel: Vec3 = [(pd.x - pm.x) / S - d.d0[0], (pd.y - pm.y) / S - d.d0[1], (pd.z - pm.z) / S - d.d0[2]];
        motors[d.motor] = { rpm: 0, current: 0, torque: 0, ext: rel[0] * d.axis[0] + rel[1] * d.axis[1] + rel[2] * d.axis[2] };
        continue;
      }
      const wm = M.angvel(), wd = D.angvel();
      const w = (wd.x - wm.x) * d.axis[0] + (wd.y - wm.y) * d.axis[1] + (wd.z - wm.z) * d.axis[2];
      const rpm = (w * 60) / (2 * Math.PI);
      if (d.kind !== "dc") {
        motors[d.motor] = { rpm, current: 0, torque: 0, angle: relAngle(M, D, d.axis) };
        continue;
      }
      const i = motorCurrent(d.params, v, w);
      motors[d.motor] = { rpm, current: i, torque: motorTorque(d.params, v, w) };
      const expected = noLoadSpeed(d.params, v);
      d.slow = Math.abs(v) > 0.5 && Math.abs(w) < 0.2 * Math.abs(expected) ? d.slow + dtSinceLast : 0;
      d.heavy = Math.abs(i) > 0.7 * d.params.iStall ? d.heavy + dtSinceLast : 0;
    }
    for (const [id, st] of this.servos) motors[id] = { rpm: 0, current: 0, torque: 0, angle: st.cmd };
    const capped = [...this.drives.filter((d) => d.limit > 0.3).map((d) => d.motor), ...[...this.servos].filter(([, st]) => st.limit > 0.3).map(([id]) => id)];
    if (capped.length) {
      issues.push({ s: "info", h: "Límite de articulación alcanzado", t: "Un servo llegó a su ángulo mínimo o máximo y no puede seguir. Cambia el ángulo pedido o amplía sus límites en Propiedades.", ids: capped });
    }
    const jointAngle: Record<number, number> = {};
    for (const r of this.revs) jointAngle[r.id] = relAngle(r.A, r.B, r.axis);
    for (const e of this.kinEdges) if (e.servo) jointAngle[e.joint] = this.servos.get(e.parent)?.cmd ?? 0;
    const pressed: Record<number, boolean> = {};
    for (const sn of this.sensors) {
      let hit = false;
      this.world.contactPairsWith(sn.collider, (other) => {
        const pid = this.partOf.get(other.handle);
        if (pid === undefined || sn.ignore.has(pid)) return;
        this.world.contactPair(sn.collider, other, (m) => { if (m.numContacts() > 0) hit = true; });
      });
      pressed[sn.id] = hit;
    }
    const stuck = this.drives.filter((d) => d.slow > 0.6);
    if (stuck.length) {
      issues.push({ s: "warn", h: "Motor sin fuerza o atascado", t: "El motor recibe voltaje pero casi no gira: la carga es demasiado pesada o algo lo traba. Alivia la carga, revisa las juntas o usa un motor con más par.", ids: stuck.map((d) => d.motor) });
      stuck.forEach((d) => { flag[d.motor] = "warn"; });
    }
    const heavy = this.drives.filter((d) => d.heavy > 1);
    if (heavy.length) {
      issues.push({ s: "warn", h: "Motor sobrecargado", t: "El motor pasa mucha corriente durante un buen rato: se calentaría. Baja la carga o el voltaje.", ids: heavy.map((d) => d.motor) });
      heavy.forEach((d) => { flag[d.motor] = "warn"; });
    }
    if (this.t > 0.3) {
      for (const [id, b] of this.bodies) {
        const z0 = this.start.get(id)![2], z = b.translation().z / S;
        if (z0 - z > 15) this.fallen.add(id);
      }
    }
    if (this.fallen.size) {
      issues.push({ s: "warn", h: "Estructura que se derrumba", t: this.fallen.size > 1 ? `${this.fallen.size} piezas cayeron porque nada las sostiene. Apóyalas o únelas con una unión fija o una junta.` : "Una pieza cayó porque nada la sostiene. Apóyala o únela con una unión fija o una junta.", ids: [...this.fallen] });
      this.fallen.forEach((id) => { if (!flag[id]) flag[id] = "warn"; });
    }
    return { issues, flag, motors, jointAngle, pressed, t: this.t };
  }

  free(): void {
    this.world.free();
  }
}

/** Dirección del eje local de una pieza en la mesa (útil para pruebas). */
export const axisOfPart = (p: Part, local: Vec3): Vec3 => rotateLocal(local, p.rot);
