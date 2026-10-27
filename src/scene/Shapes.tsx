import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { parseShape } from "../core/model/polygon";
import { extent, rotateLocal, sizeOf, type Part } from "../core/model/project";
import { useProject } from "../store/project";
import { useUI } from "../store/ui";

// Diseño libre en 3D: la vista previa al dibujar una pieza y los tiradores de Editar forma.

const dot = new THREE.SphereGeometry(4, 14, 10);
const square = new THREE.BoxGeometry(7, 7, 7);
const hitBall = new THREE.SphereGeometry(10, 8, 6);
const hidden = new THREE.MeshBasicMaterial({ visible: false });
const vMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
const vSel = new THREE.MeshBasicMaterial({ color: "#ef5a5a" });
const eMat = new THREE.MeshBasicMaterial({ color: "#8b8bff" });
const first = new THREE.MeshBasicMaterial({ color: "#3fb97a" });

/** Puntos y líneas de la pieza que se está dibujando. */
export function DrawPreview() {
  const draw = useProject((s) => s.drawMode);
  const geo = useMemo(() => {
    if (!draw || draw.pts.length < 2) return null;
    const v = draw.pts.map(([x, y]) => new THREE.Vector3(x, y, 1.5));
    if (draw.pts.length >= 3) v.push(v[0]!.clone());
    return new THREE.BufferGeometry().setFromPoints(v);
  }, [draw]);
  if (!draw) return null;
  return (
    <group name="draw">
      {geo && (
        <line>
          <primitive object={geo} attach="geometry" />
          <lineBasicMaterial color="#8b8bff" />
        </line>
      )}
      {draw.pts.map(([x, y], i) => <mesh key={i} geometry={dot} position={[x, y, 2]} material={i === 0 ? first : vMat} scale={i === 0 ? 1.4 : 1} />)}
    </group>
  );
}

/** Punto local de la cara de arriba de una pieza, en la mesa. */
function topPoint(p: Part, x: number, y: number): [number, number, number] {
  const h = sizeOf(p.type, p.props)[2], ez = extent(p)[2];
  const d = rotateLocal([x, y, h / 2 + 1], p.rot);
  return [p.x + d[0], p.y + d[1], p.z + ez / 2 + d[2]];
}

/** Tiradores de la pieza libre seleccionada en Editar forma: vértices (blancos) y lados (índigo). */
export function ShapeHandles() {
  const mode = useProject((s) => s.shapeMode);
  const sel = useProject((s) => s.project.parts.find((p) => p.id === s.selected && p.type === "custom"));
  const selV = useProject((s) => s.selVertex);
  const running = useUI((s) => s.running);
  const ref = useRef<THREE.Group>(null);
  // Con la vista alejada, los tiradores crecen para quedar de unos 12 px (y 36 px para tocarlos).
  useFrame(({ camera }) => {
    const k = Math.max(1, 1.5 / camera.zoom);
    ref.current?.traverse((o) => { if (o.userData.grow) o.scale.setScalar(k); });
  });
  if (!sel || mode !== "edit" || running) return null;
  const pts = parseShape(sel.props.shape);
  return (
    <group name="shape" ref={ref}>
      {pts.map(([x, y], i) => {
        const [nx, ny] = pts[(i + 1) % pts.length]!;
        return (
          <group key={i}>
            <group position={topPoint(sel, x, y)} userData={{ grow: true }}>
              <mesh geometry={dot} material={selV === i ? vSel : vMat} scale={1.3} />
              <mesh geometry={hitBall} material={hidden} userData={{ shapeV: i }} />
            </group>
            <group position={topPoint(sel, (x + nx) / 2, (y + ny) / 2)} userData={{ grow: true }}>
              <mesh geometry={square} material={eMat} />
              <mesh geometry={hitBall} material={hidden} scale={0.8} userData={{ shapeE: i }} />
            </group>
          </group>
        );
      })}
    </group>
  );
}
