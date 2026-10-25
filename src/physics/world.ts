// Adaptador de Rapier: crea el mundo físico desde el modelo y lo avanza.
// El modelo sigue siendo la única fuente de verdad: al detener, se descarta el mundo.
//
// Unidades: Rapier trabaja en metros y kilogramos; el modelo, en mm.
// Todos los cuerpos empiezan sin girar y sus formas llevan el giro de la pieza; así los ejes
// de las juntas se expresan igual en ambos cuerpos.

import RAPIER from "@dimforge/rapier3d-compat";
import { holeAt } from "../core/model/holes";
import { extent, rotateLocal, sizeOf, type Part, type Project, type Vec3 } from "../core/model/project";
import { ROTORS } from "../core/mechanical/axes";
import { checkStructure } from "../core/model/structure";
import { motorCurrent, motorParams, motorTorque, noLoadSpeed, type MotorParams } from "../core/coupling/dcmotor";
import type { Issue } from "../core/electrical/circuit";

const S = 0.001; // mm → m
const STEP = 1 / 120;

let ready: Promise<void> | null = null;
export const initPhysics = (): Promise<void> => (ready ??= RAPIER.init());

/** Densidad aproximada (kg/m³) según el tipo: los perfiles son huecos. */
function density(type: string): number {
  if (type.startsWith("profile") || type === "link" || type === "plate") return 900;
  if (type === "dcmotor" || type === "stepper" || type === "servo") return 2500;
  return 1200;
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
}

export interface SimStatus {
  issues: Issue[];
  flag: Record<number, "err" | "warn">;
  motors: Record<number, MotorState>;
  t: number;
}

interface Drive {
  joint: RAPIER.RevoluteImpulseJoint;
  motor: number;
  driven: number;
  axis: Vec3;
  params: MotorParams;
  slow: number;
  heavy: number;
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
  private acc = 0;
  private fallen = new Set<number>();
  t = 0;

