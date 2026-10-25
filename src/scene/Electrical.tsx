import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Cable, Project } from "../core/model/project";
import { endPos, POLAR, posKey, TERMINALS, termWorld } from "../core/model/terminals";
import { useProject } from "../store/project";
import { useUI } from "../store/ui";

// Bornes (esferas) y cables (tubos curvos). Rojo = lado +, azul = lado −.

const C = { plus: "#e0483f", minus: "#3d7fe0", neutral: "#b9c2d6", warn: "#e8a93b", sel: "#9a9aff", termMinus: "#4b5677" };

const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const sphere = new THREE.SphereGeometry(1, 16, 12);

export function Terminals() {
  const parts = useProject((s) => s.project.parts);
  const pending = useProject((s) => s.pending);
  return (
    <group name="terms">
      {parts.flatMap((p) => {
        const n = TERMINALS[p.type]?.length ?? 0;
        return Array.from({ length: n }, (_, t) => {
          const pos = termWorld(p, t);
          const plus = t === 1 && POLAR.has(p.type);
          const pend = pending?.part === p.id && pending.t === t;
          return (
            <group key={`${p.id}:${t}`} position={pos}>
              <mesh geometry={sphere} scale={pend ? 4.5 : 2.8}>
                <meshStandardMaterial color={pend ? C.sel : plus ? C.plus : C.termMinus} emissive={pend ? C.sel : "#000"} emissiveIntensity={pend ? 0.8 : 0} roughness={0.4} metalness={0.3} />
              </mesh>
              {/* Zona de toque más grande que la esfera visible. */}
              <mesh geometry={sphere} scale={8} material={hitMat} userData={{ term: { part: p.id, t } }} />
            </group>
          );
        });
      })}
    </group>
  );
}

/** Curva del cable: sube desde cada punta y hace un arco. */
function curveOf(a: THREE.Vector3, b: THREE.Vector3): THREE.CatmullRomCurve3 {
  const d = a.distanceTo(b);
  const lift = Math.min(60, Math.max(10, d * 0.28));
  const up = new THREE.Vector3(0, 0, lift);
  const m = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0, lift * 1.25));
  return new THREE.CatmullRomCurve3([a, a.clone().add(up.clone().multiplyScalar(0.6)), m, b.clone().add(up.clone().multiplyScalar(0.6)), b], false, "centripetal");
}

let dashTex: THREE.CanvasTexture | null = null;
function dashTexture(): THREE.CanvasTexture {
  if (dashTex) return dashTex;
  const c = document.createElement("canvas");
  c.width = 64; c.height = 8;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 64, 8);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 22, 8);
  dashTex = new THREE.CanvasTexture(c);
  dashTex.wrapS = THREE.RepeatWrapping;
  return dashTex;
}

const reduced = (() => {
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
})();

function CableMesh({ cable, project, color, flow, selected }: { cable: Cable; project: Project; color: string; flow: number; selected: boolean }) {
  const a = endPos(project, cable.ends[0]), b = endPos(project, cable.ends[1]);
  const key = a.join() + "|" + b.join();
  const { geo, flowGeo, len } = useMemo(() => {
    const curve = curveOf(new THREE.Vector3(...a), new THREE.Vector3(...b));
    return { geo: new THREE.TubeGeometry(curve, 32, 1.7, 8, false), flowGeo: new THREE.TubeGeometry(curve, 32, 2.3, 8, false), len: curve.getLength() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const tex = useMemo(() => {
    const t = dashTexture().clone();
    t.needsUpdate = true;
    return t;
  }, []);
  tex.repeat.set(Math.max(1, len / 14), 1);
  const speed = useRef(0);
  speed.current = flow;
  useFrame((_, dt) => {
    if (speed.current && !reduced) tex.offset.x -= Math.sign(speed.current) * Math.min(dt, 0.05) * 2.2;
  });
  return (
    <group>
      <mesh geometry={geo} castShadow userData={{ cable: cable.id }}>
        <meshStandardMaterial color={selected ? C.sel : color} emissive={selected ? C.sel : "#000"} emissiveIntensity={selected ? 0.35 : 0} roughness={0.5} />
      </mesh>
      {flow !== 0 && (
        <mesh geometry={flowGeo} renderOrder={2}>
          <meshBasicMaterial color="#ffd36a" map={tex} transparent depthWrite={false} opacity={0.95} />
        </mesh>
      )}
    </group>
  );
}

export function Cables() {
  const project = useProject((s) => s.project);
  const selected = useProject((s) => s.selected);
  const circuit = useProject((s) => s.circuit);
  const running = useUI((s) => s.running);
  return (
    <group name="cables">
      {project.cables.map((c) => {
        const side = circuit.side[c.id];
        const color = circuit.flag[c.id] === "warn" ? C.warn : side === "+" ? C.plus : side === "-" ? C.minus : C.neutral;
        const i = circuit.readings[c.id]?.i ?? 0;
        return <CableMesh key={c.id} cable={c} project={project} color={color} flow={running && Math.abs(i) > 1e-4 ? Math.sign(i) : 0} selected={selected === c.id} />;
      })}
    </group>
  );
}

/** Puntas arrastrables: se ven en el cable seleccionado y en las puntas sueltas. */
export function CableEnds() {
  const project = useProject((s) => s.project);
  const selected = useProject((s) => s.selected);
  const circuit = useProject((s) => s.circuit);
  return (
    <group name="ends">
      {project.cables.flatMap((c) =>
        c.ends.map((e, i) => {
          const p = endPos(project, e);
          const loose = circuit.occAt(posKey(p)) < 2;
          if (!loose && selected !== c.id) return null;
          return (
            <group key={`${c.id}:${i}`} position={p}>
              <mesh geometry={sphere} scale={selected === c.id ? 4.2 : 3.6}>
                <meshStandardMaterial color={loose ? C.warn : C.sel} emissive={loose ? C.warn : C.sel} emissiveIntensity={0.5} />
              </mesh>
              <mesh geometry={sphere} scale={9} material={hitMat} userData={{ cableEnd: { id: c.id, i } }} />
            </group>
          );
        }),
      )}
    </group>
  );
}

/** Mientras corre la simulación con corriente, pide un cuadro nuevo cada vez para animar. */
export function FlowTicker() {
  const running = useUI((s) => s.running);
  const any = useProject((s) => s.project.cables.some((c) => Math.abs(s.circuit.readings[c.id]?.i ?? 0) > 1e-4));
  const invalidate = useThree((st) => st.invalidate);
  useEffect(() => invalidate(), [running, any, invalidate]);
  useFrame(() => {
    if (running && any && !reduced) invalidate();
  });
  return null;
}
