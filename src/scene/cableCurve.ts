import * as THREE from "three";
import type { Cable, Project, Vec3 } from "../core/model/project";
import { endPos } from "../core/model/terminals";

/** Curva del cable: sube desde cada punta y hace un arco, o pasa por el punto de doblez. */
export function curveOf(a: THREE.Vector3, b: THREE.Vector3, bend?: Vec3 | null): THREE.CatmullRomCurve3 {
  const d = a.distanceTo(b);
  const lift = Math.min(60, Math.max(10, d * 0.28));
  const up = new THREE.Vector3(0, 0, lift * 0.6);
  const m = bend ? new THREE.Vector3(...bend) : a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0, lift * 1.25));
  return new THREE.CatmullRomCurve3([a, a.clone().add(up), m, b.clone().add(up), b], false, "centripetal");
}

export function cableCurve(project: Project, c: Cable): THREE.CatmullRomCurve3 {
  return curveOf(new THREE.Vector3(...endPos(project, c.ends[0])), new THREE.Vector3(...endPos(project, c.ends[1])), c.bend);
}

/** Punto medio del cable: donde va el punto de doblez y los botones flotantes. */
export function cableMid(project: Project, c: Cable): Vec3 {
  if (c.bend) return c.bend;
  const p = cableCurve(project, c).getPoint(0.5);
  return [p.x, p.y, p.z];
}
