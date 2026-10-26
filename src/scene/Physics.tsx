import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { coaxial, motorAxis, rotorAxis, centerOf } from "../core/mechanical/axes";
import { useProject } from "../store/project";
import { simPoses, useSim } from "../store/sim";
import type { Sim } from "../physics/world";
import { useRecord } from "../store/record";

/**
 * Mientras la simulación está iniciada: crea el mundo de Rapier desde el diseño, lo avanza
 * en cada cuadro y publica las poses. Al detenerla, libera el mundo y todo vuelve al diseño.
 */
export function PhysicsRunner() {
  const sim = useRef<Sim | null>(null);
  const since = useRef(0);
  const sinceRec = useRef(0);
  /** Último ángulo grabado de cada serie, para que no salte de +180° a −180° al dar la vuelta. */
  const lastAngle = useRef(new Map<string, number>());
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    let alive = true;
    useSim.setState({ loading: true, error: null });
    // Cada simulación nueva empieza una grabación nueva.
    useRecord.getState().clear();
    lastAngle.current.clear();
    void import("../physics/world")
      .then(async (m) => {
        await m.initPhysics();
        if (!alive) return;
        const project = useProject.getState().project;
        sim.current = new m.Sim(project);
        // Engranajes y poleas en el eje de un motor viajan con el motor.
        simPoses.follow.clear();
        simPoses.start.clear();
        const motors = project.parts.map(motorAxis).filter((a) => a !== null);
        const rotors = project.parts.map(rotorAxis).filter((a) => a !== null);
        const holder = new Map<number, number>();
        for (const m2 of motors) for (const r of rotors) if (coaxial(m2!, r!)) holder.set(r!.id, m2!.id);
        for (let pass = 0; pass < 3; pass++) for (const r of rotors) for (const o of rotors) {
          if (r!.id !== o!.id && !holder.has(r!.id) && holder.has(o!.id) && coaxial(r!, o!)) holder.set(r!.id, holder.get(o!.id)!);
        }
        for (const p of project.parts) simPoses.start.set(p.id, centerOf(p));
        for (const [rid, mid] of holder) {
          const a = simPoses.start.get(rid)!, b = simPoses.start.get(mid)!;
          simPoses.follow.set(rid, { holder: mid, offset: [a[0] - b[0], a[1] - b[1], a[2] - b[2]] });
        }
        useSim.setState({ loading: false });
        invalidate();
      })
      .catch((e: unknown) => useSim.setState({ loading: false, error: e instanceof Error ? e.message : "No se pudo iniciar la física." }));
    return () => {
      alive = false;
      sim.current?.free();
      sim.current = null;
      simPoses.map = new Map();
      simPoses.ext = new Map();
      simPoses.follow.clear();
      useSim.setState({ status: null, loading: false });
      useProject.getState().setPressed({});
      invalidate();
    };
  }, [invalidate]);

  useFrame((_, dt) => {
    const s = sim.current;
    if (!s) return;
    const st = useProject.getState();
    const volt = (id: number) => useProject.getState().circuit.readings[id]?.v ?? 0;
    const props = (id: number) => st.project.parts.find((p) => p.id === id)?.props ?? {};
    s.step(dt, { voltage: volt, props });
    simPoses.map = s.poses();
    simPoses.ext = s.extensions();
    since.current += dt;
    sinceRec.current += dt;
    // Grabación para Análisis: 10 muestras por segundo.
    if (sinceRec.current >= 0.1) {
      sinceRec.current = 0;
      const ps = useProject.getState();
      const status = useSim.getState().status;
      const values: Record<string, number> = {};
      for (const p of ps.project.parts) {
        const r = ps.circuit.readings[p.id];
        if (r) { values[`${p.id}:v`] = r.v; values[`${p.id}:i`] = r.i; }
        const m = status?.motors[p.id];
        const w = m && m.rpm !== 0 ? m.rpm : ps.mech.rpm[p.id];
        if (w !== undefined && (m || Math.abs(w) > 0 || p.type === "dcmotor" || p.type.startsWith("gear") || p.type.startsWith("pulley"))) values[`${p.id}:rpm`] = w;
        if (m && p.type === "dcmotor") { values[`${p.id}:torque`] = m.torque; values[`${p.id}:i`] = m.current; }
        if (m?.angle !== undefined) values[`${p.id}:angle`] = m.angle;
      }
      for (const [jid, a] of Object.entries(status?.jointAngle ?? {})) values[`j${jid}:angle`] = a;
      for (const [k, a] of Object.entries(values)) {
        if (!k.endsWith(":angle")) continue;
        const prev = lastAngle.current.get(k);
        let u = a;
        if (prev !== undefined) while (u - prev > 180) u -= 360;
        if (prev !== undefined) while (u - prev < -180) u += 360;
        values[k] = u;
        lastAngle.current.set(k, u);
      }
      useRecord.getState().push(s.t, values);
    }
    if (since.current > 0.25) {
      const status = s.status(volt, since.current);
      useSim.getState().setStatus(status);
      // Los sensores de contacto que una pieza toca cierran su circuito (sin tocar el historial).
      useProject.getState().setPressed(status.pressed);
      since.current = 0;
    }
    invalidate();
  });
  return null;
}