  constructor(project: Project) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: -9.81 });
    this.world.timestep = STEP;
    // Las piezas miden centímetros: las tolerancias de contacto se ajustan a esa escala.
    this.world.integrationParameters.lengthUnit = 0.01;
    // Mesa
    const table = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, -0.01));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.6, 0.4, 0.01).setFriction(0.8), table);

    for (const part of project.parts) {
      // Engranajes, poleas y ejes siguen el cálculo de transmisiones: no son cuerpos libres.
      if (ROTORS[part.type]) continue;
      const ez = extent(part)[2];
      const c: Vec3 = [part.x, part.y, part.z + ez / 2];
      const fixed = part.type === "plate"; // la placa base queda anclada a la mesa
      const desc = (fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic()).setTranslation(c[0] * S, c[1] * S, c[2] * S);
      const body = this.world.createRigidBody(desc);
      const [sx, sy, sz] = sizeOf(part.type, part.props);
      const q = partQuat(part.rot);
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid((sx / 2) * S, (sy / 2) * S, (sz / 2) * S)
          .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
          .setDensity(density(part.type))
          .setFriction(0.7),
        body,
      );
      this.bodies.set(part.id, body);
      this.start.set(part.id, c);
    }

    // Lo que se apoya sobre la placa base queda unido a ella, como atornillado.
    for (const plate of project.parts.filter((p) => p.type === "plate")) {
      const P0 = this.bodies.get(plate.id);
      const [px, py, pz] = extent(plate);
      if (!P0) continue;
      for (const part of project.parts) {
        const B = this.bodies.get(part.id);
        if (!B || part.id === plate.id || Math.abs(part.z - (plate.z + pz)) > 0.5) continue;
        const [ex, ey] = extent(part);
        if (Math.abs(part.x - plate.x) > (px + ex) / 2 - 1 || Math.abs(part.y - plate.y) > (py + ey) / 2 - 1) continue;
        const a = this.start.get(plate.id)!, b = this.start.get(part.id)!;
        const anchor = { x: (b[0] - a[0]) * S, y: (b[1] - a[1]) * S, z: (b[2] - a[2]) * S };
        const j = this.world.createImpulseJoint(RAPIER.JointData.fixed(anchor, { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }), P0, B, true);
        j.setContactsEnabled(false);
      }
    }

    const broken = checkStructure(project).broken;
    for (const j of project.joints ?? []) {
      if (broken.has(j.id)) continue;
      const A = this.bodies.get(j.a.part), B = this.bodies.get(j.b.part);
      const ha = holeAt(project, j.a), hb = holeAt(project, j.b);
      if (!A || !B || !ha || !hb) continue;
      const pa = this.start.get(j.a.part)!, pb = this.start.get(j.b.part)!;
      const la = { x: (ha.p[0] - pa[0]) * S, y: (ha.p[1] - pa[1]) * S, z: (ha.p[2] - pa[2]) * S };
      const lb = { x: (ha.p[0] - pb[0]) * S, y: (ha.p[1] - pb[1]) * S, z: (ha.p[2] - pb[2]) * S };
      const axis = { x: ha.n[0], y: ha.n[1], z: ha.n[2] };
      const shaft = ha.shaft || hb.shaft;
      const data = j.kind === "fixed" && !shaft
        ? RAPIER.JointData.fixed(la, { x: 0, y: 0, z: 0, w: 1 }, lb, { x: 0, y: 0, z: 0, w: 1 })
        : RAPIER.JointData.revolute(la, lb, axis);
      const joint = this.world.createImpulseJoint(data, A, B, true);
      joint.setContactsEnabled(false);
      if (shaft) {
        const motorId = ha.shaft ? j.a.part : j.b.part;
        const motorPart = project.parts.find((p) => p.id === motorId)!;
        // El eje del motor apunta hacia afuera del motor: es el sentido positivo del giro.
        const dir = (ha.shaft ? ha.n : hb.n) as Vec3;
        const rev = joint as RAPIER.RevoluteImpulseJoint;
        rev.configureMotorModel(RAPIER.MotorModel.ForceBased);
        this.drives.push({ joint: rev, motor: motorId, driven: motorId === j.a.part ? j.b.part : j.a.part, axis: dir, params: motorParams(motorPart.props), slow: 0, heavy: 0 });
      }
    }
  }

  /** Avanza la simulación. `voltage` da el voltaje de cada motor según el circuito. */
  step(dt: number, voltage: (motorId: number) => number): void {
    this.acc += Math.min(dt, 0.05);
    let n = 0;
    while (this.acc >= STEP && n < 6) {
      // Motor DC como motor de velocidad de la junta: par = c · (ω0 − ω), con
      // ω0 = V / Ke y c = Kt · Ke / R. Es exactamente Kt · (V − Ke · ω) / R, y Rapier lo
      // resuelve de forma implícita, estable aunque las piezas sean muy livianas.
      for (const d of this.drives) {
        const m = d.params;
        d.joint.configureMotorVelocity(voltage(d.motor) / m.ke, (m.kt * m.ke) / m.r);
      }
      this.world.step();
      this.acc -= STEP;
      this.t += STEP;
      n++;
    }
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
  status(voltage: (motorId: number) => number, dtSinceLast: number): SimStatus {
    const issues: Issue[] = [];
    const flag: Record<number, "err" | "warn"> = {};
    const motors: Record<number, MotorState> = {};
    for (const d of this.drives) {
      const M = this.bodies.get(d.motor)!, D = this.bodies.get(d.driven)!;
      const wm = M.angvel(), wd = D.angvel();
      const w = (wd.x - wm.x) * d.axis[0] + (wd.y - wm.y) * d.axis[1] + (wd.z - wm.z) * d.axis[2];
      const v = voltage(d.motor);
      const i = motorCurrent(d.params, v, w);
      motors[d.motor] = { rpm: (w * 60) / (2 * Math.PI), current: i, torque: motorTorque(d.params, v, w) };
      const expected = noLoadSpeed(d.params, v);
      d.slow = Math.abs(v) > 0.5 && Math.abs(w) < 0.2 * Math.abs(expected) ? d.slow + dtSinceLast : 0;
      d.heavy = Math.abs(i) > 0.7 * d.params.iStall ? d.heavy + dtSinceLast : 0;
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
    return { issues, flag, motors, t: this.t };
  }

  free(): void {
    this.world.free();
  }
}

/** Dirección del eje local de una pieza en la mesa (útil para pruebas). */
export const axisOfPart = (p: Part, local: Vec3): Vec3 => rotateLocal(local, p.rot);
