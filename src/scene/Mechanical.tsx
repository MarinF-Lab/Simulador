import { useMemo } from "react";
import * as THREE from "three";
import { useProject } from "../store/project";
import { cross, dot, len, mul, sub, type Axis, type V } from "../core/mechanical/axes";

// Correas 3D: tangentes entre las dos poleas en su plano, más el arco que abraza cada polea.

const C = { belt: "#22252e", sel: "#9a9aff", warn: "#e8a93b" };

function basis(a: V): [V, V] {
  const ref: V = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = cross(a, ref);
  const ul = len(u);
  const un: V = [u[0] / ul, u[1] / ul, u[2] / ul];
  return [un, cross(a, un)];
}

/** Puntos del lazo de la correa (cerrado) en 3D. */
export function beltLoop(A: Axis, B: Axis, crossed: boolean): THREE.Vector3[] | null {
  const [u, v] = basis(A.a);
  const to2 = (p: V): [number, number] => [dot(p, u), dot(p, v)];
  const c1 = to2(A.c), c2 = to2(B.c);
  const h = dot(A.c, A.a);
  const to3 = (x: number, y: number) => {
    const p: V = [u[0] * x + v[0] * y + A.a[0] * h, u[1] * x + v[1] * y + A.a[1] * h, u[2] * x + v[2] * y + A.a[2] * h];
    return new THREE.Vector3(...p);
  };
  const r1 = A.r + 1.2, r2 = B.r + 1.2;
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1], d = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
  if (crossed ? d <= r1 + r2 : d <= Math.abs(r1 - r2)) return null;
  const pts: THREE.Vector3[] = [];
  /** Arco de a0 a a1 en sentido antihorario (dir 1) u horario (dir −1). */
  const arc = (c: [number, number], r: number, a0: number, a1: number, dir = 1) => {
    let da = (a1 - a0) * dir;
    while (da <= 0) da += Math.PI * 2;
    da *= dir;
    const n = Math.max(6, Math.ceil(Math.abs(da) / 0.2));
    for (let i = 0; i <= n; i++) {
      const t = a0 + (da * i) / n;
      pts.push(to3(c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)));
    }
  };
  if (!crossed) {
    const g = Math.acos((r1 - r2) / d);
    // Lado superior: de la polea 1 a la 2; luego el arco lejano de la 2 y vuelta por abajo.
    arc(c1, r1, th + g, th - g + Math.PI * 2);
    arc(c2, r2, th - g, th + g);
  } else {
    const g = Math.acos((r1 + r2) / d);
    arc(c1, r1, th + g, th - g + Math.PI * 2);
    // Correa cruzada: la segunda polea se recorre al revés y las tangentes se cruzan.
    arc(c2, r2, th - g + Math.PI, th + g - Math.PI, -1);
  }
  return pts;
}

function BeltMesh({ id, A, B, crossed, color }: { id: number; A: Axis; B: Axis; crossed: boolean; color: string }) {
  const key = [A.c, A.a, B.c, A.r, B.r].flat().map((x) => Math.round(x * 10)).join() + crossed;
  const geo = useMemo(() => {
    const pts = beltLoop(A, B, crossed);
    if (!pts) return null;
    const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
    return new THREE.TubeGeometry(curve, Math.min(400, pts.length * 3), 1.4, 6, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!geo) {
    // Correa imposible: línea punteada entre los centros.
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...A.c), new THREE.Vector3(...B.c)]);
    return (
      <lineSegments geometry={g} userData={{ belt: id }}>
        <lineDashedMaterial color={C.warn} dashSize={6} gapSize={6} />
      </lineSegments>
    );
  }
  return (
    <mesh geometry={geo} castShadow userData={{ belt: id }}>
      <meshStandardMaterial color={color} roughness={0.85} emissive={color === C.sel ? C.sel : "#000"} emissiveIntensity={color === C.sel ? 0.4 : 0} />
    </mesh>
  );
}

export function Belts() {
  const belts = useProject((s) => s.project.belts);
  const mech = useProject((s) => s.mech);
  const selected = useProject((s) => s.selected);
  return (
    <group name="belts">
      {(belts ?? []).map((b) => {
        const A = mech.axisOf[b.a], B = mech.axisOf[b.b];
        if (!A || !B) return null;
        const color = selected === b.id ? C.sel : mech.beltOk[b.id] ? C.belt : C.warn;
        return <BeltMesh key={b.id} id={b.id} A={A} B={B} crossed={b.cross} color={color} />;
      })}
    </group>
  );
}

export const axisCenter = (A: Axis): V => A.c;
export const sub3 = sub;
export const mul3 = mul;
