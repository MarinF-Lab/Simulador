import * as THREE from "three";
import { holeAt } from "../core/model/holes";
import { jointPoint } from "../core/model/structure";
import { useProject } from "../store/project";

// Juntas en 3D: la rotacional es un pasador con anillo índigo; la fija, la cabeza de un perno.

const pin = new THREE.CylinderGeometry(2.6, 2.6, 1, 16);
const head = new THREE.CylinderGeometry(4.5, 4.5, 3, 6);
const ring = new THREE.TorusGeometry(5.5, 1.1, 8, 24);
const hit = new THREE.SphereGeometry(9, 10, 8);
const drop = new THREE.SphereGeometry(5, 16, 12);
const glueMat = new THREE.MeshStandardMaterial({ color: "#f4ecd2", roughness: 0.2, transparent: true, opacity: 0.85 });
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const steel = new THREE.MeshStandardMaterial({ color: "#c7cedc", metalness: 0.8, roughness: 0.3 });
const accent = new THREE.MeshStandardMaterial({ color: "#7c7cf0", emissive: "#5b5bd6", emissiveIntensity: 0.4 });
const selMat = new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#9a9aff", emissiveIntensity: 0.8 });
const warnMat = new THREE.MeshStandardMaterial({ color: "#e8a93b", emissive: "#e8a93b", emissiveIntensity: 0.5 });

/** Orienta el eje Y de la geometría (el de los cilindros) a lo largo de la normal del agujero. */
function quatFor(n: [number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...n));
}

export function Joints() {
  const project = useProject((s) => s.project);
  const selected = useProject((s) => s.selected);
  const broken = useProject((s) => s.structure.broken);
  return (
    <group name="joints">
      {(project.joints ?? []).map((j) => {
        const sel = selected === j.id, bad = broken.has(j.id);
        // Pegamento: una gota en el centro del contacto.
        if (j.kind === "glue") {
          const p = jointPoint(project, j) ?? project.parts.find((x) => x.id === j.a.part) ?? null;
          if (!p) return null;
          const at: [number, number, number] = Array.isArray(p) ? p : [p.x, p.y, p.z];
          return (
            <group key={j.id} position={at}>
              <mesh geometry={drop} scale={[1.6, 1.0, 1.0]} material={sel ? selMat : bad ? warnMat : glueMat} />
              <mesh geometry={hit} material={hitMat} userData={{ joint: j.id }} />
            </group>
          );
        }
        const h = holeAt(project, j.a);
        if (!h) return null;
        const q = quatFor(h.n);
        const ringQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...h.n));
        return (
          <group key={j.id} position={h.p}>
            {j.kind === "revolute" ? (
              <>
                <mesh geometry={pin} quaternion={q} scale={[1, 14, 1]} material={sel ? selMat : bad ? warnMat : steel} />
                <mesh geometry={ring} quaternion={ringQ} material={sel ? selMat : bad ? warnMat : accent} />
              </>
            ) : (
              <mesh geometry={head} quaternion={q} position={[h.n[0] * -1.5, h.n[1] * -1.5, h.n[2] * -1.5]} material={sel ? selMat : bad ? warnMat : steel} />
            )}
            <mesh geometry={hit} material={hitMat} userData={{ joint: j.id }} />
          </group>
        );
      })}
    </group>
  );
}
